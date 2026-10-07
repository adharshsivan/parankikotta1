import * as THREE from "three";
import {
  BASTIONS,
  CENTRE,
  CURB_T,
  GROUND_Y,
  HALF_T,
  INNER,
  MOAT_BED_Y,
  MOAT_INNER,
  MOAT_OUTER,
  MOAT_WATER_Y,
  OUTER,
  PARAPET_T,
  WALK_Y,
  addP,
  inOrientedRect,
  lenP,
  lerpP,
  mulP,
  normP,
  pointInPolygon,
  pt,
  subP,
  type Point,
} from "./plan";
import { Batcher, boxGeo, prismGeo, scaleUVs, type FortMaterials } from "./materials";

/*
 * The whole seaward half of Paranki Kotta came down centuries ago: the sea
 * bastion, the tide bastion and every curtain between them. The landward half
 * still stands - gate, courtyard and the walls either side - and ends at two
 * breaks. Beyond them there are only low footings, slumped rubble and the old
 * ditch. Everything here is generated once from the fort plan, so the render
 * mesh and the walking rules always agree.
 */

function rand(index: number, seed: number) {
  const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/* ------------------------------------------------------------------ */
/* Where the standing wall ends                                         */
/* ------------------------------------------------------------------ */

export type Cut = {
  edge: number;
  centre: Point;
  along: Point;
  normal: Point;
  /** Unit direction from the cut into the ruin. */
  ruin: Point;
  outer: Point;
  inner: Point;
  deckOuter: Point;
  deckInner: Point;
};

function makeCut(edge: number, t: number, ruinSign: 1 | -1): Cut {
  const a = CENTRE[edge];
  const b = CENTRE[(edge + 1) % CENTRE.length];
  const d = subP(b, a);
  const along = normP(d);
  const normal = pt(along.z, -along.x);
  const centre = addP(a, mulP(d, t));
  return {
    edge,
    centre,
    along,
    normal,
    ruin: mulP(along, ruinSign),
    outer: addP(centre, mulP(normal, HALF_T)),
    inner: subP(centre, mulP(normal, HALF_T)),
    deckOuter: addP(centre, mulP(normal, HALF_T - PARAPET_T)),
    deckInner: subP(centre, mulP(normal, HALF_T - CURB_T)),
  };
}

/** Just past the west bastion: the north-west curtain is gone beyond here. */
export const WEST_CUT = makeCut(1, 0.38, 1);
/** Just short of the east bastion: the north-east curtain is gone beyond here. */
export const EAST_CUT = makeCut(3, 0.58, -1);

/** u runs from a cut into the ruin, v runs outward across the wall. */
function cutLocal(cut: Cut, x: number, z: number) {
  const dx = x - cut.centre.x;
  const dz = z - cut.centre.z;
  return { u: dx * cut.ruin.x + dz * cut.ruin.z, v: dx * cut.normal.x + dz * cut.normal.z };
}

function cutPoint(cut: Cut, u: number, v: number): Point {
  return addP(addP(cut.centre, mulP(cut.ruin, u)), mulP(cut.normal, v));
}

/** Footprint of everything that fell: both sea bastions and the curtains between the cuts. */
export const RUIN_BAND: Point[] = [
  WEST_CUT.outer,
  ...OUTER.slice(10, 20),
  EAST_CUT.outer,
  EAST_CUT.inner,
  INNER[3],
  INNER[2],
  WEST_CUT.inner,
];

export function inRuinBand(x: number, z: number) {
  return pointInPolygon(pt(x, z), RUIN_BAND);
}

/* ------------------------------------------------------------------ */
/* The two breaks                                                       */
/* ------------------------------------------------------------------ */

/** West: the wall ends in a broken stump - a taller outer face, a lower core. */
const WEST_STUMP = {
  outer: { length: 3.0, heights: [4.5, 4.14, 3.62, 3.18, 2.42, 1.76, 1.15] },
  inner: { length: 2.2, heights: [4.26, 3.64, 2.98, 2.18, 1.46, 0.92] },
};

/** East: the wall slumped into a long slope of rubble, now a way on and off the rampart. */
export const RAMP_LENGTH = 8.5;
const LANE_V0 = -1.25;
const LANE_V1 = 0.8;
const BANK_IN = -1.4;
const BANK_OUT = 0.95;
const RAMP_EXIT = cutPoint(EAST_CUT, RAMP_LENGTH + 1.6, (LANE_V0 + LANE_V1) / 2);

function rampHeight(u: number) {
  const t = Math.max(0, Math.min(1, u / RAMP_LENGTH));
  return WALK_Y + (GROUND_Y - WALK_Y) * t;
}

/** Walking height on the rubble slope's lane, or null when off it. */
export function rampSample(x: number, z: number): number | null {
  const { u, v } = cutLocal(EAST_CUT, x, z);
  if (u < -0.05 || u > RAMP_LENGTH + 0.05) return null;
  if (v < LANE_V0 || v > LANE_V1) return null;
  return rampHeight(u);
}

function rampBankSolid(x: number, z: number) {
  const { u, v } = cutLocal(EAST_CUT, x, z);
  if (u < 0 || u > RAMP_LENGTH + 0.1) return false;
  if (v < -HALF_T - 0.3 || v > HALF_T + 0.3) return false;
  return v < LANE_V0 || v > LANE_V1;
}

function westStumpSolid(x: number, z: number) {
  const { u, v } = cutLocal(WEST_CUT, x, z);
  if (u < -0.02) return false;
  if (v >= 0 && v <= HALF_T + 0.3) return u <= WEST_STUMP.outer.length + 0.3;
  if (v < 0 && v >= -HALF_T - 0.3) return u <= WEST_STUMP.inner.length + 0.3;
  return false;
}

/** Masonry that can never be entered: the west stump and the slope's banks. */
export function ruinSolid(x: number, z: number) {
  return westStumpSolid(x, z) || rampBankSolid(x, z);
}

/* ------------------------------------------------------------------ */
/* Keeping the ruin explorable                                          */
/* ------------------------------------------------------------------ */

const NORTH_DIR = normP(subP(CENTRE[3], CENTRE[2]));
const NORTH_OUT = pt(NORTH_DIR.z, -NORTH_DIR.x);

/** A clear way north through the fallen curtain, from the courtyard to the ditch edge. */
const CORRIDOR = {
  centre: addP(lerpP(CENTRE[2], CENTRE[3], 0.48), mulP(NORTH_OUT, 0.5)),
  dir: NORTH_OUT,
  halfLen: 7.5,
  halfWidth: 1.3,
};

/** Routes that must stay open: the slope, the ground at its foot and the corridor north. */
function onRoute(p: Point, margin: number) {
  const r = cutLocal(EAST_CUT, p.x, p.z);
  if (r.u > -0.8 - margin && r.u < RAMP_LENGTH + 0.6 + margin && Math.abs(r.v) < HALF_T + 0.6 + margin) {
    return true;
  }
  if (lenP(subP(p, RAMP_EXIT)) < 3.0 + margin) return true;
  return inOrientedRect(p.x, p.z, CORRIDOR.centre, CORRIDOR.dir, CORRIDOR.halfLen, CORRIDOR.halfWidth + margin);
}

function onStump(p: Point) {
  const w = cutLocal(WEST_CUT, p.x, p.z);
  return w.u > -0.8 && w.u < WEST_STUMP.outer.length + 0.4 && Math.abs(w.v) < HALF_T + 0.5;
}

/** Standing masonry or the open courtyard - no rubble belongs there. */
function inStandingFort(p: Point) {
  return pointInPolygon(p, OUTER) && !inRuinBand(p.x, p.z);
}

function onLand(p: Point) {
  return pointInPolygon(p, MOAT_INNER);
}

function inDitch(p: Point) {
  return pointInPolygon(p, MOAT_OUTER) && !onLand(p);
}

function groundAt(p: Point) {
  return inRuinBand(p.x, p.z) ? GROUND_Y : 0;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */

/**
 * A solid of broken masonry. The footprint runs `length` along `dir` and spans
 * [across0, across1] along `side`; the top follows a ragged profile of heights
 * spaced evenly along the length. The base is sunk below grade so nothing
 * floats.
 */
function raggedSlab(
  origin: Point,
  dir: Point,
  length: number,
  side: Point,
  across0: number,
  across1: number,
  heights: number[],
) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.12);
  shape.lineTo(length, -0.12);
  for (let i = heights.length - 1; i >= 0; i--) {
    shape.lineTo((length * i) / (heights.length - 1), heights[i]);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: across1 - across0,
    bevelEnabled: false,
    curveSegments: 1,
  });
  scaleUVs(geometry, 0.2);
  const zDir = pt(-dir.z, dir.x);
  const towardSide = zDir.x * side.x + zDir.z * side.z > 0;
  const start = addP(origin, mulP(side, towardSide ? across0 : across1));
  const matrix = new THREE.Matrix4().set(
    dir.x, 0, zDir.x, start.x,
    0, 1, 0, 0,
    dir.z, 0, zDir.z, start.z,
    0, 0, 0, 1,
  );
  return { geometry, matrix };
}

