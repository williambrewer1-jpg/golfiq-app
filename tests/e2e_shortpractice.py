"""Browser test for short early practice (first-run plan part B2, section B5): "Build my session" offers 15 minutes first to everyone and highlights it
for a new golfer (under 14 days since their first practice result); a 15-minute session runs two short games end to end and logs a session; a new
golfer's daily challenge is 10 minutes or less. Phone sizes 390x844 and 320x568. Run: python3 tests/e2e_shortpractice.py"""
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
# tap sizes (the Pressure finish label counts as the tap target for its checkbox) and overflow on the whole page
AUDIT = """(sel) => { const bad = [];
  for (const el0 of document.querySelectorAll(sel.split(',').map((x) => `${x.trim()} button, ${x.trim()} a.btn`).join(', '))) { const el = el0.type === 'checkbox' && el0.closest('label') ? el0.closest('label') : el0, r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.textContent || el.id).trim().slice(0, 24) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
MIN = "(id) => ({ 'putt-par18': 10, 'putt-369': 6, 'putt-lag': 6, 'putt-streak': 5, 'chip-updown': 12, 'chip-par18': 12, 'chip-zone': 8, 'range-fairways': 15, 'range-greens': 12, 'range-wedge': 10, 'range-round': 20, 'range-driver': 10, 'range-speed': 5 })[id]"
def audit(pg, sel, label):
    a = pg.evaluate(AUDIT, sel); check(f'{label}: no overflow, tap targets 38px+', not a['overflow'] and not a['small'], a)
# a golfer whose first practice result was `days_ago` days ago, on the Games tab
SEED = """async (daysAgo) => { const g = window.__golfiq, S = await import('./store.js'), d = new Date(Date.now() - daysAgo * 864e5 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  g.state.journal.results.push({ id: 'seed1', game: 'putt-369', date: d, score: 5, mode: 'guided' }); delete g.state.journal.daily_pick; await S.saveJournal(g.state);
  localStorage.setItem('golfiq-ui', JSON.stringify({ pr_tab: 'games' })); }"""
def golfer(b, w, h, days_ago, sample=False):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample')
    if sample: pg.click('#loadSample'); pg.wait_for_timeout(1500)
    if days_ago is not None: pg.evaluate(SEED, days_ago)
    else: pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({ pr_tab: 'games' }))")
    pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpses]'); return ctx, pg, errs
def lengths(pg): return pg.evaluate("() => [...document.querySelectorAll('[data-gpses]')].map((b) => Number(b.dataset.gpses))")
def is_pre(pg, m): return pg.evaluate(f"() => {{ const b = document.querySelector('[data-gpses=\"{m}\"]'); return !b.classList.contains('sec') && /suggested/i.test(b.innerText); }}")

with sync_playwright() as p:
    b = p.chromium.launch()
    for (W, H) in [(390, 844), (320, 568)]:
        sz = f'{W}x{H}'
        # ------------------------------------------------------------ a new golfer: first result 3 days ago
        ctx, pg, errs = golfer(b, W, H, 3)
        check(f'[{sz}] new golfer: 15, 30, 45, 60 minutes, 15 first', lengths(pg) == [15, 30, 45, 60], lengths(pg))
        check(f'[{sz}] new golfer: 15 minutes is the highlighted choice, marked Suggested', is_pre(pg, 15) and not any(is_pre(pg, m) for m in (30, 45, 60)))
        txt = pg.inner_text('[data-gpses="15"]')
        check(f'[{sz}] the 15-minute option lists two games by name', '2 games' in txt and 'putt-' not in txt and 'range-' not in txt, txt)
        gid = pg.get_attribute('.gp-daily', 'data-daily')
        check(f'[{sz}] new golfer: the daily challenge is 10 minutes or less', pg.evaluate(MIN, gid) <= 10, gid)
        audit(pg, '#main', f'[{sz}] Games tab (new golfer)')
        if W == 390:
            n0 = pg.evaluate("() => (window.__golfiq.state.journal.sessions || []).length")
            plan = pg.evaluate("() => window.__golfiq.state.journal.results.length")
            pg.click('[data-gpses="15"]'); pg.wait_for_selector('#gpRoot.gp-full')
            first = pg.evaluate("() => window.__golfiq.state.journal.session_run.queue.slice()")
            check('the 15-minute session queues two games of 8 minutes or less', len(first) == 2 and all(pg.evaluate(MIN, g) <= 8 for g in first), first)
            for i in range(2):
                pg.wait_for_selector('#gpRoot.gp-full'); taps = 0
                while pg.query_selector('#gpRoot:not(.gp-rv) [data-gp], #gpRoot:not(.gp-rv) [data-gpball]') and taps < 60: answer_step(pg, taps); taps += 1
                pg.wait_for_selector('#gpRoot.gp-rv', timeout=6000)
                if i == 0: pg.click('[data-gpsesnext]'); pg.wait_for_selector('[data-gpgapgo]'); pg.click('[data-gpgapgo]')
            pg.click('[data-gpsesend]'); pg.wait_for_selector('text=Session done')
            s = pg.evaluate("() => { const j = window.__golfiq.state.journal, s = (j.sessions || []).slice(-1)[0]; return { n: (j.sessions || []).length, results: s ? s.results.length : 0 }; }")
            check('a 15-minute session plays two games and logs a session', s['n'] == n0 + 1 and s['results'] == 2, s)
            audit(pg, '#gpRoot', 'session summary')
        check(f'[{sz}] no page errors (new golfer)', not errs, errs); ctx.close()

        # ------------------------------------------------------------ not new: first result 20 days ago (rounds don't matter either way)
        ctx, pg, errs = golfer(b, W, H, 20)
        check(f'[{sz}] not new: 15 minutes is still offered first', lengths(pg) == [15, 30, 45, 60], lengths(pg))
        check(f'[{sz}] not new: nothing is highlighted', not any(is_pre(pg, m) for m in (15, 30, 45, 60)))
        audit(pg, '#main', f'[{sz}] Games tab (not new)')
        check(f'[{sz}] no page errors (not new)', not errs, errs); ctx.close()

    # ------------------------------------------------------------ the sample data: rounds, and practice results older than 14 days
    ctx, pg, errs = golfer(b, 390, 844, None, sample=True)
    new = pg.evaluate("async () => { const FW = await import('./firstweek.js'), g = window.__golfiq; return FW.isNewGolfer({ journal: g.state.journal, rounds: g.ds.rounds, now: new Date() }); }")
    check('sample data: 15 minutes offered first', lengths(pg) == [15, 30, 45, 60], lengths(pg))
    check('sample data: highlighted only if the sample counts as new', is_pre(pg, 15) == new, new)
    audit(pg, '#main', 'sample data: Games tab')
    check('no page errors (sample)', not errs, errs); ctx.close()
    b.close()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'all short-practice browser checks passed'))
sys.exit(1 if fails else 0)
