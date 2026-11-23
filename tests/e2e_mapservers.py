"""Browser test: course maps when the OpenStreetMap server is busy. Run: python3 tests/e2e_mapservers.py

The main server refusing (406, as it often does since mid-2026) falls back to a mirror; while a map downloads the
Course view says so and offers no Mark buttons; when every server is busy it says so in one line with Try again.
Invented course only (tests/fake_course.py).
"""
import sys, os, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_harness import *  # noqa: F401,F403
import fake_course as FC

HOSTS = ['overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru']

def setup(b, w=390, h=844):
    """A page whose map servers answer by a script: plan[host] = list of 'ok' | status code | 'hold' for successive outline requests."""
    ctx, pg, errs = new_page(b, w, h)
    log, held, plan = [], [], {}
    def handler(route):
        req = route.request; body = (req.post_data or '') + req.url; host = req.url.split('/')[2]
        if 'leisure' in body: return route.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_nearby()))
        log.append(host); todo = plan.get(host) or ['ok']; a = todo.pop(0) if len(todo) > 1 else todo[0]
        if a == 'hold': return held.append(route)
        if a == 'ok': return route.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_outline()))
        return route.fulfill(status=a, body='Not Acceptable')
    for host in HOSTS: pg.unroute(f'**/{host}/**'); pg.route(f'**/{host}/**', handler)
    return ctx, pg, errs, log, held, plan

def begin(pg):
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart')
    if not pg.query_selector('[data-pickcourse]'): pg.click('#plNear')
    pg.wait_for_selector('[data-pickcourse]'); pg.click('[data-pickcourse]:has-text("%s")' % NAME); pg.wait_for_timeout(200)
    pg.click('#plStart button.btn'); pg.wait_for_selector('#cvRoot')

def S(pg): return pg.evaluate("""() => { const s = window.__golfiq.extra.play.course._state();
  return { live: !!s.L, empty: document.querySelector('.cv-empty')?.textContent || null, peek: document.querySelector('#cvPeek')?.innerText || '',
           marks: !!document.querySelector('#cvMarks'), retry: !!document.querySelector('[data-cvmapretry]') }; }""")

with sync_playwright() as p:
    b = p.chromium.launch()

    # main server refuses with 406: the first mirror is used, each asked once
    ctx, pg, errs, log, held, plan = setup(b)
    plan['overpass-api.de'] = [406]
    begin(pg); pg.wait_for_timeout(1500)
    check('main server refuses (406): the map still downloads from a mirror', S(pg)['live'], S(pg))
    check('each server asked at most once, in order', log == ['overpass-api.de', 'overpass.private.coffee'], log)
    check('hole 1 is drawn', pg.query_selector('#hm') is not None and S(pg)['empty'] is None)
    check('no script errors (406)', not errs, errs[:3]); ctx.close()

    # a slow download: hole 1 says the map is coming, no Mark buttons; then it draws by itself
    ctx, pg, errs, log, held, plan = setup(b)
    plan['overpass-api.de'] = ['hold']
    begin(pg); pg.wait_for_timeout(1200)
    s = S(pg)
    check('while downloading: "Downloading the course map…" on the map', s['empty'] and 'Downloading the course map' in s['empty'], s)
    check('while downloading: no Mark this green / tee', not s['marks'] and 'Mark this' not in s['peek'], s['peek'])
    pg.screenshot(path=f'{SHOTS}/maps_390_loading.png')
    for r in held: r.fulfill(status=200, content_type='application/json', body=json.dumps(FC.overpass_outline()))
    pg.wait_for_timeout(1500)
    check('when it arrives hole 1 draws without touching anything', S(pg)['live'] and S(pg)['empty'] is None, S(pg))
    check('no script errors (slow)', not errs, errs[:3]); ctx.close()

    # every server busy: one clear line, Try again, then it works (320 x 568)
    ctx, pg, errs, log, held, plan = setup(b, 320, 568)
    for h in HOSTS: plan[h] = [406, 'ok'] if h == 'overpass-api.de' else [429, 'ok'] if h == 'overpass.private.coffee' else [504, 'ok']
    begin(pg); pg.wait_for_timeout(1500)
    s = S(pg)
    check('all busy: "Course map unavailable – the map server is busy."', s['empty'] and 'Course map unavailable' in s['empty'], s)
    check('all busy: each server tried once, no retry loop', log == HOSTS, log)
    check('all busy: no Mark buttons, a Try again button in the panel', not s['marks'] and s['retry'], s['peek'])
    check('the panel names what the servers said', '406, 429, 504' in s['peek'], s['peek'])
    controls_ok(pg, 'map unavailable (320)')
    check('no horizontal overflow (320)', no_overflow(pg))
    pg.screenshot(path=f'{SHOTS}/maps_320_busy.png')
    pg.click('[data-cvmapretry]'); pg.wait_for_timeout(1500)
    check('Try again downloads the map and draws hole 1', S(pg)['live'] and not S(pg)['retry'], (S(pg), log))
    check('Try again asked only the first server again', log == HOSTS + ['overpass-api.de'], log)
    check('the round keeps going after a reload', (pg.reload(), pg.wait_for_selector('#cvRoot'), pg.wait_for_timeout(1200), S(pg)['live'])[-1])
    check('no script errors (busy)', not errs, errs[:3]); ctx.close()

    # a course with no map at all (servers fine, nothing mapped): the Mark buttons are offered as before
    ctx, pg, errs = new_page(b, 390, 844, outline=False)
    start_round(pg); pg.wait_for_timeout(800)
    check('nothing mapped: Mark buttons offered, no busy message', S(pg)['marks'] and not S(pg)['retry'] and 'not mapped' in (S(pg)['empty'] or ''), S(pg))
    ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
