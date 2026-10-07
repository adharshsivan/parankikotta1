import * as THREE from "three";
import {
  BRIDGE,
  CANNONS,
  CURB_H,
  CURB_T,
  DECK_INNER,
  DECK_OUTER,
  GATE_HALF,
  GATE_INNER_Z,
  GATE_OUTER_Z,
  GATE_SOFFIT,
  GATE_SPRING,
  GATE_X,
  GROUND_Y,
  INNER,
  MASS_TOP,
  MOAT_BED_OUTER,
  MOAT_BED_Y,
  MOAT_INNER,
  MOAT_OUTER,
  MOAT_WATER_Y,
  OUTER,
  PARAPET_H,
  STAIRS,
  STAIR_LANDING,
  STAIR_RISE_HEIGHT,
  STAIR_TREAD_DEPTH,
  WALK_Y,
  WELL,
  addP,
  closestOnSegment,
  lenP,
  lerpP,
  mulP,
  pointInPolygon,
  pt,
  stairWallSpan,
  subP,
  type Point,
} from "./plan";
import {
  Batcher,
  applyWeathering,
  boxGeo,
  prismGeo,
  ribbonGeo,
  scaleUVs,
  slabGeo,
  type FortMaterials,
} from "./materials";
import { EAST_CUT, WEST_CUT, buildRuins } from "./ruins";

type Gap = { centre: number; half: number };

function runIntervals(length: number, gaps: Gap[]): [number, number][] {
  const sorted = gaps.slice().sort((a, b) => a.centre - b.centre);
  const out: [number, number][] = [];
  let cursor = 0;
  for (const gap of sorted) {
    const start = Math.max(0, gap.centre - gap.half);
    const end = Math.min(length, gap.centre + gap.half);
    if (start > cursor) out.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) out.push([cursor, length]);
  return out.filter(([s, e]) => e - s > 0.3);
}

const spanGap = (s0: number, s1: number): Gap => ({ centre: (s0 + s1) / 2, half: Math.max(0, (s1 - s0) / 2) });

/** Mitered polygon band segments meet edge-to-edge without overlap or fillers. */
function addBandRuns(
  batch: Batcher,
  key: string,
  material: THREE.Material,
  outerA: Point,
  outerB: Point,
  innerA: Point,
  innerB: Point,
  baseY: number,
  height: number,
  gaps: Gap[],
) {
  const delta = subP(outerB, outerA);
  const length = lenP(delta);
  for (const [start, end] of runIntervals(length, gaps)) {
    const t0 = start / length;
    const t1 = end / length;
    const band = [
      lerpP(outerA, outerB, t0),
      lerpP(outerA, outerB, t1),
      lerpP(innerA, innerB, t1),
      lerpP(innerA, innerB, t0),
    ];
    batch.add(key, material, prismGeo(band, baseY, height));
  }
}

function edgeT(point: Point, a: Point, b: Point) {
  return closestOnSegment(point, a, b).t * lenP(subP(b, a));
}

/* ------------------------------------------------------------------ */
/* Terrain                                                              */
/* ------------------------------------------------------------------ */

function buildTerrain(scene: THREE.Scene, m: FortMaterials) {
  // Land runs north only as far as the beach, so the sea beyond is visible.
  const field: Point[] = [pt(-130, -46), pt(130, -46), pt(130, 120), pt(-130, 120)];
  const land = new THREE.Mesh(slabGeo(field, 0, [MOAT_OUTER], 0.045), m.ground);
  land.receiveShadow = true;
  scene.add(land);

  const island = new THREE.Mesh(slabGeo(MOAT_INNER, 0, [], 0.08), m.ground);
  island.receiveShadow = true;
  scene.add(island);

  // The moat revetment sits in permanent damp, so it gets the heaviest moss.
  const revetmentGeometry = applyWeathering(ribbonGeo(MOAT_INNER, 0.03, MOAT_INNER, MOAT_BED_Y), {
    moss: 2.1,
    bleach: 0.15,
  });
  const revetment = new THREE.Mesh(revetmentGeometry, m.revetment);
  revetment.receiveShadow = true;
  scene.add(revetment);

  const outerBank = new THREE.Mesh(ribbonGeo(MOAT_OUTER, 0.03, MOAT_BED_OUTER, MOAT_BED_Y), m.earth);
  outerBank.receiveShadow = true;
  scene.add(outerBank);

  const bed = new THREE.Mesh(slabGeo(MOAT_BED_OUTER, MOAT_BED_Y, [MOAT_INNER], 0.08), m.earth);
  bed.receiveShadow = true;
  scene.add(bed);

  const water = new THREE.Mesh(slabGeo(MOAT_OUTER, MOAT_WATER_Y, [MOAT_INNER], 0.05), m.water);
  water.receiveShadow = true;
  scene.add(water);

  const beach = new THREE.Mesh(boxGeo(220, 0.4, 5.5, 0.05), m.ground);
  beach.position.set(0, 0.03, -48);
  beach.receiveShadow = true;
  scene.add(beach);

  const seaGeometry = new THREE.PlaneGeometry(260, 190, 1, 1);
  seaGeometry.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeometry, m.sea);
  sea.position.set(0, -0.5, -145);
  sea.receiveShadow = true;
  scene.add(sea);
}

