/**
 * Paranki Kotta - defensive plan.
 *
 * All measurements are metres. The plan is an irregular six sided Dutch style
 * trace with an angled bastion on every corner, one gate in the south curtain,
 * and a water filled moat that follows the outer face at a varying distance.
 *
 * Vertical setout is shared by the render mesh and the traversal rules so the
 * two can never drift apart: every walkable surface sits at WALK_Y, every
 * ground surface at GROUND_Y.
 */

export type Point = { x: number; z: number };

export const pt = (x: number, z: number): Point => ({ x, z });
export const addP = (a: Point, b: Point): Point => pt(a.x + b.x, a.z + b.z);
export const subP = (a: Point, b: Point): Point => pt(a.x - b.x, a.z - b.z);
export const mulP = (a: Point, s: number): Point => pt(a.x * s, a.z * s);
export const lenP = (a: Point) => Math.hypot(a.x, a.z);
export const normP = (a: Point): Point => {
  const length = lenP(a) || 1;
  return pt(a.x / length, a.z / length);
};
export const lerpP = (a: Point, b: Point, t: number): Point =>
  pt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
/** Outward normal of edge a->b for a polygon wound with positive signed area. */
export const edgeNormal = (a: Point, b: Point): Point => {
  const d = normP(subP(b, a));
  return pt(d.z, -d.x);
};

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > point.z !== b.z > point.z) {
      const crossingX = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
      if (point.x < crossingX) inside = !inside;
    }
  }
  return inside;
}

/** Mitred polygon offset. Positive distance pushes the outline outward. */
export function offsetPolygon(points: Point[], distance: number): Point[] {
  const count = points.length;
  const result: Point[] = [];
  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count];
    const curr = points[i];
    const next = points[(i + 1) % count];
    const n1 = edgeNormal(prev, curr);
    const n2 = edgeNormal(curr, next);
    const bisector = normP(addP(n1, n2));
    const cosHalf = bisector.x * n1.x + bisector.z * n1.z;
    const miter = Math.abs(cosHalf) < 0.26 ? 3.8 : 1 / cosHalf;
    result.push(addP(curr, mulP(bisector, distance * miter)));
  }
  return result;
}

export function closestOnSegment(point: Point, a: Point, b: Point) {
  const d = subP(b, a);
  const lengthSq = d.x * d.x + d.z * d.z || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * d.x + (point.z - a.z) * d.z) / lengthSq));
  const closest = addP(a, mulP(d, t));
  return { t, closest, distance: lenP(subP(point, closest)) };
}

/* ------------------------------------------------------------------ */
/* Vertical setout                                                      */
/* ------------------------------------------------------------------ */

export const WALL_T = 4.4;
export const HALF_T = WALL_T / 2;
export const MASS_TOP = 4.72;
export const WALK_Y = 4.8;
export const PARAPET_T = 1.0;
export const PARAPET_H = 1.2;
export const CURB_T = 0.6;
export const CURB_H = 0.58;
export const PLINTH_H = 2.2;
export const GROUND_Y = 0.08;

export const MOAT_BERM = 4.2;
export const MOAT_WIDTH = 9.4;
export const MOAT_BED_Y = -2.45;
export const MOAT_WATER_Y = -0.72;

export const GATE_X = -1.5;
export const GATE_HALF = 2.3;
export const GATE_SOUTH_Z = 12.3;
export const GATE_OUTER_Z = GATE_SOUTH_Z + HALF_T;
export const GATE_INNER_Z = GATE_SOUTH_Z - HALF_T;
export const GATE_SOFFIT = 3.95;
export const GATE_SPRING = 3.0;

/* ------------------------------------------------------------------ */
/* Trace                                                                */
/* ------------------------------------------------------------------ */

export const CENTRE: Point[] = [
  pt(-14.5, GATE_SOUTH_Z),
  pt(-17.2, -2.6),
  pt(-7.0, -14.5),
  pt(9.7, -14.0),
  pt(16.3, -0.9),
  pt(10.1, GATE_SOUTH_Z),
];

export const BASTION_NAMES = [
  "Palm bastion",
  "West bastion",
  "Sea bastion",
  "Tide bastion",
  "East bastion",
  "Gate bastion",
];

const BASTION_SPEC = [
  { gorge: 5.6, flank: 3.0, salient: 6.2 },
  { gorge: 5.2, flank: 3.4, salient: 7.0 },
  { gorge: 5.9, flank: 3.2, salient: 6.7 },
  { gorge: 5.4, flank: 3.5, salient: 7.3 },
  { gorge: 5.0, flank: 3.0, salient: 6.1 },
  { gorge: 5.6, flank: 3.2, salient: 6.4 },
];

export type BastionTrace = {
  index: number;
  gorgeA: Point;
  shoulderA: Point;
  apex: Point;
  shoulderB: Point;
  gorgeB: Point;
  bisector: Point;
};

