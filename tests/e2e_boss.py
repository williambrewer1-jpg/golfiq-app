"""Browser test for phase R3 (boss games): ready -> start -> five games -> pass / not this time, the pips, one attempt a day, quitting, points, the next stretch
opening, and the boss fields on the friends' score document (fake Firebase). 390x844, sample data. Run: python3 tests/e2e_boss.py"""
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
FAKE = open(os.path.join(HERE, 'fake_firebase.js')).read()
GLUE = """(() => { window.__fb = makeFakeFirebase(); const real = window.fetch.bind(window);
  window.fetch = (u, i) => /googleapis\\.com/.test(String(u)) ? window.__fb.fetch(String(u), i) : real(u, i); })();"""
AUDIT = """(sel) => { const root = document.querySelector(sel) || document.body, bad = [];
  for (const el of root.querySelectorAll('button, input, select, a.btn')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 20) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
SET = """async (j) => { const g = window.__golfiq, S = await import('./store.js'); Object.assign(g.state.journal, j); await S.saveJournal(g.state); }"""
# two hits at the milestone score in each of the eight games of the four stages, so all four stages of the open stretch are done
MAKE = """async () => { const J = await import('./journey.js'), jr = window.__golfiq.progress.data().jr, n = jr.current.n, ids = ['putt-369', 'putt-lag', 'chip-updown', 'chip-par18', 'range-greens', 'combine', 'range-driver', 'range-fairways'], out = [];
  ids.forEach((g, i) => { for (let k = 0; k < 2; k++) out.push({ id: `s${i}${k}`, game: g, date: '2026-01-0' + (k + 1), score: J.milestoneScore(g, n), mode: 'guided', note: '' }); });
  return { n, results: out }; }"""
def taps_left(pg): return pg.query_selector('#gpRoot:not(.gp-rv) [data-gp], #gpRoot:not(.gp-rv) [data-gpball]') is not None
def play_game(pg, every):
    pg.wait_for_selector('#gpRoot.gp-full'); taps = 0
    while taps_left(pg) and taps < 60: answer_step(pg, taps, every=every); taps += 1
    pg.wait_for_selector('#gpRoot.gp-rv', timeout=6000)
def fresh(b, cloud=False):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.add_init_script(FAKE); pg.add_init_script(GLUE)
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    m = pg.evaluate(MAKE); pg.evaluate(SET, {'results': m['results']})
    if cloud: pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.cloud = { apiKey: 'k', projectId: 'p', group: 'grp1', groupName: 'Mates', nick: 'Wills' }; await S.saveCloud(st); }""")
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'journey'})); location.hash = '#practice'; }"); pg.reload(); pg.wait_for_selector('#jnPath')
    return ctx, pg, errs, m['n']
def start_boss(pg, n):
    pg.click(f'.jn-cur [data-jboss="{n}"]'); pg.wait_for_selector('#sheet.open [data-gpboss]'); pg.click('[data-gpboss]'); pg.wait_for_selector('#gpRoot.gp-boss.gp-full')
def run_boss(pg, every):
    """Plays every game of the boss; returns after the summary shows."""
    for i in range(5):
        play_game(pg, every)
        pg.click('[data-gpsesnext]' if i < 4 else '[data-gpsesend]')
        if i < 4: pg.wait_for_selector('#gpRoot.gp-full')
    pg.wait_for_selector('#gpRoot[data-boss], #gpRoot.gp-boss .gp-rverdict')

