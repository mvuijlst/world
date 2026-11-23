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
Served over HTTP, the World map, its climate and the rivers are built in a background worker
(`js/mapworker.js`), so the page stays responsive while they work; from disk, where browsers allow no
workers, they are built in the page, which then pauses for a few seconds.
The only network use is Google Fonts; without it the UI falls back to system fonts.

## The build sequence

| # | Step | From the workbook |
|---|------|-------------------|
| 00 | Briefing | names, presets, a random habitable-world roller, status of every module |
| 01 | Galaxy | `GALAXY` — habitable zone, stellar census, multiplicity, seeded 3D star map (same Lehmer RNG, so seeds match the sheet) |
| 02 | Star | `STAR` — class, luminosity, radius, temperature, lifetime, habitable zone |
| 03 | Planetary System | `PLANETARY SYSTEM` — inner limit, Bode orbits, frost line, debris disk, plus an editable list of bodies; **Regenerate planetary system** lays out new orbits and bodies around the current star with the home world on a habitable orbit (offered on the Star step too when a change of star has left it outside the zone) |
| 04 | Planet | `PLANET` — density, gravity, temperature, orbit, atmosphere and gas retention, circulation cells, a daylight-hours map |
| 05 | Moon | `MOON` — moon zone, periods, tides, tidal locking |
| 06 | Sky | `APPARENT SIZE & BRIGHTNESS` — the star from every world, planets from home, the moon and eclipses |
| 07 | Orrery | a navigable 3D model of the system: Kepler orbits in motion, habitable zone, frost line, debris disk |
| 08 | Vista | the sky and land from any latitude on any world, at any time: sky colour, star, moon phases, planets, stars at night, fields and plants |
| 09 | Plates | the supercontinent and its breakup, as in Worldbuilder's Log 10–19: cratons, crust and rifts on a globe, splitting along rifts, rotation poles through time, plate speeds, new ocean floor by age, subduction zones and island arcs, a second rifting event and splitting comoving plates, microcontinents, arc and continent collisions, mountain belts, hotspots and LIPs, a land estimate for Population, GPlates export/import; **Advance** carries a finished history on, 25–500 Myr at a time (Wilson cycle, break up, drift apart, wander, come together), with undo, until the world looks right |
| 10 | World map | the surface today from the plates' history (Log 20–26): plates and their boundaries, continents and shelves at a chosen land share, mountains by type and age, islands and hotspot volcanoes, sea depth from ocean-floor age, trenches; scaled to gravity (with the gravity scaling factor) and radius, ridge depth, erosion, with valleys carved by rivers and deltas at their mouths; map or globe, a brush to raise and lower, colour and 16-bit height PNGs, and the drawing kit; the workbook's `TECTONICS` sheet as a reference (range cross-sections, erosion, max peak, ocean depth by crust age) |
| 11 | Climate | from the map, star and spin (Log 28–34): pressure and winds, ocean currents, upwelling, fishing grounds and reefs, temperature and precipitation by season, Köppen climate zones; any planet, locked worlds included |
| 12 | Rivers & biomes | from the map and its climate: rivers down to the sea, fresh and salt lakes, basins that drain inland, and biomes; map or globe, a PNG of the map and the rivers as SVG |
| 13 | Region | a closer map of part of the world map, 200–3,200 km across at down to 0.1 km a pixel, that agrees with it: finer relief, its own drainage and valleys, lakes, rivers down to brooks (and those entering from outside), biomes by height; zoom and pan, PNG, 16-bit heightmap and rivers SVG |
| 14 | Climate Zones | `CLIMATE ZONES` — Köppen reference plus latitude belts for your planet, and the share of each zone on your map (from the Climate step) |
| 15 | Population | `POPULATION` — land use, carrying capacity, logistic growth, Zipf distribution; uninhabitable and productive land and the number of continents can be taken from the map's biomes |
| 16 | Calendar | `CALENDAR` — solar, lunar and lunisolar calendars with leap cycles as exact fractions |
| 17 | Dossier | one-page summary, JSON export/import, Markdown copy, print |

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

