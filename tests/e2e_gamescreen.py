"""Browser test for the game screen (phase B): full-screen layout for every guided game, per-tap feedback and its timing, streak and target moments,
the pressure ball, undo, close, reduced motion and the layout audit at 390x844 and 375x667.
Run: python3 tests/e2e_gamescreen.py  — headless Chromium cannot be heard, so sounds are checked through window.__feelLog (requested) / __feelHeard (played)."""
import http.server, threading, functools, os, time, json
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

GAMES = ['putt-par18', 'putt-369', 'putt-lag', 'putt-streak', 'chip-updown', 'chip-par18', 'chip-zone', 'range-fairways', 'range-greens', 'range-wedge', 'range-driver', 'range-speed', 'range-round']
AUDIT = """() => { const r = (e) => e.getBoundingClientRect(), root = document.querySelector('#gpRoot'), vh = innerHeight, vw = innerWidth, out = { overflow: document.documentElement.scrollWidth > vw + 1, small: [], inputs: [], issues: [] };
  const vis = (e) => e && getComputedStyle(e).display !== 'none' && r(e).height > 0;
  const hdr = document.querySelector('header'), nav = document.querySelector('nav, .tabbar, #tabs'); if (vis(hdr)) out.issues.push('header showing'); if (vis(nav)) out.issues.push('tab bar showing');
  const q = r(root); if (Math.round(q.top) !== 0 || Math.round(q.height) !== vh || Math.round(q.width) !== vw) out.issues.push('not full screen ' + [q.top, q.width, q.height]);
  if (root.scrollHeight > root.clientHeight + 1) out.issues.push('scrolls ' + (root.scrollHeight - root.clientHeight));
  const b = root.querySelector('.gp-btns'), bq = r(b); if (bq.bottom > vh) out.issues.push('answer buttons cut off');
  for (const x of b.querySelectorAll('button')) { const k = r(x); if (k.height < 64) out.issues.push('answer button ' + Math.round(k.height) + 'px high'); if (k.top + k.height / 2 < vh * 2 / 3) out.issues.push('answer button not in the bottom third'); }
  const hs = [...b.querySelectorAll('button')].map((x) => Math.round(r(x).height)); if (new Set(hs).size > 1) out.issues.push('answer buttons differ in height ' + hs);
  for (const el of root.querySelectorAll('button, input[type=range], label.gp-prem')) { const k = r(el); if (k.width && (k.height < 38 || k.width < 38)) out.small.push([el.id || el.className, Math.round(k.width), Math.round(k.height)]); }
  for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=range])')) { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) out.inputs.push([el.id, fs]); }
  for (const el of root.querySelectorAll('.gp-top, .gp-strip, .gp-main, .gp-sheet')) { const k = r(el); if (k.right > vw + 1 || k.left < -1) out.issues.push(el.className + ' sticks out'); }
  const s = r(root.querySelector('.gp-strip')), m = r(root.querySelector('.gp-main')), sh = r(root.querySelector('.gp-sheet'));
  if (m.top < s.bottom - 1 || m.bottom > sh.top + 1) out.issues.push('prompt overlaps the strip or the buttons ' + [s.bottom, m.top, m.bottom, sh.top].map(Math.round));
  const pr = root.querySelector('.gp-prompt'); if (!pr || r(pr).height < 20) out.issues.push('no prompt');
  return out; }"""
SERIF = "() => { const p = document.createElement('i'); p.style.fontFamily = 'var(--serif)'; document.body.appendChild(p); const a = getComputedStyle(p).fontFamily, b = getComputedStyle(document.querySelector('#gpScore')).fontFamily; p.remove(); return [a, b]; }"
DOTS = "() => [...document.querySelectorAll('#gpRoot .gp-dots i')].map((e) => e.className)"
DRAFT = "() => { const d = window.__golfiq.state.journal.game_draft; return d ? { n: d.answers.length, a: d.answers, balls: (d.balls || []).length } : null; }"
LOG = "() => window.__feelLog.slice()"

def settle(pg): pg.wait_for_function("() => !document.querySelector('#gpRoot[data-busy]')")
def begin(pg, gid, **opts):
    pg.evaluate("([id, o]) => { window.__golfiq.state.journal.game_draft = null; window.__golfiq.guided.start(id, o); }", [gid, opts]); pg.wait_for_selector('#gpRoot.gp-full'); pg.wait_for_timeout(120)
