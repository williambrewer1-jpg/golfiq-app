"""Browser test for the Level-up skill tiles (phase 2). Run: python3 tests/e2e_levelup.py
Serves the repo on localhost, loads the demo data at a 390x844 phone viewport and checks the tiles, the drill-down, the game buttons and the layout."""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
H = functools.partial(Quiet, directory=ROOT)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(name, ok, extra=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  {extra}' if extra and not ok else '')); 
    if not ok: fails.append(name)

AUDIT = """() => { const out = {overflow: document.documentElement.scrollWidth > innerWidth + 1, small: [], inputs: []};
  const scope = document.querySelector('#levelUp') || document;      // tap targets: only this card (older buttons on the page are 36px, unchanged)
  for (const el of scope.querySelectorAll('button, a.btn, .skill-tile')) { const r = el.getBoundingClientRect(); if (r.width && r.height && el.offsetParent && r.height < 38 && !el.closest('.seg')) out.small.push((el.textContent || '').trim().slice(0, 30) + ' ' + Math.round(r.height)); }
  for (const el of document.querySelectorAll('input, select, textarea')) if (el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16) out.inputs.push(el.name || el.tagName); return out; }"""

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())          # no network in CI: the charts are not under test
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    pg.evaluate("() => { localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'focus'})); }"); pg.goto(f'http://127.0.0.1:{port}/index.html#practice'); pg.reload(); pg.wait_for_selector('#levelUp', timeout=15000)
    tiles = pg.query_selector_all('.skill-tile')
    check('Focus tab shows four skill tiles', len(tiles) == 4, len(tiles))
    names = [t.query_selector('.st-top b').inner_text() for t in tiles]
    check('tiles are Putting, Short game, Approach, Driving', names == ['Putting', 'Short game', 'Approach', 'Driving'], names)
    check('exactly two Focus tags', len(pg.query_selector_all('.skill-tile .tag')) == 2)
    check('each tile has a handicap and a target arrow', all('→' in t.query_selector('.st-go').inner_text() for t in tiles))
    check('old gap list is gone', pg.query_selector('.lvl') is None and 'play like a' not in pg.inner_text('body'))
    check('Quick wins still shown below', 'Quick wins' in pg.inner_text('body'))
    a = pg.evaluate(AUDIT); check('no horizontal overflow (Focus)', not a['overflow']); check('tap targets >= 38px (Focus)', not a['small'], a['small']); check('inputs >= 16px (Focus)', not a['inputs'], a['inputs'])
    # drill down
    pg.click('.skill-tile[data-skill=approach]'); pg.wait_for_selector('.skill-detail')
    rows = pg.query_selector_all('.skill-detail .lvl')
    check('Approach shows four sub-skills', len(rows) == 4, len(rows))
    txt = pg.inner_text('.skill-detail'); check('sub-skill rows show your number and the target level', 'You' in txt and 'handicap' in txt)
    check('strokes value and sample size shown', 'shots a round' in txt and 'From ' in txt)
    check('game buttons are real buttons', len(pg.query_selector_all('.skill-detail button[data-record], .skill-detail button[data-prtab]')) >= 3)
    check('game buttons carry the target score', any('score' in x.inner_text() for x in pg.query_selector_all('.skill-detail .gbtn')))
    a = pg.evaluate(AUDIT); check('no horizontal overflow (drill-down)', not a['overflow']); check('tap targets >= 38px (drill-down)', not a['small'], a['small'])
    # tap again closes
    pg.click('.skill-tile[data-skill=approach]'); check('tapping the tile again closes it', pg.query_selector('.skill-detail') is None)
    # a game button lands on Games with the game selected
    pg.click('.skill-tile[data-skill=short]'); pg.wait_for_selector('.skill-detail')
    btn = pg.query_selector('.skill-detail button[data-record=chip-updown]'); check('Up & down game button present', btn is not None)
    label = btn.inner_text(); check('button label has game and target score', 'score' in label and 'Up' in label, label)
    btn.click(); pg.wait_for_selector('#gpRoot .gp-prompt')                  # since phase 4 a game button starts guided play directly
    check('game button starts guided play for that game', pg.evaluate("() => window.__golfiq.state.journal.game_draft?.game") == 'chip-updown')
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")        # leave no draft behind for the steps below
    # combine button opens its own tab
    pg.evaluate("() => { const u = JSON.parse(localStorage.getItem('golfiq-ui')); u.pr_tab = 'focus'; localStorage.setItem('golfiq-ui', JSON.stringify(u)); }"); pg.reload(); pg.wait_for_selector('#levelUp')
    pg.click('.skill-tile[data-skill=approach]'); pg.click('.skill-detail button[data-prtab=combine]'); pg.wait_for_timeout(300)
    check('combine button opens the Combine tab', pg.evaluate("() => JSON.parse(localStorage.getItem('golfiq-ui')).pr_tab") == 'combine')
    # pin a focus area
    pg.evaluate("() => { const u = JSON.parse(localStorage.getItem('golfiq-ui')); u.pr_tab = 'focus'; u.lv_skill = 'driving'; localStorage.setItem('golfiq-ui', JSON.stringify(u)); }"); pg.reload(); pg.wait_for_selector('.skill-detail')
    pg.click('[data-pin=driving]'); pg.wait_for_timeout(500)
    check('pinning makes Driving a focus area', 'focus' in pg.inner_text('.skill-tile[data-skill=driving]').lower())
    dd = pg.inner_text('.skill-detail')
    check('Driving drill-down: distance has a strokes value (no longer "for context")', 'for context' not in dd and 'Distance' in dd, dd[:300])
    gb = [x.inner_text() for x in pg.query_selector_all('.skill-detail .gbtn')]
    check('Driving drill-down offers the Driver test and Max out', any('Driver test' in x for x in gb) and any('Max out' in x for x in gb), gb)
    # Progress page: tiles below the hero
    pg.evaluate("() => { const u = JSON.parse(localStorage.getItem('golfiq-ui')); u.pr_tab = 'progress'; u.lv_skill = null; localStorage.setItem('golfiq-ui', JSON.stringify(u)); }"); pg.reload(); pg.wait_for_selector('#levelUp')
    order = pg.evaluate("() => [...document.querySelectorAll('.prog-hero, #levelUp')].map(e => e.id || e.className)")
    check('Progress shows the tiles below the hero', order[0].endswith('prog-hero') and order[1] == 'levelUp', order)
    a = pg.evaluate(AUDIT); check('no horizontal overflow (Progress)', not a['overflow']); check('tap targets >= 38px (Progress)', not a['small'], a['small'])
    pg.screenshot(path='/tmp/levelup_progress.png', full_page=False)
    # Badges header: "X of Y" counts the game tier badges still to win (four per benchmark game, three per own-history game), not just the earned ones
    hdr = pg.inner_text('.card:has(.badges) h2'); import re
    m = re.search(r'(\d+) of (\d+)', hdr); got, total = (int(m.group(1)), int(m.group(2))) if m else (None, None)
    shown = len(pg.query_selector_all('.badges .bdg')); on = len(pg.query_selector_all('.badges .bdg.on'))
    exp = pg.evaluate("() => { const v = window.__golfiq.progress.data(); return { total: v.bd_total, shown: v.bd.length }; }")
    tb = pg.evaluate("""async () => { const G = await import('./games.js'), F = await import('./features.js'); const v = window.__golfiq.progress.data();
      const base = v.bd.filter((b) => !String(b.id).startsWith('tier-')).length, all = G.tierBadges(F.DEFAULT_GAMES, [], 0.9144);
      return { tiers_total: v.bd_total - base, expect: all.length, own: all.filter((b) => /range-speed|range-round/.test(b.id)).length, bench: all.length - all.filter((b) => /range-speed|range-round/.test(b.id)).length }; }""")
    check('Badges header reads "X of Y" with X = badges lit on screen', m is not None and got == on, hdr)
    check('Y counts every badge that can be won, so it is larger than the number on show', total == exp['total'] and total > shown and total >= got, (hdr, exp, shown))
    check('Y includes every tier badge still to win: four per benchmark game, three per own-history game', tb['tiers_total'] == tb['expect'] and tb['own'] == 6 and tb['bench'] % 4 == 0, tb)
    check('no page errors', not errs, errs)
    b.close()
srv.shutdown()
print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