The present is not the end. Once the plates reach 0 Ma, **Advance** (under Make a world) carries the
world on by 25–500 Myr: the whole history moves that much into the past (`shiftHistory`), the plates
move on to a new present (Wilson cycle, drift apart, wander, come together, or **break up**: the
continents that touch rift near their old sutures), and the new stretch gets its own subduction zones
and arcs, collisions, mountain belts and hotspots, only where the history already had marks of that
kind made by a step. Older marks keep their shapes; trenches and arcs that reached the old present
stop there, belts still rising stop after their time, and plumes get a lifetime. Repeat until the
world looks right; **Undo** steps back (this session). The World map follows each step.

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

**Make a world** does all of it with one click (`makeWorld` in `js/supercontinent.js`, seeded):
1. a supercontinent and its breakup;
2. a second rift and a microcontinent or two;
3. wandering, then a gathering with collisions;
4. a supercontinent that holds a while;
5. the modern breakup;
6. a last stretch in which one or two smaller continents run into larger ones, as India into Asia;
7. then the trenches, arcs, collisions, mountain belts, hotspots and LIPs.

The modern breakup rifts only some of the old contacts; the rest stay welded, as Eurasia across the
Urals. A rift runs a few degrees inside the leaving continent, so a sliver stays behind with the
suture inland, as the Appalachians in North America.

Collisions are not kisses: the blocks keep converging a few steps, then the front zips shut. A
collision range on the suture has a plateau behind it on the larger side. On the map, welded continents
are one landmass, and the ranges stand above the sea. Ranges erode with age: Alpine when young,
Appalachian after some 250 Myr, low hills after a billion years. It ends at 0 Ma, ready to draw on. The
same steps are under **Step by step**.

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
- **Continents and shelves** (Log 23): a low coastal plain rises over a few hundred km to an interior
  that is not one dome but broad basins (low and flat, as the Amazon's or the Congo's), uplands,
  plateaus with an escarpment at their edge, and hills; cratons are smooth old shields. On an Earth-like
  world about half the land lies below 500 m and a tenth above 2 km, as on Earth. The rim is flooded
  shelf, about 150 km wide on quiet coasts and 40 km on active ones. Sea level is set so land covers the share asked
  for (by default the Population step's).
- **Land topography** (Log 24): mountain belts, from 5.2 km for collisions to 4 km for cordilleras and
  2.4 km for accreted arcs, worn down after they stop rising. Each belt rises from foothills at a ragged
  edge to a crest along its middle; how much of its width stands up varies along it, and it breaks
  into massifs, passes and gaps a few hundred km apart, with parallel ranges within it (plateaus stay
  flat-topped). A belt raises the land on its continent, not a strip out over the sea beyond it. A belt stands on thickened crust, so the ground under it stays land
  after its peaks are worn down (the Appalachians, the Urals), until that too is worn away, over a
  billion years or so (the Grenville). Large igneous provinces are basalt plateaus, planed down in turn.
- **Erosion**: everything that stops rising wears down (belts, the ground they hold up, flood basalts,
  volcanoes), at **Erosion ×** Earth's rate, faster where it rains (the equator and the fronts between
  the planet's circulation cells), slower in the dry belts and near the poles. The latitude stands in for
  the climate, which is worked out from the finished map, and is where a feature is today.
- **Glaciers carve** first (`glaciate` in `js/worldmap.js`): ice lies where the warmest season is
  below freezing, or was in the ice ages (**Ice ages, °C** colder than now, Earth's last about 6 °C,
  more towards the poles) with snow enough to feed it. It flows downhill as water does and erodes
  where heavy snow makes it slide (wet ranges: Norway, Patagonia, Alaska), barely where it is frozen to
  its bed (polar deserts): wide troughs, deepest along the main ice streams, with scoured hollows that
  become lakes. Where a main ice stream cuts through high ground to the coast it digs below the sea, a
  fjord; low ground under the ice is scoured but stays land, and inland nothing sinks below the sea.
- **Rivers carve** (`carve` and `carveMap` in `js/worldmap.js`): the map is built, its climate worked
  out (Climate step), and the water each cell sheds after evaporation (`water` in `js/biomes.js`, as
  for the rivers) drains to the lowest way out (a priority flood from the sea), gathering on the way; each cell is cut down towards the one it drains to
  by the stream-power law, solved implicitly (Braun & Willett 2013), so big rivers cut deep valleys
  through wet uplands and mountain belts (typically 1.5–3 km, deeper in the wettest high ranges, at
  Erosion ×1), little in deserts, and divides barely change; valley sides slope down to them. A basin
  spills over its rim only if more water flows in than its lake could evaporate; otherwise it stays
  closed and its rim uncut, so inland drainage and lakes come out as on the uncarved map. Gravity:
  rivers cut as √g (the water's power grows with g, so does the weight of what it moves), and under
  stronger gravity the load settles sooner, so deltas are smaller. Tides: the planet's tide against
  Earth's comes from its moon and star, its size and gravity (G·M·R²/(g·a³); none from a star it is
  locked to), and is larger over wide shelves. Where the tidal range at a mouth is small the river
  builds a delta; where it is large (over ~3 m) it scours a funnel-shaped estuary and its load goes
  out as bars under water. The climate
  is kept for the Climate step (carving barely changes it: it works on smoothed heights), so it is
  worked out once. The rock goes
  downstream: basins fill with it (halfway at most), and the largest rivers build deltas a few metres
  above the sea on the shelf in front of their mouths. Land stays land; the Rivers & biomes step works
  on the carved map, and its rivers run in the valleys. It can be switched off, and is off
  where the air is too thin for liquid water.
- **Islands** (Log 22): island arcs as a broad submarine ridge with separate volcanoes on it every
  50-150 km, some breaking the surface, a few large; and hotspot volcanoes that sink into seamounts as
  they age. Oceanic plateaus are ragged, not smooth ovals.
- **Sea topography** (Log 26): the world's depth curve from its ridge depth (ridge + 350·√age, flattening
  on old floor), continental slopes, trenches and oceanic plateaus.

