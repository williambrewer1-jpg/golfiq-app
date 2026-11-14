"""Browser test for phase 0 of the charts plan: every Plotly chart is locked (no drag-zoom, scroll-zoom or double-tap) and themed, except the course map.
Plotly itself is replaced by a recorder (the test sandbox has no internet), so this checks what the app asks Plotly to draw.
Run: python3 tests/e2e_plotlock.py"""
import http.server, threading, functools, os, json
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

FAKE = """window.__plots = []; window.Plotly = { newPlot(el, traces, layout, config) { window.__plots.push({ id: el.id, traces, layout, config }); }, purge() {} };"""
HEX = "(s) => /#[0-9a-fA-F]{6}\\b/.test(JSON.stringify(s))"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 844})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort()); pg.add_init_script(FAKE)
    pg.goto(URL); pg.click('#loadSample'); pg.wait_for_timeout(400)
    seen = {}
    def visit(tab, sub=None):
        pg.evaluate("() => { window.__plots.length = 0 }")
        pg.evaluate("([t, s]) => { const u = window.__golfiq; location.hash = '#stats'; }", [tab, sub])
        pg.click(f'[data-seg="sx_tab"] button[data-v="{tab}"]'); pg.wait_for_timeout(150)
        if sub: pg.click(f'[data-seg="{sub[0]}"] button[data-v="{sub[1]}"]'); pg.wait_for_timeout(150)
        seen[f'{tab}/{sub[1] if sub else ""}'] = pg.evaluate("() => window.__plots.slice()")
    for tab in ['scoring', 'tee', 'approach', 'short', 'putting', 'sg', 'handicap']: visit(tab)
    visit('bag', ('bag_tab', 'gapping')); visit('bag', ('bag_tab', 'dispersion'))
    visit('insights', ('in_tab', 'conditions'))
    allp = [x for v in seen.values() for x in v]
    check('some charts were drawn', len(allp) >= 6, str(len(allp)))
    check('no page errors', not errs, str(errs[:3]))
    check('every chart: dragmode off', all(x['layout'].get('dragmode') is False for x in allp))
    check('every chart: axes fixed', all(x['layout']['xaxis'].get('fixedrange') is True and x['layout']['yaxis'].get('fixedrange') is True for x in allp))
    check('every chart: no scroll zoom or double tap', all(x['config']['scrollZoom'] is False and x['config']['doubleClick'] is False and x['config']['displayModeBar'] is False for x in allp))
    check('no fixed Material colours left', not any(pg.evaluate(HEX, x['traces']) and any(c in json.dumps(x['traces']) for c in ['#1E88E5', '#43A047', '#FB8C00', '#E53935', '#8E24AA']) for x in allp))
    check('font follows the app font', all('SF Pro' in x['layout']['font']['family'] or 'system-ui' in x['layout']['font']['family'] for x in allp))
    # the palette follows the theme: dark mode gives a different accent
    pg.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')"); pg.evaluate("() => window.__plots.length = 0")
    pg.click('[data-seg="sx_tab"] button[data-v="tee"]'); pg.wait_for_timeout(150)
    dark = pg.evaluate("() => window.__plots.slice()")
    check('dark mode recolours the charts', bool(dark) and 'f2cf4a' in json.dumps(dark).lower().replace('#', ''), json.dumps(dark)[:200])
    pg.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); raise SystemExit(1 if fails else 0)
