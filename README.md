# WorldSmith — planetary design console

A guided, fully client-side app for building a habitable world with the method
from Artifexian's *Worldbuilder's Log* and his spreadsheet **The WorldSmith 8.00**.
Every formula in the workbook (all visible sheets plus the hidden
`Calculations` sheet) is ported to JavaScript and linked, so one change ripples
through the whole world.

No build step, no backend, no dependencies: open it in a browser and go.

## Running it

Serve the folder with any static server, for example:

```powershell
python tools/serve.py
```

then open <http://127.0.0.1:5178>. `tools/serve.py` disables caching, so edits show up on reload.
Opening `index.html` straight from disk also works (it uses classic scripts, not ES modules).
The only network use is Google Fonts; without it the UI falls back to system fonts.

## The build sequence

| # | Step | From the workbook |
|---|------|-------------------|
| 00 | Briefing | names, presets, a random habitable-world roller, status of every module |
| 01 | Galaxy | `GALAXY` — habitable zone, stellar census, multiplicity, seeded 3D star map (same Lehmer RNG, so seeds match the sheet) |
| 02 | Star | `STAR` — class, luminosity, radius, temperature, lifetime, habitable zone |
| 03 | Planetary System | `PLANETARY SYSTEM` — inner limit, Bode orbits, frost line, debris disk, plus an editable list of bodies |
| 04 | Planet | `PLANET` — density, gravity, temperature, orbit, atmosphere and gas retention, circulation cells, a daylight-hours map |
| 05 | Moon | `MOON` — moon zone, periods, tides, tidal locking |
| 06 | Sky | `APPARENT SIZE & BRIGHTNESS` — the star from every world, planets from home, the moon and eclipses |
| 07 | Orrery | a navigable 3D model of the system: Kepler orbits in motion, habitable zone, frost line, debris disk |
| 08 | Vista | the sky and land from any latitude on any world, at any time: sky colour, star, moon phases, planets, stars at night, fields and plants |
| 09 | Plates | the supercontinent and its breakup, as in Worldbuilder's Log 10–19: cratons, crust and rifts on a globe, splitting along rifts, rotation poles through time, plate speeds, new ocean floor by age, subduction zones and island arcs, a second rifting event and splitting comoving plates, microcontinents, arc and continent collisions, mountain belts, hotspots and LIPs, a land estimate for Population, GPlates export/import |
| 10 | World map | the surface today from the plates' history (Log 20–26): plates and their boundaries, continents and shelves at a chosen land share, mountains by type and age, islands and hotspot volcanoes, sea depth from ocean-floor age, trenches; scaled to gravity and radius; map or globe, a brush to raise and lower, colour and 16-bit height PNGs |
| 11 | Tectonics | `TECTONICS` — max peak, range cross-sections (several ranges), erosion, ocean depth |
| 12 | Climate Zones | `CLIMATE ZONES` — Köppen reference plus latitude belts for your planet |
| 13 | Population | `POPULATION` — land use, carrying capacity, logistic growth, Zipf distribution |
| 14 | Calendar | `CALENDAR` — solar, lunar and lunisolar calendars with leap cycles as exact fractions |
| 15 | Dossier | one-page summary, JSON export/import, Markdown copy, print |

In the spreadsheet each sheet asks for the star mass, planet mass and so on again;
here each value has one owner step and the others show it as a linked
(`↗`) field. The calendar can follow the Planet and Moon steps or take its own values.

Each step runs a self-test (the lamps in the sidebar) built from the guidance in the
workbook's cell notes: habitable-zone checks, gas partial pressures, moon-zone limits, etc.

## Skies and plants

