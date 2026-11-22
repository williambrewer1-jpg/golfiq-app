"""Browser test for how-to-play: the sheet opens by itself before ball 1 of a game's first guided plays, can be reopened at any point,
keeps the game where it was, and every guided game shows a question above its answer buttons with buttons that say what they mean.
Run: python3 tests/e2e_howto.py"""
import http.server, threading, functools, os, json
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

GAMES = ['putt-par18', 'putt-369', 'putt-lag', 'putt-streak', 'chip-updown', 'chip-par18', 'chip-zone', 'range-fairways', 'range-greens', 'range-wedge', 'range-driver', 'range-speed', 'range-round']
SHEET_AUDIT = """() => { const r = (e) => e.getBoundingClientRect(), c = document.querySelector('#gpHow .gp-hcard'), out = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page overflow');
  const k = r(c); if (k.right > innerWidth + 1 || k.left < -1) out.push('sheet sticks out');
  const go = document.querySelector('#gpHow [data-gphowclose]'), g = r(go); if (g.height < 44) out.push('start button ' + g.height);
  if (c.scrollHeight > c.clientHeight + 1 && g.bottom > innerHeight) out.push('start button needs a scroll'); return out; }"""
def begin(pg, gid, **opts):
    pg.evaluate("([id, o]) => { window.__golfiq.state.journal.game_draft = null; window.__golfiq.guided.start(id, o); }", [gid, opts]); pg.wait_for_selector('#gpRoot.gp-full'); pg.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ctx.add_init_script('window.__feelTest = true; window.__howTest = true')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate("() => { const j = window.__golfiq.state.journal; j.results = (j.results || []).filter((r) => r.mode !== 'guided'); }")

    # ---- first play: the sheet is open before ball 1, with the four parts and a Start button; every game, both phone sizes
    for (w, h) in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': w, 'height': h}); bad = {}
        for gid in GAMES:
            begin(pg, gid)
            t = pg.inner_text('#gpHow') if pg.query_selector('#gpHow') else ''
            issues = ([] if t else ['no sheet']) + ([x for x in ['Set up', 'Each ball', 'What to tap', 'Scoring', 'Start'] if x.lower() not in t.lower()] if t else [])
            if t: issues += pg.evaluate(SHEET_AUDIT)
            if issues: bad[gid] = issues
        check(f'{w}x{h}: every guided game opens with how to play (set up, each ball, what to tap, scoring, Start), fitting the screen', not bad, json.dumps(bad))
    pg.set_viewport_size({'width': 390, 'height': 844})

    begin(pg, 'range-greens')
    check('the sheet names the target and what it means', 'Your target' in pg.inner_text('#gpHow') and 'handicapper scores' in pg.inner_text('#gpHow'), pg.inner_text('#gpHow'))
    check('the answer buttons cannot be tapped through the sheet', pg.evaluate("() => { const b = document.querySelector('[data-gp=\"1\"]'), q = b.getBoundingClientRect(), e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !b.contains(e); }"))
    pg.click('[data-gphowclose]'); pg.wait_for_timeout(200)
    check('Start closes the sheet and shows ball 1', pg.query_selector('#gpHow') is None and pg.evaluate("() => window.__golfiq.state.journal.game_draft.answers.length") == 0)
    q = pg.inner_text('#gpAsk'); prompt = pg.inner_text('.gp-prompt'); n = int(prompt.split()[0])
    check('the question above the buttons gives the 10% window for this distance', q == f'Did it finish within {max(1, round(n * 0.1))} yd of the target?', (q, prompt))
    check('the buttons say Inside and Outside', 'Inside' in pg.inner_text('[data-gp="1"]') and 'Outside' in pg.inner_text('[data-gp="0"]'))

    # ---- mid-game: reopen from the ? button and from the How to play link; the game stays where it was
    pg.click('[data-gp="1"]'); pg.wait_for_function("() => !document.querySelector('#gpRoot[data-busy]')"); pg.click('[data-gp="0"]'); pg.wait_for_function("() => !document.querySelector('#gpRoot[data-busy]')")
    pg.click('.gp-top [data-gphelp]'); pg.wait_for_selector('#gpHow')
    check('the ? button opens how to play mid-game, with "Back to the game"', 'Back to the game' in pg.inner_text('[data-gphowclose]'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check('Escape closes it', pg.query_selector('#gpHow') is None)
    pg.click('.gp-foot [data-gphelp]'); pg.wait_for_selector('#gpHow'); pg.click('[data-gphowclose]'); pg.wait_for_timeout(150)
    d = pg.evaluate("() => window.__golfiq.state.journal.game_draft")
    check('the How to play link opens it too, and closing keeps the two answers and the score', d['answers'] == [1, 0] and pg.inner_text('#gpScore') == '1' and pg.query_selector('#gpHow') is None, d['answers'])

    # ---- every game: a question above the buttons, buttons in that game's words
    bad = {}
    for gid in GAMES:
        begin(pg, gid); pg.click('[data-gphowclose]'); pg.wait_for_timeout(100)
        q = pg.inner_text('#gpAsk') if pg.query_selector('#gpAsk') else ''
        hit = pg.query_selector('[data-gp="1"]'); words = hit.inner_text().strip() if hit else None
        if not q: bad[gid] = 'no question'
        elif words is not None and pg.query_selector('[data-gp="0"]') and words in ('Hit', 'Miss'): bad[gid] = 'generic button ' + words
    check('every guided game asks a question above its buttons, and hit/miss buttons use the game\'s own words', not bad, json.dumps(bad))
    labels = {}
    for gid, want in [('putt-369', ('Holed', 'Missed')), ('putt-lag', ('Inside 3 ft', 'Outside')), ('chip-updown', ('Saved', 'Missed')), ('chip-zone', ('On the towel', 'Missed')), ('range-fairways', ('Fairway', 'Missed')), ('range-round', ('Worked', "Didn't work"))]:
        begin(pg, gid); pg.click('[data-gphowclose]'); pg.wait_for_timeout(100)
        got = (pg.inner_text('[data-gp="1"]').strip(), pg.inner_text('[data-gp="0"]').strip())
        if got != want: labels[gid] = got
    check('button words match the game', not labels, json.dumps(labels))

    # ---- after two guided plays the sheet no longer opens by itself, but the ? button still works
    pg.evaluate("() => { const j = window.__golfiq.state.journal; j.results.push({ id: 'h1', game: 'putt-369', date: '2026-11-01', score: 5, mode: 'guided' }, { id: 'h2', game: 'putt-369', date: '2026-11-02', score: 6, mode: 'guided' }); }")
    begin(pg, 'putt-369')
    check('a game played twice before starts straight at ball 1', pg.query_selector('#gpHow') is None and pg.query_selector('.gp-top [data-gphelp]') is not None)

    # ---- the Games tab shows the same four steps, and the benchmark detail is folded away
    pg.once('dialog', lambda d: d.accept()); pg.click('[data-gpquit]'); pg.wait_for_function("() => !window.__golfiq.state.journal.game_draft")
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: 'chip-zone'})); }"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('#gpPlay')
    t = pg.inner_text('#gpPlay')
    check('Games tab: the game card has the aim and the four numbered steps', 'Land your chips on a spot' in t and all(x in t for x in ['Set up', 'Each ball', 'What to tap', 'Scoring']), t[:300])
    check('Games tab: handicap benchmarks are folded into a details row', pg.query_selector('#gpPlay details summary') is not None and 'Handicap benchmarks' in t)
    check('no page errors', not errs, errs[:3])
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
if fails: raise SystemExit(1)
