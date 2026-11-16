"""Browser test for phase R6 (kudos), against the fake Firebase only: buttons on the leaderboard, the weekly league and the recent-scores list, give / take back / switch,
your own score shows counts and no buttons, the Home notice (once; the first time is silent), and a group still on the old rules (kudos hidden, one line, nothing else affected).
390x844, sample data. Run: python3 tests/e2e_kudos.py"""
import http.server, threading, functools, sys, os, json
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
FAKE = open(os.path.join(HERE, 'fake_firebase.js')).read()
def glue(opts): return """(() => { window.__fb = makeFakeFirebase(%s); const real = window.fetch.bind(window);
  window.fetch = (u, i) => /googleapis\\.com/.test(String(u)) ? window.__fb.fetch(String(u), i) : real(u, i);
  try { for (const [p, o] of JSON.parse(sessionStorage.getItem('fbseed') || '[]')) window.__fb.put(p, o); } catch (e) {} })();""" % json.dumps(opts)
AUDIT = """(sel) => { const bad = [];
  for (const el of document.querySelectorAll(sel + ' button')) { const r = el.getBoundingClientRect(); if (r.height && (r.height < 38 || r.width < 38)) bad.push((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)); }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: bad }; }"""
SEED = """async () => {
  const B = await import('./bench.js'), LG = await import('./league.js'), S = await import('./store.js'), st = window.__golfiq.state;
  st.cloud = { apiKey: 'k', projectId: 'p', group: 'grp1', groupName: 'Mates', nick: 'Wills', auth: { idToken: 'tok-x', refreshToken: 'ref-x', uid: 'uid-1', exp: Date.now() + 30 * 864e5 } }; await S.saveCloud(st);
  const week = B.isoWeek(), today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sc = (uid, nick, game, name, score, extra = {}) => ({ uid, nick, game, game_name: name, better: 'higher', score, level_h: 10, date: today, week, month: today.slice(0, 7), ...extra });
  const docs = [['groups/grp1', { name: 'Mates', owner: 'uid-sam' }], ['groups/grp1/members/uid-sam', { nick: 'Sam' }], ['groups/grp1/members/uid-kim', { nick: 'Kim' }], ['groups/grp1/members/uid-1', { nick: 'Wills' }],
    ['groups/grp1/scores/a1', sc('uid-sam', 'Sam', 'chip-zone', 'Chip zone', 5, { hit: true })], ['groups/grp1/scores/a2', sc('uid-kim', 'Kim', 'putt-369', 'Putt 369', 4, { hit: false })],
    ['groups/grp1/scores/m1', sc('uid-1', 'Wills', 'chip-updown', 'Up & down', 9, { hit: true })]];
  sessionStorage.setItem('fbseed', JSON.stringify(docs)); return week;
}"""
def addseed(pg, docs): pg.evaluate("(d) => { const s = JSON.parse(sessionStorage.getItem('fbseed')); s.push(...d); sessionStorage.setItem('fbseed', JSON.stringify(s)); }", docs)
def fresh(b, opts):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.add_init_script(FAKE); pg.add_init_script(glue(opts)); pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    week = pg.evaluate(SEED); return ctx, pg, errs, week
def board(pg):
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'board'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('#lbRecent .lb', timeout=8000); pg.wait_for_timeout(600)
def kd(pg): return pg.evaluate("() => window.__fb.read('groups/grp1/kudos')")
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------------------------------------------------------- new rules
    ctx, pg, errs, week = fresh(b, {})
    board(pg)
    check('the recent-scores list shows the group scores', 'Friends' in pg.inner_text('body') and pg.query_selector('#lbRecent [data-kuscore="a1"]') is not None, pg.inner_text('#lbRecent')[:200])
    check('friends rows have Clap, Fire and Flag buttons', len(pg.query_selector_all('#lbRecent [data-kuscore="a1"] .ku-b')) == 3)
    check('they also appear on the weekly league and on the leaderboard', pg.query_selector('#lbLeague [data-kuscore="a1"] .ku-b') is not None and pg.query_selector('#lbWeek .ku-b') is not None or pg.query_selector('#lbLeague .ku-b') is not None)
    check('your own score has no buttons', pg.query_selector('#lbRecent [data-kuscore="m1"] .ku-b') is None)
    a = pg.evaluate(AUDIT, '.lb'); check('buttons are 38px or more and nothing overflows at 390 wide', not a['overflow'] and not a['small'], a); pg.screenshot(path='/tmp/kudos_board.png', full_page=True)
    pg.click('#lbRecent [data-ku="a1|clap"]'); pg.wait_for_timeout(500)
    k = kd(pg); check('giving a Clap writes one small document', len(k) == 1 and k[0]['kind'] == 'clap' and k[0]['to_uid'] == 'uid-sam' and k[0]['from_nick'] == 'Wills' and k[0]['score_id'] == 'a1' and k[0]['week'] == week and len(k[0]) <= 8, k)
    check('the button shows as given everywhere that score appears', all('on' in (e.get_attribute('class') or '') for e in pg.query_selector_all('[data-ku="a1|clap"]')) and len(pg.query_selector_all('[data-ku="a1|clap"].on')) >= 1)
    pg.click('#lbRecent [data-ku="a1|clap"]'); pg.wait_for_timeout(500); check('tapping again takes it back', len(kd(pg)) == 0 and pg.query_selector('[data-ku="a1|clap"].on') is None)
    pg.click('#lbRecent [data-ku="a1|fire"]'); pg.wait_for_timeout(400); pg.click('#lbRecent [data-ku="a1|flag"]'); pg.wait_for_timeout(600)
    k = kd(pg); check('choosing another kind replaces it (one reaction per person per score)', len(k) == 1 and k[0]['kind'] == 'flag', k)
    pg.click('#lbRecent [data-ku="a2|fire"]'); pg.wait_for_timeout(500); check('a different score gets its own reaction', len(kd(pg)) == 2)
    # reactions from others show as counts, on your own score without buttons
    addseed(pg, [['groups/grp1/kudos/m1_uid-sam', {'score_id': 'm1', 'to_uid': 'uid-1', 'from_uid': 'uid-sam', 'from_nick': 'Sam', 'kind': 'clap', 'at': '2030-01-01T00:00:00.000Z', 'week': week}],
                 ['groups/grp1/kudos/m1_uid-kim', {'score_id': 'm1', 'to_uid': 'uid-1', 'from_uid': 'uid-kim', 'from_nick': 'Kim', 'kind': 'fire', 'at': '2030-01-01T00:00:01.000Z', 'week': week}],
                 ['groups/grp1/kudos/a1_uid-kim', {'score_id': 'a1', 'to_uid': 'uid-sam', 'from_uid': 'uid-kim', 'from_nick': 'Kim', 'kind': 'clap', 'at': '2030-01-01T00:00:02.000Z', 'week': week}]])
    pg.reload(); pg.wait_for_selector('#lbRecent .lb'); pg.wait_for_timeout(800)
    check('your own score shows the counts only', len(pg.query_selector_all('#lbRecent [data-kuscore="m1"] .ku-c')) == 2 and pg.query_selector('#lbRecent [data-kuscore="m1"] .ku-b') is None, pg.inner_html('#lbRecent [data-kuscore="m1"]')[:200])
    check('a friend\'s score shows others\' counts on the buttons', 'on' not in (pg.get_attribute('#lbRecent [data-ku="a1|clap"]', 'class') or '').split() and pg.inner_text('#lbRecent [data-ku="a1|clap"]').strip() == '1')
    check('no old-rules message with the new rules', pg.inner_text('#kuMsg').strip() == '')
    check('no page errors on the board', not errs, errs[:3])
    # ---------------------------------------------------------------- Home notice: the first time is silent, then it shows once
    pg.evaluate("() => { const j = window.__golfiq.state.journal; delete j.kudos_seen; }")
    pg.goto(URL + '#home'); pg.reload(); pg.wait_for_selector('#kuHome', state='attached'); pg.wait_for_timeout(1200)
    check('the first run takes what is already there as seen (no notice)', pg.query_selector('.ku-note') is None and pg.evaluate("() => !!window.__golfiq.state.journal.kudos_seen"))
    addseed(pg, [['groups/grp1/kudos/m1_uid-al', {'score_id': 'm1', 'to_uid': 'uid-1', 'from_uid': 'uid-al', 'from_nick': 'Al', 'kind': 'flag', 'at': '2031-01-01T00:00:00.000Z', 'week': week}]])
    pg.evaluate("() => { window.__feelLog = []; }")
    pg.reload(); pg.wait_for_selector('.ku-note', timeout=8000); txt = pg.inner_text('.ku-note')
    check('Home says who reacted to which score', 'reacted to your Up & down 9' in txt and 'Al' in txt, txt)
    check('it plays the good sound once', pg.evaluate("() => (window.__feelLog || []).filter((x) => x === 'good').length") == 1, pg.evaluate("() => window.__feelLog"))
    a = pg.evaluate(AUDIT, '.ku-note'); check('the notice fits and its button is big enough', not a['overflow'] and not a['small'], a); pg.screenshot(path='/tmp/kudos_home.png')
    pg.click('[data-kudismiss]'); check('it can be dismissed', pg.query_selector('.ku-note') is None)
    pg.reload(); pg.wait_for_selector('#kuHome', state='attached'); pg.wait_for_timeout(1200); check('and it does not come back', pg.query_selector('.ku-note') is None)
    check('no page errors on Home', not errs, errs[:3]); ctx.close()
    # ---------------------------------------------------------------- old rules
    ctx, pg, errs, week = fresh(b, {'rules': 'old'})
    board(pg)
    check('old rules: scores and the league still load', pg.query_selector('#lbLeague .lb') is not None and pg.query_selector('#lbRecent .lb') is not None and pg.query_selector('#lbWeek .lb') is not None)
    check('old rules: no kudos buttons anywhere', pg.query_selector('.ku-b') is None and pg.query_selector('.ku-c') is None)
    msg = pg.inner_text('#kuMsg'); check('old rules: one line says the group owner should republish the rules', 'republish' in msg and 'Settings' in msg, msg)
    pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('#kuHome', state='attached'); pg.wait_for_timeout(1000)
    check('old rules: Home is fine and shows no notice', pg.query_selector('.ku-note') is None)
    check('old rules: no page errors', not errs, errs[:3]); ctx.close()
    # ---------------------------------------------------------------- no group at all
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500); pg.evaluate("() => { location.hash = '#home'; }"); pg.reload(); pg.wait_for_selector('.lvchip')
    check('without a group nothing about kudos is drawn', pg.query_selector('#kuHome') is None and pg.query_selector('.ku-b') is None and not errs, errs[:3]); ctx.close()
    b.close()
print('\n%s' % ('ALL PASSED' if not fails else 'FAILED: ' + ', '.join(fails))); sys.exit(1 if fails else 0)