The Vista step's colours follow Panoptes V, *Colors of Alien Worlds*:
[Alien Skies](https://panoptesv.com/SciFi/ColorsOfAlienWorlds/AlienSkies.php) and
[Alien Plants](https://panoptesv.com/SciFi/ColorsOfAlienWorlds/AlienFields.php). Those pages give
their method in words and their results as images, so:

- `js/spectra.js` is a spectral sky model in the same spirit: the star's light (a blackbody at a
  colour temperature fitted per class), Rayleigh scattering of Earth's air with the column scaled
  by pressure / gravity, Chappuis-band ozone proportional to the star's UV below 240 nm, a 30 %
  grey ground, single plus two-stream multiple scattering, the CIE 1931 observer, and exposure
  set by a 50 % grey card facing the star. Colours are shown as an eye used to Earth's daylight
  sees them (as on the pages), or white-balanced to the local light if you choose.
- `js/panoptes.js` holds colours sampled from the pages' renders (10 star classes × 4 pressures ×
  high/low star for the sky; 23 classes × 3 pressures × 6 pigment densities for leaves, plus the
  twilight-adapted set). The sky model is anchored to them: at every rendered point it reproduces
  the page's zenith, horizon and grey-card colours (`tests/sky.test.js`: ΔE < 4, mean ≈ 1), and in
  between the model's own structure (gradients, glow, twilight, other gases) carries the colour.
