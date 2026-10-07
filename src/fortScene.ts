import * as THREE from "three";
import { buildFort } from "./fort/build";
import { createMaterials } from "./fort/materials";
import {
  BASTION_NAMES,
  BASTIONS,
  BRIDGE,
  CANNONS,
  GATE_X,
  GROUND_Y,
  INNER,
  MOAT_INNER,
  MOAT_OUTER,
  OUTER,
  STAIRS,
  WALK_INNER,
  WALK_OUTER,
  WALK_Y,
  WELL,
  isInGatePassage,
  isOnBridge,
  lenP,
  pointInPolygon,
  pt,
  stairRailBlocked,
  stairSample,
  subP,
} from "./fort/plan";
import { inRuinBand, rampSample, ruinBlocked, ruinLocation, ruinSolid } from "./fort/ruins";

export type FortMode = "overview" | "walk";

export type FortHud = {
  location: string;
  elevation: number;
  x: number;
  z: number;
};

export type FortController = {
  setMode: (mode: FortMode) => void;
  setTouchMove: (side: number, forward: number) => void;
  destroy: () => void;
};

type SurfaceKind = "ground" | "walk" | "stair" | "bridge" | "solid" | "void";
type Surface = { kind: SurfaceKind; y: number };

const SOLID: Surface = { kind: "solid", y: 0 };
const VOID: Surface = { kind: "void", y: 0 };

function surfaceAt(x: number, z: number, currentY: number): Surface {
  const point = pt(x, z);

  for (const stair of STAIRS) {
    const sample = stairSample(stair, x, z);
    if (sample) return { kind: "stair", y: sample.y };
  }

  // The rubble slope where the east wall fell: walkable along its lane, with the
  // normal step limit, so it can only be joined from the deck or from its foot.
  const ramp = rampSample(x, z);
  if (ramp !== null) return { kind: "walk", y: ramp };
  // The west stump and the slope's banks are solid broken masonry.
  if (ruinSolid(x, z)) return SOLID;
  // Everything else where the seaward half stood is open ruin ground now.
  if (inRuinBand(x, z)) return { kind: "ground", y: GROUND_Y };

  if (currentY <= 2.6 && isInGatePassage(x, z)) return { kind: "ground", y: GROUND_Y };
  if (pointInPolygon(point, INNER)) return { kind: "ground", y: GROUND_Y };

  if (pointInPolygon(point, OUTER)) {
    const onBand = pointInPolygon(point, WALK_OUTER) && !pointInPolygon(point, WALK_INNER);
    if (onBand && currentY > 2.6) return { kind: "walk", y: WALK_Y };
    return SOLID;
  }

  if (isOnBridge(x, z)) return { kind: "bridge", y: BRIDGE.deckY };
  if (pointInPolygon(point, MOAT_OUTER) && !pointInPolygon(point, MOAT_INNER)) return VOID;
  return { kind: "ground", y: 0 };
}

function blockedByProp(x: number, z: number, y: number) {
  if (y < 2.6) {
    for (const stair of STAIRS) {
      if (stairRailBlocked(stair, x, z)) return true;
    }
    if (Math.hypot(x - WELL.centre.x, z - WELL.centre.z) < WELL.radius + 0.45) return true;
    // Footings, heaps and thrown blocks in the ruins.
    if (ruinBlocked(x, z)) return true;
    return false;
  }

  for (const cannon of CANNONS) {
    if (Math.hypot(x - cannon.position.x, z - cannon.position.z) < 0.54) return true;
  }
  return false;
}

function canStand(x: number, z: number, currentY: number) {
  const surface = surfaceAt(x, z, currentY);
  if (surface.kind === "solid" || surface.kind === "void") return null;
  if (surface.kind !== "stair" && Math.abs(surface.y - currentY) > 0.45) return null;
  if (blockedByProp(x, z, surface.y)) return null;
  if (Math.abs(x) > 110 || z < -70 || z > 95) return null;
  return surface;
}

