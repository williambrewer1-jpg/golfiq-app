"""Browser test for shot tracking in the Course view (course-view plan, phase 3). Run: python3 tests/e2e_tracking.py

Plays holes on the invented course (tests/fake_course.py) with GPS moved through Playwright: a par 4 with a water
penalty, a par 3 end to end, out of bounds with weak GPS, a shot marked on the map, undo and a forgotten tap, a reload
mid-shot, and a course with no map.
"""
import sys, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_harness import *  # noqa: F401,F403

YD = 0.9144
def peek(pg): return pg.inner_text('#cvPeek')
def btn(pg, act, v=None): return f'#cvSheet [data-tr="{act}"]' + (f'[data-v="{v}"]' if v is not None else '')
def tap(pg, act, v=None, wait=250): pg.click(btn(pg, act, v)); pg.wait_for_timeout(wait)
def H(pg, n=None):
    d = draft(pg); return d['holes'][str(n or d['hole'])]
def move(ctx, pg, pt, acc=4, wait=1300): ctx.set_geolocation(geo(pt, acc)); pg.wait_for_timeout(wait)
def near(a, b, m=1.5):
    import math
    return a and b and math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))) <= m
def sheet(pg): return pg.evaluate("() => document.querySelector('#cvRoot').dataset.sheet")
def close_sheet(pg):
    if sheet(pg) != 'peek': pg.click('#cvHandle'); pg.wait_for_timeout(200)
