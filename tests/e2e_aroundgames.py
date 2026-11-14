"""Browser test for the screens around the games (phase D): the game cards and their tier rings, the daily challenge card, the level-up tile count-down,
the "2 of 3 done" screen between session games, and the session summary. Run: python3 tests/e2e_aroundgames.py
Headless Chromium cannot be heard, so sounds are checked through window.__feelLog (asked for) and confetti through 'confetti' in the same log."""
import http.server, threading, functools, os, re, sys, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from play_helpers import answer_step, settle

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

LOG = "() => (window.__feelLog || []).slice()"
INIT = """window.__feelTest = true; window.__classLog = [];
new MutationObserver((ms) => ms.forEach((m) => { const t = m.target; if (t.classList && t.classList.contains('fx-flame') && t.id === 'gpDFlame') window.__classLog.push('flame'); if (t.classList && t.classList.contains('fx-pop') && t.dataset && t.dataset.skill) window.__classLog.push('pop:' + t.dataset.skill); }))
  .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });"""
def sounds(pg): return [e for e in pg.evaluate(LOG) if e in ('finish', 'win', 'pb', 'tier', 'unlock')]
def goto_games(pg): pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('.gp-cards'); hide_toast(pg)
def hide_toast(pg): pg.evaluate("() => { const t = document.querySelector('#toast'); if (t) t.style.display = 'none'; }")
def finish_game(pg, every=3):
    for t in range(60):
        if pg.query_selector('#gpRoot.gp-rv'): break
        answer_step(pg, t, every)
    pg.wait_for_selector('#gpRoot.gp-rv')
def play_pattern(pg, gid, pattern):
    pg.evaluate("([id]) => { window.__feelDelay = 0; window.__golfiq.state.journal.game_draft = null; window.__golfiq.guided.start(id, {}); }", [gid]); pg.wait_for_selector('#gpRoot.gp-full')
    for v in pattern: pg.click(f'[data-gp="{v}"]'); settle(pg)
    pg.wait_for_selector('#gpRoot.gp-rv'); pg.evaluate("() => document.querySelector('[data-gpdone]').click()"); pg.wait_for_selector('.gp-cards')
def card(pg, gid): return pg.query_selector(f'[data-pickgame="{gid}"]')
def ring(pg, gid):
    """The share of the ring that is filled (0 when there is no progress circle)."""
    return pg.evaluate("(id) => { const p = document.querySelector(`[data-pickgame=\"${id}\"] .gp-ring .p`); if (!p) return 0; const [a, b] = p.getAttribute('stroke-dasharray').split(' ').map(Number); return a / b; }", gid)

AUDIT = """() => { const vw = innerWidth, out = { overflow: document.documentElement.scrollWidth > vw + 1, issues: [] };
  for (const el of document.querySelectorAll('.gp-card, .gp-daily, .gp-card *, #gpRoot, #gpRoot button')) { const k = el.getBoundingClientRect(); if (!k.width) continue;
    if (k.right > vw + 1 || k.left < -1) out.issues.push((el.className || el.tagName) + ' sticks out ' + Math.round(k.left) + '..' + Math.round(k.right));
    if ((el.matches('.gp-card') || el.matches('button')) && (k.height < 38 || k.width < 38)) out.issues.push('small tap target ' + Math.round(k.width) + 'x' + Math.round(k.height));
    if (el.matches('.gp-cn, .gp-cb, .gp-cx, .tier') && el.scrollWidth > el.clientWidth + 1) out.issues.push((el.className) + ' clipped'); }
  return out; }"""

