import * as THREE from "three";
import type { Point } from "./plan";

export const UV_SCALE = 0.22;

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Adds inexpensive world-space damp staining and patchy moss per pixel. */
function addCoastalWeathering(
  material: THREE.MeshStandardMaterial,
  mossStrength: number,
  dampHeight: number,
) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vFortWorldPosition;
varying vec3 vFortWorldNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vFortWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFortWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vFortWorldPosition;
varying vec3 vFortWorldNormal;
const float fortMossStrength = ${mossStrength.toFixed(3)};
const float fortDampHeight = ${dampHeight.toFixed(3)};`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
float fortVertical = 1.0 - clamp(abs(vFortWorldNormal.y), 0.0, 1.0);
float fortDamp = 1.0 - smoothstep(-0.35, fortDampHeight, vFortWorldPosition.y);
float fortShade = 1.0 - max(dot(normalize(vFortWorldNormal), normalize(vec3(-0.45, 0.72, 0.34))), 0.0);
float fortNoiseA = 0.5 + 0.5 * sin(vFortWorldPosition.x * 0.41 + vFortWorldPosition.z * 0.29) * sin(vFortWorldPosition.z * 0.57 - vFortWorldPosition.x * 0.33 + 1.2);
float fortNoiseB = 0.5 + 0.5 * sin(vFortWorldPosition.x * 1.37 + vFortWorldPosition.z * 1.11 + 0.8);
float fortPatch = smoothstep(0.43, 0.76, fortNoiseA * 0.72 + fortNoiseB * 0.28);
float fortLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
float fortJoint = 1.0 - smoothstep(0.12, 0.27, fortLuma);
float fortMoss = fortDamp * fortVertical * (0.45 + 0.55 * fortShade) * (0.55 + 0.45 * fortJoint) * fortPatch * fortMossStrength;
fortMoss = clamp(fortMoss, 0.0, 0.82);
vec3 fortMossColor = vec3(0.20, 0.29, 0.15) * (0.82 + fortNoiseB * 0.26);
diffuseColor.rgb = mix(diffuseColor.rgb, fortMossColor, fortMoss);
float fortStreak = fortVertical * fortDamp * smoothstep(0.58, 0.92, fortNoiseB) * 0.12;
diffuseColor.rgb *= 1.0 - fortStreak;`,
      );
  };
  material.customProgramCacheKey = () => `fort-coastal-${mossStrength}-${dampHeight}`;
}

/**
 * Large dark coastal masonry: heavy basalt / dark laterite blocks roughly
 * 0.75 m tall and up to 2 m wide. Tones move between charcoal, black-gray,
 * dark brown-gray and weathered green-gray, with deep recessed joints, chipped
 * arrises, salt run-off and moss collecting along the bed joints.
 */
