"""Browser test for the Course view finishing touches (course-view plan, phase 6). Run: python3 tests/e2e_finishing.py

Pinch-zoom and pan, the next-hole prompt, marking a green and tee on a course with no map, the shot and hole sounds,
and the on-course challenge and prediction pace on the hole summary, on the invented course (tests/fake_course.py)
with GPS moved through Playwright. Two-finger pinches are sent as pointer events, as a phone's browser sends them.
"""
import sys, os, math
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_harness import *  # noqa: F401,F403

def move(ctx, pg, pt, acc=4, wait=1400): ctx.set_geolocation(geo(pt, acc)); pg.wait_for_timeout(wait)
def S(pg): return pg.evaluate("""() => { const s = window.__golfiq.extra.play.course._state();
  return { k: s.L ? s.L.fr.k : null, uv: !!s.UV, aim: s.L ? s.L.aim : null, hole: s.L ? s.L.hole : null, offer: s.offer, markable: s.markable, live: !!s.L }; }""")
def zoom_text(pg): return pg.evaluate("() => { const b = document.querySelector('[data-cvzoom]'); return b.querySelector('small').textContent + ' ' + b.lastChild.textContent; }")
def peek(pg): return pg.inner_text('#cvPeek')
def sheet(pg): return pg.evaluate("() => document.querySelector('#cvRoot').dataset.sheet")
def close_sheet(pg):
    if sheet(pg) != 'peek': pg.click('#cvHandle'); pg.wait_for_timeout(250)
def dist(a, b): return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))

# pointer events on the map: fingers is a list of (id, [(x, y) per step]) in CSS pixels
GESTURE = """async ({ fingers, steps }) => {
  const el = document.querySelector('#cvMap'), ev = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  for (const [id, path] of fingers) ev('pointerdown', id, ...path[0]);
  for (let i = 1; i <= steps; i++) { for (const [id, path] of fingers) ev('pointermove', id, ...path[i]); await new Promise((r) => requestAnimationFrame(r)); }
  for (const [id, path] of fingers) ev('pointerup', id, ...path[steps]);
}"""
def line(a, b, n): return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]
def pinch(pg, c, d0, d1, n=8, dx=0):
    pg.evaluate(GESTURE, {'fingers': [[1, line((c[0] - d0 / 2, c[1]), (c[0] - d1 / 2 + dx, c[1]), n)], [2, line((c[0] + d0 / 2, c[1]), (c[0] + d1 / 2 + dx, c[1]), n)]], 'steps': n})
    pg.wait_for_timeout(400)
def pan(pg, a, b, n=8):
    pg.evaluate(GESTURE, {'fingers': [[1, line(a, b, n)]], 'steps': n}); pg.wait_for_timeout(400)
def screen_of(pg, ll_pt):
    """Where a spot on the ground is drawn, in CSS pixels."""
    return pg.evaluate("""(p) => { const L = window.__golfiq.extra.play.course._state().L, svg = document.querySelector('#hm'), r = svg.getBoundingClientRect(), [x, y] = L.fr.xy(p[0], p[1]);
      return [r.left + x * r.width / L.fr.w, r.top + y * r.height / L.fr.h]; }""", list(ll_pt))
