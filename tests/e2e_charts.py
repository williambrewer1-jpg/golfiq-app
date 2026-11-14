"""Browser test for the app-drawn charts (charts.js): the trend chart with its 5/10/20 window and drag-to-scrub, tap to select, bars, layout at 390x844 and 375x667,
light and dark, reduced motion, and that the converted pages no longer ask Plotly for anything.
Plotly is replaced by a recorder (the test sandbox has no internet). Run: python3 tests/e2e_charts.py   (set SHOTS=dir to save screenshots)"""
import http.server, threading, functools, os, re
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html'
SHOTS = os.environ.get('SHOTS')
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
FAKE = "window.__plots = []; window.Plotly = { newPlot(el, t, l, c) { window.__plots.push(el.id); }, purge() {} };"

def shot(pg, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=True)
def text(pg, sel): return pg.inner_text(sel).strip()
def no_hscroll(pg): return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
def go(pg, tab, sub=None):
    pg.evaluate("() => { window.__plots.length = 0 }")
    pg.evaluate("() => { location.hash = '#stats' }"); pg.wait_for_selector('[data-seg="sx_tab"]')
    pg.click(f'[data-seg="sx_tab"] button[data-v="{tab}"]'); pg.wait_for_timeout(250)

with sync_playwright() as p:
    b = p.chromium.launch()
    for vp in [{'width': 390, 'height': 844}, {'width': 375, 'height': 667}]:
        tag = f"{vp['width']}x{vp['height']}"
        ctx = b.new_context(viewport=vp, has_touch=False); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort()); pg.add_init_script(FAKE)
        pg.goto(URL); pg.click('#loadSample'); pg.wait_for_timeout(500)
        # ---- Home
        pg.evaluate("() => { location.hash = '#home' }"); pg.wait_for_selector('.ch-trend'); pg.wait_for_timeout(300)
        check(f'[{tag}] home: trend chart is drawn by the app, Plotly is not asked', pg.query_selector('.ch-trend svg') is not None and pg.evaluate("() => window.__plots.length") == 0)
        check(f'[{tag}] home: no horizontal scroll', no_hscroll(pg)); shot(pg, f'home-{tag}')
        # ---- Scoring: the trend chart
        go(pg, 'scoring'); pg.wait_for_selector('.ch-trend')
        seg = pg.query_selector_all('[data-seg="tw_stableford_round"] button')
        check(f'[{tag}] scoring: 5 / 10 / 20 round windows offered for 44 rounds', [s.inner_text() for s in seg] == ['5 rounds', '10 rounds', '20 rounds'], str([s.inner_text() for s in seg]))
        check(f'[{tag}] scoring: starts on the 5-round average', '5-round avg' in text(pg, '.ch-trend .ch-lab').lower())
        big0, sub0 = text(pg, '.ch-trend .ch-big'), text(pg, '.ch-trend .ch-sub')
        pg.click('[data-seg="tw_stableford_round"] button[data-v="10"]'); pg.wait_for_selector('.ch-trend')
        check(f'[{tag}] scoring: the 10-round window redraws', '10-round avg' in text(pg, '.ch-trend .ch-lab').lower() and pg.query_selector('[data-seg="tw_stableford_round"] button.on').inner_text() == '10 rounds')
        pg.click('[data-seg="tw_stableford_round"] button[data-v="5"]'); pg.wait_for_selector('.ch-trend'); pg.wait_for_timeout(300)
        # ---- scrub: press, drag, the headline follows, lift restores
        svg = pg.query_selector('.ch-trend svg'); pg.evaluate("() => document.querySelector('.ch-trend svg').scrollIntoView({block: 'center'})"); pg.wait_for_timeout(250); box = svg.bounding_box(); y = box['y'] + box['height'] / 2
        check(f'[{tag}] scrub: the chart lets the page scroll vertically (touch-action pan-y)', pg.evaluate("() => getComputedStyle(document.querySelector('.ch-trend svg')).touchAction") == 'pan-y')
        pg.mouse.move(box['x'] + box['width'] * 0.9, y); pg.mouse.down(); pg.mouse.move(box['x'] + box['width'] * 0.5, y, steps=6)
        mid_big, mid_sub, mid_lab = text(pg, '.ch-trend .ch-big'), text(pg, '.ch-trend .ch-sub'), text(pg, '.ch-trend .ch-lab')
        check(f'[{tag}] scrub: dragging shows a single round (cursor, value, course)', pg.evaluate("() => getComputedStyle(document.querySelector('.ch-trend .ch-cur')).opacity") == '1' and 'round ' in mid_lab.lower() and 'avg' not in mid_lab.lower() and '·' in mid_sub, f'{mid_lab} / {mid_sub}')
        pg.mouse.move(box['x'] + box['width'] * 0.2, y, steps=6); lab2 = text(pg, '.ch-trend .ch-lab')
        check(f'[{tag}] scrub: moving along changes the round', lab2 != mid_lab, f'{mid_lab} vs {lab2}')
        pg.mouse.up(); pg.wait_for_timeout(50)
        check(f'[{tag}] scrub: lifting restores the headline', text(pg, '.ch-trend .ch-big') == big0 and text(pg, '.ch-trend .ch-sub') == sub0 and pg.evaluate("() => getComputedStyle(document.querySelector('.ch-trend .ch-cur')).opacity") == '0')
        # ---- tap keeps a round up, a second tap clears it
        pg.mouse.click(box['x'] + box['width'] * 0.6, y); pg.wait_for_timeout(50); tapped = text(pg, '.ch-trend .ch-lab')
        check(f'[{tag}] tap: selects a round and keeps it', 'round ' in tapped.lower() and 'avg' not in tapped.lower())
        pg.mouse.click(box['x'] + box['width'] * 0.6, y); pg.wait_for_timeout(50)
        check(f'[{tag}] tap: tapping the same round again clears it', text(pg, '.ch-trend .ch-big') == big0)
        # ---- no zoom: pinch and double-click do nothing to the page
        pg.mouse.dblclick(box['x'] + box['width'] * 0.5, y); pg.wait_for_timeout(100)
        check(f'[{tag}] no zoom: a double tap leaves the page scale alone', pg.evaluate("() => (window.visualViewport ? window.visualViewport.scale : 1)") == 1)
        # ---- bars
        bars = pg.query_selector_all('.ch-bar'); check(f'[{tag}] scoring: distribution bars are drawn', len(bars) >= 4 and pg.query_selector('.ch-bar.hot') is not None, str(len(bars)))
        cap0 = pg.inner_text('.ch:has(.ch-bar) .ch-cap')
        pg.evaluate("() => document.querySelectorAll('.ch-bar')[1].scrollIntoView({block: 'center'})"); pg.wait_for_timeout(150); pg.click('.ch-bar >> nth=1'); pg.wait_for_timeout(50)
        check(f'[{tag}] bars: tapping a bar shows its detail', pg.inner_text('.ch:has(.ch-bar) .ch-cap') != cap0 and pg.query_selector('.ch-bar.on') is not None, pg.inner_text('.ch:has(.ch-bar) .ch-cap'))
        pg.click('.ch-bar >> nth=1'); pg.wait_for_timeout(50)
        check(f'[{tag}] bars: tapping again clears it', pg.inner_text('.ch:has(.ch-bar) .ch-cap') == cap0 and pg.query_selector('.ch-bar.on') is None)
        check(f'[{tag}] scoring: no horizontal scroll', no_hscroll(pg)); shot(pg, f'scoring-{tag}')
        # ---- killers
        check(f'[{tag}] scoring: score-killer bars are drawn', pg.query_selector('h3:has-text("Score killers per round") + .ch .ch-bar') is not None)
        # ---- other trend charts (Tee, Approach, Putting) use the same chart
        for tab in ['tee', 'approach', 'putting']:
            go(pg, tab); check(f'[{tag}] {tab}: trend chart is drawn', pg.query_selector('.ch-trend svg') is not None and pg.evaluate("() => !document.querySelector('.ch-trend').innerHTML.includes('NaN')"))
        # ---- dark mode: nothing is hard-coded, the chart reads the theme
        pg.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')"); go(pg, 'scoring'); pg.wait_for_selector('.ch-trend'); pg.wait_for_timeout(300)
        big_col = pg.evaluate("() => getComputedStyle(document.querySelector('.ch-big')).color")
        check(f'[{tag}] dark: headline uses the dark accent', big_col == 'rgb(242, 207, 74)', big_col); shot(pg, f'scoring-dark-{tag}')
        pg.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
        check(f'[{tag}] no page errors', not errs, str(errs[:3])); ctx.close()
    # ---- reduced motion
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce'); pg = ctx.new_page()
    pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort()); pg.add_init_script(FAKE); pg.goto(URL); pg.click('#loadSample'); pg.wait_for_timeout(500); pg.evaluate("() => { location.hash = '#home' }"); pg.wait_for_selector('.ch-trend')
    check('reduced motion: charts do not animate', pg.evaluate("() => getComputedStyle(document.querySelector('.ch')).animationName") == 'none' and pg.evaluate("() => getComputedStyle(document.querySelector('.ch .ln')).animationName") == 'none')
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); raise SystemExit(1 if fails else 0)
