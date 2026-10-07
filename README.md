# Fling the State

A 50-state tabletop slingshot puzzle. States pop into a wooden slingshot one at a time — drag back to aim (the dotted trajectory shows exactly where the piece will land), release to fling the state at the tilted map board. Land inside the correct state to stick it; miss twice and you get a pulsing gold hint ring.

Five levels, from full-shape-with-hints down to capitals-only. Mobile-friendly tap/drag controls.

**Play:** https://pete1450.github.io/Fling-the-State/ (enable Pages: Settings → Pages → Deploy from branch → main / root)

## Building

The game ships as a single self-contained `index.html` (Three.js inlined).

```
node build/logic.js        # pure-logic self-tests (must pass)
python3 build/build.py     # assembles index.html
```

`build/` holds the sources: `head.html` (HTML/CSS shell) + `three.min.js` + `data.js` (generated state polygons) + `logic.js` (pure game logic, node-testable) + `game.js` (Three.js renderer).

`build/data.js` is generated from `tools/states-10m.json` (us-atlas, unprojected lon/lat) via `tools/gen_data.js`, which projects with d3-geo's `geoAlbersUsa` (Alaska/Hawaii insets included) and simplifies with Douglas-Peucker. Requires the vendored `d3-geo` (not committed — see `tools/`). Regenerate only when the map data changes:

```
cd tools && npm install d3-geo   # one-time
node gen_data.js                 # writes ../build/data.js
```

A GitHub workflow (`.github/workflows/build.yml`) rebuilds `index.html` on every push to `main`.
