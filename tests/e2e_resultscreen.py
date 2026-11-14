"""Browser test for the result screen (phase C): the reveal for a miss, a personal best, a new tier and a met target, the score counting up,
the tier badge, the rewards row, the finish sounds and confetti, reduced motion, a reload, leaving early, and the layout at 390x844 and 375x667.
Run: python3 tests/e2e_resultscreen.py  — headless Chromium cannot be heard, so sounds are checked through window.__feelLog (asked for) and __feelHeard (played)."""
import http.server, threading, functools, os, re, time, json
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

LOG = "() => window.__feelLog.slice()"
RESULT_SOUNDS = ['finish', 'win', 'pb', 'tier']
def settle(pg): pg.wait_for_function("() => !document.querySelector('#gpRoot[data-busy]')")
def play(pg, gid, pattern, **opts):
    """Plays a whole game with the given taps. Only the last tap runs at the real pace, so the result reveal is the real one."""
    pg.evaluate("([id, o]) => { window.__golfiq.state.journal.game_draft = null; window.__golfiq.guided.start(id, o); }", [gid, opts]); pg.wait_for_selector('#gpRoot.gp-full')
    m = re.search(r'Target ([\d.]+)', pg.inner_text('.gp-tgt')); global PLAYED; PLAYED = float(m.group(1)) if m else None
    pg.evaluate("() => { window.__feelDelay = 0; }")
    for v in pattern[:-1]: pg.click(f'[data-gp="{v}"]'); settle(pg)
    pg.evaluate("() => { delete window.__feelDelay; window.__feelLog = []; window.__feelHeard = []; }")
    pg.click(f'[data-gp="{pattern[-1]}"]'); pg.wait_for_selector('#gpRoot.gp-rv', timeout=4000)
PLAYED = None
def num(x): x = round(x * 10) / 10; return str(int(x)) if x == int(x) else f'{x:.1f}'
def short_of(score): return f'{num(PLAYED - score)} short of your target'
def reveal_done(pg): pg.wait_for_selector('#gpRoot[data-revealed]', timeout=6000)
def sounds(pg): return [e for e in pg.evaluate(LOG) if e in RESULT_SOUNDS + ['unlock']]
def txt(pg): return pg.inner_text('#gpRoot')
def done(pg): pg.evaluate("() => document.querySelector('[data-gpdone]')?.click()"); pg.wait_for_function("() => !document.querySelector('#gpRoot')")

CONTRAST = """() => { const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }, L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number), out = {};
  const host = document.createElement('div'); host.className = 'gp-hero'; host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none'; document.body.appendChild(host);
  for (const k of ['bronze', 'silver', 'gold', 'platinum']) for (const cls of ['gp-badge', 'tier']) {
    const e = document.createElement('span'); e.className = `${cls} ${k}`; e.textContent = k; host.appendChild(e); const cs = getComputedStyle(e);
    let bg = rgb(cs.backgroundColor); const m = /rgba\\(0, 0, 0, ([\\d.]+)\\)/.exec(cs.backgroundImage); if (m) bg = bg.map((x) => x * (1 - Number(m[1])));
    const a = L(bg), b = L(rgb(cs.color)); out[`${cls}.${k}`] = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; }
  host.remove(); return out; }"""
