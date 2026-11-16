"""Browser test for phase D of the charts plan: Plotly is not downloaded unless a page has a Plotly chart, it loads on demand, a failed download leaves a message
instead of an error, leaving a page before the library arrives draws nothing stale, and the service worker keeps the library in its own cache.
The CDN request is answered by a tiny stand-in for Plotly (the test sandbox has no internet). Run: python3 tests/e2e_lazyplotly.py"""
import http.server, threading, functools, os, re
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
STUB = "window.__drawn = window.__drawn || []; window.Plotly = { newPlot(el, t, l, c) { window.__drawn.push(el.id); el.innerHTML = '<svg class=\"fakeplot\"></svg>'; }, purge() {} };"

with sync_playwright() as p:
    b = p.chromium.launch()
    def newpage(): return b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block').new_page()   # the service worker's own requests bypass the test's network stub
    pg = newpage(); errs = []; hits = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    def cdn(route):
        hits.append(route.request.url)
        if mode['fail']: route.abort()
        else: route.fulfill(status=200, content_type='application/javascript', body=STUB)
    mode = {'fail': False}; pg.route('**/cdn.jsdelivr.net/**', cdn)
    pg.goto(URL); pg.click('#loadSample'); pg.wait_for_timeout(500)
    def tab(t, sub=None):
        pg.evaluate("() => { location.hash = '#stats' }"); pg.wait_for_selector('[data-seg="sx_tab"]'); pg.click(f'[data-seg="sx_tab"] button[data-v="{t}"]')
        if sub: pg.click(f'[data-seg="{sub[0]}"] button[data-v="{sub[1]}"]')
        pg.wait_for_timeout(300)
    check('the page no longer lists Plotly as a script', 'plotly' not in open(os.path.join(ROOT, 'index.html')).read().lower())
    for page in ['#home', '#rounds', '#play']:
        pg.evaluate("(h) => { location.hash = h }", page); pg.wait_for_timeout(250)
    for t in ['scoring', 'tee', 'approach', 'short', 'putting', 'sg', 'handicap']: tab(t)
    check('Home, Rounds, Play and the converted Stats tabs never ask for Plotly', not hits and pg.evaluate("() => !window.Plotly"), str(hits))
    # a page with a Plotly chart loads it on demand
    tab('bag', ('bag_tab', 'gapping')); pg.wait_for_selector('.fakeplot', state='attached', timeout=5000)
    check('the club gapping page loads Plotly once and draws', len(hits) == 1 and 'plotly.js-dist-min@2.35.2' in hits[0] and pg.locator('.fakeplot').count() >= 1, str(hits))
    tab('bag', ('bag_tab', 'dispersion')); pg.wait_for_timeout(300)
    check('later chart pages reuse the loaded library', len(hits) == 1, str(hits))
    # leaving before the library arrives draws nothing on the new page
    pg2 = newpage(); late = {'go': None}
    def slow(route):
        late['go'] = route
    pg2.route('**/cdn.jsdelivr.net/**', slow); pg2.goto(URL); pg2.click('#loadSample'); pg2.wait_for_timeout(500)
    pg2.evaluate("() => { location.hash = '#stats' }"); pg2.wait_for_selector('[data-seg="sx_tab"]'); pg2.click('[data-seg="sx_tab"] button[data-v="bag"]'); pg2.wait_for_timeout(300)
    check('while it downloads the chart shows a loading note', 'Loading chart' in pg2.inner_text('#main'))
    pg2.click('[data-seg="sx_tab"] button[data-v="scoring"]'); pg2.wait_for_timeout(200); late['go'].fulfill(status=200, content_type='application/javascript', body=STUB); pg2.wait_for_timeout(300)
    check('leaving the page before it arrives draws nothing stale', pg2.evaluate("() => (window.__drawn || []).length") == 0 and pg2.locator('.fakeplot').count() == 0)
    # offline / blocked: a note, not an error, and a later visit can try again
    pg3 = newpage(); errs3 = []; pg3.on('pageerror', lambda e: errs3.append(str(e))); fail = {'on': True}
    pg3.route('**/cdn.jsdelivr.net/**', lambda r: r.abort() if fail['on'] else r.fulfill(status=200, content_type='application/javascript', body=STUB))
    pg3.goto(URL); pg3.click('#loadSample'); pg3.wait_for_timeout(500); pg3.evaluate("() => { location.hash = '#stats' }"); pg3.wait_for_selector('[data-seg="sx_tab"]'); pg3.click('[data-seg="sx_tab"] button[data-v="bag"]'); pg3.wait_for_timeout(600)
    check('with no connection the chart shows the offline note', 'Charts load when online the first time' in pg3.inner_text('#main') and not errs3, str(errs3))
    fail['on'] = False; pg3.click('[data-seg="sx_tab"] button[data-v="scoring"]'); pg3.click('[data-seg="sx_tab"] button[data-v="bag"]'); pg3.wait_for_selector('.fakeplot', state='attached', timeout=5000)
    check('a later visit tries again and draws', pg3.locator('.fakeplot').count() >= 1)
    check('no page errors', not errs, str(errs[:3]))
    b.close()
# service worker: the library has its own cache that survives app updates and is not downloaded at install
sw = open(os.path.join(ROOT, 'sw.js')).read()
check('service worker: Plotly is not precached at install', 'plotly' not in sw.split('const LIB')[0].lower())
check('service worker: the library cache survives updates', "k !== CACHE && k !== LIB" in sw and "caches.open(LIB)" in sw)
check('service worker: cache name was bumped', re.search(r"const CACHE = 'golfiq-v(\d+)'", sw) and int(re.search(r"golfiq-v(\d+)", sw).group(1)) >= 22)
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); raise SystemExit(1 if fails else 0)