function buildBastions(centre: Point[]): BastionTrace[] {
  const count = centre.length;
  const result: BastionTrace[] = [];
  for (let i = 0; i < count; i++) {
    const prev = centre[(i - 1 + count) % count];
    const curr = centre[i];
    const next = centre[(i + 1) % count];
    const spec = BASTION_SPEC[i % BASTION_SPEC.length];
    const dIn = normP(subP(curr, prev));
    const dOut = normP(subP(next, curr));
    const nIn = pt(dIn.z, -dIn.x);
    const nOut = pt(dOut.z, -dOut.x);
    const bisector = normP(addP(nIn, nOut));
    const gorgeA = addP(subP(curr, mulP(dIn, spec.gorge)), mulP(nIn, HALF_T));
    const gorgeB = addP(addP(curr, mulP(dOut, spec.gorge)), mulP(nOut, HALF_T));
    result.push({
      index: i,
      gorgeA,
      shoulderA: addP(gorgeA, mulP(nIn, spec.flank)),
      apex: addP(curr, mulP(bisector, HALF_T + spec.salient)),
      shoulderB: addP(gorgeB, mulP(nOut, spec.flank)),
      gorgeB,
      bisector,
    });
  }
  return result;
}

export const BASTIONS = buildBastions(CENTRE);
export const OUTER: Point[] = BASTIONS.flatMap((b) => [b.gorgeA, b.shoulderA, b.apex, b.shoulderB, b.gorgeB]);
export const INNER: Point[] = offsetPolygon(CENTRE, -HALF_T);

/** Rampart walk: wide, continuous, safe, and separated from parapet / curb. */
export const DECK_OUTER = offsetPolygon(OUTER, -PARAPET_T);
export const DECK_INNER = offsetPolygon(INNER, CURB_T);
export const WALK_OUTER = offsetPolygon(OUTER, -(PARAPET_T + 0.34));
export const WALK_INNER = offsetPolygon(INNER, CURB_T + 0.28);

export const FORT_CENTROID = (() => {
  let x = 0;
  let z = 0;
  for (const point of OUTER) {
    x += point.x;
    z += point.z;
  }
  return pt(x / OUTER.length, z / OUTER.length);
})();

function rayReach(origin: Point, direction: Point, polygon: Point[]) {
  let best = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const edge = subP(b, a);
    const denominator = direction.x * edge.z - direction.z * edge.x;
    if (Math.abs(denominator) < 1e-6) continue;
    const delta = subP(a, origin);
    const t = (delta.x * edge.z - delta.z * edge.x) / denominator;
    const u = (delta.x * direction.z - delta.z * direction.x) / denominator;
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return best;
}

const MOAT_SAMPLES = 128;
const MOAT_REACH = (() => {
  const raw: number[] = [];
  for (let i = 0; i < MOAT_SAMPLES; i++) {
    const angle = (i / MOAT_SAMPLES) * Math.PI * 2;
    raw.push(rayReach(FORT_CENTROID, pt(Math.sin(angle), Math.cos(angle)), OUTER));
  }
  return raw.map((_, i) => {
    let best = 0;
    for (let k = -3; k <= 3; k++) best = Math.max(best, raw[(i + k + MOAT_SAMPLES) % MOAT_SAMPLES]);
    return best;
  });
})();

function radialRing(gap: number, amplitude: number, seed: number) {
  const ring: Point[] = [];
  const gateDirection = normP(subP(pt(GATE_X, GATE_OUTER_Z), FORT_CENTROID));
  for (let i = 0; i < MOAT_SAMPLES; i++) {
    const angle = (i / MOAT_SAMPLES) * Math.PI * 2;
    const direction = pt(Math.sin(angle), Math.cos(angle));
    const alignment = direction.x * gateDirection.x + direction.z * gateDirection.z;
    const gateGuard = alignment > 0.92 ? 0.06 : 1;
    const wobble = (Math.sin(angle * 3 + seed) * 0.6 + Math.sin(angle * 5.3 - seed * 1.7) * 0.4) * amplitude * gateGuard;
    ring.push(addP(FORT_CENTROID, mulP(direction, MOAT_REACH[i] + gap + wobble)));
  }
  return ring;
}

export const MOAT_INNER = radialRing(MOAT_BERM, 0.9, 3);
export const MOAT_OUTER = radialRing(MOAT_BERM + MOAT_WIDTH, 1.7, 11);
export const MOAT_BED_OUTER = radialRing(MOAT_BERM + MOAT_WIDTH - 2.2, 1.7, 11);

/* ------------------------------------------------------------------ */
/* Stairs - reduced to only the access needed for clean navigation      */
/* ------------------------------------------------------------------ */

export type Stair = {
  name: string;
  base: Point;
  up: Point;
  side: Point;
  run: number;
  climb: number;
  width: number;
  steps: number;
  head: Point;
  rail: number;
};

export const STAIR_WIDTH = 3.2;
export const STAIR_RUN = 7.0;
export const STAIR_CLIMB = 5.6;
export const STAIR_LANDING = STAIR_RUN - STAIR_CLIMB;
export const STAIR_STEPS = 16;
export const STAIR_TREAD_DEPTH = STAIR_CLIMB / STAIR_STEPS;
export const STAIR_RISE_HEIGHT = (WALK_Y - GROUND_Y) / STAIR_STEPS;