- Leaf colours are the pages' own, interpolated between classes and pressures.
- **Grow plants here** opens [cloud.yusupov.cloud/plants](https://cloud.yusupov.cloud/plants/), the
  nodarium plant grower, with the world's star class, gravity class and the habitat at the chosen
  latitude (`?star=K&gravity=earth&habitat=forest&seed=…`).

`js/orbits.js` places every body on its Kepler orbit (t = 0 at the home world's vernal equinox) and
turns positions into altitude and azimuth for an observer on any world, using its axial tilt and
rotation (other worlds get a stable made-up tilt and day unless set).

## Plates and GPlates

The Plates step follows Artifexian's Worldbuilder's Log 10 ("GPlates: the Supercontinent"):
draw cratons, the continental crust round them, rifts and failed rifts on a globe. Each craton
starts a plate; crust and rifts join the plate of the craton they start on. Areas and coverage are
measured on the sphere (`js/sphere.js`), and the crust's share gives a land estimate for the
Population step (crust × 29/41, Earth's ratio).

Then, as in Log 11 ("GPlates: the First 100 Million Years"), the supercontinent comes apart.
**Split the crust along** a rift cuts the crust in two, each half on the plate of the craton it
holds, and notes the plates on either side of the rift. A time bar runs from the start age (1000 Ma
by default) to the present, with play. With **Move plate**, at any age, drag a plate to where it
should be: that writes a total rotation pole for the plate at that age, as GPlates would. Poles can
be edited by hand, and each plate can move relative to another (its fixed plate). Between poles the
rotation is interpolated as GPlates does it (`js/rotation.js`, tested against pyGPlates'
reconstructions). Plate speeds are checked against Earth's (1–10 cm/yr, never above 20). Behind
the parting plates the new ocean floor is drawn by age, with the mid-ocean ridge (half-stage
rotation) and, optionally, flowlines.

**Make & simulate** does both for you (`js/supercontinent.js`, seeded): it generates a supercontinent
of 3–5 plates, split by rifts that meet at a triple junction (further junctions for 4 and 5), with a
craton or two well inside each plate and failed rifts branching off the rifts. Then it simulates the
plates' motion in steps of about 2.5 Myr, writing rotation poles every 10–50 Myr:

- **Break apart**: each block drifts away from the others, the largest nearly still;
- **Wander**: each goes its own way;
- **Come together**: all head for the middle until they form one supercontinent (the run ends there);
- **Wilson cycle**: break apart, wander, come together, and again, until the time runs out.

Runs go for 100–500 Myr or to the present, and any run can be continued from its last pole with
another motion. Continents that meet weld (a collision) and move on as one block. Leading coasts show
as subduction zones (teeth on the overriding plate), and ocean floor older than 200 Myr is taken to
have been subducted. Where three rifts meet, the ocean between them is filled and the ridges joined.
All of it stays editable.

Log 12 ("GPlates: Subduction Zones & Island Arcs") adds the trenches. **Subduction zones** are
lines on the overriding plate, with teeth towards it (GPlates' subduction polarity), and **island
arcs** are belts of volcanic islands a little behind a trench; both can be drawn at any age, and
then exist from that age (a subduction zone until it ends). **Mark subduction zones & island arcs**
walks through the simulation every 25 Myr or more, starts a zone off each coast that leads its
plate into the ocean, ends it when that coast stops leading, and puts an island arc behind about
half of them (the trench further out, as Japan; the rest are Andean margins). **Leading coasts**
shows where they belong at any age. A **second rifting event** is a rift drawn at a later age:
splitting its plate along it makes a new plate that moves with the old one until then; the console
can also cut the largest plate across, clear of its cratons, and simulate the parts breaking apart
from that age.

Log 13 ("GPlates: Splitting Comoving Plates") parts them properly. A pole can name its own fixed
plate, so a plate can change which plate it moves with (GPlates' crossover: two poles at the same
age, one ending the old segment, one starting the new, `js/rotation.js`). A split-off plate rides on
its parent until their rift opens; the simulation runs up to that age, then parts them there with a
crossover, even when the history is simulated again from the start. In Plate motion, **Part from
plate X** writes the crossover by hand at the age on view. Trenches and failed rifts crossing the
split are cut in two (GPlates' Split Feature), and after a second rift the subduction zones and island
arcs are marked again for the new motion. The `.rot` export writes one sequence per fixed plate, so
GPlates reads the crossovers as they are.

Logs 14–19 complete the history. **Microcontinents** (Log 14): a sliver of a margin, preferably
behind a leading coast, rifts off as a plate of its own. **Island arc collisions** (Log 15): an arc
that runs into another plate's continent is accreted to it, and its trench stops. **Continent
collisions** (Log 16): continents that meet after having been apart leave a suture, and the trenches
between them close. **Orogeny** (Log 17): mountain belts from each cause (cordilleras behind
subduction zones off continents, collision ranges on sutures, highlands of accreted arcs), worn down
once they stop rising. **Large igneous provinces and hotspots** (Log 18): plumes fixed in the mantle,
each starting with a flood basalt or oceanic plateau, and LIPs heralding some breakups. **Hotspot
tracks** (taken as Log 19, whose title could not be found): the chains of volcanoes the plates carry
away from each hotspot, coloured by age.

**Make a world** does all of it with one click (`makeWorld` in `js/supercontinent.js`, seeded): a
supercontinent, its breakup, a second rift, a microcontinent, wandering, a gathering with collisions, a
supercontinent that holds a while, the modern breakup (rifts near the old sutures) to the present,
then the trenches, arcs, collisions, mountain belts, hotspots and LIPs. It ends at 0 Ma, ready to draw
on. The same steps are under **Step by step**.

The server turns the drawing into GPlates files with [pyGPlates](https://www.gplates.org/docs/pygplates/)
(`server/worlds/plates.py`): **Export for GPlates** gives a zip with a `.gpml` feature collection
(Craton, ContinentalCrust and ContinentalRift features on their plate IDs, and a Flowline for each
opening rift) and a `.rot` rotation file with every plate's poles. The shapes are stored as drawn
at the start age, where every rotation is zero. **Import** reads a `.gpml`/`.gpmlz` back through the
server, and a `.rot` file or GeoJSON in the browser. pyGPlates needs the system library libGL
(`apt install libgl1`); it is GPL-2 and runs only on the server.

## World map

The World map step (`js/worldmap.js`, `js/steps/worldmap.js`) turns the plates at 0 Ma into a surface,
following Worldbuilder's Log 20–26:
- **Plates and boundaries** (Log 20, topologies): continental crust and dated ocean floor on their
  plates, the rest on the nearest. Boundaries are convergent near an active trench, divergent on a young
  ridge, otherwise transform.
- **Coasts**: not the crust's outline. A field of "how far inland", the distance into the crust
  roughened by domain-warped fractal noise at three scales (gulfs and peninsulas, bays, coves), is cut at
  the level that leaves the land share dry. The coast gets bays, capes, inland seas and offshore islands.
- **Continents and shelves** (Log 23): the crust rises gently inland. Its rim is flooded shelf, about
  150 km wide on quiet coasts and 40 km on active ones. Sea level is set so land covers the share asked
  for (by default the Population step's).
- **Land topography** (Log 24): mountain belts, from 5.2 km for collisions to 4 km for cordilleras and
  2.4 km for accreted arcs, worn down after they stop rising. Large igneous provinces are basalt plateaus.
- **Islands** (Log 22): island arcs, and hotspot volcanoes that sink into seamounts as they age.
- **Sea topography** (Log 26): the world's depth curve from its ridge depth (ridge + 350·√age, flattening
  on old floor), continental slopes, trenches and oceanic plateaus.

Not only Earth: as on the Tectonics step, heights and widths are divided by g^scaling. Widths are set
in km and turned into degrees by the planet's radius. Brush strokes are kept with the world and applied
on top. Exports are an equirectangular colour map and a 16-bit heightmap PNG; the file name gives the
height range and sea level.

## Data

Worlds are kept in this browser's `localStorage` (several worlds, switchable from
**Worlds** in the top bar). Export to JSON for backups or to move between machines.

When the page is served by the WorldSmith server, **Worlds → Sign in to sync** copies every
world to your account there and fetches worlds saved on other devices (`js/sync.js`). The
browser copy stays the working copy, so the app keeps working offline and from plain static
hosting. If two devices edit the same world, the server's version is kept under the world's
name and the other is saved next to it as "(conflict …)". Deleting a world removes it everywhere.

## Server (`server/`)

A small Django app: session login, and one JSON document per world per account.

| | |
|---|---|
| `GET /api/session` | who is signed in; sets the CSRF cookie |
| `POST /api/login`, `/api/logout` | `{"username", "password"}`; 10 failures per 15 min per address and per name |
| `GET /api/worlds` | your worlds: id, name, revision, deleted |
| `GET/PUT/DELETE /api/worlds/<id>` | read; save (`{"rev", "data"}`, 409 if the server copy moved on); delete (kept as a tombstone) |

Accounts are made with `manage.py createsuperuser` (or in `/admin/`).

Local development, app and API on one origin:

```powershell
uv venv server/.venv; uv pip install --python server/.venv -r server/requirements.txt
python tools/dev_server.py
```

then open <http://127.0.0.1:5179>. Tests: `cd server; $env:DJANGO_DEBUG=1; .venv/Scripts/python manage.py test worlds`.

## Deployment

Live at <https://world.yusupov.cloud>, from `/home/django/world-yusupov` on the VPS:
nginx serves the app files and passes `/api/` and `/admin/` to gunicorn on `127.0.0.1:8031`
(`world-yusupov.service`). Both config files are in `server/deploy/` (certbot has since added
the TLS lines to the live nginx file). The secret key and host name live in
`server/.env` on the server only.

Every push to `main` runs `.github/workflows/deploy.yml`: the engine and API tests, then an
rsync of the site, `pip install`, `migrate`, `collectstatic` and a restart of the service,
followed by a check that `/api/session` answers. The SSH key, host, port, user and path are
repository secrets. The server's `.env`, venv and database are never overwritten.

## Fidelity to the workbook

`tests/calc.test.js` checks the engine against the values cached in the
`.xlsx` for its default inputs, sheet by sheet:

```powershell
npm test
```

A few workbook quirks are kept on purpose so results match, and are marked
`QUIRK` in `js/calc.js`:

- the planet-locked-to-star test compares the lock time with 0, so it always reads "No";
- a locked moon's rotation period is reported as the synodic, not sidereal, month;
- the moon's apparent magnitude squares the planet's semi-major axis.

Two additions are not in the workbook: the daylight-hours map on the Planet step
(the sheet links to an external Desmos calculator; the link is kept too), and the
climate latitude belts, which are indicative placements for a 3-cell circulation.

## Layout

```
index.html          shell and script order
css/style.css       design tokens and components (CRT and PULP themes)
js/calc.js          the calculation engine (pure; also loads in Node)
js/data.js          default Sol/Earth world, Köppen reference
js/ui.js            DOM helpers and console components
js/viz.js           SVG/canvas diagrams
js/store.js         localStorage, import/export
js/generator.js     random habitable world
js/app.js           routing, step framework, autosave, theme
js/steps/*.js       the eleven steps
tests/              Node tests against the workbook
```

Method and formulas: Artifexian, *The WorldSmith 8.00*.