function stoneTexture() {
  return makeTexture(1024, (ctx, size) => {
    const random = seeded(23);

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#2b2e2d");
    grad.addColorStop(0.45, "#343634");
    grad.addColorStop(1, "#292c2b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Broad damp / salt drift laid in before the blocks so the tile cannot
    // read as a flat repeating wallpaper.
    for (let i = 0; i < 46; i++) {
      const r = 90 + random() * 220;
      ctx.fillStyle = random() > 0.55 ? "rgba(16, 20, 18, 0.08)" : "rgba(126, 132, 116, 0.05)";
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, r * 1.25, r * 0.82, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const rows = 6;
    const rowH = size / rows;
    for (let row = 0; row < rows; row++) {
      const rowShift = 0.86 + random() * 0.24;
      const offset = row % 2 ? -rowH * (0.55 + random() * 0.75) : 0;
      let x = offset - rowH * 1.3;

      while (x < size + rowH * 2) {
        const w = rowH * (1.15 + random() * 1.85);
        const h = rowH * (0.9 + random() * 0.055);
        const tone = random();
        let base = [62, 64, 61];
        if (tone < 0.28) base = [57, 59, 58]; // charcoal
        else if (tone < 0.56) base = [72, 73, 69]; // black-gray
        else if (tone < 0.8) base = [76, 70, 61]; // dark brown-gray
        else base = [63, 71, 62]; // weathered green-gray

        const v = rowShift * (0.86 + random() * 0.34);
        ctx.fillStyle = `rgb(${Math.min(255, base[0] * v) | 0}, ${Math.min(255, base[1] * v) | 0}, ${Math.min(255, base[2] * v) | 0})`;
        ctx.fillRect(x + 3, row * rowH + 4, w - 6, h - 7);

        // Recessed joints: deep shadow below and to one side, pale lichen edge.
        ctx.fillStyle = "rgba(12, 15, 13, 0.52)";
        ctx.fillRect(x, row * rowH + h - 4, w, 4.5);
        ctx.fillRect(x - 1, row * rowH + 3, 3.5, h - 2);
        ctx.fillStyle = "rgba(150, 154, 138, 0.1)";
        ctx.fillRect(x + 4, row * rowH + 6, w - 12, 2.2);

        // Chipped corners and worn arrises.
        for (let c = 0; c < 5; c++) {
          const cx = x + 6 + random() * Math.max(10, w - 12);
          const cy = row * rowH + 6 + random() * Math.max(8, h - 14);
          const cr = 2 + random() * 9;
          ctx.fillStyle = random() > 0.45 ? "rgba(18, 21, 19, 0.16)" : "rgba(126, 128, 112, 0.1)";
          ctx.beginPath();
          ctx.arc(cx, cy, cr, 0, Math.PI * 2);
          ctx.fill();
        }
        if (random() > 0.5) {
          const corner = random() > 0.5;
          ctx.fillStyle = "rgba(20, 23, 21, 0.22)";
          ctx.beginPath();
          const sx = corner ? x + w - 22 : x + 3;
          ctx.moveTo(sx, row * rowH + 4);
          ctx.lineTo(x + w - 3, row * rowH + 4);
          ctx.lineTo(x + w - 3, row * rowH + 17);
          ctx.closePath();
          ctx.fill();
        }

        // Moss and dirt gathering in the bed joints.
        const mossy = random();
        if (mossy > 0.34) {
          const a = 0.05 + random() * 0.14;
          const mossGrad = ctx.createLinearGradient(x, row * rowH + h - 16, x, row * rowH + h);
          mossGrad.addColorStop(0, "rgba(96, 112, 74, 0)");
          mossGrad.addColorStop(1, `rgba(96, 112, 74, ${a})`);
          ctx.fillStyle = mossGrad;
          ctx.fillRect(x + 2, row * rowH + h - 16, w - 4, 16);
        }

        x += w + rowH * (0.08 + random() * 0.16);
      }
    }

    // Salt air run-off and water streaks down the face.
    for (let i = 0; i < 120; i++) {
      const x = random() * size;
      const y = random() * size;
      const h = 26 + random() * 150;
      const w = 2 + random() * 11;
      const alpha = 0.025 + random() * 0.075;
      const fade = ctx.createLinearGradient(x, y, x, y + h);
      fade.addColorStop(0, `rgba(186, 192, 176, ${alpha})`);
      fade.addColorStop(1, "rgba(186, 192, 176, 0)");
      ctx.fillStyle = fade;
      ctx.fillRect(x, y, w, h);
    }

    // Dirt film and fine grain.
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(14, 17, 15, ${0.02 + random() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, 3 + random() * 22, 2 + random() * 14, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 1800; i++) {
      const light = random() > 0.55;
      const a = 0.01 + random() * 0.035;
      const c = light ? 196 : 12;
      ctx.fillStyle = `rgba(${c}, ${c}, ${light ? 176 : 14}, ${a})`;
      ctx.fillRect(random() * size, random() * size, 1 + random() * 5, 1 + random() * 3);
    }
  });
}

/** Worn dark capstones: pale walked tops, dark joints, chipped slab corners. */
function pavingTexture() {
  return makeTexture(768, (ctx, size) => {
    const random = seeded(91);
    ctx.fillStyle = "#3c3e3a";
    ctx.fillRect(0, 0, size, size);

    const rows = 5;
    const cell = size / rows;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? -cell * 0.5 : 0;
      for (let x = offset - cell; x < size; x += cell * 1.22) {
        const w = cell * 1.22 - 8 - random() * 7;
        const h = cell - 10 - random() * 5;
        const tone = 68 + random() * 30;
        ctx.fillStyle = `rgb(${tone | 0}, ${(tone + 1) | 0}, ${(tone - 6) | 0})`;
        ctx.beginPath();
        ctx.roundRect(x + 5, row * cell + 5, w, h, 5);
        ctx.fill();

        // Pale worn top where feet and weather have polished the stone.
        const worn = ctx.createLinearGradient(x, row * cell + 5, x, row * cell + h);
        worn.addColorStop(0, "rgba(178, 178, 162, 0.2)");
        worn.addColorStop(1, "rgba(178, 178, 162, 0)");
        ctx.fillStyle = worn;
        ctx.beginPath();
        ctx.roundRect(x + 5, row * cell + 5, w, h, 5);
        ctx.fill();

        ctx.fillStyle = "rgba(12, 15, 13, 0.5)";
        ctx.fillRect(x + 3, row * cell + h + 3, w + 4, 6);
        ctx.fillRect(x + w + 2, row * cell + 3, 6, h + 6);

        if (random() > 0.48) {
          ctx.fillStyle = "rgba(16, 19, 17, 0.22)";
          ctx.beginPath();
          ctx.moveTo(x + w - 22, row * cell + h - 3);
          ctx.lineTo(x + w - 3, row * cell + h - 3);
          ctx.lineTo(x + w - 3, row * cell + h - 20);
          ctx.closePath();
          ctx.fill();
        }

        for (let p = 0; p < 14; p++) {
          ctx.fillStyle = `rgba(${random() > 0.5 ? 12 : 168}, ${random() > 0.5 ? 15 : 170}, 14, ${0.02 + random() * 0.05})`;
          ctx.fillRect(x + 6 + random() * (w - 12), row * cell + 6 + random() * (h - 12), 2 + random() * 7, 2 + random() * 5);
        }
      }
    }

    for (let i = 0; i < 110; i++) {
      ctx.fillStyle = random() > 0.5 ? "rgba(96, 112, 74, 0.055)" : "rgba(16, 19, 17, 0.07)";
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, 12 + random() * 72, 8 + random() * 42, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Courtyard earth: cool damp dirt, worn tracks, dust and grit. */
function packedEarthTexture() {
  return makeTexture(1024, (ctx, size) => {
    const random = seeded(613);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#6d6250");
    grad.addColorStop(0.5, "#635a4a");
    grad.addColorStop(1, "#584f42");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 420; i++) {
      const r = 14 + random() * 110;
      const green = random();
      ctx.fillStyle =
        green > 0.72 ? "rgba(92, 106, 72, 0.1)" : green > 0.36 ? "rgba(52, 48, 38, 0.12)" : "rgba(160, 148, 118, 0.1)";
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, r * 1.45, r, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 18; i++) {
      const x0 = random() * size;
      const y0 = random() * size;
      const x1 = random() * size;
      const y1 = random() * size;
      ctx.strokeStyle = random() > 0.5 ? "rgba(168, 156, 122, 0.07)" : "rgba(38, 34, 27, 0.08)";
      ctx.lineWidth = 18 + random() * 34;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) * 0.5 + (random() - 0.5) * 220, (y0 + y1) * 0.5 + (random() - 0.5) * 220, x1, y1);
      ctx.stroke();
    }

    for (let i = 0; i < 240; i++) {
      const x = random() * size;
      const y = random() * size;
      const s = 1.5 + random() * 6;
      const shade = 74 + random() * 56;
      ctx.fillStyle = `rgba(${shade | 0}, ${(shade - 4) | 0}, ${(shade - 14) | 0}, 0.32)`;
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * 0.72, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 820; i++) {
      ctx.fillStyle = `rgba(28, 26, 20, ${0.03 + random() * 0.08})`;
      ctx.fillRect(random() * size, random() * size, 1 + random() * 4, 1 + random() * 3);
    }
  });
}

function groundTexture() {
  return makeTexture(768, (ctx, size) => {
    const random = seeded(205);
    ctx.fillStyle = "#6f6d5c";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 300; i++) {
      const r = 12 + random() * 74;
      ctx.fillStyle = random() > 0.44 ? "rgba(74, 88, 58, 0.12)" : "rgba(156, 148, 118, 0.1)";
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, r * 1.4, r, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 1100; i++) {
      ctx.fillStyle = `rgba(34, 38, 28, ${random() * 0.1})`;
      ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
    }
  });
}

function waterTexture() {
  return makeTexture(512, (ctx, size) => {
    const random = seeded(311);
    ctx.fillStyle = "#2c4744";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const x = random() * size;
      const y = random() * size;
      ctx.strokeStyle = random() > 0.5 ? "rgba(150, 180, 158, 0.09)" : "rgba(14, 32, 32, 0.16)";
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 20, y - 6, x + 40, y + 7, x + 62 + random() * 34, y);
      ctx.stroke();
    }
  });
}