/** Broken parapet and curb remains either side of the slope, always above the lane. */
function bankProfile(seed: number) {
  const stations = 8;
  return Array.from({ length: stations }, (_, i) => {
    const u = (RAMP_LENGTH * i) / (stations - 1);
    const lift = 0.15 + 0.48 * (1 - i / (stations - 1)) + (rand(seed + i, 9) - 0.5) * 0.22;
    return rampHeight(u) + Math.max(0.1, lift);
  });
}

/* ------------------------------------------------------------------ */
/* Footings: the outline of what fell                                   */
/* ------------------------------------------------------------------ */

type Footing = {
  origin: Point;
  dir: Point;
  length: number;
  side: Point;
  depth: number;
  heights: number[];
  key: "wall" | "base";
};
type Rect = { centre: Point; dir: Point; halfAlong: number; halfAcross: number };

const FOOTINGS: Footing[] = [];
const FOOTING_RECTS: Rect[] = [];

function addFootingRun(
  a: Point,
  b: Point,
  side: Point,
  depth: number,
  seed: number,
  baseHeight: number,
  heightRange: number,
  keepChance: number,
) {
  const length = lenP(subP(b, a));
  const dir = normP(subP(b, a));
  let s = 0.25 + rand(seed, 1) * 0.9;
  for (let k = 0; k < 10 && s < length - 0.9; k++) {
    const run = Math.min(1.8 + rand(seed * 7 + k, 2) * 2.3, length - s - 0.15);
    if (run < 0.9) break;
    const origin = addP(a, mulP(dir, s));
    const far = addP(origin, mulP(dir, run));
    const corners = [origin, far, addP(far, mulP(side, depth)), addP(origin, mulP(side, depth))];
    const centre = addP(addP(origin, mulP(dir, run / 2)), mulP(side, depth / 2));
    const clear = [...corners, centre].every((c) => !onRoute(c, 0.15) && !onStump(c));
    if (clear && rand(seed * 13 + k, 3) < keepChance) {
      const h = baseHeight + rand(seed * 17 + k, 4) * heightRange;
      const jitter = (n: number) => 0.82 + rand(seed * 23 + k * 5 + n, 6) * 0.34;
      FOOTINGS.push({
        origin,
        dir,
        length: run,
        side,
        depth,
        heights: [h * 0.5, h * jitter(1), h * jitter(2), h * jitter(3), h * 0.62],
        key: rand(seed * 29 + k, 7) > 0.45 ? "base" : "wall",
      });
      FOOTING_RECTS.push({ centre, dir, halfAlong: run / 2 + 0.3, halfAcross: depth / 2 + 0.3 });
    }
    s += run + 0.9 + rand(seed * 19 + k, 5) * 1.5;
  }
}

