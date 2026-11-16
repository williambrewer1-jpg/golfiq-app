"""Browser test for the monthly skills test (phase 7). Run: python3 tests/e2e_skillstest.py"""
import http.server, threading, functools, sys, os, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from play_helpers import answer_step, go_next
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
N = 6                                               # games in the test
def play_out(pg, every=3):
    taps = 0
    while pg.query_selector('#gpRoot .gp-btns'):
        answer_step(pg, taps, every)
        taps += 1; pg.wait_for_timeout(40)
        if taps > 60: break
    pg.wait_for_selector('.gp-res', timeout=3000)
def run_test(pg, every):
    pg.click('[data-gptest]'); pg.wait_for_selector('#gpRoot .gp-prompt'); order = []
    for i in range(N):
        order.append(pg.evaluate("() => window.__golfiq.state.journal.game_draft.game")); play_out(pg, every)
        if i < N - 1: go_next(pg)
    return order
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.clock.set_fixed_time('2026-11-03T10:00:00')
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.gp-test')
    check('Home reminds you in the first week of the month', 'monthly skills test' in pg.inner_text('.gp-test').lower())
    pg.screenshot(path='/tmp/test_home.png')
    pg.click('.gp-test [data-gptest]'); pg.wait_for_selector('#gpRoot .gp-prompt'); order = []
    for i in range(N):
        order.append(pg.evaluate("() => window.__golfiq.state.journal.game_draft.game")); play_out(pg, 2)
        if i < N - 1:
            check(f'game {i + 1}: result says skills test, game {i + 1} of {N}', f'Skills test: game {i + 1} of {N}' in pg.inner_text('.gp-res'), pg.inner_text('.gp-res')[-100:])
            go_next(pg)
    check('the test runs the six fixed games in order, the Driver test last', order == ['putt-369', 'putt-lag', 'chip-updown', 'range-wedge', 'range-greens', 'range-driver'], order)
    check('the last result offers Finish test', 'Finish test' in pg.inner_text('[data-gpsesend]'))
    pg.click('[data-gpsesend]'); pg.wait_for_selector('text=Skills test done')
    sm = pg.inner_text('#gpRoot'); check('summary lists the skills with a practice handicap', all(w in sm for w in ['Putting', 'Short game', 'Approach', 'Driving']) and 'first test' in sm, sm[:400])
    check('every skill, Driving included, has a practice handicap', 'not in the test' not in sm)
    t1 = pg.evaluate("() => { const j = window.__golfiq.state.journal, t = j.skills_tests; return { n: t.length, r: t[0].ratings, results: t[0].results.length, linked: t[0].results.every(id => j.results.find(r => r.id === id && r.session_id === t[0].id)), ses: j.sessions.slice(-1)[0].notes }; }")
    check('test stored with ratings per skill and linked results', t1['n'] == 1 and all(isinstance(t1['r'][k], (int, float)) for k in ['putting', 'short', 'approach', 'driving']) and t1['results'] == N and t1['linked'], t1)
    check('the test also logs a practice session', t1['ses'] == 'Monthly skills test')
    pg.screenshot(path='/tmp/test_summary1.png')
    pr = pg.evaluate("() => window.__golfiq.progress.data().sk.skills.map(s => [s.key, s.practice_hcp])")
    check('practice levels are re-rated from the test scores', all(v is not None for k, v in pr), pr)
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
    check('no page errors', not errs, errs); ctx.close()

    # the reveal of the summary (phase D): played with real timing, so the number counts up and the sound fits what happened. Games are played with the delay off and it is switched on for the finish.
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.clock.set_fixed_time('2026-11-03T10:00:00'); pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gptest]')
    def finish_test(pg, every):
        pg.evaluate("() => { window.__feelDelay = 0; }"); run_test(pg, every)
        pg.evaluate("() => { window.__feelLog = []; delete window.__feelDelay; }"); pg.click('[data-gpsesend]'); pg.wait_for_selector('#gpSNum'); pg.wait_for_selector('#gpRoot[data-revealed]', timeout=6000)
        return pg.evaluate("() => window.__feelLog.slice()")
    log = finish_test(pg, 2)
    hero = pg.inner_text('.gp-hero')
    check('first test: the big number is how many skills were rated, with a note that there is nothing to compare with', pg.get_attribute('#gpRoot', 'data-kind') == 'test' and pg.inner_text('#gpSNum') == pg.get_attribute('#gpRoot', 'data-hits') and 'nothing to compare with yet' in hero and 'skills rated' in hero.lower(), hero)
    check('first test: a quiet finish sound and no confetti', [e for e in log if e in ('finish', 'pb', 'win')] == ['finish'] and 'confetti' not in log, log)
    pg.evaluate("() => { window.__feelLog = []; }"); pg.reload(); pg.wait_for_selector('#gpRoot[data-kind=test]'); pg.wait_for_timeout(500)
    check('after a reload the test summary is shown at once, with no sound', pg.evaluate("() => (window.__feelLog || []).length") == 0 and pg.inner_text('#gpSNum') == pg.get_attribute('#gpRoot', 'data-hits'))
    a = pg.evaluate("() => { const out = []; for (const el of document.querySelectorAll('#gpRoot, #gpRoot *')) { const k = el.getBoundingClientRect(); if (k.width && k.right > innerWidth + 1) out.push(el.className || el.tagName); if (el.matches('button') && k.height < 38) out.push('small button'); } return [document.documentElement.scrollWidth > innerWidth + 1, out]; }")
    check('the test summary fits the phone: no overflow, buttons at least 38px', a == [False, []], a)
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gptest]'); pg.reload(); pg.wait_for_selector('[data-gptest]')
    check('Done clears the test summary for good', pg.query_selector('#gpRoot') is None and not pg.evaluate("() => JSON.parse(localStorage.getItem('golfiq-ui') || '{}').test_summary"))
    pg.clock.set_fixed_time('2026-11-17T10:00:00'); log = finish_test(pg, 8)
    hero = pg.inner_text('.gp-hero'); better = int(pg.get_attribute('#gpRoot', 'data-better'))
    check('second test with better scores: the big number is how many skills are better than last time', better > 0 and pg.inner_text('#gpSNum') == str(better) and re.search(r'/\s*\d+\s+skills? better than last test', hero), hero)
    check('second test: the personal-best sound and confetti', 'pb' in log and 'confetti' in log, log)
    pg.screenshot(path='/tmp/test_summary_reveal.png')
    check('no page errors in the reveal run', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
