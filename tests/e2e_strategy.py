"""Browser test for strategy on the Course view (course-view plan, phase 5). Run: python3 tests/e2e_strategy.py

The caddie tip chip, the Strategy tab, hazard reach / carry labels and tap-and-hold measuring, on the invented course
(tests/fake_course.py) with GPS moved through Playwright. Tips come from the sample data's history and the mapped hole.
"""
import sys, os, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_harness import *  # noqa: F401,F403

def move(ctx, pg, pt, wait=1500): ctx.set_geolocation(geo(pt)); pg.wait_for_timeout(wait)
def chip(pg): el = pg.query_selector('#cvTip .cv-tipb'); return el.inner_text() if el else ''
def tips(pg): return pg.evaluate("() => window.__golfiq.extra.play.course._sv().current()")
def sheet(pg): return pg.evaluate("() => document.querySelector('#cvRoot').dataset.sheet")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg, errs = new_page(b, 390, 844)
    start_round(pg)

    # ---- on the tee of hole 1: water left of the landing zone
    t = tips(pg)
    check('tee: the situation is the tee', t['sit'] == 'tee', t['sit'])
    check('tee: a tip about the water in the landing zone', any(x['key'] == 'tee-trouble' and re.match(r'Trouble is left: water at \d+–\d+\. Favour the right half\.', x['text']) for x in t['tips']), t['tips'])
    check('the chip shows the strongest tip', chip(pg) == t['tips'][0]['text'], (chip(pg), t['tips'][:2]))
    check('chip and its ✕ are at least 48 px', pg.evaluate("() => [...document.querySelectorAll('#cvTip button')].every(b => b.getBoundingClientRect().height >= 47.5)"))
    check('the yardage panel sits below the chip', pg.evaluate("() => document.querySelector('#cvYards').getBoundingClientRect().top >= document.querySelector('#cvTop').getBoundingClientRect().bottom - 1"))
    check('no tip comes without data behind it: every tip has a known key', all(x['key'] in ('tee-clubs', 'tee-trouble', 'stroke-index') for x in t['tips']))
    pg.screenshot(path=f'{SHOTS}/strategy_390_tee.png')

    # ---- hazard reach / carry labels
    labs = pg.evaluate("""() => [...document.querySelectorAll('#hmDyn .hm-haz')].map(g => ({ kind: g.dataset.kind, text: [...g.querySelectorAll('text')].map(x => x.textContent),
      sizes: [...g.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize)), r: g.getBoundingClientRect().toJSON() }))""")
    w = [x for x in labs if x['kind'] == 'water']
    check('hazard label: the water with its reach and carry (219 / 273 yd)', w and w[0]['text'] == ['Water', '219 / 273'], labs)
    check('hazard labels: at most four, words at 15 px and yardages at 28 px', 0 < len(labs) <= 4 and all(x['sizes'] == [15, 28] for x in labs), labs)
    yb = pg.evaluate("() => document.querySelector('#cvYards').getBoundingClientRect().toJSON()")
    check('hazard labels never cover the green distances', all(x['r']['left'] >= yb['right'] - 1 or x['r']['top'] >= yb['bottom'] - 1 or x['r']['bottom'] <= yb['top'] + 1 for x in labs))
    check('a label moved away from its hazard has a line back to it', pg.evaluate("() => [...document.querySelectorAll('#hmDyn .hm-haz')].every(g => { const r = g.querySelector('rect'), y = +r.getAttribute('y'), c = g.querySelector('circle'); return !c || g.querySelector('.hm-lead'); })"))
    check('hazard labels never cover each other', all(not (a['r']['left'] < c['r']['right'] and c['r']['left'] < a['r']['right'] and a['r']['top'] < c['r']['bottom'] and c['r']['top'] < a['r']['bottom']) for i, a in enumerate(labs) for c in labs[i + 1:]))

    # ---- tap the chip: the Strategy tab
    pg.click('#cvTip .cv-tipb'); pg.wait_for_selector('#cvBody .sg-sec'); pg.wait_for_timeout(1500)
    body = pg.inner_text('#cvBody')
    check('chip tap opens the Strategy tab', sheet(pg) == 'half' and pg.evaluate("() => document.querySelector('[data-cvtab=strategy]').classList.contains('on')"))
    for h in ['For this shot', 'Best option from here', 'This hole, your history', 'The green', 'Conditions']:
        check(f'Strategy tab: "{h}"', h in body, body[:300])
    check('Strategy tab lists the tip', t['tips'][0]['text'] in body)
    check('best option from here: the expected-strokes rows, each with Use', pg.query_selector('#cvStrat .recrow .use') is not None and 'strokes' in pg.inner_text('#cvStrat'), pg.inner_text('#cvStrat')[:200])
    check('history: a hole you have not played says so', 'You have not played this hole before' in body)
    check('green: front, middle, back, depth and the bunker right', re.search(r'Front \d+ · middle 394 · back \d+ yd · 3\d yd deep', body) and 'Bunker right' in body, body)
    check('conditions: flat today', 'Plays as it measures today' in body)
    pg.screenshot(path=f'{SHOTS}/strategy_390_tab.png')
    controls_ok(pg, 'Strategy tab')
    rows = pg.query_selector_all('#cvStrat .recrow')
    if len(rows) > 1:
        rows[1].click(); pg.wait_for_timeout(300)
        check('Use on a row sets the club and goes back to the map', sheet(pg) == 'peek' and pg.evaluate("() => window.__golfiq.extra.play.course._state().L.custom"))
    pg.click('[data-cvrecentre]'); pg.wait_for_timeout(400)

    # ---- dismiss: gone for this hole, kept after a reload, not for other holes
    first = chip(pg); key = tips(pg)['tips'][0]['key']
    pg.click('#cvTip .cv-tipx'); pg.wait_for_timeout(400)
    check('✕ hides that tip for this hole', chip(pg) != first and key in draft(pg)['tips_off']['1'], chip(pg))
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    check('a dismissed tip stays hidden after a reload', chip(pg) != first)

    # ---- approach: the side you would be short-sided on
    move(ctx, pg, point(1, 200))
    t = tips(pg)
    check('approach: situation', t['sit'] == 'approach', t['sit'])
    g = [x for x in t['tips'] if x['key'] == 'green-sides']
    check('approach: front, back and the bunker right of the green', g and re.match(r'Front \d+, back \d+\. Short-sided if you miss right: bunker right of the green\.', g[0]['text']), t['tips'])
    check('approach: the water beside you is not labelled', pg.query_selector('#hmDyn .hm-haz[data-kind=water]') is None)
    ob = pg.evaluate("""() => { const s = window.__golfiq.extra.play.course._state(), [ax, ay] = s.L.fr.xy(...s.L.aim), r = document.querySelector('#hm').getBoundingClientRect();
      return [...document.querySelectorAll('#hmDyn .hm-haz rect')].map(e => { const b = e.getBoundingClientRect(); return [b.left - r.left, b.top - r.top, b.width, b.height]; }).filter(([x, y, w, h]) => x < ax + 75 && x + w > ax - 75 && y < ay + 14 && y + h > ay - 40).length; }""")
    check('hazard labels keep clear of the aim and its label', ob == 0, ob)
    pg.screenshot(path=f'{SHOTS}/strategy_390_approach.png')

    # ---- tap and hold to measure
    aim0 = pg.evaluate("() => window.__golfiq.extra.play.course._state().L.aim")
    pg.mouse.move(300, 300); pg.mouse.down(); pg.wait_for_timeout(800); pg.mouse.up(); pg.wait_for_timeout(200)
    m = pg.evaluate("() => { const g = document.querySelector('#hmDyn .hm-measure'); return g ? [...g.querySelectorAll('text')].map(t => t.textContent) : null; }")
    check('tap and hold: a marker with the distance from you and on to the green', m and len(m) == 4 and 'from you' in m and 'to green' in m and all(x.isdigit() for x in m if x not in ('from you', 'to green')), m)
    check('tap and hold does not move the aim', pg.evaluate("() => window.__golfiq.extra.play.course._state().L.aim") == aim0)
    pg.screenshot(path=f'{SHOTS}/strategy_390_measure.png')
    pg.mouse.click(120, 330); pg.wait_for_timeout(250)
    check('the next tap clears it, and only clears it', pg.query_selector('#hmDyn .hm-measure') is None and pg.evaluate("() => window.__golfiq.extra.play.course._state().L.aim") == aim0)

    # ---- a par 5 out of reach: lay up to your best wedge distance (from the sample's approach shots)
    pg.evaluate("async () => { const g = window.__golfiq, d = g.state.journal.draft; d.hole = 4; const S = await import('./store.js'); await S.saveJournal(g.state); }")
    move(ctx, pg, point(4, 20), wait=200); pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    move(ctx, pg, point(4, 60))
    t = tips(pg)
    lay = [x for x in t['tips'] if x['key'] == 'layup']
    check('lay-up: out of reach of the green', t['sit'] == 'layup', t['sit'])
    check('lay-up: your best wedge distance, with the numbers behind it', lay and re.match(r'Lay up to about \d+: your best wedge distance\.', lay[0]['text']) and re.match(r'From \d+-\d+ you finish \d+ ft from the hole on average \(\d+ shots\)\.', lay[0]['detail']), lay)
    pg.screenshot(path=f'{SHOTS}/strategy_390_layup.png')

    # ---- putting or a finished hole: no chip
    pg.evaluate("async () => { const g = window.__golfiq, d = g.state.journal.draft; d.track = true; d.holes[4].putting = true; const S = await import('./store.js'); await S.saveJournal(g.state); }")
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    check('putting: no tip chip and no hazard labels', chip(pg) == '' and pg.query_selector('#hmDyn .hm-haz') is None)
    check('no script errors (390 x 844)', not errs, errs[:3])
    ctx.close()

    # ---- 320 x 568
    ctx, pg, errs = new_page(b, 320, 568)
    start_round(pg)
    check('320: the chip shows', chip(pg) != '')
    check('320: no horizontal overflow with the chip', no_overflow(pg))
    check('320: the map still has room between the top bar and the sheet', pg.evaluate("() => document.querySelector('#cvSheet').getBoundingClientRect().top - document.querySelector('#cvTop').getBoundingClientRect().bottom") > 120)
    controls_ok(pg, '320 with chip')
    pg.screenshot(path=f'{SHOTS}/strategy_320_tee.png')
    pg.click('#cvTip .cv-tipb'); pg.wait_for_selector('#cvBody .sg-sec')
    check('320: no overflow in the Strategy tab', no_overflow(pg))
    check('no script errors (320 x 568)', not errs, errs[:3])
    ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
