"""Controlled frontend A/B against a hash-pinned real EXE and synthetic uploads.

Only app.js is supplied by the browser route. Every API, decryption, probe,
conversion and playback stream comes from the owned EXE. This is not acceptance
of a rebuilt EXE, desktop WebView, actual external network or user media.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import psutil

from tools.release_browser import launch_browser, require_windows_candidate
from tools.verify_media_release import make_fixtures, probe, require, sha256, upload, validate_engine
from tools.verify_packaged_browser_acceptance import owned_client


def bundle_at(ref):
    def read(path):
        return subprocess.check_output(['git', 'show', f'{ref}:{path}'], cwd=ROOT)
    manifest = json.loads(read('source/frontend/manifest.json'))
    return b''.join(read('source/frontend/' + section['file']) for section in manifest['sections'])


class OwnedResources:
    """Sample only this script's owned EXE and its media-engine descendants."""
    def __init__(self, client):
        self.client = client
        self.stop = threading.Event()
        self.previous = {}
        self.cpu = {'runtime': 0.0, 'engine': 0.0}
        self.peak = {'runtime': 0, 'engine': 0}
        self.worker = threading.Thread(target=self.sample, daemon=True)

    def sample(self):
        while not self.stop.is_set():
            rss = {'runtime': 0, 'engine': 0}
            for process in psutil.Process().children(recursive=True):
                try:
                    exe = Path(process.exe()).resolve()
                    if exe == self.client.executable.resolve():
                        group = 'runtime'
                    elif exe.name.lower() in ('ffmpeg.exe', 'ffprobe.exe') and any(
                            Path(parent.exe()).resolve() == self.client.executable.resolve()
                            for parent in process.parents()):
                        group = 'engine'
                    else:
                        continue
                    key = (process.pid, process.create_time())
                    times = process.cpu_times()
                    cpu = times.user + times.system
                    # Runtime lifetime starts before measurement; engine children
                    # are created during it, so count their initial CPU as well.
                    old = self.previous.get(key, cpu if group == 'runtime' else 0)
                    self.cpu[group] += max(0, cpu - old)
                    self.previous[key] = cpu
                    rss[group] += process.memory_info().rss
                except (psutil.Error, OSError):
                    pass
            for group in rss:
                self.peak[group] = max(self.peak[group], rss[group])
            self.stop.wait(.05)

    def __enter__(self):
        self.worker.start()
        return self

    def __exit__(self, *unused):
        self.stop.set()
        self.worker.join(2)

    def result(self):
        return {'sample_interval_ms': 50, 'cpu_seconds_sampled': self.cpu,
                'peak_rss_bytes': self.peak,
                'limitation': 'Very short lived engine CPU can fall between samples; CPU is a lower bound.'}


INSTRUMENT = r'''() => {
    window.__mediaBench = {started: 0, events: [], mounted: null, firstFrame: null, playing: null, playResolved: null, error: null};
    const original = mountMediaPreview;
    mountMediaPreview = async function(media, metadata) {
        const bench = window.__mediaBench;
        bench.events.push({event:'mount_enter', ms:performance.now()-bench.started, profile:media.profile});
        await original(media, metadata);
        if (!media.element || bench.mounted !== null) return;
        bench.mounted = performance.now()-bench.started;
        const element = media.element;
        const native = element instanceof HTMLVideoElement ? element : element.nativeEl || element.shadowRoot?.querySelector('video');
        bench.elementTag = element.localName;
        bench.nativeTag = native?.localName || null;
        bench.profile = media.profile;
        if (!native || typeof native.requestVideoFrameCallback !== 'function') {
            bench.error = 'No native requestVideoFrameCallback target'; return;
        }
        native.requestVideoFrameCallback((now, metadata) => {
            bench.firstFrame = performance.now()-bench.started;
            bench.frame = {mediaTime:metadata.mediaTime, presentedFrames:metadata.presentedFrames,
                           width:metadata.width, height:metadata.height};
        });
        element.addEventListener('playing', () => { bench.playing ??= performance.now()-bench.started; }, {once:true});
        element.muted = true;
        try { await element.play(); bench.playResolved = performance.now()-bench.started; }
        catch (error) { bench.error = String(error); }
    };
}'''


