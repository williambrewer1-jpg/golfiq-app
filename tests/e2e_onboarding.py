"""Browser test for the first-run intro (first-run plan, phase A1): a fresh app shows it, every way out lands in the right place and saves the right
things, a golfer with data never sees it, Replay works, and the layout holds at 390x844 and 320x568. Run: python3 tests/e2e_onboarding.py"""
import http.server, threading, functools, sys, os, json
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else ''))
    if not ok: fails.append(name)
# no horizontal overflow, inputs at least 16px, every button and input at least 38px tall
AUDIT = """() => { const r = document.querySelector('#obRoot'); if (!r) return null; const small = [], fonts = [];
  for (const el of r.querySelectorAll('button, input')) { const b = el.getBoundingClientRect(); if (b.height && b.height < 38) small.push((el.textContent || el.id).trim() + ':' + Math.round(b.height));
    if (el.tagName === 'INPUT' && parseFloat(getComputedStyle(el).fontSize) < 16) fonts.push(el.id); }
  const wide = [...r.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className || e.tagName).slice(0, 4);
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1 || r.scrollWidth > r.clientWidth + 1, wide, small, fonts }; }"""
def audit(pg, label):
    pg.wait_for_timeout(400)                               # the screen slides in (220 ms); measure where it settles
    a = pg.evaluate(AUDIT)
    check(f'layout {label}', a and not a['overflow'] and not a['small'] and not a['fonts'] and not a['wide'], a)
PROFILE = "() => window.__golfiq.state.settings.profile || null"
SETTINGS = "() => { const s = window.__golfiq.state.settings; return { profile: s.profile || null, units: s.units || null, handicaps: s.handicaps || [] }; }"
def fresh(b, w=390, h=844, reduced=False):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block', reduced_motion='reduce' if reduced else 'no-preference')
    ctx.add_init_script('window.__feelDelay = 0; window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#obRoot'); return ctx, pg, errs
