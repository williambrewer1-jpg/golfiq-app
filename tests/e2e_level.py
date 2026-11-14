"""Browser test for phase R1 (player level, streak freeze, welcome back), at a 390x844 phone with the built-in sample data and a fake Firebase.
Run: python3 tests/e2e_level.py"""
import http.server, threading, functools, sys, os, re, json
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
from play_helpers import answer_step, settle
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
  window.fetch = (u, i) => /googleapis\\.com/.test(String(u)) ? window.__fb.fetch(String(u), i) : real(u, i);
  try { for (const [p, o] of JSON.parse(sessionStorage.getItem('fbseed') || '[]')) window.__fb.put(p, o); } catch (e) {} })();"""
# overflow, inputs under 16px and tap targets under 38px inside a root
AUDIT = """(sel) => { const root = document.querySelector(sel) || document.body, bad = [];
  for (const el of root.querySelectorAll('button, input, select, a.btn')) { const r = el.getBoundingClientRect(); if (r.height && r.height < 38) bad.push((el.textContent || el.id).trim().slice(0, 20) + ':' + Math.round(r.height)); }
  const small = [...root.querySelectorAll('input, select, textarea')].filter((e) => e.getBoundingClientRect().height && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.name);
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad, fonts: small }; }"""
SET = """async (j) => { const g = window.__golfiq, S = await import('./store.js'); Object.assign(g.state.journal, j); await S.saveJournal(g.state); }"""
WEEKS = """(ks) => { const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10), m = new Date(); m.setHours(12, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return ks.map((k) => { const d = new Date(m.getTime()); d.setDate(d.getDate() - 7 * k); return iso(d); }); }"""
def taps_left(pg): return pg.query_selector('#gpRoot:not(.gp-rv) [data-gp], #gpRoot:not(.gp-rv) [data-gpball]') is not None
def play(pg, gid, welcome=None):
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")
    if welcome: pg.evaluate("([id, t]) => window.__golfiq.guided.start(id, { welcome_back: true, target: t })", [gid, welcome])
    else: pg.evaluate("(id) => window.__golfiq.guided.start(id)", gid)
    pg.wait_for_selector('#gpRoot.gp-full'); taps = 0
    while taps_left(pg) and taps < 60:
        answer_step(pg, taps, every=99); taps += 1
    pg.wait_for_selector('#gpRoot.gp-rv', timeout=6000)
def fresh(b, clock=None):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true'); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort()); pg.add_init_script(FAKE); pg.add_init_script(GLUE)
    if clock: pg.clock.set_fixed_time(clock)
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()

    # ------------------------------------------------------------------ the rank chip, the sheet, the layout
    ctx, pg, errs = fresh(b)
    pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    lv = pg.evaluate("() => { const l = window.__golfiq.progress.data().lv; return { points: l.points, rank: l.rank.name, n: l.rank.n, seen: window.__golfiq.state.journal.level_seen }; }")
    check('the sample data shows a sensible rank on Home', lv['points'] > 150 and lv['rank'] in pg.inner_text('.lvchip'), lv)
    check('the first time, the rank already held is the starting point, not a celebration', pg.query_selector('#lvMoment') is None and lv['seen'] == lv['n'], lv)
    check('the chip says how far the next rank is', 'points to' in pg.inner_text('.lvchip'), pg.inner_text('.lvchip'))
    a = pg.evaluate(AUDIT, '#main'); check('Home: no horizontal overflow, tap targets 38px or more, inputs 16px or more', not a['overflow'] and not a['small'] and not a['fonts'], a)
    pg.click('.lvchip'); pg.wait_for_selector('#sheet.open #lvClose')
    txt = pg.inner_text('#sheetPanel')
    check('the Your level sheet shows the rank, the points, recent lines and the points table', all(x in txt for x in [lv['rank'], 'points to', 'Recent points', 'How points are earned', 'A round (9 holes count half)', 'Welcome-back game: double points']), txt[:300])
    check('the sheet has at most 20 ledger lines', pg.evaluate("() => document.querySelectorAll('#sheetPanel .lvled > div').length") <= 20)
    a = pg.evaluate(AUDIT, '#sheetPanel'); check('the sheet: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    check('the sheet says it is a practice level, not a handicap', 'not a handicap' in txt)
    pg.click('#lvClose'); check('Close closes the sheet', pg.query_selector('#sheet.open') is None)
    pg.evaluate("() => { location.hash = '#practice'; }"); pg.wait_for_timeout(200)
    check('no errors so far', not errs, errs)

    # ------------------------------------------------------------------ points on the result screen, and a rank-up after a game
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))")
    n0 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    play(pg, 'putt-369'); pg.wait_for_selector('#gpRPts')
    rid = pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0].id"); shown = int(pg.get_attribute('#gpRPts', 'data-to'))
    led = pg.evaluate("(id) => window.__golfiq.progress.data().lv.ledger.filter((l) => l.rid === id).reduce((t, l) => t + l.points, 0)", rid)
    check('the result screen has a points chip that matches the ledger', shown > 0 and shown == led and pg.inner_text('#gpRPts').startswith('+'), (shown, led, pg.inner_text('#gpRPts')))
    n1 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    check('and the total went up by exactly that much', n1 - n0 == shown, (n0, n1, shown))
    check('the chip also says where the total stands', 'total' in pg.inner_text('#gpRPtsBox'), pg.inner_text('#gpRPtsBox'))
    a = pg.evaluate(AUDIT, '#gpRoot'); check('result screen: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(100)
    # rank-up: pretend the golfer was shown one rank lower, then play: the moment shows once, with the rank stamped in
    pg.evaluate(SET, {'level_seen': 3}); pg.evaluate("() => { window.__golfiq.progress.data(); }")
    pg.evaluate("() => { window.__feelTest = true; window.__feelLog = []; }")
    play(pg, 'putt-369'); pg.wait_for_selector('#lvMoment', timeout=4000)
    now = pg.evaluate("() => window.__golfiq.progress.data().lv.rank")
    check('ranking up shows the moment with the new rank name', now['name'] in pg.inner_text('#lvMoment') and 'new rank' in pg.inner_text('#lvMoment').lower(), (now, pg.inner_text('#lvMoment')))
    check('it plays the tier sound and the rank is remembered', 'tier' in pg.evaluate("() => window.__feelLog") and pg.evaluate("() => window.__golfiq.state.journal.level_seen") == now['n'])
    a = pg.evaluate(AUDIT, '#lvMoment'); check('the moment: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('#lvmOk'); check('Continue dismisses it', pg.query_selector('#lvMoment') is None)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(150)
    check('it does not come back after another draw', pg.query_selector('#lvMoment') is None)
    pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip'); pg.wait_for_timeout(300); check('or after a reload', pg.query_selector('#lvMoment') is None)
    check('no errors', not errs, errs)
    ctx.close()

    # ------------------------------------------------------------------ streak freeze
    ctx, pg, errs = fresh(b)
    wk = pg.evaluate(WEEKS, [5, 4, 3, 2])
    res = [{'id': f'f{i}', 'game': 'putt-369', 'date': d, 'score': 5, 'mode': 'guided', 'note': ''} for i, d in enumerate(wk)]
    ses = [{'id': 'sesF', 'date': wk[0], 'minutes': 30, 'focus': 'other', 'notes': 'Guided session: x', 'guided': True, 'complete': True, 'results': []}]
    pg.evaluate(SET, {'results': res, 'sessions': ses, 'freeze_seen': None}); pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    check('a freeze spent on the missed week shows the line once on Home', pg.query_selector('[data-freezeline]') is not None and 'A freeze saved your 4-week streak. Earn another by finishing a session.' in pg.inner_text('[data-freezeline]'), pg.inner_text('#main')[:300])
    st = pg.evaluate("() => { const s = window.__golfiq.progress.data().st; return { current: s.current, held: s.freezes_held, frozen: s.frozen_weeks.length, seen: window.__golfiq.state.journal.freeze_seen }; }")
    check('the streak is intact: 4 weeks, no freeze left, one week covered', st['current'] == 4 and st['held'] == 0 and st['frozen'] == 1 and st['seen'], st)
    a = pg.evaluate(AUDIT, '#main'); check('Home with the freeze line: no overflow, tap targets 38px or more', not a['overflow'] and not a['small'], a)
    pg.click('[data-freezeok]'); check('Got it hides the line', pg.query_selector('[data-freezeline]') is None)
    pg.reload(); pg.wait_for_selector('.lvchip'); check('and it does not show again after a reload', pg.query_selector('[data-freezeline]') is None)
    check('Home shows the shield with the number held beside the streak', pg.query_selector('a.prog-home .shield') is not None and pg.inner_text('a.prog-home .shield').strip() == '0', pg.inner_text('a.prog-home')[:200])
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'})); location.hash = '#practice'; }"); pg.reload(); pg.wait_for_selector('.strip12')
    check('Progress shows a shield in the 12-week strip for the covered week', len(pg.query_selector_all('.strip12 i.fz')) == 1)
    check('and the shield count beside the streak', pg.query_selector('.streak ~ p .shield') is not None)
    a = pg.evaluate(AUDIT, '#main'); check('Progress: no overflow', not a['overflow'], a)
    # earning: finish a full session, the freeze count goes up (a session that ended early does not earn one)
    pg.evaluate(SET, {'sessions': ses + [{'id': 'sesQ', 'date': wk[3], 'minutes': 30, 'focus': 'other', 'notes': 'x', 'guided': True, 'results': []}]})
    check('a session that was stopped early earns no freeze', pg.evaluate("() => window.__golfiq.progress.data().st.freezes_held") == 0)
    check('no errors', not errs, errs); ctx.close()

    # ------------------------------------------------------------------ welcome back
    ctx, pg, errs = fresh(b, clock='2027-03-15T10:00:00')
    res = [{'id': f'w{i}', 'game': 'putt-lag', 'date': f'2027-02-0{i + 1}', 'score': s, 'mode': 'guided', 'note': ''} for i, s in enumerate([4, 6, 5])]
    pg.evaluate(SET, {'results': res, 'sessions': []}); pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    check('after 40 days away the Welcome back card replaces today\'s challenge on Home', pg.query_selector('[data-welcome="putt-lag"]') is not None and pg.query_selector('.gp-daily[data-daily]') is None)
    wtxt = pg.inner_text('[data-welcome]')
    check('it is the game played most, with the golfer\'s own median as the goal and no list of what was missed', 'Welcome back' in wtxt and 'Beat your usual score of 5' in wtxt and 'streak' not in wtxt.lower() and 'missed' not in wtxt.lower(), wtxt)
    a = pg.evaluate(AUDIT, '[data-welcome]'); check('the card: tap targets 38px or more', not a['small'], a)
    pg.click('[data-gpwelcome]'); pg.wait_for_selector('#gpRoot.gp-full')
    check('the game screen shows the personal target', 'Target 5 · your usual score' in pg.inner_text('.gp-tgt'), pg.inner_text('.gp-side'))
    taps = 0
    while taps_left(pg) and taps < 60:
        answer_step(pg, taps, every=99); taps += 1
    pg.wait_for_selector('#gpRoot.gp-rv #gpRPts', timeout=6000)
    r = pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0]")
    check('the result is marked welcome_back', r.get('welcome_back') is True and r['game'] == 'putt-lag', r)
    check('the screen says Back in the swing.', 'Back in the swing.' in pg.inner_text('.gp-hero'), pg.inner_text('.gp-hero'))
    check('and the target line is the personal one', 'Beat your usual score of 5' in pg.inner_text('.gp-rdet'), pg.inner_text('.gp-rdet'))
    led = pg.evaluate("(id) => window.__golfiq.progress.data().lv.ledger.filter((l) => l.rid === id)", r['id'])
    check('points are doubled and say so', len(led) == 1 and 'welcome back' in led[0]['what'] and led[0]['points'] % 2 == 0 and led[0]['points'] >= 20, led)
    pg.click('[data-gpdone]'); pg.wait_for_timeout(150); pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    check('afterwards the card is gone and Home is back to normal', pg.query_selector('[data-welcome]') is None and pg.query_selector('.gp-daily[data-daily]') is not None)
    check('no errors', not errs, errs); ctx.close()

    # 13 days is not enough
    ctx, pg, errs = fresh(b, clock='2027-03-15T10:00:00')
    pg.evaluate(SET, {'results': [{'id': 'z', 'game': 'putt-lag', 'date': '2027-03-02', 'score': 4, 'mode': 'guided', 'note': ''}], 'sessions': []}); pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    check('13 days away: no welcome card', pg.query_selector('[data-welcome]') is None)
    ctx.close()

    # ------------------------------------------------------------------ rank shared with the group, shown beside nicknames
    ctx, pg, errs = fresh(b)
    pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.cloud = { apiKey: 'k', projectId: 'p', group: 'grp1', groupName: 'Mates', nick: 'Wills' }; await S.saveCloud(st); }""")
    seed = pg.evaluate("""async () => { const B = await import('./bench.js'), today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), week = B.isoWeek();
      const docs = [['groups/grp1', { name: 'Mates', owner: 'uid-sam' }], ['groups/grp1/members/uid-sam', { nick: 'Sam', rank: 'Weekend golfer' }], ['groups/grp1/members/uid-kim', { nick: 'Kim' }],
        ['groups/grp1/scores/a1', { uid: 'uid-sam', nick: 'Sam', game: B.weeklyChallenge(week), game_name: 'x', better: 'higher', score: 5, level_h: 10, date: today, week, month: today.slice(0, 7) }]];
      sessionStorage.setItem('fbseed', JSON.stringify(docs)); return week; }""")
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'board'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('#lbWeek .lb', timeout=8000); pg.wait_for_timeout(500)
    mine = pg.evaluate("() => { const m = window.__fb.read('groups/grp1/members'); return m.map((x) => [x.nick, x.rank || null]); }")
    check('my rank was written to my member document', any(r[1] == 'Club player' for r in mine), mine)
    me = pg.evaluate("() => window.__fb.read('groups/grp1/members').find((m) => m.rank && m.rank !== 'Weekend golfer')")
    check('the rank field is on the member document (rank name only)', me is not None and me['rank'] in ['Rookie', 'Range regular', 'Weekend golfer', 'Club player', 'Medal player', 'Team player', 'Club champion', 'County player', 'Elite amateur', 'Legend'], me)
    check('a friend\'s rank shows beside their nickname on the board', 'Weekend golfer' in pg.inner_text('#lbWeek'), pg.inner_text('#lbWeek'))
    check('no errors', not errs, errs); ctx.close()
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
