"""Shared set-up for the Course view browser tests: a local server, the invented course, GPS and wake-lock stand-ins,
and helpers. Imported by e2e_courseview.py and e2e_tracking.py."""
import http.server, threading, functools, sys, os, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_course import hole, point, route_services, NAME  # noqa: F401  (re-exported)

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

def start_round(pg, n=9, track=False):
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart')
    if not pg.query_selector('[data-pickcourse]'): pg.click('#plNear')
    pg.wait_for_selector('[data-pickcourse]')
    pg.click('[data-pickcourse]:has-text("%s")' % NAME); pg.wait_for_timeout(200)
    pg.select_option('select[name=n]', str(n))
    if pg.is_checked('#plStart [name=track]') != track: pg.click('#plStart label.sw')
    pg.click('#plStart button.btn')
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