def screen(pg): return pg.get_attribute('#obRoot', 'data-screen')
def nxt(pg): pg.click('[data-obnext]'); pg.wait_for_timeout(60)

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h) in [(390, 844), (320, 568)]:
        # ---------------------------------------------------------- a fresh app: the intro, its look, and the typed-handicap path
        ctx, pg, errs = fresh(b, w, h); tag = f'{w}x{h}'
        check(f'{tag}: a fresh app opens on the intro', screen(pg) == '0')
        check(f'{tag}: header and tab bar are hidden', not pg.is_visible('header') and not pg.is_visible('nav.bottom'))
        txt = pg.inner_text('#obRoot')
        check(f'{tag}: welcome wording uses BreakingPar, with Get started and both links', 'BreakingPar' in txt and 'GolfIQ' not in txt and 'Get started' in txt and 'Garmin rounds' in txt and 'demo data' in txt, txt)
        check(f'{tag}: four progress dots, Skip, no Back on the first screen', len(pg.query_selector_all('.ob-dots i')) == 4 and pg.query_selector('[data-obskip]') and not pg.query_selector('[data-obback]'))
        audit(pg, f'{tag} welcome')
        nxt(pg); check(f'{tag}: Get started opens About you, with Back', screen(pg) == '1' and pg.query_selector('[data-obback]') is not None)
        audit(pg, f'{tag} about you')
        pg.fill('#obName', 'Wills'); pg.fill('#obHcp', '99'); nxt(pg)
        check(f'{tag}: an impossible handicap is refused with a message', screen(pg) == '1' and pg.query_selector('#obErr') is not None)
        audit(pg, f'{tag} about you with an error')
        pg.fill('#obHcp', '12.3'); pg.click('[data-obunit="m"]'); nxt(pg)
        check(f'{tag}: Your goal', screen(pg) == '2')
        check(f'{tag}: the goal below a 12.3 is preselected (Break 80)', pg.get_attribute('[data-obgoal="break80"]', 'aria-pressed') == 'true')
        audit(pg, f'{tag} goal')
        pg.click('[data-obback]'); check(f'{tag}: Back returns to About you with the answers kept', screen(pg) == '1' and pg.input_value('#obName') == 'Wills' and pg.input_value('#obHcp') == '12.3')
        nxt(pg); pg.click('[data-obmonths="12"]'); pg.click('[data-obweek="3"]'); nxt(pg)
        check(f'{tag}: Ready', screen(pg) == '3' and 'about 6 minutes' in pg.inner_text('#obRoot'), pg.inner_text('#obRoot'))
        audit(pg, f'{tag} ready')
        pg.click('[data-oblook]'); pg.wait_for_timeout(300)
        st = pg.evaluate(SETTINGS)
        check(f'{tag}: "look around first" goes Home with the header back', pg.query_selector('#obRoot') is None and pg.evaluate('location.hash') == '#home' and pg.is_visible('header'))
        pr = st['profile'] or {}
        check(f'{tag}: profile saved (name, goal, months, per week, date)', pr.get('name') == 'Wills' and pr.get('goal', {}).get('key') == 'break80' and pr['goal'].get('months') == 12 and pr.get('per_week') == 3 and pr.get('onboarded_at') and 'level_choice' not in pr, pr)
        check(f'{tag}: the typed handicap is in the handicap history, dated today', len(st['handicaps']) == 1 and st['handicaps'][0]['handicap_index'] == 12.3 and st['handicaps'][0]['date'] == pr.get('onboarded_at'), st['handicaps'])
        check(f'{tag}: distance unit saved', st['units'] == 'm')
        pg.reload(); pg.wait_for_selector('#main'); pg.wait_for_timeout(400)
        check(f'{tag}: the intro does not come back after a reload', pg.query_selector('#obRoot') is None)
        pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({st_tab: 'friends'}))"); pg.goto(URL + '#settings'); pg.reload(); pg.wait_for_selector('#frSetup input[name=nick]')
        check(f'{tag}: the nickname pre-fills the Friends nickname', pg.input_value('#frSetup input[name=nick]') == 'Wills')
        check(f'{tag}: no errors', not errs, errs); ctx.close()

    # -------------------------------------------------------------- no handicap → level choice → play my first game
    ctx, pg, errs = fresh(b)
    nxt(pg); pg.click('[data-obnone]'); pg.wait_for_timeout(60)
    check('"I don\'t have one" shows four choices', len(pg.query_selector_all('[data-oblevel]')) == 4 and 'estimate' in pg.inner_text('#obRoot'))
    audit(pg, '390x844 level choices')
    pg.click('[data-oblevel="90s"]'); nxt(pg)
    check('usually in the 90s → Break 90 preselected', pg.get_attribute('[data-obgoal="break90"]', 'aria-pressed') == 'true')
    pg.click('[data-obgoal="enjoy"]'); check('"Just enjoy practising" has no date to pick', pg.query_selector('[data-obmonths]') is None)
    pg.click('[data-obgoal="break90"]'); nxt(pg); pg.click('[data-obplay]')
    pg.wait_for_selector('#gpRoot.gp-full .gp-prompt', timeout=6000)
    check('"Play my first game" starts the 3-6-9 ladder in guided play', pg.evaluate("() => window.__golfiq.state.journal.game_draft?.game") == 'putt-369')
    pr = pg.evaluate(PROFILE) or {}
    check('no handicap: the level choice is saved and no handicap is added', pr.get('level_choice') == '90s' and pr.get('goal', {}).get('key') == 'break90' and pg.evaluate("() => window.__golfiq.state.settings.handicaps.length") == 0, pr)
    check('no errors (no handicap path)', not errs, errs); ctx.close()

    # -------------------------------------------------------------- skip, from the third screen: only the date is stored
    ctx, pg, errs = fresh(b, reduced=True)
    nxt(pg); pg.fill('#obName', 'Sam'); pg.fill('#obHcp', '20'); nxt(pg); pg.click('[data-obskip]'); pg.wait_for_timeout(300)
    st = pg.evaluate(SETTINGS)
    check('Skip lands on Home', pg.query_selector('#obRoot') is None and pg.evaluate('location.hash') == '#home')
    check('Skip stores the date and nothing else', st['profile'] and list(st['profile'].keys()) == ['onboarded_at'] and st['handicaps'] == [] and st['units'] is None, st)
    pg.reload(); pg.wait_for_selector('#main'); pg.wait_for_timeout(300); check('skipped: not shown again', pg.query_selector('#obRoot') is None)
    check('no errors (skip, reduced motion)', not errs, errs); ctx.close()

    # -------------------------------------------------------------- the Garmin link
    ctx, pg, errs = fresh(b)
    pg.click('[data-obgarmin]'); pg.wait_for_timeout(300)
    check('"I have Garmin rounds" goes to Data & sync', pg.evaluate('location.hash') == '#data' and pg.query_selector('#obRoot') is None and 'Data' in pg.inner_text('#title'))
    check('…and marks the intro done', (pg.evaluate(PROFILE) or {}).get('onboarded_at') is not None)
    check('no errors (Garmin)', not errs, errs); ctx.close()

    # -------------------------------------------------------------- demo data, then Replay
    for (w, h) in [(390, 844), (320, 568)]:
        ctx, pg, errs = fresh(b, w, h); tag = f'{w}x{h}'
        pg.click('[data-obdemo]'); pg.wait_for_selector('.kpis', timeout=8000); pg.wait_for_timeout(500)
        check(f'{tag}: "Look around with demo data" loads the sample and goes Home', pg.query_selector('#obRoot') is None and pg.evaluate("() => window.__golfiq.ds.rounds.length") > 0)
        check(f'{tag}: …and marks the intro done', (pg.evaluate(PROFILE) or {}).get('onboarded_at') is not None)
        hc = len(pg.evaluate(SETTINGS)['handicaps'])
        pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({st_tab: 'general'}))"); pg.goto(URL + '#settings'); pg.reload(); pg.wait_for_selector('#introReplay')
        pg.click('#introReplay'); pg.wait_for_selector('#obRoot')
        check(f'{tag}: Replay shows the intro again', screen(pg) == '0')
        check(f'{tag}: a replay with data offers no demo data (it would replace their data)', pg.query_selector('[data-obdemo]') is None)
        audit(pg, f'{tag} replay welcome (sample data)')
        nxt(pg); audit(pg, f'{tag} replay about you (sample data)')
        check(f'{tag}: the replay fills in the current handicap', pg.input_value('#obHcp') != '')
        nxt(pg); audit(pg, f'{tag} replay goal (sample data)'); nxt(pg); audit(pg, f'{tag} replay ready (sample data)')
        pg.click('[data-oblook]'); pg.wait_for_timeout(300)
        check(f'{tag}: finishing a replay without changing the handicap adds no new entry', len(pg.evaluate(SETTINGS)['handicaps']) == hc)
        pg.goto(URL + '#settings'); pg.wait_for_selector('#introReplay'); before = pg.evaluate(PROFILE); pg.click('#introReplay'); pg.wait_for_selector('#obRoot'); pg.click('[data-obskip]'); pg.wait_for_timeout(300)
        check(f'{tag}: skipping a replay changes nothing and returns to Settings', pg.evaluate(PROFILE) == before and pg.evaluate('location.hash') == '#settings')
        check(f'{tag}: no errors (demo, replay)', not errs, errs); ctx.close()

    # -------------------------------------------------------------- a golfer who already has data never sees it, and is marked silently
    ctx, pg, errs = fresh(b)
    pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.journal.results = [{ id: 'r1', game: 'putt-369', date: '2026-11-01', score: 6, note: '' }]; await S.saveJournal(st); }""")
    pg.reload(); pg.wait_for_selector('#main'); pg.wait_for_timeout(500)
    check('existing practice results: no intro', pg.query_selector('#obRoot') is None)
    check('…and the golfer is marked as onboarded', (pg.evaluate(PROFILE) or {}).get('onboarded_at') is not None)
    ctx.close()
    ctx, pg, errs = fresh(b)
    pg.click('[data-obdemo]'); pg.wait_for_selector('.kpis', timeout=8000)
    pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state; delete st.settings.profile; await S.saveSettings(st, 'test', null, null); }""")
    pg.reload(); pg.wait_for_selector('.kpis'); pg.wait_for_timeout(400)
    check('saved data from before this update (rounds, no profile): no intro', pg.query_selector('#obRoot') is None)
    # the profile goes into a backup and comes back from it
    pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state; st.settings.profile = { onboarded_at: '2026-11-16', name: 'Wills', goal: { key: 'break90', months: 6, set_at: '2026-11-16' }, per_week: 2 }; await S.saveSettings(st, 'test', null, null); }""")
    restored = pg.evaluate("""async () => { const S = await import('./store.js'), st = window.__golfiq.state, b = JSON.parse(JSON.stringify(S.backupObject(st, { secrets: false })));
      await S.clearAll(); await S.restoreBackup(st, b); const again = await S.loadState(); return again.settings.profile; }""")
    check('the profile is saved in a backup and restored from it', restored and restored.get('name') == 'Wills' and restored.get('goal', {}).get('key') == 'break90', restored)
    check('no errors (existing data)', not errs, errs); ctx.close()
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
