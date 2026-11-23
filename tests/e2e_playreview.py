"""Browser test: the Course view away from the course and on courses with partial data (the 23 Nov 2026 review).
Run: python3 tests/e2e_playreview.py

Wills's screenshot: hole 1 of a course he has played with his Garmin, 4 km away, GPS weak. The tee of hole 1 was not known
(the watch often misses the first tee shot), so the map was blank with "No position yet", the top line claimed it was
"showing the tee", and "Mark this tee" was offered at home. The map was never downloaded for a Garmin course.
Uses the app's own synthetic sample course and the invented OpenStreetMap course (tests/fake_course.py).
"""
import sys, os, json
from urllib.parse import unquote_plus
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_harness import *  # noqa: F401,F403
import fake_course as FC

HOSTS = ['overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru']
CID = 'garmin-900002'
def S(pg): return pg.evaluate("""() => { const s = window.__golfiq.extra.play.course._state();
  return { live: !!s.L, hole: s.L ? s.L.hole : null, usingTee: s.L ? s.L.usingTee : null, empty: document.querySelector('.cv-empty')?.textContent || null,
    only: document.querySelector('.cv-onlygreen')?.textContent || null, svg: !!document.querySelector('#hm'), msg: document.querySelector('#cvMsg')?.textContent || '',
    peek: document.querySelector('#cvPeek')?.innerText || '', marks: !!document.querySelector('#cvMarks'), yards: !document.querySelector('#cvYards').hidden }; }""")

def page(b, w, h, outline_mode):
    ctx, pg, errs = new_page(b, w, h)
    asked = []
    def handler(route):
        body = unquote_plus(route.request.post_data or '')
        if 'leisure' in body: return route.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_nearby()))
        asked.append(body); m = outline_mode['v']
        if m == 'busy': return route.fulfill(status=406, body='Not Acceptable')
        if m == 'testwood': return route.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_outline()))
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'elements': []}))   # the sample course is not mapped
    for host in HOSTS: pg.unroute(f'**/{host}/**'); pg.route(f'**/{host}/**', handler)
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart'); pg.wait_for_timeout(600)
    return ctx, pg, errs, asked

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h) in [(390, 844), (320, 568)]:
        tag = f'{w}x{h}'
        mode = {'v': 'empty'}
        ctx, pg, errs, asked = page(b, w, h, mode)
        # the sample course, with hole 1's tee shots stripped of their start position (as when the watch misses them)
        info = pg.evaluate("""async (cid) => { const g = window.__golfiq, F = await import('./features.js');
          g.ds.shots.filter((s) => s.course_id === cid && s.hole === 1 && s.category === 'tee').forEach((s) => { s.start_lat = null; s.start_lon = null; });
          const k = F.courseHoles(g.ds, cid); return { pin1: k[1].pin, tee1: k[1].tee, tee2: k[2].tee, pin2: k[2].pin }; }""", CID)
        check(f'{tag}: set-up: hole 1 has a green but no tee, hole 2 has both', info['pin1'] and info['tee1'] is None and info['tee2'] and info['pin2'], info)
        home = [info['pin1'][0] + 0.036, info['pin1'][1]]                  # about 4 km north of hole 1's green
        ctx.set_geolocation(geo(home, 13)); pg.wait_for_timeout(300)
        pg.select_option('[data-sel=pl_course]', CID); pg.wait_for_timeout(300)
        pg.click('#plStart button.btn'); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1800)
        d = draft(pg)
        check(f'{tag}: a Garmin course saves where the course is', d.get('course_box') and len(d['course_box']) == 4, d.get('course_box'))
        check(f'{tag}: and its map is downloaded straight away (not only courses picked from the map)', len(asked) == 1 and '"golf"' in asked[0], asked)
        s = S(pg)
        check(f'{tag}: hole 1, 4 km away, tee unknown: the green is shown instead of a blank screen', s['svg'] and s['only'] and 'tee of this hole is not known' in s['only'], s)
        check(f'{tag}: the top line no longer claims to show the tee', 'tee not known, showing the green' in s['msg'] and 'showing the tee' not in s['msg'].replace('tee not known', ''), s['msg'])
        check(f'{tag}: no "No position yet" while GPS has a fix', 'No position yet' not in (s['empty'] or ''), s)
        check(f'{tag}: no yardages when there is nothing to measure from', not s['yards'])
        check(f'{tag}: at home: no Mark this tee / green', not s['marks'] and 'Mark this' not in s['peek'], s['peek'])
        pg.screenshot(path=f'{SHOTS}/review_{w}_away_hole1.png')
        for z in range(3):
            pg.click('[data-cvzoom]'); pg.wait_for_timeout(300)
            check(f'{tag}: zoom step {z + 1} keeps the green on screen', S(pg)['svg'])
        check(f'{tag}: no horizontal overflow (away)', no_overflow(pg))
        pg.click('[data-cvstep="1"]'); pg.wait_for_timeout(800)
        s = S(pg)
        check(f'{tag}: hole 2 (tee known), 4 km away: previewed from the tee', s['live'] and s['usingTee'] and s['yards'], s)
        check(f'{tag}: hole 2 top line says it is showing the tee', 'showing the tee' in s['msg'], s['msg'])
        pg.click('[data-cvstep="-1"]'); pg.wait_for_timeout(800)
        # at the course, on hole 1: distances from where you stand; the tee can be marked there
        ctx.set_geolocation(geo([info['pin1'][0] - 0.0015, info['pin1'][1]], 5)); pg.wait_for_timeout(1600)
        s = S(pg)
        check(f'{tag}: at the course, hole 1 is drawn from your position', s['live'] and s['usingTee'] is False and s['yards'], s)
        check(f'{tag}: at the course, hole 1 offers Mark this tee (and not the green, which is known)', s['marks'] and 'Mark this tee' in s['peek'] and 'Mark this green' not in s['peek'], s['peek'])
        pg.screenshot(path=f'{SHOTS}/review_{w}_course_hole1.png')
        controls_ok(pg, f'review {tag}')
        check(f'{tag}: no script errors (Garmin course)', not errs, errs[:3]); ctx.close()

    # an OpenStreetMap course whose map download failed: after a reload the app tries again by itself
    mode = {'v': 'busy'}
    ctx, pg, errs, asked = page(b, 390, 844, mode)
    if not pg.query_selector('[data-pickcourse]'): pg.click('#plNear')
    pg.wait_for_selector('[data-pickcourse]'); pg.click('[data-pickcourse]:has-text("%s")' % NAME); pg.wait_for_timeout(200)
    pg.click('#plStart button.btn'); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1800)
    check('map servers busy: Try again offered', pg.query_selector('[data-cvmapretry]') is not None and 'Course map unavailable' in (S(pg)['empty'] or ''), S(pg))
    n_busy = len(asked); mode['v'] = 'testwood'
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(2000)
    check('after a reload the map is fetched again by itself and hole 1 is drawn', S(pg)['live'] and len(asked) == n_busy + 1, (S(pg), len(asked), n_busy))
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    check('once downloaded it is not downloaded again', len(asked) == n_busy + 1, len(asked))
    check('no script errors (reload)', not errs, errs[:3]); ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