/* ------------------------------------------------------------------ */
/* Walls, parapets and ramparts - the landward half that still stands   */
/* ------------------------------------------------------------------ */

/** Outer-ring index ranges each curtain centre line maps onto. */
const outerAfterCut = (edge: number) => edge * 5 + 5;
const outerBeforeCut = (edge: number) => edge * 5 + 4;

type Boundary = { edge: number; outer: Point; inner: Point; deckOuter: Point; deckInner: Point };

/** Piece running from the gate's west jamb round to a break. */
function pieceGateToCut(cut: Boundary, outerList: Point[], innerList: Point[]): Point[] {
  const pts: Point[] = [pt(GATE_X - GATE_HALF, GATE_OUTER_Z)];
  for (let i = 0; i <= outerBeforeCut(cut.edge); i++) pts.push(outerList[i]);
  pts.push(cut.outer, cut.inner);
  for (let i = cut.edge; i >= 0; i--) pts.push(innerList[i]);
  pts.push(pt(GATE_X - GATE_HALF, GATE_INNER_Z));
  return pts;
}

/** Piece running from a break round to the gate's east jamb. */
function pieceCutToGate(cut: Boundary, outerList: Point[], innerList: Point[]): Point[] {
  const pts: Point[] = [cut.outer];
  for (let i = outerAfterCut(cut.edge); i < outerList.length; i++) pts.push(outerList[i]);
  pts.push(pt(GATE_X + GATE_HALF, GATE_OUTER_Z), pt(GATE_X + GATE_HALF, GATE_INNER_Z));
  for (let i = innerList.length - 1; i >= cut.edge + 1; i--) pts.push(innerList[i]);
  pts.push(cut.inner);
  return pts;
}

/** Rampart deck from one break round to the other, carried over the gateway. */
function pieceWrap(a: Boundary, b: Boundary, outerList: Point[], innerList: Point[]): Point[] {
  const pts: Point[] = [a.deckOuter];
  for (let i = outerAfterCut(a.edge); i < outerList.length; i++) pts.push(outerList[i]);
  for (let i = 0; i <= outerBeforeCut(b.edge); i++) pts.push(outerList[i]);
  pts.push(b.deckOuter, b.deckInner);
  for (let i = b.edge; i >= 0; i--) pts.push(innerList[i]);
  for (let i = innerList.length - 1; i >= a.edge + 1; i--) pts.push(innerList[i]);
  pts.push(a.deckInner);
  return pts;
}

/** Outer-face edges of the two fallen sea bastions and the curtain between them. */
const FALLEN_OUTER_EDGES = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18]);

