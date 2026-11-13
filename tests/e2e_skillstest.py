"""Browser test for the monthly skills test (phase 7). Run: python3 tests/e2e_skillstest.py"""
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
def play_out(pg, every=3):
    taps = 0
    while pg.query_selector('#gpRoot .gp-btns'):
        if pg.query_selector('[data-gp="5"]'): pg.click('[data-gp="2"]')
        else: pg.click('[data-gp="1"]' if taps % every != every - 1 else '[data-gp="0"]')
        taps += 1; pg.wait_for_timeout(40)
        if taps > 60: break
    pg.wait_for_selector('.gp-res', timeout=3000)
def run_test(pg, every):
    pg.click('[data-gptest]'); pg.wait_for_selector('#gpRoot .gp-prompt'); order = []
    for i in range(5):
        order.append(pg.evaluate("() => window.__golfiq.state.journal.game_draft.game")); play_out(pg, every)
        if i < 4: pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    return order
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.clock.set_fixed_time('2026-11-03T10:00:00')
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.gp-test')
    check('Home reminds you in the first week of the month', 'monthly skills test' in pg.inner_text('.gp-test').lower())
    pg.screenshot(path='/tmp/test_home.png')
    pg.click('.gp-test [data-gptest]'); pg.wait_for_selector('#gpRoot .gp-prompt'); order = []
    for i in range(5):
        order.append(pg.evaluate("() => window.__golfiq.state.journal.game_draft.game")); play_out(pg, 2)
        if i < 4:
            check(f'game {i + 1}: result says skills test, game {i + 1} of 5', f'Skills test: game {i + 1} of 5' in pg.inner_text('.gp-res'), pg.inner_text('.gp-res')[-100:])
            pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('the test runs the five fixed games in order', order == ['putt-369', 'putt-lag', 'chip-updown', 'range-wedge', 'range-greens'], order)
    check('the last result offers Finish test', 'Finish test' in pg.inner_text('[data-gpsesend]'))
    pg.click('[data-gpsesend]'); pg.wait_for_selector('text=Skills test done')
    sm = pg.inner_text('#gpRoot'); check('summary lists the skills with a practice handicap', all(w in sm for w in ['Putting', 'Short game', 'Approach', 'Driving']) and 'first test' in sm, sm[:400])
    check('driving is marked as not in the test', 'not in the test' in sm)
    t1 = pg.evaluate("() => { const j = window.__golfiq.state.journal, t = j.skills_tests; return { n: t.length, r: t[0].ratings, results: t[0].results.length, linked: t[0].results.every(id => j.results.find(r => r.id === id && r.session_id === t[0].id)), ses: j.sessions.slice(-1)[0].notes }; }")
    check('test stored with ratings per skill and linked results', t1['n'] == 1 and all(isinstance(t1['r'][k], (int, float)) for k in ['putting', 'short', 'approach']) and t1['r']['driving'] is None and t1['results'] == 5 and t1['linked'], t1)
    check('the test also logs a practice session', t1['ses'] == 'Monthly skills test')
    pg.screenshot(path='/tmp/test_summary1.png')
    pr = pg.evaluate("() => window.__golfiq.progress.data().sk.skills.map(s => [s.key, s.practice_hcp])")
    check('practice levels are re-rated from the test scores', all(v is not None for k, v in pr if k in ('putting', 'short', 'approach')), pr)
    pg.click('[data-gpdone]'); pg.goto(URL + '#home'); pg.wait_for_selector('.kpis')
    check('reminder is gone once the test is done', pg.query_selector('.gp-test') is None)
    # second test, better scores: compares with the first
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gptest]')
    check('Games tab shows last test date and allows another run', 'last 2026-11-03' in pg.inner_text('.gp-test') and 'done' in pg.inner_text('.gp-test'), pg.inner_text('.gp-test'))
    pg.clock.set_fixed_time('2026-11-17T10:00:00'); run_test(pg, 8); pg.click('[data-gpsesend]'); pg.wait_for_selector('text=Skills test done')
    sm2 = pg.inner_text('#gpRoot'); check('second summary compares with the last test', 'Compared with 2026-11-03' in sm2 and 'last test' in sm2.lower() and ('better' in sm2 or 'same' in sm2 or 'worse' in sm2), sm2[:500])
    c = pg.evaluate("() => { const t = window.__golfiq.state.journal.skills_tests; return [t.length, t[1].ratings.putting < t[0].ratings.putting]; }")
    check('more hits give a better (lower) putting handicap', c == [2, True], c)
    pg.screenshot(path='/tmp/test_summary2.png')
    a = pg.evaluate("() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1 })"); check('no horizontal overflow', not a['overflow'])
    check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