function locationName(x: number, z: number, y: number) {
  for (const stair of STAIRS) {
    const sample = stairSample(stair, x, z);
    if (sample && sample.u > 0.2 && sample.u < stair.run) return stair.name;
  }
  const ruin = ruinLocation(x, z, y);
  if (ruin) return ruin;
  if (isOnBridge(x, z)) return "Moat bridge";
  if (isInGatePassage(x, z)) return y > 2.6 ? "Gate walk" : "Gate passage";

  if (y > 2.6) {
    let best = Infinity;
    let name = "Rampart walk";
    for (const bastion of BASTIONS) {
      const distance = lenP(subP(pt(x, z), bastion.apex));
      if (distance < best) {
        best = distance;
        name = BASTION_NAMES[bastion.index];
      }
    }
    return best < 8.5 ? name : "Rampart walk";
  }

  if (pointInPolygon(pt(x, z), INNER)) {
    if (Math.hypot(x - WELL.centre.x, z - WELL.centre.z) < 3.2) return "Old well";
    return "Courtyard";
  }

  if (z < -42) return "Tidal shore";
  if (pointInPolygon(pt(x, z), MOAT_INNER)) return "Berm";
  return "Coast path";
}

function makeExplorer() {
  const root = new THREE.Group();
  const tunic = new THREE.MeshStandardMaterial({ color: 0x9d6244, roughness: 0.82 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xd0b993, roughness: 0.84 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc68d68, roughness: 0.85 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x455752, roughness: 0.9 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x59483b, roughness: 0.92 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.55, 4, 8), tunic);
  torso.position.y = 1.05;
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 9), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  root.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), leather);
  hair.position.set(0, 1.77, -0.015);
  root.add(hair);

  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15, 0.69, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.23), trousers);
    thigh.position.y = -0.34;
    thigh.castShadow = true;
    leg.add(thigh);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.15, 0.36), leather);
    boot.position.set(0, -0.63, 0.055);
    boot.castShadow = true;
    leg.add(boot);
    root.add(leg);
    legs.push(leg);

    const arm = new THREE.Group();
    arm.position.set(side * 0.32, 1.34, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.58, 0.2), shirt);
    sleeve.position.y = -0.27;
    sleeve.castShadow = true;
    arm.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), skin);
    hand.position.y = -0.6;
    arm.add(hand);
    root.add(arm);
    arms.push(arm);
  }

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.48, 0.17), leather);
  pack.position.set(0, 1.12, -0.28);
  pack.castShadow = true;
  root.add(pack);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.42), leather);
  belt.position.y = 0.88;
  root.add(belt);

  return { root, legs, arms, torso };
}