def one_page(browser, client, pid, aid, bundle, network, label, timeout):
    context = browser.new_context(viewport={'width': 1440, 'height': 950}, reduced_motion='reduce')
    context.add_cookies([{'name': cookie.name, 'value': cookie.value, 'url': client.base_url}
                        for cookie in client.session.cookies])
    external, errors = [], []
    origin = urlsplit(client.base_url)
    def route_owned(route):
        parsed = urlsplit(route.request.url)
        if (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
            external.append(route.request.url)
            route.abort()
        elif parsed.path == '/static/app.js' and bundle is not None:
            route.fulfill(status=200, content_type='application/javascript; charset=utf-8', body=bundle)
        else:
            route.continue_()
    context.route('**/*', route_owned)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    cdp = context.new_cdp_session(page)
    cdp.send('Network.enable')
    # Cold static resources on each page; warm runs still reuse the module map.
    cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': network['latency_ms'],
             'downloadThroughput': network['mbps'] * 1000000 / 8 if network['mbps'] else -1,
             'uploadThroughput': network['mbps'] * 1000000 / 8 if network['mbps'] else -1})
    cdp.send('Performance.enable')
    page.goto(client.base_url, wait_until='networkidle', timeout=timeout*1000)
    page.evaluate('(id) => selectProject(id)', pid)
    page.wait_for_function('(id) => Number(currentProject?.id) === id', arg=pid)
    page.evaluate(INSTRUMENT)
    outcomes = []
    try:
        for cache in ('cold', 'warm'):
            statuses = []
            def response_seen(response):
                path = urlsplit(response.url).path
                if path == f'/api/attachments/{aid}/media':
                    try:
                        statuses.append({'ms': round((time.perf_counter()-started)*1000, 3),
                                         'http': response.status, 'body': response.json()})
                    except Exception as error:
                        statuses.append({'error': str(error)})
            page.on('response', response_seen)
            started = time.perf_counter()
            metrics_before = {row['name']: row['value'] for row in cdp.send('Performance.getMetrics')['metrics']}
            with OwnedResources(client) as resources:
                page.evaluate('''id => { Object.assign(__mediaBench, {started:performance.now(),events:[],mounted:null,
                    firstFrame:null,playing:null,playResolved:null,error:null}); viewAttachment(id); }''', aid)
                page.wait_for_function('() => __mediaBench.firstFrame !== null || __mediaBench.error !== null', timeout=timeout*1000)
                measured = page.evaluate('() => ({...__mediaBench})')
                require(measured['error'] is None, 'Playback failed: ' + str(measured['error']))
                require(measured['firstFrame'] is not None and measured['frame']['presentedFrames'] > 0, 'No decoded video frame')
                page.wait_for_function('() => _previewState.media.element.currentTime > .2', timeout=15000)
                measured['currentTime_after_frame'] = page.evaluate('() => _previewState.media.element.currentTime')
                page.evaluate('() => _previewState.media.element.pause()')
            measured.update(network=network, variant=label, cache=cache, attachment_id=aid,
                            metadata_responses=statuses, resources=resources.result())
            metrics_after = {row['name']: row['value'] for row in cdp.send('Performance.getMetrics')['metrics']}
            measured['browser_task_seconds'] = metrics_after['TaskDuration'] - metrics_before['TaskDuration']
            measured['browser_script_seconds'] = metrics_after['ScriptDuration'] - metrics_before['ScriptDuration']
            measured['static_media_resources'] = page.evaluate('''() => performance.getEntriesByType('resource')
                .filter(x=>x.name.includes('/static/libs/videojs/') && x.startTime >= __mediaBench.started).map(x=>({path:new URL(x.name).pathname,
                start_ms:x.startTime-__mediaBench.started,duration_ms:x.duration,transfer_bytes:x.transferSize}))''')
            measured['media_api_resources'] = page.evaluate('''() => performance.getEntriesByType('resource')
                .filter(x=>x.name.includes('/api/attachments/') && x.name.includes('/media') && x.startTime >= __mediaBench.started)
                .map(x=>({path:new URL(x.name).pathname,query:new URL(x.name).search,
                start_ms:x.startTime-__mediaBench.started,duration_ms:x.duration,transfer_bytes:x.transferSize}))''')
            outcomes.append(measured)
            print(json.dumps({'network': network['name'], 'variant': label, 'cache': cache,
                              'attachment_id': aid, 'mounted_ms': measured['mounted'],
                              'first_frame_ms': measured['firstFrame']}, ensure_ascii=False), flush=True)
            page.remove_listener('response', response_seen)
            page.evaluate('closeDocPreview()')
            page.wait_for_timeout(100)
        require(not external, 'Unexpected external requests: ' + repr(external))
        require(not errors, 'Browser errors: ' + repr(errors))
        return outcomes
    finally:
        context.close()