function buildWalls(batch: Batcher, m: FortMaterials) {
  // What still stands: two solid pieces either side of the gate, each ending at
  // a break. Everything beyond the breaks fell - see ruins.ts.
  batch.add("wall", m.wall, prismGeo(pieceGateToCut(WEST_CUT, OUTER, INNER), 0, MASS_TOP));
  batch.add("wall", m.wall, prismGeo(pieceCutToGate(EAST_CUT, OUTER, INNER), 0, MASS_TOP));
  batch.add("cap", m.cap, prismGeo(pieceWrap(EAST_CUT, WEST_CUT, DECK_OUTER, DECK_INNER), WALK_Y - 0.28, 0.28));

  const westOuter = edgeT(WEST_CUT.outer, OUTER[9], OUTER[10]);
  const eastOuter = edgeT(EAST_CUT.outer, OUTER[19], OUTER[20]);

  for (let e = 0; e < OUTER.length; e++) {
    if (FALLEN_OUTER_EDGES.has(e)) continue;
    const a = OUTER[e];
    const b = OUTER[(e + 1) % OUTER.length];
    const innerA = DECK_OUTER[e];
    const innerB = DECK_OUTER[(e + 1) % DECK_OUTER.length];
    const edgeLength = lenP(subP(b, a));

    // Embrasures cut the upper parapet only, leaving a firing sill below.
    const upperGaps: Gap[] = CANNONS.filter((c) => c.edgeIndex === e).map((c) => ({
      centre: edgeT(c.position, a, b),
      half: 0.82,
    }));
    const lowerGaps: Gap[] = [];

    // Beside each break the parapet gives out raggedly, short of the broken end.
    if (e === 9) {
      lowerGaps.push(spanGap(westOuter - 0.5, edgeLength));
      upperGaps.push(spanGap(westOuter - 1.3, edgeLength));
    }
    if (e === 19) {
      lowerGaps.push(spanGap(0, eastOuter + 0.5));
      upperGaps.push(spanGap(0, eastOuter + 1.3));
    }
    // The bastions either side of the ruin have lost stretches of parapet too.
    if (e === 8) upperGaps.push(spanGap(edgeLength * 0.55, edgeLength * 0.85));
    if (e === 20) upperGaps.push(spanGap(edgeLength * 0.2, edgeLength * 0.5));

    addBandRuns(batch, "wall", m.wall, a, b, innerA, innerB, WALK_Y, 0.42, lowerGaps);
    addBandRuns(batch, "wall", m.wall, a, b, innerA, innerB, WALK_Y + 0.42, PARAPET_H - 0.42, upperGaps);
    addBandRuns(batch, "cap", m.cap, a, b, innerA, innerB, WALK_Y + PARAPET_H, 0.18, upperGaps);
  }

  // Inner curb along the courtyard edge: opened at the stair, continuous over
  // the gate, and stopping short of each break.
  const westInner = edgeT(WEST_CUT.inner, INNER[1], INNER[2]);
  const eastInner = edgeT(EAST_CUT.inner, INNER[3], INNER[4]);
  for (let e = 0; e < INNER.length; e++) {
    if (e === 2) continue; // the north curtain is gone entirely
    const a = INNER[e];
    const b = INNER[(e + 1) % INNER.length];
    const length = lenP(subP(b, a));
    const gaps: Gap[] = [];

    for (const stair of STAIRS) {
      const near = closestOnSegment(stair.head, a, b);
      if (near.distance > 1.2) continue;
      const span = stairWallSpan(stair);
      const t1 = edgeT(span.from, a, b);
      const t2 = edgeT(span.to, a, b);
      gaps.push({ centre: (t1 + t2) * 0.5, half: Math.abs(t2 - t1) * 0.5 + 0.4 });
    }
    if (e === 1) gaps.push(spanGap(westInner - 0.3, length));
    if (e === 3) gaps.push(spanGap(0, eastInner + 0.3));

    const deckA = DECK_INNER[e];
    const deckB = DECK_INNER[(e + 1) % DECK_INNER.length];
    addBandRuns(batch, "cap", m.cap, a, b, deckA, deckB, WALK_Y, CURB_H, gaps);
  }
}

/* ------------------------------------------------------------------ */
/* Gate                                                                 */
/* ------------------------------------------------------------------ */

