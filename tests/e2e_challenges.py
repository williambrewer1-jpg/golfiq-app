"""Browser test for on-course challenges (phase 6). Run: python3 tests/e2e_challenges.py"""
import http.server, threading, functools, sys, os, re
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
URL = f'http://127.0.0.1:{port}/index.html'
def play_round(pg, good, nholes=9):
    for i in range(nholes):
        pg.wait_for_selector('#plNext')
        pg.click('[data-step="strokes"][data-d="1"]')                                   # par
        if not good:
            for _ in range(2): pg.click('[data-step="strokes"][data-d="1"]')           # +2
        want_putts = 3 if not good else (1 if CHAL['key'] == 'updowns' else 2)
        for _ in range(want_putts): pg.click('[data-step="putts"][data-d="1"]')
        if not good: pg.click('[data-step="penalties"][data-d="1"]')
        if good and pg.query_selector('[data-fw="HIT"]'): pg.click('[data-fw="HIT"]')
        if i == 0 and good: check('hole screen shows the challenge chip', pg.query_selector('#plChal') is not None and CHAL['title'].split(' ')[-1] in pg.inner_text('#plChal'), pg.inner_text('#plChal') if pg.query_selector('#plChal') else None)
        if i < nholes - 1: pg.click('#plNext'); pg.wait_for_timeout(80)
CHAL = {}
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart')
    check('start card offers one challenge', pg.query_selector('.chal-offer input[name=chal]') is not None, pg.inner_text('#plStart')[:300])
    key = pg.get_attribute('.chal-offer input', 'value'); CHAL['key'] = key; CHAL['title'] = pg.inner_text('.chal-offer b').replace('Round challenge:', '').strip()
    check('offer explains why', len(pg.inner_text('.chal-offer small')) > 20)
    pg.screenshot(path='/tmp/challenge_offer.png')
    sub = pg.evaluate("(k) => ({ 'no-three-putts': 'putting.lag', updowns: 'short.updown', fairways: 'driving.accuracy', 'no-penalties': 'driving.penalties', greens: 'approach.gir' })[k]", key)
    hits0 = pg.evaluate("(s) => { const x = window.__golfiq.progress.data().plan.ledger.find(l => l.sub === s); return x ? x.hits : null; }", sub)
    # round 1: play it well, nine holes
    pg.select_option('select[name=n]', '9'); pg.click('#plStart button.btn'); pg.wait_for_selector('#plChal')
    check('chip is shown on the hole screen with the scaled goal', 'No' in pg.inner_text('#plChal') or re.search(r'\d', pg.inner_text('#plChal')), pg.inner_text('#plChal'))
    play_round(pg, True)
    st = pg.evaluate("() => document.querySelector('#plChal').className"); check('live chip turns achieved when the challenge is met', 'achieved' in st or key.startswith('no-'), st)
    pg.click('#plFinish'); pg.wait_for_timeout(1200)
    r = pg.evaluate("() => { const j = window.__golfiq.state.journal; return (j.course_challenges || []).slice(-1)[0]; }")
    check('round records the challenge outcome', r and r['key'] == key and r['sub'] == sub and r['n'] == 9, r)
    check('a well-played round achieves it', r and r['achieved'] is True, r)
    body = pg.inner_text('body'); bl = body.lower(); check('round summary shows the challenge', 'round challenge' in bl and 'done' in bl, bl[bl.find('round challenge') - 50:][:200] if 'round challenge' in bl else ('NOT FOUND; rd_open=' + str(pg.evaluate("() => JSON.parse(localStorage.getItem('golfiq-ui')).rd_open")) + ' hash=' + pg.evaluate('() => location.hash')))
    hits1 = pg.evaluate("(s) => { const x = window.__golfiq.progress.data().plan.ledger.find(l => l.sub === s); return x ? x.hits : null; }", sub)
    check('achieving it counts as a hit towards potential', hits0 is None or hits1 == hits0 + 1, (hits0, hits1))
    # round 2: a different challenge is offered, played badly
    pg.goto(URL + '#play'); pg.wait_for_selector('#plStart')
    key2 = pg.get_attribute('.chal-offer input', 'value') if pg.query_selector('.chal-offer input') else None
    check('the same challenge is not offered twice running', key2 and key2 != key, (key, key2))
    CHAL['key'] = key2; CHAL['title'] = pg.inner_text('.chal-offer b').replace('Round challenge:', '').strip()
    pg.select_option('select[name=n]', '9'); pg.click('#plStart button.btn'); pg.wait_for_selector('#plChal')
    play_round(pg, False); st2 = pg.evaluate("() => document.querySelector('#plChal').className"); check('live chip shows missed when it can no longer be met', 'failed' in st2, st2)
    pg.click('#plFinish'); pg.wait_for_timeout(1200)
    r2 = pg.evaluate("() => { const j = window.__golfiq.state.journal; return j.course_challenges.slice(-1)[0]; }")
    check('a missed challenge is stored as not achieved', r2 and r2['key'] == key2 and r2['achieved'] is False, r2)
    check('two outcomes logged', pg.evaluate("() => window.__golfiq.state.journal.course_challenges.length") == 2)
    # skipping the offer
    pg.goto(URL + '#play'); pg.wait_for_selector('#plStart'); pg.uncheck('.chal-offer input'); pg.select_option('select[name=n]', '9'); pg.click('#plStart button.btn'); pg.wait_for_selector('#plNext')
    check('skipping the offer starts a round with no chip', pg.query_selector('#plChal') is None and pg.evaluate("() => window.__golfiq.state.journal.draft.challenge") is None)
    check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