function makeStair(name: string, edgeIndex: number, headT: number): Stair {
  const a = INNER[edgeIndex];
  const b = INNER[(edgeIndex + 1) % INNER.length];
  const along = normP(subP(b, a));
  const inward = pt(-along.z, along.x);
  const edgeLength = lenP(subP(b, a));
  const minT = STAIR_RUN + 0.7;
  const maxT = edgeLength - 0.7;
  const clampedT = Math.max(minT, Math.min(maxT, headT * edgeLength));
  const head = addP(a, mulP(along, clampedT));
  return {
    name,
    base: subP(head, mulP(along, STAIR_RUN)),
    up: along,
    side: inward,
    run: STAIR_RUN,
    climb: STAIR_CLIMB,
    width: STAIR_WIDTH,
    steps: STAIR_STEPS,
    head,
    rail: 0.62,
  };
}

/**
 * One stair, on the west curtain, well away from the gate. The other way on
 * and off the rampart is the rubble slope where the east wall fell.
 */
export const STAIRS: Stair[] = [makeStair("West stair", 0, 0.55)];

export function stairWallSpan(stair: Stair) {
  return { from: stair.base, to: stair.head };
}

/* ------------------------------------------------------------------ */
/* Gun positions                                                        */
/* ------------------------------------------------------------------ */

export type CannonSlot = {
  position: Point;
  facing: Point;
  edgeIndex: number;
  onBastion: number | null;
};

export const CANNON_SETBACK = 1.95;

function bastionSlot(bastionIndex: number, face: 0 | 1): CannonSlot {
  const base = bastionIndex * 5;
  const edgeIndex = face === 0 ? base + 1 : base + 2;
  const a = OUTER[edgeIndex];
  const b = OUTER[(edgeIndex + 1) % OUTER.length];
  const normal = edgeNormal(a, b);
  const mid = lerpP(a, b, 0.5);
  return {
    position: subP(mid, mulP(normal, CANNON_SETBACK)),
    facing: normal,
    edgeIndex,
    onBastion: bastionIndex,
  };
}

/** Guns only on the bastions that still stand. The fallen backside has none. */
export const CANNONS: CannonSlot[] = [bastionSlot(0, 1), bastionSlot(4, 0), bastionSlot(5, 0)];

/* ------------------------------------------------------------------ */
/* Courtyard                                                            */
/* ------------------------------------------------------------------ */

export const WELL = { centre: pt(1.8, -1.0), radius: 1.15 };

/* ------------------------------------------------------------------ */
/* Bridge                                                               */
/* ------------------------------------------------------------------ */

export const BRIDGE = {
  x: GATE_X,
  halfWidth: 2.6,
  deckY: 0.12,
  startZ: GATE_OUTER_Z + 2.2,
  endZ: GATE_OUTER_Z + MOAT_BERM + MOAT_WIDTH + 2.4,
};

export function isOnBridge(x: number, z: number, pad = 0) {
  return Math.abs(x - BRIDGE.x) <= BRIDGE.halfWidth + pad && z >= BRIDGE.startZ - pad && z <= BRIDGE.endZ + pad;
}

export function isInGatePassage(x: number, z: number, pad = 0) {
  return Math.abs(x - GATE_X) <= GATE_HALF - 0.35 + pad && z >= GATE_INNER_Z - 0.6 - pad && z <= GATE_OUTER_Z + 1.6 + pad;
}

export function inOrientedRect(
  x: number,
  z: number,
  centre: Point,
  along: Point,
  halfAlong: number,
  halfAcross: number,
) {
  const dx = x - centre.x;
  const dz = z - centre.z;
  const u = dx * along.x + dz * along.z;
  const v = dx * -along.z + dz * along.x;
  return Math.abs(u) <= halfAlong && Math.abs(v) <= halfAcross;
}

export function stairLocal(stair: Stair, x: number, z: number) {
  const d = pt(x - stair.base.x, z - stair.base.z);
  return {
    u: d.x * stair.up.x + d.z * stair.up.z,
    v: d.x * stair.side.x + d.z * stair.side.z,
  };
}

export function stairSample(stair: Stair, x: number, z: number) {
  const { u, v } = stairLocal(stair, x, z);
  if (u < -0.35 || u > stair.run + 0.1) return null;
  const vMin = u > stair.climb - 0.18 ? -0.74 : -0.14;
  const vMax = stair.width - 0.24;
  if (v < vMin || v > vMax) return null;
  const t = Math.max(0, Math.min(1, u / stair.climb));
  return { y: GROUND_Y + (WALK_Y - GROUND_Y) * t, u, v };
}

export function stairRailBlocked(stair: Stair, x: number, z: number) {
  const { u, v } = stairLocal(stair, x, z);
  if (u < -0.5 || u > stair.run + 0.28) return false;
  return v > stair.width - 0.22 && v < stair.width + stair.rail + 0.14;
}