function archBandGeo(radius: number, centreY: number, sweep: number, width: number, depth: number) {
  const shape = new THREE.Shape();
  const outer = radius + width * 0.5;
  const inner = radius - width * 0.5;
  const segments = 18;
  for (let i = 0; i <= segments; i++) {
    const angle = -sweep + (sweep * 2 * i) / segments;
    const x = Math.sin(angle) * outer;
    const y = centreY + Math.cos(angle) * outer;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = segments; i >= 0; i--) {
    const angle = -sweep + (sweep * 2 * i) / segments;
    shape.lineTo(Math.sin(angle) * inner, centreY + Math.cos(angle) * inner);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  scaleUVs(geometry, 0.18);
  return geometry;
}

function buildGate(batch: Batcher, m: FortMaterials, scene: THREE.Scene) {
  const depth = GATE_OUTER_Z - GATE_INNER_Z;
  const midZ = (GATE_OUTER_Z + GATE_INNER_Z) * 0.5;

  const pierDepth = 2.6;
  const pierZ = GATE_OUTER_Z + pierDepth * 0.5;
  for (const side of [-1, 1]) {
    const x = GATE_X + side * (GATE_HALF + 1.35);
    batch.box("wall", m.wall, [2.7, 7.2, pierDepth], [x, 3.6, pierZ]);
    batch.box("cap", m.cap, [3.05, 0.3, pierDepth + 0.38], [x, 7.35, pierZ]);
  }

  const rise = GATE_SOFFIT - GATE_SPRING;
  const radius = (rise * rise + GATE_HALF * GATE_HALF) / (2 * rise);
  const centreY = GATE_SOFFIT - radius;
  const sweep = Math.asin(GATE_HALF / radius);
  const shape = new THREE.Shape();
  const shoulder = GATE_HALF;
  shape.moveTo(-shoulder, 2.45);
  shape.lineTo(-shoulder, 4.78);
  shape.lineTo(shoulder, 4.78);
  shape.lineTo(shoulder, 2.45);
  shape.lineTo(GATE_HALF, 2.45);
  shape.lineTo(GATE_HALF, GATE_SPRING);
  for (let i = 9; i >= 0; i--) {
    const angle = -sweep + (2 * sweep * i) / 10;
    shape.lineTo(Math.sin(angle) * radius, centreY + Math.cos(angle) * radius);
  }
  shape.lineTo(-GATE_HALF, 2.45);
  shape.lineTo(-shoulder, 2.45);
  shape.closePath();

  const archGeometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  scaleUVs(archGeometry, 0.18);
  const archMatrix = new THREE.Matrix4().makeTranslation(GATE_X, 0, GATE_INNER_Z);
  batch.add("wall", m.wall, archGeometry, archMatrix);

  // Continuous stone arch bands on both faces.
  const ring = archBandGeo(radius, centreY, sweep, 0.42, 0.14);
  batch.add("cap", m.cap, ring, new THREE.Matrix4().makeTranslation(GATE_X, 0, GATE_OUTER_Z));
  batch.add("cap", m.cap, ring, new THREE.Matrix4().makeTranslation(GATE_X, 0, GATE_INNER_Z - 0.14));

  batch.box("cap", m.cap, [GATE_HALF * 2 + 1.2, 0.14, depth + 2.45], [GATE_X, GROUND_Y - 0.07, midZ + 0.58]);

  for (const side of [-1, 1]) {
    const x = GATE_X + side * (GATE_HALF - 0.22);
    batch.box("timber", m.timber, [0.26, 3.45, 2.0], [x, 1.75, GATE_INNER_Z + 1.16], 0, 0.3);
    for (const y of [0.68, 1.95, 3.02]) {
      batch.box("timber", m.timber, [0.34, 0.15, 1.82], [x, y, GATE_INNER_Z + 1.16], 0, 0.3);
    }
  }

  const poleX = GATE_X + GATE_HALF + 1.35;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.4, 6), m.wood);
  pole.position.set(poleX, 10.4, pierZ);
  pole.castShadow = true;
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.15, 4, 2), m.cloth);
  flag.position.set(poleX + 0.97, 12.2, pierZ);
  flag.castShadow = true;
  scene.add(flag);
  return flag;
}

/* ------------------------------------------------------------------ */
/* Stairs - the single west flight                                      */
/* ------------------------------------------------------------------ */

function stairMatrix(stair: (typeof STAIRS)[number], sideOffset = 0) {
  const origin = addP(stair.base, mulP(stair.side, sideOffset));
  return new THREE.Matrix4().set(
    stair.up.x, 0, stair.side.x, origin.x,
    0, 1, 0, 0,
    stair.up.z, 0, stair.side.z, origin.z,
    0, 0, 0, 1,
  );
}

