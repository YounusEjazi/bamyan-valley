# Bamyan Valley

An explorable 3D model of the Bamyan valley in Afghanistan and the cliff of the two
destroyed Buddha statues, built with [three.js](https://threejs.org/).

Walk the fields and the town below the cliff, climb to the niches, or fly over the valley,
and find the 14 places hidden around it: the Great and Small Buddha niches, the cave
monasteries, the cliff top, the Bamian River, the bazaar, Shahr-i Ghulghula and more.
Each discovery adds an entry to your journal.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and click **Click to explore**.
`npm run build` writes a static site to `dist/`.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | move |
| Mouse | look |
| Shift | run / fly fast |
| Space | jump / fly up |
| C | fly down |
| F | switch walk / fly |
| J | journal |
| Esc | menu (viewpoints, sun) |

## How it's made

The terrain, the cliff and the town are real-world data, processed in Blender and Python
and exported to `public/`:

- **Terrain**: Copernicus DEM GLO-30, reprojected to UTM 42N (1 unit = 1 m).
- **Buddha cliff**: a ~1 m detail mesh modelled procedurally along the DEM cliff line and
  matched against reference photos (erosion columns, caves, the 58 m niche, rubble slopes).
- **Ground**: a Sentinel-2 image (24 June 2025) with OpenStreetMap roads, tracks and the river.
- **Town and trees**: OpenStreetMap building footprints extruded as mud-brick houses;
  poplar, willow and fruit trees placed along roads, channels, field edges and houses.

Coordinates: X east, Y up, -Z north; the origin is the Great Buddha niche.

## Credits and licences

- Terrain: Copernicus DEM GLO-30, © DLR e.V. 2010-2014 and © Airbus Defence and Space
  GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- Contains modified Copernicus Sentinel data 2025.
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  available under the Open Database License (ODbL). The buildings, roads, trees and
  place data in `public/` are derived from it.
- Facts in the journal: [UNESCO](https://whc.unesco.org/en/list/208/),
  [Wikipedia](https://en.wikipedia.org/wiki/Buddhas_of_Bamiyan).
- three.js and three-mesh-bvh are MIT licensed.
