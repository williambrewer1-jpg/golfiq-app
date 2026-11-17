"""Browser test for the goal on Home / Progress / Settings (first-run plan, phase A2). Run: python3 tests/e2e_goal.py"""
import http.server, threading, functools, sys, os
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
AUDIT = """(sel) => { const r = document.querySelector(sel); if (!r) return null; const small = [], fonts = [];
  for (const el of r.querySelectorAll('button, input, select')) { const b = el.getBoundingClientRect(); if (b.height && b.height < 38) small.push((el.textContent || el.id).trim().slice(0, 20) + ':' + Math.round(b.height));
    if (el.tagName !== 'BUTTON' && parseFloat(getComputedStyle(el).fontSize) < 16) fonts.push(el.id); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small, fonts }; }"""
def audit(pg, sel, label):
    pg.wait_for_timeout(300); a = pg.evaluate(AUDIT, sel)
    check(f'layout {label}', a and not a['overflow'] and not a['small'] and not a['fonts'], a)
TODAY = "new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)"
SETP = """async (p) => { const S = await import('./store.js'), st = window.__golfiq.state; if (p === null) delete st.settings.profile; else st.settings.profile = p; await S.saveSettings(st, 'test', null, null); }"""
SETRES = """async (rs) => { const S = await import('./store.js'), st = window.__golfiq.state, t = """ + TODAY + """; st.journal.results = rs.map((r, i) => ({ id: 'g' + i, date: t, mode: 'guided', note: '', ...r })); await S.saveJournal(st); }"""
def fresh(b, w=390, h=844):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort()); pg.goto(URL); pg.wait_for_selector('#obRoot'); return ctx, pg, errs
def intro(pg, hcp=None, level=None, goal=None, months=None, week=None):
    pg.click('[data-obnext]'); pg.wait_for_timeout(60)
    if hcp is not None: pg.fill('#obHcp', hcp)
    else: pg.click('[data-obnone]'); pg.click(f'[data-oblevel="{level}"]')
    pg.click('[data-obnext]'); pg.wait_for_timeout(60)
    if goal: pg.click(f'[data-obgoal="{goal}"]')
    if months: pg.click(f'[data-obmonths="{months}"]')
    if week: pg.click(f'[data-obweek="{week}"]')
    pg.click('[data-obnext]'); pg.wait_for_timeout(60); pg.click('[data-oblook]'); pg.wait_for_selector('#main'); pg.wait_for_timeout(400)