/** A single stair body exposes only the real treads and risers, no stacked boxes. */
function stairFlightGeo(stair: (typeof STAIRS)[number]) {
  const tread = STAIR_TREAD_DEPTH;
  const rise = STAIR_RISE_HEIGHT;
  const shape = new THREE.Shape();
  shape.moveTo(0, GROUND_Y - 0.14);
  shape.lineTo(stair.climb, GROUND_Y - 0.14);
  shape.lineTo(stair.climb, WALK_Y);
  for (let i = stair.steps - 1; i >= 0; i--) {
    const x = i * tread;
    shape.lineTo(x, GROUND_Y + rise * (i + 1));
    if (i > 0) shape.lineTo(x, GROUND_Y + rise * i);
  }
  shape.lineTo(0, GROUND_Y - 0.14);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: stair.width,
    bevelEnabled: false,
    curveSegments: 1,
  });
  scaleUVs(geometry, 0.2);
  return geometry;
}

/** Continuous sloped masonry balustrade along the open side of the flight. */
function stairSidewallGeo(stair: (typeof STAIRS)[number]) {
  const shape = new THREE.Shape();
  shape.moveTo(0, GROUND_Y - 0.14);
  shape.lineTo(stair.run, GROUND_Y - 0.14);
  shape.lineTo(stair.run, WALK_Y + stair.rail);
  shape.lineTo(stair.climb, WALK_Y + stair.rail);
  shape.lineTo(0, GROUND_Y + STAIR_RISE_HEIGHT + stair.rail);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: stair.rail,
    bevelEnabled: false,
    curveSegments: 1,
  });
  scaleUVs(geometry, 0.2);
  return geometry;
}

function buildStairs(batch: Batcher, m: FortMaterials) {
  for (const stair of STAIRS) {
    const yaw = Math.atan2(stair.up.x, stair.up.z);
    const axis = stair.up;
    const across = stair.side;
    batch.add("cap", m.cap, stairFlightGeo(stair), stairMatrix(stair));
    batch.add("wall", m.wall, stairSidewallGeo(stair), stairMatrix(stair, stair.width));

    const reach = stair.width + CURB_T;
    const alongCentre = stair.climb + STAIR_LANDING * 0.5;
    const landingCentre = addP(addP(stair.base, mulP(axis, alongCentre)), mulP(across, reach * 0.5 - CURB_T));
    batch.box("wall", m.wall, [reach, WALK_Y - 0.16, STAIR_LANDING], [landingCentre.x, (WALK_Y - 0.16) * 0.5, landingCentre.z], yaw);
    batch.box("cap", m.cap, [reach, 0.16, STAIR_LANDING], [landingCentre.x, WALK_Y - 0.08, landingCentre.z], yaw);
  }
}

/* ------------------------------------------------------------------ */
/* Courtyard                                                            */
/* ------------------------------------------------------------------ */

function buildCourtyard(batch: Batcher, m: FortMaterials, scene: THREE.Scene) {
  const ground = new THREE.Mesh(slabGeo(INNER, GROUND_Y, [], 0.05), m.packed);
  ground.receiveShadow = true;
  scene.add(ground);

  const channel = new THREE.Mesh(boxGeo(0.34, 0.06, 10.1, 0.18), m.shadowed);
  channel.position.set(WELL.centre.x, GROUND_Y - 0.04, 4.45);
  channel.receiveShadow = true;
  scene.add(channel);

  const wellWall = new THREE.Mesh(new THREE.CylinderGeometry(WELL.radius, WELL.radius + 0.14, 1.05, 14, 1, true), m.stone);
  wellWall.position.set(WELL.centre.x, GROUND_Y + 0.52, WELL.centre.z);
  wellWall.castShadow = true;
  wellWall.receiveShadow = true;
  scene.add(wellWall);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(WELL.radius + 0.03, 0.13, 6, 16), m.stone);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(WELL.centre.x, GROUND_Y + 1.05, WELL.centre.z);
  rim.castShadow = true;
  scene.add(rim);

  const wellWater = new THREE.Mesh(new THREE.CircleGeometry(WELL.radius - 0.1, 14), m.water);
  wellWater.rotation.x = -Math.PI / 2;
  wellWater.position.set(WELL.centre.x, GROUND_Y + 0.58, WELL.centre.z);
  scene.add(wellWater);

  for (const side of [-1, 1]) {
    batch.box("timber", m.timber, [0.18, 2.3, 0.18], [WELL.centre.x + side * (WELL.radius - 0.1), GROUND_Y + 1.15, WELL.centre.z], 0, 0.3);
  }
  batch.box("timber", m.timber, [0.2, 0.2, 2.5], [WELL.centre.x, GROUND_Y + 2.28, WELL.centre.z], Math.PI / 2, 0.3);
}

