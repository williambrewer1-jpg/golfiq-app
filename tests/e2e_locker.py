"""Browser test for phase R5 (locker): the Locker tab, unlock state from real history, using an item, the fallback for a locked choice, skins in light and dark,
badge styles, wallpaper themes, confetti look, the unlock banner (once), and layout at 390x844 with the built-in sample data. Run: python3 tests/e2e_locker.py"""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright
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
AUDIT = """(sel) => { const bad = [];
  for (const el of document.querySelectorAll(sel + ' button, ' + sel + ' a.btn')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.textContent || '').trim().slice(0, 20)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
SETJ = """async (j) => { const g = window.__golfiq, S = await import('./store.js'); Object.assign(g.state.journal, j); await S.saveJournal(g.state); }"""
LK = "() => Object.fromEntries(window.__golfiq.progress.data().lk.items.map(i => [i.id, i.unlocked]))"
def open_locker(pg):
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({st_tab: 'locker'}))"); pg.goto(URL + '#settings'); pg.reload(); pg.wait_for_selector('.lk-grid'); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block', color_scheme='light')
    ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_timeout(1000)
    check('default look: no skin or badge attribute', pg.evaluate("() => !document.documentElement.dataset.skin && !document.documentElement.dataset.badge"))
    check('the first run takes what is unlocked as the starting point (no banner)', pg.evaluate("() => Array.isArray(window.__golfiq.state.journal.locker_seen)") and pg.query_selector('#lkNote') is None)
    open_locker(pg)
    check('Locker lists all 19 items', len(pg.query_selector_all('.lk-item')) == 19, len(pg.query_selector_all('.lk-item')))
    lk = pg.evaluate(LK); rank = pg.evaluate("() => window.__golfiq.progress.data().lv.rank.n")
    check('free items are unlocked and the rank items follow the sample rank', all(lk[k] for k in ['wallpaper:green', 'skin:clubhouse', 'badge:roundel', 'confetti:classic']) and lk['skin:claret'] == (rank >= 4), (rank, lk))
    check('locked items say how to earn them and show a padlock', pg.query_selector('.lk-item.off .small svg') is not None and 'Reach rank' in pg.inner_text('body'), pg.inner_text('.lk-grid')[:200])
    check('Links sand is locked and says duels arrive later', not lk['skin:sand'] and 'Duels arrive' in pg.inner_text('[data-lkitem="skin:sand"]'), pg.inner_text('[data-lkitem="skin:sand"]'))
    a = pg.evaluate(AUDIT, '.lk-grid'); check('Locker has no overflow and big tap targets', not a['overflow'] and not a['small'], a); pg.screenshot(path='/tmp/locker.png', full_page=True)
    # using an unlocked skin
    check('Claret is unlocked at the sample rank', lk['skin:claret'])
    pg.click('[data-lkuse="skin:claret"]'); pg.wait_for_timeout(500)
    check('using Claret sets the skin and stores the choice', pg.evaluate("() => document.documentElement.dataset.skin === 'claret' && window.__golfiq.state.settings.look.skin === 'claret'"))
    head = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--head').trim()"); check('the skin changes the colour tokens', head == '#5a1a2b', head)
    CON = """async () => { const L = await import('./locker.js'), cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(L.SKIN_VARS[k]).trim(), bad = [];
      for (const [f, b] of L.SKIN_PAIRS) { const r = L.contrast(v(f), v(b)); if (r < 4.5) bad.push(`${f}/${b} ${r.toFixed(2)}`); } return bad; }"""
    check('claret keeps contrast in light', pg.evaluate(CON) == [], pg.evaluate(CON))
    pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(200)
    check('claret uses its dark set when the phone is dark and keeps contrast', pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()") == '#1f0d14' and pg.evaluate(CON) == [])
    pg.emulate_media(color_scheme='light')
    a = pg.evaluate(AUDIT, '.lk-grid'); check('layout holds with the skin on', not a['overflow'], a)
    pg.reload(); pg.wait_for_selector('.lk-grid'); pg.wait_for_timeout(300)
    check('the choice survives a reload', pg.evaluate("() => document.documentElement.dataset.skin") == 'claret')
    # fallback: a locked choice is ignored
    pg.evaluate(SETJ, {}); pg.evaluate("async () => { const g = window.__golfiq, S = await import('./store.js'); g.state.settings.look = { skin: 'midnight', badge: 'laurel', confetti: 'gold', wallpaper: 'gold' }; await S.saveSettings(g.state, 'set_look', null, { look: g.state.settings.look }); }")
    pg.reload(); pg.wait_for_selector('.lk-grid'); pg.wait_for_timeout(300)
    check('locked choices fall back to the defaults', pg.evaluate("() => !document.documentElement.dataset.skin && !document.documentElement.dataset.badge && window.__golfiq.progress.look().confetti === 'classic'"))
    # unlock more from real history: bosses passed (5 and 10), five saved predictions beaten
    rids = pg.evaluate("() => window.__golfiq.ds.rounds.filter(r => r.format === '18').slice(0, 5).map(r => r.round_id)")
    pg.evaluate(SETJ, {'journey': {'bosses': [{'n': 10, 'date': '2026-01-01', 'passed': True, 'results': [], 'scores': {}}, {'n': 5, 'date': '2026-01-02', 'passed': True, 'results': [], 'scores': {}}]},
                       'predictions': [{'round_id': r, 'predicted': 200, 'lo': 190, 'hi': 210, 'made_at': '2026-01-01T00:00:00Z'} for r in rids]})
    pg.reload(); pg.wait_for_selector('.lk-grid'); pg.wait_for_timeout(500); lk = pg.evaluate(LK)
    check('bosses unlock the Sunday and Gold leaf themes and the Laurel badge', lk['wallpaper:sunday'] and lk['wallpaper:gold'] and lk['badge:laurel'], lk)
    check('five beaten saved predictions unlock Gold-only confetti', lk['confetti:gold'], lk)
    check('the unlock banner appears once for what just unlocked', pg.query_selector('#lkNote') is not None and 'Unlocked:' in pg.inner_text('#lkNote'), pg.inner_text('body')[:100])
    a = pg.evaluate(AUDIT, '#lkNote'); check('banner buttons are big enough and fit', not a['small'] and not a['overflow'], a); pg.screenshot(path='/tmp/locker_banner.png')
    pg.click('#lkTry'); pg.wait_for_timeout(500)
    first = pg.evaluate("() => window.__golfiq.state.settings.look"); check('Try it switches to the new item', first and (first.get('wallpaper') == 'sunday'), first)
    seen = pg.evaluate("() => window.__golfiq.state.journal.locker_seen"); check('everything announced is remembered', 'wallpaper:sunday' in seen and 'confetti:gold' in seen and 'badge:laurel' in seen, seen)
    pg.reload(); pg.wait_for_selector('.lk-grid'); pg.wait_for_timeout(600); check('the banner does not come back', pg.query_selector('#lkNote') is None)
    # badge, confetti
    check('an earlier choice is honoured as soon as it unlocks (Laurel was chosen while locked)', pg.evaluate("() => document.documentElement.dataset.badge") == 'laurel')
    pg.click('[data-lkuse="badge:roundel"]'); pg.wait_for_timeout(300); check('Roundel puts the default badge back', pg.evaluate("() => !document.documentElement.dataset.badge"))
    pg.click('[data-lkuse="badge:laurel"]'); pg.wait_for_timeout(300); check('using Laurel sets the badge style', pg.evaluate("() => document.documentElement.dataset.badge") == 'laurel')
    content = pg.evaluate("() => getComputedStyle(document.querySelector('.lk-grid .gp-badge[data-badge=laurel]'), '::before').content"); check('badge previews draw their own shape', content not in ('none', 'normal'), content)
    pg.click('[data-lkuse="confetti:classic"]'); pg.wait_for_timeout(300); pg.click('[data-lkuse="confetti:gold"]'); pg.wait_for_timeout(400)
    check('using Gold-only confetti stores it', pg.evaluate("() => window.__golfiq.state.settings.look.confetti") == 'gold')
    res = pg.evaluate("""async () => { const F = await import('./feel.js'); window.__feelLog = []; const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300; document.body.appendChild(cv);
      F.setLook('gold'); const a = F.confetti(cv); F.setLook('flags'); const b = F.confetti(cv); F.setLook('nonsense'); const c = F.confetti(cv); cv.remove(); return [a, b, c, window.__feelLog.filter(x => x.startsWith('confetti')).length]; }""")
    check('every confetti look draws without errors', res[3] == 3 and all(x in (True, False) for x in res[:3]), res)
    # wallpaper themes offered follow the unlocks
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({}))"); pg.goto(URL + '#caddie'); pg.reload(); pg.wait_for_selector('#wpCard', state='attached'); pg.wait_for_timeout(500)
    labels = pg.text_content('#wpCard'); check('the wallpaper card offers unlocked themes only', 'Championship Sunday' in labels and 'Gold leaf' in labels and 'Heritage tweed' not in labels, labels[:300])
    check('and points to the Locker for the rest', 'Settings → Locker' in labels)
    # the level sheet links to the Locker
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('[data-level]'); pg.click('[data-level]'); pg.wait_for_selector('#sheet.open [data-lklink]'); pg.click('#sheet.open [data-lklink]'); pg.wait_for_selector('.lk-grid')
    check('the level sheet opens the Locker', pg.evaluate("() => location.hash") == '#settings')
    check('no page errors', not errs, errs[:3])
    b.close()
print('\n%s' % ('ALL PASSED' if not fails else 'FAILED: ' + ', '.join(fails))); sys.exit(1 if fails else 0)