def score_hole(pg, strokes):
    """Quick score: open the Score tab, step the score up, back to the map."""
    pg.click('[data-cvscore]'); pg.wait_for_selector('#cvBody [data-step=strokes]')
    for _ in range(strokes): pg.evaluate("() => document.querySelector('#cvBody [data-step=strokes][data-d=\"1\"]').click()"); pg.wait_for_timeout(120)
    close_sheet(pg)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ------------------------------------------------------------ pinch-zoom and pan (390 x 844)
    ctx, pg, errs = new_page(b, 390, 844)
    start_round(pg)
    s0 = S(pg); aim0 = s0['aim']
    check('starts on a preset zoom', zoom_text(pg) == 'Zoom Shot' and not s0['uv'], zoom_text(pg))
    font0 = pg.evaluate("() => getComputedStyle(document.querySelector('#hmDyn text')).fontSize")
    pinch(pg, (195, 420), 80, 200)
    s1 = S(pg)
    check('two fingers apart: the map zooms in about 2.5 times', s1['uv'] and abs(s1['k'] / s0['k'] - 2.5) < 0.15, (s0['k'], s1['k']))
    check('the zoom button says the view is pinched', zoom_text(pg) == 'Zoom Pinched', zoom_text(pg))
    check('the map is drawn again for the new view: the viewBox is the whole screen again', pg.evaluate("() => document.querySelector('#hm').getAttribute('viewBox').startsWith('0 0 ')"))
    check('text keeps its size after the pinch', pg.evaluate("() => getComputedStyle(document.querySelector('#hmDyn text')).fontSize") == font0)
    check('the page itself never zooms', pg.evaluate("() => (window.visualViewport ? visualViewport.scale : 1) === 1"))
    check('a pinch does not move the aim', S(pg)['aim'] == aim0)
    pg.screenshot(path=f'{SHOTS}/finish_390_pinched.png')
    # the spot under the middle of the fingers stays under them
    gx0 = S(pg)
    pinch(pg, (195, 420), 200, 100)
    check('fingers together: zooms back out by half', abs(S(pg)['k'] / gx0['k'] - 0.5) < 0.05, (gx0['k'], S(pg)['k']))
    pinch(pg, (195, 420), 40, 390); pinch(pg, (195, 420), 40, 390); pinch(pg, (195, 420), 40, 390)
    check('zooming in stops at the closest view', S(pg)['k'] <= 16.001, S(pg)['k'])
    for _ in range(4): pinch(pg, (195, 420), 300, 40)
    check('zooming out stops at the widest view', S(pg)['k'] >= 0.399, S(pg)['k'])
    pg.click('[data-cvzoom]'); pg.wait_for_timeout(400)
    check('Zoom after a pinch goes back to the preset you were on', zoom_text(pg) == 'Zoom Shot' and not S(pg)['uv'] and abs(S(pg)['k'] - s0['k']) < 1e-6, (zoom_text(pg), S(pg)['k'], s0['k']))

    # one finger away from the aim: pan
    g0 = screen_of(pg, hole(1)['green'])
    pan(pg, (120, 300), (220, 380))
    g1 = screen_of(pg, hole(1)['green'])
    check('a drag away from the aim pans the map with the finger', S(pg)['uv'] and abs(g1[0] - g0[0] - 100) < 2 and abs(g1[1] - g0[1] - 80) < 2, (g0, g1))
    check('panning does not move the aim', S(pg)['aim'] == aim0)
    # a tap after a pan still aims exactly where you tapped
    tgt = hole(1)['green']; tx, ty = screen_of(pg, tgt)
    pg.evaluate(GESTURE, {'fingers': [[1, [(tx, ty), (tx, ty)]]], 'steps': 1}); pg.wait_for_timeout(300)
    check('a tap after a pan aims at the spot tapped', S(pg)['aim'] and dist(S(pg)['aim'], tgt) < 2, S(pg)['aim'])
    # walking does not throw away the view you chose
    move(ctx, pg, point(1, 40))
    check('GPS moves keep the pinched view (no automatic rezoom)', S(pg)['uv'])
    check('the zoom tools stay at least 48 px', pg.evaluate("() => [...document.querySelectorAll('.cv-tools button')].every(b => b.getBoundingClientRect().height >= 47.5)"))
    pg.click('[data-cvrecentre]'); pg.wait_for_timeout(400)
    check('Recentre goes back to the preset view', not S(pg)['uv'] and zoom_text(pg) == 'Zoom Shot')
    # the aim handle still drags the aim
    aim_r = pg.evaluate("() => { const L = window.__golfiq.extra.play.course._state().L, [x, y] = L.fr.xy(...L.aim), r = document.querySelector('#hm').getBoundingClientRect(); return [r.left + x * r.width / L.fr.w, r.top + y * r.height / L.fr.h]; }")
    a_before = S(pg)['aim']
    pan(pg, (aim_r[0], aim_r[1]), (aim_r[0] + 30, aim_r[1] - 20))
    check('a drag on the aim ring still moves the aim, not the map', S(pg)['aim'] != a_before and not S(pg)['uv'])
    pg.click('[data-cvrecentre]'); pg.wait_for_timeout(300)
    # a pinched view survives a change of sheet, and goes when you change hole
    pinch(pg, (195, 420), 80, 160)
    pg.click('#cvHandle'); pg.wait_for_timeout(300); close_sheet(pg)
    check('the panel opening and closing keeps the pinched view', S(pg)['uv'])
    pg.click('[data-cvstep="1"]'); pg.wait_for_timeout(800)
    check('another hole starts on the preset view', not S(pg)['uv'] and zoom_text(pg) == 'Zoom Shot', zoom_text(pg))
    pg.click('[data-cvstep="-1"]'); pg.wait_for_timeout(800)
    check('no horizontal overflow (pinch)', no_overflow(pg))
    check('no script errors (pinch)', not errs, errs[:3])

    # ------------------------------------------------------------ next-hole prompt
    move(ctx, pg, hole(2)['tee'])
    check('no score on this hole: no prompt by the next tee', S(pg)['offer'] is None and not pg.query_selector('#cvNext'))
    move(ctx, pg, hole(1)['green']); score_hole(pg, 5)
    check('scored, but far from the next tee: no prompt', not pg.query_selector('#cvNext'))
    move(ctx, pg, hole(2)['tee'], acc=60)
    check('by the next tee with GPS worse than 40 m: no prompt', not pg.query_selector('#cvNext'))
    move(ctx, pg, point(2, -25, 10))
    nx = pg.query_selector('#cvNext')
    check('scored and within 40 m of the next tee: "Go to hole 2?"', nx is not None and 'Go to hole 2?' in nx.inner_text(), peek(pg))
    check('never switches by itself', draft(pg)['hole'] == 1 and S(pg)['hole'] == 1)
    controls_ok(pg, 'next-hole banner')
    pg.screenshot(path=f'{SHOTS}/finish_390_next.png')
    pg.click('[data-cvnextno]'); pg.wait_for_timeout(300)
    check('Not now hides it', not pg.query_selector('#cvNext'))
    move(ctx, pg, point(2, -10, 0))
    check('and it stays hidden for that hole', not pg.query_selector('#cvNext'))
    pg.click('[data-cvstep="1"]'); pg.wait_for_timeout(700)
    score_hole(pg, 4)
    move(ctx, pg, hole(3)['tee'])
    check('next hole: offered again for hole 3', pg.query_selector('#cvNext') and 'Go to hole 3?' in pg.inner_text('#cvNext'))
    pg.click('[data-cvnext]'); pg.wait_for_timeout(900)
    check('one tap goes to hole 3', draft(pg)['hole'] == 3 and S(pg)['hole'] == 3 and not pg.query_selector('#cvNext'))
    ctx.close()

    # ------------------------------------------------------------ mark the green and tee on a course with no map (320 x 568)
    ctx, pg, errs = new_page(b, 320, 568, outline=False)
    start_round(pg)
    move(ctx, pg, hole(1)['tee'], acc=30)
    m = S(pg)['markable']
    check('no map: offers Mark this green and Mark this tee', m and m['green'] and m['tee'] and 'Mark this green' in peek(pg) and 'Mark this tee' in peek(pg), peek(pg))
    check('weak GPS: the mark buttons wait for a better fix and say so', pg.evaluate("() => [...document.querySelectorAll('[data-cvmark]')].every(b => b.disabled)") and 'waiting for GPS within 16 yd' in peek(pg), peek(pg))
    move(ctx, pg, hole(1)['tee'], acc=4)
    check('good GPS: the mark buttons work', pg.evaluate("() => [...document.querySelectorAll('[data-cvmark]')].every(b => !b.disabled)"))
    check('no green: the empty yardage panel is not drawn', pg.evaluate("() => getComputedStyle(document.querySelector('#cvYards')).display === 'none'"))
    controls_ok(pg, 'mark buttons (320)')
    check('no horizontal overflow (marks, 320)', no_overflow(pg))
    pg.screenshot(path=f'{SHOTS}/finish_320_mark.png')
    pg.click('[data-cvmark=tee]'); pg.wait_for_timeout(600)
    key = pg.evaluate("() => { const d = window.__golfiq.state.journal.draft; return d.course_id; }")
    marks = pg.evaluate("(k) => window.__golfiq.state.journal.course_marks?.[k]", key)
    check('the tee is stored for this hole of this course', marks and marks.get('1') and dist(marks['1']['tee'], hole(1)['tee']) < 1, marks)
    check('after marking the tee only the green is left to mark', 'Mark this tee' not in peek(pg) and 'Mark this green' in peek(pg), peek(pg))
    move(ctx, pg, hole(1)['green'])
    pg.click('[data-cvmark=green]'); pg.wait_for_timeout(700)
    check('marking the green draws the hole', S(pg)['live'] and not pg.query_selector('#cvMarks') and pg.query_selector('#hm') is not None)
    check('standing on the marked green: 0 to the middle', yards(pg)['m'] == 0, yards(pg))
    move(ctx, pg, point(1, 100))
    want = round((hole(1)['len_m'] - 100) / 0.9144)
    check('walking back: the distance to the marked green', abs(yards(pg)['m'] - want) <= 1, (yards(pg), want))
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    check('marks are kept after a reload', S(pg)['live'] and abs(yards(pg)['m'] - want) <= 1, yards(pg))
    k0 = S(pg)['k']; pinch(pg, (160, 300), 60, 150)
    check('320 wide: pinch zooms in and nothing overflows', S(pg)['uv'] and S(pg)['k'] > k0 * 2 and no_overflow(pg), (k0, S(pg)['k']))
    pg.screenshot(path=f'{SHOTS}/finish_320_pinched.png')
    pg.click('[data-cvrecentre]'); pg.wait_for_timeout(300)
    pg.click('[data-cvpeekclub]'); pg.wait_for_selector('[data-cvforget]')
    check('the Club tab says the green and tee were marked by you', 'You marked this green and tee yourself.' in pg.inner_text('#cvBody'))
    pg.evaluate("() => document.querySelector('[data-cvforget]').click()"); pg.wait_for_timeout(600)
    check('Forget my marks removes them', not pg.evaluate("(k) => window.__golfiq.state.journal.course_marks?.[k]?.['1']", key) and not S(pg)['live'])
    close_sheet(pg)
    check('no script errors (marks)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ sounds, challenge and pace on the hole summary (tracking)
    ctx, pg, errs = new_page(b, 390, 844)
    ctx.add_init_script('window.__feelTest = true')
    start_round(pg, track=True)
    d = draft(pg)
    pred = pg.evaluate("(id) => (window.__golfiq.state.journal.predictions || []).find(p => p.round_id === 'garmin-' + id)", d['id'])
    check('a new course with no rating or pars: no prediction saved, so no pace is shown', pred is None)
    # the prediction a round starts with when the course has a rating (as e2e_payoff.py checks), added here directly
    pred = {'round_id': 'garmin-' + d['id'], 'predicted': 45, 'lo': 41, 'hi': 49, 'made_at': '2026-11-18T08:00:00Z', 'n': 9}
    pg.evaluate("async (p) => { const g = window.__golfiq; (g.state.journal.predictions = g.state.journal.predictions || []).push(p); const S = await import('./store.js'); await S.saveJournal(g.state); }", pred)
    pg.evaluate("() => { window.__feelLog = []; }")
    pg.click('#cvSheet [data-tr="hit"]'); pg.wait_for_timeout(200)
    move(ctx, pg, point(1, 230)); pg.click('#cvSheet [data-tr="ball"]'); pg.wait_for_timeout(700)
    log = pg.evaluate("() => window.__feelLog")
    check('closing a shot plays the "shot" sound', log and log[-1] == 'shot', log)
    pg.click('#cvSheet [data-tr="hit"]'); pg.wait_for_timeout(200)
    move(ctx, pg, hole(1)['green']); pg.click('#cvSheet [data-tr="ball"]'); pg.wait_for_timeout(700)
    pg.click('#cvSheet [data-tr="putts"][data-v="2"]'); pg.wait_for_timeout(150)
    pg.click('#cvSheet [data-tr="holeout"]'); pg.wait_for_timeout(700)
    log = pg.evaluate("() => window.__feelLog")
    check('holing out plays the "hole" sound', log and log[-1] == 'hole' and log.count('shot') == 2, log)
    summ = pg.inner_text('#trSum')
    share = (pred['predicted'] - sum([4, 4, 3, 5, 4, 4, 3, 4, 5])) / 9
    want_pace = round(pred['predicted'] + 4 - 4 - share)
    check(f'the hole summary shows the pace: "On pace for {want_pace}, predicted {pred["predicted"]}"', f'On pace for {want_pace}, predicted {pred["predicted"]}' in summ, summ)
    if d.get('challenge'):
        check('the hole summary shows the on-course challenge', pg.query_selector('#trSum #plChal') is not None, summ)
        check('the challenge chip is not shown twice', len(pg.query_selector_all('#cvBody #plChal')) == 1)
    else:
        check('no challenge was offered for this round, so none on the summary', pg.query_selector('#trSum #plChal') is None)
    check('pace text at least 15 px', pg.evaluate("() => parseFloat(getComputedStyle(document.querySelector('#plPace')).fontSize) >= 15"))
    pg.screenshot(path=f'{SHOTS}/finish_390_summary.png')
    controls_ok(pg, 'hole summary')
    check('no horizontal overflow (summary)', no_overflow(pg))
    check('no script errors (summary)', not errs, errs[:3])
    ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