/* ------------------------------------------------------------------ */
/* Bridge                                                               */
/* ------------------------------------------------------------------ */

function buildBridge(batch: Batcher, m: FortMaterials) {
  const { x, halfWidth, deckY, startZ, endZ } = BRIDGE;
  const span = endZ - startZ;
  const midZ = (startZ + endZ) * 0.5;

  const plankCount = Math.round(span / 0.52);
  const plankDepth = span / plankCount;
  for (let i = 0; i < plankCount; i++) {
    const z = startZ + plankDepth * (i + 0.5);
    const inset = i % 3 === 0 ? 0.06 : 0;
    batch.box("timber", m.timber, [halfWidth * 2 - inset, 0.16, plankDepth - 0.05], [x, deckY - 0.08, z], 0, 0.35);
  }

  for (const side of [-1, 1]) {
    batch.box("timber", m.timber, [0.3, 0.36, span], [x + side * (halfWidth - 0.35), deckY - 0.26, midZ], 0, 0.35);
  }
  batch.box("timber", m.timber, [0.3, 0.36, span], [x, deckY - 0.26, midZ], 0, 0.35);

  for (const t of [0.32, 0.68]) {
    const z = startZ + span * t;
    for (const side of [-1, 1]) {
      batch.box("timber", m.timber, [0.36, 3.3, 0.36], [x + side * (halfWidth - 0.4), deckY - 1.85, z], 0, 0.5);
    }
    batch.box("timber", m.timber, [halfWidth * 2, 0.28, 0.32], [x, deckY - 0.55, z], 0, 0.5);
  }

  for (const side of [-1, 1]) {
    const railX = x + side * halfWidth;
    const posts = 6;
    for (let i = 0; i <= posts; i++) {
      const z = startZ + 0.5 + ((span - 1.0) * i) / posts;
      batch.box("timber", m.timber, [0.2, 1.15, 0.2], [railX, deckY + 0.58, z], 0, 0.35);
    }
    batch.box("timber", m.timber, [0.16, 0.18, span - 0.4], [railX, deckY + 1.06, midZ], 0, 0.35);
    batch.box("timber", m.timber, [0.14, 0.14, span - 0.4], [railX, deckY + 0.64, midZ], 0, 0.35);
  }

  for (const z of [startZ + 0.9, endZ - 0.9]) {
    batch.box("base", m.base, [halfWidth * 2 + 1.7, 0.62, 2.6], [x, deckY - 0.31, z]);
    batch.box("cap", m.cap, [halfWidth * 2 + 1.7, 0.14, 2.6], [x, deckY - 0.07, z]);
  }
}

/* ------------------------------------------------------------------ */
/* Cannons - only on the bastions that still stand                      */
/* ------------------------------------------------------------------ */