AUDIT = """() => { const r = (e) => e.getBoundingClientRect(), root = document.querySelector('#gpRoot'), vw = innerWidth, out = { overflow: document.documentElement.scrollWidth > vw + 1, issues: [] };
  const card = r(root); if (card.left < -1 || card.right > vw + 1) out.issues.push('card sticks out ' + [card.left, card.right]);
  for (const el of root.querySelectorAll('.gp-hero *, .gp-rw, .gp-rw *, .gp-rbody button')) { const k = r(el); if (k.width && (k.right > card.right + 1 || k.left < card.left - 1)) out.issues.push((el.className || el.tagName) + ' outside the card'); if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline' && el.tagName !== 'CANVAS') out.issues.push((el.className || el.tagName) + ' clipped'); }
  for (const b of root.querySelectorAll('button')) { const k = r(b); if (k.height < 38 || k.width < 38) out.issues.push('small tap target ' + Math.round(k.width) + 'x' + Math.round(k.height)); }
  const h = r(root.querySelector('.gp-hero')); if (h.width < card.width - 2) out.issues.push('hero is not full width');
  return out; }"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ctx.add_init_script('window.__feelTest = true')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    tgt = pg.evaluate("() => window.__golfiq.guided.info('putt-369').target")
    check('setup: putt-369 has a target to measure against and no earlier results', tgt is not None and 5 < tgt < 6 and pg.evaluate("() => window.__golfiq.state.journal.results.filter((r) => r.game === 'putt-369').length") == 0, tgt)

    # ---- 1. a miss: the first play, 3 of 9, target 5.6
    play(pg, 'putt-369', [1, 1, 1, 0, 0, 0, 0, 0, 0]); t0 = time.time()
    check('the result opens as a green hero with the game name, the verdict and the score', pg.evaluate("() => !!document.querySelector('.gp-rv .gp-hero') && getComputedStyle(document.querySelector('.gp-hero')).backgroundImage.includes('gradient')") and 'LADDER' in txt(pg).upper())
    check('verdict says how far short of the target the golfer was shown, in plain words', PLAYED == 5.6 and pg.inner_text('#gpVerdictL').strip() == short_of(3), (PLAYED, pg.inner_text('#gpVerdictL')))
    check('the score starts at 0 and the reveal is not finished yet', pg.inner_text('#gpRNum') in ('0', '1') and pg.query_selector('#gpRoot[data-revealed]') is None, pg.inner_text('#gpRNum'))
    check('the elements rise in one after another', pg.evaluate("() => document.querySelectorAll('.gp-rv .fx-rise').length") >= 6)
    reveal_done(pg); dt = time.time() - t0
    check('the score has counted up to 3 and the reveal takes about two seconds', pg.inner_text('#gpRNum') == '3' and 1.2 < dt < 3.0, (pg.inner_text('#gpRNum'), dt))
    check('a miss gets the plain finish sound and no confetti', sounds(pg) == ['finish'] and 'confetti' not in pg.evaluate(LOG) and 'confetti:skipped' not in pg.evaluate(LOG), pg.evaluate(LOG))
    check('the handicap level sits under the score', re.search(r"That's (a scratch score or better|a \d+-handicap score|worse than a 25-handicap score)", txt(pg)) is not None, txt(pg)[:200])
    check('no tier yet, so the next one is named instead of a badge', pg.query_selector('.gp-badge') is None and 'Next: Bronze at 5+' in txt(pg), txt(pg)[:300])
    check('the buttons come in the plan\'s order: Play again, Next game, Done', pg.evaluate("() => [...document.querySelectorAll('.gp-rbtn button')].map((b) => b.textContent.trim())") == ['Play again', 'Next game', 'Done'])
    check('a toast shows near the top of the result screen, not over the buttons', pg.evaluate("() => { const t = document.querySelector('#toast'), d = t.style.display; t.style.display = 'block'; const r = t.getBoundingClientRect(); t.style.display = d; return r.top < 200 && r.bottom < innerHeight / 3; }"))
    done(pg)

    # ---- 2. a personal best that is still short of the target: 4 of 9
    play(pg, 'putt-369', [1, 1, 1, 1, 0, 0, 0, 0, 0]); reveal_done(pg)
    check('a personal best says so, and still says how far short of the target it was', 4 < PLAYED and pg.inner_text('#gpVerdictL').strip() == 'New personal best' and pg.inner_text('.gp-rsub').strip() == short_of(4), (PLAYED, pg.inner_text('#gpVerdictL'), pg.query_selector('.gp-rsub') and pg.inner_text('.gp-rsub')))
    check('personal best: the pb sound and confetti', sounds(pg) == ['pb'] and 'confetti' in pg.evaluate(LOG), pg.evaluate(LOG))
    check('the verdict is gold for a personal best', pg.evaluate("() => getComputedStyle(document.querySelector('#gpVerdictL')).color") == pg.evaluate("() => { const e = document.createElement('i'); e.style.color = 'var(--flag)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; }"))
    done(pg)

    # ---- 3. a personal best that meets the target and earns a tier: 6 of 9
    play(pg, 'putt-369', [1, 1, 1, 1, 1, 1, 0, 0, 0]); reveal_done(pg)
    tier_txt = pg.inner_text('#gpBadge') if pg.query_selector('#gpBadge') else ''
    check('a new tier is stamped as a badge with its name', re.fullmatch(r'New tier: (Bronze|Silver|Gold|Platinum)', tier_txt.strip()) is not None, tier_txt)
    check('personal best that also meets the target says both', PLAYED <= 6 and pg.inner_text('#gpVerdictL').strip() == 'New personal best' and pg.inner_text('.gp-rsub').strip() == 'Target met', (PLAYED, pg.inner_text('#gpVerdictL')))
    check('a new tier plays the tier sound (not also the personal best one) with confetti', sounds(pg) == ['tier'] and 'confetti' in pg.evaluate(LOG), pg.evaluate(LOG))
    check('the next tier and its score sit under the badge', re.search(r'Next: (Silver|Gold|Platinum) at \d+\+', txt(pg)) is not None, txt(pg)[:300])
    check('the badge lands after the score has counted up (it is stamped in late)', pg.evaluate("() => parseFloat(getComputedStyle(document.querySelector('#gpBadge')).getPropertyValue('--d')) > 0 || document.querySelector('#gpBadge').style.getPropertyValue('--d') !== ''"))
    done(pg)

    # ---- 4. the target met again: not a personal best (equal), not a new tier
    play(pg, 'putt-369', [1, 1, 1, 1, 1, 1, 0, 0, 0]); reveal_done(pg)
    check('meeting the target again says "Target met" and shows the tier as held, not new', PLAYED <= 6 and pg.inner_text('#gpVerdictL').strip() == 'Target met' and re.fullmatch(r'(Bronze|Silver|Gold|Platinum) tier', pg.inner_text('#gpBadge').strip()) is not None, (pg.inner_text('#gpVerdictL'), pg.inner_text('#gpBadge')))
    check('a met target plays the win sound with confetti', sounds(pg) == ['win'] and 'confetti' in pg.evaluate(LOG), pg.evaluate(LOG))
    check('a heard sound matches the one asked for', pg.evaluate("() => window.__feelHeard.includes('win')"))
    check('a tie with the best is not a personal best, and the best before is shown as context', 'Your best before was 6.' in txt(pg), txt(pg)[-300:])
    done(pg)

    # ---- 5. a miss after good games: 2 of 9
    play(pg, 'putt-369', [1, 1, 0, 0, 0, 0, 0, 0, 0]); reveal_done(pg)
    check('a miss after a good run: how far short, "Your best before was 6", finish sound only', pg.inner_text('#gpVerdictL').strip() == short_of(2) and 'Your best before was 6.' in txt(pg) and sounds(pg) == ['finish'], (pg.inner_text('#gpVerdictL'), sounds(pg)))

    # ---- 6. reload: the finished screen comes back without a second reveal
    pg.reload(); pg.wait_for_selector('#gpRoot.gp-rv'); pg.evaluate("() => { window.__feelLog = []; }"); pg.wait_for_timeout(1500)
    check('after a reload the result is there at once, with the final score and no new sounds or confetti', pg.inner_text('#gpRNum') == '2' and pg.evaluate(LOG) == [] and pg.query_selector('.gp-rv .fx-rise') is None and pg.query_selector('#gpRoot[data-reveal]') is None, (pg.inner_text('#gpRNum'), pg.evaluate(LOG)))
    done(pg)

    # ---- 7. a focus-area game: potential credit with the number counting down, the unlock sound, the target wording
    info = pg.evaluate("() => window.__golfiq.guided.info('chip-updown')"); led = info['ledger']
    check('setup: Up and down is a focus-area game with a ledger', led and led['need'] == 3 and led['hits'] == 0, led)
    play(pg, 'chip-updown', [1] * 9)
    first = pg.inner_text('#gpRPot') if pg.query_selector('#gpRPot') else ''
    reveal_done(pg)
    pot = pg.evaluate("() => { const e = document.querySelector('#gpRPot'); return e && [e.dataset.from, e.dataset.to, e.textContent]; }")
    check('the potential chip says "Hit 1 of 3" and shows the old target struck through, with the new one', 'Hit 1 of 3' in txt(pg) and pot and float(pot[0]) > float(pot[1]) and pot[2] == f"{float(pot[1]):.1f}" and pg.query_selector('.gp-rw s') is not None, (txt(pg)[:400], pot))
    check('the potential number started at the old value and counted down', first and abs(float(first) - float(pot[0])) < 0.05, (first, pot))
    check('potential is called a target, not a promise', 'target to play for, not a promise' in txt(pg))
    check('a hit that lowers potential plays the unlock sound after the finish sound', sounds(pg)[-1] == 'unlock' and sounds(pg)[0] in ('win', 'pb', 'tier'), sounds(pg))
    st = pg.evaluate("() => { const e = document.querySelector('#gpRStreak'); return e && [Number(e.dataset.from), Number(e.dataset.to), e.textContent]; }")
    check('practice streak chip: weeks in a row, counted from where it was to where it is', st and st[1] >= 1 and st[0] <= st[1] and st[2] == str(st[1]) and 'week' in pg.inner_text('#gpRStreakBox'), st)
    done(pg)
    play(pg, 'chip-updown', [0] * 9); reveal_done(pg)
    check('a miss in a focus game: "Not a hit yet", how far to go, no potential change, no unlock sound', 'Not a hit yet' in txt(pg) and 'Aim for 2.4+ to count towards Up and down' in txt(pg) and pg.query_selector('#gpRPot') is None and 'unlock' not in sounds(pg), (txt(pg)[:300], sounds(pg)))
    done(pg)

    # ---- 8. sound off: the screen still reveals, nothing is played
    pg.evaluate("async () => { const st = window.__golfiq.state.settings; st.feel = { ...(st.feel || {}), sound: false }; (await import('./feel.js')).init(st); }")
    play(pg, 'putt-369', [1] * 9); reveal_done(pg)
    check('with sound off the reveal still runs but nothing is heard', pg.evaluate("() => window.__feelHeard.length") == 0 and 'confetti' in pg.evaluate(LOG) and len(sounds(pg)) >= 1, (pg.evaluate(LOG), pg.evaluate("() => window.__feelHeard")))
    pg.evaluate("async () => { const st = window.__golfiq.state.settings; st.feel = { ...(st.feel || {}), sound: true }; (await import('./feel.js')).init(st); }")
    done(pg)

    # ---- 9. leaving early: no sound or confetti arrives after the screen has gone
    play(pg, 'putt-369', [1] * 9); pg.evaluate("() => { window.__feelLog = []; }")
    pg.evaluate("() => document.querySelector('[data-gpagain]').click()"); pg.wait_for_selector('#gpRoot.gp-full'); pg.wait_for_timeout(2200)
    check('tapping Play again straight away cancels the rest of the reveal', all(e not in pg.evaluate(LOG) for e in RESULT_SOUNDS + ['unlock', 'confetti']), pg.evaluate(LOG))
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }"); pg.reload(); pg.wait_for_selector('#loadSample, .tabbar, nav', state='attached'); pg.wait_for_timeout(800)

    # ---- 10. layout and colour
    cr = pg.evaluate(CONTRAST)
    check('tier colours: text on every badge and tier chip is at least 4.5:1', all(v >= 4.5 for v in cr.values()), cr)
    for (w, h) in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': w, 'height': h}); bad = {}
        for gid, pat in [('putt-369', [1] * 9), ('chip-updown', [1] * 9), ('putt-par18', [2] * 9), ('range-round', [1] * 18)]:
            play(pg, gid, pat); reveal_done(pg); a = pg.evaluate(AUDIT)
            if a['overflow'] or a['issues']: bad[gid] = a
            done(pg)
        check(f'{w}x{h}: result screens (hero, badge, rewards, buttons) have no horizontal overflow, nothing clipped, taps at least 38px', not bad, json.dumps(bad)[:700])
        play(pg, 'chip-updown', [1] * 9); reveal_done(pg)
        check(f'{w}x{h}: the Done button can be reached by scrolling', pg.evaluate("() => { window.scrollTo(0, document.documentElement.scrollHeight); const b = document.querySelector('[data-gpdone]'), r = b.getBoundingClientRect(), nav = document.querySelector('nav, .tabbar, #tabs').getBoundingClientRect(); return r.bottom <= nav.top + 1 && r.top >= 0; }"))
        done(pg)
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.screenshot(path='/tmp/result_final.png')
    check('no page errors in the whole run', not errs, errs)
    ctx.close()

    # ---- 11. reduced motion: everything is there at once, only sound is left
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block', reduced_motion='reduce')
    ctx.add_init_script('window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    play(pg, 'putt-369', [1] * 9)
    check('reduced motion: the score is shown at once, not counted up', pg.inner_text('#gpRNum') == '9', pg.inner_text('#gpRNum'))
    reveal_done(pg)
    check('reduced motion: no confetti, but the sound for the result still plays', 'confetti:skipped' in pg.evaluate(LOG) and 'confetti' not in pg.evaluate(LOG) and len(sounds(pg)) >= 1, pg.evaluate(LOG))
    check('reduced motion: the rise and the stamp become a short fade', pg.evaluate("() => { const e = document.querySelector('.gp-rv .fx-rise'), s = document.querySelector('#gpBadge'); return getComputedStyle(e).animationName === 'fx-fade' && getComputedStyle(s).animationName === 'fx-fade'; }"))
    check('reduced motion: no page errors', not errs, errs)
    ctx.close(); b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed')
raise SystemExit(1 if fails else 0)