def fast(pg, on):
    pg.evaluate("(on) => { if (on === true) window.__feelDelay = 0; else if (on) window.__feelDelay = on; else delete window.__feelDelay; }", on)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ctx.add_init_script('window.__feelTest = true')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)

    # ---- layout: every guided game, both phone sizes
    for (w, h) in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': w, 'height': h}); bad = {}
        for gid in GAMES:
            begin(pg, gid); a = pg.evaluate(AUDIT)
            if a['overflow'] or a['small'] or a['inputs'] or a['issues']: bad[gid] = a
        check(f'{w}x{h}: all {len(GAMES)} guided games are full screen, with no overflow, answer buttons at least 64px in the bottom third, taps at least 38px, inputs at least 16px', not bad, json.dumps(bad)[:900])
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")

    # ---- the screen itself
    begin(pg, 'putt-369')
    check('the header and tab bar are hidden while a game is open', pg.evaluate("() => ['header', 'nav, .tabbar, #tabs'].every((s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none'; })"))
    check('top bar: close, progress bar and sound toggle', all(pg.query_selector(s) for s in ['.gp-top [data-gpquit]', '.gp-top .gp-bar', '.gp-top #gpSound']))
    check('score strip: game name, running score, target line in plain words', pg.inner_text('.gp-name').strip() != '' and pg.inner_text('#gpScore') == '0' and 'Target' in pg.inner_text('.gp-tgt') and 'handicap' in pg.inner_text('.gp-tgt'), pg.inner_text('.gp-strip'))
    check('the running score is set in the serif face', (lambda f: f[0] == f[1])(pg.evaluate(SERIF)), pg.evaluate(SERIF))
    check('a streak counter is not shown before two in a row', pg.evaluate("() => document.querySelector('#gpStreak').hidden"))
    check('the shot art is an inline SVG', pg.evaluate("() => !!document.querySelector('.gp-art svg')"))
    check('good is a green button with a tick, a miss is a plain button with a cross', pg.evaluate("() => { const g = document.querySelector('[data-gp=\"1\"]'), m = document.querySelector('[data-gp=\"0\"]'); return !!g.querySelector('svg') && !!m.querySelector('svg') && getComputedStyle(g).backgroundColor !== getComputedStyle(m).backgroundColor && g.classList.contains('hit'); }"))
    check('Undo is there but disabled before the first ball', pg.evaluate("() => document.querySelector('[data-gpundo]').disabled"))
    check('progress bar starts empty', pg.evaluate("() => document.querySelector('#gpBar').style.getPropertyValue('--p') === '0'"))

    # ---- one tap, in real time (450 ms feedback window)
    pg.evaluate("() => { window.__feelLog = []; window.__feelHeard = []; }")
    t0 = time.time(); pg.click('[data-gp="1"]')
    v = pg.inner_text('#gpVerdict'); dt = time.time() - t0
    check('the verdict appears at once: "Holed"', 'Holed' in v and dt < 0.35, (v, dt))
    d = pg.evaluate(DRAFT); check('the answer is saved at the moment of the tap', d and d['n'] == 1 and d['a'] == [1], d)
    check('the ball dot turns gold, the next one is marked', pg.evaluate(DOTS)[:2] == ['hit', 'now'], pg.evaluate(DOTS))
    check('the score counts up to 1 and the bar moves', pg.wait_for_function("() => document.querySelector('#gpScore').textContent === '1'", timeout=2000) is not None and pg.evaluate("() => parseFloat(document.querySelector('#gpBar').style.getPropertyValue('--p')) > 0.1"))
    check('the button pops and the sheet is locked while the verdict shows', pg.evaluate("() => document.querySelector('#gpRoot').hasAttribute('data-busy') && document.querySelector('#gpSheet').classList.contains('gp-locked')") and 'tap' in pg.evaluate(LOG) and 'good' in pg.evaluate(LOG), pg.evaluate(LOG))
    pg.evaluate("() => { document.querySelector('[data-gp=\"1\"]')?.click(); document.querySelector('[data-gp=\"0\"]')?.click(); document.querySelector('[data-gpundo]')?.click(); }")
    pg.wait_for_timeout(60)
    check('taps during the feedback window are ignored (no double answer, no undo)', pg.evaluate(DRAFT)['n'] == 1, pg.evaluate(DRAFT))
    check('the next ball is not shown before the window is over', 'Ball 1 of 3' in pg.inner_text('.gp-sub'), pg.inner_text('.gp-sub'))
    pg.wait_for_function("() => document.querySelector('.gp-sub').textContent.includes('Ball 2 of 3')", timeout=2000); dt = time.time() - t0
    check('the next ball slides in after about 450 ms', 0.4 < dt < 1.2, dt)
    check('the new screen is unlocked, the verdict is cleared, and the step tick played', not pg.evaluate("() => document.querySelector('#gpRoot').hasAttribute('data-busy')") and pg.inner_text('#gpVerdict') == '' and 'step' in pg.evaluate(LOG), pg.evaluate(LOG))
    check('Undo is available again', not pg.evaluate("() => document.querySelector('[data-gpundo]').disabled"))
    check('what was heard matches what was asked for (sound is on by default)', pg.evaluate("() => window.__feelHeard.includes('good')"))

    # ---- a miss: shake, verdict, grey dot, no leak of the old .miss panel style
    pg.evaluate("() => { window.__feelLog = []; }"); pg.click('[data-gp="0"]')
    check('a miss says "Missed" and plays the miss sound', 'Missed' in pg.inner_text('#gpVerdict') and 'miss' in pg.evaluate(LOG), (pg.inner_text('#gpVerdict'), pg.evaluate(LOG)))
    st = pg.evaluate("() => { const dots = [...document.querySelectorAll('#gpRoot .gp-dots i')].slice(0, 3).map((e) => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.width), Math.round(r.height)]; }), v = getComputedStyle(document.querySelector('#gpVerdict')); return { dots, bg: v.backgroundColor, pad: v.padding }; }")
    check('dots: gold hit, grey miss, same size', [x[0] for x in st['dots']] == ['hit', 'miss', 'now'] and len({(x[1], x[2]) for x in st['dots']}) == 1 and st['dots'][0][1] == 11, st)
    check('the verdict has no panel background', st['bg'] == 'rgba(0, 0, 0, 0)' and st['pad'] == '0px', st)
    settle(pg)
    check('streak counter stays hidden after a miss', pg.evaluate("() => document.querySelector('#gpStreak').hidden"))

    # ---- undo takes the whole tap back: answer, dot, score
    pg.click('[data-gpundo]'); pg.wait_for_timeout(120)
    check('Undo removes the last ball and restores its prompt, dots and score', pg.evaluate(DRAFT)['n'] == 1 and 'Ball 2 of 3' in pg.inner_text('.gp-sub') and pg.evaluate(DOTS)[:2] == ['hit', 'now'] and pg.inner_text('#gpScore') == '1')

    # ---- streak and target moments (fast clock so the whole run is quick; the real-time path was tested above)
    begin(pg, 'putt-369'); fast(pg, True); pg.evaluate("() => { window.__feelLog = []; }")
    tg = float(pg.inner_text('.gp-tgt').split('Target ')[1].split(' ')[0]); need = int(-(-tg // 1))
    seen = []
    for k in range(1, need + 2):
        pg.click('[data-gp="1"]'); pg.wait_for_timeout(30)
        seen.append((k, pg.evaluate("() => [document.querySelector('#gpStreak').hidden, document.querySelector('#gpStreak b').textContent, document.querySelector('#gpBanner').hidden ? '' : document.querySelector('#gpBanner').textContent]")))
        settle(pg)
    byk = dict(seen); pg.wait_for_timeout(500)         # the milestone sounds land 330 ms after the verdict
    check('the streak flame shows from two in a row, with the count', byk[1][0] is True and byk[2][0] is False and byk[2][1] == '2' and byk[4][1] == '4', seen)
    check('3 in a row gets a banner and the streak sound', '3 in a row' in byk[3][2] and 'streak' in pg.evaluate(LOG), (byk[3], pg.evaluate(LOG)))
    check('5 in a row gets its banner', byk.get(5) and '5 in a row' in byk[5][2], byk.get(5))
    last = byk[need]
    check(f'passing the target ({tg}) says "Target reached" and plays the target sound once', 'Target reached' in last[2] and pg.evaluate(LOG).count('target') == 1, (last, pg.evaluate(LOG)))
    check('the ball after the target is not a second target moment (the sound is not repeated)', pg.evaluate(LOG).count('target') == 1 and pg.evaluate("() => window.__feelHeard.filter((e) => e === 'target').length") == 1, pg.evaluate(LOG))
    check('a milestone sound lands after the verdict and the plain step tick is skipped for that step', pg.evaluate(LOG).count('step') < need, pg.evaluate(LOG))
    fast(pg, False)
    OVERLAP = "() => { const r = (e) => e.getBoundingClientRect(), b = r(document.querySelector('#gpBanner')), hit = (q) => !(q.right <= b.left || q.left >= b.right || q.bottom <= b.top || q.top >= b.bottom); return { shown: !document.querySelector('#gpBanner').hidden, over: ['.gp-name', '#gpScore', '#gpScoreLbl', '.gp-streak', '.gp-tgt', '.gp-top', '.gp-dots'].filter((s) => hit(r(document.querySelector(s)))) , inside: b.left >= 0 && b.right <= innerWidth }; }"
    for (w, h) in [(390, 844), (375, 667)]:
        pg.set_viewport_size({'width': w, 'height': h}); begin(pg, 'chip-updown'); fast(pg, True)
        for k in range(3): pg.click('[data-gp="1"]'); pg.wait_for_timeout(30); settle(pg) if k < 2 else None
        o = pg.evaluate(OVERLAP); check(f'{w}x{h}: the milestone banner is a small pill that covers neither the score, the flame, the target line, the top bar nor the dots', o['shown'] and not o['over'] and o['inside'], o)
        pg.wait_for_timeout(1500); fast(pg, False)
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")

    # ---- strokes games and the distance games
    begin(pg, 'putt-par18'); fast(pg, 150)
    gb = pg.evaluate("() => [...document.querySelectorAll('[data-gp]')].map((e) => [e.dataset.gp, e.classList.contains('good')])")
    check('strokes game: 1 to 5+, par or better is highlighted', gb == [['1', True], ['2', True], ['3', False], ['4', False], ['5', False]], gb)
    words = []
    for v in ['1', '2', '3']:
        pg.click(f'[data-gp="{v}"]'); words.append(pg.inner_text('#gpVerdict').strip()); settle(pg)
    check('strokes verdicts: Birdie, Par, Bogey', words == ['Birdie', 'Par', 'Bogey'], words)
    begin(pg, 'range-driver'); fast(pg, 150); words = []
    for r in ['f', 'm', 'w']:
        pg.click(f'[data-gpball="{r}"]'); words.append(pg.inner_text('#gpVerdict').strip()); settle(pg)
    check('Driver test verdicts: Fairway, Missed, Wide', words == ['Fairway', 'Missed', 'Wide'], words)
    check('Driver test: the average shows a number after the first ball, not a dash', pg.inner_text('#gpScore') not in ('–', '-', '') and pg.evaluate("() => document.querySelector('#gpStreak').hidden"))
    begin(pg, 'range-speed'); fast(pg, 150); words = []
    for dist in ['240', '255', '250']:
        pg.fill('#gpDtype', dist); pg.click('[data-gpball="f"]'); words.append(pg.inner_text('#gpVerdict').strip()); settle(pg)
    check('Max out verdicts: Logged, Longest (a new longest), Logged', words == ['Logged', 'Longest', 'Logged'], words)
    fast(pg, False)

    # ---- pressure ball: only the last ball, gold border, slower heartbeat
    begin(pg, 'putt-369', pressure=True); fast(pg, True)
    check('no pressure styling before the last ball', pg.query_selector('.gp-pr') is None and pg.query_selector('.gp-pressure') is None)
    for k in range(8): pg.click('[data-gp="1"]'); settle(pg)
    check('last ball: pressure text and a pulsing, gold-bordered button', pg.query_selector('.gp-pressure') is not None and 'ressure' in pg.inner_text('.gp-pressure') and pg.evaluate("() => { const c = getComputedStyle(document.querySelector('.gp-pr .gp-b')); return c.animationName === 'fx-beat' && c.boxShadow.includes('rgb'); }"), pg.query_selector('.gp-pressure') and pg.inner_text('.gp-pressure'))
    fast(pg, False)
    # ---- the last tap: saved at once, the result follows after the verdict has been read
    n0 = pg.evaluate("() => window.__golfiq.state.journal.results.length"); pg.click('[data-gp="1"]'); t0 = time.time()
    ok = pg.wait_for_function("([n]) => window.__golfiq.state.journal.results.length === n + 1 && !window.__golfiq.state.journal.game_draft", arg=[n0], timeout=1500) is not None
    check('the last answer is committed at once (result saved, draft cleared) …', ok)
    check('… while the screen still shows the last verdict', pg.evaluate("() => !!document.querySelector('#gpRoot.gp-full') && document.querySelector('#gpVerdict').textContent.length > 0"))
    pg.wait_for_selector('#gpRoot.gp-res', timeout=3000); dt = time.time() - t0
    check('then the result screen appears after about 450 ms, with the header and tab bar back', dt < 1.0 and pg.evaluate("() => ['header'].every((s) => getComputedStyle(document.querySelector(s)).display !== 'none')"), dt)
    pg.evaluate("() => { document.querySelector('[data-gpdone]')?.click(); }")

    # ---- close asks first; leaving discards the game
    begin(pg, 'putt-369'); fast(pg, True); pg.click('[data-gp="1"]'); settle(pg)
    msgs = []
    pg.once('dialog', lambda d: (msgs.append(d.message), d.dismiss())); pg.click('[data-gpquit]'); pg.wait_for_timeout(150)
    check('close asks to confirm; "cancel" keeps the game', len(msgs) == 1 and 'Stop this game' in msgs[0] and pg.evaluate(DRAFT)['n'] == 1, msgs)
    n0 = pg.evaluate("() => window.__golfiq.state.journal.results.length")
    pg.once('dialog', lambda d: d.accept()); pg.click('[data-gpquit]'); pg.wait_for_timeout(300)
    check('confirming leaves the game, saves nothing and brings back the tab bar', pg.evaluate(DRAFT) is None and pg.evaluate("() => window.__golfiq.state.journal.results.length") == n0 and pg.query_selector('#gpRoot.gp-full') is None and pg.evaluate("() => getComputedStyle(document.querySelector('header')).display !== 'none'"))
    fast(pg, False)

    # ---- a game in progress comes back after a reload, with its strip and streak
    begin(pg, 'chip-zone'); fast(pg, True)
    for k in range(4): pg.click('[data-gp="1"]'); settle(pg)
    pg.reload(); pg.wait_for_selector('#gpRoot.gp-full')
    check('after a reload the game is where it was: score, dots and streak agree', pg.inner_text('#gpScore') == '4' and pg.evaluate(DOTS)[:5] == ['hit'] * 4 + ['now'] and pg.evaluate("() => document.querySelector('#gpStreak b').textContent") == '4', (pg.inner_text('#gpScore'), pg.evaluate(DOTS)))
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")

    # ---- a toast must not cover the answer buttons
    begin(pg, 'putt-369')
    ov = pg.evaluate("() => { const t = document.querySelector('#toast'); t.textContent = 'Saved'; t.style.display = 'block'; const a = t.getBoundingClientRect(), b = document.querySelector('.gp-btns').getBoundingClientRect(), c = getComputedStyle(t).pointerEvents; t.style.display = ''; return [a.bottom <= b.top, c]; }")
    check('a message shows above the answer buttons and cannot block a tap', ov[0] and ov[1] == 'none', ov)

    # ---- sound off: the screen still answers back, nothing is played
    pg.click('#gpSound'); pg.wait_for_timeout(200); pg.evaluate("() => { window.__feelLog = []; window.__feelHeard = []; }"); fast(pg, True); pg.click('[data-gp="1"]')
    check('with sound off the verdict still shows but nothing is heard', 'Holed' in pg.inner_text('#gpVerdict') and pg.evaluate("() => window.__feelHeard.length") == 0)
    settle(pg); pg.click('#gpSound'); pg.wait_for_timeout(200); fast(pg, False)
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")

    check('no page errors in the whole run', not errs, errs)
    ctx.close()

    # ---- reduced motion: no movement, the same information
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block', reduced_motion='reduce')
    ctx.add_init_script('window.__feelTest = true'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)
    begin(pg, 'putt-369', pressure=True); fast(pg, True)
    for k in range(3): pg.click('[data-gp="1"]'); pg.wait_for_timeout(30)
    st = pg.evaluate("() => ({ calm: document.documentElement.classList.contains('calm'), banner: getComputedStyle(document.querySelector('#gpBanner')).animationName, text: document.querySelector('#gpBanner').textContent, verdict: document.querySelector('#gpVerdict').textContent })")
    check('reduced motion: the banner only fades, and the words still show', st['calm'] and st['banner'] == 'fx-banner-fade' and '3 in a row' in st['text'], st)
    settle(pg)
    for k in range(5): pg.click('[data-gp="1"]'); settle(pg)
    check('reduced motion: the pressure button does not pulse', pg.evaluate("() => getComputedStyle(document.querySelector('.gp-pr .gp-b')).animationName") == 'none')
    check('reduced motion: no page errors', not errs, errs)
    ctx.close()
    b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nall passed')
raise SystemExit(1 if fails else 0)
