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
        # ---- phase B: Scoring, Tee and Approach have no Plotly left and the golf-native charts respond to taps
        def tap_detail(sel, nth=0, label=''):
            pg.evaluate("([s, n]) => document.querySelectorAll(s)[n].scrollIntoView({block: 'center'})", [sel, nth]); pg.wait_for_timeout(120)
            host = pg.locator(f'.ch:has({sel})').first; before = host.locator('.ch-cap').inner_text()
            pg.locator(sel).nth(nth).click(); pg.wait_for_timeout(60); after = host.locator('.ch-cap').inner_text()
            check(f'[{tag}] {label}: tapping shows detail', after != before and pg.locator(f'{sel}.on').count() == 1, f'{before!r} -> {after!r}')
        go(pg, 'scoring'); pg.wait_for_selector('.ch-strip'); pg.wait_for_timeout(200)
        check(f'[{tag}] scoring: no Plotly chart is requested', pg.evaluate("() => window.__plots.length") == 0, str(pg.evaluate("() => window.__plots.length")))
        check(f'[{tag}] scoring: score types strip has parts and a key', pg.locator('.ch-strip .ch-seg').count() >= 4 and pg.locator('.ch-key span').count() >= 4)
        tap_detail('.ch-seg', 1, 'score types strip')
        check(f'[{tag}] scoring: hole by hole is 18 coloured cells in two nines', pg.locator('.ch-hole').count() == 18 and pg.locator('.ch-nine').count() == 2, str(pg.locator('.ch-hole').count()))
        tap_detail('.ch-hole', 4, 'hole grid'); check(f'[{tag}] scoring: hole detail names the hole', 'Hole 5' in pg.locator('.ch:has(.ch-hole) .ch-cap').inner_text())
        check(f'[{tag}] scoring: hole grid has no horizontal overflow', pg.evaluate("() => { const g = document.querySelector('.ch-holes'); return g.scrollWidth <= g.clientWidth + 1 }") and no_hscroll(pg))
        pg.select_option('select[data-sel="sc_course"]', index=1); pg.wait_for_selector('.ch-hole'); check(f'[{tag}] scoring: switching course redraws the grid', pg.locator('.ch-hole').count() >= 9)
        go(pg, 'tee'); pg.wait_for_selector('.ch-zone'); check(f'[{tag}] tee: no Plotly chart is requested', pg.evaluate("() => window.__plots.length") == 0)
        check(f'[{tag}] tee: fairway shows three percentages', pg.locator('.ch-zone .big').count() == 3 and all('%' in t for t in pg.locator('.ch-zone .big').all_text_contents()))
        tap_detail('.ch-zone', 0, 'fairway'); check(f'[{tag}] tee: fairway detail says what the area is', 'Fairway' in pg.locator('.ch:has(.ch-zone) .ch-cap').inner_text() or 'Missed' in pg.locator('.ch:has(.ch-zone) .ch-cap').inner_text())
        go(pg, 'approach'); pg.wait_for_selector('.ch-hrow'); check(f'[{tag}] approach: no Plotly chart is requested', pg.evaluate("() => window.__plots.length") == 0)
        check(f'[{tag}] approach: GIR by par tiles', pg.locator('h3:has-text("GIR by par") + .kpis .kpi').count() >= 2)
        tap_detail('.ch-hrow', 2, 'by distance'); tap_detail('.ch-zone', 3, 'missed greens')
        check(f'[{tag}] approach: no horizontal scroll', no_hscroll(pg)); shot(pg, f'approach-{tag}')
        # ---- phase C: Short game, Putting, Strokes gained, Handicap and Rounds compare
        go(pg, 'short'); pg.wait_for_selector('.card:has(h2:has-text("Scrambling by round")) .ch svg'); check(f'[{tag}] short game: scrambling line is drawn, no Plotly', pg.evaluate("() => window.__plots.length") == 0)
        go(pg, 'putting'); pg.wait_for_selector('h3:has-text("Share of holes by putts") + .ch .ch-seg'); check(f'[{tag}] putting: putts-per-hole strip, no Plotly', pg.evaluate("() => window.__plots.length") == 0 and pg.locator('.ch-strip .ch-seg').count() >= 2)
        tap_detail('.ch-seg', 0, 'putts strip')
        go(pg, 'sg'); pg.wait_for_selector('.ch-hbars, .err'); has_sg = pg.query_selector('.ch-hbars') is not None
        if has_sg:
            check(f'[{tag}] strokes gained: diverging bars and one small line per category, no Plotly', pg.evaluate("() => window.__plots.length") == 0 and pg.locator('.ch-hrow').count() >= 4 and pg.locator('.ch-spark').count() == 4, f"{pg.locator('.ch-hrow').count()} rows {pg.locator('.ch-spark').count()} sparks")
            tap_detail('.ch-hrow', 0, 'strokes gained'); check(f'[{tag}] strokes gained: no horizontal scroll', no_hscroll(pg))
        go(pg, 'handicap'); pg.wait_for_selector('.card:has(h2:has-text("Index over time")) .ch svg'); check(f'[{tag}] handicap: index chart is drawn, no Plotly', pg.evaluate("() => window.__plots.length") == 0)
        hsvg = pg.locator('.card:has(h2:has-text("Index over time")) .ch svg').first; pg.evaluate("() => document.querySelector('.card:has(h2) .ch svg').scrollIntoView({block: 'center'})"); pg.wait_for_timeout(200); hb = hsvg.bounding_box()
        pg.mouse.move(hb['x'] + hb['width'] * 0.8, hb['y'] + hb['height'] / 2); pg.mouse.down(); pg.mouse.move(hb['x'] + hb['width'] * 0.4, hb['y'] + hb['height'] / 2, steps=5)
        cap = pg.locator('.card:has(h2:has-text("Index over time")) .ch-cap').inner_text(); pg.mouse.up()
        check(f'[{tag}] handicap: scrubbing shows the date, index and differential', 'index' in cap and 'differential' in cap, cap); check(f'[{tag}] handicap: no horizontal scroll', no_hscroll(pg)); shot(pg, f'handicap-{tag}')
        pg.evaluate("() => { location.hash = '#rounds' }"); pg.wait_for_selector('select[data-sel="cmp_a"]'); pg.wait_for_timeout(200)
        check(f'[{tag}] rounds: compare shows rows A, B and the difference for each nine, no Plotly', pg.locator('.ch-holes.named').count() >= 1 and pg.locator('.ch-hole.dfg, .ch-hole.dfb, .ch-hole.df0').count() >= 9 and pg.evaluate("() => window.__plots.length") == 0)
        tap_detail('.ch-hole', 0, 'round compare'); check(f'[{tag}] rounds: no horizontal scroll', no_hscroll(pg)); shot(pg, f'rounds-{tag}')
        pg.select_option('select[data-sel="cmp_a"]', index=3); pg.wait_for_selector('.ch-holes.named'); check(f'[{tag}] rounds: choosing another round redraws the comparison', pg.locator('.ch-holes.named').count() >= 1)
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
