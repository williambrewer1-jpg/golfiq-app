"""Browser test for the earned-potential hero card (phase 3). Run: python3 tests/e2e_potential.py"""
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
num = lambda s: float(re.search(r'-?\d+(\.\d+)?', s).group())
AUDIT = "() => { const s = document.querySelector('.prog-hero'); const bad = []; for (const el of s.querySelectorAll('button, a.btn')) { const r = el.getBoundingClientRect(); if (r.height && r.height < 38) bad.push(el.textContent.trim().slice(0, 24) + ' ' + Math.round(r.height)); } return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'}))"); pg.goto(f'http://127.0.0.1:{port}/index.html#practice'); pg.reload(); pg.wait_for_selector('.prog-hero .pot-bar', timeout=15000)
    now = num(pg.inner_text('.prog-big > div:nth-child(1) b')); pot = num(pg.inner_text('.prog-big > div:nth-child(3) b'))
    check('no practice: potential is 0.5-1.0 shots under now', 0.45 <= now - pot <= 1.05, f'{now} -> {pot}')
    hero = pg.inner_text('.prog-hero')
    check('"best case" is gone', 'best case' not in hero.lower())
    check('bar shows Base, Momentum, Unlocked', all(w in hero for w in ['Base', 'Momentum', 'Unlocked']))
    check('shows what is still locked', 'more to unlock' in hero)
    check('one line sells the next action', 'Next:' in hero and 'Score' in hero, hero[:600])
    check('How this works note is present', pg.query_selector('.prog-hero details summary') is not None and 'How this works' in hero)
    check('old "five shots better" copy is gone', 'five shots better' not in pg.inner_text('body'))
    a = pg.evaluate(AUDIT); check('no horizontal overflow', not a['overflow']); check('hero tap targets >= 38px', not a['small'], a['small'])
    # play the games: hit the targets three times in two focus skills
    ids = pg.evaluate("() => [...document.querySelectorAll('.skill-tile.focus')].map(t => t.dataset.skill)")
    check('two focus skills', len(ids) == 2, ids)
    pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state, today = new Date().toISOString().slice(0, 10), j = st.journal;
      const subs = { putting: ['putt-369', 'putt-lag'], short: ['chip-updown', 'chip-par18'], approach: ['range-greens', 'range-wedge'], driving: ['range-fairways', 'range-fairways'] };
      const focus = [...document.querySelectorAll('.skill-tile.focus')].map(t => t.dataset.skill);
      j.results = j.results || []; for (const k of focus) for (let i = 0; i < 3; i++) j.results.push({ id: `t${k}${i}`, game: subs[k][0], date: today, score: 1000, note: '' }), j.results.push({ id: `u${k}${i}`, game: subs[k][1], date: today, score: 1000, note: '' });
      await S.saveJournal(st); }""")
    pg.reload(); pg.wait_for_selector('.prog-hero .pot-bar'); pot2 = num(pg.inner_text('.prog-big > div:nth-child(3) b')); hero2 = pg.inner_text('.prog-hero')
    check('practising two focus skills lowers the potential', pot2 < pot - 0.2, f'{pot} -> {pot2}')
    check('momentum is earned', not re.search(r'Momentum\s*0\.0', hero2), hero2[:400])
    check('potential stays under the 4.0 cap', now - pot2 <= 4.05, f'{now} -> {pot2}')
    pg.screenshot(path='/tmp/potential_hero.png'); check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
