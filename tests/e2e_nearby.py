"""Browser test: "Courses near you" on the Play page – Find / Refresh. Run: python3 tests/e2e_nearby.py

Refresh shows that it is working, says when it finished, uses where you are now (not a position kept from an earlier
round), and says so when the map servers are busy. Invented course only (tests/fake_course.py).
"""
import sys, os, json, re
from urllib.parse import unquote_plus
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_harness import *  # noqa: F401,F403
import fake_course as FC

HOSTS = ['overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru']

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h) in [(390, 844), (320, 568)]:
        tag = f'{w}x{h}'
        ctx, pg, errs = new_page(b, w, h)
        held, mode, asked = [], {'v': 'ok'}, []
        def handler(route):
            body = unquote_plus(route.request.post_data or '')
            if 'leisure' not in body: return route.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_outline()))
            asked.append(body)
            if mode['v'] == 'hold': return held.append(route)
            if mode['v'] == 'busy': return route.fulfill(status=406, body='Not Acceptable')
            route.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_nearby()))
        for host in HOSTS: pg.unroute(f'**/{host}/**'); pg.route(f'**/{host}/**', handler)
        pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
        pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart'); pg.wait_for_timeout(1500)
        if pg.inner_text('#plNear') != 'Refresh': pg.click('#plNear'); pg.wait_for_timeout(1200)
        msg = lambda: pg.inner_text('#plNearMsg'); btn = lambda: pg.inner_text('#plNear')
        check(f'{tag}: the list is there and says when it was updated', btn() == 'Refresh' and re.search(r'1 golf course within 40 km · updated \d\d:\d\d', msg()), msg())

        # Refresh while the server is slow: it shows it is working, and the page redrawing does not lose that
        n0 = len(asked); mode['v'] = 'hold'
        pg.click('#plNear'); pg.wait_for_timeout(500)
        check(f'{tag}: Refresh shows "Searching…" and cannot be tapped twice', btn() == 'Searching…' and pg.is_disabled('#plNear'), btn())
        check(f'{tag}: and says what it is doing', 'Looking for golf courses' in msg(), msg())
        pg.wait_for_timeout(6200)
        check(f'{tag}: still slow after 6 s: says it is also asking the next server', 'also asking server 2 of 3' in msg(), msg())
        pg.evaluate("() => { document.querySelector('#plNear').dataset.seen = '1'; location.hash = '#home'; }"); pg.wait_for_timeout(300); pg.evaluate("() => { location.hash = '#play'; }"); pg.wait_for_selector('#plNear'); pg.wait_for_timeout(300)
        check(f'{tag}: (the page was drawn again)', pg.evaluate("() => !document.querySelector('#plNear').dataset.seen"))
        check(f'{tag}: a redraw of the page keeps the working state', btn() == 'Searching…' and 'Looking for golf courses' in msg(), (btn(), msg()))
        pg.screenshot(path=f'{SHOTS}/near_{w}_searching.png')
        for r in held: r.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_nearby()))
        held.clear(); pg.wait_for_timeout(1200)
        check(f'{tag}: done: button back to Refresh, list line with the time', btn() == 'Refresh' and not pg.is_disabled('#plNear') and 'updated' in msg(), (btn(), msg()))
        check(f'{tag}: a toast confirms the update', 'Courses near you updated' in pg.inner_text('body'))

        # Refresh after moving: the search is made from where you are now
        mode['v'] = 'ok'; ctx.set_geolocation({'latitude': -27.45, 'longitude': 153.03, 'accuracy': 20})
        pg.click('#plNear'); pg.wait_for_timeout(1500)
        box = f'{-27.45 - 40000 / 111320:.5f},'
        check(f'{tag}: Refresh searches around your new position', asked and box in asked[-1] and '-30.' not in asked[-1], asked[-1][-160:] if asked else None)

        # every server busy: a clear line and the button works again
        mode['v'] = 'busy'; pg.click('#plNear'); pg.wait_for_timeout(1500)
        check(f'{tag}: servers busy: says so', 'OpenStreetMap is busy (406, 406, 406)' in msg(), msg())
        check(f'{tag}: servers busy: Refresh can be tapped again', btn() == 'Refresh' and not pg.is_disabled('#plNear'))
        check(f'{tag}: the earlier list is kept', pg.query_selector('[data-pickcourse]') is not None)
        mode['v'] = 'ok'; pg.click('#plNear'); pg.wait_for_timeout(1500)
        check(f'{tag}: and the next try works', 'updated' in msg(), msg())
        check(f'{tag}: no horizontal overflow', no_overflow(pg))
        check(f'{tag}: no script errors', not errs, errs[:3]); ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