Not only Earth: the heights and widths of what stands up (ranges, trenches, volcanoes) are divided by
g^scaling (the gravity scaling factor, 1–2, set on this step); the lie of the land (coasts, shelves,
basins, how far inland the ground rises) does not change with gravity. Widths are set
in km and turned into degrees by the planet's radius. Brush strokes are kept with the world and applied
on top. Exports are an equirectangular colour map and a 16-bit heightmap PNG; the file name gives the
height range and sea level.

## Climate

The Climate step (`js/climate.js`, `js/steps/climate.js`) works out the climate of the world map for
the two solstices and the equinoxes, following Worldbuilder's Log 28–34. On a much tilted world the
equinoxes are the low latitudes' warm, wet season. A year counts a quarter round each solstice and
half at the equinoxes. It works for any planet; some worlds come out
nothing like Earth, and that is fine.
- **Temperature:** from the sunlight by latitude and season (the star's flux, the orbit, the tilt),
  tied to the planet's mean temperature. The pole-to-equator gradient is gentler on slow rotators
  (one broad cell) and under thick air, steeper on fast rotators. Large seasonal swings are damped.
  Land far from the sea has wider seasons, and it gets colder with height by 6.5 °C × g per km, up to
  the tropopause (11 km ÷ g). The
  sea cannot fall below −1.8 °C: below that it is sea ice.
- **Pressure and winds:** belts from the planet's circulation cells (set by its day), shifted with
  the seasons. Continents are low in summer and high in winter (monsoons). The wind blows down the
  pressure gradient, turned by the spin; a retrograde world is mirrored.
- **Ocean currents:** driven by the year's winds (Stommel's model). The winds' stress on the sea, curling,
  drives a circulation that the planet's spin turns into gyres within each basin's real coasts. The
  return flow crowds into a narrow, fast boundary current: on the western side on a prograde world,
  on the eastern side on a retrograde one, and hardly at all on a slow one. Each place gets something
  of the water upstream, so warm water is carried poleward and cold equatorward; slow drifts carry
  little, fast currents a lot. Sea ice shields the sea from the wind.
