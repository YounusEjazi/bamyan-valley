// Download CC0 surface textures from Poly Haven and pack each into one RGB detail map
// for the app's shaders: R = albedo luminance x ambient occlusion, G/B = normal x/y
// (OpenGL convention, z is rebuilt in the shader). One fetch per projection instead of
// three keeps the triplanar rock and the ground cheap on phones.
// Writes public/textures/detail_<name>.jpg and public/textures/detail.json (mean R per map,
// so the shader can add contrast without shifting the satellite / Blender colours).
// Run with: node scripts/build-textures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "textures");
const RES = "1k";
const SIZE = 1024;

// app name -> Poly Haven asset (all CC0, https://polyhaven.com/license)
const MAPS = {
  rock: "cliff_side",          // layered, eroded conglomerate / sandstone
  dry: "dry_ground_rocks",     // bare valley floor, tracks, slopes
  grass: "sparse_grass",       // fields and meadows
  plaster: "clay_plaster",     // mud-plastered houses and walls
};

const url = (asset, map) =>
  `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${RES}/${asset}/${asset}_${map}_${RES}.jpg`;

async function raw(asset, map, channels) {
  const res = await fetch(url(asset, map));
  if (!res.ok) throw new Error(`${asset} ${map}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = sharp(buf).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha();
  return (channels === 1 ? img.greyscale() : img).raw().toBuffer();
}

mkdirSync(OUT, { recursive: true });
const meta = { source: "Poly Haven (CC0)", maps: {} };
for (const [name, asset] of Object.entries(MAPS)) {
  const [diff, nor, ao] = await Promise.all([raw(asset, "diff", 3), raw(asset, "nor_gl", 3), raw(asset, "ao", 1)]);
  const n = SIZE * SIZE;
  const out = Buffer.alloc(n * 3);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = diff[i * 3] / 255, g = diff[i * 3 + 1] / 255, b = diff[i * 3 + 2] / 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * (0.35 + 0.65 * (ao[i] / 255));
    const v = Math.min(255, Math.round(lum * 255));
    sum += v;
    out[i * 3] = v;
    out[i * 3 + 1] = nor[i * 3];
    out[i * 3 + 2] = nor[i * 3 + 1];
  }
  const file = `detail_${name}.jpg`;
  // 4:4:4 keeps the packed channels from bleeding into each other
  await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(join(OUT, file));
  meta.maps[name] = { file: `textures/${file}`, asset, mean: +(sum / n / 255).toFixed(4) };
  console.log(`${file} <- ${asset} (mean ${meta.maps[name].mean})`);
}
writeFileSync(join(OUT, "detail.json"), `${JSON.stringify(meta, null, 2)}\n`);