def run(args):
    from playwright.sync_api import sync_playwright
    args.evidence.mkdir(parents=True, exist_ok=True)
    require_windows_candidate(args.candidate, args.candidate_sha256)
    engine = validate_engine(args.engine_directory)
    served = getattr(args, 'served_candidate', False)
    variants = [('candidate', None)] if served else [('before', bundle_at(args.before_ref)), ('after', bundle_at(args.after_ref))]
    if args.variant_order == 'after-before':
        variants.reverse()
    result = {'scope': ('Hash-pinned real EXE serving its own unmodified frontend. Owned synthetic uploads and headless browser; no native WebView or actual external network acceptance.' if served else __doc__), 'candidate': str(args.candidate.resolve()), 'candidate_sha256': args.candidate_sha256,
              'before_ref': args.before_ref, 'after_ref': args.after_ref,
              'variant_order': args.variant_order,
              'bundle_sha256': {name: hashlib.sha256(data).hexdigest() for name, data in variants if data is not None},
              'engine': engine, 'machine': {'platform': platform.platform(), 'cpu': platform.processor(),
                  'logical_cpus': psutil.cpu_count(), 'physical_cpus': psutil.cpu_count(logical=False),
                  'memory_bytes': psutil.virtual_memory().total}, 'runs': [],
              'synthetic_data_only': True, 'production_data_accessed': False,
              'native_desktop_verified': False, 'actual_external_network_verified': False,
              'rebuilt_exe_verified': served, 'frontend_route_override': not served, 'timing': 'Milliseconds from invoking viewAttachment; automatic muted play immediately on mount, zero human think time.',
              'cache': 'Cold: independent attachment ID and fresh browser context, HTTP cache disabled. Warm: same ID/context, module map/server derivatives reused, HTTP cache still disabled.',
              'queue_budget': 'One independent EXE per network, two variants x (MP4 original + AVI original/compatible) = 6 media jobs, below max_jobs=8.'}
    try:
        with tempfile.TemporaryDirectory(prefix='pm-media-startup-', ignore_cleanup_errors=True) as temp:
            root = Path(temp)
            audio, avi = make_fixtures(root / 'fixtures')
            mp4 = avi.with_name('synthetic-motion-h264-aac.mp4')
            command = [str(args.engine_directory / 'ffmpeg.exe'), '-hide_banner', '-nostdin', '-v', 'error', '-y',
                       '-i', str(avi), '-i', str(audio), '-c:v', 'h264_mf', '-hw_encoding', '0',
                       '-b:v', '700k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
                       '-movflags', '+faststart', '-shortest', str(mp4)]
            encoded = subprocess.run(command, capture_output=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
            require(encoded.returncode == 0, 'Synthetic MP4 encoding failed: ' + encoded.stderr.decode('utf-8', errors='replace'))
            result['fixtures'] = {path.suffix: {'bytes': path.stat().st_size, 'sha256': sha256(path),
                    'probe': probe(args.engine_directory, path)} for path in (mp4, avi)}
            with sync_playwright() as playwright:
                browser, result['browser'] = launch_browser(playwright, args.browser_executable,
                        args=['--autoplay-policy=no-user-gesture-required'])
                try:
                    networks = [{'name': 'loopback', 'latency_ms': 0, 'mbps': 0},
                                {'name': 'simulated-40ms-20Mbps', 'latency_ms': 40, 'mbps': 20}]
                    for network in networks:
                        with owned_client(args.candidate.resolve(), root, network['name']) as client:
                            client.start()
                            response = client.session.get(client.base_url + '/static/app.js', timeout=30)
                            require(response.status_code == 200, 'Candidate frontend unavailable')
                            result['served_app_sha256'] = hashlib.sha256(response.content).hexdigest()
                            catalog = client.request('GET', '/api/procurement-methods')
                            method = next(row for row in catalog['methods'] if row.get('user_owned') is True and row.get('regime') is None)
                            result.setdefault('selected_procurement_methods', []).append({key: method.get(key) for key in ('id', 'name', 'regime')})
                            created = client.request('POST', '/api/projects', {'number': 'MEDIA-STARTUP',
                                'name': '隔离合成首播度量', 'procurement_method_id': method['id'], 'year': 2026})
                            pid = created['id']
                            before_projects = client.request('GET', '/api/projects')
                            for label, bundle in variants:
                                for path in (mp4, avi):
                                    # Distinct filenames/IDs prevent backend derivative sharing.
                                    source = path.with_name(label + '-' + path.name)
                                    shutil.copy2(path, source)
                                    row = upload(client, pid, source)
                                    runs = one_page(browser, client, pid, row['id'], bundle, network, label, args.timeout)
                                    for measurement in runs:
                                        measurement['input'] = {'format': path.suffix, 'bytes': path.stat().st_size, 'sha256': sha256(path)}
                                    result['runs'].extend(runs)
                                    require(sha256(client.data_root / row['stored_relative_path']) == row['stored_sha256'], 'Encrypted original changed')
                                    (args.evidence / 'startup-ab.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                            require(client.request('GET', '/api/projects') == before_projects, 'Playback changed project data')
                finally:
                    browser.close()
        result['completed'] = True
    except Exception as error:
        result.update(completed=False, error=f'{type(error).__name__}: {error}', traceback=traceback.format_exc())
        raise
    finally:
        (args.evidence / 'startup-ab.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate', 'engine-directory', 'evidence'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--candidate-sha256', required=True)
    parser.add_argument('--before-ref', default='653c1d79824caae75c2ac720828b1fc0e8aa1906')
    parser.add_argument('--after-ref', default='d8d2a4f2ddf135d638de19a90cfd071816558f3b')
    parser.add_argument('--variant-order', choices=('before-after', 'after-before'), default='before-after')
    parser.add_argument('--served-candidate', action='store_true', help='Measure the candidate frontend without any app.js override; refs are unused')
    parser.add_argument('--browser-executable', type=Path)
    parser.add_argument('--timeout', type=float, default=120)
    run(parser.parse_args())