def home(pg): pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('#main'); pg.wait_for_timeout(500)
def txt(pg, sel): return pg.inner_text(sel) if pg.query_selector(sel) else ''
def bar(pg): return pg.evaluate("() => { const i = document.querySelector('#goalRow .bar i'); return i ? parseFloat(i.style.width) : null; }")

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h) in [(390, 844), (320, 568)]:
        tag = f'{w}x{h}'
        # ---------------------------------------------------- typed handicap: the goal shows on a Home with no rounds yet
        ctx, pg, errs = fresh(b, w, h); intro(pg, hcp='21', goal='break90', months='6', week='2')
        t = txt(pg, '#goalRow')
        check(f'{tag}: Home (no rounds) shows the goal line', t.startswith('Goal: Break 90 by '), t)
        check(f'{tag}: …the index and the goal level', 'Handicap index 21' in t and 'goal about 18' in t, t)
        check(f'{tag}: …and sessions this week', 'This week: 0 of 2 sessions' in t, t)
        check(f'{tag}: a progress bar at the start (0%)', bar(pg) == 0, bar(pg))
        audit(pg, '#goalRow', f'{tag} Home goal row (no rounds)')
        # one practice day this week → 1 of 2; a second the same day does not count twice
        pg.evaluate(SETRES, [{'game': 'putt-369', 'score': 6}, {'game': 'putt-lag', 'score': 4}]); home(pg)
        check(f'{tag}: a day of practice counts once ("1 of 2")', 'This week: 1 of 2 sessions' in txt(pg, '#goalRow'), txt(pg, '#goalRow'))
        pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state, pad = (n) => String(n).padStart(2, '0'), mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
          const day = (k) => { const d = new Date(mon); d.setDate(mon.getDate() + k); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
          st.journal.results = [{ id: 'm', game: 'putt-369', date: day(0), score: 6, mode: 'guided', note: '' }, { id: 't', game: 'putt-lag', date: day(1), score: 4, mode: 'guided', note: '' }, { id: 'n', game: 'putt-369', date: day(7), score: 6, mode: 'guided', note: '' }, { id: 'p', game: 'putt-369', date: day(-1), score: 6, mode: 'guided', note: '' }]; await S.saveJournal(st); }""")
        home(pg); t = txt(pg, '#goalRow')
        check(f'{tag}: two practice days this week complete it; days in other weeks do not count', 'This week: 2 of 2 sessions ✓' in t, t)
        check(f'{tag}: no errors', not errs, errs); ctx.close()

    # ---------------------------------------------------- no handicap: the estimate, then the practice level once games are rated; never called a handicap
    ctx, pg, errs = fresh(b); intro(pg, level='90s', goal='break90', months='6', week='1')
    t = txt(pg, '#goalRow')
    check('estimate: caption says it is an estimate', 'Starting estimate 24' in t and 'goal about 18' in t, t); check('estimate: bar at 0', bar(pg) == 0)
    check('estimate: a one-a-week goal reads "1 session"', 'This week: 0 of 1 session' in t and 'sessions' not in t.split('This week')[1], t)
    pg.evaluate(SETRES, [{'game': 'putt-369', 'score': 9}, {'game': 'putt-369', 'score': 9}, {'game': 'putt-lag', 'score': 8}, {'game': 'chip-updown', 'score': 7}]); home(pg); t = txt(pg, '#goalRow')
    check('practice results rate a skill: the caption becomes "Practice level" (never "handicap")', 'Practice level' in t and 'andicap' not in t.replace('Handicap index', ''), t)
    pg.evaluate(SETRES, []); pg.evaluate(SETP, None); home(pg)
    check('a golfer without a goal sees no goal row', pg.query_selector('#goalRow') is None)
    check('no errors (estimate)', not errs, errs); ctx.close()

    # ---------------------------------------------------- skip: no goal row; the Settings card sets one later
    ctx, pg, errs = fresh(b); pg.click('[data-obskip]'); pg.wait_for_selector('#main'); pg.wait_for_timeout(300)
    check('skipped: no goal row on Home', pg.query_selector('#goalRow') is None)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({st_tab: 'general'}))"); pg.goto(URL + '#settings'); pg.reload(); pg.wait_for_selector('#goalCard')
    check('Settings → General has the goal card with "Not set"', pg.input_value('#goalKey') == '' and pg.input_value('#goalWeek') == '')
    audit(pg, '#goalCard', '390x844 Settings goal card')
    pg.select_option('#goalWeek', '3'); pg.wait_for_timeout(500)
    pr = pg.evaluate("() => window.__golfiq.state.settings.profile")
    check('sessions a week can be set without a goal', pr.get('per_week') == 3 and 'goal' not in pr, pr)
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('#goalRow'); t = txt(pg, '#goalRow')
    check('Home shows only the sessions line', t.strip() == 'This week: 0 of 3 sessions' and 'Goal:' not in t, t)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({st_tab: 'general'}))"); pg.goto(URL + '#settings'); pg.reload(); pg.wait_for_selector('#goalCard')
    pg.select_option('#goalKey', 'break100'); pg.wait_for_timeout(500); pg.select_option('#goalMonths', '12'); pg.wait_for_timeout(500)
    pr = pg.evaluate("() => window.__golfiq.state.settings.profile")
    check('choosing a goal and a date saves them (12 months, from today)', pr['goal']['key'] == 'break100' and pr['goal']['months'] == 12 and pr['goal']['set_at'] == pg.evaluate(TODAY), pr)
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('#goalRow'); check('Home now shows the new goal with its date', txt(pg, '#goalRow').startswith('Goal: Break 100 by '), txt(pg, '#goalRow'))
    check('no errors (settings)', not errs, errs); ctx.close()

    # ---------------------------------------------------- sample data: reached goal, overdue goal, Progress → Potential line, and layout beside the level row
    for (w, h) in [(390, 844), (320, 568)]:
        tag = f'{w}x{h}'; ctx, pg, errs = fresh(b, w, h); pg.click('[data-obdemo]'); pg.wait_for_selector('.kpis', timeout=8000); pg.wait_for_timeout(400)
        pg.evaluate(SETP, {'onboarded_at': '2026-11-01', 'goal': {'key': 'break90', 'months': 6, 'set_at': '2026-11-01', 'from': 24}, 'per_week': 2}); home(pg); t = txt(pg, '#goalRow')
        check(f'{tag}: sample (index about 11) is already past Break 90: goal reached, full bar', 'Goal reached' in t and bar(pg) == 100, (t, bar(pg)))
        check(f'{tag}: the goal row sits under the level row', pg.evaluate("() => { const a = document.querySelector('.lvrow'), b = document.querySelector('#goalRow'); return !!a && !!b && a.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1; }"))
        audit(pg, '#goalRow', f'{tag} Home goal row (sample data)')
        pg.evaluate(SETP, {'onboarded_at': '2025-01-01', 'goal': {'key': 'scratch', 'months': 3, 'set_at': '2025-01-01', 'from': 24}, 'per_week': 1}); home(pg)
        check(f'{tag}: a goal past its date says so and drops the "by" date', 'The date has passed' in txt(pg, '#goalRow') and ' by ' not in txt(pg, '#goalRow').split('\n')[0], txt(pg, '#goalRow'))
        pg.evaluate(SETP, {'onboarded_at': '2026-11-01', 'goal': {'key': 'scratch', 'months': 12, 'set_at': '2026-11-01', 'from': 24}, 'per_week': 2}); home(pg)
        check(f'{tag}: the bar moves with the index (partway to scratch)', 0 < (bar(pg) or 0) < 100, bar(pg))
        pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('.prog-hero', timeout=8000); pg.wait_for_timeout(500)
        t = txt(pg, '.prog-hero .goalcmp')
        check(f'{tag}: Progress → Potential compares the goal with the potential', t.startswith('Your potential by ') and 'your goal (Get to scratch) needs about 0' in t, t)
        pg.evaluate(SETP, None); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('.prog-hero', timeout=8000)
        check(f'{tag}: …and shows no such line without a goal', pg.query_selector('.goalcmp') is None)
        check(f'{tag}: no errors (sample)', not errs, errs); ctx.close()
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
