"""Browser test for the friends ghost and weekly league (phase 8), against an in-page fake Firebase. Run: python3 tests/e2e_friends.py"""
import re, http.server, threading, functools, sys, os, json
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
GLUE = """
(() => { window.__fb = makeFakeFirebase(); const real = window.fetch.bind(window);
  window.fetch = (u, i) => /googleapis\\.com/.test(String(u)) ? window.__fb.fetch(String(u), i) : real(u, i);
  try { for (const [p, o] of JSON.parse(sessionStorage.getItem('fbseed') || '[]')) window.__fb.put(p, o); } catch (e) {} })();
"""
def play_hits(pg, hits):
    for h in hits: pg.click(f'[data-gp="{h}"]'); pg.wait_for_timeout(40)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block'); ctx.add_init_script('window.__feelDelay = 0'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.add_init_script(FAKE); pg.add_init_script(GLUE)
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    seed = pg.evaluate("""async () => {
      const B = await import('./bench.js'), LG = await import('./league.js'), S = await import('./store.js'), st = window.__golfiq.state;
      st.cloud = { apiKey: 'k', projectId: 'p', group: 'grp1', groupName: 'Mates', nick: 'Wills' }; await S.saveCloud(st);
      const week = B.isoWeek(), last = LG.prevWeek(week), today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const sc = (uid, nick, game, score, w, extra = {}) => ({ uid, nick, game, game_name: game, better: 'higher', score, level_h: 10, date: today, week: w, month: today.slice(0, 7), ...extra });
      const docs = [['groups/grp1', { name: 'Mates', owner: 'uid-sam' }], ['groups/grp1/members/uid-sam', { nick: 'Sam' }], ['groups/grp1/members/uid-kim', { nick: 'Kim' }],
        ['groups/grp1/scores/a1', sc('uid-sam', 'Sam', 'chip-zone', 5, week, { hit: true, tier: 'bronze', mode: 'guided', detail: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0], seed: 11 })],
        ['groups/grp1/scores/a2', sc('uid-kim', 'Kim', 'putt-369', 4, week, { hit: false })],
        ['groups/grp1/scores/l1', sc('uid-kim', 'Kim', 'putt-369', 8, last, { hit: true })], ['groups/grp1/scores/l2', sc('uid-kim', 'Kim', 'putt-lag', 8, last, { hit: true })], ['groups/grp1/scores/l3', sc('uid-kim', 'Kim', 'chip-updown', 8, last, { hit: true })],
        ['groups/grp1/scores/l4', sc('uid-sam', 'Sam', 'chip-zone', 6, last, { hit: false })]];
      sessionStorage.setItem('fbseed', JSON.stringify(docs)); return { week, last };
    }""")
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games', pg_game: 'chip-zone'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpstart]')
    pg.wait_for_selector('[data-gpghost]', timeout=5000)
    check("launcher offers to play against Sam's score", "Sam's 5" in pg.inner_text('#gpGhost'), pg.inner_text('#gpGhost'))
    pg.screenshot(path='/tmp/friends_launcher.png')
    pg.click('[data-gpghost="0"]'); pg.wait_for_selector('#gpRoot .gp-ghost')
    check('the game uses the friend\'s seed, so the steps are the same', pg.evaluate("() => window.__golfiq.state.journal.game_draft.seed") == 11)
    check("ghost line shows the score to beat", "Sam's 5 to beat" in pg.inner_text('.gp-ghost'), pg.inner_text('.gp-ghost'))
    play_hits(pg, [1, 1]); check('after two steps the ghost line says level', 'Sam had 2 after 2' in pg.inner_text('.gp-ghost') and 'level' in pg.inner_text('.gp-ghost'), pg.inner_text('.gp-ghost'))
    play_hits(pg, [0]); check('then Sam is ahead of you', 'Sam had 3 after 3' in pg.inner_text('.gp-ghost') and 'behind by 1' in pg.inner_text('.gp-ghost'), pg.inner_text('.gp-ghost'))
    pg.screenshot(path='/tmp/friends_ghost.png')
    play_hits(pg, [1, 1, 1, 1, 1, 1, 1])                                                          # finishes with 2+1+1... = 9 hits of 10
    pg.wait_for_selector('.gp-res')
    check('result says you beat Sam', 'You beat Sam' in pg.inner_text('.gp-res') and 'to 5' in pg.inner_text('.gp-res'), pg.inner_text('.gp-res'))
    try: pg.wait_for_selector('#gpRLeague:not([hidden])', timeout=6000)
    except Exception: pass
    lc = pg.inner_text('#gpRLeague') if pg.query_selector('#gpRLeague:not([hidden])') else ''
    check('the result shows the league points this score earned, once the shared scores have loaded', re.search(r'League\s*\+[1-5]', lc, re.I) is not None and 'of 3' in lc, lc)
    pg.wait_for_function("() => window.__fb.read('groups/grp1/scores').some(d => d.nick === 'Wills')", timeout=5000)
    mine = pg.evaluate("() => window.__fb.read('groups/grp1/scores').find(d => d.nick === 'Wills')")
    check('your guided score is posted with the per-step results', mine['mode'] == 'guided' and len(mine['detail']) == 10 and mine['seed'] == 11 and mine['score'] == 9, mine)
    check('the posted score carries a tier and whether you beat your target', mine['tier'] in ('bronze', 'silver', 'gold', 'platinum') and isinstance(mine['hit'], bool), mine)
    check('the score document stays within 20 fields', len(mine) <= 20, len(mine))
    allowed = {'game', 'game_name', 'better', 'score', 'level_h', 'date', 'week', 'month', 'nick', 'uid', 'course', 'hit', 'tier', 'mode', 'detail', 'seed', 'pressure'}
    check('only scores, tiers and per-step results are shared', set(mine) <= allowed, set(mine) - allowed)
    urls = pg.evaluate("() => window.__fb.log.map(l => l[1])"); check('only the Firebase hosts are called', all('googleapis.com' in u for u in urls))
    # pressure doc extras
    pg.click('[data-gpdone]'); pg.wait_for_selector('[data-gpstart]')
    check('no ghost button for a game no friend has played this week', (lambda: (pg.click('[data-pickgame="putt-par18"]'), pg.wait_for_timeout(500), pg.query_selector('[data-gpghost]') is None)[-1])())
    # league on the Board tab, with my score added to the seed
    pg.evaluate("(m) => { const s = JSON.parse(sessionStorage.getItem('fbseed')); s.push(['groups/grp1/scores/mine', m]); sessionStorage.setItem('fbseed', JSON.stringify(s)); }", mine)
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'board'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('#lbLeague .lb', timeout=5000)
    lg = pg.inner_text('#lbLeagueCard'); rows = pg.evaluate("() => [...document.querySelectorAll('#lbLeague .lb > div')].map(d => [d.querySelector('b').textContent, Number(d.querySelector('em').textContent), Number(d.querySelector('span').textContent)])")
    mypts = (3 if mine['hit'] else 1) + (1 if mine.get('pressure') else 0)
    check('league lists all three players with points', {r[0] for r in rows} == {'Sam', 'Kim', 'Wills'}, rows)
    check('Sam has 3 points, Kim 1: this week only', dict((r[0], r[1]) for r in rows).get('Sam') == 3 and dict((r[0], r[1]) for r in rows).get('Kim') == 1, rows)
    check('your points match the rule', dict((r[0], r[1]) for r in rows).get('Wills') == mypts, (rows, mypts))
    check('ranked by points', [r[1] for r in rows] == sorted([r[1] for r in rows], reverse=True) and rows[0][2] == 1, rows)
    check("last week's winner is shown (Kim, 9 points)", "Last week's winner" in lg and 'Kim' in lg and '9 points' in lg, lg)
    check('league rules are explained in plain words', '3 points for beating your own target' in lg)
    pg.screenshot(path='/tmp/friends_league.png')
    a = pg.evaluate("() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1 })"); check('no horizontal overflow', not a['overflow'])
    check('no page errors', not errs, errs); b.close()
srv.shutdown(); print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
