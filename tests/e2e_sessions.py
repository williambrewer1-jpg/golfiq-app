"""Browser test for sessions and the daily challenge (phase 5). Run: python3 tests/e2e_sessions.py"""
import http.server, threading, functools, sys, os, re
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
URL = f'http://127.0.0.1:{port}/index.html'
def play_out(pg):
    taps = 0
    while pg.query_selector('#gpRoot .gp-btns'):
        if pg.query_selector('[data-gp="5"]'): pg.click('[data-gp="2"]')
        else: pg.click('[data-gp="1"]' if taps % 3 != 2 else '[data-gp="0"]')
        taps += 1; pg.wait_for_timeout(50)
        if taps > 60: break
    pg.wait_for_selector('.gp-res', timeout=3000)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.gp-daily')
    home = pg.inner_text('.gp-daily')
    check("Home shows today's challenge with a Play button and a streak", "Today's challenge" in home and 'streak' in home and pg.query_selector('.gp-daily [data-gpdaily]') is not None, home)
    check('challenge shows a target', 'Target' in home, home)
    gid = pg.get_attribute('.gp-daily', 'data-daily')
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpses]')
    check('Games tab shows the same daily challenge', pg.get_attribute('.gp-daily', 'data-daily') == gid)
    txt = pg.inner_text('.gp-ses'); check('three session lengths with game lists', all(m in txt for m in ['30 min', '45 min', '60 min']) and '2 games' in txt and '3 games' in txt and '4 games' in txt, txt)
    # daily challenge
    pg.click('[data-gpdaily]'); pg.wait_for_selector('#gpRoot .gp-prompt'); play_out(pg)
    d = pg.evaluate("() => { const j = window.__golfiq.state.journal, t = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); const id = (j.daily || {})[t]; const r = j.results.find(x => x.id === id); return { id, game: r && r.game, ch: r && r.challenge }; }")
    check('finishing the daily challenge records it', d['id'] and d['game'] == gid and d['ch'] == 'daily', d)
    pg.click('[data-gpdone]'); pg.wait_for_selector('.gp-daily')
    check('card says done today and streak is 1', 'done today' in pg.inner_text('.gp-daily') and '1-day streak' in pg.inner_text('.gp-daily'), pg.inner_text('.gp-daily'))
    check('Play button is gone once done', pg.query_selector('.gp-daily [data-gpdaily]') is None)
    # sessions
    n0 = pg.evaluate("() => window.__golfiq.state.journal.sessions.length")
    pg.click('[data-gpses="45"]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    ran = []
    for i in range(3):
        ran.append(pg.evaluate("() => window.__golfiq.state.journal.game_draft.game")); play_out(pg)
        if i < 2: check(f'game {i + 1}: result offers the next game in the session', pg.query_selector('[data-gpsesnext]') is not None and f'game {i + 1} of 3' in pg.inner_text('.gp-res'), pg.inner_text('.gp-res')[-120:]); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('a 45-minute session runs three different games', len(set(ran)) == 3, ran)
    check('the last result offers Finish session', pg.query_selector('[data-gpsesend]') is not None)
    pg.click('[data-gpsesend]'); pg.wait_for_selector('text=Session done')
    sm = pg.inner_text('.gp-res'); check('summary shows scores, targets hit, potential and streak', 'Session done' in sm and 'targets hit' in sm and 'streak' in sm.lower() and 'Potential' in sm, sm)
    s = pg.evaluate("() => { const j = window.__golfiq.state.journal, s = j.sessions[j.sessions.length - 1]; return { n: j.sessions.length, results: s.results.length, ok: s.results.every(id => j.results.find(r => r.id === id && r.session_id === s.id)), run: j.session_run, guided: s.guided, min: s.minutes }; }")
    check('a session is logged with a session_id on each result', s['n'] == n0 + 1 and s['results'] == 3 and s['ok'] and s['run'] is None and s['guided'], s)
    pg.screenshot(path='/tmp/session_summary.png')
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpses]')
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'log'}))"); pg.reload(); pg.wait_for_selector('text=Guided session')
    check('the session shows in the practice log', True)
    # 30-minute session, quit part-way: finished games are kept, no half session
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.reload(); pg.wait_for_selector('[data-gpses]')
    pg.click('[data-gpses="30"]'); pg.wait_for_selector('#gpRoot .gp-prompt'); play_out(pg); pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    pg.once('dialog', lambda d: d.accept()); pg.click('[data-gpquit]'); pg.wait_for_timeout(400)
    q = pg.evaluate("() => { const j = window.__golfiq.state.journal; return { run: j.session_run, draft: j.game_draft }; }")
    check('quitting mid-session clears the draft and the session', q['run'] is None and q['draft'] is None, q)
    check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