/** The fallen outer face: from the west stump around both bastions to the slope. */
const RUIN_TRACE: Point[] = [WEST_CUT.outer, ...OUTER.slice(10, 20), EAST_CUT.outer];
/** Depth of footing left behind each face: curtains thickest, bastion flanks thinnest. */
const TRACE_DEPTH = [0, 1.6, 1.9, 1.9, 1.6, 2.4, 1.6, 1.9, 1.9, 1.6, 0];

for (let i = 1; i <= 9; i++) {
  const a = RUIN_TRACE[i];
  const b = RUIN_TRACE[i + 1];
  const dir = normP(subP(b, a));
  addFootingRun(a, b, pt(-dir.z, dir.x), TRACE_DEPTH[i], i, 0.45, 1.25, 0.8);
}

// The courtyard face of the fallen curtains survives as a lower, thinner line.
const INNER_RUNS: [Point, Point][] = [
  [WEST_CUT.inner, INNER[2]],
  [INNER[2], INNER[3]],
];
INNER_RUNS.forEach(([a, b], j) => {
  const dir = normP(subP(b, a));
  addFootingRun(a, b, pt(dir.z, -dir.x), 1.1, 40 + j, 0.3, 0.65, 0.68);
});

/* ------------------------------------------------------------------ */
/* Rubble heaps and fallen blocks                                       */
/* ------------------------------------------------------------------ */