- **Upwelling and reefs:** where the wind's Ekman drift pushes surface water away from a coast, and
  along the equator under the easterlies, cold water wells up (rich fishing, as on shelves and in
  subpolar seas). Coral reefs grow on warm, shallow seas away from it.
- **Precipitation:** moisture is taken up from warm seas (and some from warm land), carried along
  the winds, and rained out in low-pressure belts, by summer convection, on windward slopes and as
  the air cools. That leaves rain shadows and dry interiors. The total follows the planet's warmth and
  how much sea it has.
- **Köppen zones:** from the warm and cold season's temperature and rain.
- **Tidally locked worlds** (a day as long as the year): a hot spot under the star, winds converging
  on it, no seasons, an icy night side.

## Rivers & biomes

The Rivers & biomes step (`js/biomes.js`, `js/steps/biomes.js`) works on the world map's own cells,
with the Climate step's seasons.
- **Water:** the year's rain less what evaporates (a Budyko curve, against a potential evaporation
  from the seasons' temperatures). There is none where water cannot stay liquid: below its triple
  point (about 0.006 atm), or hotter than it boils at that pressure. Ice sheets (summers below
  freezing) give none either.
- **Drainage:** each land cell drains the lowest way to the sea, found by flooding the map up from the
  coast (priority flood). The water is routed over the heights plus a gentle unevenness, so streams
  gather into valleys rather than running down smooth slopes in parallel.
- **Lakes:** a hollow fills with water. If what reaches it is more than its surface can evaporate, it
  spills: a fresh lake. If not, it is a salt lake covering only the part it can keep wet, and its
  basin never drains to the sea.
- **Rivers:** drawn where the flow reaches 600 m³/s and the river drains at least eight cells. The
  flow is in m³/s, so the same rule holds on any planet. Each line passes a point somewhere in every
  cell, not its centre.
- **Biomes:** from the warm and cold season, the year's rain against what could evaporate, and the
  height. The classes are ice sheet, barren rock, tundra, boreal forest, temperate forest, temperate
  rainforest, Mediterranean scrub, grassland and steppe, cold and hot desert, savanna, tropical dry
  forest, tropical rainforest and wetland. Their edges wander a little, as real ones do.
- **For Population:** the uninhabitable share of the land (ice, deserts, bare rock, and land above
  4 km ÷ g) and the productive share of the rest (each biome weighted by how well it feeds people), and
  the continents (landmasses of at least 1 % of the land). The land share is offered only when it is set
  on the World map step, since otherwise the map's sea level follows Population's.

## Region

The Region step (`js/region.js`, `js/steps/region.js`, built in `js/regionworker.js`) is a closer map of
one part of the World map: a square window 200–3,200 km across at 512–2,048 pixels, so a few hundred
metres to a few km a pixel where the world map's cells are some 55 km. Click the world map to place it
(by default it sits on the mouth of the largest river away from the poles); zoom and pan the closer map.
It agrees with the world map:
- **Heights**: the world map's (bicubic between its cells), plus detail finer than one of its cells only,
  so its large shapes stay the world map's own. The detail is fractal noise in km on the sphere (a place
  always gets the same detail): ridged crests in mountains, hills on uplands, gentle swells on plains,
  more where the world map is high and rugged; at the shore a rougher noise breaks the coast into bays,
  spits and islets. Ground pushed below sea level that no sea reaches is a dry hollow, not an inland sea.
- **Water**: the climate's runoff (as on Rivers & biomes) falls on every pixel and drains by a priority
  flood from the sea and from the window's edges, but only where the world map's drainage leaves the
  window there. Rivers coming in from outside bring the world map's discharge with them. Hollows
  shallower than a tenth of the local relief silt up; deeper ones are lakes, fresh if more water reaches
  them than they evaporate, salt if not; none under ice.
