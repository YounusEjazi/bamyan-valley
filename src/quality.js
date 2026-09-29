// Graphics tiers and device detection. Phones and tablets start on "medium", desktops on
// "high"; ?q=low|medium|high or the menu (saved in localStorage) override it. On top of the
// tier, the render pipeline scales its resolution at runtime to hold the frame rate.
const KEY = "bamyan.quality.v1";
const params = new URLSearchParams(location.search);

export const TIERS = {
  low: {
    label: "Low", maxDpr: 1, scale: 0.85, minScale: 0.5, msaa: 0,
    shadowMap: 1024, shadowHalf: 150,
    treeNear: 150, treeFar: 1800, buildingFar: 3500,
    grassRadius: 38, grassDensity: 0.35,
    detailNormals: false, rays: 0, birds: 10,
  },
  medium: {
    label: "Medium", maxDpr: 1.5, scale: 1, minScale: 0.55, msaa: 4,
    shadowMap: 2048, shadowHalf: 240,
    treeNear: 260, treeFar: 2800, buildingFar: 5500,
    grassRadius: 65, grassDensity: 0.6,
    detailNormals: true, rays: 12, birds: 22,
  },
  high: {
    label: "High", maxDpr: 1.75, scale: 1, minScale: 0.6, msaa: 4,
    shadowMap: 4096, shadowHalf: 380,
    treeNear: 420, treeFar: 3500, buildingFar: 7000,
    grassRadius: 105, grassDensity: 1,
    detailNormals: true, rays: 20, birds: 34,
  },
};

// touch controls: phones / tablets, or ?touch=1 to try them with a mouse
export const isTouch = params.has("touch")
  ? params.get("touch") !== "0"
  : matchMedia("(hover: none) and (pointer: coarse)").matches;

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const tierName = [params.get("q"), stored()].find((n) => n in TIERS) || (isTouch ? "medium" : "high");
export const tier = TIERS[tierName];

export function saveTier(name) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
