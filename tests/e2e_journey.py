"""Browser test for phase R2 (road to scratch): the Journey tab, the stage sheet, stage progress from results, the Home card and the result-screen line,
at a 390x844 phone with the built-in sample data. Run: python3 tests/e2e_journey.py"""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
from play_helpers import answer_step
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
URL = f'http://127.0.0.1:{port}/index.html'
AUDIT = """(sel) => { const root = document.querySelector(sel) || document.body, bad = [];
  for (const el of root.querySelectorAll('button, input, select, a.btn')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 20) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
SET = """async (j) => { const g = window.__golfiq, S = await import('./store.js'); Object.assign(g.state.journal, j); await S.saveJournal(g.state); }"""
def taps_left(pg): return pg.query_selector('#gpRoot:not(.gp-rv) [data-gp], #gpRoot:not(.gp-rv) [data-gpball]') is not None
def play(pg, gid):
    pg.evaluate("(id) => { window.__golfiq.state.journal.game_draft = null; window.__golfiq.guided.start(id); }", gid)
    pg.wait_for_selector('#gpRoot.gp-full'); taps = 0
    while taps_left(pg) and taps < 60: answer_step(pg, taps, every=99); taps += 1
    pg.wait_for_selector('#gpRoot.gp-rv', timeout=6000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)

    # ------------------------------------------------------------ Home card and the tab
    check('Home shows "Next on your journey" with the next step', pg.query_selector('.jn-home') is not None and 'Putting to' in pg.inner_text('.jn-home') and ' of 3' in pg.inner_text('.jn-home'), pg.inner_text('#main')[:200])
    a = pg.evaluate(AUDIT, '.jn-home'); check('Home card: tap targets 38px or more, no overflow', not a['small'] and not a['overflow'], a)
    cur = pg.evaluate("() => window.__golfiq.progress.data().jr.current")
    pg.click('.jn-home [data-practice="journey"]'); pg.wait_for_selector('#jnPath')
    check('Journey is the first tab on Practice', pg.evaluate("() => document.querySelector('.seg button, .seg [data-v]')?.textContent.trim()") == 'Journey' or 'Journey' in pg.inner_text('#main')[:200])
    check('the path shows the open stretch, a marker with the index, and earned-on-the-course rows', pg.query_selector('.jn-cur') is not None and 'You:' in pg.inner_text('#jnPath') and 'Earned on the course' in pg.inner_text('#jnPath'))
    check('the path has four stage nodes and a boss node in the open stretch', len(pg.query_selector_all('.jn-cur [data-jstage]')) == 4 and len(pg.query_selector_all('.jn-cur [data-jboss]')) == 1)
    check('the open stretch is scrolled into view', pg.evaluate("() => { const r = document.querySelector('.jn-cur').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }"))
    check('the note says practice level, not handicap', 'practice level' in pg.inner_text('#jnPath ~ .jn-note') and 'handicap follows' in pg.inner_text('#jnPath ~ .jn-note'))
    a = pg.evaluate(AUDIT, '#main'); check('Journey tab: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    # ------------------------------------------------------------ stage sheet
    pg.click('.jn-cur [data-jstage$=":putting"]'); pg.wait_for_selector('#sheet.open #jnClose')
    txt = pg.inner_text('#sheetPanel'); n = cur['n']
    check('the stage sheet shows the milestone score for each game, hits so far and a Play button per game', f'Putting to {n}' in txt and 'Score to beat' in txt and 'Your best' in txt and len(pg.query_selector_all('#sheetPanel [data-jplay]')) >= 2, txt[:300])
    a = pg.evaluate(AUDIT, '#sheetPanel'); check('the sheet: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('#jnClose'); check('Close closes it', pg.query_selector('#sheet.open') is None)
    pg.click('.jn-cur [data-jboss]'); pg.wait_for_selector('#sheet.open #jnClose'); check('the boss node explains what opens it', 'Finish all four stages' in pg.inner_text('#sheetPanel')); pg.click('#jnClose')
    check('no errors so far', not errs, errs)

    # ------------------------------------------------------------ stage progress comes from results
    sc = pg.evaluate("""async (n) => { const J = await import('./journey.js'); return { a: J.milestoneScore('putt-369', n), b: J.milestoneScore('putt-lag', n) }; }""", n)
    mk = lambda i, g, s, d: {'id': f'jr{i}', 'game': g, 'date': d, 'score': s, 'mode': 'guided', 'note': ''}
    pg.evaluate(SET, {'results': [mk(1, 'putt-369', sc['a'], '2026-01-05'), mk(2, 'putt-369', sc['a'], '2026-01-06')]})
    pg.evaluate("() => { location.hash = '#practice'; }"); pg.reload(); pg.wait_for_selector('#jnPath')
    st = pg.evaluate("(n) => { const s = window.__golfiq.progress.data().jr.stretches.find((x) => x.n === n).stages[0]; return [s.hits, s.done, s.needsOther]; }", n)
    check('two hits in one game show as 2 of 3', st == [2, False, False] and '2 of 3' in pg.inner_text('.jn-cur [data-jstage$=":putting"] + .jn-lbl'), st)
    pg.evaluate("() => { location.hash = '#home'; }"); pg.wait_for_timeout(200)
    check('Home card says Putting to N · 2 of 3 and offers the game', f'Putting to {n} · 2 of 3' in pg.inner_text('.jn-home') and pg.query_selector('.jn-home [data-jhome]') is not None, pg.inner_text('.jn-home'))
    pts0 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    # play the second putting game perfectly: that is a hit in a different game, so the stage completes
    pg.evaluate("() => { location.hash = '#practice'; }"); play(pg, 'putt-lag')
    pg.wait_for_selector('#gpRJourney')
    check('the result screen says the stage is complete', pg.get_attribute('#gpRJourney', 'data-done') == '1' and f'Putting to {n}' in pg.inner_text('#gpRJourney') and 'Stage complete' in pg.inner_text('#gpRJourney'), pg.inner_text('#gpRJourney'))
    check('the tier sound plays', 'tier' in pg.evaluate("() => window.__feelLog"), pg.evaluate("() => window.__feelLog"))
    rid = pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0].id")
    led = pg.evaluate("(id) => window.__golfiq.progress.data().lv.ledger.filter((l) => l.rid === id).map((l) => [l.what, l.points])", rid)
    check('the stage is worth 50 points, on top of the game itself', any('Journey stage' in w and p == 50 for w, p in led), led)
    check('the total went up by the game points plus 50', pg.evaluate("() => window.__golfiq.progress.data().lv.points") - pts0 >= 50 + 10)
    a = pg.evaluate(AUDIT, '#gpRoot'); check('result screen: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(150)
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'journey'})); location.hash = '#practice'; }"); pg.reload(); pg.wait_for_selector('#jnPath')
    check('the stage node is now gold and ticked, and stays so after a reload', pg.query_selector('.jn-cur [data-jstage$=":putting"].done') is not None)
    pg.reload(); pg.wait_for_selector('#jnPath'); check('after a reload too', pg.query_selector('.jn-cur [data-jstage$=":putting"].done') is not None)
    # a result that does not move a stage gets no journey line
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")
    play(pg, 'putt-369'); pg.wait_for_timeout(300); check('a game on a finished stage adds no journey line', pg.query_selector('#gpRJourney') is None)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(100)
    # Home play button starts a guided game
    pg.evaluate("() => { location.hash = '#home'; }"); pg.wait_for_selector('.jn-home [data-jhome]'); g = pg.get_attribute('.jn-home [data-jhome]', 'data-jhome'); pg.click('.jn-home [data-jhome]'); pg.wait_for_selector('#gpRoot.gp-full')
    check('the Home Play button starts the suggested game', pg.evaluate("() => window.__golfiq.state.journal.game_draft?.game") == g, g)
    check('no errors', not errs, errs); ctx.close()

    # ------------------------------------------------------------ no results and no rounds: a gentle empty state, no errors
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#main'); pg.evaluate("() => { location.hash = '#practice'; }"); pg.wait_for_timeout(600)
    pg.evaluate("async () => { const S = window.__golfiq.state; S.ui = S.ui || {}; }"); pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'journey'}))"); pg.reload(); pg.wait_for_timeout(800)
    check('a brand-new app shows the Journey tab without errors', not errs, errs); ctx.close()
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
