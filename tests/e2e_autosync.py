"""Garmin rounds arrive on their own: opening the app (or coming back to it) pulls new rounds from the data repo
without a tap on "Sync now", at most every 30 minutes, and never on the Play page.
Usage: python3 tests/e2e_autosync.py [path-to-data-repo-data-folder]  (defaults to a two-round fake)"""
import http.server, threading, functools, sys, os, json, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html'

DATA = sys.argv[1] if len(sys.argv) > 1 else None
if DATA:
    index = json.load(open(os.path.join(DATA, 'index.json')))
    files = {f'rounds/scorecard_{i}.json': open(os.path.join(DATA, 'rounds', f'scorecard_{i}.json')).read() for i in index['rounds']}
    if os.path.exists(os.path.join(DATA, 'clubs_latest.json')): files['clubs_latest.json'] = open(os.path.join(DATA, 'clubs_latest.json')).read()
else:
    sample = json.load(open(os.path.join(ROOT, 'sample-data.json')))
    rounds = [r for r in sample['bundles'] if r.get('scorecard_id')][:2]
    files = {f'rounds/scorecard_{r["scorecard_id"]}.json': json.dumps(r) for r in rounds}
    index = {'rounds': {str(r['scorecard_id']): f'sha{i}' for i, r in enumerate(rounds)}, 'job': {'status': 'ok'}}
files['index.json'] = json.dumps(index)
want = len(index['rounds'])
hits = []

def gh(route):
    m = re.search(r'/contents/data/([^?]+)', route.request.url); p = m.group(1) if m else ''
    hits.append(p)
    if p in files: route.fulfill(status=200, body=files[p], content_type='application/json')
    else: route.fulfill(status=404, body='{}')

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(service_workers='block')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort()); pg.route('https://api.github.com/**', gh)
    pg.goto(URL); pg.wait_for_function('window.__golfiq && window.__golfiq.state')
    # set up cloud sync as the Settings form would, with no sync yet, then reopen the app
    pg.evaluate("""async () => { const S = await import('./store.js'); const st = window.__golfiq.state;
        st.sync = { owner: 'me', repo: 'golfiq-data', token: 't' }; await S.saveSync(st); }""")
    hits.clear(); pg.reload(); pg.wait_for_function(f'window.__golfiq && window.__golfiq.state.bundles.length >= {want}', timeout=30000)
    n = pg.evaluate('window.__golfiq.state.bundles.length'); assert n == want, n
    assert 'index.json' in hits, hits
    assert pg.evaluate("!!window.__golfiq.state.sync.last_sync")
    # within 30 minutes: reopening does not hit GitHub again
    hits.clear(); pg.reload(); pg.wait_for_function('window.__golfiq && window.__golfiq.state'); pg.wait_for_timeout(800)
    assert not hits, hits
    # an old last sync on the Play page: still no sync mid-round
    pg.evaluate("""async () => { const S = await import('./store.js'); const st = window.__golfiq.state;
        st.sync.last_sync = '2020-01-01T00:00:00Z'; await S.saveSync(st); }""")
    hits.clear(); pg.goto(URL + '#play'); pg.reload(); pg.wait_for_function('window.__golfiq && window.__golfiq.state'); pg.wait_for_timeout(800)
    assert not hits, hits
    # a saved repo but no token: the home sync line says so and links straight to the Garmin sync settings
    pg.evaluate("""async () => { const S = await import('./store.js'); const st = window.__golfiq.state;
        st.sync.token = ''; await S.saveSync(st); }""")
    hits.clear(); pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('#syncMsg a[data-sttab="sync"]', state='attached')
    assert 'No token saved' in pg.inner_text('#syncMsg'); assert not hits, hits
    pg.eval_on_selector('#syncNow', 'b => b.click()'); pg.wait_for_function("document.querySelector('#syncMsg').textContent.includes('fine-grained token')")
    pg.reload(); pg.wait_for_selector('#syncMsg a[data-sttab="sync"]', state='attached'); pg.eval_on_selector('#syncMsg a[data-sttab="sync"]', 'a => a.click()'); pg.wait_for_selector('#syncForm input[name="token"]', state='attached')
    assert not errs, errs
    b.close()
print(f'autosync: {want} round(s) pulled on open without tapping Sync, throttled, skipped on Play, missing token flagged – passed')
