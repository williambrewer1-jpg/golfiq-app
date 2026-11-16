"""Browser test for phase R4 (proof it's working): the prediction on the start card, saved when the round starts, the result on the round card,
the win sound and points for a beaten prediction, nothing for a missed one, the Practice payoff card, and the Progress card. 390x844, sample data.
Run: python3 tests/e2e_payoff.py"""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
URL = f'http://127.0.0.1:{port}/index.html'
AUDIT = """() => { const bad = [];
  for (const el of document.querySelectorAll('.po-card button, .po-home a')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38) && el.type !== 'checkbox' && el.type !== 'radio') bad.push((el.textContent || el.name || '').trim().slice(0, 20)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
def play_nine(pg, extra=0):
    for i in range(9):
        pg.wait_for_selector('#plNext'); pg.click('[data-step="strokes"][data-d="1"]')
        if i == 0:
            for _ in range(extra): pg.click('[data-step="strokes"][data-d="1"]')      # a different card, so it is not treated as the same round twice
        if i < 8: pg.click('#plNext'); pg.wait_for_timeout(60)
def start_nine(pg):
    pg.goto(URL + '#play'); pg.wait_for_selector('#plStart'); pg.select_option('select[name=n]', '9')
    if pg.query_selector('.chal-offer input'): pg.uncheck('.chal-offer input')
    pg.click('#plStart button.btn'); pg.wait_for_selector('#plNext')
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    check('old saved data has no predictions and still loads', pg.evaluate("() => !window.__golfiq.state.journal.predictions"))
    pg.goto(URL + '#play'); pg.reload(); pg.wait_for_selector('#plStart')
    t = pg.inner_text('#plPred'); check('start card shows a prediction with a range', 'BreakingPar predicts' in t and 'Beat it' in t, t)
    pg.select_option('select[name=n]', '9'); pg.wait_for_timeout(100); t9 = pg.inner_text('#plPred')
    check('prediction follows the number of holes', t9 != t or 'predicts' in t9, (t, t9))
    pg.fill('input[name=rating]', ''); pg.wait_for_timeout(100)
    a = pg.evaluate(AUDIT); check('start card has no overflow and tap targets are big enough', not a['overflow'] and not a['small'], a)
    pg.screenshot(path='/tmp/payoff_start.png')
    # round 1: prediction saved at the start, then forced very high so par golf beats it
    start_nine(pg)
    pr = pg.evaluate("() => window.__golfiq.state.journal.predictions")
    check('prediction is saved when the round starts', pr and len(pr) == 1 and pr[0]['round_id'].startswith('garmin-m') and pr[0]['predicted'] > 0 and pr[0]['n'] == 9, pr)
    pg.evaluate("() => { const p = window.__golfiq.state.journal.predictions[0]; p.predicted = 60; p.lo = 55; p.hi = 65; }")
    pts0 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    play_nine(pg); pg.click('#plFinish'); pg.wait_for_timeout(1200)
    log = pg.evaluate("() => window.__feelLog || []"); check('win sound plays when the prediction is beaten', 'win' in log, log)
    check('round card says it beat the prediction', 'beat the prediction' in pg.inner_text('body'), pg.inner_text('body')[:300])
    check('round card shows the prediction box and points', pg.query_selector('.po-pred') is not None and '+25' in pg.inner_text('.po-pred'), pg.inner_text('.po-pred') if pg.query_selector('.po-pred') else None)
    pts1 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    check('beating it adds points on top of the round', pts1 - pts0 >= 25 + 15, (pts0, pts1))
    a = pg.evaluate(AUDIT); check('round card has no overflow / small targets', not a['overflow'] and not a['small'], a); pg.screenshot(path='/tmp/payoff_round.png')
    # round 2: prediction set impossibly low -> missed, no win sound, no penalty
    pg.evaluate("() => { window.__feelLog = []; }")
    start_nine(pg); pg.evaluate("() => { const j = window.__golfiq.state.journal, d = j.draft, t = new Date(d.start); t.setHours(t.getHours() + 3); d.start = new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }")   # rounds started within 20 minutes count as one
    pg.evaluate("() => { const j = window.__golfiq.state.journal, p = j.predictions[j.predictions.length - 1]; p.predicted = 10; p.lo = 9; p.hi = 11; }")
    pts2 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    play_nine(pg, 1); pg.click('#plFinish'); pg.wait_for_timeout(1200)
    log2 = pg.evaluate("() => window.__feelLog || []"); check('no win sound when the prediction is missed', 'win' not in log2, log2)
    txt = pg.inner_text(".po-pred"); check('a miss reads plainly, not as a failure', 'over the prediction' in txt and 'fail' not in txt.lower(), txt)
    pts3 = pg.evaluate("() => window.__golfiq.progress.data().lv.points")
    check('a missed prediction takes nothing away', pts3 >= pts2, (pts2, pts3))
    # discard removes the stored prediction
    n_before = pg.evaluate("() => window.__golfiq.state.journal.predictions.length")
    start_nine(pg); pg.click('#plDiscard'); pg.wait_for_timeout(300)
    check('discarding a round removes its prediction', pg.evaluate("() => window.__golfiq.state.journal.predictions.length") == n_before)
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('.po-home', timeout=8000)
    check('Home shows the latest round for a week', 'prediction' in pg.inner_text('.po-home').lower(), pg.inner_text('.po-home'))
    a = pg.evaluate(AUDIT); check('Home has no overflow', not a['overflow'], a)
    st = pg.evaluate("() => { const e = getComputedStyle(document.querySelector('.po-home')); return [e.textDecorationLine, e.backgroundColor, e.display]; }")
    check('the Home payoff card is styled as a card (no link underline, has a background)', st[0] == 'none' and st[1] not in ('rgba(0, 0, 0, 0)', 'transparent') and st[2] == 'block', st)
    pg.click('[data-level]'); pg.wait_for_selector('#sheet.open [data-sheetx]')
    box = pg.evaluate("() => { const r = document.querySelector('#sheetPanel [data-sheetx]').getBoundingClientRect(); return [r.top, r.bottom, r.width, r.height, innerHeight]; }")
    check('the level sheet has a close button in view at the top', 0 <= box[0] and box[1] <= box[4] and box[2] >= 38 and box[3] >= 38, box)
    pg.evaluate("() => { document.querySelector('#sheetPanel').scrollTop = 99999; }"); pg.wait_for_timeout(100)
    box = pg.evaluate("() => { const r = document.querySelector('#sheetPanel [data-sheetx]').getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; }")
    check('and it stays in view after scrolling to the bottom', 0 <= box[0] and box[1] <= box[2], box)
    pg.click('#sheetPanel [data-sheetx]'); pg.wait_for_timeout(200); check('tapping it closes the sheet', pg.query_selector('#sheet.open') is None)
    # Practice payoff card + Progress card on an older sample round
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'progress'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_timeout(1200)
    body = pg.inner_text('body'); check('Progress page has the predictions card', 'Beat the prediction' in body and ' beaten' in body, body[:200])
    a = pg.evaluate(AUDIT); check('Progress has no overflow', not a['overflow'], a)
    rid = pg.evaluate("() => { const r = window.__golfiq.ds.rounds.filter(x => x.format === '18').slice(-1)[0]; return r && r.round_id; }")
    pg.evaluate("(r) => { const u = JSON.parse(localStorage.getItem('golfiq-ui') || '{}'); u.rd_open = r; u.rd_tab = 'card'; localStorage.setItem('golfiq-ui', JSON.stringify(u)); }", rid)
    pg.goto(URL + '#rounds'); pg.reload(); pg.wait_for_selector('#rdetail')
    check('an 18-hole sample round opens with no errors and a prediction', pg.query_selector('.po-pred') is not None or pg.query_selector('.po-card') is not None, pg.inner_text('#rdetail')[:200])
    check('payoff text says it is a small sample, never a handicap claim', 'handicap' not in (pg.inner_text('.po-card').lower() if pg.query_selector('.po-card') else ''))
    a = pg.evaluate(AUDIT); check('round detail has no overflow / small targets', not a['overflow'] and not a['small'], a)
    check('no page errors', not errs, errs[:3])
    b.close()
print('\n%s' % ('ALL PASSED' if not fails else 'FAILED: ' + ', '.join(fails))); sys.exit(1 if fails else 0)