function timberTexture() {
  return makeTexture(512, (ctx, size) => {
    const random = seeded(421);
    ctx.fillStyle = "#4b3928";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i++) {
      ctx.strokeStyle = random() > 0.5 ? "rgba(22, 16, 11, 0.2)" : "rgba(132, 104, 74, 0.13)";
      ctx.lineWidth = 0.7 + random() * 2.8;
      const y = random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + (random() - 0.5) * 9, size * 0.7, y + (random() - 0.5) * 9, size, y);
      ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const x = random() * size;
      const y = random() * size;
      const g = ctx.createLinearGradient(x, y, x, y + 40 + random() * 90);
      g.addColorStop(0, "rgba(96, 112, 74, 0.12)");
      g.addColorStop(1, "rgba(96, 112, 74, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 3 + random() * 8, 40 + random() * 90);
    }
  });
}

/**
 * Rubble: fallen dark stones of every size bedded in grit and earth, with damp
 * moss in the hollows. Stones that cross an edge are drawn again on the far
 * side, so the tile wraps without a visible seam.
 */
function rubbleTexture() {
  return makeTexture(1024, (ctx, size) => {
    const random = seeded(808);
    ctx.fillStyle = "#47443a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 240; i++) {
      const r = 16 + random() * 90;
      ctx.fillStyle = random() > 0.5 ? "rgba(32, 31, 25, 0.16)" : "rgba(118, 110, 88, 0.1)";
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, r * 1.3, r, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const outline = (cx: number, cy: number, radius: number, shape: number[], scale = 1) => {
      ctx.beginPath();
      shape.forEach((k, i) => {
        const a = (i / shape.length) * Math.PI * 2;
        const px = cx + Math.cos(a) * radius * k * scale;
        const py = cy + Math.sin(a) * radius * k * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    };

    for (let i = 0; i < 640; i++) {
      const radius = 5 + Math.pow(random(), 2.2) * 46;
      const count = 6 + Math.floor(random() * 4);
      const shape = Array.from({ length: count }, () => 0.72 + random() * 0.38);
      const tone = random();
      const v = 0.8 + random() * 0.45;
      const base = tone < 0.3 ? [58, 60, 58] : tone < 0.58 ? [78, 79, 74] : tone < 0.82 ? [82, 75, 64] : [64, 74, 62];
      const fill = `rgb(${(base[0] * v) | 0}, ${(base[1] * v) | 0}, ${(base[2] * v) | 0})`;
      const x = random() * size;
      const y = random() * size;
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const cx = x + ox;
          const cy = y + oy;
          if (cx + radius * 1.5 < 0 || cx - radius * 1.5 > size) continue;
          if (cy + radius * 1.5 < 0 || cy - radius * 1.5 > size) continue;
          ctx.fillStyle = "rgba(10, 11, 9, 0.42)";
          outline(cx + radius * 0.16, cy + radius * 0.22, radius, shape);
          ctx.fill();
          ctx.fillStyle = fill;
          outline(cx, cy, radius, shape);
          ctx.fill();
          ctx.strokeStyle = "rgba(190, 190, 172, 0.1)";
          ctx.lineWidth = Math.max(1, radius * 0.07);
          outline(cx - radius * 0.06, cy - radius * 0.08, radius, shape, 0.82);
          ctx.stroke();
        }
      }
    }

    for (let i = 0; i < 170; i++) {
      ctx.fillStyle = `rgba(86, 106, 62, ${0.06 + random() * 0.14})`;
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, 6 + random() * 30, 4 + random() * 18, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = random() > 0.5 ? `rgba(168, 164, 144, ${random() * 0.12})` : `rgba(12, 13, 10, ${random() * 0.16})`;
      ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
    }
  });
}