- **Valleys**: each pixel is cut towards its river's graded profile (steep for a brook, gentle for a
  big river; steeper under weak gravity), the more water the closer, at **Erosion ×**; valley sides then
  slump to a stable slope.
- **Biomes**: the world map's climate between its cells (looked up a little off each pixel, so biome
  edges do not follow its cells' sides), colder with height by the planet's lapse rate: forest in the
  valleys, tundra and ice on the crests.

Exports, at the region's full detail and in one frame: the map (PNG), a 16-bit heightmap (its file
name gives the height range and sea level) and the rivers (SVG, in pixels, with the frame's corners
noted inside). The window is kept with the world (`region` in the JSON); the region is rebuilt the
same from it.

## Drawing kit

"Drawing kit (ZIP)" on the World map and Rivers & biomes steps (`js/drawkit.js`) saves everything about the
surface as files to draw on. They share one equirectangular projection and size, so they stack in an
image editor or a vector program:
- PNGs: shaded relief, a 16-bit heightmap, a land mask, biomes, climate zones;
- SVGs: the coastline, the rivers (wider with their flow), and `8-drawing.svg` with Inkscape layers
  for a graticule (with the tropics and polar circles for the planet's tilt), the coast, the lakes and
  the rivers;
- `9-waters.json`: every river mouth (where, delta or estuary, flow in m³/s, sediment, tidal range),
  the glaciers (area, fjords, deepest trough, ice-age cooling), the planet's tides, and how the map was made (seed, erosion, rain), for labels or a closer map of a
  region that agrees with this one;
- `README.txt`: the scale (km a pixel), the heightmap's range and sea level, and the keys.

In the app the built map also keeps, for a closer map later, the drainage of every land cell (where it
drains to) and the water through it (m³/s), the tidal range on the sea, how glaciated each cell is and
  what the ice cut, and how it was carved; the map
is rebuilt the same from the saved world (every random choice is seeded).

The coast and lake shores are traced from the map's cells (marching squares), smoothed and cut where
they cross the date line.

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

## Example worlds

`examples/` holds unusual planets, made to test the surface pipeline at its edges (and checked by
`tests/examples.test.js`). Import them from **Worlds → Import JSON** (several at once is fine):

| File | World | What is unusual |
|------|-------|-----------------|
| `featherfall` | Featherfall · Thistledown, moon Puffball | 0.51 g: mountains over 20 km, deep valleys, a thin hold on its air |
| `the-anvil` | The Anvil · Ironvault, moon Tongs | a 2 g super-Earth: low broad ranges, compact deltas |
| `halfnight` | Halfnight · Gloaming around the red dwarf Ruddlecoal | tidally locked, one circulation cell, no moon and no tides: deltas only |
| `dustvault` | Dustvault · Ashkettle, moon Cinderpip | air at 0.004 atm: no liquid water, no rivers, nothing grows |
| `widows-tilt` | Widow’s Tilt · Vagrance | no moon, axis tipped 62° |
| `tidewrack` | Tidewrack · Brinemaw, The Gnawing Moon | a 3-Moon-mass moon at 220,000 km: tides ~11× Earth’s, estuaries |
| `whirligig` | Whirligig · Spindrift, moon Thimble | a five-hour day, seven circulation cells; history carried on 500 Myr |
| `rimewater` | Rimewater · Hoarfrost, moon Snowglobe | about 1 °C, ice ages 12 °C colder: glaciers, fjords, lake country |

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

Scripts and tools can use the world API without a session: in the admin, **API tokens → Add**,
choose the account and a name, and copy the token shown at the top of the page (only a hash is
kept, so it is shown once). Send it as `Authorization: Bearer <token>` to `/api/worlds`; it acts as
that account there and nowhere else (not the admin, not sign-in). Delete it to revoke it.

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
