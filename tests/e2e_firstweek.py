"""Browser test for the first week (first-run plan part B1): a fresh app shows the first week on Journey and Home; all five steps play end to end (one swapped);
a first play sets a mark and always celebrates; a replay plays against the mark; the finish screen shows the practice levels; the road then opens from the
practice level; skip works; a golfer with data never sees it. Phone sizes 390x844 and 320x568. Run: python3 tests/e2e_firstweek.py"""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
from play_helpers import answer_step
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
URL = f'http://127.0.0.1:{port}/index.html'
AUDIT = """(sel) => { const root = document.querySelector(sel) || document.body, bad = [], tiny = [];
  for (const el of root.querySelectorAll('button, input, select, a.btn')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 24) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  for (const el of root.querySelectorAll('input, select, textarea')) if (el.getBoundingClientRect().height && parseFloat(getComputedStyle(el).fontSize) < 16) tiny.push(el.id || el.type);
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad, tiny }; }"""
LOG = "() => (window.__feelLog || []).slice()"
FW = "() => { const f = window.__golfiq.progress.data().fw; return { show: f.show, done: f.done, count: f.count, states: f.steps.map((s) => s.state), marks: f.steps.map((s) => s.mark && s.mark.score), swapped: f.steps.map((s) => s.swapped) }; }"
def audit(pg, sel, label):
    a = pg.evaluate(AUDIT, sel); check(f'{label}: no overflow, tap targets 38px+, inputs 16px+', not a['overflow'] and not a['small'] and not a['tiny'], a)
def play_out(pg, every=3):
    pg.wait_for_selector('#gpRoot.gp-full'); taps = 0
    while pg.query_selector('#gpRoot:not(.gp-rv) [data-gp], #gpRoot:not(.gp-rv) [data-gpball]') and taps < 60: answer_step(pg, taps, every=every); taps += 1
    pg.wait_for_selector('#gpRoot.gp-rv', timeout=6000); pg.wait_for_selector('#gpRoot[data-revealed]', timeout=6000)
