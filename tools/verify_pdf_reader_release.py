"""Hash-pinned PDF reader acceptance against an owned Windows EXE profile.

Real multipart uploads, encrypted originals, authenticated PDF downloads and the
candidate's served PDF.js viewer are exercised. Native print is stubbed before
PDF.js imports it: this proves preparation, never physical printer output.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import tempfile
import traceback
from urllib.parse import urljoin, urlsplit
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.verify_media_release import Report as BaseReport, download_matches, require, sha256, upload

REQUIRED_CHECKS = frozenset(('candidate', 'fixtures', 'startup', 'http framing', 'project',
                            'short upload', 'long upload', 'scan upload',
                            'autoprint upload', 'autoprint original',
                            'short original', 'long original', 'scan original',
                            'anonymous denied', 'browser', 'unchanged'))
PDFJS_BASE = '/static/libs/pdfjs-reader/6.4.299/'


class Report(BaseReport):
    def result(self):
        missing = sorted(REQUIRED_CHECKS - {row['name'] for row in self.checks if row['passed']})
        failed = sum(not row['passed'] for row in self.checks)
        return {**self.metadata, 'passed': not missing and not failed and not self.metadata.get('error'),
                'total': len(self.checks), 'failed': failed, 'missing_required_checks': missing,
                'checks': self.checks, 'synthetic_data_only': True,
                'production_data_accessed': False, 'native_desktop_verified': False,
                'actual_phone_verified': False, 'external_web_verified': False,
                'physical_print_verified': False, 'real_mail_sent': 0,
                'scope': 'Owned hash-pinned EXE HTTP and headless Chromium; 1440/390 CSS-pixel viewports, four themes. Print stub verifies complete internal preparation only. No physical phone, native desktop, printer or OCR acceptance.'}


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--candidate', type=Path, required=True)
    result.add_argument('--candidate-sha256', required=True)
    result.add_argument('--evidence', type=Path, required=True)
    result.add_argument('--browser-executable', type=Path)
    return result


def validate_candidate(path, digest):
    if not isinstance(digest, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
        raise ValueError('--candidate-sha256 must contain exactly 64 hexadecimal digits')
    from tools.release_browser import require_windows_candidate
    return require_windows_candidate(Path(path), digest)


def attachment_url(base, aid, value):
    if not isinstance(value, str):
        raise ValueError('PDF URL must be text')
    url = urljoin(base, value)
    parsed, origin = urlsplit(url), urlsplit(base)
    if ((parsed.scheme, parsed.hostname, parsed.port) != (origin.scheme, origin.hostname, origin.port)
            or parsed.username or parsed.password or parsed.fragment
            or not re.fullmatch(r'/api/attachments/' + str(int(aid)) + r'/(view|download)', parsed.path)):
        raise ValueError('PDF URL leaves this attachment and owned runtime')
    return url


def _pdf(objects):
    body, offsets = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'), [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(body))
        body.extend(f'{number} 0 obj\n'.encode() + value + b'\nendobj\n')
    start = len(body)
    body.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        body.extend(f'{offset:010d} 00000 n \n'.encode())
    body.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
    return bytes(body)


def text_pdf(pages, auto_print=False):
    """Real Type1 text, nested native outline and a local destination annotation."""
    objects = [b'<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>', b'',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'', b'', b'', b'', b'']
    if auto_print:
        objects[0] = b'<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /OpenAction << /S /Named /N /Print >> >>'
    children = []
    for number in range(1, pages + 1):
        text = (f'BT /F1 18 Tf 40 740 Td (ProjectNeedle synthetic page {number}) Tj '
                f'0 -36 Td (Page {number} of {pages} - owned PDF acceptance fixture) Tj '
                '0 -36 Td (Jump to the final section using the link below.) Tj ET').encode()
        objects.append(f'<< /Length {len(text)} >>\nstream\n'.encode() + text + b'\nendstream')
        content = len(objects)
        annotation = ' /Annots [8 0 R]' if number == 1 else ''
        objects.append((f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
                        f'/Resources << /Font << /F1 3 0 R >> >> /Contents {content} 0 R{annotation} >>').encode())
        children.append(len(objects))
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(f"{n} 0 R" for n in children)}] /Count {pages} >>'.encode()
    objects[3] = b'<< /Type /Outlines /First 5 0 R /Last 5 0 R /Count 3 >>'
    objects[4] = b'<< /Title (Chapters) /Parent 4 0 R /First 6 0 R /Last 7 0 R /Count 2 >>'
    objects[5] = f'<< /Title (Opening section) /Parent 5 0 R /Next 7 0 R /Dest [{children[0]} 0 R /Fit] >>'.encode()
    objects[6] = f'<< /Title (Final section) /Parent 5 0 R /Prev 6 0 R /Dest [{children[-1]} 0 R /Fit] >>'.encode()
    objects[7] = (f'<< /Type /Annot /Subtype /Link /Rect [40 640 480 682] /Border [0 0 1] '
                  f'/Dest [{children[-1]} 0 R /Fit] >>').encode()
    return _pdf(objects)


def scan_pdf():
    """A small raster-only page. Deliberately contains no text objects or outline."""
    width, height = 240, 120
    pixels = bytearray([255] * (width * height))
    glyphs = {'S': ['11111', '10000', '10000', '11111', '00001', '00001', '11111'],
              'C': ['11111', '10000', '10000', '10000', '10000', '10000', '11111'],
              'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
              'N': ['10001', '11001', '11001', '10101', '10011', '10011', '10001']}
    for index, char in enumerate('SCAN'):
        for y, line in enumerate(glyphs[char]):
            for x, value in enumerate(line):
                if value == '1':
                    for dy in range(4):
                        for dx in range(4):
                            pixels[(40 + y * 4 + dy) * width + 24 + index * 48 + x * 4 + dx] = 30
    image = zlib.compress(bytes(pixels))
    command = b'q 480 0 0 240 40 520 cm /Scan Do Q'
    return _pdf([b'<< /Type /Catalog /Pages 2 0 R >>',
                 b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                 b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>',
                 f'<< /Length {len(command)} >>\nstream\n'.encode() + command + b'\nendstream',
                 (f'<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceGray '
                  f'/BitsPerComponent 8 /Filter /FlateDecode /Length {len(image)} >>\nstream\n').encode() + image + b'\nendstream'])


def make_fixtures(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    result = {}
    for name, data in (('short', text_pdf(3)), ('long', text_pdf(269)),
                       ('scan', scan_pdf()), ('autoprint', text_pdf(3, auto_print=True))):
        result[name] = directory / ('synthetic-' + name + '.pdf')
        result[name].write_bytes(data)
    return result


def seed_project(client, number='PDF-READER'):
    catalog = client.request('GET', '/api/procurement-methods')
    method = next((row for row in catalog['methods'] if row.get('enabled') and row.get('user_owned')), None)
    require(method is not None, 'Owned candidate has no enabled procurement method')
    row = client.request('POST', '/api/projects', {'number': number, 'name': '隔离合成PDF验收-' + number,
                         'procurement_method_id': method['id'], 'year': 2026})
    return {'id': row['id']}


def anonymous_checks(client, attachments):
    import requests
    result = []
    with requests.Session() as anonymous:
        anonymous.trust_env = False
        for row in attachments.values():
            for endpoint in ('view', 'download'):
                path = f'/api/attachments/{row["id"]}/{endpoint}'
                response = anonymous.get(attachment_url(client.base_url, row['id'], path), allow_redirects=False, timeout=20)
                require(response.status_code in (302, 303, 401, 403), 'Anonymous PDF access succeeded: ' + path)
                if response.status_code in (302, 303):
                    require(urlsplit(response.headers.get('Location', '')).path == '/login', 'Anonymous PDF redirected outside login')
                result.append({'path': path, 'status': response.status_code})
    return result


def http_reader_checks(client):
    """Exercise the candidate HTTP stack before allocating the browser.

    Conditional/static policies must remain the same as the original 200: a
    conflicting 304 can otherwise replace a correct cached framing policy.
    """
    shell_path = '/static/pdf-reader/index.html'

    def read(path, headers=None):
        response = client.session.get(client.base_url + path, headers=headers or {},
                                      allow_redirects=False, timeout=20)
        try:
            body = response.content  # Drain before closing/releasing the response.
            raw_headers = getattr(getattr(response, 'raw', None), 'headers', None)
            getlist = getattr(raw_headers, 'getlist', None) or getattr(response.headers, 'getlist', None)
            csp = list(getlist('Content-Security-Policy')) if getlist else [response.headers.get('Content-Security-Policy', '')]
            return dict(status=response.status_code, bytes=len(body),
                        content_type=response.headers.get('Content-Type', ''),
                        x_frame_options=response.headers.get('X-Frame-Options', ''),
                        content_security_policy=csp, etag=response.headers.get('ETag', ''),
                        content_range=response.headers.get('Content-Range', '')), body
        finally:
            response.close()

    def same_origin(row, name):
        require(row['x_frame_options'].strip().upper() == 'SAMEORIGIN', name + ' must use X-Frame-Options SAMEORIGIN')
        found = False
        # requests can combine duplicate CSP fields with commas; raw urllib3
        # headers preserve their list. Each enforced framing directive matters.
        for value in row['content_security_policy']:
            for policy in value.split(','):
                for directive in policy.split(';'):
                    tokens = directive.split()
                    if tokens and tokens[0].lower() == 'frame-ancestors':
                        found = True
                        require(tokens[1:] == ["'self'"], name + " frame-ancestors must allow only 'self'")
        require(found, name + " lacks enforced CSP frame-ancestors 'self'")

    shell, body = read(shell_path)
    require(shell['status'] == 200 and len(body) >= 16, 'Reader shell must return HTTP 200 and actual HTML')
    require(shell['content_type'].split(';')[0].strip().lower() == 'text/html', 'Reader shell MIME is not text/html')
    same_origin(shell, 'HTTP 200 shell')
    require(bool(shell['etag'].strip()), 'Reader shell lacks ETag for actual HTTP 304 verification')
    cached, cached_body = read(shell_path, {'If-None-Match': shell['etag']})
    require(cached['status'] == 304 and cached_body == b'', 'Conditional reader request must return HTTP 304 without a body')
    same_origin(cached, 'HTTP 304 shell')
    partial, partial_body = read(shell_path, {'Range': 'bytes=0-15'})
    require(partial['status'] == 206, 'Range reader request must return HTTP 206')
    require(partial['content_range'] == f'bytes 0-15/{len(body)}' and partial_body == body[:16], 'HTTP 206 reader body or Content-Range differs from the original')
    same_origin(partial, 'HTTP 206 shell')
    login, _ = read('/login')
    require(login['status'] == 200, 'Login preflight must return HTTP 200 without redirect')
    require(login['x_frame_options'].strip().upper() == 'DENY', 'Login must retain X-Frame-Options DENY')
    locale, locale_body = read(PDFJS_BASE + 'web/locale/locale.json')
    require(locale['status'] == 200, 'Reader locale catalog must return HTTP 200, not silently fall back to English')
    try:
        mapping = json.loads(locale_body)
    except (ValueError, UnicodeError) as error:
        raise AssertionError('Reader locale catalog is not valid JSON') from error
    require(isinstance(mapping, dict) and mapping.get('zh-cn') == 'zh-CN/viewer.ftl', 'Reader locale catalog lacks the pinned Chinese translation mapping')
    translation, translation_body = read(PDFJS_BASE + 'web/locale/zh-CN/viewer.ftl')
    require(translation['status'] == 200, 'Chinese reader translation must return HTTP 200')
    translated = translation_body.decode('utf-8')
    for key, label in (('previous', '上一页'), ('next', '下一页'), ('print', '打印')):
        require(f'pdfjs-{key}-button-label = {label}' in translated, 'Reader Chinese translation lacks the ' + key + ' label')
    return dict(shell=shell, conditional=cached, range=partial, login=login,
                locale=locale, chinese_translation=translation)


# The generic viewer captures window.print at module import time and later calls
# that captured function only after renderPages resolves. Install this through
# context.add_init_script, before any first-party/bootstrap/vendor script loads.
PRINT_STUB = r'''(() => {
    window.__pmPdfPrint = {calls:0, snapshots:[]};
    window.print = function () {
        const state = window.__pmPdfPrint;
        state.calls++;
        state.snapshots.push({calls:state.calls, images:Array.from(document.querySelectorAll('#printContainer .printedPage img'), image => image.complete && image.naturalWidth > 0)});
    };
})();'''


OPEN_ACTION_SCRIPT = '''async () => {
    const value = await PDFViewerApplication.pdfDocument.getOpenAction();
    return value instanceof Map ? Object.fromEntries(value) : value;
}'''


def validate_print_snapshot(snapshot, pages):
    require(snapshot.get('calls', 0) > 0, 'Native print stub was not reached after PDF preparation')
    images = snapshot.get('images', [])
    require(len(images) == pages and all(value is True for value in images), 'PDF print preparation did not render every page')
    return {'native_stub_calls': snapshot['calls'], 'rendered_pages': len(images),
            'physical_print_verified': False, 'scope': 'PDF.js internal image preparation before intercepted native print'}


def reader_frame(page, aid, pages):
    page.evaluate('(id) => viewAttachment(id)', aid)
    element = page.locator('#pdfReaderFrame')
    element.wait_for(state='visible', timeout=60000)
    frame = element.element_handle().content_frame()
    require(frame is not None, 'Same-origin PDF iframe did not attach')
    frame.wait_for_function('(pages) => window.PDFViewerApplication?.pagesCount === pages && !!document.querySelector(".page canvas")', arg=pages, timeout=90000)
    parsed = urlsplit(frame.url)
    require(parsed.path == '/static/pdf-reader/index.html', 'Candidate served unexpected PDF reader shell')
    require(parsed.netloc == urlsplit(page.url).netloc, 'PDF iframe left owned origin')
    return frame


def goto_page(frame, number):
    frame.locator('#pageNumber').fill(str(number))
    frame.locator('#pageNumber').press('Enter')
    frame.wait_for_function('(number) => PDFViewerApplication.page === number && !!document.querySelector(`.page[data-page-number="${number}"] canvas`)', arg=number, timeout=60000)
    require(frame.locator('#pageNumber').input_value() == str(number), 'Visible current page does not match navigation')


def search_checks(frame, pages):
    goto_page(frame, 1)
    frame.locator('#pageNumber').press('Control+f')
    frame.locator('#findInput').wait_for(state='visible')
    frame.locator('#findInput').fill('ProjectNeedle')
    frame.wait_for_function('(pages) => PDFViewerApplication.findController.pageMatches.reduce((sum, matches) => sum + matches.length, 0) === pages', arg=pages, timeout=120000)
    frame.wait_for_function('() => !!document.querySelector(".textLayer .highlight.selected")', timeout=30000)
    frame.wait_for_function('() => !!document.querySelector("#findResultsCount")?.textContent.trim()', timeout=30000)
    count = frame.locator('#findResultsCount').inner_text()
    require(str(pages) in count and frame.locator('#findResultsCount').is_visible(), 'Visible search result count is absent: ' + count)
    before = frame.evaluate('PDFViewerApplication.page')
    frame.locator('#findNextButton').click()
    frame.wait_for_function('(before) => PDFViewerApplication.page !== before && !!document.querySelector(".textLayer .highlight.selected")', arg=before, timeout=30000)
    after = frame.evaluate('PDFViewerApplication.page')
    frame.locator('#findPreviousButton').click()
    frame.wait_for_function('(before) => PDFViewerApplication.page === before && !!document.querySelector(".textLayer .highlight.selected")', arg=before, timeout=30000)
    return {'matches': pages, 'visible_count': count, 'ctrl_f': True, 'next_page': after,
            'previous_page': before, 'selected_highlight': True}


def outline_checks(frame, pages):
    frame.evaluate('PDFViewerApplication.viewsManager.switchView(2, true)')
    frame.locator('#outlinesView .treeItem a').filter(has_text='Final section').click()
    frame.wait_for_function('(pages) => PDFViewerApplication.page === pages', arg=pages, timeout=30000)
    require(frame.locator('#outlinesView .treeItem').count() == 3, 'Nested source PDF bookmark tree was not rendered')
    require(frame.locator('#outlinesView .treeItem .treeItem').count() >= 2, 'Source native outline hierarchy was flattened')
    frame.evaluate('PDFViewerApplication.viewsManager.close()')
    goto_page(frame, 1)
    frame.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation[data-internal-link] a').first.click()
    frame.wait_for_function('(pages) => PDFViewerApplication.page === pages', arg=pages, timeout=30000)
    return {'native_outline_items': 3, 'nested_children': 2, 'bookmark_destination': pages,
            'internal_pdf_link_destination': pages}


def browser_checks(client, pid, other_pid, attachments, evidence, executable):
    from playwright.sync_api import sync_playwright
    from tools.release_browser import launch_browser
    external, errors, assets = [], [], set()
    details = {}
    origin = urlsplit(client.base_url)
    with sync_playwright() as playwright:
        browser, browser_info = launch_browser(playwright, executable)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 950}, reduced_motion='reduce')
            context.add_init_script(PRINT_STUB)
            context.add_cookies([{'name': cookie.name, 'value': cookie.value, 'url': client.base_url} for cookie in client.session.cookies])
            def owned_route(route):
                parsed = urlsplit(route.request.url)
                if parsed.scheme in ('http', 'https') and (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
                    external.append(route.request.url)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', owned_route)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('response', lambda response: assets.add(urlsplit(response.url).path) if PDFJS_BASE in response.url and response.status == 200 else None)
            page.goto(client.base_url, wait_until='networkidle')
            page.evaluate('(id) => selectProject(id)', pid)
            page.wait_for_function('(id) => Number(currentProject?.id) === id', arg=pid)
            autoprint = reader_frame(page, attachments['autoprint']['id'], 3)
            document_hash = autoprint.evaluate('''async () => {
                const bytes = await PDFViewerApplication.pdfDocument.getData();
                return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
                    value => value.toString(16).padStart(2,'0')).join('');
            }''')
            require(document_hash == attachments['autoprint']['sha256'], 'PDF reader did not load the exact uploaded automatic-print original')
            action = autoprint.evaluate(OPEN_ACTION_SCRIPT)
            require(action and action.get('action') == 'Print', 'Automatic-print fixture was not interpreted as a PDF Print open action')
            autoprint.wait_for_function('() => PDFViewerApplication.pdfViewer.pageViewsReady', timeout=30000)
            page.wait_for_timeout(800)
            require(autoprint.evaluate('window.__pmPdfPrint.calls === 0 && !PDFViewerApplication.printService'),
                    'PDF OpenAction started printing without a user request')
            details['automatic_print'] = {'source_open_action': action, 'loaded_document_sha256': document_hash,
                                          'native_print_calls': 0, 'print_service_started': False}
            page.evaluate('closeDocPreview()')
            short = reader_frame(page, attachments['short']['id'], 3)
            require(short.evaluate('PDFViewerApplicationOptions.get("enableScripting")') is False, 'Embedded PDF scripting is enabled')
            short.wait_for_function('''() => document.querySelector('#printButton')?.title === '打印'
                && document.querySelector('#previous')?.title === '上一页'
                && document.querySelector('#next')?.title === '下一页' ''', timeout=30000)
            details['chinese_toolbar'] = {'print': short.locator('#printButton').get_attribute('title'),
                                          'previous': short.locator('#previous').get_attribute('title'),
                                          'next': short.locator('#next').get_attribute('title')}
            details['outline_and_link'] = outline_checks(short, 3)
            goto_page(short, 3)
            require('3' in short.locator('#numPages').inner_text(), 'Visible total pages missing')
            short.locator('#previous').click()
            short.wait_for_function('() => PDFViewerApplication.page === 2')
            short.locator('#next').click()
            short.wait_for_function('() => PDFViewerApplication.page === 3')
            details['quick_navigation'] = {'last_page': 3, 'previous_next': True, 'visible_current_and_total': True}
            details['search'] = search_checks(short, 3)
            short.locator('#printButton').click()
            short.wait_for_function('() => window.__pmPdfPrint.calls > 0', timeout=120000)
            details['print_preparation'] = validate_print_snapshot(short.evaluate('window.__pmPdfPrint.snapshots.at(-1)'), 3)
            short.wait_for_function('() => !PDFViewerApplication.printService', timeout=30000)
            page.evaluate('closeDocPreview()')

            long = reader_frame(page, attachments['long']['id'], 269)
            long.evaluate('''() => {
                window.__pmCanvasPeak = document.querySelectorAll('.page canvas').length;
                new MutationObserver(() => window.__pmCanvasPeak = Math.max(window.__pmCanvasPeak, document.querySelectorAll('.page canvas').length))
                    .observe(document.querySelector('#viewer'), {subtree:true, childList:true});
            }''')
            goto_page(long, 269)
            details['long_search'] = search_checks(long, 269)
            goto_page(long, 269)
            canvas = long.evaluate('''() => ({pages:PDFViewerApplication.pagesCount, current:PDFViewerApplication.page,
                page_placeholders:document.querySelectorAll('.page').length, live_canvases:document.querySelectorAll('.page canvas').length,
                peak_canvases:window.__pmCanvasPeak, total_dom_nodes:document.querySelectorAll('*').length})''')
            require(canvas['live_canvases'] < 20 and canvas['peak_canvases'] < 20, '269-page reader allocated too many live canvases: ' + repr(canvas))
            require(canvas['page_placeholders'] <= 269 and canvas['total_dom_nodes'] < 18000, '269-page reader DOM grew beyond the declared fixture budget: ' + repr(canvas))
            details['long_document'] = canvas
            page.screenshot(path=str(evidence / 'pdf-269-last-page.png'))

            # Opening another attachment must dispose this frame, not just hide it.
            old_element = page.locator('#pdfReaderFrame').element_handle()
            scan = reader_frame(page, attachments['scan']['id'], 1)
            require(not old_element.evaluate('(element) => element.isConnected'), 'Switching attachment retained old PDF iframe')
            scan_state = scan.evaluate('''async () => ({outline:await PDFViewerApplication.pdfDocument.getOutline(),
                text:(await (await PDFViewerApplication.pdfDocument.getPage(1)).getTextContent()).items.map(item => item.str || '').join('')})''')
            require(scan_state['outline'] is None and not scan_state['text'].strip(), 'Raster-only sample unexpectedly has searchable text or native bookmarks')
            # A file without bookmarks disables the outline tab. Open the
            # available thumbnail sidebar through the same control as users.
            if not scan.evaluate('PDFViewerApplication.viewsManager.isOpen'):
                scan.locator('#viewsManagerToggleButton').click()
            scan.locator('#pmOutlineEmpty').wait_for(state='visible')
            scan.evaluate('PDFViewerApplication.viewsManager.close()')
            scan.locator('#pageNumber').press('Control+f')
            scan.locator('#findInput').fill('ProjectNeedle')
            scan.wait_for_function('() => document.querySelector("#findInput")?.dataset.status === "notFound"', timeout=30000)
            scan.locator('#pmSearchHint').wait_for(state='visible', timeout=30000)
            require('OCR' in scan.locator('#pmSearchHint').inner_text() or '文字' in scan.locator('#pmSearchHint').inner_text(), 'Scan search limitation is not explained')
            details['scan_boundary'] = {**scan_state, 'no_native_bookmarks_explained': True, 'no_text_layer_explained': True, 'ocr_performed': False}
            page.screenshot(path=str(evidence / 'pdf-scan-search-boundary.png'))
            page.evaluate('closeDocPreview()')

            layouts = []
            for width in (1440, 390):
                page.set_viewport_size({'width': width, 'height': 950})
                for theme in ('default', 'blue', 'green', 'dark'):
                    page.evaluate('(theme) => updateUiPreference("theme", theme)', theme)
                    frame = reader_frame(page, attachments['short']['id'], 3)
                    frame.wait_for_function('(theme) => document.documentElement.dataset.theme === theme', arg=theme)
                    goto_page(frame, 3)
                    filename = f'pdf-reader-{theme}-{width}.png'
                    page.screenshot(path=str(evidence / filename))
                    for selector in ('#docPreviewOverlay', '#pdfReaderFrame'):
                        bounds = page.locator(selector).bounding_box()
                        require(bounds and bounds['x'] >= -1 and bounds['x'] + bounds['width'] <= width + 1,
                                'PDF preview overflows viewport: ' + selector)
                    overflow = frame.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                    require(not overflow, 'PDF reader toolbar overflows at width ' + str(width))
                    layouts.append({'theme': theme, 'css_viewport_width': width, 'screenshot': filename, 'current_page': 3})
                    page.evaluate('closeDocPreview()')
                    require(page.locator('#pdfReaderFrame').count() == 0, 'Close retained PDF iframe')
            details['layouts'] = layouts

            frame = reader_frame(page, attachments['short']['id'], 3)
            old = page.locator('#pdfReaderFrame').element_handle()
            session = frame.evaluate('new URLSearchParams(location.search).get("session")')
            page.evaluate('window.__pmOldPdfWindow = document.querySelector("#pdfReaderFrame").contentWindow')
            page.evaluate('(id) => selectProject(id)', other_pid)
            page.wait_for_function('(id) => Number(currentProject?.id) === id', arg=other_pid)
            require(not old.evaluate('(element) => element.isConnected'), 'Changing project retained old PDF iframe')
            require(page.locator('#docPreviewOverlay.open').count() == 0, 'Changing project retained open PDF dialog')
            # Explicitly-labelled late-event injection checks only lifecycle guards.
            page.evaluate('''(session) => {
                for (const event of ['ready','error','close']) window.dispatchEvent(new MessageEvent('message', {
                    origin:location.origin, source:window.__pmOldPdfWindow, data:{type:'pm-pdf-reader',event,session,pages:999,message:'late synthetic event'}}));
                delete window.__pmOldPdfWindow;
            }''', session)
            page.wait_for_timeout(350)
            require(page.locator('#pdfReaderFrame').count() == 0 and page.locator('#docPreviewOverlay.open').count() == 0,
                    'Late synthetic reader event revived closed preview')
            details['lifecycle'] = {'attachment_switch_disposed': True, 'project_switch_disposed': True,
                                    'close_disposed': True, 'late_event_injection_ignored': True}
            require(not external, 'Browser attempted external requests: ' + repr(external))
            require(not errors, 'Browser JavaScript pageerror: ' + repr(errors))
            require(PDFJS_BASE + 'build/pdf.mjs' in assets and PDFJS_BASE + 'web/viewer.mjs' in assets
                    and PDFJS_BASE + 'build/pdf.worker.mjs' in assets, 'Candidate did not serve complete self-hosted PDF.js core/viewer/worker')
            return {'browser': browser_info, **details, 'self_hosted_assets': sorted(assets), 'page_errors': errors, 'external_requests': external}
        finally:
            browser.close()


def run(args):
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    report = Report(emit=True)
    report.metadata.update(candidate=str(args.candidate.resolve()), candidate_sha256=args.candidate_sha256)
    try:
        report.check('candidate', lambda: validate_candidate(args.candidate, args.candidate_sha256))
        from tools.verify_packaged_browser_acceptance import owned_client
        with tempfile.TemporaryDirectory(prefix='pm-pdf-exe-', ignore_cleanup_errors=True) as temporary:
            root = Path(temporary)
            fixtures = make_fixtures(root / 'fixtures')
            report.check('fixtures', lambda: {name: {'sha256': sha256(path), 'bytes': path.stat().st_size,
                'pages': {'short': 3, 'long': 269, 'scan': 1, 'autoprint': 3}[name], 'native_outline': name != 'scan',
                'text_layer': name != 'scan'} for name, path in fixtures.items()})
            with owned_client(args.candidate.resolve(), root, 'pdf-reader') as client:
                report.check('startup', client.start)
                report.check('http framing', lambda: http_reader_checks(client))
                project = report.check('project', lambda: seed_project(client))
                other = seed_project(client, 'PDF-OTHER')
                pid = project['id']
                attachments = {}
                for name, path in fixtures.items():
                    attachments[name] = report.check(name + ' upload', lambda path=path: upload(client, pid, path))
                    report.check(name + ' original', lambda name=name, path=path: download_matches(client, attachments[name]['id'], path))
                initial_projects = client.request('GET', '/api/projects')
                initial_attachments = client.request('GET', f'/api/projects/{pid}/attachments')
                report.check('anonymous denied', lambda: anonymous_checks(client, attachments))
                report.check('browser', lambda: browser_checks(client, pid, other['id'], attachments, evidence, args.browser_executable))
                def unchanged():
                    require(client.request('GET', '/api/projects') == initial_projects, 'PDF reading changed project records')
                    require(client.request('GET', f'/api/projects/{pid}/attachments') == initial_attachments, 'PDF reading changed attachment records')
                    for name, row in attachments.items():
                        require(sha256(client.data_root / row['stored_relative_path']) == row['stored_sha256'], 'PDF reading changed encrypted original')
                        download_matches(client, row['id'], fixtures[name])
                    return {'projects_unchanged': True, 'attachments_unchanged': True, 'original_sha256_unchanged': True, 'encrypted_blobs_unchanged': True}
                report.check('unchanged', unchanged)
    except Exception as error:
        report.metadata.update(error=f'{type(error).__name__}: {error}', traceback=traceback.format_exc())
        if all(row['passed'] for row in report.checks):
            report.checks.append({'name': 'acceptance interrupted', 'passed': False, 'error': report.metadata['error']})
    result = report.result()
    (evidence / 'pdf-reader-exe-acceptance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    outcome = run(parser().parse_args())
    # PDF.js l10n uses bidi-isolation characters not representable in older
    # Windows console encodings. Evidence stays UTF-8; stdout remains portable.
    print(json.dumps(outcome, ensure_ascii=True, indent=2))
    raise SystemExit(0 if outcome['passed'] else 1)
