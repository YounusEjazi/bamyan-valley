# Bamyan Valley

An explorable 3D model of the Bamyan valley in Afghanistan and the cliff of the two
destroyed Buddha statues, built with [three.js](https://threejs.org/).

Walk the fields and the town below the cliff, ride a horse, climb to the niches or fly over
the valley, in first or third person, and find the 14 places hidden around it: the Great
and Small Buddha niches, the cave monasteries, the cliff top, the Bamian River, the bazaar,
Shahr-i Ghulghula and more. Each discovery adds an entry to your journal. The valley is
lived in: villagers in the bazaar and at the shrine, farmers in the fields, visitors at the
niches, children by the river, horses and donkeys grazing, and horsemen on the tracks.
Works on desktop and on phones / tablets.

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
| Shift | push the stick to its edge | run / gallop / fly fast |
| Space | **Jump** / **▲** | jump (also on horseback) / fly up |
| C | **▼** | fly down |
| F | **Fly** / **Walk** | switch walk / fly |
| E | **Ride** / **Get off** | get on a saddled horse or donkey next to you / get off |
| V | **3rd** / **1st** | first / third person view |
| Mouse wheel | | zoom the third-person camera |
| J | **Journal** | journal |
| M | menu → Sound | sound on / off |
| Esc (twice) | **❚❚** | menu (viewpoints, sun, quality) |

Pressing Esc once frees the mouse and pauses; click the view to continue.

Saddled horses wait in front of the Great Buddha (more graze in the fields and stand in the
bazaar). On horseback, W or the stick sends the horse where you look; it turns toward that
direction, canters, gallops with Shift (or the stick at its edge) and jumps with Space.
Donkeys are smaller and slower. Getting off leaves the horse where it is.

## Graphics quality

Phones start on **Medium**, desktops on **High**; change it under *Views & settings*
(or with `?q=low|medium|high`). The tier sets resolution, MSAA, shadow map size and range,
tree / grass density and draw distances, detail normal maps, light-shaft samples, and how
many people and animals there are and how far away they are drawn. On top
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
  water (`water.js`), synthesised wind, water, footstep and hoof sounds (`audio.js`).
- **People and horses** (`people.js`, `horses.js`, `crowd.js`): no model files. Each is built
  from simple shapes on a small skeleton (`rig.js`): men in shalwar kameez with a waistcoat
  and a pakol or turban, women in long dresses and headscarves (some in a blue chadari),
  children, visitors; bay, chestnut, grey and dun horses and donkeys, some with a saddle and
  a red saddle blanket. Walks, runs, gaits from walk to gallop, grazing, talking, waving,
  pointing at the cliff and working in the fields are posed in code. All people are one
  instanced draw call and all horses another: each frame the bone matrices and clothing
  colours go into a float texture that the vertex shader reads per instance. They wander
  their own area on open, gentle ground (never through houses or the river), and soft
  shadows under them lean away from the sun.
- **Player** (`player.js`): first or third person (a camera over the shoulder that is pulled
  in by walls), and riding: the horse turns toward where you steer, blends its gait with its
  speed and stops at walls.
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
