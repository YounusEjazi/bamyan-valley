# Bamyan Valley

An explorable 3D model of the Bamyan valley in Afghanistan and the cliff of the two
destroyed Buddha statues, built with [three.js](https://threejs.org/).

Walk the fields and the town below the cliff, climb to the niches or fly over the valley,
and find the 14 places hidden around it: the Great and Small Buddha niches, the cave
monasteries, the cliff top, the Bamian River, the bazaar, Shahr-i Ghulghula and more.
Each discovery adds an entry to your journal. Works on desktop and on phones / tablets.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and click **Click to explore** (on a phone: **Tap to explore**).
`npm run build` writes a static site to `dist/`. To try it on your phone, run
`npm run dev -- --host` and open the "Network" address it prints on the phone (same Wi-Fi).

## Controls

| Desktop | Phone / tablet | Action |
| --- | --- | --- |
| W A S D / arrows | left thumb (floating stick) | move |
| Mouse | right thumb, drag | look |
| Shift | push the stick to its edge | run / fly fast |
| Space | **Jump** / **▲** | jump / fly up |
| C | **▼** | fly down |
| F | **Fly** / **Walk** | switch walk / fly |
| J | **Journal** | journal |
| M | menu → Sound | sound on / off |
| Esc (twice) | **❚❚** | menu (viewpoints, sun, quality) |

Pressing Esc once frees the mouse and pauses; click the view to continue.

## Graphics quality

Phones start on **Medium**, desktops on **High**; change it under *Views & settings*
(or with `?q=low|medium|high`). The tier sets resolution, MSAA, shadow map size and range,
tree / grass density and draw distances, detail normal maps and light-shaft samples. On top
of that the renderer lowers its internal resolution when the frame rate drops and raises
it again when there is room. `?touch=1` shows the touch controls on a desktop.

## How it's made

The terrain, the cliff and the town are real-world data, processed in Blender and Python
and exported to `public/`:

- **Terrain**: Copernicus DEM GLO-30, reprojected to UTM 42N (1 unit = 1 m).
- **Buddha cliff**: a ~1 m detail mesh modelled procedurally along the DEM cliff line and
  matched against reference photos (erosion columns, caves, the 58 m niche, rubble slopes).
- **Ground**: a Sentinel-2 image (24 June 2025) with OpenStreetMap roads, tracks and the river.
- **Town and trees**: OpenStreetMap building footprints extruded as mud-brick houses;
  poplar, willow and fruit trees placed along roads, channels, field edges and houses.
- **Rivers**: the Bamian River and its streams from OpenStreetMap (`scripts/make-water.mjs`).

In the browser (`src/`):

- **Surfaces** (`materials.js`): photo-scanned detail maps from Poly Haven, packed by
  `scripts/build-textures.mjs` into one RGB map each (luminance + normal), add the close-up
  surface on top of the satellite and Blender colours: layered rock on the cliff and steep
  slopes (triplanar, with wandering strata), soil and grass on the ground, mud plaster on the
  houses. Houses get windows with painted frames, doors, damp wall feet and tin roofs.
- **Atmosphere** (`atmosphere.js`): height fog tinted by the sky, drifting cloud shadows,
  moving clouds and wind.
- **Trees** (`trees.js`): near the player, leaf-card crowns around a solid core that sway,
  flutter and let the sun shine through; further away, solid crowns (which also cast the
  shadows).
- **Life**: grass bending under gusts, birds over the niches and fields (`life.js`), flowing
  water (`water.js`), synthesised wind, water and footstep sounds (`audio.js`).
- **Rendering** (`post.js`): an HDR target with MSAA and a reversed float depth buffer, then
  one pass for light shafts, sun glare, white balance, tone mapping and a filmic grade.

Coordinates: X east, Y up, -Z north; the origin is the Great Buddha niche.

To rebuild the derived assets:

```bash
node scripts/build-textures.mjs                                  # detail maps (downloads from Poly Haven)
node scripts/make-water.mjs <pipeline>/data/osm_local.json       # rivers and streams
```

## Credits and licences

- Terrain: Copernicus DEM GLO-30, © DLR e.V. 2010-2014 and © Airbus Defence and Space
  GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- Contains modified Copernicus Sentinel data 2025.
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  available under the Open Database License (ODbL). The buildings, roads, rivers, trees and
  place data in `public/` are derived from it.
- Surface textures: [Poly Haven](https://polyhaven.com) (CC0): `cliff_side`,
  `dry_ground_rocks`, `sparse_grass`, `clay_plaster`.
- Facts in the journal: [UNESCO](https://whc.unesco.org/en/list/208/),
  [Wikipedia](https://en.wikipedia.org/wiki/Buddhas_of_Bamiyan).
- three.js and three-mesh-bvh are MIT licensed.
