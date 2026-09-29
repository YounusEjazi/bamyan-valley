// Rivers and streams for the app from OpenStreetMap -> public/models/water.json.
// Input: the Blender pipeline's data/osm_local.json (scripts/prepare_osm.py: local metres,
// origin = big niche, x east, y north). Lines keep their OSM direction (= flow direction),
// are clipped to the satellite texture area, simplified and resampled; y north becomes
// three's -z. Data (c) OpenStreetMap contributors, ODbL.
// Run with: node scripts/make-water.mjs <path to osm_local.json>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/make-water.mjs <path to osm_local.json>");
  process.exit(1);
}
const EXTENT = [-9000, -5500, 9300, 5700];   // x / y north range (m), ~ the valley texture
const STEP = { river: 6, stream: 8 };        // resample spacing (m)

const osm = JSON.parse(readFileSync(src, "utf8"));
const inside = ([x, y]) => x > EXTENT[0] && x < EXTENT[2] && y > EXTENT[1] && y < EXTENT[3];

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d < len) {
      const t = d / len;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += step;
    }
    carry = len - (d - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// smooth the corners a little (Chaikin-like average), keep the ends
function smooth(pts) {
  return pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p
    : [(pts[i - 1][0] + 2 * p[0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * p[1] + pts[i + 1][1]) / 4]));
}

const lines = [];
for (const w of osm.waterways) {
  // split into runs of points inside the extent
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const pts = smooth(resample(run, STEP[w.k] ?? 8));
      lines.push({
        kind: w.k, name: w.n || "", width: w.w,
        points: pts.flatMap(([x, y]) => [+x.toFixed(1), +(-y).toFixed(1)]),
      });
    }
    run = [];
  };
  for (const p of w.p) {
    if (inside(p)) run.push(p);
    else flush();
  }
  flush();
}
const out = { credit: "(c) OpenStreetMap contributors, ODbL", lines };
writeFileSync(join(ROOT, "public", "models", "water.json"), JSON.stringify(out));
console.log(`water.json: ${lines.length} lines, ${lines.reduce((s, l) => s + l.points.length / 2, 0)} points`);