with sync_playwright() as p:
    b = p.chromium.launch()

    # ------------------------------------------------------------ the boss opens when four stages are done; the play screen
    ctx, pg, errs, n = fresh(b, cloud=True)
    st = pg.evaluate("(n) => window.__golfiq.progress.data().jr.stretches.find((s) => s.n === n).boss.state", n)
    check('with all four stages done the boss is ready, and Home offers it', st == 'ready' and pg.evaluate("() => window.__golfiq.progress.data().jr.current.next.kind") == 'boss')
    pg.click(f'.jn-cur [data-jboss="{n}"]'); pg.wait_for_selector('#sheet.open'); txt = pg.inner_text('#sheetPanel')
    check('the boss sheet offers Start, with the format and the pressure finish', 'Start the boss game' in txt and 'Five games back to back' in txt and 'Pressure finish is on' in txt, txt[:300])
    a = pg.evaluate(AUDIT, '#sheetPanel'); check('the boss sheet: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a); pg.click('#jnClose')
    start_boss(pg, n)
    check('the boss screen has its own look, the five pips and the stretch name', pg.query_selector('.gp-bpips') is not None and len(pg.query_selector_all('.gp-bpips .gp-bdots i')) == 5 and f'Beat the {n}' in pg.inner_text('.gp-bpips'))
    tgt = pg.inner_text('.gp-tgt'); check('the target strip shows the boss target', tgt.startswith('Boss target'), tgt)
    d = pg.evaluate("() => { const d = window.__golfiq.state.journal.game_draft; return [d.pressure, d.boss, d.session_id.startsWith('boss')]; }")
    check('pressure finish is on and the draft carries the boss number', d == [True, n, True], d)
    a = pg.evaluate(AUDIT, '#gpRoot'); check('the boss play screen: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    # first game, then a result screen between games
    play_game(pg, 99)
    check('the result between games shows the pips, a status line and the next game', pg.query_selector('#gpRoot.gp-boss .gp-bstatus') is not None and 'to play' in pg.inner_text('.gp-bstatus') or 'boss is passed' in pg.inner_text('.gp-bstatus'), pg.inner_text('.gp-bstatus'))
    r0 = pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0]")
    check('the saved result carries the boss number and the pressure finish', r0.get('boss') == n and r0.get('pressure') is True, r0)
    a = pg.evaluate(AUDIT, '#gpRoot'); check('the boss result screen: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-full')
    for i in range(1, 5):
        play_game(pg, 99); pg.click('[data-gpsesnext]' if i < 4 else '[data-gpsesend]')
        if i < 4: pg.wait_for_selector('#gpRoot.gp-full')
    pg.wait_for_selector('#gpRoot[data-boss], #gpRoot .gp-bnum')
    bs = pg.evaluate("() => window.__golfiq.state.journal.journey.bosses")
    tally = pg.evaluate("""async ([n, sc]) => { const BS = await import('./boss.js'); const t = BS.tally(n, sc, { games: window.__golfiq.progress.data().sk ? [...(await import('./features.js')).DEFAULT_GAMES] : [] }); return [t.hits, t.passed]; }""", [n, bs[0]['scores']])
    check('one attempt is stored with n, date, results, scores, and it agrees with the pass rule', len(bs) == 1 and bs[0]['n'] == n and len(bs[0]['results']) == 5 and bs[0]['passed'] == tally[1], bs)
    passed = bs[0]['passed']
    allr = pg.evaluate("(ids) => window.__golfiq.state.journal.results.filter((r) => ids.includes(r.id)).map((r) => [r.boss, r.pressure])", bs[0]['results'])
    check('all five results carry the boss number and the pressure finish', allr == [[n, True]] * 5, allr)
    if passed:
        check('a pass shows the big stamped number, "Boss passed", and 150 points', 'boss passed' in pg.inner_text('#gpRoot').lower() and f'Beat the {n}' in pg.inner_text('#gpRoot') and '+150 points' in pg.inner_text('#gpRoot'), pg.inner_text('#gpRoot')[:200])
        log = pg.evaluate("() => window.__feelLog"); w = len(log) - 1 - log[::-1].index('win') if 'win' in log else -1; check('win then tier sounds play', w >= 0 and 'tier' in log[w:], log[-12:])   # order, not position: the streak sound may follow
        led = pg.evaluate("() => window.__golfiq.progress.data().lv.ledger.filter((l) => l.what.startsWith('Boss game passed')).map((l) => l.points)"); check('the ledger has the 150 points', led == [150], led)
        check('the next stretch opens on the path', pg.evaluate("(n) => { const j = window.__golfiq.progress.data().jr; return j.stretches.find((s) => s.n === n).state === 'done' && j.current && j.current.n < n; }", n))
        a = pg.evaluate(AUDIT, '#gpRoot'); check('the pass screen: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    else:
        check('a miss says "Not this time" and never "failed"', 'Not this time' in pg.inner_text('#gpRoot') and 'fail' not in pg.inner_text('#gpRoot').lower(), pg.inner_text('#gpRoot')[:300])
        check('and lists the games that were short, with practice buttons', 'short' in pg.inner_text('#gpRoot') and len(pg.query_selector_all('#gpRoot [data-gpstart]')) >= 1)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(200)
    # friends: only the last game's score document has the boss fields
    scores = pg.evaluate("() => window.__fb.read('groups/grp1/scores')")
    withboss = [s for s in scores if s.get('boss')]
    check('the shared score for the final game carries the boss number (and boss_passed only when passed)', len(withboss) == 1 and withboss[0]['boss'] == n and (withboss[0].get('boss_passed') is True) == passed and len(withboss[0]) <= 20, withboss)
    check('no errors', not errs, errs); ctx.close()

    # ------------------------------------------------------------ not this time: misses everywhere (a miss on every tap), one attempt a day, practice buttons
    ctx, pg, errs, n = fresh(b)
    start_boss(pg, n)
    for i in range(5):
        play_game(pg, 1)
        if i == 1: check('after two short games the status says a pass is out of reach, not that it failed', 'out of reach' in pg.inner_text('.gp-bstatus') and 'fail' not in pg.inner_text('.gp-bstatus').lower(), pg.inner_text('.gp-bstatus'))
        pg.click('[data-gpsesnext]' if i < 4 else '[data-gpsesend]')
        if i < 4: pg.wait_for_selector('#gpRoot.gp-full')
    pg.wait_for_selector('#gpRoot .gp-bnum')
    txt = pg.inner_text('#gpRoot'); bs = pg.evaluate("() => window.__golfiq.state.journal.journey.bosses")
    check('the attempt is stored as not passed', len(bs) == 1 and bs[0]['passed'] is False)
    check('"Not this time", the games that were short and by how much, and a note that tomorrow is another go', 'Not this time' in txt and ' short' in txt and 'tomorrow' in txt and 'fail' not in txt.lower(), txt[:400])
    check('each short game has a practice button', len(pg.query_selector_all('#gpRoot [data-gpstart]')) >= 3)
    a = pg.evaluate(AUDIT, '#gpRoot'); check('the not-this-time screen: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(200)
    check('the stretch is not done and the next one is still locked', pg.evaluate("(n) => window.__golfiq.progress.data().jr.stretches.find((s) => s.n === n).state", n) == 'open')
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'journey'})); location.hash = '#practice'; }"); pg.reload(); pg.wait_for_selector('#jnPath')
    pg.click(f'.jn-cur [data-jboss="{n}"]'); pg.wait_for_selector('#sheet.open'); txt = pg.inner_text('#sheetPanel')
    check('a second attempt the same day is not offered, and the last attempt is shown', pg.query_selector('#sheetPanel [data-gpboss]') is None and "today's attempt" in txt and 'Last attempt' in txt, txt[:300])
    pg.click('#jnClose')
    pg.evaluate("() => window.__golfiq.guided.startBoss(%d)" % n); pg.wait_for_timeout(300)
    check('and starting it from code does nothing either', pg.evaluate("() => !window.__golfiq.state.journal.session_run && !window.__golfiq.state.journal.game_draft"))
    check('no errors', not errs, errs); ctx.close()

    # ------------------------------------------------------------ quitting: no game finished = no attempt; one finished = an attempt
    ctx, pg, errs, n = fresh(b)
    start_boss(pg, n); pg.click('[data-gpquit]'); pg.wait_for_timeout(300)
    check('quitting before any game is finished does not use the attempt', not pg.evaluate("() => (window.__golfiq.state.journal.journey?.bosses || []).length") and not pg.evaluate("() => window.__golfiq.state.journal.session_run"))
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'journey'})); location.hash = '#practice'; }"); pg.reload(); pg.wait_for_selector('#jnPath'); start_boss(pg, n)
    play_game(pg, 99); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-full'); pg.click('[data-gpquit]'); pg.wait_for_timeout(400)
    bs = pg.evaluate("() => window.__golfiq.state.journal.journey?.bosses || []")
    check('quitting after one finished game counts as today\'s attempt, with that one result kept', len(bs) == 1 and len(bs[0]['results']) == 1 and bs[0]['passed'] is False, bs)
    check('no errors', not errs, errs); ctx.close()
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
