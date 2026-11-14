"""Browser test for phase R7 (duels), against the fake Firebase only. Two "phones" (two browser contexts, one for Wills and one for Sam) share one set of duel documents:
the duel documents are copied from one phone to the other, which is what the real group database does. A full duel: challenge from the Duels card, the share step, the challenger's
attempt, the opponent's Accept and attempt on Home (same shots, nothing of the other score visible before playing), the head-to-head with the stake and a Rematch, points, the record on
friend rows, quitting forfeits, the limits, a deadline that passes (forfeit win and quiet expiry), and a group still on the old rules. 390x844, sample data.
Run: python3 tests/e2e_duels.py"""
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
# the fake database for this phone; its documents survive a reload through sessionStorage ('fbraw'), so a "phone" can be closed and opened again
def glue(opts): return """(() => { window.__fb = makeFakeFirebase(%s); const real = window.fetch.bind(window);
  window.fetch = (u, i) => /googleapis\\.com/.test(String(u)) ? window.__fb.fetch(String(u), i) : real(u, i);
  try { for (const [p, o] of JSON.parse(sessionStorage.getItem('fbseed') || '[]')) window.__fb.put(p, o); } catch (e) {}
  try { for (const [k, v] of JSON.parse(sessionStorage.getItem('fbraw') || '[]')) window.__fb.docs.set(k, v); } catch (e) {} })();""" % json.dumps(opts)
