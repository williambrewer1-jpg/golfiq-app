"""Browser test for guided play (phase 4): every game playable end to end, quick entry, tiers, pressure, drafts. Run: python3 tests/e2e_guided.py"""
import http.server, threading, functools, sys, os, re, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from play_helpers import answer_step
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
GAMES = ['putt-par18','putt-369','putt-lag','putt-streak','chip-updown','chip-par18','chip-zone','range-fairways','range-greens','range-wedge','range-round','range-driver','range-speed']
URL = f'http://127.0.0.1:{port}/index.html'
AUDIT = "() => { const s = document.querySelector('#gpRoot'); const bad = []; for (const el of s.querySelectorAll('button, input')) { const r = el.getBoundingClientRect(); if (r.height && r.height < 38) bad.push(el.textContent.trim() + ':' + Math.round(r.height)); } return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpstart]')
    check('Games tab has a Play guided button', pg.query_selector('[data-gpstart]') is not None)
    check('quick entry is still there, folded away', pg.query_selector('#pgQuick #pgForm') is not None and not pg.is_visible('#pgForm'))
    n0 = pg.evaluate("() => window.__golfiq.state.journal.results.length")
    # play every game: hit everything except every third tap
    for gid in GAMES:
        pg.evaluate("(id) => { const st = window.__golfiq.state; st.journal.game_draft = null; }", gid)
        pg.evaluate("(id) => window.__golfiq.guided.start(id)", gid); pg.wait_for_selector('#gpRoot .gp-prompt'); pg.wait_for_timeout(100)
        if gid == 'putt-par18':
            a = pg.evaluate(AUDIT); check('play screen: no horizontal overflow', not a['overflow']); check('play screen: tap targets >= 38px', not a['small'], a['small'])
            pg.screenshot(path='/tmp/guided_play.png')
        taps = 0
        while pg.query_selector('#gpRoot .gp-btns'):
            answer_step(pg, taps, 3)
            taps += 1; pg.wait_for_timeout(60)
            if taps > 60: break
        pg.wait_for_selector('.gp-res', timeout=3000)
        r = pg.evaluate("() => { const j = window.__golfiq.state.journal, x = j.results[j.results.length - 1]; return { game: x.game, mode: x.mode, score: x.score, n: (x.detail || []).length, seed: x.seed, draft: j.game_draft }; }")
        check(f'{gid}: finished, saved as guided result', r['game'] == gid and r['mode'] == 'guided' and r['seed'] and r['draft'] is None, r)
        check(f'{gid}: result screen shows score', pg.inner_text('.gp-score').strip() != '')
        pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    n1 = pg.evaluate("() => window.__golfiq.state.journal.results.length"); check(f'all {len(GAMES)} games saved a result', n1 - n0 == len(GAMES), n1 - n0)
    # streak ends on first miss
    pg.evaluate("() => window.__golfiq.guided.start('putt-streak')"); pg.wait_for_selector('#gpRoot')
    for _ in range(3): pg.click('[data-gp="1"]'); pg.wait_for_timeout(60)
    pg.click('[data-gp="0"]'); pg.wait_for_selector('.gp-res')
    check('streak: 3 holed then a miss scores 3', pg.evaluate("() => { const j = window.__golfiq.state.journal; return j.results[j.results.length - 1].score; }") == 3)
    pg.click('[data-gpdone]')
    # undo and draft survive a reload
    pg.evaluate("() => window.__golfiq.guided.start('putt-369')"); pg.wait_for_selector('#gpRoot')
    for v in ['1', '1', '0']: pg.click(f'[data-gp="{v}"]'); pg.wait_for_timeout(60)
    pg.click('[data-gpundo]'); pg.wait_for_timeout(60)
    check('undo removes the last step', pg.evaluate("() => window.__golfiq.state.journal.game_draft.answers.length") == 2)
    pg.reload(); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('draft survives a reload on the same step', pg.evaluate("() => window.__golfiq.state.journal.game_draft.answers.length") == 2 and 'Ball 3' in pg.inner_text('.gp-sub'))
    pg.click('[data-gpquit]', no_wait_after=True) if False else None
    # pressure finish
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }"); pg.evaluate("() => window.__golfiq.guided.start('chip-zone', { pressure: true })"); pg.wait_for_selector('#gpRoot')
    for i in range(9): pg.click('[data-gp="1"]'); pg.wait_for_timeout(40)
    check('last step shows the pressure banner', 'Pressure' in pg.inner_text('.gp-pressure'))
    pg.click('[data-gp="1"]'); pg.wait_for_selector('.gp-res')
    pr = pg.evaluate("() => { const j = window.__golfiq.state.journal, x = j.results[j.results.length - 1]; return [x.pressure, x.pressure_hit, x.score]; }")
    check('pressure hit is stored', pr == [True, True, 10], pr); check('result mentions the pressure finish', 'Pressure' in pg.inner_text('.gp-res') or 'pressure' in pg.inner_text('.gp-res'))
    check('perfect score reaches Platinum', 'Platinum' in pg.inner_text('.gp-res'))
    check('result shows the beat-the-handicapper line', 'handicapper' in pg.inner_text('.gp-res'))
    check('result shows a handicap level', 'Handicap level' in pg.inner_text('.gp-res'))
    a = pg.evaluate(AUDIT); check('result screen: no overflow, tap targets ok', not a['overflow'] and not a['small'], a); pg.screenshot(path='/tmp/guided_result.png')
    nxt = pg.get_attribute('[data-gpnext]', 'data-gpnext'); pg.click('[data-gpnext]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('Next game starts a different game', pg.evaluate("() => window.__golfiq.state.journal.game_draft.game") != nxt)
    # the Phase 2 record buttons start guided play
    pg.evaluate("async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.journal.game_draft = null; await S.saveJournal(st); localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'})); }"); pg.reload(); pg.wait_for_selector('.skill-tile')
    pg.click('.skill-tile >> nth=0'); pg.wait_for_selector('.gbtn[data-record]'); pg.click('.gbtn[data-record] >> nth=0'); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('"Play" buttons on Progress start guided play', pg.evaluate("() => !!window.__golfiq.state.journal.game_draft"))
    # quick entry still saves a plain score
    pg.evaluate("async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.journal.game_draft = null; await S.saveJournal(st); localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'})); }"); pg.reload(); pg.wait_for_selector('#pgQuick')
    pg.click('#pgQuick summary'); pg.fill('#pgForm input[name=score]', '5'); n2 = pg.evaluate("() => window.__golfiq.state.journal.results.length"); pg.click('#pgForm button'); pg.wait_for_timeout(500)
    last = pg.evaluate("() => { const j = window.__golfiq.state.journal; return [j.results.length, j.results[j.results.length - 1].mode || null]; }")
    check('quick entry saves a normal result (no mode)', last[0] == n2 + 1 and last[1] is None, last)

    # ---------------------------------------------------------------- the driving games (phase 0)
    AUDIT_D = "() => { const s = document.querySelector('#gpRoot'), bad = [], small = []; for (const el of s.querySelectorAll('button, input')) { const t = el.type === 'checkbox' ? el.closest('label') : el; const r = t.getBoundingClientRect(); if (r.height && r.height < 38) bad.push((el.textContent || el.id).trim() + ':' + Math.round(r.height)); if (el.matches('input:not([type=checkbox]):not([type=range])') && parseFloat(getComputedStyle(el).fontSize) < 16) small.push(el.id); } return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad, fonts: small, below: [...s.querySelectorAll('[data-gpball]')].some((b) => b.getBoundingClientRect().bottom > innerHeight) }; }"
    last_res = lambda: pg.evaluate("() => { const j = window.__golfiq.state.journal, x = j.results[j.results.length - 1]; return x; }")
    pg.evaluate("async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.journal.game_draft = null; st.settings.range_ball_adj = 10; await S.saveSettings(st, 'set_range_adj', null, { range_ball_adj: 10 }); await S.saveJournal(st); }")
    pg.evaluate("() => window.__golfiq.guided.start('range-driver')"); pg.wait_for_selector('#gpRoot .gp-dist')
    sl = pg.evaluate("() => { const e = document.querySelector('#gpDist'); return [Number(e.min), Number(e.value), Number(e.max), e.step]; }")
    check('Driver test: slider opens between its limits at a usual distance', sl[0] < sl[1] < sl[2] and sl[3] == '10', sl)
    check('Driver test: Fairway / Missed / Wide buttons', [b.inner_text() for b in pg.query_selector_all('[data-gpball]')] == ['Fairway', 'Missed', 'Wide'])
    check('Driver test: premium-ball switch shown because an adjustment is set', pg.query_selector('#gpPrem') is not None and '10%' in pg.inner_text('.gp-prem'))
    for vp in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': vp[0], 'height': vp[1]}); pg.wait_for_timeout(100); a = pg.evaluate(AUDIT_D)
        check(f'Driver test screen at {vp[0]}x{vp[1]}: no overflow, tap targets >= 38px, inputs >= 16px', not a['overflow'] and not a['small'] and not a['fonts'], a)
        check(f'Driver test screen at {vp[0]}x{vp[1]}: answer buttons are on screen without scrolling', not a['below'], a)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.screenshot(path='/tmp/driver_play.png')
    pg.eval_on_selector('#gpDist', "(e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }", '250')
    check('moving the slider updates the big number', pg.inner_text('#gpDnum') == '250')
    pg.click('[data-gpball="f"]'); pg.wait_for_selector('#gpRoot .gp-dist'); pg.wait_for_timeout(60)
    d = pg.evaluate("() => window.__golfiq.state.journal.game_draft")
    check('a fairway ball counts its distance plus the 10% range-ball adjustment', d['answers'] == [275] and d['balls'][0] == {'d': 250, 'r': 'f', 'a': 10}, d)
    check('the slider opens at the last ball next time', pg.inner_text('#gpDnum') == '250')
    pg.fill('#gpDtype', '240'); check('typing an exact number shows it', pg.inner_text('#gpDnum') == '240')
    pg.click('[data-gpball="m"]'); pg.wait_for_selector('#gpRoot .gp-dist'); pg.wait_for_timeout(60)
    d = pg.evaluate("() => window.__golfiq.state.journal.game_draft")
    check('a missed ball is 20 yd less than its adjusted distance (240 x 1.1 - 20 = 244)', d['answers'][1] == 244 and d['balls'][1]['r'] == 'm', d['answers'])
    pg.click('.gp-prem'); pg.fill('#gpDtype', '230'); pg.click('[data-gpball="w"]'); pg.wait_for_selector('#gpRoot .gp-dist'); pg.wait_for_timeout(60)
    d = pg.evaluate("() => window.__golfiq.state.journal.game_draft")
    check('premium ball skips the adjustment; a wide ball is half (230 / 2 = 115)', d['answers'][2] == 115 and d['balls'][2] == {'d': 230, 'r': 'w', 'a': 0} and d['premium'] is True, d)
    check('the footer shows the running average', 'Average' in pg.inner_text('.gp-foot') and 'after 3 of 10' in pg.inner_text('.gp-foot'), pg.inner_text('.gp-foot'))
    check('dots: fairway green, the other two red', pg.evaluate("() => [...document.querySelectorAll('.gp-dots i')].slice(0, 3).map((e) => e.className)") == ['hit', 'miss', 'miss'])
    pg.click('[data-gpundo]'); pg.wait_for_timeout(80)
    d = pg.evaluate("() => window.__golfiq.state.journal.game_draft")
    check('undo takes back the ball as well as its score', len(d['answers']) == 2 and len(d['balls']) == 2, d)
    pg.reload(); pg.wait_for_selector('#gpRoot .gp-dist')
    check('the draft survives a reload with its balls', pg.evaluate("() => window.__golfiq.state.journal.game_draft.balls.length") == 2 and 'Ball 3' in pg.inner_text('.gp-prompt'))
    taps = 0
    while pg.query_selector('[data-gpball]'): pg.click('[data-gpball="f"]'); taps += 1; pg.wait_for_timeout(60)
    pg.wait_for_selector('.gp-res'); r = last_res()
    check('Driver test finished: ten balls saved as a guided result', r['game'] == 'range-driver' and r['mode'] == 'guided' and len(r['balls']) == 10 and len(r['detail']) == 10, r)
    check('result keeps average distance, fairways and wide balls', r['fairways'] == 9 and r['wides'] == 0 and r['avg_dist'] > 200 and isinstance(r['score'], (int, float)), r)
    txt = pg.inner_text('.gp-res')
    check('result screen shows average, fairways out of ten and wide balls in yards', 'Average distance' in txt and 'fairways' in txt and 'of 10' in txt and 'wide' in txt and 'yd' in txt, txt[:300])
    check('result screen shows a handicap level and a tier ladder position', 'Handicap level' in txt, txt[:300])
    a = pg.evaluate(AUDIT); check('Driver test result: no overflow, tap targets ok', not a['overflow'] and not a['small'], a); pg.screenshot(path='/tmp/driver_result.png')
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    # Max out
    pg.evaluate("() => window.__golfiq.guided.start('range-speed')"); pg.wait_for_selector('#gpRoot .gp-dist')
    check('Max out: one Save ball button, no where-it-finished choice', [b.inner_text() for b in pg.query_selector_all('[data-gpball]')] == ['Save ball'] and 'Ball 1 of 5' in pg.inner_text('.gp-prompt'))
    for v in ['240', '262', '251', '255', '248']:
        pg.fill('#gpDtype', v); pg.click('[data-gpball="f"]'); pg.wait_for_timeout(80)
    pg.wait_for_selector('.gp-res'); r = last_res(); txt = pg.inner_text('.gp-res')
    check('Max out scores the longest ball (262 + 10% = 288.2)', r['game'] == 'range-speed' and abs(r['score'] - 288.2) < 0.06 and r['longest'] == r['score'], r)
    check('Max out result lists the balls and has no handicap level', 'Your balls' in txt and 'Handicap level' not in txt, txt[:300])
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    # pressure ball
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }"); pg.evaluate("() => window.__golfiq.guided.start('range-driver', { pressure: true })"); pg.wait_for_selector('#gpRoot .gp-dist')
    for i in range(9): pg.click('[data-gpball="f"]'); pg.wait_for_timeout(50)
    check('Driver test pressure ball banner says it has to find the fairway', 'fairway' in pg.inner_text('.gp-pressure'), pg.inner_text('.gp-pressure'))
    pg.click('[data-gpball="m"]'); pg.wait_for_selector('.gp-res'); r = last_res()
    check('a missed pressure ball is recorded, and the score stays the plain average', r['pressure'] is True and r['pressure_hit'] is False and r['fairways'] == 9, r)
    check('result says the pressure ball missed the fairway', 'Pressure ball missed the fairway' in pg.inner_text('.gp-res'))
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    # launcher: tiers in yards, pressure wording
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: 'range-driver'})); }"); pg.reload(); pg.wait_for_selector('[data-gpstart]')
    txt = pg.inner_text('.card:has([data-gpstart])')
    check('Games tab: Driver test shows tiers and the pressure wording', 'Bronze' in txt and 'has to find the fairway' in txt, txt[:500])
    check('quick entry labels the score in yd', 'Score (yd)' in pg.text_content('#pgForm'), pg.text_content('#pgForm')[:80])
    pg.click('#pgQuick summary'); pg.fill('#pgForm input[name=score]', '231'); n2 = pg.evaluate("() => window.__golfiq.state.journal.results.length"); pg.click('#pgForm button'); pg.wait_for_timeout(500)
    last = last_res(); check('quick entry works for the Driver test', last['game'] == 'range-driver' and last['score'] == 231 and last.get('mode') is None, last)
    # metres: the whole thing in the golfer's own unit
    pg.goto(URL + '#settings'); pg.wait_for_selector('#rangeAdj')
    check('Settings has the range ball adjustment, showing the saved value', pg.input_value('#rangeAdj') == '10')
    a = pg.evaluate("() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, font: parseFloat(getComputedStyle(document.querySelector('#rangeAdj')).fontSize), h: document.querySelector('#rangeAdj').getBoundingClientRect().height })")
    check('Settings page: no overflow, adjustment input at least 16px with a 38px+ tap target', not a['overflow'] and a['font'] >= 16 and a['h'] >= 38, a)
    pg.fill('#rangeAdj', '40'); pg.dispatch_event('#rangeAdj', 'change'); pg.wait_for_timeout(500)
    check('the adjustment is capped at 15% and saved', pg.evaluate("() => window.__golfiq.state.settings.range_ball_adj") == 15)
    pg.wait_for_selector('#rangeAdj'); pg.fill('#rangeAdj', '0'); pg.dispatch_event('#rangeAdj', 'change'); pg.wait_for_timeout(500)
    check('0 switches the adjustment off', pg.evaluate("() => window.__golfiq.state.settings.range_ball_adj") == 0)
    pg.click('#unitSeg [data-u="m"]'); pg.wait_for_timeout(600)
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }"); pg.evaluate("() => window.__golfiq.guided.start('range-driver')"); pg.wait_for_selector('#gpRoot .gp-dist')
    check('in metres the slider and big number are in m, with no premium switch when there is no adjustment', pg.inner_text('.gp-dnum span') == 'm' and pg.query_selector('#gpPrem') is None)
    pg.fill('#gpDtype', '200'); pg.click('[data-gpball="m"]'); pg.wait_for_timeout(80)
    d = pg.evaluate("() => window.__golfiq.state.journal.game_draft")
    check('a missed ball costs 20 yd, which is 18.3 m', abs(d['answers'][0] - (200 - 18.288)) < 0.06 and d['unitM'] == 1, d)
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }"); pg.goto(URL + '#settings'); pg.wait_for_selector('#unitSeg'); pg.click('#unitSeg [data-u="yd"]'); pg.wait_for_timeout(500)
    # own-history tiers: Max out and the simple Range round have no handicap benchmark, so their three tiers come from the golfer's own scores
    SEED = "async (rows) => { const S = await import('./store.js'), st = window.__golfiq.state; st.journal.results = st.journal.results.filter((r) => r.game !== 'range-speed'); st.journal.game_draft = null; rows.forEach(([n, d, sc]) => st.journal.results.push({ id: 'own-' + n, game: 'range-speed', date: d, score: sc })); await S.saveJournal(st); }"
    GO = "() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: 'range-speed'})); }"
    def show():
        pg.evaluate(GO); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpstart]')
    pg.evaluate(SEED, [[1, '2026-01-01', 200], [2, '2026-01-02', 220]]); show()
    txt = pg.inner_text('.card:has([data-gpstart])')
    check('Max out with two scores: no tiers yet, says how many more plays are needed', 'Play 1 more time' in txt and 'Bronze' not in txt and 'Platinum' not in txt, txt[:400])
    pg.evaluate(SEED, [[1, '2026-01-01', 200], [2, '2026-01-02', 220], [3, '2026-01-03', 240]]); show()
    txt = pg.inner_text('.card:has([data-gpstart])'); lad = pg.evaluate("() => [...document.querySelectorAll('.tiers .tier')].map((e) => e.innerText.replace(/\\s+/g, ' '))")
    check('Max out with three scores: a three-tier ladder from your own scores (median 220, best quarter 230, new best 241), no Platinum', lad == ['Bronze 220', 'Silver 230', 'Gold 241'] and 'Platinum' not in txt and 'your own scores' in txt, (lad, txt[:300]))
    a = pg.evaluate("() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1 })"); check('own-tier launcher: no horizontal overflow', not a['overflow'])
    pg.evaluate("() => window.__golfiq.guided.start('range-speed')"); pg.wait_for_selector('#gpRoot .gp-dist')
    for v in ['150', '300', '200', '210', '190']:
        pg.fill('#gpDtype', v); pg.click('[data-gpball="f"]'); pg.wait_for_timeout(80)
    pg.wait_for_selector('.gp-res'); r = last_res(); txt = pg.inner_text('.gp-res')
    check('a record Max out reaches Gold, judged against the scores before it (best 240)', r['score'] == 300 and 'New tier: Gold' in txt and 'Top tier reached' in txt, txt[:300])
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    pg.evaluate(SEED, [[1, '2026-01-01', 200], [2, '2026-01-02', 220], [3, '2026-01-03', 240]]); pg.evaluate("() => window.__golfiq.guided.start('range-speed')"); pg.wait_for_selector('#gpRoot .gp-dist')
    for v in ['225', '210', '200', '190', '180']:
        pg.fill('#gpDtype', v); pg.click('[data-gpball="f"]'); pg.wait_for_timeout(80)
    pg.wait_for_selector('.gp-res'); txt = pg.inner_text('.gp-res')
    check('a score at the median reaches Bronze, with the next rung and what it is (your best quarter)', 'Bronze' in txt and 'Next: Silver' in txt and 'your best quarter' in txt and 'New tier' in txt, txt[:300])
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'})); }"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('.badges'); bd = pg.evaluate("() => [...document.querySelectorAll('.badges .bdg.on b')].map((e) => e.innerText)")
    check('the Bronze badge for Max out is on the Progress page', 'Bronze · Max out' in bd, bd)
    # the simple Range round is the other own-history game
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: 'range-round'})); }"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpstart]')
    txt = pg.inner_text('.card:has([data-gpstart])')
    check('Range round also uses your own scores for its tiers', ('your own scores' in txt and 'Bronze' in txt) or 'more time' in txt, txt[:300])
    # one potential credit check: guided result at a target counts as active practice
    check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
