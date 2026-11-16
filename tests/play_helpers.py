"""Shared by the browser tests that play guided games end to end (not a test itself)."""

def settle(pg):
    """Wait until the game screen has taken the last tap (the short feedback window is over, or the result is showing)."""
    pg.wait_for_function("!document.querySelector('#gpRoot[data-busy]')")


def answer_step(pg, taps, every=3):
    """Answer the step on screen, whatever kind it is. Every `every`-th answer is a miss (a missed fairway for the Driver test)."""
    miss = taps % every == every - 1
    if pg.query_selector('[data-gpball]'):                      # Driver test / Max out: a distance (the slider's start value) and where it finished
        pg.click('[data-gpball="%s"]' % ('m' if miss and pg.query_selector('[data-gpball="m"]') else 'f'))
    elif pg.query_selector('[data-gp="5"]'): pg.click('[data-gp="2"]')      # strokes games: par every time
    else: pg.click('[data-gp="0"]' if miss else '[data-gp="1"]')
    settle(pg)


def go_next(pg):
    """From a result inside a session or a skills test: Next opens the "N of M done" screen, and Start there begins the next game."""
    pg.click('[data-gpsesnext]'); pg.wait_for_selector('#gpRoot.gp-gap'); pg.click('[data-gpgapgo]'); pg.wait_for_selector('#gpRoot .gp-prompt')
