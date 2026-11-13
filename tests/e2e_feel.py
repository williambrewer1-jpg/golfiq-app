"""Browser test for the game-feel foundation (phase A): the sound engine, motion helpers, Settings switches and the in-game sound toggle.
Run: python3 tests/e2e_feel.py  — headless Chromium cannot be heard, so events are checked through window.__feelLog / __feelHeard and by counting Web Audio nodes."""
import http.server, threading, functools, sys, os, re
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

# counts every oscillator and noise burst the page starts, so "it played" means Web Audio really got the notes
INIT = """window.__feelTest = true; window.__osc = 0; window.__noise = 0;
const o = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__osc++; return o.apply(this, a); };
const b = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { window.__noise++; return b.apply(this, a); };"""
FEEL = "(async () => (await import('./feel.js')))"
ANIM = "(kind) => { const e = document.createElement('div'); e.id = 'fxProbe'; document.body.appendChild(e); return import('./feel.js').then((F) => { F.pulse(e, kind); const cs = getComputedStyle(e), r = { name: cs.animationName, dur: cs.animationDuration }; e.remove(); return r; }); }"
SETTINGS_AUDIT = "() => { const out = { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: [], inputs: [] }; for (const el of document.querySelectorAll('label.sw, #feelTry')) { const r = el.getBoundingClientRect(); if (r.height < 38) out.small.push(el.id || el.textContent.trim().slice(0, 20) + ' ' + Math.round(r.height)); } for (const el of document.querySelectorAll('#feelSound, #feelMotion')) if (parseFloat(getComputedStyle(el).fontSize) < 16) out.inputs.push(el.id); return out; }"

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector('#loadSample'); pg.click('#loadSample'); pg.wait_for_timeout(1500)

    # ---- settings: both switches are on for someone who has never touched them, and nothing is written until they do
    pg.goto(URL + '#settings'); pg.wait_for_selector('#feelSound')
    check('Settings has a Sound and motion card with both switches on by default', pg.is_checked('#feelSound') and pg.is_checked('#feelMotion') and 'Sound and motion' in pg.inner_text('body'))
    check('existing saved settings (no feel key) keep working and are not rewritten', pg.evaluate("() => window.__golfiq.state.settings.feel === undefined"))
    check('the wording uses BreakingPar', 'BreakingPar' in pg.inner_text('.card:has(#feelSound)') and 'GolfIQ' not in pg.inner_text('.card:has(#feelSound)'))
    a = pg.evaluate(SETTINGS_AUDIT); check('Settings: no horizontal overflow, switches and button at least 38px, inputs at least 16px', not a['overflow'] and not a['small'] and not a['inputs'], a)
    pg.set_viewport_size({'width': 375, 'height': 667}); a = pg.evaluate(SETTINGS_AUDIT); check('same audit at 375x667', not a['overflow'] and not a['small'] and not a['inputs'], a); pg.set_viewport_size({'width': 390, 'height': 844})

    # ---- the engine: every event reaches Web Audio, after a tap
    check('audio is not started before the first tap', pg.evaluate("async () => (await import('./feel.js')).ready()") is False)
    pg.evaluate("() => { window.__feelLog = []; window.__feelHeard = []; }")
    pg.click('#feelTry'); pg.wait_for_function("() => window.__feelLog.length >= 1"); 
    check('the Try the sounds button wakes audio and plays the first sound at once', pg.evaluate("async () => (await import('./feel.js')).ready()") is True and pg.inner_text('#feelTryOut') == 'Tap')
    pg.wait_for_function("() => window.__feelLog.length >= 11", timeout=30000)
    log = pg.evaluate("() => window.__feelLog"); names = pg.evaluate("async () => (await import('./feel.js')).EVENT_NAMES")
    check('Try the sounds plays every event once, in order', log[:11] == names and len(names) == 11, log)
    check('and every one was actually scheduled on the audio engine', pg.evaluate("() => window.__feelHeard") == names)
    exp = pg.evaluate("async () => { const F = await import('./feel.js'); const all = Object.values(F.EVENTS).flat(); return { tones: all.filter((v) => !v.noise).length, noise: all.filter((v) => v.noise).length }; }")
    got = pg.evaluate("() => ({ tones: window.__osc, noise: window.__noise })")
    check('oscillators and noise bursts started match the event table (the +1 noise is the silent iOS unlock buffer)', got['tones'] == exp['tones'] and got['noise'] == exp['noise'] + 1, (got, exp))
    pg.wait_for_function("() => document.querySelector('#feelTryOut').textContent === ''", timeout=8000)

    # ---- the switches persist
    pg.click('label.sw:has(#feelSound)'); pg.wait_for_selector('#feelSound'); pg.wait_for_timeout(300)
    check('turning Sound off saves it', pg.evaluate("() => window.__golfiq.state.settings.feel") == {'sound': False, 'motion': True} and not pg.is_checked('#feelSound'))
    pg.evaluate("() => { window.__feelHeard = []; }"); played = pg.evaluate("async () => (await import('./feel.js')).play('win')")
    check('with Sound off nothing is played, even though the request is logged', played is False and pg.evaluate("() => window.__feelHeard.length") == 0)
    pg.click('#feelTry'); check('Try the sounds says sound is off instead of staying silent', 'Sound is off' in pg.inner_text('#feelTryOut'))
    pg.reload(); pg.wait_for_selector('#feelSound')
    check('Sound off survives a reload', not pg.is_checked('#feelSound') and pg.is_checked('#feelMotion') and pg.evaluate("async () => (await import('./feel.js')).get()") == {'sound': False, 'motion': True})
    pg.click('label.sw:has(#feelMotion)'); pg.wait_for_selector('#feelMotion'); pg.wait_for_timeout(300)
    check('turning Motion off saves it and puts the page in calm mode', pg.evaluate("() => window.__golfiq.state.settings.feel") == {'sound': False, 'motion': False} and pg.evaluate("() => document.documentElement.classList.contains('calm')"))
    pg.reload(); pg.wait_for_selector('#feelMotion')
    check('Motion off survives a reload (calm mode is applied at start-up)', not pg.is_checked('#feelMotion') and pg.evaluate("() => document.documentElement.classList.contains('calm')"))
    kinds = ['pop', 'shake', 'drop', 'slide-next', 'slide-out', 'flame', 'rise', 'stamp']
    calm = {k: pg.evaluate(ANIM, k) for k in kinds}
    check('with Motion off every animation is a 120 ms fade', all(v['name'] in ('fx-fade', 'fx-fade-out') and v['dur'] == '0.12s' for v in calm.values()), calm)
    pg.click('label.sw:has(#feelMotion)'); pg.wait_for_selector('#feelMotion'); pg.click('label.sw:has(#feelSound)'); pg.wait_for_selector('#feelSound'); pg.wait_for_timeout(300)
    check('both switches back on', pg.evaluate("() => window.__golfiq.state.settings.feel") == {'sound': True, 'motion': True} and not pg.evaluate("() => document.documentElement.classList.contains('calm')"))

    # ---- motion: keyframes exist once, play with the right names, and honour prefers-reduced-motion
    kf = pg.evaluate("() => { const out = []; for (const s of document.styleSheets) for (const r of s.cssRules) if (r.type === CSSRule.KEYFRAMES_RULE) out.push(r.name); return out; }")
    check('all the keyframes are defined once in index.html', all(k in kf for k in ['fx-pop', 'fx-shake', 'fx-drop', 'fx-slide-in', 'fx-slide-out', 'fx-flame', 'fx-rise', 'fx-stamp', 'fx-fade']) and len(kf) == len(set(kf)), kf)
    full = {k: pg.evaluate(ANIM, k) for k in kinds}
    want = {'pop': ('fx-pop', '0.2s'), 'shake': ('fx-shake', '0.25s'), 'drop': ('fx-drop', '0.35s'), 'slide-next': ('fx-slide-in', '0.22s'), 'slide-out': ('fx-slide-out', '0.22s'), 'flame': ('fx-flame', '0.4s'), 'rise': ('fx-rise', '0.3s'), 'stamp': ('fx-stamp', '0.35s')}
    check('each pulse plays its own keyframes at the planned length', all((full[k]['name'], full[k]['dur']) == want[k] for k in kinds), full)
    pg.emulate_media(reduced_motion='reduce'); pg.wait_for_timeout(200)
    red = {k: pg.evaluate(ANIM, k) for k in kinds}
    check('prefers-reduced-motion turns every animation into a 120 ms fade', all(v['name'] in ('fx-fade', 'fx-fade-out') and v['dur'] == '0.12s' for v in red.values()), red)
    check('and the page switches to calm mode by itself', pg.evaluate("() => document.documentElement.classList.contains('calm')"))
    pg.evaluate("() => { window.__feelLog = []; }")
    check('confetti is skipped under reduced motion', pg.evaluate("async () => { const F = await import('./feel.js'); const c = document.createElement('canvas'); c.className = 'fx-confetti'; document.body.appendChild(c); const r = F.confetti(c); c.remove(); return r; }") is False and pg.evaluate("() => window.__feelLog") == ['confetti:skipped'])
    pg.emulate_media(reduced_motion='no-preference'); pg.wait_for_timeout(200)
    check('calm mode lifts again when reduced motion is off', not pg.evaluate("() => document.documentElement.classList.contains('calm')"))
    pg.evaluate("() => { const e = document.createElement('div'); e.id = 'fxP'; document.body.appendChild(e); import('./feel.js').then((F) => F.pulse(e, 'pop')); }"); pg.wait_for_timeout(120)
    check('a pulse puts its class on, then takes it off when the animation ends', pg.evaluate("() => document.getElementById('fxP').classList.contains('fx-pop')")); pg.wait_for_timeout(500)
    check('the class is gone after the animation', not pg.evaluate("() => document.getElementById('fxP').classList.contains('fx-pop')")); pg.evaluate("() => document.getElementById('fxP').remove()")

    # ---- confetti draws in brand colours, then clears itself
    pg.evaluate("() => { window.__feelLog = []; const w = document.createElement('div'); w.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:300px;z-index:99'; w.id = 'cfw'; const c = document.createElement('canvas'); c.className = 'fx-confetti'; c.id = 'cf'; w.appendChild(c); document.body.appendChild(w); }")
    ok = pg.evaluate("async () => (await import('./feel.js')).confetti(document.getElementById('cf'))"); pg.wait_for_timeout(350)
    px = pg.evaluate("() => { const c = document.getElementById('cf'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; const cols = new Set(); for (let i = 3; i < d.length; i += 4) if (d[i] > 200) { n++; cols.add([d[i - 3], d[i - 2], d[i - 1]].join(',')); } return { n, cols: cols.size }; }")
    check('confetti draws a burst on the canvas', ok is True and px['n'] > 50 and px['cols'] >= 3 and pg.evaluate("() => window.__feelLog") == ['confetti'], px)
    pg.wait_for_timeout(1500)
    left = pg.evaluate("() => { const c = document.getElementById('cf'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }")
    check('and clears the canvas after about 1.2 seconds', left == 0, left)
    pal = pg.evaluate("async () => (await import('./feel.js')).palette()")
    check('its palette is the theme tokens: green, gold, flag gold and cream', pal[0] == '#0b6b47' and pal[1] == '#f2cf4a' and pal[2] == '#c9a43a' and pal[3] == '#f3efe3', pal)
    pg.evaluate("() => document.getElementById('cfw').remove()")

    # ---- countUp
    pg.evaluate("() => { const e = document.createElement('b'); e.id = 'cu'; document.body.appendChild(e); window.__cu = []; new MutationObserver(() => window.__cu.push(e.textContent)).observe(e, { childList: true, characterData: true, subtree: true }); import('./feel.js').then((F) => F.countUp(e, 0, 24, 500)); }"); pg.wait_for_timeout(900)
    seq = [int(x) for x in pg.evaluate("() => window.__cu")]
    check('countUp animates up to exactly the final number', len(seq) > 4 and seq[-1] == 24 and seq == sorted(seq), seq)
    pg.evaluate("() => document.getElementById('cu').remove()")

    # ---- in-game toggle
    pg.evaluate("() => localStorage.setItem('golfiq-ui', JSON.stringify({pr_tab: 'games'}))"); pg.goto(URL + '#practice'); pg.reload(); pg.wait_for_selector('[data-gpstart]')
    check('on the Games tab audio is still asleep before any tap', pg.evaluate("async () => (await import('./feel.js')).ready()") is False)
    pg.click('[data-gpstart]'); pg.wait_for_selector('#gpRoot .gp-prompt')
    check('after the first tap the audio engine is ready', pg.evaluate("async () => (await import('./feel.js')).ready()") is True)
    snd = pg.query_selector('#gpSound')
    check('the game screen has a speaker toggle that says "Sound on"', snd is not None and snd.get_attribute('aria-pressed') == 'true' and snd.get_attribute('aria-label') == 'Sound on')
    box = snd.bounding_box(); check('toggle is at least 38px and in the top bar', box['height'] >= 38 and box['width'] >= 38 and box['y'] < 200, box)
    on_icon = pg.inner_html('#gpSound')
    pg.evaluate("() => { window.__feelLog = []; }"); pg.click('#gpSound'); pg.wait_for_timeout(300)
    check('tapping it turns sound off: label, pressed state and icon all change', pg.get_attribute('#gpSound', 'aria-pressed') == 'false' and pg.get_attribute('#gpSound', 'aria-label') == 'Sound off' and pg.inner_html('#gpSound') != on_icon)
    check('it is saved as the same Settings switch', pg.evaluate("() => window.__golfiq.state.settings.feel.sound") is False and pg.evaluate("() => window.__golfiq.state.journal.game_draft !== null"))
    a = pg.evaluate("() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, top: document.querySelector('.gp-top').scrollWidth > document.querySelector('.gp-top').clientWidth + 1 })")
    check('the top bar still fits at 390x844', not a['overflow'] and not a['top'], a)
    pg.set_viewport_size({'width': 375, 'height': 667}); pg.wait_for_timeout(150)
    a = pg.evaluate("() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, top: document.querySelector('.gp-top').scrollWidth > document.querySelector('.gp-top').clientWidth + 1 })")
    check('and at 375x667', not a['overflow'] and not a['top'], a); pg.set_viewport_size({'width': 390, 'height': 844})
    pg.click('#gpSound'); pg.wait_for_timeout(300)
    check('tapping again turns it back on and plays a tap', pg.get_attribute('#gpSound', 'aria-pressed') == 'true' and pg.evaluate("() => window.__golfiq.state.settings.feel.sound") is True and 'tap' in pg.evaluate("() => window.__feelLog"))
    pg.reload(); pg.wait_for_selector('#gpSound')
    check('a game in progress survives a reload with the toggle in the saved state', pg.get_attribute('#gpSound', 'aria-pressed') == 'true')
    pg.evaluate("() => { window.__golfiq.state.journal.game_draft = null; }")

    # ---- offline shell
    sw = pg.evaluate("() => fetch('./sw.js').then((r) => r.text())")
    check('feel.js is in the service-worker shell and the cache name moved on', "'feel.js'" in sw and re.search(r"CACHE = 'golfiq-v(\d+)'", sw) and int(re.search(r"CACHE = 'golfiq-v(\d+)'", sw).group(1)) >= 18)
    check('no page errors', not errs, errs)
    b.close()
srv.shutdown()
print('\n%s' % ('FAILED: ' + ', '.join(fails) if fails else 'all passed')); sys.exit(1 if fails else 0)