type Mound = { p: Point; y: number; rx: number; ry: number; rz: number; yaw: number };
type Block = {
  p: Point;
  y: number;
  size: [number, number, number];
  rot: [number, number, number];
  key: "wall" | "base" | "cap";
};

const MOUNDS: Mound[] = [];
const BLOCKS: Block[] = [];
const BLOCKERS: { x: number; z: number; r: number }[] = [];

function addMound(p: Point, rx: number, rz: number, ry: number, yaw: number) {
  if (onLand(p)) {
    if (inStandingFort(p) || onRoute(p, Math.max(rx, rz) * 0.9)) return;
    MOUNDS.push({ p, y: groundAt(p) - ry * 0.32, rx, ry, rz, yaw });
    BLOCKERS.push({ x: p.x, z: p.z, r: Math.min(rx, rz) * 0.92 });
  } else if (inDitch(p)) {
    // Heaps in the old ditch rise from the bed and break the water.
    MOUNDS.push({ p, y: MOAT_BED_Y + 0.25, rx, ry: ry + 1.2, rz, yaw });
  }
}

const SEA = BASTIONS[2];
const TIDE = BASTIONS[3];

// The bastion fill slumped into broad heaps inside each fallen outline.
addMound(lerpP(CENTRE[2], SEA.apex, 0.45), 2.5, 2.1, 1.25, 0.4);
addMound(lerpP(CENTRE[2], SEA.apex, 0.76), 1.7, 1.4, 0.85, 1.2);
addMound(lerpP(CENTRE[3], TIDE.apex, 0.62), 2.2, 1.9, 1.1, -0.5);
addMound(lerpP(CENTRE[3], TIDE.apex, 0.86), 1.4, 1.2, 0.7, 0.9);
// Along the line where the north curtain stood.
addMound(lerpP(CENTRE[2], CENTRE[3], 0.2), 1.9, 1.3, 0.95, Math.atan2(NORTH_DIR.x, NORTH_DIR.z));
addMound(lerpP(CENTRE[2], CENTRE[3], 0.64), 1.2, 1.0, 0.7, Math.atan2(NORTH_DIR.x, NORTH_DIR.z));
// Talus spilled outward from every fallen face, onto the berm and into the ditch.
for (let i = 1; i <= 9; i++) {
  const a = RUIN_TRACE[i];
  const b = RUIN_TRACE[i + 1];
  const dir = normP(subP(b, a));
  const outward = pt(dir.z, -dir.x);
  const yaw = Math.atan2(dir.x, dir.z);
  if (lenP(subP(b, a)) > 4) {
    addMound(addP(lerpP(a, b, 0.3), mulP(outward, 2.1)), 1.6, 1.2, 0.8, yaw);
    addMound(addP(lerpP(a, b, 0.72), mulP(outward, 2.4)), 1.3, 1.1, 0.7, yaw + 0.6);
    addMound(addP(lerpP(a, b, 0.5), mulP(outward, 7.2)), 2.3, 1.8, 1.0, yaw + 0.3);
  } else {
    addMound(addP(lerpP(a, b, 0.5), mulP(outward, 1.8)), 1.1, 0.9, 0.6, yaw + 0.5);
  }
}
// Rubble heaped against the foot of the west stump, inside and out.
addMound(cutPoint(WEST_CUT, 4.6, 0.6), 1.6, 1.3, 0.9, 0.2);
addMound(cutPoint(WEST_CUT, 2.0, HALF_T + 2.0), 1.5, 1.1, 0.75, 0.9);