def goto_hole(pg, n):
    pg.evaluate("async (n) => { const g = window.__golfiq, d = g.state.journal.draft; d.hole = n; const S = await import('./store.js'); await S.saveJournal(g.state); }", n)
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ------------------------------------------------------------ the start card
    ctx, pg, errs = new_page(b, 390, 844)
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart')
    check('start card: "Track shots" switch, on by default', pg.is_checked('#plStart [name=track]') and 'Track shots' in pg.inner_text('#plStart'))
    ctx.close()

    # ------------------------------------------------------------ hole 1, par 4, with a water penalty
    ctx, pg, errs = new_page(b, 390, 844)
    start_round(pg, track=True)
    d = draft(pg)
    check('the round is tracked', d.get('track') is True)
    check('ready: the strip offers I\'ve hit and Score', "I've hit" in peek(pg) and 'Score' in peek(pg) and 'to aim' in peek(pg), peek(pg))
    controls_ok(pg, 'ready')
    pg.screenshot(path=f'{SHOTS}/track_390_ready.png')
    tee = hole(1)['tee']
    tap(pg, 'hit')
    h = H(pg); s1 = h['shots'][0]
    check('I\'ve hit: shot 1 saved from where you stand, with the club in hand and the aim', len(h['shots']) == 1 and near(s1['start'], tee) and s1['club_id'] and s1['aim'] and s1['lie'] == 'tee', s1)
    check('a club you did not choose is recorded as assumed', s1['club_assumed'] is True)
    check('walking: At my ball and Penalty, then I\'ve hit, Mark on map and Undo', 'Walk to your ball' in peek(pg) and all(x in peek(pg) for x in ('At my ball', 'Penalty', "I've hit", 'Mark on map', 'Undo')), peek(pg))
    controls_ok(pg, 'walking')
    pg.screenshot(path=f'{SHOTS}/track_390_walking.png')
    tap(pg, 'pen')
    check('Penalty asks which kind', all(x in peek(pg) for x in ('Water', 'Out of bounds or lost', 'Unplayable')), peek(pg))
    controls_ok(pg, 'penalty question')
    tap(pg, 'setpen', 'water')
    check('water: asks for the drop', 'Take your drop' in peek(pg) and H(pg)['shots'][0]['penalty'] == 'water', peek(pg))
    drop = point(1, 222, -19)
    move(ctx, pg, drop)
    tap(pg, 'ball', wait=800)
    s1 = H(pg)['shots'][0]
    check('At my ball after a penalty records the drop', near(s1.get('drop'), drop) and s1['end'] is None, s1)
    check('back to ready for the next shot', "I've hit" in peek(pg))
    tap(pg, 'hit')
    check('shot 2 starts from the drop, lie from the map there', near(H(pg)['shots'][1]['start'], drop) and H(pg)['shots'][1]['lie'] == 'rough', H(pg)['shots'][1])
    move(ctx, pg, point(1, 352, 2))
    pg.evaluate("() => { window.__dynMark = document.querySelector('#hm'); }")
    tap(pg, 'ball', wait=900)
    s2 = H(pg)['shots'][1]
    check('At my ball: the end and the result come from the map (green)', near(s2['end'], point(1, 352, 2)) and s2['result'] == 'green', s2)
    check('on the green: the putting panel', 'How many putts' in peek(pg) and pg.query_selector(btn(pg, 'putts', 2)) is not None, peek(pg))
    check('Hole out waits for a putt count', pg.is_disabled(btn(pg, 'holeout')))
    controls_ok(pg, 'putting')
    pg.screenshot(path=f'{SHOTS}/track_390_putting.png')
    check('putting: no full-swing pattern on the map', pg.query_selector('#hmDyn .hm-zone50') is None and pg.query_selector('#hmDyn .hm-arc') is None)
    check('first putt starts unset (slider dimmed)', 'unset' in pg.get_attribute('#trFp', 'class') and 'not set' in pg.inner_text('#trFpv'))
    tap(pg, 'putts', 2)
    pg.evaluate("() => { const r = document.querySelector('#trFp'); r.value = 4; r.dispatchEvent(new Event('input', { bubbles: true })); }"); pg.wait_for_timeout(100)
    check('first putt slider in paced steps (4 paces = 12 ft)', '12 ft' in pg.inner_text('#trFpv'), pg.inner_text('#trFpv'))
    tap(pg, 'holeout', wait=500)
    h = H(pg)
    check('the hole works out its score: 2 shots + 1 penalty + 2 putts = 5', h['strokes'] == 5 and h['putts'] == 2 and h['penalties'] == 1, h)
    check('fairway missed left (the water and drop were left of the line)', h['fairway'] == 'LEFT', h['fairway'])
    check('green not in regulation; first putt saved', h['derived']['gir'] == 0 and abs(h['first_putt_m'] - 12 * 0.3048) < 0.01, h.get('derived'))
    check('Hole out opens the hole summary', sheet(pg) == 'half' and pg.query_selector('#trSum') is not None)
    summ = pg.inner_text('#trSum')
    check('summary: score large with its name and the stats as chips', '5' in summ and 'Bogey' in summ and all(x in summ for x in ('Missed left', 'Green missed', '2 putts', '1 penalty', 'First putt 12 ft')), summ)
    check('the shot list shows both shots', len(pg.query_selector_all('#cvBody .tr-list li')) == 2 and 'Water' in pg.inner_text('#cvBody .tr-list'))
    check('the steppers start from the worked-out values', pg.inner_text('#cvBody .step:first-child b') == '5')
    check('top bar: +1 thru 1', '+1 thru 1' in pg.inner_text('#cvTop'))
    pg.screenshot(path=f'{SHOTS}/track_390_summary.png')
    controls_ok(pg, 'hole summary')
    # a correction wins, even when a shot is then edited
    pg.click('#cvBody [data-step="strokes"][data-d="-1"]'); pg.wait_for_timeout(250)
    tap(pg, 'row', 1); tap(pg, 'lres', 'fringe', wait=350)
    h = H(pg)
    check('a correction in the summary wins over the worked-out score', h['strokes'] == 4 and 'strokes' in h.get('corrected', []), h)
    pg.click('#cvBody [data-step="strokes"][data-d="1"]'); tap(pg, 'lres', 'green', wait=350)
    check('the hole map draws this hole\'s shots and the drop', len(pg.query_selector_all('#hmDyn .tr-mark')) == 1 and len(pg.query_selector_all('#hmDyn .tr-drop')) == 1)
    close_sheet(pg)
    check('done: the strip says the result and offers Next hole', 'Hole 1: 5 · Bogey' in peek(pg) and 'Next hole' in peek(pg), peek(pg))
    tap(pg, 'next', wait=1200)
    check('Next hole: one tap', draft(pg)['hole'] == 2 and 'Hole 2' in pg.inner_text('#cvTitle'))

    # ------------------------------------------------------------ hole 2, par 4: weak GPS on the tee, out of bounds, mark on the map, undo, forgotten tap
    move(ctx, pg, point(2, 3, 6), acc=40, wait=1500)
    tap(pg, 'hit')
    t2 = hole(2)['tee']
    check('weak GPS on the tee: the tee position is used', near(H(pg)['shots'][0]['start'], t2) and H(pg)['shots'][0]['approx'] is False, H(pg)['shots'][0])
    tap(pg, 'pen'); tap(pg, 'setpen', 'ob', wait=800)
    check('out of bounds: no drop, ready to play again', "I've hit" in peek(pg) and H(pg)['shots'][0]['penalty'] == 'ob', peek(pg))
    tap(pg, 'hit')
    check('the replay is from the same spot, off the tee', near(H(pg)['shots'][1]['start'], t2) and H(pg)['shots'][1]['lie'] == 'tee', H(pg)['shots'][1])
    tap(pg, 'mark')
    check('Mark on map asks for a tap on the map', 'Tap the map where your ball finished' in peek(pg))
    mx, my = pg.evaluate("(p) => window.__golfiq.extra.play.course._state().L.fr.xy(p[0], p[1])", list(point(2, 230, 30)))
    pg.mouse.click(mx, my); pg.wait_for_timeout(900)
    s = H(pg)['shots'][1]
    check('a tap on the map closes the shot there, marked and not approximate', near(s['end'], point(2, 230, 30), 3) and s['marked'] is True and s['approx'] is False and s['result'] == 'rough', s)
    st = pg.inner_text('#cvPeek .tr-strip')
    check('result strip: distance, result and side of the aim, with Edit, Undo and Penalty', 'Rough' in st and 'right of aim' in st and all(x in st for x in ('Edit', 'Undo', 'Penalty')), st)
    check('result strip: the assumed club is a chip with a question mark', '?' in pg.inner_text('#cvPeek .tr-club'))
    controls_ok(pg, 'result strip')
    pg.screenshot(path=f'{SHOTS}/track_390_strip.png')
    pg.click('#cvPeek .tr-club'); pg.wait_for_timeout(200)
    other = pg.eval_on_selector_all('#cvPeek [data-tr="setclub"]', 'els => els.map(e => e.dataset.v)')
    pg.click(f'#cvPeek [data-tr="setclub"][data-v="{other[1]}"]'); pg.wait_for_timeout(250)
    s = H(pg)['shots'][1]
    check('one tap on the club chip, one on the club: changed and confirmed', s['club_id'] == other[1] and s['club_assumed'] is False, s)
    tap(pg, 'hit')
    check('walking: Undo is there for an I\'ve hit by mistake', pg.query_selector(btn(pg, 'undo')) is not None)
    tap(pg, 'undo', wait=600)
    check('undo removes a shot hit by mistake', len(H(pg)['shots']) == 2 and "I've hit" in peek(pg))
    ctx.set_geolocation(geo(point(2, 230, 30), 4)); pg.wait_for_timeout(1300)
    tap(pg, 'hit')
    move(ctx, pg, point(2, 330, 4), acc=25)
    tap(pg, 'hit')                                                                                 # forgot "At my ball"
    h = H(pg)
    check('two I\'ve hit taps in a row: the first shot closes where the second starts', len(h['shots']) == 4 and near(h['shots'][2]['end'], point(2, 330, 4)) and h['shots'][2]['approx'] is True, h['shots'][2])
    move(ctx, pg, point(2, 352, 0), acc=25)
    tap(pg, 'ball', wait=900)
    check('weak GPS at the ball: the strip says the distance is approximate', 'putts' in peek(pg).lower() or 'approximate' in peek(pg).lower())
    tap(pg, 'putts', 1); tap(pg, 'holeout', wait=500)
    h = H(pg)
    check('par 4 with out of bounds: 4 shots + 1 penalty + 1 putt = 6', h['strokes'] == 6 and h['penalties'] == 1 and h['putts'] == 1, h)
    check('shots with weak GPS are marked approximate', h['shots'][2]['approx'] is True and h['shots'][3]['approx'] is True)
    # shot list: delete and add
    tap(pg, 'row', 3); tap(pg, 'ldel', wait=350)
    check('delete a shot from the list: the hole is worked out again', len(H(pg)['shots']) == 3 and H(pg)['strokes'] == 5, H(pg)['strokes'])
    tap(pg, 'add', wait=350)
    check('add a missed shot: counts for the score', len(H(pg)['shots']) == 4 and H(pg)['strokes'] == 6 and H(pg)['shots'][3].get('manual') is True)
    pg.select_option(f'#cvBody select[data-trclub="3"]', index=2); pg.wait_for_timeout(300)
    check('the added shot\'s club can be set', H(pg)['shots'][3]['club_id'] and H(pg)['shots'][3]['club_assumed'] is False)
    check('no horizontal overflow (summary and shot list)', no_overflow(pg))
    pg.screenshot(path=f'{SHOTS}/track_390_list.png')

    # ------------------------------------------------------------ hole 3, par 3 end to end: chosen club, edit the result, up and down
    close_sheet(pg); tap(pg, 'next', wait=1200)
    move(ctx, pg, hole(3)['tee'])
    pg.click('[data-cvpeekclub]'); pg.wait_for_selector('#plRec')
    seven = pg.evaluate("() => window.__golfiq.ds.clubs.find(c => c.name === '7 Iron').club_id")
    pg.evaluate("(id) => document.querySelector(`#plRec [data-club=\"${id}\"]`).click()", seven); pg.wait_for_timeout(250)
    close_sheet(pg)
    tap(pg, 'hit')
    check('a club you chose is not assumed', H(pg)['shots'][0]['club_id'] == seven and H(pg)['shots'][0]['club_assumed'] is False, H(pg)['shots'][0])
    move(ctx, pg, point(3, 136, 18))
    tap(pg, 'ball', wait=900)
    check('short right of the green: rough', H(pg)['shots'][0]['result'] == 'rough')
    tap(pg, 'edit'); tap(pg, 'setres', 'fringe')
    check('Edit: change the result to Fringe', H(pg)['shots'][0]['result'] == 'fringe')
    tap(pg, 'hit')
    check('the chip\'s lie is the edited result', H(pg)['shots'][1]['lie'] == 'fringe')
    move(ctx, pg, point(3, 148, 2))
    tap(pg, 'ball', wait=900); tap(pg, 'putts', 1); tap(pg, 'holeout', wait=500)
    h = H(pg)
    check('par 3: missed green, chip, one putt = par, up and down', h['strokes'] == 3 and h['derived']['gir'] == 0 and h['derived']['up_down'] == 1 and h['fairway'] is None, h)
    check('summary says Par and Up and down', 'Par' in pg.inner_text('#trSum') and 'Up and down' in pg.inner_text('#trSum'))
    check('top bar after three holes (5, 6, 3): +3 thru 3', '+3 thru 3' in pg.inner_text('#cvTop'), pg.inner_text('#cvTop'))

    # ------------------------------------------------------------ "On the green" by hand, and "Not on the green"
    close_sheet(pg); tap(pg, 'next', wait=1200)
    move(ctx, pg, hole(4)['tee']); tap(pg, 'hit'); move(ctx, pg, point(4, 300)); tap(pg, 'ball', wait=900)
    tap(pg, 'hit'); move(ctx, pg, point(4, 450, 0)); tap(pg, 'ball', wait=900)
    if 'How many putts' in peek(pg): tap(pg, 'notgreen')
    check('Not on the green returns to the shot buttons', "I've hit" in peek(pg))
    check('near the green the strip offers On the green', 'On the green' in peek(pg), peek(pg))
    tap(pg, 'green'); check('On the green opens putting', 'How many putts' in peek(pg))

    # ------------------------------------------------------------ reload mid-shot
    tap(pg, 'notgreen'); tap(pg, 'hit')
    pg.reload(); pg.wait_for_selector('#cvRoot'); pg.wait_for_timeout(1500)
    check('a reload mid-shot keeps the shot open', 'Walk to your ball' in peek(pg) and 'At my ball' in peek(pg), peek(pg))
    tap(pg, 'ball', wait=900)
    check('and At my ball still closes it', H(pg)['shots'][2]['end'] is not None)
    # finish: the score is saved as a round, and the tracked shots stay on the phone with it for phase 4
    rid = 'garmin-' + draft(pg)['id']
    (pg.click('#cvHandle') if sheet(pg) == 'peek' else None); pg.wait_for_timeout(200); pg.click('[data-cvtab="card"]'); pg.wait_for_selector('#cvBody #plFinish')
    pg.click('#cvBody #plFinish'); pg.wait_for_timeout(1500)
    r = pg.evaluate("(id) => window.__golfiq.ds.holes.filter(h => h.round_id === id).map(h => [h.hole, h.strokes, h.putts, h.penalties])", rid)
    check('finishing saves the worked-out scores as a round', [x[1] for x in r[:3]] == [5, 6, 3] and r[0][3] == 1, r)
    sh = pg.evaluate("(id) => { const s = window.__golfiq.ds.shots.filter(x => x.round_id === id); return { n: s.length, app: s.every(x => x.source === 'app'), byHole: Object.fromEntries([1,2,3,4].map(h => [h, s.filter(x => x.hole === h).length])), pens: s.filter(x => x.category === 'penalty').length, stock: window.__golfiq.A.stockShots(window.__golfiq.ds.shots, window.__golfiq.ds.clubs).filter(x => x.round_id === id).length, approxOut: s.filter(x => x.app_approx).every(x => !x.club_stats) }; }", rid)
    check('the tracked shots are in your stats, as app shots, with a penalty record for each penalty', sh['app'] and sh['byHole'] == {'1': 3, '2': 5, '3': 2, '4': 3} and sh['pens'] == 2, sh)
    check('weak-GPS and assumed-club shots stay out of club statistics', sh['approxOut'] and 0 < sh['stock'] < sh['n'], sh)
    check('nothing set aside any more: the shots went straight into the round', not pg.evaluate("() => (window.__golfiq.state.journal.tracked_rounds || []).length"))
    check('no script errors (390 x 844)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ a round tracked before shots went into the dataset: added once
    ctx, pg, errs = new_page(b, 390, 844)
    start_round(pg, track=True)
    tap(pg, 'hit'); move(ctx, pg, point(1, 236, 4)); tap(pg, 'ball', wait=900); tap(pg, 'hit'); move(ctx, pg, point(1, 352)); tap(pg, 'ball', wait=900); tap(pg, 'putts', 2); tap(pg, 'holeout', wait=500)
    pg.evaluate("""async () => { const g = window.__golfiq, d = g.state.journal.draft, F = await import('./features.js'), S = await import('./store.js');
      // what #49 did on Finish: a plain round, and the shots kept aside
      await S.mergeBundles(g.state, [F.manualBundle(d)], 'entered on phone');
      g.state.journal.tracked_rounds = [{ round_id: 'garmin-' + d.id, draft_id: d.id, course_id: d.course_id, date: d.start.slice(0, 10), holes: { 1: { shots: d.holes[1].shots, first_putt_m: null } } }];
      g.state.journal.draft = null; await S.saveJournal(g.state); }""")
    rid = 'garmin-' + pg.evaluate("() => window.__golfiq.state.journal.tracked_rounds[0].draft_id")
    pg.goto(URL + '#rounds'); pg.reload(); pg.wait_for_timeout(1200)
    check('before Play opens, the old round has no shots', pg.evaluate("(id) => window.__golfiq.ds.shots.filter(s => s.round_id === id).length", rid) == 0)
    pg.goto(URL + '#play'); pg.wait_for_timeout(2000)
    check('opening Play adds the kept shots to that round', pg.evaluate("(id) => window.__golfiq.ds.shots.filter(s => s.round_id === id && s.source === 'app').length", rid) == 2)
    check('and only once', pg.evaluate("() => window.__golfiq.state.journal.tracked_rounds[0].imported") is True)
    check('no script errors (backfill)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ 320 x 568: every tracking state fits
    ctx, pg, errs = new_page(b, 320, 568)
    start_round(pg, track=True)
    controls_ok(pg, '320 ready'); check('320: no overflow (ready)', no_overflow(pg)); pg.screenshot(path=f'{SHOTS}/track_320_ready.png')
    tap(pg, 'hit'); controls_ok(pg, '320 walking'); check('320: no overflow (walking)', no_overflow(pg))
    check('320: walking buttons fit', pg.evaluate("() => [...document.querySelectorAll('#cvPeek .tr-btns .btn')].every(b => b.scrollWidth <= b.clientWidth + 1)"))
    pg.screenshot(path=f'{SHOTS}/track_320_walking.png')
    move(ctx, pg, point(1, 230, 25)); tap(pg, 'ball', wait=900)
    controls_ok(pg, '320 result strip'); check('320: no overflow (result strip)', no_overflow(pg)); pg.screenshot(path=f'{SHOTS}/track_320_strip.png')
    tap(pg, 'hit'); move(ctx, pg, point(1, 355, 0)); tap(pg, 'ball', wait=900)
    controls_ok(pg, '320 putting'); check('320: no overflow (putting)', no_overflow(pg)); pg.screenshot(path=f'{SHOTS}/track_320_putting.png')
    tap(pg, 'putts', 2); tap(pg, 'holeout', wait=500)
    check('320: the par 4 works out at par with the fairway missed right', H(pg)['strokes'] == 4 and H(pg)['fairway'] == 'RIGHT', H(pg))
    pg.screenshot(path=f'{SHOTS}/track_320_summary.png'); check('320: no overflow (summary)', no_overflow(pg))
    check('no script errors (320 x 568)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ a course with no map: you say where it finished
    ctx, pg, errs = new_page(b, 390, 844, outline=False)
    start_round(pg, track=True)
    tap(pg, 'hit'); move(ctx, pg, point(1, 230)); tap(pg, 'ball', wait=900)
    check('no map: asks where it finished', 'Where did it finish' in peek(pg) and pg.query_selector(btn(pg, 'setres', 'fairway')) is not None, peek(pg))
    controls_ok(pg, 'result chips')
    pg.screenshot(path=f'{SHOTS}/track_390_nomap.png')
    tap(pg, 'setres', 'fairway'); tap(pg, 'hit'); move(ctx, pg, point(1, 358)); tap(pg, 'ball', wait=900); tap(pg, 'setres', 'green')
    check('no map: Green opens putting', 'How many putts' in peek(pg))
    tap(pg, 'putts', 2); tap(pg, 'holeout', wait=500)
    check('no map: par worked out, fairway hit', H(pg)['strokes'] == 4 and H(pg)['fairway'] == 'HIT', H(pg))
    check('no script errors (no map)', not errs, errs[:3])
    ctx.close()

    # ------------------------------------------------------------ a round started with tracking off keeps quick score
    ctx, pg, errs = new_page(b, 390, 844)
    start_round(pg, track=False)
    check('tracking off: Score and Card, no I\'ve hit', "I've hit" not in peek(pg) and 'Score' in peek(pg) and 'Card' in peek(pg).title(), peek(pg))
    pg.click('[data-cvscore]'); pg.wait_for_selector('#cvBody [data-tr="track"]')
    tap(pg, 'track', '1', wait=400)
    check('tracking can be switched on during a round', draft(pg)['track'] is True)
    pg.click('#cvHandle'); pg.wait_for_timeout(200)
    check('and the strip then offers I\'ve hit', "I've hit" in peek(pg))
    check('no script errors (switch)', not errs, errs[:3])
    ctx.close()
    b.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