def audit_both(pg, what):
    for (w, h) in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': w, 'height': h}); a = pg.evaluate(AUDIT)
        check(f'{w}x{h}: {what}: no overflow, nothing clipped, buttons at least 38px', not a['overflow'] and not a['issues'], a)
    pg.set_viewport_size({'width': 390, 'height': 844})

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)

    # ================= the daily challenge card on Home: a glow while it is still to play, then a tick
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.gp-daily'); hide_toast(pg)
    check('the daily card is still to play: a gold glow, a Play button, no tick', pg.query_selector('.gp-daily.todo [data-gpdaily]') is not None and pg.query_selector('.gp-dtick') is None)
    check('the glow is a slow pulse of the card\'s edge (opacity only)', pg.evaluate("() => { const s = getComputedStyle(document.querySelector('.gp-daily'), '::after'); return s.animationName === 'gp-glow' && parseFloat(s.opacity) >= 0; }"))
    check('the flame shows the streak in weeks: none yet, so a pale flame and 0', pg.inner_text('#gpDFlame').split('\n')[0] == '0' and 'weeks' in pg.inner_text('#gpDFlame') and pg.get_attribute('#gpDFlame', 'aria-label') == 'no streak yet' and 'on' not in (pg.get_attribute('#gpDFlame', 'class') or '').split())
    check('there are no days anywhere on the daily card', re.search(r'\bdays?\b', pg.inner_text('.gp-daily'), re.I) is None, pg.inner_text('.gp-daily'))
    gid = pg.get_attribute('.gp-daily', 'data-daily')
    other = pg.evaluate("(g) => window.__golfiq.guided.nextGame(g)", gid)
    # practising any other game today starts the weekly streak, and the flame lights up and pulses once while the challenge is still to play
    pg.evaluate("() => { window.__feelDelay = 0; }"); pg.evaluate("(g) => window.__golfiq.guided.start(g)", other); pg.wait_for_selector('#gpRoot .gp-prompt'); finish_game(pg); pg.click('[data-gpdone]'); pg.wait_for_selector('.gp-daily')
    pg.evaluate("() => { window.__classLog = []; }"); pg.goto(URL + '#practice'); pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.gp-daily'); hide_toast(pg); pg.wait_for_timeout(300)
    check('after practising, the flame is lit and shows 1 week', pg.get_attribute('#gpDFlame', 'aria-label') == '1 week in a row' and 'on' in (pg.get_attribute('#gpDFlame', 'class') or '').split() and pg.inner_text('#gpDFlame').split('\n')[0] == '1')
    check('the flame pulses once when the card appears with the challenge still to play', 'flame' in pg.evaluate("() => window.__classLog"), pg.evaluate("() => window.__classLog"))
    pg.click('[data-gpdaily]'); pg.wait_for_selector('#gpRoot .gp-prompt'); finish_game(pg); pg.click('[data-gpdone]'); pg.wait_for_selector('.gp-daily'); hide_toast(pg)
    check('once done: a tick, "done today", no Play button and no glow', pg.query_selector('.gp-daily.done .gp-dtick svg') is not None and 'done today' in pg.inner_text('.gp-daily') and pg.query_selector('.gp-daily [data-gpdaily]') is None
          and pg.evaluate("() => getComputedStyle(document.querySelector('.gp-daily'), '::after').content") in ('none', 'normal'))
    pg.screenshot(path='/tmp/aroundgames_daily.png')
    audit_both(pg, 'the daily card fits the phone')

    # ================= the Games tab: a card for every game, with a tier ring
    goto_games(pg)
    n_cards = pg.evaluate("() => document.querySelectorAll('.gp-card').length"); n_opts = pg.evaluate("() => document.querySelectorAll('select[data-sel=pg_game] option').length")
    check('every game that takes a score has a card, in groups by type', n_cards == n_opts and n_cards >= 13 and pg.evaluate("() => [...document.querySelectorAll('.gp-cathead')].map((e) => e.textContent)") == ['Putting', 'Chipping', 'Range'], (n_cards, n_opts))
    check('one card is selected, the same game the list picker has', pg.evaluate("() => [document.querySelectorAll('.gp-card.sel').length, document.querySelector('.gp-card.sel').dataset.pickgame === document.querySelector('select[data-sel=pg_game]').value]") == [1, True])
    up = pg.evaluate("() => { const g = window.__golfiq.guided, l = window.__golfiq.progress.data().plan.ledger.map((x) => x.game).find((x) => g.canGuide(x)) || null; return [l, [...document.querySelectorAll('.gp-card .tag')].map((e) => e.closest('.gp-card').dataset.pickgame + ':' + e.textContent)]; }")
    check('"Up next" marks the weakest focus-area game, and only that one', up[0] is not None and up[1] == [f'{up[0]}:Up next'], up)
    check('a game not played yet says so and has an empty ring', 'Not played yet' in card(pg, 'putt-lag').inner_text() and ring(pg, 'putt-lag') == 0 and pg.query_selector('[data-pickgame="putt-lag"] .tier') is None)
    check('own-history games say how many plays they need before they have tiers', 'Play 3 more for tiers' in card(pg, 'range-speed').inner_text(), card(pg, 'range-speed').inner_text())
    check('each card has its icon in the ring, and the ring is hidden from screen readers', pg.evaluate("() => [...document.querySelectorAll('.gp-card')].every((c) => c.querySelector('.gp-ring svg.ic') && c.querySelector('.gp-ring svg.r').getAttribute('aria-hidden') === 'true')"))
    # picking
    card(pg, 'chip-par18').click(); pg.wait_for_selector('.gp-card.sel[data-pickgame="chip-par18"]'); pg.wait_for_timeout(350)
    check('tapping a card selects that game: its name heads the play card, and its launcher is below', pg.inner_text('#gpPlay h2') == 'Par 18 chipping' and pg.get_attribute('#gpPlay [data-gpstart]', 'data-gpstart') == 'chip-par18' and pg.evaluate("() => document.querySelector('select[data-sel=pg_game]').value") == 'chip-par18')
    check('the play card is brought into view', pg.evaluate("() => { const r = document.querySelector('#gpPlay').getBoundingClientRect(); return r.top < innerHeight - 100; }"))
    pg.evaluate("() => { const s = document.querySelector('select[data-sel=pg_game]'); s.value = 'putt-369'; s.dispatchEvent(new Event('change', { bubbles: true })); }"); pg.wait_for_selector('.gp-card.sel[data-pickgame="putt-369"]')
    check('the old list picker still works, tucked under "Pick from a list"', pg.inner_text('.gp-pick summary') == 'Pick from a list' and pg.inner_text('#gpPlay h2') == '3-6-9 ft ladder')
    # tiers and rings: 3 of 9 is 60% of the way to Bronze (5); 6 is Silver, and a new ring begins
    play_pattern(pg, 'putt-369', [1, 1, 1, 0, 0, 0, 0, 0, 0]); hide_toast(pg)
    t3 = card(pg, 'putt-369').inner_text()
    check('after a first score the card shows the best, no tier yet and the next tier\'s score', 'Best 3 / 9' in t3 and 'Next: Bronze at 5+' in t3 and pg.query_selector('[data-pickgame="putt-369"] .tier') is None, t3)
    check('the ring is 60% full: 3 of the 5 needed for Bronze', abs(ring(pg, 'putt-369') - 0.6) < 0.01, ring(pg, 'putt-369'))
    play_pattern(pg, 'putt-369', [1, 1, 1, 1, 1, 1, 0, 0, 0]); hide_toast(pg)
    t6 = card(pg, 'putt-369').inner_text()
    check('Silver at 6: a Silver chip, best 6, and the next tier is Gold at 7+', 'Silver' in t6 and 'Best 6 / 9' in t6 and 'Next: Gold at 7+' in t6, t6)
    check('a tier just reached starts a new, empty ring', ring(pg, 'putt-369') == 0)
    play_pattern(pg, 'chip-updown', [1] * 9); hide_toast(pg)
    check('a top-tier game has a full ring and says so', ring(pg, 'chip-updown') == 1 and 'Top tier' in card(pg, 'chip-updown').inner_text() and 'Platinum' in card(pg, 'chip-updown').inner_text(), card(pg, 'chip-updown').inner_text())
    play_pattern(pg, 'putt-par18', [3] * 9); hide_toast(pg)
    p18 = card(pg, 'putt-par18').inner_text()
    check('a lower-is-better game says "or fewer" for its next tier', 'or fewer' in p18 and 'Best' in p18, p18)
    check('the progress of each ring is also in words for screen readers', 'percent of the way to the next tier' in pg.evaluate("() => document.querySelector('[data-pickgame=\"putt-369\"] .gp-sr').textContent"))
    for (w, h) in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': w, 'height': h}); a = pg.evaluate(AUDIT)
        check(f'{w}x{h}: the card grid has no horizontal overflow, nothing clipped, taps at least 38px', not a['overflow'] and not a['issues'], a)
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.locator('.gp-cards').first.scroll_into_view_if_needed(); pg.screenshot(path='/tmp/aroundgames_cards.png')

    # ================= the level-up tile counts down once, and only when the handicap has dropped
    def tiles(): return pg.evaluate("() => window.__golfiq.progress.data().sk.skills.filter((s) => s.rated).map((s) => [s.key, Math.round(s.hcp)])")
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'}))"); pg.evaluate("() => localStorage.removeItem('golfiq-skill-seen')"); pg.reload(); pg.wait_for_selector('[data-skill]'); pg.wait_for_timeout(1200)
    rated = tiles(); key, now = rated[0]
    check('first time the tiles are shown there is nothing to count down', all(not e.startswith('pop:') for e in pg.evaluate("() => window.__classLog")) and rated, rated)
    seen = json.loads(pg.evaluate("() => localStorage.getItem('golfiq-skill-seen')"))
    check('what was shown is remembered, as the whole number on each tile', all(seen[k] == v for k, v in rated), (seen, rated))
    pg.evaluate("([k, v]) => { const s = JSON.parse(localStorage.getItem('golfiq-skill-seen')); s[k] = v + 3; localStorage.setItem('golfiq-skill-seen', JSON.stringify(s)); window.__classLog = []; }", [key, now]); pg.reload(); pg.wait_for_selector(f'[data-skill="{key}"]')
    first = pg.evaluate("(k) => Number(document.querySelector(`[data-skill=\"${k}\"] .st-hcp`).textContent)", key)
    check('a dropped handicap starts the number at the old value and counts down to the new one', first > now and first <= now + 3, (first, now))
    pg.wait_for_function("([k, n]) => Number(document.querySelector(`[data-skill=\"${k}\"] .st-hcp`).textContent) === n", arg=[key, now], timeout=3000)
    check('the tile pulses once', pg.evaluate("() => window.__classLog").count(f'pop:{key}') >= 1, pg.evaluate("() => window.__classLog"))
    check('only the tile that dropped pulses', all(e == f'pop:{key}' for e in pg.evaluate("() => window.__classLog")), pg.evaluate("() => window.__classLog"))
    pg.evaluate("() => { window.__classLog = []; }"); pg.reload(); pg.wait_for_selector('[data-skill]'); pg.wait_for_timeout(1000)
    check('opened again, it does not repeat', pg.evaluate("() => window.__classLog") == [] and pg.evaluate("(k) => Number(document.querySelector(`[data-skill=\"${k}\"] .st-hcp`).textContent)", key) == now)
    pg.evaluate("([k, v]) => { const s = JSON.parse(localStorage.getItem('golfiq-skill-seen')); s[k] = v - 2; localStorage.setItem('golfiq-skill-seen', JSON.stringify(s)); window.__classLog = []; }", [key, now]); pg.reload(); pg.wait_for_selector('[data-skill]'); pg.wait_for_timeout(1000)
    check('a handicap that has gone up does not count down or pulse, and is remembered', pg.evaluate("() => window.__classLog") == [] and json.loads(pg.evaluate("() => localStorage.getItem('golfiq-skill-seen')"))[key] == now)
    check('no page errors so far', not errs, errs)

    # ================= a 45-minute session: the screen between games
    goto_games(pg); pg.evaluate("() => { window.__feelDelay = 0; window.__golfiq.state.journal.game_draft = null; }")
    pg.click('[data-gpses="45"]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    queue = pg.evaluate("() => window.__golfiq.state.journal.session_run.queue")
    finish_game(pg)
    check('the result offers the next game of the session, as before', pg.query_selector('[data-gpsesnext]') is not None and 'game 1 of 3' in pg.inner_text('.gp-res'))
    pg.evaluate("() => { window.__feelLog = []; }"); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-gap'); pg.wait_for_timeout(600)
    gt = pg.inner_text('#gpRoot')
    check('between games: "1 of 3 done", the progress bar and the name of the next game', '1 of 3 done' in gt and pg.get_attribute('#gpRoot [role=progressbar]', 'aria-valuenow') == '1' and pg.get_attribute('#gpRoot [role=progressbar]', 'aria-valuemax') == '3', gt)
    nxt_name = pg.inner_text('.gp-gname')
    check('it says "Up next" with the next game, how long it takes and its target', 'UP NEXT' in gt.upper() and 'about' in gt and nxt_name != '' and f'Start {nxt_name}' in gt, gt)
    check('the next game is the second one in the session', pg.evaluate("(q) => window.__golfiq.state.journal.session_run.queue[1] === q[1]", queue) and pg.evaluate("() => window.__golfiq.state.journal.session_run.i") == 0)
    check('the bar has filled to a third, and a soft step sound was played', abs(pg.evaluate("() => Number(document.querySelector('#gpGapBar').style.getPropertyValue('--p'))") - 1 / 3) < 0.01 and 'step' in pg.evaluate(LOG), (pg.evaluate("() => document.querySelector('#gpGapBar').style.cssText"), pg.evaluate(LOG)))
    check('no game is running and the screen waits for a tap', pg.evaluate("() => window.__golfiq.state.journal.game_draft") is None and pg.query_selector('#gpRoot .gp-prompt') is None)
    audit_both(pg, 'the between-games screen fits the phone')
    pg.screenshot(path='/tmp/aroundgames_gap.png')
    pg.reload(); pg.wait_for_selector('#gpRoot.gp-gap')
    check('after a reload it is still there', '1 of 3 done' in pg.inner_text('#gpRoot'))
    pg.click('[data-gpgapgo]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('Start begins the next game of the session, and the screen is gone', pg.evaluate("(q) => window.__golfiq.state.journal.game_draft.game === q[1] && window.__golfiq.state.journal.session_run.i === 1", queue) and pg.query_selector('.gp-gap') is None)
    pg.evaluate("() => { window.__feelDelay = 0; }"); finish_game(pg); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-gap')
    check('after the second game it says 2 of 3, with a longer bar', '2 of 3 done' in pg.inner_text('#gpRoot') and pg.get_attribute('#gpRoot [role=progressbar]', 'aria-valuenow') == '2')
    pg.evaluate("() => { window.__feelLog = []; }"); pg.evaluate("() => { delete window.__feelDelay; }"); pg.click('[data-gpsesend]'); pg.wait_for_selector('text=Session done')
    check('Finish session on that screen ends the session with the two games played', pg.evaluate("() => { const j = window.__golfiq.state.journal; return j.session_run === null && j.sessions.slice(-1)[0].results.length === 2; }") and pg.query_selector('.gp-gap') is None)

    # ================= the session summary: the same look and reveal as a result
    pg.wait_for_selector('#gpRoot[data-revealed]', timeout=6000)
    st = pg.inner_text('#gpRoot')
    check('hero: the games and minutes, "Session done", the targets hit as a number out of the games played', re.search(r'2 GAMES · ABOUT \d+ MIN', st.upper().replace('\n', ' ')) and 'Session done' in st and 'targets hit' in st and re.search(r'\d\s*/\s*2', st), st[:300])
    check('rewards: practice streak in weeks and the potential, still called a target', re.search(r'\d\s+weeks? in a row', st) and 'target to play for, not a promise' in st and 'potential' in st.lower(), st)
    hits = int(pg.get_attribute('#gpRoot', 'data-hits'))
    check('the count reaches the number of targets hit, and the sound fits: win and confetti only when every target was hit', pg.inner_text('#gpSNum') == str(hits) and ((sounds(pg) == ['win'] and 'confetti' in pg.evaluate(LOG)) if hits == 2 else (sounds(pg) == ['finish'] and 'confetti' not in pg.evaluate(LOG))), (hits, sounds(pg), pg.evaluate(LOG)))
    pg.evaluate("() => { window.__feelLog = []; }"); pg.reload(); pg.wait_for_selector('#gpRoot.gp-rv'); pg.wait_for_timeout(1200)
    check('after a reload the summary is shown at once, with no sound, confetti or rise', pg.evaluate(LOG) == [] and pg.query_selector('#gpRoot .fx-rise') is None and pg.inner_text('#gpSNum') == str(hits))
    audit_both(pg, 'the session summary fits the phone')
    pg.screenshot(path='/tmp/aroundgames_summary.png')
    pg.click('[data-gpdone]'); pg.wait_for_selector('.gp-cards')
    pg.reload(); pg.wait_for_selector('.gp-cards')
    check('Done returns to the games, and the summary does not come back', pg.query_selector('#gpRoot') is None)

    # a session where nothing is hit: the plain finish sound and no confetti
    pg.evaluate("() => { window.__feelDelay = 0; }"); pg.click('[data-gpses="30"]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    for g in range(2):
        finish_game(pg, 1)
        if g == 0: pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-gap'); pg.click('[data-gpgapgo]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    pg.evaluate("() => { window.__feelLog = []; delete window.__feelDelay; }"); pg.click('[data-gpsesend]'); pg.wait_for_selector('#gpSNum'); pg.wait_for_selector('#gpRoot[data-revealed]', timeout=6000)
    check('a session with no target hit says 0 of 2, finishes quietly and has no confetti', pg.get_attribute('#gpRoot', 'data-hits') == '0' and pg.inner_text('#gpSNum') == '0' and sounds(pg) == ['finish'] and 'confetti' not in pg.evaluate(LOG), (sounds(pg), pg.evaluate(LOG)))
    check('the headline is not gold when targets were missed', 'met' not in (pg.get_attribute('#gpVerdictL', 'class') or ''))
    pg.click('[data-gpdone]'); pg.wait_for_selector('.gp-cards')

    # ================= the skills test uses the same screen between games
    pg.click('[data-gptest]'); pg.wait_for_selector('#gpRoot .gp-prompt'); pg.evaluate("() => { window.__feelDelay = 0; }"); finish_game(pg); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-gap')
    gt = pg.inner_text('#gpRoot')
    check('in a skills test the screen says so, counts out of 6 and offers Finish test', 'SKILLS TEST' in gt.upper() and '1 of 6 done' in gt and 'Finish test' in gt, gt)
    pg.once('dialog', lambda d: d.accept()); pg.click('[data-gpgapgo]'); pg.wait_for_selector('#gpRoot .gp-prompt'); pg.click('[data-gpquit]'); pg.wait_for_timeout(400)
    check('no page errors in the whole run', not errs, errs)
    ctx.close()

    # ================= reduced motion: no glow, the bar and numbers jump, the rest still works
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block', reduced_motion='reduce'); ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500); pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.gp-daily'); hide_toast(pg)
    check('reduced motion: the daily card does not pulse, it just has a steady gold edge', pg.evaluate("() => { const s = getComputedStyle(document.querySelector('.gp-daily'), '::after'); return s.animationName === 'none' && parseFloat(s.opacity) > 0.3; }") and pg.evaluate("() => document.documentElement.classList.contains('calm')"))
    goto_games(pg); pg.evaluate("() => { window.__feelDelay = 0; }"); pg.click('[data-gpses="30"]'); pg.wait_for_selector('#gpRoot .gp-prompt'); finish_game(pg); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-gap')
    check('reduced motion: the bar shows its final length straight away', abs(pg.evaluate("() => { const e = document.querySelector('#gpGapBar'); return new DOMMatrixReadOnly(getComputedStyle(e).transform).a; }") - 1 / 2) < 0.02 or abs(pg.evaluate("() => { const e = document.querySelector('#gpGapBar'); return new DOMMatrixReadOnly(getComputedStyle(e).transform).a; }") - 1 / 3) < 0.02)
    pg.evaluate("() => { window.__feelLog = []; delete window.__feelDelay; }"); pg.click('[data-gpsesend]'); pg.wait_for_selector('#gpSNum'); pg.wait_for_selector('#gpRoot[data-revealed]', timeout=6000)
    check('reduced motion: the summary shows the final count, and plays no confetti', pg.inner_text('#gpSNum') == pg.get_attribute('#gpRoot', 'data-hits') and 'confetti' not in pg.evaluate(LOG))
    check('reduced motion: no page errors', not errs, errs)
    ctx.close(); b.close()

srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
