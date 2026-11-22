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
| 07 | Tectonics | `TECTONICS` — max peak, range cross-sections (several ranges), erosion, ocean depth |
| 08 | Climate Zones | `CLIMATE ZONES` — Köppen reference plus latitude belts for your planet |
| 09 | Population | `POPULATION` — land use, carrying capacity, logistic growth, Zipf distribution |
| 10 | Calendar | `CALENDAR` — solar, lunar and lunisolar calendars with leap cycles as exact fractions |
| 11 | Dossier | one-page summary, JSON export/import, Markdown copy, print |

In the spreadsheet each sheet asks for the star mass, planet mass and so on again;
here each value has one owner step and the others show it as a linked
(`↗`) field. The calendar can follow the Planet and Moon steps or take its own values.

Each step runs a self-test (the lamps in the sidebar) built from the guidance in the
workbook's cell notes: habitable-zone checks, gas partial pressures, moon-zone limits, etc.

## Data

Worlds are kept in this browser's `localStorage` (several worlds, switchable from
**Worlds** in the top bar). Export to JSON for backups or to move between machines.

## Fidelity to the workbook

`tests/calc.test.js` checks the engine against the values cached in the
`.xlsx` for its default inputs, sheet by sheet:

```powershell
node --test tests/calc.test.js
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
