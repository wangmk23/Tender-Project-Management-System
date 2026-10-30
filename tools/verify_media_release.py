"""Hash-pinned Windows EXE media acceptance using owned synthetic data only.

No source HTTP server, public-network requests, production fixtures, or existing
application process is used. The baseline seeds an encrypted PDF; the candidate
upgrades that isolated profile and receives real multipart WAV/AVI uploads.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.parse import urljoin, urlsplit
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Report:
    def __init__(self, emit=False):
        self.checks = []
        self.metadata = {}
        self.emit = emit

    def check(self, name, action):
        started = time.monotonic()
        row = {'name': name, 'passed': False}
        self.checks.append(row)
        try:
            result = action()
            row['passed'] = True
            if result is not None:
                row['details'] = result
            return result
        except Exception as error:
            row['error'] = f'{type(error).__name__}: {error}'
            raise
        finally:
            row['seconds'] = round(time.monotonic() - started, 3)
            if self.emit:
                print(json.dumps({key: row[key] for key in ('name', 'passed', 'seconds')}, ensure_ascii=False), flush=True)

    def result(self):
        failed = sum(not row['passed'] for row in self.checks)
        return {**self.metadata, 'passed': bool(self.checks) and not failed and not self.metadata.get('error'),
                'total': len(self.checks), 'failed': failed, 'checks': self.checks,
                'synthetic_data_only': True, 'production_data_accessed': False,
                'native_desktop_verified': False, 'actual_phone_verified': False,
                'external_web_verified': False, 'real_mail_sent': 0,
                'scope': 'Local hash-pinned EXE HTTP and local headless Chromium, 390/1440 CSS-pixel viewports; not native desktop, actual phone, or external-network acceptance.'}


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate', 'baseline', 'evidence', 'engine-directory'):
        result.add_argument('--' + name, type=Path, required=True)
    for name in ('candidate-sha256', 'baseline-sha256'):
        result.add_argument('--' + name, required=True)
    result.add_argument('--browser-executable', type=Path)
    result.add_argument('--timeout', type=float, default=180)
    return result


def media_url(base, aid, value):
    if not isinstance(value, str):
        raise ValueError('Media URL must be text')
    url = urljoin(base, value)
    parsed, origin = urlsplit(url), urlsplit(base)
    if (parsed.scheme, parsed.hostname, parsed.port) != (origin.scheme, origin.hostname, origin.port) or parsed.username or parsed.password:
        raise ValueError('Media URL leaves owned loopback runtime')
    if not parsed.path.startswith(f'/api/attachments/{aid}/media/') or any(part in ('.', '..') for part in parsed.path.split('/')) or '%' in parsed.path or parsed.fragment:
        raise ValueError('Media URL leaves attachment media scope')
    return url


def hls_members(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or lines[0] != '#EXTM3U' or '#EXT-X-ENDLIST' not in lines:
        raise ValueError('HLS playlist is incomplete')
    if any('URI=' in line for line in lines):
        raise ValueError('Unexpected HLS external/key URI')
    members = [line for line in lines if not line.startswith('#')]
    if not members or len(members) != len(set(members)) or any(not re.fullmatch(r'\d{6}\.ts', name) for name in members):
        raise ValueError('HLS segments must be unique six-digit local names')
    return members


def validate_engine(directory):
    directory = Path(directory).resolve(strict=True)
    manifest = json.loads((directory / 'engine-manifest.json').read_text('utf-8-sig'))
    result = {'directory': str(directory), 'files': {}}
    for name in ('ffmpeg.exe', 'ffprobe.exe'):
        target = directory / name
        expected = manifest.get('files', {}).get(name)
        if isinstance(expected, dict):
            expected = expected.get('sha256')
        if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', expected) or target.is_symlink():
            raise ValueError('Missing valid media engine manifest: ' + name)
        actual = sha256(target)
        require(actual == expected.lower(), 'Media engine hash mismatch: ' + name)
        result['files'][name] = actual
    return result


def make_fixtures(directory, seconds=12):
    """Real PCM WAV and uncompressed RGB AVI, generated without lavfi/devices."""
    directory.mkdir(parents=True, exist_ok=True)
    audio = directory / 'synthetic-tone.wav'
    with wave.open(str(audio), 'wb') as output:
        output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', int(6500 * math.sin(2 * math.pi * 440 * n / 16000))) for n in range(16000 * seconds)))
    def chunk(kind, value):
        return kind + struct.pack('<I', len(value)) + value + (b'\0' if len(value) % 2 else b'')
    width, height, fps = 160, 90, 10
    count, frame_size = seconds * fps, width * height * 3
    avih = struct.pack('<14I', 1000000 // fps, frame_size * fps, 0, 16, count, 0, 1, frame_size, width, height, 0, 0, 0, 0)
    strh = struct.pack('<4s4sIHHIIIIIIIIhhhh', b'vids', b'DIB ', 0, 0, 0, 0, 1, fps, 0, count, frame_size, 0xffffffff, 0, 0, 0, width, height)
    strf = struct.pack('<IiiHHIIiiII', 40, width, height, 1, 24, 0, frame_size, 0, 0, 0, 0)
    hdrl = chunk(b'LIST', b'hdrl' + chunk(b'avih', avih) + chunk(b'LIST', b'strl' + chunk(b'strh', strh) + chunk(b'strf', strf)))
    frames, index, offset = [], [], 4
    for number in range(count):
        frame = bytes(value for y in range(height) for x in range(width) for value in ((x + number * 7) % 256, (y * 2 + number * 3) % 256, (x + y + number * 11) % 256))
        item = chunk(b'00db', frame)
        frames.append(item)
        index.append(struct.pack('<4sIII', b'00db', 16, offset, len(frame)))
        offset += len(item)
    video = directory / 'synthetic-motion.avi'
    video.write_bytes(chunk(b'RIFF', b'AVI ' + hdrl + chunk(b'LIST', b'movi' + b''.join(frames)) + chunk(b'idx1', b''.join(index))))
    return audio, video


def probe(engine, path):
    args = [str(engine / 'ffprobe.exe'), '-v', 'error', '-protocol_whitelist', 'file,pipe',
            '-show_entries', 'format=duration,format_name:stream=codec_name,codec_type,width,height', '-of', 'json', str(path)]
    result = subprocess.run(args, capture_output=True, timeout=30,
                            **({'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}))
    require(result.returncode == 0, 'Local ffprobe failed: ' + result.stderr.decode('utf-8', errors='replace')[:1000])
    return json.loads(result.stdout)


def wait_ready(client, aid, profile, timeout=180):
    deadline, states = time.monotonic() + timeout, []
    while time.monotonic() < deadline:
        response = client.session.get(client.base_url + f'/api/attachments/{aid}/media', params={'profile': profile, 'retry': 0}, timeout=20)
        response.raise_for_status()
        data = response.json()
        state = data.get('status')
        require(state in ('queued', 'preparing', 'ready', 'error'), 'Unknown media state: ' + repr(data))
        if not states or states[-1] != state:
            states.append(state)
        if state == 'error':
            raise AssertionError(data.get('message') or 'Media preparation failed')
        if state == 'ready':
            media_url(client.base_url, aid, data.get('url'))
            return {**data, 'observed_states': states}
        time.sleep(.2)
    raise TimeoutError(f'{profile} media preparation timed out; states={states}')


def upload(client, pid, path):
    before = {item.resolve() for item in client.data_root.rglob('*') if item.is_file()}
    with path.open('rb') as source:
        response = client.session.post(client.base_url + f'/api/projects/{pid}/attachments',
            files={'files': (path.name, source, 'application/octet-stream')}, headers={'X-CSRFToken': client.csrf_token}, timeout=40)
    require(response.status_code == 200, f'Actual multipart upload rejected {path.name}: HTTP {response.status_code} {response.text[:500]}')
    rows = client.request('GET', f'/api/projects/{pid}/attachments')
    row = next((row for row in rows if row['filename'] == path.name), None)
    require(row is not None, 'Uploaded attachment absent from actual EXE API')
    # The candidate owns this fresh profile. A new non-database blob is the real
    # encrypted upload; neither plaintext fixture nor derivative is written here.
    new = [item for item in client.data_root.rglob('*') if item.is_file() and item.resolve() not in before
           and item.suffix.lower() not in ('.db', '.log', '.json', '.pem') and 'backup' not in str(item.relative_to(client.data_root)).lower()]
    require(len(new) == 1, 'Expected exactly one new encrypted attachment file: ' + repr([str(p.relative_to(client.data_root)) for p in new]))
    stored = new[0]
    require(stored.read_bytes() != path.read_bytes(), 'Upload was stored in plaintext')
    require(stored.stat().st_size > path.stat().st_size, 'Encrypted attachment has no encryption overhead')
    return {'id': row['id'], 'filename': path.name, 'sha256': sha256(path),
            'stored_relative_path': str(stored.relative_to(client.data_root)), 'stored_sha256': sha256(stored)}


def seed_project(client):
    catalog = client.request('GET', '/api/procurement-methods')
    method = next(row for row in catalog['methods'] if row['name'] == '公开招标' and row['regime'] == 'government_procurement')
    created = client.request('POST', '/api/projects', {'number': 'MEDIA-UPGRADE', 'name': '隔离合成媒体验收',
                             'procurement_method_id': method['id'], 'year': 2026})
    return {'id': created['id']}


def download_matches(client, aid, original):
    response = client.session.get(client.base_url + f'/api/attachments/{aid}/download', timeout=30)
    require(response.status_code == 200 and response.content == original.read_bytes(), 'Original download bytes changed')
    return {'sha256': hashlib.sha256(response.content).hexdigest(), 'bytes': len(response.content)}


def range_checks(client, aid, metadata, original):
    url, expected = media_url(client.base_url, aid, metadata['url']), original.read_bytes()
    response = client.session.get(url, timeout=30)
    require(response.status_code == 200 and response.content == expected, 'Original media stream differs from uploaded bytes')
    head = client.session.head(url, timeout=20)
    require(head.status_code == 200 and not head.content and int(head.headers.get('Content-Length', -1)) == len(expected), 'HEAD length/body mismatch')
    for header, part, span in [('bytes=0-31', expected[:32], f'bytes 0-31/{len(expected)}'),
                               ('bytes=-16', expected[-16:], f'bytes {len(expected)-16}-{len(expected)-1}/{len(expected)}')]:
        partial = client.session.get(url, headers={'Range': header}, timeout=20)
        require(partial.status_code == 206 and partial.content == part and partial.headers.get('Content-Range') == span, 'Range response mismatch: ' + header)
    invalid = client.session.get(url, headers={'Range': f'bytes={len(expected)+5}-'}, timeout=20)
    require(invalid.status_code == 416 and invalid.headers.get('Content-Range') == f'bytes */{len(expected)}', 'Out-of-range request must return 416')
    require(response.headers.get('Cache-Control') == 'private, no-store', 'Media response must not be publicly cached')
    return {'bytes': len(expected), 'range_status': 206, 'head_status': 200, 'unsatisfiable_status': 416}


def auth_checks(client, aid, metadata):
    import requests
    paths = [f'/api/attachments/{aid}/media', f'/api/attachments/{aid}/media/stream?profile=original', metadata['url']]
    if metadata['url'].endswith('index.m3u8'):
        paths.append(metadata['url'].replace('index.m3u8', '000000.ts'))
    with requests.Session() as anonymous:
        anonymous.trust_env = False
        result = []
        for path in paths:
            response = anonymous.get(media_url(client.base_url, aid, path) if '/media/' in path else client.base_url + path,
                                     allow_redirects=False, timeout=20)
            require(response.status_code in (302, 303, 401, 403), 'Unauthenticated media access succeeded: ' + path)
            if response.status_code in (302, 303):
                require(urlsplit(response.headers.get('Location', '')).path == '/login', 'Authentication redirected outside login')
            result.append({'path': path, 'status': response.status_code})
    return result


def compatible_checks(client, aid, metadata, engine, directory, timeout):
    directory.mkdir()
    url = media_url(client.base_url, aid, metadata['url'])
    if metadata['kind'] == 'audio':
        response = client.session.get(url, timeout=30)
        require(response.status_code == 200 and response.content, 'Compatible audio is unavailable')
        target = directory / 'audio.m4a'
        target.write_bytes(response.content)
        members = []
    else:
        deadline = time.monotonic() + timeout
        while True:
            response = client.session.get(url, timeout=20)
            require(response.status_code == 200, 'HLS playlist unavailable')
            if '#EXT-X-ENDLIST' in response.text:
                break
            require(time.monotonic() < deadline, 'HLS conversion did not complete')
            time.sleep(.2)
        members = hls_members(response.text)
        target = directory / 'index.m3u8'
        target.write_text(response.text, encoding='utf-8')
        for name in members:
            segment = client.session.get(media_url(client.base_url, aid, urljoin(url, name)), timeout=20)
            require(segment.status_code == 200 and segment.content, 'HLS segment unavailable: ' + name)
            (directory / name).write_bytes(segment.content)
    description = probe(engine, target)
    codecs = {row['codec_type']: row['codec_name'] for row in description['streams']}
    require(codecs.get('audio') == 'aac' if metadata['kind'] == 'audio' else codecs.get('video') == 'h264', 'Unexpected compatible codecs: ' + repr(codecs))
    require(float(description['format']['duration']) >= 10, 'Compatible stream duration was truncated')
    decoded = subprocess.run([str(engine / 'ffmpeg.exe'), '-hide_banner', '-nostdin', '-v', 'error',
                              '-protocol_whitelist', 'file,pipe', '-i', str(target), '-f', 'null', '-'],
                             capture_output=True, timeout=60,
                             **({'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}))
    require(decoded.returncode == 0 and not decoded.stderr.strip(),
            'Compatible stream failed full local decode: ' + decoded.stderr.decode('utf-8', errors='replace')[:1000])
    return {'probe': description, 'segments': members, 'full_decode_passed': True}


def browser_checks(client, pid, attachments, evidence, executable):
    from playwright.sync_api import sync_playwright
    from tools.release_browser import launch_browser
    results, external, errors, assets = [], [], [], set()
    with sync_playwright() as playwright:
        browser, browser_info = launch_browser(playwright, executable, args=['--autoplay-policy=no-user-gesture-required'])
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 950}, reduced_motion='reduce')
            context.add_cookies([{'name': cookie.name, 'value': cookie.value, 'url': client.base_url} for cookie in client.session.cookies])
            def owned_route(route):
                url = route.request.url
                parsed = urlsplit(url)
                if parsed.scheme in ('http', 'https') and (parsed.scheme, parsed.netloc) != (urlsplit(client.base_url).scheme, urlsplit(client.base_url).netloc):
                    external.append(url)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', owned_route)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('response', lambda response: assets.add(urlsplit(response.url).path) if '/static/libs/videojs/10.2.0/' in response.url and response.status == 200 else None)
            page.goto(client.base_url, wait_until='networkidle')
            page.evaluate('(id) => selectProject(id)', pid)
            page.wait_for_function('(id) => Number(currentProject?.id) === id', arg=pid)
            for width in (1440, 390):
                page.set_viewport_size({'width': width, 'height': 950})
                for kind, row in attachments:
                    page.evaluate('(id) => viewAttachment(id)', row['id'])
                    page.wait_for_function('() => !!_previewState.media?.element', timeout=120000)
                    if kind == 'audio':
                        page.evaluate("() => requestMediaPreview(_previewState.media, 'compatible')")
                    page.wait_for_function("() => _previewState.media?.profile === 'compatible' && !!_previewState.media?.element", timeout=120000)
                    page.wait_for_function('() => _previewState.media.element.readyState >= 2 && _previewState.media.element.duration >= 10', timeout=120000)
                    played = page.evaluate('''async () => {
                        const element = _previewState.media.element;
                        element.muted = true;
                        await element.play();
                        return {paused:element.paused, currentTime:element.currentTime, duration:element.duration, tag:element.localName};
                    }''')
                    require(played['paused'] is False, 'Actual browser playback did not start')
                    start = played['currentTime']
                    page.wait_for_function('(start) => _previewState.media.element.currentTime > start + .2', arg=start, timeout=15000)
                    page.evaluate('() => _previewState.media.element.pause()')
                    require(page.evaluate('() => _previewState.media.element.paused'), 'Browser pause failed')
                    page.evaluate('() => { _previewState.media.element.currentTime = 6; }')
                    page.wait_for_function('() => Math.abs(_previewState.media.element.currentTime - 6) < .75 && !_previewState.media.element.seeking', timeout=20000)
                    screenshot = f'media-{kind}-{width}.png'
                    page.screenshot(path=str(evidence / screenshot))
                    for selector in ('#docPreviewOverlay', '#mediaViewerContainer .media-preview-stage'):
                        bounds = page.locator(selector).bounding_box()
                        require(bounds and bounds['x'] >= -1 and bounds['x'] + bounds['width'] <= width + 1,
                                'Media preview overflows viewport: ' + selector)
                    page.evaluate('closeDocPreview()')
                    require(page.locator('#docPreviewOverlay.open').count() == 0, 'Media dialog close failed')
                    results.append({'kind': kind, 'width': width, 'playing': played, 'pause': True, 'seek_seconds': 6, 'screenshot': screenshot})
            require(not external, 'Browser attempted external network: ' + repr(external))
            require(not errors, 'Browser JavaScript errors: ' + repr(errors))
            require(any(path.endswith('/video.js') for path in assets) and any(path.endswith('/audio.js') for path in assets)
                    and any(path.endswith('/media/hlsjs-video.js') for path in assets), 'Self-hosted Video.js 10.2.0 modules were not served')
            return {'browser': browser_info, 'viewports': results, 'self_hosted_modules': sorted(assets), 'page_errors': errors, 'external_requests': external}
        finally:
            browser.close()


def run(args):
    from tools.release_browser import require_windows_candidate
    from tools.verify_packaged_browser_acceptance import owned_client
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    report = Report(emit=True)
    report.metadata.update(candidate=str(args.candidate.resolve()), baseline=str(args.baseline.resolve()),
                           candidate_sha256=args.candidate_sha256, baseline_sha256=args.baseline_sha256)
    try:
        report.check('candidate EXE hash and Windows platform', lambda: require_windows_candidate(args.candidate, args.candidate_sha256))
        report.check('baseline EXE hash and Windows platform', lambda: require_windows_candidate(args.baseline, args.baseline_sha256))
        engine = args.engine_directory.resolve()
        report.check('fixture verification engine pinned by manifest', lambda: validate_engine(engine))
        require(args.timeout > 0, '--timeout must be positive')
        with tempfile.TemporaryDirectory(prefix='pm-media-exe-', ignore_cleanup_errors=True) as temp:
            root = Path(temp)
            fixtures = root / 'fixtures'
            audio, video = make_fixtures(fixtures)
            report.check('real WAV and AVI source fixtures probe', lambda: {path.name: probe(engine, path) for path in (audio, video)})
            legacy = fixtures / 'baseline-synthetic.pdf'
            legacy.write_bytes(b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
            profile = root / 'upgrade-profile'
            with owned_client(args.baseline.resolve(), root, 'baseline', retained_profile=profile) as baseline:
                report.check('baseline actual EXE startup and synthetic license', baseline.start)
                synthetic_password = baseline.password
                project = report.check('baseline creates actual synthetic project with explicit procurement method', lambda: seed_project(baseline))
                pid = project['id']
                old = report.check('baseline real encrypted PDF upload', lambda: upload(baseline, pid, legacy))
                report.check('baseline original PDF download SHA256', lambda: download_matches(baseline, old['id'], legacy))
            with owned_client(args.candidate.resolve(), root, 'candidate', retained_profile=profile) as client:
                # A migrated database keeps its existing admin password. The
                # per-label bootstrap environment only initializes fresh users.
                client.password = synthetic_password
                report.check('candidate actual EXE upgrades baseline synthetic profile', client.start)
                report.check('upgraded baseline encrypted PDF remains identical', lambda: download_matches(client, old['id'], legacy))
                attachments = []
                for kind, path in (('audio', audio), ('video', video)):
                    row = report.check(kind + ' real encrypted multipart upload', lambda path=path: upload(client, pid, path))
                    attachments.append((kind, row))
                initial_projects = client.request('GET', '/api/projects')
                initial_attachments = client.request('GET', f'/api/projects/{pid}/attachments')
                for (kind, row), path in zip(attachments, (audio, video)):
                    aid = row['id']
                    original = report.check(kind + ' actual original media probe', lambda aid=aid: wait_ready(client, aid, 'original', args.timeout))
                    require(original.get('kind') == kind and original.get('duration', 0) >= 10, 'Original media metadata mismatch')
                    report.check(kind + ' original bytes Range 206 HEAD and 416', lambda: range_checks(client, aid, original, path))
                    compatible = report.check(kind + ' actual compatible preparation', lambda: wait_ready(client, aid, 'compatible', args.timeout))
                    report.check(kind + ' authenticated-only metadata and streams', lambda: auth_checks(client, aid, compatible))
                    report.check(kind + ' AAC/H264 derivative and every HLS member', lambda: compatible_checks(client, aid, compatible, engine, root / ('derived-' + kind), args.timeout))
                    for profile_name in ('original', 'compatible'):
                        for _ in range(3):
                            wait_ready(client, aid, profile_name, args.timeout)
                        retried = client.request('GET', f'/api/attachments/{aid}/media?profile={profile_name}&retry=1')
                        require(retried.get('status') == 'ready', 'Retry of an existing ready derivative requeued preparation')
                    report.check(kind + ' original download remains byte-identical', lambda: download_matches(client, aid, path))
                report.check('actual self-hosted Video.js browser play pause seek close and layouts',
                             lambda: browser_checks(client, pid, attachments, evidence, args.browser_executable))
                def unchanged():
                    current_projects = client.request('GET', '/api/projects')
                    current_attachments = client.request('GET', f'/api/projects/{pid}/attachments')
                    require(current_projects == initial_projects, 'Project API changed during media preparation/playback')
                    require(current_attachments == initial_attachments, 'Media preparation created/changed an attachment')
                    for row in [old, *[item for _, item in attachments]]:
                        require(sha256(client.data_root / row['stored_relative_path']) == row['stored_sha256'], 'Stored encrypted original bytes changed')
                    return {'projects_api_unchanged': True, 'attachment_count': len(current_attachments), 'encrypted_originals_sha256_unchanged': True}
                report.check('repeated prepare and browser playback preserve projects attachments and encrypted originals', unchanged)
    except Exception as error:
        report.metadata['error'] = f'{type(error).__name__}: {error}'
        report.metadata['traceback'] = traceback.format_exc()
        if all(row['passed'] for row in report.checks):
            report.checks.append({'name': 'acceptance interrupted', 'passed': False, 'error': report.metadata['error']})
    result = report.result()
    (evidence / 'media-exe-acceptance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    outcome = run(parser().parse_args())
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    raise SystemExit(0 if outcome['passed'] else 1)
