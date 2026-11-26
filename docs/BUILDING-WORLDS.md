# Building an open world

An open world is one JSON file (roads with heights, buildings, trees, water, landmarks) plus a height grid, made by the
scripts in `tools/openworld/`. Building one takes from minutes (a town) to an hour or two (a city) on an ordinary PC.

## What you need

- **Node.js 20+** (no packages).
- **OpenStreetMap data** for the area: by default the build asks the Overpass API; for big areas download an extract
  (e.g. from [Geofabrik](https://download.geofabrik.de)), convert it to OPL with `osmium cat area.osm.pbf -o area.opl`,
  and point `OW_OSM=area.opl` at it.
- **Heights**: the scripts read the Environment Agency's LIDAR (England): `tools/openworld/make.mjs` lists the tiles to
  download from https://environment.data.gov.uk/survey (LIDAR Composite DTM 1 m and First Return DSM 1 m) and imports
  them (`tools/routes/survey-import.mjs`). Outside England you need another terrain model (and buildings' heights from
  OSM tags); `WORLD_NO_LIDAR=1` builds with OSM data alone (flatter, less exact).
- **Blender 4.x** (optional): to (re)build landmark models with `tools/kit/*.py` (the built models are already in
  `public/models/`).

## Steps

```sh
node tools/openworld/make.mjs <id> "<Name>" <south> <west> <north> <east>   # first time: sets up the world and lists LIDAR tiles
OW_OSM=area.opl node tools/openworld/rebuild.mjs <id>                       # builds it into data/world/<id>.json
```

Per-world options live in `tools/openworld/options/<id>.json`, hand corrections in `tools/openworld/edits/<id>.json`
(or the in-app map editor, `/mapedit`), landmarks in `tools/openworld/landmarks/<id>.json`, pre-plotted rides in
`tools/openworld/rides/<id>.json` (planned by `rides.mjs`, which `rebuild.mjs` runs at the end). Look at the three
included worlds' files for examples.