// Dressed blocks thrown clear when the walls fell.
MOUNDS.slice().forEach((mound, i) => {
  const land = onLand(mound.p);
  for (let k = 0; k < 2; k++) {
    const angle = rand(i * 3 + k, 11) * Math.PI * 2;
    const dist = Math.max(mound.rx, mound.rz) * (0.95 + rand(i * 5 + k, 12) * 0.35);
    const p = addP(mound.p, pt(Math.cos(angle) * dist, Math.sin(angle) * dist));
    const size: [number, number, number] = [
      0.9 + rand(i * 7 + k, 13) * 0.9,
      0.42 + rand(i * 11 + k, 14) * 0.34,
      0.7 + rand(i * 13 + k, 15) * 0.6,
    ];
    const rot: [number, number, number] = [
      (rand(i * 17 + k, 16) - 0.5) * 0.7,
      rand(i * 19 + k, 17) * Math.PI,
      (rand(i * 23 + k, 18) - 0.5) * 0.7,
    ];
    if (land) {
      if (!onLand(p) || inStandingFort(p) || onRoute(p, 0.9)) continue;
      BLOCKS.push({ p, y: groundAt(p) + size[1] * 0.2, size, rot, key: k === 0 ? "base" : "wall" });
      BLOCKERS.push({ x: p.x, z: p.z, r: Math.max(size[0], size[2]) * 0.55 + 0.15 });
    } else if (inDitch(p)) {
      BLOCKS.push({ p, y: MOAT_WATER_Y - 0.15, size, rot, key: "base" });
    }
  }
});

// A run of capstones that fell from the broken west rampart.
const fallenCap = cutPoint(WEST_CUT, 3.9, -1.5);
BLOCKS.push({ p: fallenCap, y: GROUND_Y + 0.08, size: [1.9, 0.3, 1.15], rot: [0.16, 0.5, -0.1], key: "cap" });
BLOCKERS.push({ x: fallenCap.x, z: fallenCap.z, r: 1.05 });

// Loose stones bedded into the banks of the slope. The banks are solid, so no blockers.
const BANK_STONES: [number, number, number][] = [
  [1.6, 1.6, 0.85],
  [3.3, -1.8, 0.7],
  [5.2, 1.55, 0.85],
  [6.9, -1.82, 0.7],
];
for (const [u, v, w] of BANK_STONES) {
  const top = rampHeight(u) + 0.15 + 0.48 * (1 - u / RAMP_LENGTH);
  BLOCKS.push({ p: cutPoint(EAST_CUT, u, v), y: top - 0.05, size: [w, 0.4, 0.55], rot: [0.14, 0.7 + u * 0.3, -0.12], key: "wall" });
}

/* ------------------------------------------------------------------ */
/* Grass in the ruins                                                   */
/* ------------------------------------------------------------------ */

const TUFTS: Point[] = [];
FOOTINGS.forEach((f, i) => {
  if (i % 2 === 1) return;
  const p = addP(addP(f.origin, mulP(f.dir, f.length + 0.35)), mulP(f.side, f.depth * 0.5));
  if (onLand(p) && !inStandingFort(p) && rampSample(p.x, p.z) === null) TUFTS.push(p);
});
MOUNDS.forEach((mound, i) => {
  if (!onLand(mound.p)) return;
  const angle = rand(i, 31) * Math.PI * 2;
  const p = addP(mound.p, pt(Math.cos(angle) * mound.rx * 1.02, Math.sin(angle) * mound.rz * 1.02));
  if (onLand(p) && !inStandingFort(p) && rampSample(p.x, p.z) === null) TUFTS.push(p);
});

/* ------------------------------------------------------------------ */
/* Walking and naming                                                   */
/* ------------------------------------------------------------------ */

/** Footings, heaps and fallen blocks that stop the player at ground level. */
export function ruinBlocked(x: number, z: number) {
  for (const rect of FOOTING_RECTS) {
    if (inOrientedRect(x, z, rect.centre, rect.dir, rect.halfAlong, rect.halfAcross)) return true;
  }
  for (const blocker of BLOCKERS) {
    if (Math.hypot(x - blocker.x, z - blocker.z) < blocker.r) return true;
  }
  return false;
}

const RUIN_NAMES = [
  { name: "Sea bastion ruins", centre: lerpP(CENTRE[2], SEA.apex, 0.5) },
  { name: "Fallen north curtain", centre: lerpP(CENTRE[2], CENTRE[3], 0.5) },
  { name: "Tide bastion ruins", centre: lerpP(CENTRE[3], TIDE.apex, 0.5) },
];

