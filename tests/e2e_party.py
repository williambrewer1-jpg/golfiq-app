"""Browser test for practice with a friend (first-run plan, phases C1 and C2): the set-up sheet, a two-player and a four-player game end to end, hand-over screens, turn rotation,
undo across a hand-over, a reload in the middle of a game, only the owner's result saved and shared (against the fake Firebase), and the layout at 390x844 and 320x568
with a fresh app and with the sample data. Phase C2: the podium (win sound and confetti), the owner's own score under it, the share text, rematch with a new seed,
the day's series, next game with the same group, the won-drawn-lost record on the sheet and the podium, and the +5 for a game with a friend. Run: python3 tests/e2e_party.py"""
import http.server, threading, functools, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from play_helpers import settle, answer_step
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
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
GLUE = """(() => { window.__fb = makeFakeFirebase({}); const real = window.fetch.bind(window);
  window.fetch = (u, i) => /googleapis\\.com/.test(String(u)) ? window.__fb.fetch(String(u), i) : real(u, i); })();"""
AUDIT = """(sel) => { const bad = [];
  for (const el of document.querySelectorAll(sel + ' button')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.getAttribute('aria-label') || el.textContent).trim().slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  for (const el of document.querySelectorAll(sel + ' input:not([type=checkbox]):not([type=radio]):not([type=range]), ' + sel + ' select')) { if (parseFloat(getComputedStyle(el).fontSize) < 16) bad.push('font ' + (el.name || el.id)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
SEED_CLOUD = """async () => { const S = await import('./store.js'), st = window.__golfiq.state;
  st.cloud = { apiKey: 'k', projectId: 'p', group: 'grp1', groupName: 'Mates', nick: 'Wills', auth: { idToken: 'tok-x', refreshToken: 'ref-x', uid: 'uid-1', exp: Date.now() + 30 * 864e5 } }; await S.saveCloud(st); }"""

def page(b, w=390, h=844, sample=True, cloud=False):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    if cloud: pg.add_init_script(FAKE); pg.add_init_script(GLUE)
    pg.goto(URL); pg.wait_for_selector('#loadSample')
    if sample: pg.click('#loadSample'); pg.wait_for_timeout(1500)
    elif pg.query_selector('[data-obskip]'): pg.click('[data-obskip]'); pg.wait_for_timeout(400)      # a fresh app shows the first-run intro (part A); skipping it leaves the app with no data
    if cloud: pg.evaluate(SEED_CLOUD)
    return ctx, pg, errs

def games_tab(pg, game):
    pg.evaluate("(g) => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: g}))", game)
    pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpparty]', timeout=8000)

def setup(pg, guests, mode='straight', pressure=False):
    """Open the sheet, add friends (name, hcp) and start."""
    pg.click('[data-gpparty]'); pg.wait_for_selector('#sheet.open [data-gppstart]')
    for i, (name, hcp) in enumerate(guests):
        if i: pg.click('#sheet [data-pgadd]')
        pg.fill(f'#ptN{i}', name)
        if hcp is not None: pg.fill(f'#ptH{i}', str(hcp))
    if mode == 'handicap': pg.click('#sheet input[value=handicap]')
    if pressure: pg.check('#ptPressure')
    pg.click('#sheet [data-gppstart]'); pg.wait_for_selector('#gpRoot.gp-full')

def who(pg):
    """The name of the player the screen is about: on a hand-over screen the pill, on a play screen the pill at the top."""
    return pg.inner_text('#gpRoot .gp-who .gp-pill').strip()

def run(pg, limit=400, stop=None):
    """Play to the result. Returns the player names in the order their turns began (a new entry whenever the pill changes)."""
    order = []; taps = 0; n = 0
    while not pg.query_selector('.gp-rv') and n < limit:
        n += 1
        if stop and stop(pg): break
        if pg.query_selector('[data-gphand]'):
            nm = who(pg); order.append(nm); pg.click('[data-gphand]'); pg.wait_for_selector('#gpRoot .gp-prompt'); continue
        if not order: order.append(who(pg))
        answer_step(pg, taps); taps += 1
    return order

def party_state(pg): return pg.evaluate("() => { const d = window.__golfiq.state.journal.game_draft; return d && d.party ? { log: d.party.log.length, seen: d.party.seen, answers: d.party.players.map((p) => p.answers.length), mode: d.party.mode } : null; }")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ------------------------------------------------------------ the set-up sheet
    ctx, pg, errs = page(b, cloud=True); games_tab(pg, 'putt-369')
    check('the launcher has a Play with a friend button', pg.query_selector('[data-gpparty]') is not None)
    n0 = pg.evaluate("() => window.__golfiq.state.journal.results.length")
    pg.click('[data-gpparty]'); pg.wait_for_selector('#sheet.open [data-gppstart]')
    check('the sheet shows you and one friend, straight scoring picked', pg.input_value('#ptOwner') == 'Wills' and pg.query_selector('#ptN0') is not None and pg.is_checked('#sheet input[value=straight]'))
    check('handicap scoring is off until every player has a handicap', pg.is_disabled('#sheet input[value=handicap]'))
    pg.click('#sheet [data-gppstart]'); check('starting with no friend named shows a message and does not start', 'friend' in pg.inner_text('#ptErr').lower() and pg.query_selector('#gpRoot.gp-full') is None)
    pg.fill('#ptN0', 'Zed'); pg.fill('#ptH0', '20')
    check('with both handicaps the handicap choice opens up', not pg.is_disabled('#sheet input[value=handicap]'))
    a = pg.evaluate(AUDIT, '#sheetPanel'); check('sheet: no overflow, inputs 16px, taps 38px', not a['overflow'] and not a['small'], str(a))
    pg.click('#sheet [data-pgadd]'); pg.fill('#ptN1', 'Zed'); pg.click('#sheet [data-gppstart]')
    check('two players with the same name are refused', 'different' in pg.inner_text('#ptErr').lower())
    pg.fill('#ptN1', 'Kim'); pg.click('#sheet [data-pgadd]'); check('up to three friends, then the add button goes', pg.query_selector('#sheet [data-pgadd]') is None)
    pg.click('#sheet [data-pgrm="2"]'); pg.click('#sheet [data-pgrm="1"]')
    pg.click('#sheet input[value=handicap]'); pg.click('#sheet [data-gppstart]'); pg.wait_for_selector('#gpRoot.gp-full')
    st = party_state(pg); check('the draft carries the party in handicap mode', st and st['mode'] == 'handicap' and len(st['answers']) == 2, str(st))
    check('the game screen names whose turn it is, and shows the scoreboard', who(pg) == 'Wills' and pg.query_selector('#gpRoot .gp-board') is not None and len(pg.query_selector_all('#gpRoot .gp-pc')) == 2)

    # ------------------------------------------------------------ two players: stations, hand-over, undo across it, reload
    for k in range(3): answer_step(pg, 0)
    check('after the three 3 ft putts the phone is passed on', pg.query_selector('[data-gphand]') is not None and 'Zed' in pg.inner_text('[data-gphand]') and 'Pass the phone' in pg.inner_text('#gpRoot'))
    check('the hand-over screen shows the scoreboard and what is left', len(pg.query_selector_all('#gpRoot .gp-pc')) == 2 and '3 shots' in pg.inner_text('#gpRoot .gp-hsub'), pg.inner_text('#gpRoot .gp-hsub'))
    a = pg.evaluate(AUDIT, '#gpRoot'); check('hand-over screen layout (390x844)', not a['overflow'] and not a['small'], str(a))
    pg.click('[data-gpundo]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    st = party_state(pg); check('undo on the hand-over screen steps back one answer; the phone is still with Wills, so no hand-over', st['answers'] == [2, 0] and who(pg) == 'Wills' and pg.query_selector('[data-gphand]') is None, str(st))
    answer_step(pg, 0); pg.wait_for_selector('[data-gphand]')
    pg.click('[data-gphand]'); pg.wait_for_selector('#gpRoot .gp-prompt'); check('Zed is on turn at the same 3 ft shots', who(pg) == 'Zed' and '3 ft' in pg.inner_text('.gp-prompt'))
    pg.click('[data-gpundo]'); pg.wait_for_selector('[data-gphand]'); st = party_state(pg)
    check('undo on Zed\'s first shot goes back across the hand-over: the phone returns to Wills', st['answers'] == [2, 0] and 'Wills' in pg.inner_text('[data-gphand]'), str(st))
    pg.click('[data-gphand]'); pg.wait_for_selector('#gpRoot .gp-prompt'); answer_step(pg, 0); pg.wait_for_selector('[data-gphand]'); pg.click('[data-gphand]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    answer_step(pg, 0); answer_step(pg, 1)
    pg.reload(); pg.wait_for_selector('#gpRoot', timeout=8000); pg.wait_for_timeout(500)
    st = party_state(pg); check('a reload in the middle of a game keeps the party', st and st['answers'] == [3, 2], str(st))
    check('after the reload it is still Zed\'s turn', who(pg) == 'Zed' and pg.query_selector('[data-gphand]') is None)
    pg.click('[data-gpundo]'); settle(pg); st = party_state(pg); check('undo inside a turn only takes back that player\'s last answer', st['answers'] == [3, 1] and who(pg) == 'Zed', str(st))
    a = pg.evaluate(AUDIT, '#gpRoot'); check('play screen layout (390x844)', not a['overflow'] and not a['small'], str(a))
    order = run(pg)
    check('the game ends on the podium with both players', pg.query_selector('.gp-rv .gp-pod') is not None and len(pg.query_selector_all('.gp-pod .gp-podc')) == 2)
    check('the podium says who won, or that it is a tie', any(x in pg.inner_text('#gpVerdictL') for x in ['wins', 'tie']))
    check('a handicap game shows each margin on the podium', pg.inner_text('.gp-pod').count('on target') == 2, pg.inner_text('.gp-pod'))
    a = pg.evaluate(AUDIT, '#gpRoot'); check('result screen layout (390x844)', not a['overflow'] and not a['small'], str(a))

    # ------------------------------------------------------------ only the owner's result is saved and shared
    pg.wait_for_timeout(600)
    res = pg.evaluate("() => { const J = window.__golfiq.state.journal; return { n: J.results.length, last: J.results[J.results.length - 1], partners: J.partners, draft: J.game_draft }; }")
    check('exactly one result was saved (the owner\'s)', res['n'] == n0 + 1)
    last = res['last']; check('it is a normal guided result with the party record inside', last['mode'] == 'guided' and last['party']['mode'] == 'handicap' and [x['name'] for x in last['party']['players']] == ['Wills', 'Zed'], str(last.get('party')))
    check('the record has the owner marked and places for everyone', last['party']['players'][0].get('owner') is True and all(x['place'] in (1, 2) for x in last['party']['players']))
    check('the draft is cleared and the partner is remembered', res['draft'] is None and res['partners'] and res['partners'][0]['name'] == 'Zed' and res['partners'][0]['hcp'] == 20, str(res['partners']))
    posted = pg.evaluate("() => JSON.stringify([...window.__fb.docs.entries()])")
    check('nothing about the guest reached the (fake) group database', 'Zed' not in posted and '"party"' not in posted)
    check('the owner\'s own score did reach it, as for any game', '"putt-369"' in posted, posted[:200])
    pg.click('[data-gpdone]'); pg.wait_for_timeout(300)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: 'putt-369'}))"); pg.reload(); pg.wait_for_selector('[data-gpparty]')
    pg.click('[data-gpparty]'); pg.wait_for_selector('#sheet.open [data-gppstart]')
    check('Zed shows up as a recent partner', 'Zed' in pg.inner_text('.pt-chips'))
    pg.click('.pt-chip'); check('tapping a recent partner fills the friend row, handicap included', pg.input_value('#ptN0') == 'Zed' and pg.input_value('#ptH0') == '20')
    check('no page errors (two players)', not errs, str(errs[:2])); ctx.close()

    # ------------------------------------------------------------ four players: rotation, pressure, a streak game, a distance game
    ctx, pg, errs = page(b); games_tab(pg, 'putt-369')
    setup(pg, [('Sam', 18), ('Kim', 5), ('Al', 28)])
    check('four players on the scoreboard', len(pg.query_selector_all('#gpRoot .gp-pc')) == 4)
    order = run(pg)
    check('turns rotate each station (3 ft: Me first, 6 ft: Sam first, 9 ft: Kim first)', order == ['Me', 'Sam', 'Kim', 'Al', 'Sam', 'Kim', 'Al', 'Me', 'Kim', 'Al', 'Me', 'Sam'][:len(order)] and len(order) >= 11, str(order))
    check('four players on the podium, winner in the middle', len(pg.query_selector_all('.gp-pod .gp-podc')) == 4 and 'p1' in pg.get_attribute('.gp-pod .gp-podc:nth-child(2)', 'class'))
    pg.click('[data-gpdone]')
    games_tab(pg, 'putt-streak'); setup(pg, [('Sam', None)], pressure=False); order = run(pg)
    check('a streak game passes the phone on a miss and still ends', pg.query_selector('.gp-rv .gp-party') is not None, str(order))
    games_tab(pg, 'range-driver'); setup(pg, [('Sam', None)]); pg.wait_for_selector('#gpDist')
    check('a distance game has its own slider for each player', pg.query_selector('[data-gpball]') is not None)
    order = run(pg); check('the Driver test plays out for two players', pg.query_selector('.gp-rv .gp-party') is not None, str(order))
    pg.click('[data-gpdone]'); games_tab(pg, 'putt-par18'); setup(pg, [('Sam', 15)], mode='handicap', pressure=True); order = run(pg)
    check('a lower-is-better game with handicap scoring and a pressure finish plays out', pg.query_selector('.gp-rv .gp-party') is not None and 'on target' in pg.inner_text('.gp-pod'), pg.inner_text('#gpRoot')[:200])
    check('no page errors (four players and other games)', not errs, str(errs[:2])); ctx.close()

    # ------------------------------------------------------------ phase C2: podium, share, rematch, series, next game, record, points
    ctx, pg, errs = page(b); pg.add_init_script("navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }"); games_tab(pg, 'putt-369')
    LEDGER = """async () => { const L = await import('./level.js'), F = await import('./features.js');
      return L.playerLevel({ journal: window.__golfiq.state.journal, games: F.DEFAULT_GAMES }).ledger.filter((x) => /with a friend/.test(x.what)).length; }"""
    friend0 = pg.evaluate(LEDGER)
    setup(pg, [('Sam', 18)]); pg.evaluate("() => { window.__feelLog = []; }")
    run(pg, stop=None); pg.wait_for_timeout(400); log = pg.evaluate("() => (window.__feelLog || []).slice()")
    check('the podium plays the win sound and the confetti', 'win' in log and any(str(x).startswith('confetti') for x in log), str(log))
    check('your own score, verdict and rewards follow under "Your practice"', 'Your practice' in pg.text_content('.gp-pyou') and pg.query_selector('.gp-pyou #gpRNum') is not None and pg.query_selector('.gp-rewards') is not None)
    check('no series after the first game of the day', pg.query_selector('#gpSeries') is None)
    check('the record against Sam shows on the podium', 'Against Sam: won' in pg.inner_text('.gp-party'), pg.inner_text('.gp-party'))
    check('the buttons are Rematch, Next game and Done', [x.strip() for x in pg.eval_on_selector_all('.gp-rbtn button', 'els => els.map((e) => e.textContent)')] == ['Rematch', 'Next game', 'Done'])
    check('a game with a friend earns the +5 line', pg.evaluate(LEDGER) == friend0 + 1)
    pg.click('[data-gpsend]'); pg.wait_for_timeout(200); sh = pg.evaluate("() => window.__shared || null")
    check('"Send Sam the result" opens the share sheet with a short text and a link to the app', sh and 'Send Sam the result' in pg.inner_text('[data-gpsend]') and 'on BreakingPar' in sh['text'] and 'Sam' in sh['text'] and ('wins' in sh['text'] or 'tie' in sh['text']) and sh['url'].endswith('/index.html'), str(sh))
    a = pg.evaluate(AUDIT, '#gpRoot'); check('podium screen layout (390x844)', not a['overflow'] and not a['small'], str(a))
    first = pg.evaluate("() => { const r = window.__golfiq.state.journal.results; return r[r.length - 1]; }")
    pg.click('[data-gprematch]'); pg.wait_for_selector('#gpRoot.gp-full')
    d = pg.evaluate("() => { const d = window.__golfiq.state.journal.game_draft; return { game: d.game, seed: d.seed, names: d.party.players.map((p) => p.name), hcp: d.party.players.map((p) => p.hcp), log: d.party.log.length }; }")
    check('rematch: the same game and players, a new seed, nobody has played yet', d['game'] == 'putt-369' and d['names'] == ['Me', 'Sam'] and d['hcp'][1] == 18 and d['seed'] != first['seed'] and d['log'] == 0, str(d))
    run(pg); pg.wait_for_timeout(300)
    ser = pg.inner_text('#gpSeries') if pg.query_selector('#gpSeries') else ''
    check('after the second game the running series shows for the day', ser.startswith('Today:') and 'Me' in ser and 'Sam' in ser, ser)
    pg.evaluate("() => { window.__shared = null; }"); pg.click('[data-gpsend]'); pg.wait_for_timeout(200)
    check('the shared text carries the series', 'Today:' in (pg.evaluate("() => window.__shared && window.__shared.text") or ''))
    check('the +5 counts for the second game too', pg.evaluate(LEDGER) == friend0 + 2)
    pg.click('[data-gpnextp]'); pg.wait_for_selector('#gpRoot.gp-full')
    d = pg.evaluate("() => { const d = window.__golfiq.state.journal.game_draft; return { game: d.game, names: d.party.players.map((p) => p.name) }; }")
    check('next game keeps the group and moves to another game', d['game'] != 'putt-369' and d['names'] == ['Me', 'Sam'], str(d))
    pg.click('[data-gpquit]'); pg.wait_for_timeout(300)
    games_tab(pg, 'putt-369'); pg.click('[data-gpparty]'); pg.wait_for_selector('#sheet.open [data-gppstart]'); pg.fill('#ptN0', 'sam')
    check('the set-up sheet shows the record against a friend you have played', 'Against sam: won' in pg.inner_text('#sheetPanel .pt-rec') and sum(int(x) for x in __import__('re').findall(r'(\d+)', pg.inner_text('#sheetPanel .pt-rec'))) == 2, pg.inner_text('#sheetPanel .pt-rec'))
    pg.fill('#ptN0', 'Newcomer'); check('a new name shows no record', pg.inner_text('#sheetPanel .pt-rec').strip() == '')
    check('no page errors (phase C2)', not errs, str(errs[:2])); ctx.close()

    # ------------------------------------------------------------ layout at both phone sizes, fresh app and sample data
    for (w, h) in [(390, 844), (320, 568)]:
        for sample in (False, True):
            tag = f'{w}x{h} {"sample" if sample else "fresh"}'
            ctx, pg, errs = page(b, w, h, sample=sample); games_tab(pg, 'putt-369')
            pg.click('[data-gpparty]'); pg.wait_for_selector('#sheet.open [data-gppstart]'); pg.click('#sheet [data-pgadd]'); pg.click('#sheet [data-pgadd]')
            a = pg.evaluate(AUDIT, '#sheetPanel'); check(f'{tag}: set-up sheet with three friends', not a['overflow'] and not a['small'], str(a))
            pg.fill('#ptN0', 'Alexander'); pg.fill('#ptN1', 'Bartholomew'); pg.fill('#ptN2', 'Christopher'); pg.click('#sheet [data-gppstart]'); pg.wait_for_selector('#gpRoot.gp-full')
            a = pg.evaluate(AUDIT, '#gpRoot'); check(f'{tag}: play screen, four players, long names', not a['overflow'] and not a['small'], str(a))
            sheet_ok = pg.evaluate("() => { const r = document.querySelector('#gpRoot .gp-sheet').getBoundingClientRect(); return r.bottom <= innerHeight + 1; }")
            check(f'{tag}: the answer buttons are on screen without scrolling', sheet_ok)
            for k in range(3): answer_step(pg, 0)
            a = pg.evaluate(AUDIT, '#gpRoot'); check(f'{tag}: hand-over screen', not a['overflow'] and not a['small'], str(a))
            check(f'{tag}: the hand-over button is on screen', pg.evaluate("() => document.querySelector('[data-gphand]').getBoundingClientRect().bottom <= innerHeight + 1"))
            run(pg); a = pg.evaluate(AUDIT, '#gpRoot'); check(f'{tag}: result screen', not a['overflow'] and not a['small'], str(a))
            check(f'{tag}: no page errors', not errs, str(errs[:2])); ctx.close()
    b.close()
print('\nFAILED: ' + '; '.join(fails) if fails else '\nall party browser checks passed'); sys.exit(1 if fails else 0)
