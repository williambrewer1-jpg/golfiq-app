"""Browser test for the Course view (course-view plan, phase 1). Run: python3 tests/e2e_courseview.py

Uses an invented course (tests/fake_course.py) served in place of OpenStreetMap, flat weather and terrain, and GPS moved
with Playwright's geolocation. Never talks to the real map, weather or imagery services.
"""
import http.server, threading, functools, sys, os, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_course import hole, point, route_services, NAME

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHOTS = os.environ.get('SHOTS', '/tmp/courseview')
os.makedirs(SHOTS, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra != '' and not ok else ''))
    if not ok: fails.append(name)

# a stand-in screen wake lock that counts requests and releases
WAKE = """Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (t) => { window.__wl = (window.__wl || 0) + 1;
  const s = { released: false, release: async () => { if (!s.released) { s.released = true; window.__wlRel = (window.__wlRel || 0) + 1; } }, addEventListener() {} }; return s; } } });"""

def geo(lat_lon, acc=5):
    return {'latitude': lat_lon[0], 'longitude': lat_lon[1], 'accuracy': acc}

def new_page(b, w, h, gps=True, weather=True, outline=True):
    kw = dict(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block', has_touch=True)
    if gps: kw.update(geolocation=geo(hole(1)['tee']), permissions=['geolocation'])
    ctx = b.new_context(**kw); ctx.add_init_script('window.__feelDelay = 0'); ctx.add_init_script(WAKE)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    route_services(pg, weather=weather, outline=outline)
    return ctx, pg, errs

def start_round(pg, n=9):
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart')
    if not pg.query_selector('[data-pickcourse]'): pg.click('#plNear')
    pg.wait_for_selector('[data-pickcourse]')
    pg.click('[data-pickcourse]:has-text("%s")' % NAME); pg.wait_for_timeout(200)
    pg.select_option('select[name=n]', str(n)); pg.click('#plStart button.btn')
    pg.wait_for_selector('#cvRoot'); pg.wait_for_function("() => window.__golfiq.state.osm && Object.keys(window.__golfiq.state.osm).some(k => k.startsWith('osm-way'))")
    pg.wait_for_timeout(800)

def num(s):
    return int(''.join(ch for ch in s if ch.isdigit()) or -1)

def yards(pg):
    out = {}
    for k in ['f', 'm', 'b']:
        el = pg.query_selector(f'#cvYards .{k} b'); out[k] = num(el.inner_text()) if el else None
    return out

def no_overflow(pg):
    return pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1")

def controls_ok(pg, label, skip_handle=False):
    """Every visible control in the sheet and the map tools: at least 48 px tall and in the bottom half of the screen."""
    bad = pg.evaluate("""(SKIP) => { const H = innerHeight, out = [];
      for (const b of document.querySelectorAll('#cvSheet button, #cvSheet a.btn, .cv-tools button')) { if (SKIP && b.id === 'cvHandle') continue;
        const r = b.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') continue;
        if (r.bottom < 0 || r.top > H) continue;                                  // scrolled out of the sheet
        const sheetTop = document.querySelector('#cvSheet').getBoundingClientRect().top;
        if (r.height < 47.5 || r.top < H / 2 && !(r.top >= sheetTop)) out.push([b.textContent.trim().slice(0, 20), Math.round(r.top), Math.round(r.height)]);
      } return out; }""", skip_handle)
    check(f'{label}: controls at least 48 px and in the bottom half', not bad, bad)

def state(pg):
    return pg.evaluate("() => { const s = window.__golfiq.extra.play.course._state(); return { custom: s.L ? s.L.custom : null, aim: s.L ? s.L.aim : null, hole: s.L ? s.L.hole : null, wake: s.wake }; }")

def draft(pg):
    return pg.evaluate("() => window.__golfiq.state.journal.draft")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ------------------------------------------------------------ 390 x 844: a round in the Course view
    ctx, pg, errs = new_page(b, 390, 844)
    start_round(pg)
    check('course view opens by itself when the round starts', pg.query_selector('#cvRoot') is not None)
    check('app header and tab bar are hidden', pg.evaluate("() => getComputedStyle(document.querySelector('header')).display === 'none' && getComputedStyle(document.querySelector('nav.bottom')).display === 'none'"))
    check('map fills the screen', pg.evaluate("() => { const r = document.querySelector('#hm').getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }"))
    top = pg.inner_text('#cvTop')
    check('top bar shows hole, par and hole length', 'Hole 1' in top and 'Par 4' in top and '394 yd' in top, top)
    check('top bar shows GPS accuracy in words, not only a coloured dot', 'GPS ±5 yd' in top, top)
    y = yards(pg)
    check('front, middle and back of the green from the tee', y['f'] and y['m'] and y['b'] and y['f'] < y['m'] < y['b'], y)
    check('middle is the hole length (360 m = 394 yd)', abs(y['m'] - 394) <= 1, y)
    check('front and back are 14 m either side of the middle', abs(y['m'] - y['f'] - 15) <= 1 and abs(y['b'] - y['m'] - 15) <= 1, y)
    fs = pg.evaluate("""() => { const t = [...document.querySelectorAll('#cvRoot *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length);
      const sz = (e) => parseFloat(getComputedStyle(e).fontSize), mid = document.querySelector('#cvYards .m b');
      return { mid: sz(mid), max: Math.max(...t.filter(e => e !== mid).map(sz)), minMap: Math.min(...[...document.querySelectorAll('#hm text')].map(sz)),
               minYard: Math.min(...[...document.querySelectorAll('#cvYards b, #hm .hm-tag text')].map(sz)), minOverlay: Math.min(...[...document.querySelectorAll('#cvTop *, #cvYards *, #cvPeek *, .cv-tools *')].filter(e => e.getClientRects().length && e.textContent.trim()).map(sz)) }; }""")
    check('middle distance is the largest text on the screen', fs['mid'] > fs['max'], fs)
    check('map text is at least 15 px', fs['minMap'] >= 15, fs)
    check('yardages are at least 28 px', fs['minYard'] >= 28, fs)
    check('text over the map and in the peek is at least 12 px (labels 15 px)', fs['minOverlay'] >= 12, fs)
    peek = pg.inner_text('#cvPeek')
    check('peek shows the club in hand, the distance to the aim and the trouble', 'to aim' in peek and 'trouble' in peek and '▾' in peek, peek)
    controls_ok(pg, 'peek')
    check('no horizontal overflow (peek)', no_overflow(pg))
    check('screen wake lock requested on open', (pg.evaluate("() => window.__wl || 0") or 0) >= 1)
    check('no double-tap zoom: the view and the map take touches themselves', pg.evaluate("() => getComputedStyle(document.querySelector('#cvRoot')).touchAction === 'manipulation' && getComputedStyle(document.querySelector('#hm')).touchAction === 'none'"))
    pg.dblclick('#cvMap', position={'x': 60, 'y': 600}); pg.wait_for_timeout(200)
    check('a double tap on the map does not zoom the page', pg.evaluate("() => (window.visualViewport ? visualViewport.scale : 1) === 1"))
    pg.click('[data-cvrecentre]'); pg.wait_for_timeout(300)                                              # undo the aim the double tap set
    pg.screenshot(path=f'{SHOTS}/390_peek.png')

    # ---- live GPS: walk up the hole; only the moving layer redraws, at most once a second
    pg.evaluate("() => { document.querySelector('#hm').dataset.mark = 'static'; window.__dyn = 0; new MutationObserver(() => window.__dyn++).observe(document.querySelector('#hmDyn'), { childList: true }); }")
    aim0 = state(pg)['aim']
    ctx.set_geolocation(geo(point(1, 100))); pg.wait_for_timeout(1600)
    y2 = yards(pg)
    check('middle distance drops as you walk (100 m = 109 yd)', abs((y['m'] - y2['m']) - 109) <= 2, (y, y2))
    check('the static map is not redrawn on a GPS update', pg.evaluate("() => document.querySelector('#hm').dataset.mark === 'static'"))
    s = state(pg)
    check('an aim you have not touched follows you', s['custom'] is False and s['aim'] != aim0, s)
    pg.evaluate("() => { window.__dyn = 0; }")
    for i in range(10): ctx.set_geolocation(geo(point(1, 101 + i * 0.6))); pg.wait_for_timeout(100)
    pg.wait_for_timeout(1200)
    n_dyn = pg.evaluate("() => window.__dyn")
    check('ten fixes in a second redraw the moving layer at most twice (once a second)', 1 <= n_dyn <= 3, n_dyn)

    # ---- tap to aim, then walking does not move it; recentre resets it
    pg.evaluate("() => { window.__dyn = 0; }")
    pg.mouse.click(200, 330); pg.wait_for_timeout(300)
    s = state(pg); d = draft(pg)
    check('tap on the map moves the aim there', s['custom'] is True and d['aim'] and d['aim']['1'], (s, d.get('aim')))
    check('tap to aim redraws only the moving layer', pg.evaluate("() => document.querySelector('#hm').dataset.mark === 'static' && window.__dyn >= 1"))
    aim_tap = s['aim']
    ctx.set_geolocation(geo(point(1, 115))); pg.wait_for_timeout(1500)
    check('walking does not move an aim you set', state(pg)['aim'] == aim_tap, (aim_tap, state(pg)['aim']))
    # drag the handle: the aim moves with it
    hx, hy = pg.evaluate("() => { const c = document.querySelector('.hm-pad circle'), r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
    pg.mouse.move(hx, hy); pg.mouse.down(); pg.mouse.move(hx + 30, hy - 20, steps=6); pg.mouse.up(); pg.wait_for_timeout(300)
    check('dragging the handle moves the aim', state(pg)['aim'] != aim_tap)
    check('dragging keeps the static map', pg.evaluate("() => document.querySelector('#hm').dataset.mark === 'static'"))
    pg.click('[data-cvrecentre]'); pg.wait_for_timeout(400)
    check('recentre resets the aim to the default for where you are', state(pg)['custom'] is False and not (draft(pg).get('aim') or {}).get('1'))

    # ---- zoom presets
    labels = []
    for _ in range(3): pg.click('[data-cvzoom]'); pg.wait_for_timeout(250); labels.append(pg.inner_text('[data-cvzoom]').split('\n')[-1])
    check('zoom cycles Hole, Green, Shot', labels == ['Hole', 'Green', 'Shot'], labels)
    pg.click('[data-cvzoom]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{SHOTS}/390_zoom_hole.png')
    pg.click('[data-cvzoom]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{SHOTS}/390_zoom_green.png')
    check('green zoom puts the green in the clear part of the map', pg.evaluate("""() => { const g = [...document.querySelectorAll('#hm path')].find(p => p.getAttribute('fill') === '#bfe98f'); if (!g) return false; const r = g.getBoundingClientRect(), top = document.querySelector('#cvTop').getBoundingClientRect().bottom, bot = document.querySelector('#cvSheet').getBoundingClientRect().top; return r.top >= top - 2 && r.bottom <= bot + 2 && r.width > 120; }"""))
    pg.click('[data-cvzoom]'); pg.wait_for_timeout(300)

    # ---- the sheet: Club tab, Strategy tab, Score with the same taps as the classic page
    pg.click('[data-cvpeekclub]'); pg.wait_for_selector('#cvRoot[data-sheet="half"] #plRec')
    check('club switcher opens the Club tab with the recommendations', pg.query_selector('#plRec .recrow') is not None)
    pg.screenshot(path=f'{SHOTS}/390_half_club.png')
    controls_ok(pg, 'half sheet, Club tab')
    other = pg.query_selector('#plRec .recrow:not(.on)')
    if other:
        cid = other.get_attribute('data-club'); other.click(); pg.wait_for_timeout(300)
        check('picking a club changes the club in hand', pg.evaluate("(c) => window.__golfiq.extra.play.course._state().L.club === c", cid))
    pg.click('[data-cvtab="strategy"]'); pg.wait_for_timeout(1200)
    check('Strategy tab shows the expected-strokes table', 'strokes' in pg.inner_text('#cvStrat') or 'Needs clubs' in pg.inner_text('#cvStrat'), pg.inner_text('#cvStrat')[:200])
    pg.screenshot(path=f'{SHOTS}/390_half_strategy.png')
    pg.click('[data-cvtab="score"]'); pg.wait_for_selector('#cvBody [data-step="strokes"]')
    pg.screenshot(path=f'{SHOTS}/390_half_score.png')
    controls_ok(pg, 'half sheet, Score tab')
    check('no horizontal overflow (half sheet)', no_overflow(pg))
    # quick score: par on each hole is one tap on + then Next – the same as the classic page
    for i in range(1, 4):
        taps = 0
        pg.click('#cvBody [data-step="strokes"][data-d="1"]'); taps += 1
        pg.click('#cvBody #plNext'); taps += 1; pg.wait_for_timeout(250)
        pg.wait_for_selector('#cvRoot[data-sheet="half"] #cvBody [data-step="strokes"]')
    d = draft(pg)
    check('three holes scored at par with two taps each', [d['holes'][str(n)]['strokes'] for n in (1, 2, 3)] == [d['holes'][str(n)]['par'] for n in (1, 2, 3)] and d['hole'] == 4, (d['hole'], [d['holes'][str(n)]['strokes'] for n in (1, 2, 3)]))
    check('the sheet stays open on Score from hole to hole', pg.evaluate("() => document.querySelector('#cvRoot').dataset.sheet") == 'half')
    top = pg.inner_text('#cvTop')
    check('top bar shows the score to par and holes played', 'E thru 3' in top and 'Hole 4' in top and 'Par 5' in top, top)
    pg.evaluate("() => { document.querySelector('#hm').dataset.mark = 'static'; }")
    pg.click('#cvBody [data-step="putts"][data-d="1"]'); pg.wait_for_timeout(100)
    check('a stepper change redraws the sheet, not the map', pg.evaluate("() => document.querySelector('#hm').dataset.mark === 'static'") and draft(pg)['holes']['4']['putts'] == 2)
    # previous / next hole from the top bar
    pg.click('[data-cvstep="1"]'); pg.wait_for_timeout(400); check('next-hole arrow goes to hole 5', 'Hole 5' in pg.inner_text('#cvTitle'))
    pg.click('[data-cvstep="-1"]'); pg.wait_for_timeout(400); check('previous-hole arrow goes back to hole 4', 'Hole 4' in pg.inner_text('#cvTitle'))
    # full height: the scorecard
    pg.click('#cvHandle'); pg.wait_for_selector('#cvRoot[data-sheet="full"] #plFinish')
    check('full sheet holds the scorecard with finish and discard', pg.query_selector('#cvBody #plDiscard') is not None and pg.query_selector('#cvBody .strip') is not None)
    pg.screenshot(path=f'{SHOTS}/390_full.png')
    controls_ok(pg, 'full sheet (handle aside: Back to the map is at the bottom)', True)
    check('full sheet has a Back to the map button at the bottom', pg.query_selector('#cvBody [data-cvsheet="peek"]') is not None)
    pg.click('#cvHandle'); pg.wait_for_timeout(250)
    check('handle tap from full goes back to the peek', pg.evaluate("() => document.querySelector('#cvRoot').dataset.sheet") == 'peek')
    # drag the handle up two steps
    hb = pg.query_selector('#cvHandle').bounding_box()
    pg.mouse.move(hb['x'] + hb['width'] / 2, hb['y'] + 20); pg.mouse.down(); pg.mouse.move(hb['x'] + hb['width'] / 2, hb['y'] - 300, steps=8); pg.mouse.up(); pg.wait_for_timeout(250)
    check('dragging the handle up a long way opens the full sheet', pg.evaluate("() => document.querySelector('#cvRoot').dataset.sheet") == 'full')
    pg.click('#cvHandle'); pg.wait_for_timeout(200)

    # ---- reload mid-hole: the round and the view come back
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1200)
    d = draft(pg)
    check('round survives a reload mid-hole', 'Hole 4' in pg.inner_text('#cvTitle') and d['holes']['3']['strokes'] == d['holes']['3']['par'] and d['holes']['4']['putts'] == 2, pg.inner_text('#cvTitle'))
    check('distances come back after the reload', yards(pg)['m'] and yards(pg)['m'] > 0)

    # ---- close: the classic page, still working; reopen
    pg.evaluate("() => { window.__wlRel = 0; }")
    pg.click('[data-cvclose]'); pg.wait_for_selector('#cvOpen')
    check('close returns to the classic page with an Open course view button', pg.query_selector('#cvRoot') is None and pg.query_selector('#plScore') is not None)
    check('header is back on the classic page', pg.evaluate("() => getComputedStyle(document.querySelector('header')).display !== 'none'"))
    check('wake lock released on close', (pg.evaluate("() => window.__wlRel || 0") or 0) >= 1)
    pg.click('#plScore [data-step="strokes"][data-d="1"]'); pg.wait_for_timeout(300)
    check('classic score steppers still work', draft(pg)['holes']['4']['strokes'] == draft(pg)['holes']['4']['par'])
    check('classic hole map still draws', pg.query_selector('.playcard #hm') is not None)
    pg.screenshot(path=f'{SHOTS}/390_classic.png', full_page=False)
    pg.reload(); pg.wait_for_selector('#cvOpen'); check('classic page stays chosen for this round after a reload', pg.query_selector('#cvRoot') is None)
    pg.click('#cvOpen'); pg.wait_for_selector('#cvRoot'); check('Open course view brings it back', 'Hole 4' in pg.inner_text('#cvTitle'))

    # ---- a round already in progress from before this update (no new fields) still opens
    pg.evaluate("""async () => { const g = window.__golfiq, d = g.state.journal.draft; delete d.aim; delete d.wx;
      const ui = JSON.parse(localStorage.getItem('golfiq-ui') || '{}'); for (const k of ['pl_sheet', 'pl_stab', 'pl_zoom', 'pl_cv_off', 'pl_plays_open']) delete ui[k]; localStorage.setItem('golfiq-ui', JSON.stringify(ui));
      const S = await import('./store.js'); await S.saveJournal(g.state); }""")
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(800)
    check('an older round in progress opens in the Course view', 'Hole 4' in pg.inner_text('#cvTitle') and yards(pg)['m'])

    # ---- finish the round from the scorecard
    pg.click('[data-cvscore]'); pg.wait_for_selector('#cvBody [data-step="strokes"]')
    for i in range(6):
        if not draft(pg)['holes'][str(draft(pg)['hole'])]['strokes']: pg.click('#cvBody [data-step="strokes"][data-d="1"]')
        nxt = pg.inner_text('#cvBody #plNext'); pg.click('#cvBody #plNext'); pg.wait_for_timeout(250)
        if 'finish' in nxt.lower(): break
    pg.wait_for_selector('#cvRoot[data-sheet="full"] #plFinish')
    rid = 'garmin-' + draft(pg)['id']
    pg.click('#cvBody #plFinish'); pg.wait_for_timeout(1500)
    r = pg.evaluate("(id) => { const r = window.__golfiq.ds.rounds.find(x => x.round_id === id); return r ? { holes: window.__golfiq.ds.holes.filter(h => h.round_id === id).length } : null; }", rid)
    check('finishing saves a normal 9-hole round', r and r['holes'] == 9, r)
    check('course view is gone after finishing', pg.query_selector('#cvRoot') is None and draft(pg) is None)
    check('no script errors (390 x 844)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ 320 x 568
    ctx, pg, errs = new_page(b, 320, 568)
    start_round(pg)
    pg.screenshot(path=f'{SHOTS}/320_peek.png')
    check('320: no horizontal overflow (peek)', no_overflow(pg))
    controls_ok(pg, '320 peek')
    check('320: the title fits on one line', pg.evaluate("() => { const h = document.querySelector('#cvTitle'); return h.scrollWidth <= h.clientWidth + 1; }"))
    check('320: middle distance shown', yards(pg)['m'] and yards(pg)['m'] > 0)
    check('320: your position is above the sheet', pg.evaluate("() => { const me = document.querySelector('#hm .hm-me').getBoundingClientRect(), s = document.querySelector('#cvSheet').getBoundingClientRect(); return me.bottom <= s.top; }"))
    pg.click('[data-cvscore]'); pg.wait_for_selector('#cvBody [data-step="strokes"]')
    pg.screenshot(path=f'{SHOTS}/320_half_score.png')
    check('320: no horizontal overflow (Score tab)', no_overflow(pg))
    controls_ok(pg, '320 Score tab')
    pg.click('#cvBody [data-step="strokes"][data-d="1"]'); pg.wait_for_timeout(150)
    check('320: score entry works', draft(pg)['holes']['1']['strokes'] == 4)
    pg.click('#cvHandle'); pg.wait_for_selector('#cvRoot[data-sheet="full"] #plFinish'); pg.screenshot(path=f'{SHOTS}/320_full.png')
    check('320: no horizontal overflow (full)', no_overflow(pg))
    check('no script errors (320 x 568)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ no GPS, no weather: still usable, says what is missing
    ctx, pg, errs = new_page(b, 390, 844, weather=False)
    start_round(pg); ctx.clear_permissions(); pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    msg = pg.inner_text('#cvMsg') if pg.is_visible('#cvMsg') else ''
    check('without GPS it says so in one short line', ('GPS' in msg or 'Location' in msg) and len(msg) < 70, msg)
    check('without GPS it shows the view from the tee', 'tee' in msg.lower() and yards(pg)['m'] and abs(yards(pg)['m'] - 394) <= 1, (msg, yards(pg)))
    check('GPS shown as missing in words', 'No GPS' in pg.inner_text('#cvSub'))
    pg.screenshot(path=f'{SHOTS}/390_no_gps.png')
    check('no script errors (no GPS)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ a course with no map: score entry still works
    ctx, pg, errs = new_page(b, 390, 844, outline=False)
    start_round(pg)
    msg = pg.inner_text('#cvMsg') if pg.is_visible('#cvMsg') else ''
    check('without a course map it says so', 'no course map' in msg.lower(), msg)
    check('without a green it explains instead of drawing', pg.query_selector('.cv-empty') is not None)
    pg.click('[data-cvscore]'); pg.wait_for_selector('#cvBody [data-step="strokes"]'); pg.click('#cvBody [data-step="strokes"][data-d="1"]'); pg.wait_for_timeout(150)
    check('without a map, quick score still works', draft(pg)['holes']['1']['strokes'] == 4)
    pg.screenshot(path=f'{SHOTS}/390_no_map.png')
    check('no script errors (no map)', not errs, errs[:3])
    ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