export function mountFortScene(canvas: HTMLCanvasElement, onHud: (state: FortHud) => void): FortController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8bcb4);
  scene.fog = new THREE.Fog(0xa8bcb4, 95, 290);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.3, 700);
  let yaw = 0.52;
  let polar = 0.84;
  let distance = 124;
  let mode: FortMode = "overview";
  const overviewFocus = new THREE.Vector3(0, 3.2, -1);
  const focus = overviewFocus.clone();
  const goalFocus = overviewFocus.clone();

  scene.add(new THREE.HemisphereLight(0xd9e6dd, 0x4c4b3c, 2.0));
  const sun = new THREE.DirectionalLight(0xffd3a6, 3.2);
  sun.position.set(-52, 74, 46);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -62;
  sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 62;
  sun.shadow.camera.bottom = -62;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const materials = createMaterials();
  const { flag } = buildFort(scene, materials);

  const explorer = makeExplorer();
  const startZ = BRIDGE.endZ + 4.5;
  explorer.root.position.set(GATE_X, 0, startZ);
  explorer.root.rotation.y = Math.PI;
  scene.add(explorer.root);

  const player = { x: GATE_X, z: startZ, y: 0, phase: 0 };
  const keys = new Set<string>();
  let touchSide = 0;
  let touchForward = 0;
  let pointerDown = false;
  let lastX = 0;
  let lastY = 0;
  let lastHud = 0;
  let frameHandle = 0;
  let previous = performance.now();
  let destroyed = false;

  function resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const aspect = width / height;
    camera.aspect = aspect;
    camera.fov = aspect < 0.85 ? 58 : 34;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.setSize(width, height, false);
  }

  function setMode(next: FortMode) {
    mode = next;
    distance = next === "overview" ? 124 : 19;
    polar = next === "overview" ? 0.84 : 1.02;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"].includes(event.code)) {
      if (event.code !== "ShiftLeft") event.preventDefault();
      keys.add(event.code);
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    pointerDown = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!pointerDown) return;
    yaw -= (event.clientX - lastX) * 0.0046;
    polar = THREE.MathUtils.clamp(polar + (event.clientY - lastY) * 0.0036, 0.22, 1.32);
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onPointerUp() {
    pointerDown = false;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const min = mode === "walk" ? 11 : 58;
    const max = mode === "walk" ? 42 : 210;
    distance = THREE.MathUtils.clamp(distance * (1 + event.deltaY * 0.001), min, max);
  }

  function step(dt: number) {
    const forwardInput = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) + touchForward;
    const sideInput = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) + touchSide;

    if (mode !== "walk" || (forwardInput === 0 && sideInput === 0)) return false;

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const direction = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(sideInput));
    if (direction.lengthSq() > 1) direction.normalize();
    if (direction.lengthSq() < 0.0001) return false;

    const speed = keys.has("ShiftLeft") ? 5.4 : 3.4;
    const dx = direction.x * speed * dt;
    const dz = direction.z * speed * dt;

    let moved = false;
    const full = canStand(player.x + dx, player.z + dz, player.y);
    if (full) {
      player.x += dx;
      player.z += dz;
      player.y = full.y;
      moved = true;
    } else {
      const slideX = canStand(player.x + dx, player.z, player.y);
      if (slideX && Math.abs(dx) > 0.0001) {
        player.x += dx;
        player.y = slideX.y;
        moved = true;
      }
      const slideZ = canStand(player.x, player.z + dz, player.y);
      if (slideZ && Math.abs(dz) > 0.0001) {
        player.z += dz;
        player.y = slideZ.y;
        moved = true;
      }
    }

    if (moved) explorer.root.rotation.y = Math.atan2(direction.x, direction.z);
    return moved;
  }

  function frame(now: number) {
    if (destroyed) return;
    frameHandle = requestAnimationFrame(frame);
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;

    const moving = step(dt);
    explorer.root.position.set(player.x, player.y, player.z);

    if (moving) {
      player.phase += dt * 9.2;
      explorer.legs[0].rotation.x = Math.sin(player.phase) * 0.5;
      explorer.legs[1].rotation.x = -Math.sin(player.phase) * 0.5;
      explorer.arms[0].rotation.x = -Math.sin(player.phase) * 0.33;
      explorer.arms[1].rotation.x = Math.sin(player.phase) * 0.33;
      explorer.torso.position.y = 1.05 + Math.abs(Math.sin(player.phase * 2)) * 0.026;
    } else {
      explorer.legs.forEach((leg) => (leg.rotation.x *= 0.8));
      explorer.arms.forEach((arm) => (arm.rotation.x *= 0.8));
      explorer.torso.position.y += (1.05 - explorer.torso.position.y) * 0.18;
    }

    if (mode === "walk") goalFocus.set(player.x, player.y + 1.15, player.z);
    else goalFocus.copy(overviewFocus);
    focus.lerp(goalFocus, 1 - Math.exp(-dt * 3.4));

    const horizontal = Math.sin(polar) * distance;
    camera.position.set(
      focus.x + Math.sin(yaw) * horizontal,
      focus.y + Math.cos(polar) * distance,
      focus.z + Math.cos(yaw) * horizontal,
    );
    camera.lookAt(focus);

    sun.position.set(focus.x - 52, 74, focus.z + 46);
    sun.target.position.set(focus.x, 0, focus.z);
    sun.target.updateMatrixWorld();

    materials.water.map!.offset.x += dt * 0.0045;
    materials.water.map!.offset.y += dt * 0.0016;
    flag.rotation.y = Math.sin(now * 0.0013) * 0.22;
    flag.scale.x = 1 + Math.sin(now * 0.0031) * 0.05;

    if (now - lastHud > 140) {
      onHud({ location: locationName(player.x, player.z, player.y), elevation: player.y, x: player.x, z: player.z });
      lastHud = now;
    }

    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  resize();
  frameHandle = requestAnimationFrame(frame);

  return {
    setMode,
    setTouchMove: (side, forward) => {
      touchSide = side;
      touchForward = forward;
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      for (const texture of materials.textures) texture.dispose();
      renderer.dispose();
    },
  };
}