function buildCannons(scene: THREE.Scene, m: FortMaterials) {
  const parts = {
    carriage: boxGeo(0.92, 0.2, 1.65, 0.6),
    rail: boxGeo(0.18, 0.3, 1.5, 0.6),
    transom: boxGeo(0.28, 0.6, 0.36, 0.6),
    wheel: new THREE.CylinderGeometry(0.4, 0.4, 0.18, 10),
    hub: new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8),
    trunnion: new THREE.CylinderGeometry(0.15, 0.15, 0.22, 8),
    barrel: new THREE.CylinderGeometry(0.2, 0.29, 1.85, 12),
    muzzle: new THREE.CylinderGeometry(0.24, 0.24, 0.16, 12),
    band: new THREE.CylinderGeometry(0.27, 0.275, 0.09, 12),
    bore: new THREE.CircleGeometry(0.165, 12),
  };

  type Batch = { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[] };
  const batches = new Map<string, Batch>();
  const tilt = -0.05;

  for (const slot of CANNONS) {
    const root = new THREE.Object3D();
    root.position.set(slot.position.x, WALK_Y + 0.02, slot.position.z);
    root.rotation.y = Math.atan2(slot.facing.x, slot.facing.z);
    root.updateMatrix();

    const place = (
      key: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
    ) => {
      const local = new THREE.Object3D();
      local.position.set(...position);
      local.rotation.set(...rotation);
      local.updateMatrix();
      const matrix = new THREE.Matrix4().multiplyMatrices(root.matrix, local.matrix);
      const existing = batches.get(key);
      if (existing) existing.matrices.push(matrix);
      else batches.set(key, { geometry, material, matrices: [matrix] });
    };

    place("carriage", parts.carriage, m.wood, [0, 0.48, -0.15]);
    place("transom", parts.transom, m.wood, [0, 0.76, -0.66]);
    place("barrel", parts.barrel, m.iron, [0, 1.16, 0.16], [Math.PI / 2 + tilt, 0, 0]);
    place("muzzle", parts.muzzle, m.iron, [0, 1.21, 1.06], [Math.PI / 2 + tilt, 0, 0]);
    place("bore", parts.bore, m.bore, [0, 1.25, 1.14], [tilt, 0, 0]);
    for (const side of [-1, 1]) {
      place("rail", parts.rail, m.wood, [side * 0.3, 0.63, -0.17]);
      place("wheel", parts.wheel, m.wood, [side * 0.52, 0.4, -0.2], [0, 0, Math.PI / 2]);
      place("hub", parts.hub, m.iron, [side * 0.55, 0.4, -0.2], [0, 0, Math.PI / 2]);
      place("trunnion", parts.trunnion, m.iron, [side * 0.33, 1.06, -0.14], [0, 0, Math.PI / 2]);
    }
    for (const z of [-0.3, 0.5]) {
      place("band", parts.band, m.iron, [0, 1.16 + (z - 0.16) * 0.05, z], [Math.PI / 2 + tilt, 0, 0]);
    }
  }

  for (const [key, batch] of batches) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `cannon-${key}`;
    scene.add(mesh);
  }
}

/* ------------------------------------------------------------------ */
/* Planting                                                             */
/* ------------------------------------------------------------------ */

function buildPlanting(scene: THREE.Scene, m: FortMaterials) {
  // Coastal grass well beyond the ditch. Anything that would land over the
  // moat's water is skipped rather than left floating.
  const patches: [number, number, number][] = [
    [-38, 30, 2.4],
    [36, 34, 2.0],
    [-50, 2, 2.6],
    [48, 8, 2.2],
    [-42, -30, 2.0],
    [40, -32, 2.4],
    [-12, 44, 1.8],
    [14, 46, 2.1],
  ];
  const blade = new THREE.ConeGeometry(0.12, 0.7, 4);
  for (const [x, z, radius] of patches) {
    const centre = pt(x, z);
    if (pointInPolygon(centre, MOAT_OUTER) && !pointInPolygon(centre, MOAT_INNER)) continue;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(radius, 8), m.grass);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.03, z);
    patch.receiveShadow = true;
    scene.add(patch);
    for (let i = 0; i < 3; i++) {
      const tuft = new THREE.Mesh(blade, m.grass);
      tuft.position.set(x + (i - 1) * 0.45, 0.34, z + ((i % 2) - 0.5) * 0.52);
      tuft.castShadow = true;
      scene.add(tuft);
    }
  }
}

export function buildFort(scene: THREE.Scene, m: FortMaterials) {
  const batch = new Batcher();
  buildTerrain(scene, m);
  buildWalls(batch, m);
  const flag = buildGate(batch, m, scene);
  buildStairs(batch, m);
  buildCourtyard(batch, m, scene);
  buildBridge(batch, m);
  buildRuins(scene, batch, m);
  batch.flush(scene);
  buildCannons(scene, m);
  buildPlanting(scene, m);
  return { flag };
}