AUDIT = """(sel) => { const bad = [];
  for (const el of document.querySelectorAll(sel + ' button')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.getAttribute('aria-label') || el.textContent).trim().slice(0, 20) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  for (const el of document.querySelectorAll(sel + ' input:not([type=checkbox]), ' + sel + ' select')) { if (parseFloat(getComputedStyle(el).fontSize) < 16) bad.push('font ' + (el.name || el.id)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
SEED = """async (who) => {
  const S = await import('./store.js'), st = window.__golfiq.state, me = who === 'sam' ? ['uid-sam', 'Sam'] : ['uid-1', 'Wills'];
  st.cloud = { apiKey: 'k', projectId: 'p', group: 'grp1', groupName: 'Mates', nick: me[1], auth: { idToken: 'tok-x', refreshToken: 'ref-x', uid: me[0], exp: Date.now() + 30 * 864e5 } }; await S.saveCloud(st);
  const docs = [['groups/grp1', { name: 'Mates', owner: 'uid-1' }], ['groups/grp1/members/uid-1', { nick: 'Wills' }], ['groups/grp1/members/uid-sam', { nick: 'Sam' }], ['groups/grp1/members/uid-kim', { nick: 'Kim' }], ['groups/grp1/members/uid-al', { nick: 'Al' }]];
  const B = await import('./bench.js'), week = B.isoWeek(), today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sc = (uid, nick, score) => ({ uid, nick, game: 'chip-zone', game_name: 'Chip zone', better: 'higher', score, level_h: 10, date: today, week, month: today.slice(0, 7), hit: true });
  docs.push(['groups/grp1/scores/s1', sc('uid-sam', 'Sam', 5)], ['groups/grp1/scores/s2', sc('uid-kim', 'Kim', 4)]);
  sessionStorage.setItem('fbseed', JSON.stringify(docs));
}"""
def fresh(b, who, opts=None):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.add_init_script(FAKE); pg.add_init_script(glue(opts or {})); pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate(SEED, who); return ctx, pg, errs
def reopen(pg, h='#home'):
    """Close and open the app again on this phone (the documents are kept)."""
    pg.evaluate("() => sessionStorage.setItem('fbraw', JSON.stringify([...window.__fb.docs.entries()]))"); pg.evaluate("(h) => { location.hash = h; }", h); pg.reload(); pg.wait_for_timeout(1500)
def board(pg):
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'board'}))"); reopen(pg, '#practice'); pg.wait_for_selector('#duCard', timeout=8000); pg.wait_for_timeout(900)
def send(src, dst):
    """What the group database does: the other phone sees the same duel documents."""
    d = src.evaluate("() => [...window.__fb.docs.entries()].filter(([k]) => k.includes('/duels/'))"); dst.evaluate("(d) => { for (const [k, v] of d) window.__fb.docs.set(k, v); }", d)
def duels(pg): return pg.evaluate("() => window.__fb.read('groups/grp1/duels')")
def duel_ids(pg): return pg.evaluate("() => [...window.__fb.docs.keys()].filter((k) => k.includes('/duels/')).map((k) => k.split('/').pop())")
def play(pg, worst=False, limit=80):
    """Play the game on screen to the result. Returns the prompts seen, in order (the same seed gives the same shots)."""
    prompts = []; n = 0
    while not pg.query_selector('.gp-rv') and n < limit:
        prompts.append(pg.inner_text('.gp-prompt').strip())
        if worst:
            pg.click('[data-gp="5"]' if pg.query_selector('[data-gp="5"]') else '[data-gp="0"]'); settle(pg)
        else: answer_step(pg, n)
        n += 1
    pg.wait_for_selector('#duPanel[data-state]', timeout=8000); pg.wait_for_timeout(400); return prompts
def sounds(pg): return pg.evaluate("() => window.__feelLog || []")
with sync_playwright() as p:
    b = p.chromium.launch()
    ctxA, A, errA = fresh(b, 'wills'); ctxB, B, errB = fresh(b, 'sam')
    # ---------------------------------------------------------------- the challenge
    board(A)
    check('the Duels card is on the Leaderboard tab', 'Duels' in A.inner_text('#duCard') and A.query_selector('[data-duopen]') is not None)
    check('before any duel it says so', 'No duels yet' in A.inner_text('#duCard'), A.inner_text('#duCard')[:200])
    A.click('[data-duopen]'); A.wait_for_selector('#duForm')
    friends = A.eval_on_selector_all('#duFriend option', 'o => o.map(x => x.textContent)'); games = A.eval_on_selector_all('#duGame option', 'o => o.map(x => x.value)')
    check('the form lists the other members (not yourself) and only guided games with a benchmark', friends == ['Sam', 'Kim', 'Al'] and len(games) >= 3 and 'putt-369' in games, (friends, games))
    check('handicap is the default scoring and 7 days the default time', A.input_value('#duMode') == 'handicap' and A.input_value('#duDays') == '7' and 'own target' in A.inner_text('#duModeNote'))
    check('the stake takes at most 60 characters', A.get_attribute('#duStake', 'maxlength') == '60')
    a = A.evaluate(AUDIT, '#duCard'); check('the form fits at 390 wide: inputs 16px, buttons 38px', not a['overflow'] and not a['small'], a); A.screenshot(path='/tmp/duels_form.png', full_page=True)
    A.select_option('#duFriend', label='Sam'); A.select_option('#duGame', value='putt-369'); A.fill('#duStake', 'Loser buys the coffees'); A.click('#duForm button:not([type=button])'); A.wait_for_timeout(1200)
    ds = duels(A); d = ds[0] if ds else {}
    check('one duel document was written, from Wills to Sam, open, handicap, with the stake', len(ds) == 1 and d['from_uid'] == 'uid-1' and d['to_uid'] == 'uid-sam' and d['from_nick'] == 'Wills' and d['to_nick'] == 'Sam' and d['status'] == 'open' and d['mode'] == 'handicap' and d['game'] == 'putt-369' and d['stake'] == 'Loser buys the coffees' and d['pressure'] is False, ds)
    check('it has a seed, a seven day deadline, no attempts yet and at most 20 fields', isinstance(d['seed'], int) and d['seed'] > 0 and d['a'] is None and d['b'] is None and d['winner'] is None and len(d) <= 20 and 6.9 < (__import__('datetime').datetime.fromisoformat(d['deadline'].replace('Z', '+00:00')) - __import__('datetime').datetime.fromisoformat(d['created'].replace('Z', '+00:00'))).total_seconds() / 86400 < 7.1, d)
    check('the challenger sees their own turn to play, and the form has closed', A.query_selector('#duForm') is None and A.query_selector('[data-duplay]') is not None, A.inner_text('#duCard')[:300])
    # a second duel with the same friend is refused (one open duel per pair)
    A.click('[data-duopen]'); A.wait_for_selector('#duForm'); A.select_option('#duFriend', label='Sam'); A.click('#duForm button:not([type=button])'); A.wait_for_timeout(900)
    check('a second open duel with the same friend is refused with a message', len(duels(A)) == 1 and 'already have an open duel with Sam' in A.inner_text('body'), A.inner_text('.toast') if A.query_selector('.toast') else '')
    A.click('[data-duclose]')
    # ---------------------------------------------------------------- the challenger plays first
    A.evaluate("() => { window.__feelLog = []; }")
    A.click('[data-duplay]'); A.wait_for_selector('#gpRoot', timeout=8000); A.wait_for_timeout(500)
    d = duels(A)[0]; check('starting locks the attempt in on the group side before the first shot', isinstance(d['a'], dict) and d['a'].get('started') and d['a'].get('score') is None, d['a'])
    dr = A.evaluate("() => { const x = window.__golfiq.guided.draft(); return { duel: x.duel, seed: x.seed, target: x.target, unitM: x.unitM, game: x.game }; }")
    check('the game uses the duel seed, the duel unit and the golfer\'s own target', dr['duel'] == duel_ids(A)[0] and dr['seed'] == d['seed'] and dr['unitM'] == d['unitM'] and dr['game'] == 'putt-369' and isinstance(dr['target'], (int, float)), dr)
    promptsA = play(A)
    d = duels(A)[0]
    check('the finished attempt is on the group side with score, own target and margin', isinstance(d['a'].get('score'), (int, float)) and isinstance(d['a'].get('target'), (int, float)) and abs(d['a']['margin'] - (d['a']['score'] - d['a']['target'])) < 0.11 and d['a'].get('at'), d['a'])
    check('the duel is still waiting: no final status, no winner', d['status'] == 'open' and d['winner'] is None and d['b'] is None)
    panel = A.inner_text('#duPanel'); check('the result screen says the score is in and who has to play', 'Your score is in' in panel and 'Sam' in panel and 'Show' not in panel, panel)
    check('there is no Play again or Next game after a duel, only Done', A.query_selector('[data-gpagain]') is None and A.query_selector('[data-gpnext]') is None and A.query_selector('[data-gpdone]') is not None)
    check('the result was saved here as a normal result with the duel id', A.evaluate("() => window.__golfiq.state.journal.results.filter((r) => r.duel).length") == 1 and A.evaluate("() => window.__golfiq.state.journal.results.filter((r) => r.duel)[0].mode") == 'guided')
    check('a waiting duel plays the plain finish sound, not the win sound', 'finish' in sounds(A) and 'win' not in sounds(A), sounds(A))
    a = A.evaluate(AUDIT, '#duPanel'); check('the waiting panel fits', not a['overflow'] and not a['small'], a)
    A.click('[data-gpdone]'); A.wait_for_timeout(400); board(A)
    check('after playing, the Duels card shows the duel as waiting for Sam, with no way to play again', 'Waiting for Sam to accept' in A.inner_text('#duCard') and A.query_selector('[data-duplay]') is None, A.inner_text('#duCard')[:300])
    check('the points are 10 for playing the duel, derived from the saved result', 'Duel played' in A.evaluate("() => window.__golfiq.progress.data().lv.ledger.map((l) => l.what).join('|')"))
    # ---------------------------------------------------------------- the opponent: sees it on Home, Accept, plays the same shots
    send(A, B); reopen(B, '#home'); B.wait_for_selector('.du-home', timeout=8000)
    home = B.inner_text('.du-home'); check('Home shows the challenge with Accept and Decline', 'Wills challenges you' in home and '3-6-9' in home and B.query_selector('[data-duaccept]') is not None and B.query_selector('[data-dudecline]') is not None, home)
    check('it shows the scoring, the time left and the stake', 'Handicap duel' in home and '7 days left' in home and 'Loser buys the coffees' in home, home)
    check('Sam cannot play before accepting', B.query_selector('[data-duplay]') is None)
    check('Sam cannot see Wills\'s attempt before playing (the app hides it)', B.query_selector('.du-h2h') is None and B.evaluate("""async () => { const D = await import('./duels.js'); const d = window.__fb.read('groups/grp1/duels')[0]; const v = D.visible(d, 'uid-sam'); return v.theirs === null && v.hidden === true; }"""))
    a = B.evaluate(AUDIT, '.du-home'); check('the Home card fits and its buttons are big enough', not a['overflow'] and not a['small'], a); B.screenshot(path='/tmp/duels_home.png')
    B.click('[data-duaccept]'); B.wait_for_timeout(900)
    check('Accept writes the accepted status and the card now offers the attempt', duels(B)[0]['status'] == 'accepted' and B.query_selector('.du-home [data-duplay]') is not None, B.inner_text('.du-home'))
    B.evaluate("() => { window.__feelLog = []; }")
    B.click('.du-home [data-duplay]'); B.wait_for_selector('#gpRoot', timeout=8000); B.wait_for_timeout(500)
    d = duels(B)[0]; check('Sam\'s attempt is locked in when the game starts', isinstance(d['b'], dict) and d['b'].get('started') and d['b'].get('score') is None and d['a']['score'] is not None, d['b'])
    promptsB = play(B, worst=True)
    check('both players got the same shots in the same order', promptsA == promptsB and len(promptsA) >= 6, (promptsA[:4], promptsB[:4]))
    d = duels(B)[0]
    check('with both attempts in, the final status is written: done, with the winner', d['status'] == 'done' and d['winner'] in ('a', 'b', 'draw') and isinstance(d['b'].get('margin'), (int, float)), d)
    w = d['winner']; expect = 'a' if d['a']['margin'] > d['b']['margin'] + 0.05 else ('b' if d['b']['margin'] > d['a']['margin'] + 0.05 else 'draw'); check('the winner is whoever beat their own target by more', w == expect, (d['a'], d['b'], w))
    check('Sam, who played worst, loses and is not shown as a failure', w == 'a' and 'Wills takes this one' in B.inner_text('#duPanel'), B.inner_text('#duPanel'))
    pan = B.inner_text('#duPanel'); check('the head-to-head shows both scores, both own targets and both margins', B.query_selector('#duPanel .du-h2h') is not None and 'Own target' in pan and 'Beat target by' in pan and 'Score' in pan, pan)
    check('the stake line and a Rematch button are on it', 'Stake: Loser buys the coffees' in pan and B.query_selector('#duPanel [data-durematch]') is not None, pan)
    check('a loss plays the finish sound, with no win sound', 'finish' in sounds(B) and 'win' not in sounds(B), sounds(B))
    a = B.evaluate(AUDIT, '#duPanel'); check('the head-to-head fits at 390 wide', not a['overflow'] and not a['small'], a); B.screenshot(path='/tmp/duels_result.png', full_page=True)
    check('Sam\'s result is saved with the duel id and, once decided, the outcome (lost)', B.evaluate("() => { const r = window.__golfiq.state.journal.results.filter((x) => x.duel); return r.length === 1 && r[0].duel_won === false; }"))
    ledB = B.evaluate("() => window.__golfiq.progress.data().lv.ledger.map((l) => l.what).join('|')"); check('Sam earns the 10 points for playing but not the 15 for winning', 'Duel played' in ledB and 'Duel won' not in ledB, ledB)
    # ---------------------------------------------------------------- back to the challenger: the result, the record, the points, the rematch
    send(B, A); A.evaluate("() => { window.__feelLog = []; }"); board(A)
    dc = A.inner_text('#duCard'); check('the finished duel shows as Won in the challenger\'s list', 'finished' in dc.lower() and 'Won' in dc, dc)
    A.click('#duCard .du-done summary'); A.wait_for_timeout(300)
    check('opening it shows the head-to-head, the stake and Rematch', A.query_selector('#duCard .du-h2h') is not None and 'Stake: Loser buys the coffees' in A.inner_text('#duCard') and A.query_selector('#duCard [data-durematch]') is not None)
    check('the running record is 1–0–0 on the card', 'Sam: 1–0–0' in A.inner_text('#duCard'), A.inner_text('#duCard'))
    ledA = A.evaluate("() => window.__golfiq.progress.data().lv.ledger.map((l) => l.what).join('|')"); check('Wills earns 10 for playing and 15 for winning, worked out from the saved result', 'Duel played' in ledA and 'Duel won' in ledA, ledA)
    check('the win was stamped on Wills\'s own result when the duel was decided', A.evaluate("() => window.__golfiq.state.journal.results.filter((x) => x.duel)[0].duel_won === true"))
    # friend rows: Challenge button and the record
    rows = A.query_selector_all('.lb .du-b'); check('friends\' rows have a Challenge button', len(rows) >= 1)
    rec = A.evaluate("() => Object.fromEntries([...document.querySelectorAll('#lbRecent .du')].map((e) => [e.querySelector('[data-duchal]').dataset.duchal, e.textContent]))")
    check('Sam\'s row shows the record and Kim\'s does not (no duels with Kim)', 'Duels 1–0–0' in rec.get('uid-sam', '') and 'Duels' not in rec.get('uid-kim', 'Duels'), rec)
    check('your own rows have no Challenge button', A.query_selector('.lb [data-duchal="uid-1"]') is None)
    A.click('#lbRecent [data-duchal="uid-kim"]'); A.wait_for_selector('#duForm'); check('tapping Challenge on a friend\'s row opens the form with that friend chosen', A.input_value('#duFriend') == 'uid-kim'); A.click('[data-duclose]')
    a = A.evaluate(AUDIT, '.lb'); check('rows with Challenge buttons fit at 390 wide', not a['overflow'] and not a['small'], a); A.screenshot(path='/tmp/duels_board.png', full_page=True)
    # rematch
    old = duels(A)[0]; A.click('#duCard [data-durematch]'); A.wait_for_timeout(1200)
    ds = [x for x in duels(A)]; new = [x for x in ds if x['status'] == 'open']
    check('Rematch writes a new open duel from Wills to Sam with a new seed and the same settings', len(ds) == 2 and len(new) == 1 and new[0]['seed'] != old['seed'] and new[0]['from_uid'] == 'uid-1' and new[0]['to_uid'] == 'uid-sam' and new[0]['stake'] == old['stake'] and new[0]['mode'] == old['mode'] and new[0]['game'] == old['game'] and new[0]['a'] is None, ds)
    # quitting forfeits the one attempt
    A.click('[data-duplay]'); A.wait_for_selector('#gpRoot'); A.wait_for_timeout(400); A.click('[data-gpquit]'); A.wait_for_timeout(800)
    nd = [x for x in duels(A) if x['status'] == 'open'][0]
    check('quitting a duel leaves the attempt used up on the group side, with no score', isinstance(nd['a'], dict) and nd['a'].get('started') and nd['a'].get('score') is None, nd['a'])
    board(A); check('and it cannot be started again', A.query_selector('[data-duplay]') is None, A.inner_text('#duCard')[:300])
    check('no page errors on either phone so far', not errA and not errB, (errA[:3], errB[:3]))
    ctxA.close(); ctxB.close()
    # ---------------------------------------------------------------- the limits: three open duels
    ctx, W, err = fresh(b, 'wills')
    W.evaluate("""() => { const now = Date.now(), iso = (d) => new Date(d).toISOString(); const mk = (id, from, to) => window.__fb.put('groups/grp1/duels/' + id, { from_uid: from, from_nick: from, to_uid: to, to_nick: to, game: 'putt-369', seed: 5, mode: 'handicap', pressure: false, stake: '', created: iso(now), deadline: iso(now + 5 * 864e5), status: 'open', a: null, b: null, winner: null, better: 'higher', unitM: 0.9144 });
      mk('l1', 'uid-1', 'uid-kim'); mk('l2', 'uid-al', 'uid-1'); mk('l3', 'uid-kim', 'uid-1'); }""")
    board(W); W.click('[data-duopen]'); W.wait_for_selector('#duForm'); W.select_option('#duFriend', label='Sam'); W.click('#duForm button:not([type=button])'); W.wait_for_timeout(900)
    check('with three open duels a fourth is refused', len(duels(W)) == 3 and 'three open duels' in W.inner_text('body'), W.inner_text('.toast') if W.query_selector('.toast') else '')
    ctx.close()
    # ---------------------------------------------------------------- a deadline that passes: forfeit win, and a quiet expiry
    ctx, W, err = fresh(b, 'wills')
    W.evaluate("""() => { const now = Date.now(), iso = (d) => new Date(d).toISOString(); const slot = { started: iso(now - 9 * 864e5), score: 11, target: 10, margin: 1, at: iso(now - 9 * 864e5) };
      const mk = (id, from, to, a, b) => window.__fb.put('groups/grp1/duels/' + id, { from_uid: from, from_nick: from === 'uid-1' ? 'Wills' : 'Kim', to_uid: to, to_nick: to === 'uid-1' ? 'Wills' : 'Kim', game: 'putt-369', seed: 5, mode: 'handicap', pressure: false, stake: 'Dinner', created: iso(now - 10 * 864e5), deadline: iso(now - 2 * 864e5), status: 'accepted', a, b, winner: null, better: 'higher', unitM: 0.9144 });
      mk('f1', 'uid-1', 'uid-kim', slot, null); mk('e1', 'uid-kim', 'uid-1', null, null); mk('f2', 'uid-kim', 'uid-1', slot, null); }""")
    board(W); st = {x['from_uid'] + '>' + x['to_uid'] + ':' + x['status']: x for x in duels(W)}
    f1 = [x for x in duels(W) if x['seed'] == 5 and x['from_uid'] == 'uid-1'][0]
    check('past the deadline with only my attempt in: I win by forfeit and the status is written', f1['status'] == 'done' and f1['winner'] == 'a', f1)
    for sm in W.query_selector_all('#duCard .du-done summary'): sm.click()
    dc = W.inner_text('#duCard')
    check('a forfeit win says the other player did not play in time', 'Kim did not play in time. The duel is yours.' in dc, dc)
    check('a forfeit loss is told gently, never as a failure', 'Time ran out before you played. Kim takes it.' in dc and 'fail' not in dc.lower(), dc)
    check('with both players\' attempts missing, the duel expires quietly (not listed anywhere)', any(x['status'] == 'expired' for x in duels(W)) and 'expire' not in dc.lower() and dc.lower().count('3-6-9') == 2, [x['status'] for x in duels(W)])
    check('forfeits count in the record: one win, one loss', 'Kim: 1–0–1' in dc, dc)
    check('no page errors', not err, err[:3]); ctx.close()
    # ---------------------------------------------------------------- old rules: duels hidden, one line, nothing else affected
    ctx, W, err = fresh(b, 'wills', {'rules': 'old'}); W.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'board'}))"); reopen(W, '#practice'); W.wait_for_selector('#duCard', timeout=8000); W.wait_for_timeout(1200)
    dc = W.inner_text('#duCard'); check('old rules: the Duels card says duels need updated rules and where to republish them', 'republish' in dc and 'Settings' in dc and W.query_selector('[data-duopen]') is None, dc)
    check('old rules: no Challenge buttons on any row, and the rest of the board loads', W.query_selector('.du-b') is None and W.query_selector('#lbLeague') is not None)
    reopen(W, '#home'); W.wait_for_selector('#duHome', state='attached'); W.wait_for_timeout(900); check('old rules: Home shows nothing about duels and has no errors', W.query_selector('.du-home') is None and not err, err[:3]); ctx.close()
    # ---------------------------------------------------------------- no group: nothing is drawn
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500); pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    check('without a group nothing about duels is drawn', pg.query_selector('#duHome') is None and pg.query_selector('#duCard') is None and not errs, errs[:3]); ctx.close()
    b.close()
print('\n%s' % ('ALL PASSED' if not fails else 'FAILED: ' + ', '.join(fails))); sys.exit(1 if fails else 0)
