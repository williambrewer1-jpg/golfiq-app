"""Browser test for guided play (phase 4): every game playable end to end, quick entry, tiers, pressure, drafts. Run: python3 tests/e2e_guided.py"""
import http.server, threading, functools, sys, os, re, json
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
GAMES = ['putt-par18','putt-369','putt-lag','putt-streak','chip-updown','chip-par18','chip-zone','range-fairways','range-greens','range-wedge','range-round']
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
            if pg.query_selector('[data-gp="5"]'): pg.click('[data-gp="2"]')
            else: pg.click('[data-gp="1"]' if taps % 3 != 2 else '[data-gp="0"]')
            taps += 1; pg.wait_for_timeout(60)
            if taps > 60: break
        pg.wait_for_selector('.gp-res', timeout=3000)
        r = pg.evaluate("() => { const j = window.__golfiq.state.journal, x = j.results[j.results.length - 1]; return { game: x.game, mode: x.mode, score: x.score, n: (x.detail || []).length, seed: x.seed, draft: j.game_draft }; }")
        check(f'{gid}: finished, saved as guided result', r['game'] == gid and r['mode'] == 'guided' and r['seed'] and r['draft'] is None, r)
        check(f'{gid}: result screen shows score', pg.inner_text('.gp-score').strip() != '')
        pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    n1 = pg.evaluate("() => window.__golfiq.state.journal.results.length"); check('all 11 games saved a result', n1 - n0 == 11, n1 - n0)
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
    # one potential credit check: guided result at a target counts as active practice
    check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