export type FortMaterials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  const stone = stoneTexture();
  const paving = pavingTexture();
  const packedEarth = packedEarthTexture();
  const ground = groundTexture();
  const water = waterTexture();
  const timber = timberTexture();
  const rubbleMap = rubbleTexture();

  // One texture tile covers roughly 6.3 m, keeping blocks large and making
  // repetition difficult to pick out across a curtain wall.
  stone.repeat.set(0.72, 0.72);
  paving.repeat.set(1, 1);
  packedEarth.repeat.set(1.15, 1.15);
  ground.repeat.set(18, 18);
  water.repeat.set(7, 7);

  const textures = [stone, paving, packedEarth, ground, water, timber, rubbleMap];
  const vc = { vertexColors: true } as const;

  const rubble = new THREE.MeshStandardMaterial({ map: rubbleMap, color: 0xc4c2b4, roughness: 1, ...vc });
  addCoastalWeathering(rubble, 0.85, 2.4);

  const wall = new THREE.MeshStandardMaterial({ map: stone, color: 0xc6cabf, roughness: 0.98, ...vc });
  const base = new THREE.MeshStandardMaterial({ map: stone, color: 0x969d8e, roughness: 1, ...vc });
  const cap = new THREE.MeshStandardMaterial({ map: paving, color: 0xbdbdae, roughness: 0.98, ...vc });
  const revetment = new THREE.MeshStandardMaterial({
    map: stone,
    color: 0x8d9488,
    roughness: 1,
    side: THREE.DoubleSide,
    ...vc,
  });
  addCoastalWeathering(wall, 0.72, 3.3);
  addCoastalWeathering(base, 1.05, 3.8);
  addCoastalWeathering(cap, 0.28, 1.35);
  addCoastalWeathering(revetment, 1.2, 4.4);

  return {
    textures,
    /** Main dark masonry: curtains, bastions, piers, gate. */
    wall,
    /** Damp lower courses, plinths and moat revetments. */
    base,
    /** Worn capstone: rampart deck, copings, stair treads. */
    cap,
    /** Fallen stone and grit: the ruin floor, heaps and the rubble slope. */
    rubble,
    timber: new THREE.MeshStandardMaterial({ map: timber, color: 0x8d7355, roughness: 0.92, ...vc }),

    paving: new THREE.MeshStandardMaterial({ map: paving, color: 0x9d9d90, roughness: 0.98 }),
    stone: new THREE.MeshStandardMaterial({ map: stone, color: 0x9fa49a, roughness: 0.98 }),
    packed: new THREE.MeshStandardMaterial({ map: packedEarth, color: 0xa39c8c, roughness: 1 }),
    /** Stone-flecked rubble floor where a wall fell. */
    debris: new THREE.MeshStandardMaterial({ map: packedEarth, color: 0x8c8779, roughness: 1 }),
    ground: new THREE.MeshStandardMaterial({ map: ground, color: 0x8b8a76, roughness: 1 }),
    earth: new THREE.MeshStandardMaterial({ color: 0x4b4b3c, roughness: 1, side: THREE.DoubleSide }),
    revetment,
    water: new THREE.MeshStandardMaterial({
      map: water,
      color: 0x8fae9f,
      roughness: 0.34,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
    }),
    sea: new THREE.MeshStandardMaterial({ map: water, color: 0x6f928e, roughness: 0.28, metalness: 0.14 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b3130, roughness: 0.46, metalness: 0.66 }),
    wood: new THREE.MeshStandardMaterial({ map: timber, color: 0x7d6446, roughness: 0.93 }),
    bore: new THREE.MeshBasicMaterial({ color: 0x11100f }),
    shadowed: new THREE.MeshStandardMaterial({ color: 0x22231f, roughness: 1 }),
    grass: new THREE.MeshStandardMaterial({ color: 0x5c6b48, roughness: 1, side: THREE.DoubleSide }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x3e5c42, roughness: 0.9, side: THREE.DoubleSide }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5f4c39, roughness: 0.95 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x5c5e54, roughness: 1 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0xb4573a, roughness: 0.85, side: THREE.DoubleSide }),
  };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */
/* ------------------------------------------------------------------ */

export function boxGeo(w: number, h: number, d: number, scale = UV_SCALE) {
  const geometry = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const faceDims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 6; i++) {
      const index = face * 6 + i;
      uv.setXY(index, uv.getX(index) * faceDims[face][0] * scale, uv.getY(index) * faceDims[face][1] * scale);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

export function shapeFromPolygon(points: Point[], holes: Point[][] = []) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, -points[0].z);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, -points[i].z);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    path.moveTo(hole[0].x, -hole[0].z);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, -hole[i].z);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

export function slabGeo(points: Point[], y: number, holes: Point[][] = [], scale = UV_SCALE) {
  const geometry = new THREE.ShapeGeometry(shapeFromPolygon(points, holes)).toNonIndexed();
  scaleUVs(geometry, scale);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

export function prismGeo(points: Point[], baseY: number, height: number, holes: Point[][] = [], scale = UV_SCALE) {
  const geometry = new THREE.ExtrudeGeometry(shapeFromPolygon(points, holes), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  scaleUVs(geometry, scale);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, baseY, 0);
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

export function ribbonGeo(top: Point[], topY: number, bottom: Point[], bottomY: number, scale = UV_SCALE) {
  const count = top.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  let run = 0;
  const fall = Math.abs(topY - bottomY);
  for (let i = 0; i < count; i++) {
    const a = top[i];
    const b = top[(i + 1) % count];
    const a2 = bottom[i];
    const b2 = bottom[(i + 1) % count];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    const u0 = run * scale;
    const u1 = (run + segment) * scale;
    const v1 = fall * scale;
    positions.push(a.x, topY, a.z, a2.x, bottomY, a2.z, b.x, topY, b.z);
    uvs.push(u0, v1, u0, 0, u1, v1);
    positions.push(b.x, topY, b.z, a2.x, bottomY, a2.z, b2.x, bottomY, b2.z);
    uvs.push(u1, v1, u0, 0, u1, 0);
    run += segment;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function scaleUVs(geometry: THREE.BufferGeometry, scale: number) {
  const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * scale, uv.getY(i) * scale);
  uv.needsUpdate = true;
  return geometry;
}

const MERGE_ATTRS: [string, number][] = [
  ["position", 3],
  ["normal", 3],
  ["uv", 2],
];

export function mergeGeometries(parts: THREE.BufferGeometry[]) {
  let total = 0;
  for (const part of parts) total += part.attributes.position.count;
  const merged = new THREE.BufferGeometry();
  for (const [name, size] of MERGE_ATTRS) {
    const array = new Float32Array(total * size);
    let offset = 0;
    for (const part of parts) {
      const attribute = part.attributes[name] as THREE.BufferAttribute | undefined;
      const count = part.attributes.position.count;
      if (attribute) array.set(attribute.array as Float32Array, offset * size);
      offset += count;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  return merged;
}

/**
 * Bakes age into vertex colours rather than tiling it into the texture.
 *
 * Moss gathers where water actually sits: low down, on shaded down-facing or
 * vertical stone, near the moat, and in patchy drifts instead of an even coat.
 * Exposed up-facing surfaces bleach and stay mostly clean.
 */
export function applyWeathering(geometry: THREE.BufferGeometry, options: { moss?: number; bleach?: number } = {}) {
  const mossStrength = options.moss ?? 1;
  const bleach = options.bleach ?? 1;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ny = normal ? normal.getY(i) : 0;

    // Dampness: strongest at the foot of the wall and below the water line.
    const damp = THREE.MathUtils.clamp(1 - y / 3.0, 0, 1);
    const exposure = THREE.MathUtils.clamp(ny, 0, 1);
    const sun = THREE.MathUtils.clamp((y - 3.1) / 4.4, 0, 1) * 0.09 * bleach;

    // Two slow noise octaves give patchy, organic drifts instead of uniform grime.
    const patch = 0.5 + 0.5 * Math.sin(x * 0.37 + z * 0.29) * Math.sin(z * 0.53 - x * 0.41 + 1.1);
    const fine = 0.5 + 0.5 * Math.sin(x * 1.63 + 0.7) * Math.sin(z * 1.29 - 0.4);
    const drift = (patch - 0.5) * 0.07 + (fine - 0.5) * 0.035;

    // Sea-facing walls pick up a little salt bloom.
    const salt = THREE.MathUtils.clamp((-z - 6) / 20, 0, 1) * (0.022 + (fine - 0.5) * 0.018);

    let moss = damp * damp * (0.3 + 0.8 * patch) * (0.7 + 0.55 * fine) * mossStrength;
    moss *= 1 - 0.76 * exposure;
    moss = THREE.MathUtils.clamp(moss, 0, 0.82);

    const shade = 1 - damp * 0.26 + sun + drift + salt;
    colors[i * 3] = Math.max(0, shade * (1 - moss * 0.54));
    colors[i * 3 + 1] = Math.max(0, shade * (1 - moss * 0.06) + moss * 0.05);
    colors[i * 3 + 2] = Math.max(0, shade * (1 - moss * 0.72));
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Moss appetite per material group: damp masonry keeps the most, caps the least. */
function mossBoost(key: string) {
  if (key === "base") return 1.75;
  if (key === "wall") return 1.15;
  if (key === "cap") return 0.82;
  if (key === "plaster") return 0.9;
  return 1;
}

export class Batcher {
  private groups = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[]; moss: number }>();

  add(key: string, material: THREE.Material, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, moss = 1) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const part = matrix ? source.clone().applyMatrix4(matrix) : source;
    for (const name of Object.keys(part.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) part.deleteAttribute(name);
    }
    if (!part.attributes.normal) part.computeVertexNormals();
    const group = this.groups.get(key);
    if (group) group.parts.push(part);
    else this.groups.set(key, { material, parts: [part], moss });
  }

  box(
    key: string,
    material: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
    rotationY = 0,
    moss = 1,
  ) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(position[0], position[1], position[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(key, material, boxGeo(size[0], size[1], size[2]), matrix, moss);
  }

  flush(parent: THREE.Object3D) {
    for (const [key, group] of this.groups) {
      const merged = mergeGeometries(group.parts);
      applyWeathering(merged, { moss: group.moss * mossBoost(key) });
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, group.material);
      mesh.name = `fort-${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      for (const part of group.parts) part.dispose();
    }
    this.groups.clear();
  }
}
