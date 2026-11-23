"""An invented golf course for the Play / Course view browser tests (not a real place, not anyone's round).

"Testwood Links": 18 holes laid out side by side, each running due north from its tee. The page never talks to the real
OpenStreetMap, weather or imagery services in these tests: `route_services(page)` answers them all from here.
"""
import json, math

ORIGIN = (-30.0, 140.0)                 # invented spot in open country
NAME = 'Testwood Links'
PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5]
LENGTH_M = {3: 150, 4: 360, 5: 470}
GAP_M = 130                              # holes are this far apart, west to east
GREEN_R = 14                             # metres; greens are circles 28 m across
KY = 111_320.0
KX = KY * math.cos(math.radians(ORIGIN[0]))


def ll(east_m, north_m):
    return (ORIGIN[0] + north_m / KY, ORIGIN[1] + east_m / KX)


def circle(e, n, r, k=16):
    return [ll(e + r * math.sin(2 * math.pi * i / k), n + r * math.cos(2 * math.pi * i / k)) for i in range(k)] + [ll(e, n + r)]


def rect(e0, n0, e1, n1):
    return [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)]


def hole(n):
    """Tee (lat, lon), green centre (lat, lon) and length in metres of hole n (1-18)."""
    par = PARS[n - 1]; e = (n - 1) * GAP_M; L = LENGTH_M[par]
    return {'par': par, 'tee': ll(e, 0), 'green': ll(e, L), 'len_m': L, 'east': e}


def point(n, along_m, right_m=0.0):
    """A spot on hole n: along_m metres up the hole from the tee, right_m metres right of the centre line."""
    h = hole(n); return ll(h['east'] + right_m, along_m)


def overpass_outline():
    els, i = [], 1000

    def way(tags, pts):
        nonlocal i; i += 1
        els.append({'type': 'way', 'id': i, 'tags': tags, 'geometry': [{'lat': round(a, 7), 'lon': round(b, 7)} for a, b in pts]})
    for n in range(1, 19):
        h = hole(n); e, L = h['east'], h['len_m']
        way({'golf': 'hole', 'ref': str(n), 'par': str(h['par'])}, [h['tee'], ll(e, L * 0.55), h['green']])
        way({'golf': 'tee'}, rect(e - 8, -6, e + 8, 6))
        if h['par'] > 3: way({'golf': 'fairway'}, rect(e - 18, 60, e + 18, L - 22))
        way({'golf': 'green'}, circle(e, L, GREEN_R))
        way({'golf': 'bunker'}, circle(e + 24, L - 4, 6, 10))                   # right of the green
        if n == 1: way({'golf': 'water_hazard'}, rect(e - 50, 200, e - 20, 250))  # left of the landing zone on hole 1
    return {'elements': els}


def overpass_nearby():
    c = ll(GAP_M * 8.5, 200); lo = ll(-100, -100); hi = ll(GAP_M * 18, 600)
    return {'elements': [{'type': 'way', 'id': 4242, 'tags': {'leisure': 'golf_course', 'name': NAME}, 'center': {'lat': c[0], 'lon': c[1]},
                          'bounds': {'minlat': lo[0], 'minlon': lo[1], 'maxlat': hi[0], 'maxlon': hi[1]}}]}


WEATHER = {'current': {'temperature_2m': 21, 'wind_speed_10m': 0, 'wind_direction_10m': 0}}


def route_services(page, weather=True, outline=True):
    """Answer OpenStreetMap from the invented course; weather and terrain flat (or refused); imagery and charts refused."""
    def overpass(route):
        body = (route.request.post_data or '') + route.request.url
        if 'leisure' in body: return route.fulfill(status=200, content_type='application/json', body=json.dumps(overpass_nearby()))
        if not outline: return route.fulfill(status=200, content_type='application/json', body=json.dumps({'elements': []}))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(overpass_outline()))

    def meteo(route):
        if not weather: return route.abort()
        url = route.request.url
        if '/elevation' in url:
            k = url.split('latitude=')[1].split('&')[0].count(',') + 1
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'elevation': [20.0] * k}))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(WEATHER))
    for host in ('overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru'): page.route(f'**/{host}/**', overpass)
    page.route('**/api.open-meteo.com/**', meteo)
    page.route('**/server.arcgisonline.com/**', lambda r: r.abort())
    page.route('**/cdn.jsdelivr.net/**', lambda r: r.abort())