export function ruinLocation(x: number, z: number, y: number): string | null {
  const p = pt(x, z);
  if (rampSample(x, z) !== null && y > 0.4 && y < WALK_Y - 0.2) return "Rubble slope";
  if (y > 2.6) {
    if (lenP(subP(p, WEST_CUT.centre)) < 4.5) return "Broken west rampart";
    if (lenP(subP(p, EAST_CUT.centre)) < 3.5) return "Head of the rubble slope";
    return null;
  }
  const nearRuins = inRuinBand(x, z) || (z < -6 && onLand(p) && !pointInPolygon(p, OUTER));
  if (!nearRuins) return null;
  let best = RUIN_NAMES[0];
  for (const option of RUIN_NAMES) {
    if (lenP(subP(p, option.centre)) < lenP(subP(p, best.centre))) best = option;
  }
  return best.name;
}

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

export function buildRuins(scene: THREE.Scene, batch: Batcher, m: FortMaterials) {
  // Rubble floor across the whole fallen footprint. A shallow solid rather than
  // a sheet, so its edge meets the berm instead of floating above it.
  batch.add("rubble", m.rubble, prismGeo(RUIN_BAND, -0.05, GROUND_Y + 0.046, [], 0.16), undefined, 0.6);

  // The west stump.
  const face = raggedSlab(
    WEST_CUT.centre, WEST_CUT.ruin, WEST_STUMP.outer.length, WEST_CUT.normal, 0, HALF_T, WEST_STUMP.outer.heights,
  );
  batch.add("wall", m.wall, face.geometry, face.matrix);
  const core = raggedSlab(
    WEST_CUT.centre, WEST_CUT.ruin, WEST_STUMP.inner.length, WEST_CUT.normal, -HALF_T, 0, WEST_STUMP.inner.heights,
  );
  batch.add("base", m.base, core.geometry, core.matrix);

  // The east slope: a worn lane between the slumped parapet and curb.
  const lane = raggedSlab(
    EAST_CUT.centre, EAST_CUT.ruin, RAMP_LENGTH, EAST_CUT.normal, BANK_IN - 0.05, BANK_OUT + 0.05, [WALK_Y, GROUND_Y],
  );
  batch.add("rubble", m.rubble, lane.geometry, lane.matrix, 0.8);
  const innerBank = raggedSlab(
    EAST_CUT.centre, EAST_CUT.ruin, RAMP_LENGTH, EAST_CUT.normal, -HALF_T, BANK_IN, bankProfile(60),
  );
  batch.add("base", m.base, innerBank.geometry, innerBank.matrix);
  const outerBank = raggedSlab(
    EAST_CUT.centre, EAST_CUT.ruin, RAMP_LENGTH, EAST_CUT.normal, BANK_OUT, HALF_T, bankProfile(70),
  );
  batch.add("wall", m.wall, outerBank.geometry, outerBank.matrix);

  // Footings.
  for (const f of FOOTINGS) {
    const slab = raggedSlab(f.origin, f.dir, f.length, f.side, 0, f.depth, f.heights);
    batch.add(f.key, f.key === "wall" ? m.wall : m.base, slab.geometry, slab.matrix);
  }

  // Heaps.
  const heap = new THREE.IcosahedronGeometry(1, 1);
  for (const mound of MOUNDS) {
    const geometry = heap.clone();
    scaleUVs(geometry, Math.max(mound.rx, mound.rz) * 0.55);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(mound.p.x, mound.y, mound.p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, mound.yaw, 0)),
      new THREE.Vector3(mound.rx, mound.ry, mound.rz),
    );
    batch.add("rubble", m.rubble, geometry, matrix, 1.2);
  }
  heap.dispose();

  // Fallen blocks.
  const materialFor = { wall: m.wall, base: m.base, cap: m.cap };
  for (const block of BLOCKS) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(block.p.x, block.y, block.p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(block.rot[0], block.rot[1], block.rot[2])),
      new THREE.Vector3(1, 1, 1),
    );
    batch.add(block.key, materialFor[block.key], boxGeo(block.size[0], block.size[1], block.size[2]), matrix, 1.3);
  }

  // Grass that has taken the ruins.
  const blade = new THREE.ConeGeometry(0.12, 0.7, 4);
  TUFTS.forEach((p, i) => {
    for (let k = 0; k < 3; k++) {
      const tuft = new THREE.Mesh(blade, m.grass);
      tuft.position.set(p.x + (k - 1) * 0.32, groundAt(p) + 0.3, p.z + ((k % 2) - 0.5) * 0.36);
      tuft.rotation.set((rand(i * 3 + k, 41) - 0.5) * 0.4, 0, (rand(i * 5 + k, 42) - 0.5) * 0.4);
      tuft.castShadow = true;
      scene.add(tuft);
    }
  });
}
