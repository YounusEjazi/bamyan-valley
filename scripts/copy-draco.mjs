// Copy three.js's Draco decoder into public/draco/ so the app serves it itself.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(web, "node_modules", "three", "examples", "jsm", "libs", "draco", "gltf");
const dst = join(web, "public", "draco");
if (!existsSync(src)) {
  console.error(`Draco decoder not found at ${src}; run npm install first`);
  process.exit(1);
}
cpSync(src, dst, { recursive: true });
console.log(`copied Draco decoder -> ${dst}`);