def new_page(b, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    for (W, H) in [(390, 844), (320, 568)]:
        sz = f'{W}x{H}'; ctx, pg, errs = new_page(b, W, H)
        # ------------------------------------------------------------ a fresh app: Home and Journey show the first week
        check(f'[{sz}] fresh app: Home shows the first-week card with step 1', pg.query_selector('#fwHome') is not None and 'Step 1 of 5: Holing out' in pg.inner_text('#fwHome'), pg.inner_text('#main')[:200])
        check(f'[{sz}] the first week was started (no rounds, no results)', pg.evaluate("() => !!window.__golfiq.state.journal.first_week?.started_at"))
        audit(pg, '#main', f'[{sz}] Home')
        pg.click('#fwHome [data-practice="journey"]'); pg.wait_for_selector('#fwSteps')
        check(f'[{sz}] Journey shows five steps in place of the road', len(pg.query_selector_all('#fwSteps .fw-step')) == 5 and pg.query_selector('#jnPath') is None)
        check(f'[{sz}] step 1 is next, the rest are locked', pg.evaluate(FW)['states'] == ['next', 'locked', 'locked', 'locked', 'locked'])
        check(f'[{sz}] skip is always there', pg.query_selector('[data-fwskip]') is not None)
        audit(pg, '#main', f'[{sz}] first-week steps')
        if W == 320: ctx.close(); continue        # the full play-through runs once, at 390x844; the small phone checks the layout of each screen below

        # ------------------------------------------------------------ step 1: set your mark, never a miss
        pg.evaluate("() => { window.__feelLog = []; }")
        pg.click('[data-fwplay="1"]'); pg.wait_for_selector('#gpRoot.gp-full')
        check('step 1 opens Holing out with "Set your mark" and no target', 'Set your mark' in pg.inner_text('.gp-strip') and 'handicap' not in pg.inner_text('.gp-tgt'), pg.inner_text('.gp-strip'))
        play_out(pg, every=2)                                  # every other putt missed: a poor score is still a mark, not a miss
        score = pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0].score")
        v = pg.inner_text('#gpVerdictL')
        check('the result says "Mark set" with the score', v.strip() == f'Mark set: {score}', v)
        check('it is shown as a success, never short', 'met' in pg.get_attribute('#gpVerdictL', 'class') and 'short' not in pg.inner_text('#gpRoot').lower(), pg.inner_text('#gpRoot')[:300])
        check('the step stamp is there', pg.query_selector('#gpFwStamp') is not None and 'Step 1 of 5' in pg.inner_text('#gpFwStamp'))
        check('it celebrates: the win sound (or the tier fanfare when a tier was earned)', ('win' in pg.evaluate(LOG)) != ('tier' in pg.evaluate(LOG)) and 'finish' not in pg.evaluate(LOG), pg.evaluate(LOG)[-6:])
        check('the handicap level line is shown', 'handicap' in pg.inner_text('.gp-rlevel') or 'scratch' in pg.inner_text('.gp-rlevel'))
        check('points are earned as normal', pg.query_selector('#gpRPts') is not None)
        check('step 1 is recorded with its result', pg.evaluate(FW)['states'][:2] == ['done', 'next'] and pg.evaluate(FW)['marks'][0] == score)
        audit(pg, '#gpRoot', 'result screen (mark set)')
        # ------------------------------------------------------------ step 2 straight from the result; then back to the list for a replay of step 1
        pg.click('[data-fwgo="2"]'); play_out(pg)
        check('step 2 (Distance control) sets its mark', pg.inner_text('#gpVerdictL').startswith('Mark set') and pg.evaluate(FW)['count'] == 2)
        pg.click('[data-fwhub]'); pg.wait_for_selector('#fwSteps')
        check('the list shows step 1\'s mark', f'Your mark: {score}' in pg.inner_text('[data-fwstep="1"]'), pg.inner_text('[data-fwstep="1"]'))
        pg.click('[data-fwplay="1"]'); pg.wait_for_selector('#gpRoot.gp-full')
        check('a replay shows "Beat your mark"', f'Beat your mark: {score}' in pg.inner_text('.gp-strip'), pg.inner_text('.gp-strip'))
        play_out(pg, every=99)
        check('a replay is judged against the mark', ('Target met' in pg.inner_text('#gpVerdictL') or 'personal best' in pg.inner_text('#gpVerdictL').lower()) and f'Your mark was {score}' in pg.inner_text('#gpRoot'), pg.inner_text('#gpRoot')[:300])
        check('a replay does not change the step', pg.evaluate(FW)['marks'][0] == score and pg.evaluate(FW)['count'] == 2)
        pg.click('[data-fwhub]'); pg.wait_for_selector('#fwSteps')
        # ------------------------------------------------------------ step 3 swapped for a putting game; 4 and 5 as listed (Driver test uses the distance screen)
        check('step 3 offers the swap', 'No range or green today?' in pg.inner_text('[data-fwstep="3"]'))
        pg.click('[data-fwswap="3"]'); pg.wait_for_selector('#gpRoot.gp-full')
        check('the swap plays Streak', pg.evaluate("() => window.__golfiq.state.journal.game_draft.game") == 'putt-streak')
        play_out(pg, every=4)
        check('a swapped step counts as done', pg.evaluate(FW)['states'][2] == 'done' and pg.evaluate(FW)['swapped'][2] is True)
        pg.click('[data-fwhub]'); pg.wait_for_selector('#fwSteps')
        check('the swapped step says what was played', 'instead' in pg.inner_text('[data-fwstep="3"]'))
        pg.click('[data-fwplay="4"]'); play_out(pg)
        check('step 4 played range-greens', pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0].game") == 'range-greens')
        pg.click('[data-fwhub]'); pg.wait_for_selector('#fwSteps'); pg.click('[data-fwplay="5"]'); play_out(pg)
        check('step 5 played the Driver test', pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0].game") == 'range-driver')
        check('the fifth step finishes the week', pg.evaluate(FW)['done'] is True and pg.query_selector('[data-fwfinish]') is not None)
        # ------------------------------------------------------------ the finish screen
        pg.evaluate("() => { window.__feelLog = []; }")
        pg.click('[data-fwfinish]'); pg.wait_for_selector('#gpRoot[data-fwdone][data-revealed]', timeout=6000)
        txt = pg.inner_text('#gpRoot')
        rows = pg.evaluate("() => [...document.querySelectorAll('#gpRoot .gp-sumrow')].map((r) => r.innerText)")
        check('"First week done" with the badge and 100 points', 'First week done' in txt and 'First week' in pg.inner_text('#gpFwBadge') and '+100 points' in txt, txt[:300])
        check('four skills are listed', len(rows) == 4 and [r.split('\n')[0] for r in rows] == ['Putting', 'Short game', 'Approach', 'Driving'], rows)
        check('putting, approach and driving have practice levels', all(any(ch.isdigit() for ch in r.split('\n')[-1]) for i, r in enumerate(rows) if i != 1), rows)
        check('short game (swapped) is not rated yet', 'Not rated yet' in rows[1], rows[1])
        check('practice levels are never called a handicap on this screen', 'handicap' not in txt.replace('not a handicap', ''), txt)
        check('win and tier sounds, and confetti', 'win' in pg.evaluate(LOG) and 'tier' in pg.evaluate(LOG))
        check('the First week badge and 100 points are in the history', pg.evaluate("() => { const v = window.__golfiq.progress.data(); return v.bd.some((b) => b.id === 'fw' && b.earned) && v.lv.ledger.some((l) => l.what === 'First week finished' && l.points === 100); }"))
        audit(pg, '#gpRoot', 'finish screen')
        # ------------------------------------------------------------ the road opens from the practice level
        pg.click('[data-fwroad]'); pg.wait_for_selector('#jnPath')
        jr = pg.evaluate("() => { const v = window.__golfiq.progress.data(); return { basis: v.jr.basis, start: v.jr.start, cur: v.jr.current && v.jr.current.n }; }")
        you = pg.inner_text('.jn-you')
        check('the road starts from the practice level', jr['basis'] == 'practice' and jr['cur'] is not None and jr['cur'] < jr['start'] and jr['cur'] >= jr['start'] - 5, jr)
        check('the marker reads "Practice level N", never handicap', you.startswith('Practice level ') and 'handicap' not in you.lower(), you)
        check('stretches above it are marked as above the practice level', ('Above your practice level' in pg.inner_text('#jnPath')) == (jr['start'] <= 30), pg.inner_text('#jnPath')[:200])
        check('the first-week list is gone', pg.query_selector('#fwSteps') is None)
        pg.goto(URL); pg.wait_for_selector('#main')
        check('Home shows "Next on your journey", not the first week', pg.query_selector('#fwHome') is None and pg.query_selector('.jn-home') is not None, pg.inner_text('#main')[:200])
        check('no page errors in the play-through', not errs, errs)
        ctx.close()

    # ------------------------------------------------------------ the 320x568 phone: the game, result and finish screens
    ctx, pg, errs = new_page(b, 320, 568)
    pg.click('#fwHome [data-fwplay="1"]'); pg.wait_for_selector('#gpRoot.gp-full'); audit(pg, '#gpRoot', '[320x568] game screen (set your mark)')
    play_out(pg); audit(pg, '#gpRoot', '[320x568] result screen (mark set)')
    pg.evaluate("""async () => { const g = window.__golfiq, S = await import('./store.js'), FW = await import('./firstweek.js'); let fw = g.state.journal.first_week;
      for (const s of FW.STEPS.slice(1, 4)) { const id = 'x' + s.n; g.state.journal.results.push({ id, game: s.game, date: '2026-11-10', score: 5, mode: 'guided', first_week: s.n }); fw = FW.recordStep(fw, { n: s.n, game: s.game, result_id: id, date: '2026-11-10' }); }
      g.state.journal.first_week = fw; await S.saveJournal(g.state); }""")
    pg.click('[data-fwhub]'); pg.wait_for_selector('#fwSteps'); audit(pg, '#main', '[320x568] steps with four done')
    pg.click('[data-fwswap="5"]'); play_out(pg)
    check('[320x568] step 5 swapped to Holing out finishes the week', pg.evaluate("() => window.__golfiq.state.journal.results.slice(-1)[0].game") == 'putt-369' and pg.query_selector('[data-fwfinish]') is not None)
    pg.click('[data-fwfinish]'); pg.wait_for_selector('#gpRoot[data-fwdone][data-revealed]', timeout=6000); audit(pg, '#gpRoot', '[320x568] finish screen')
    pg.click('[data-fwroad]'); pg.wait_for_selector('#jnPath'); audit(pg, '#main', '[320x568] road from the practice level')
    check('[320x568] no page errors', not errs, errs); ctx.close()

    # ------------------------------------------------------------ skip
    ctx, pg, errs = new_page(b, 390, 844)
    pg.evaluate("() => { location.hash = '#practice'; }"); pg.wait_for_selector('#fwSteps'); pg.click('[data-fwskip]'); pg.wait_for_selector('#jnPath')
    check('skip opens the full road at 30', pg.evaluate("() => window.__golfiq.progress.data().jr.current.n") == 30 and pg.evaluate("() => !!window.__golfiq.state.journal.first_week.skipped_at"))
    pg.goto(URL); pg.wait_for_selector('#loadSample'); check('after skipping, Home has no first-week card', pg.query_selector('#fwHome') is None)
    check('skipping earns no points', pg.evaluate("() => window.__golfiq.progress.data().lv.points") == 0)
    ctx.close()

    # ------------------------------------------------------------ golfers with data never see it
    ctx, pg, errs = new_page(b, 390, 844)
    pg.evaluate("""async () => { const g = window.__golfiq, S = await import('./store.js'); delete g.state.journal.first_week; g.state.journal.results.push({ id: 'old1', game: 'putt-369', date: '2026-10-01', score: 5, mode: 'guided' }); await S.saveJournal(g.state); }""")
    pg.reload(); pg.wait_for_selector('#main'); pg.evaluate("() => { location.hash = '#practice'; }"); pg.wait_for_selector('#jnPath')
    check('a golfer with practice results and no rounds never gets a first week', pg.evaluate("() => window.__golfiq.state.journal.first_week === undefined") and pg.query_selector('#fwSteps') is None)
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    check('with the sample data: no first-week card on Home', pg.query_selector('#fwHome') is None and pg.query_selector('.jn-home') is not None)
    pg.evaluate("() => { location.hash = '#practice'; }"); pg.wait_for_selector('#jnPath')
    check('with the sample data: the road, not the first week', pg.query_selector('#fwSteps') is None and pg.evaluate("() => window.__golfiq.state.journal.first_week === undefined"))
    audit(pg, '#main', 'sample data: Journey')
    check('no page errors', not errs, errs); ctx.close()
    b.close()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'all first-week browser checks passed'))
sys.exit(1 if fails else 0)
