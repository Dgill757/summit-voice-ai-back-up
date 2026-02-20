/**
 * AvaParticleScene — Premium Three.js particle face effect
 *
 * Technique: SVG portrait → canvas getImageData → bright pixels become particles.
 * This is the same image-based approach used by Epiminds and similar high-end
 * particle face demos. The face SVG is embedded directly — no external files needed.
 *
 * Pipeline:
 *  1. Render embedded face SVG to an off-screen canvas
 *  2. getImageData() → collect all pixels with brightness > threshold
 *  3. Sample `count` particles from those pixels (weighted by brightness)
 *  4. Map pixel (x,y) → Three.js world coords, add tiny Z noise
 *  5. Sphere → face morph via GSAP-driven uMorph
 *  6. AdditiveBlending glow + mouse parallax + scroll dissolution
 */

import React, { useRef, useMemo, useEffect, useState, Component, ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT = /* glsl */`
  attribute vec3  aFacePos;
  attribute vec3  aNormal;
  attribute float aRandom;
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aDelay;

  uniform float uTime;
  uniform float uMorph;
  uniform float uScroll;
  uniform vec2  uMouse;
  uniform float uPixelRatio;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;
  varying float vDepth;

  void main() {
    vColor = aColor;

    // 1. Sphere → face morph
    vec3 pos = mix(position, aFacePos, uMorph);

    // 2. Staggered normal-based dissolution on scroll
    float scatter = smoothstep(aRandom - 0.12, aRandom + 0.02, uScroll * uMorph);
    pos += aNormal * scatter * 2.8;
    pos.y += scatter * (aRandom - 0.5) * 2.0;

    // 3. Organic float
    float floatAmt = smoothstep(0.78, 1.0, uMorph) * (1.0 - uScroll);
    pos.y += sin(uTime * 0.40 + aDelay)        * 0.015 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.008 * floatAmt;

    // 4. Depth varying — front of face (z≈0.55) → 1.0, back (z≈-0.1) → 0.0
    vDepth = clamp((aFacePos.z + 0.1) / 0.65, 0.0, 1.0);

    // 5. Two-point lighting with Lambert diffuse + specular
    //    Key light: OPPOSITE the mouse (rim/back-lit drama)
    vec3 keyLightPos  = vec3(-uMouse.x * 2.6, -uMouse.y * 1.8 + 0.3, 3.2);
    //    Fill light: same side as mouse (soft secondary bounce)
    vec3 fillLightPos = vec3( uMouse.x * 1.2,  uMouse.y * 0.8 + 1.6, 1.8);

    // Key light — Lambert + specular
    vec3  keyDir   = normalize(keyLightPos - pos);
    float keyLamb  = max(0.0, dot(aNormal, keyDir));
    float keyFall  = 1.4 / (1.0 + distance(pos, keyLightPos) * 0.36);
    // Blinn-Phong specular (nose tip / forehead bright cluster)
    vec3  viewDir  = normalize(vec3(0.0, 0.0, 4.5) - pos);
    vec3  halfVec  = normalize(keyDir + viewDir);
    float spec     = pow(max(0.0, dot(aNormal, halfVec)), 16.0) * keyFall;
    float keyLight = keyLamb * keyFall * 2.2 + spec * 3.2;

    // Fill light — soft Lambert only
    vec3  fillDir   = normalize(fillLightPos - pos);
    float fillLamb  = max(0.0, dot(aNormal, fillDir));
    float fillLight = fillLamb * 0.50;

    // Ambient — thin floor so shadowed areas stay faintly visible
    float ambient = 0.07;

    vBrightness = ambient + keyLight + fillLight;

    // 6. Alpha: fade in during morph, wave-out during dissolution
    float morphFade    = smoothstep(0.0, 0.42, uMorph);
    float dissolveFade = 1.0 - scatter;
    vAlpha = morphFade * dissolveFade;

    // 7. Projection
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (350.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;
  varying float vDepth;

  void main() {
    vec2  coord = gl_PointCoord - 0.5;
    float dist  = length(coord);
    if (dist > 0.5) discard;

    // Crisp core + soft outer halo (two-layer glow)
    float core     = pow(max(0.0, 1.0 - dist * 2.6), 2.0);
    float halo     = exp(-dist * 5.5) * 0.38;
    float strength = core + halo;

    // Depth tint: front (nose/forehead) → warm white, back (hair) → cooler blue
    vec3 depthTint = mix(vec3(0.70, 0.88, 1.00), vec3(1.00, 1.00, 1.00), vDepth);

    vec3 color = vColor * vBrightness * depthTint;
    gl_FragColor = vec4(color * strength * vAlpha, strength * vAlpha);
  }
`;

// ─── Embedded face SVG ────────────────────────────────────────────────────────
//
// A detailed feminine portrait rendered at 512×640 in grayscale (white on black).
// Brightness maps directly to particle density — bright = more/larger particles.
// All color comes from particleColor(); the SVG is grayscale only.

// KEY TECHNIQUE: stroke/outline-based — particles concentrate at feature contours.
// Dark interior = sparse particles. Bright thick strokes = dense particle rings.
// Face fill is only 5% opacity so the face oval ring dominates.
const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 640" width="512" height="640">
  <rect width="512" height="640" fill="black"/>

  <!-- ══ HAIR — stroke-based flowing strands ══ -->
  <!-- Crown cluster: dense broad strokes fanning from top -->
  <path d="M 256 20 C 200 60 150 80 110 100" stroke="rgba(255,255,255,0.85)" stroke-width="36" fill="none" stroke-linecap="round"/>
  <path d="M 256 20 C 290 55 330 72 370 90"  stroke="rgba(255,255,255,0.85)" stroke-width="36" fill="none" stroke-linecap="round"/>
  <path d="M 256 20 C 256 50 240 80 230 110"  stroke="rgba(255,255,255,0.80)" stroke-width="28" fill="none" stroke-linecap="round"/>
  <path d="M 256 20 C 256 50 272 80 282 110"  stroke="rgba(255,255,255,0.80)" stroke-width="28" fill="none" stroke-linecap="round"/>
  <path d="M 256 18 C 180 48 130 65 90 82"   stroke="rgba(255,255,255,0.65)" stroke-width="20" fill="none" stroke-linecap="round"/>
  <path d="M 256 18 C 332 48 382 65 422 82"  stroke="rgba(255,255,255,0.65)" stroke-width="20" fill="none" stroke-linecap="round"/>

  <!-- Left side cascades: 6 strands flowing to shoulder -->
  <path d="M 95 185 C 60 300 44 430 62 575"   stroke="rgba(255,255,255,0.88)" stroke-width="34" fill="none" stroke-linecap="round"/>
  <path d="M 72 215 C 40 335 28 455 46 580"   stroke="rgba(255,255,255,0.74)" stroke-width="22" fill="none" stroke-linecap="round"/>
  <path d="M 52 248 C 24 365 16 475 36 568"   stroke="rgba(255,255,255,0.58)" stroke-width="15" fill="none" stroke-linecap="round"/>
  <path d="M 118 168 C 88 285 82 405 99 528"  stroke="rgba(255,255,255,0.62)" stroke-width="19" fill="none" stroke-linecap="round"/>
  <path d="M 140 155 C 114 268 110 385 126 505" stroke="rgba(255,255,255,0.46)" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M 160 148 C 138 255 136 365 150 478" stroke="rgba(255,255,255,0.36)" stroke-width="9"  fill="none" stroke-linecap="round"/>

  <!-- Right side cascades: mirror of left -->
  <path d="M 417 185 C 452 300 468 430 450 575"  stroke="rgba(255,255,255,0.88)" stroke-width="34" fill="none" stroke-linecap="round"/>
  <path d="M 440 215 C 472 335 484 455 466 580"  stroke="rgba(255,255,255,0.74)" stroke-width="22" fill="none" stroke-linecap="round"/>
  <path d="M 460 248 C 488 365 496 475 476 568"  stroke="rgba(255,255,255,0.58)" stroke-width="15" fill="none" stroke-linecap="round"/>
  <path d="M 394 168 C 424 285 430 405 413 528"  stroke="rgba(255,255,255,0.62)" stroke-width="19" fill="none" stroke-linecap="round"/>
  <path d="M 372 155 C 398 268 402 385 386 505"  stroke="rgba(255,255,255,0.46)" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M 352 148 C 374 255 376 365 362 478"  stroke="rgba(255,255,255,0.36)" stroke-width="9"  fill="none" stroke-linecap="round"/>

  <!-- ══ NECK & SHOULDERS ══ -->
  <line x1="228" y1="512" x2="218" y2="600" stroke="rgba(255,255,255,0.60)" stroke-width="70" stroke-linecap="round"/>
  <line x1="284" y1="512" x2="294" y2="600" stroke="rgba(255,255,255,0.60)" stroke-width="70" stroke-linecap="round"/>
  <path d="M 68 632 Q 256 602 444 632" stroke="rgba(255,255,255,0.46)" stroke-width="28" fill="none" stroke-linecap="round"/>

  <!-- ══ FACE OVAL ══ -->
  <!-- Very dim interior fill — just enough for sparse face particles -->
  <ellipse cx="256" cy="310" rx="160" ry="198" fill="rgba(255,255,255,0.05)"/>
  <!-- Thick bright ring — bulk of face-outline particles come from here -->
  <ellipse cx="256" cy="310" rx="160" ry="198" fill="none" stroke="rgba(255,255,255,0.90)" stroke-width="24"/>

  <!-- ══ EYEBROWS — high feminine arches ══ -->
  <path d="M 150 234 Q 194 212 240 227" stroke="rgba(255,255,255,0.97)" stroke-width="14" fill="none" stroke-linecap="round"/>
  <path d="M 272 227 Q 318 212 362 234" stroke="rgba(255,255,255,0.97)" stroke-width="14" fill="none" stroke-linecap="round"/>

  <!-- ══ LEFT EYE ══ -->
  <!-- Upper lash arc (bright arc above the eye) -->
  <path d="M 148 263 Q 196 246 244 263" stroke="rgba(255,255,255,0.90)" stroke-width="10" fill="none" stroke-linecap="round"/>
  <!-- Eye ring — the main shape -->
  <ellipse cx="196" cy="275" rx="46" ry="26" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.98)" stroke-width="15"/>
  <!-- Iris ring -->
  <ellipse cx="196" cy="275" rx="20" ry="20" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="7"/>
  <!-- Pupil void -->
  <ellipse cx="196" cy="275" rx="9"  ry="9"  fill="rgba(0,0,0,0.96)"/>
  <!-- Bright highlight -->
  <circle  cx="203" cy="267" r="6"   fill="white"/>
  <!-- Lower lash subtle -->
  <path d="M 152 285 Q 196 298 240 285" stroke="rgba(255,255,255,0.28)" stroke-width="5" fill="none" stroke-linecap="round"/>

  <!-- ══ RIGHT EYE ══ -->
  <path d="M 268 263 Q 316 246 364 263" stroke="rgba(255,255,255,0.90)" stroke-width="10" fill="none" stroke-linecap="round"/>
  <ellipse cx="316" cy="275" rx="46" ry="26" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.98)" stroke-width="15"/>
  <ellipse cx="316" cy="275" rx="20" ry="20" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="7"/>
  <ellipse cx="316" cy="275" rx="9"  ry="9"  fill="rgba(0,0,0,0.96)"/>
  <circle  cx="323" cy="267" r="6"   fill="white"/>
  <path d="M 272 285 Q 316 298 360 285" stroke="rgba(255,255,255,0.28)" stroke-width="5" fill="none" stroke-linecap="round"/>

  <!-- ══ NOSE ══ -->
  <path d="M 252 303 L 248 354" stroke="rgba(255,255,255,0.36)" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M 220 366 Q 254 380 288 366" stroke="rgba(255,255,255,0.44)" stroke-width="9" fill="none" stroke-linecap="round"/>

  <!-- ══ LIPS ══ -->
  <!-- Upper lip — Cupid's bow -->
  <path d="M 202 404 Q 228 388 256 396 Q 284 388 310 404" stroke="rgba(255,255,255,0.97)" stroke-width="15" fill="none" stroke-linecap="round"/>
  <!-- Lower lip — full arc, fullest at centre -->
  <path d="M 206 410 Q 256 446 306 410" stroke="rgba(255,255,255,0.99)" stroke-width="17" fill="none" stroke-linecap="round"/>
  <!-- Subtle lip line -->
  <path d="M 208 408 Q 256 415 304 408" stroke="rgba(255,255,255,0.20)" stroke-width="4"  fill="none"/>

  <!-- ══ CHIN & JAW HINT ══ -->
  <path d="M 214 500 Q 256 520 298 500" stroke="rgba(255,255,255,0.28)" stroke-width="10" fill="none" stroke-linecap="round"/>
</svg>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rnd = Math.random;
const rng = (a: number, b: number) => a + rnd() * (b - a);

/** Multi-hue particle color: bright cyan dominant, blue-cyan, white-hot sparkles */
function particleColor(brightness: number): [number, number, number] {
  const l   = brightness * rng(0.75, 1.0);
  const hue = rnd();
  if (hue < 0.45) {
    // Bright cyan — dominant
    return [l * rng(0.00, 0.12), l * rng(0.72, 1.00), l * rng(0.88, 1.00)];
  } else if (hue < 0.72) {
    // Cyan-blue
    return [l * rng(0.05, 0.22), l * rng(0.50, 0.80), l * rng(0.90, 1.00)];
  } else if (hue < 0.88) {
    // White-hot sparkle
    return [l * rng(0.75, 1.00), l * rng(0.92, 1.00), l * rng(0.92, 1.00)];
  } else {
    // Teal-green edge glow
    return [l * rng(0.00, 0.10), l * rng(0.85, 1.00), l * rng(0.60, 0.82)];
  }
}

// ─── Sphere positions (morph start) ───────────────────────────────────────────

function makeSpherePositions(count: number): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi   = Math.acos(1 - 2 * rnd());
    const theta = rnd() * Math.PI * 2;
    const r     = 1.62 * rng(0.88, 1.12);
    arr[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    arr[i*3+1] = r * Math.cos(phi);
    arr[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
  }
  return arr;
}

// ─── Face geometry data type ──────────────────────────────────────────────────

interface FaceData {
  positions: Float32Array;
  normals:   Float32Array;
  randoms:   Float32Array;
  colors:    Float32Array;
  sizes:     Float32Array;
  delays:    Float32Array;
}

// ─── Image-based sampler ──────────────────────────────────────────────────────
//
// Renders the SVG to an off-screen canvas, reads pixel brightness, and
// places particles at bright pixel locations.
// Pixel mapping (SVG canvas 512×640 → Three.js world space):
//   x: px∈[0,512] → [-1.5, +1.5]   (face width = 3.0 units)
//   y: py∈[0,640] → [+2.0, -2.0]   (face height = 4.0 units, Y flipped)
//   z: tiny noise ∈[-0.08, +0.18]   (depth gives parallax)

const W = 512, H = 640;

// Face oval world-space geometry (derived from SVG: cx=256,cy=310, rx=160,ry=198)
// x = ((px/W) - 0.5) * 3.0  →  rx pixels = 0.938 world units
// y = -((py/H) - 0.5) * 4.0 →  ry pixels = 1.238 world units
const FACE_CX    = 0.00;   // face center X
const FACE_CY    = 0.06;   // face center Y (slightly above mid)
const FACE_HW    = 0.938;  // face half-width
const FACE_HH    = 1.238;  // face half-height
const FACE_DEPTH = 0.55;   // max Z protrusion at nose tip

// ─── Core pixel sampler (shared by photo and SVG paths) ──────────────────────

function sampleImageDataToFaceData(
  imageData: ImageData,
  srcW: number,
  srcH: number,
  count: number,
): FaceData {
  const data = imageData.data;

  type Pixel = { px: number; py: number; b: number };
  const pool: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const b = (data[i] + data[i+1] + data[i+2]) / (3 * 255);
    if (b < 0.06) continue;                  // skip near-black (background)
    const px = (i / 4) % srcW;
    const py = Math.floor((i / 4) / srcW);
    const weight = Math.ceil(b * 4);         // repeat 1-4× — biases toward bright features
    for (let w = 0; w < weight; w++) pool.push({ px, py, b });
  }

  const positions = new Float32Array(count * 3);
  const normals   = new Float32Array(count * 3);
  const randoms   = new Float32Array(count);
  const colors    = new Float32Array(count * 3);
  const sizes     = new Float32Array(count);
  const delays    = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const { px, py, b } = pool[Math.floor(rnd() * pool.length)];
    const jx = rng(-0.8, 0.8);
    const jy = rng(-0.8, 0.8);
    // Map pixel → Three.js world: x[-1.5,1.5], y[+2,-2] (flip Y)
    const x = ((px + jx) / srcW - 0.5) * 3.0;
    const y = -(((py + jy) / srcH) - 0.5) * 4.0;

    // Spherical Z-depth: model the face as a flattened ellipsoid.
    // Nose tip (center) protrudes FACE_DEPTH toward camera; edges are at z≈0;
    // hair/background is slightly negative.
    const nFX     = (x - FACE_CX) / FACE_HW;
    const nFY     = (y - FACE_CY) / FACE_HH;
    const r2      = nFX * nFX + nFY * nFY;
    const zSphere = Math.sqrt(Math.max(0, 1.0 - Math.min(r2, 1.0)));
    const z       = zSphere * FACE_DEPTH + rng(-0.012, 0.012);

    positions[i*3] = x; positions[i*3+1] = y; positions[i*3+2] = z;

    // Proper ellipsoid surface normals: gradient of x²/a² + y²/b² + z²/c² = 1
    // = (x/a², y/b², z/c²) → simplified as (nFX/HW, nFY/HH, zSphere/DEPTH)
    const ell_nx = nFX / FACE_HW;
    const ell_ny = nFY / FACE_HH;
    const ell_nz = zSphere / FACE_DEPTH;  // 1.0 at nose, 0 at jaw edge
    const nl     = Math.sqrt(ell_nx*ell_nx + ell_ny*ell_ny + ell_nz*ell_nz) || 1;
    normals[i*3] = ell_nx/nl; normals[i*3+1] = ell_ny/nl; normals[i*3+2] = nl > 0 ? ell_nz/nl : 1;
    randoms[i] = rnd();
    const [r, g, gc] = particleColor(b * rng(0.60, 1.00));
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = gc;
    sizes[i]  = rng(0.04, 0.09) + b * rng(0.00, 0.06);
    delays[i] = rnd() * Math.PI * 2;
  }
  return { positions, normals, randoms, colors, sizes, delays };
}

// ─── Photo loader — /public/ava-face.png (optional, best quality) ────────────
//
// Drop any portrait photo (dark background, face brightly lit) at /public/ava-face.png.
// The photo is NEVER rendered to screen — only its pixel brightness is used to
// place particles. After sampling, the pixel data is discarded.
// Returns null if the file doesn't exist yet.

function loadPhotoFaceData(count: number): Promise<FaceData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      resolve(sampleImageDataToFaceData(ctx.getImageData(0, 0, W, H), W, H, count));
    };
    img.onerror = () => resolve(null);  // file not present — fall through to SVG
    // Cache-bust so hot-reload picks up the file immediately after you drop it in
    img.src = '/ava-face.png?' + Math.floor(Date.now() / 60000);
  });
}

// ─── SVG sampler ─────────────────────────────────────────────────────────────

async function sampleFromSVG(svgString: string, count: number): Promise<FaceData> {
  return new Promise((resolve) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      resolve(sampleImageDataToFaceData(ctx.getImageData(0, 0, W, H), W, H, count));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(makeFeminineGeometry(count)); };
    img.src = url;
  });
}

// ─── Procedural fallback face geometry ────────────────────────────────────────
//
// Used only if the canvas/Blob API is unavailable (SSR, old WebView, etc.).

function makeFeminineGeometry(count: number): FaceData {
  const C = {
    headRing: Math.floor(count * 0.090),
    eyeLeft:  Math.floor(count * 0.065),
    eyeRight: Math.floor(count * 0.065),
    iris:     Math.floor(count * 0.025),
    brows:    Math.floor(count * 0.048),
    nose:     Math.floor(count * 0.038),
    lipsUp:   Math.floor(count * 0.055),
    lipsLow:  Math.floor(count * 0.060),
    cheeks:   Math.floor(count * 0.038),
    jaw:      Math.floor(count * 0.040),
    neck:     Math.floor(count * 0.028),
    hair:     Math.floor(count * 0.255),
    shoulder: Math.floor(count * 0.065),
    fill:     Math.floor(count * 0.055),
    ambient:  Math.floor(count * 0.040),
  };
  const used = Object.values(C).reduce((s, v) => s + v, 0);
  C.hair += count - used;

  const pos: number[] = [], nrm: number[] = [], rng2: number[] = [];
  const col: number[] = [], sz: number[] = [], del: number[] = [];

  function push(x: number, y: number, z: number, bright: number, size: number, ch = 0) {
    const l = bright * rng(0.62, 1.0);
    let r: number, g: number, b: number;
    if      (ch === 1) { r = l*rng(0.78,1.00); g = l*rng(0.10,0.28); b = l*rng(0.52,0.78); }
    else if (ch === 2) { r = l*rng(0.06,0.22); g = l*rng(0.38,0.68); b = l*rng(0.90,1.00); }
    else if (ch === 3) { r = l*rng(0.85,1.00); g = l*rng(0.80,1.00); b = l*rng(0.88,1.00); }
    else               { r = l*rng(0.28,0.48); g = l*rng(0.05,0.16); b = l*rng(0.85,1.00); }
    pos.push(x + rng(-0.005,0.005), y + rng(-0.005,0.005), z + rng(-0.004,0.004));
    nrm.push(0, 0, 1);
    rng2.push(rnd());
    col.push(r, g, b);
    sz.push(size * rng(0.72, 1.28));
    del.push(rnd() * Math.PI * 2);
  }

  function autoColor(): number {
    const h = rnd(); return h < 0.50 ? 0 : h < 0.75 ? 1 : h < 0.88 ? 2 : 3;
  }

  for (let i = 0; i < C.headRing; i++) {
    const a = rnd() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const rx = 0.62 + rng(-0.018, 0.018);
    const ry = sa > 0 ? 0.88 + rng(-0.018, 0.018) : 0.70 + rng(-0.018, 0.018);
    push(rx * ca, ry * sa + 0.16, rng(-0.02, 0.02), rng(0.42, 0.78), rng(0.07, 0.17));
  }
  for (const { ex, ey } of [{ ex: -0.245, ey: 0.245 }, { ex: 0.245, ey: 0.245 }]) {
    const n = Math.floor(C.eyeLeft / 2);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, s = rng(0.88, 1.12);
      const bright = Math.sin(a) > 0 ? rng(0.80, 1.00) : rng(0.52, 0.78);
      push(ex + 0.158*s*Math.cos(a), ey + 0.100*s*Math.sin(a), 0.08, bright, rng(0.11, 0.26), rnd() < 0.40 ? 2 : rnd() < 0.50 ? 3 : 0);
    }
  }
  for (const { ex, ey } of [{ ex: -0.245, ey: 0.245 }, { ex: 0.245, ey: 0.245 }]) {
    const n = Math.floor(C.iris / 2);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r2 = rnd() * 0.070;
      push(ex + r2*Math.cos(a)*1.45, ey + r2*Math.sin(a)*0.90, 0.06, rng(0.22, 0.52), rng(0.05, 0.13), 2);
    }
  }
  for (const ex of [-0.245, 0.245]) {
    const n = Math.floor(C.brows / 2);
    for (let i = 0; i < n; i++) {
      const t = rng(-1, 1), arch = 0.026 * (1 - Math.abs(t));
      push(ex + t * 0.158, 0.378 + arch, 0.09, rng(0.58, 0.94), rng(0.06, 0.17));
    }
  }
  for (let i = 0; i < C.nose; i++) {
    const q = rnd();
    if (q < 0.42) { push(rng(-0.013,0.013), 0.155 - rnd()*0.245, 0.10, rng(0.48,0.82), rng(0.05,0.13)); }
    else if (q < 0.68) { const a = rnd()*Math.PI*2; push(rnd()*0.032*Math.cos(a), -0.108+rnd()*0.026*Math.sin(a), 0.13, rng(0.52,0.86), rng(0.05,0.13)); }
    else { const s = rnd()<0.5?-1:1; push(s*(0.064+rnd()*0.024), -0.148+rng(-0.012,0.012), 0.11, rng(0.42,0.78), rng(0.04,0.11)); }
  }
  for (let i = 0; i < C.lipsUp; i++) {
    const t = rng(-1,1), bow = 0.022*Math.max(0, 1-((Math.abs(t)-0.35)/0.65)**2) - 0.005;
    push(t*0.178, -0.278+bow, 0.11, rng(0.72,1.00), rng(0.09,0.23), 1);
  }
  for (let i = 0; i < C.lipsLow; i++) {
    const t = rng(-1,1); push(t*0.188, -0.358-0.022*(1-t*t), 0.11, rng(0.70,1.00), rng(0.09,0.23), 1);
  }
  for (const cx of [-0.355, 0.355]) {
    const n = Math.floor(C.cheeks / 2);
    for (let i = 0; i < n; i++) push(cx+rng(-0.105,0.105), 0.052+rng(-0.072,0.072), rng(0.03,0.09), rng(0.28,0.60), rng(0.05,0.15));
  }
  for (let i = 0; i < C.jaw; i++) {
    const t = rng(-1,1), at = Math.abs(t);
    push(t*0.47*(0.82+at*0.18), -0.50-(1-at*at)*0.22, rng(0,0.05), rng(0.30,0.62), rng(0.06,0.15));
  }
  for (let i = 0; i < C.neck; i++) push(rng(-0.112,0.112), -0.72-rnd()*0.40, rng(-0.01,0.05), rng(0.20,0.50), rng(0.04,0.13));
  for (let i = 0; i < C.hair; i++) {
    const side = rnd() < 0.5 ? -1 : 1; let x: number, y: number, z: number, bright: number, size: number;
    const q = rnd();
    if (q < 0.22) { const a = rnd()*Math.PI*2, rad = rng(0.22,1.18); x = Math.cos(a)*rad*rng(0.42,1.0); y = 0.98+rnd()*1.90; z = rng(-0.08,0.10); bright = rng(0.32,0.72); size = rng(0.06,0.19); }
    else if (q < 0.60) { const t = rnd(); x = side*(0.50+t*0.62+rng(-0.14,0.14)); y = 0.94-t*2.85; z = rng(-0.10,0.05); bright = rng(0.24,0.62); size = rng(0.05,0.17); }
    else if (q < 0.80) { x = side*rng(0.24,0.58); y = 0.90-rnd()*1.50; z = rng(0.04,0.15); bright = rng(0.28,0.65); size = rng(0.05,0.15); }
    else { const a = rnd()*Math.PI*2; x = Math.cos(a)*rng(0.55,1.52); y = rng(0.32,2.72); z = rng(-0.18,0.07); bright = rng(0.14,0.42); size = rng(0.03,0.12); }
    push(x, y, z, bright, size, rnd()<0.55?0:rnd()<0.55?1:2);
  }
  for (let i = 0; i < C.shoulder; i++) {
    const x = rng(-1.80,1.80), ax = Math.abs(x);
    push(x, -1.04-ax*0.068+rng(-0.17,0.17), rng(-0.06,0.06), rng(0.16,0.46), rng(0.05,0.15));
  }
  let filled = 0, guard = 0;
  while (filled < C.fill && guard < C.fill * 20) {
    guard++;
    const x = rng(-0.56,0.56), y = rng(-0.64,0.94);
    if ((x/0.62)**2 + ((y-0.16)/0.84)**2 > 0.88) continue;
    if (((x+0.245)/0.18)**2 + ((y-0.245)/0.12)**2 < 1.0) continue;
    if (((x-0.245)/0.18)**2 + ((y-0.245)/0.12)**2 < 1.0) continue;
    push(x, y, rng(-0.01,0.03), rng(0.06,0.18), rng(0.03,0.09));
    filled++;
  }
  for (let i = 0; i < C.ambient; i++) push(rng(-2.4,2.4), rng(-1.8,2.7), rng(-1.4,-0.2), rng(0.06,0.18), rng(0.03,0.09), autoColor());

  return {
    positions: new Float32Array(pos),
    normals:   new Float32Array(nrm),
    randoms:   new Float32Array(rng2),
    colors:    new Float32Array(col),
    sizes:     new Float32Array(sz),
    delays:    new Float32Array(del),
  };
}

// ─── Inner R3F particles component ───────────────────────────────────────────

interface ParticlesProps {
  scrollProgress: number;
  faceData: FaceData;
}

function AvaParticles({ scrollProgress, faceData }: ParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null!);
  const mouseRef  = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const count     = faceData.positions.length / 3;

  const spherePos = useMemo(() => makeSpherePositions(count), [count]);

  const uniforms = useMemo(() => ({
    uTime:       { value: 0 },
    uMorph:      { value: 0 },
    uScroll:     { value: 0 },
    uMouse:      { value: new THREE.Vector2(0, 0) },
    uPixelRatio: { value: Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2.0,
    ) },
  }), []);

  // Entrance: GSAP animates sphere → face morph
  useEffect(() => {
    gsap.to(uniforms.uMorph, {
      value: 1, duration: 2.8, delay: 0.35, ease: 'power3.inOut',
    });
  }, [uniforms]);

  // Scroll sync
  useEffect(() => {
    uniforms.uScroll.value = scrollProgress;
  }, [scrollProgress, uniforms]);

  // Mouse tracking
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      mouseRef.current.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouseRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', handle);
    return () => window.removeEventListener('mousemove', handle);
  }, []);

  // Animation loop
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const m = mouseRef.current;
    m.sx += (m.x - m.sx) * 0.055;
    m.sy += (m.y - m.sy) * 0.055;
    uniforms.uMouse.value.set(m.sx, m.sy);

    if (pointsRef.current) {
      const p = pointsRef.current;
      p.rotation.y += (m.sx * 0.28 - p.rotation.y) * 0.055;
      p.rotation.x += (-m.sy * 0.20 - p.rotation.x) * 0.055;
    }
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={spherePos}           count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aFacePos" array={faceData.positions}  count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aNormal"  array={faceData.normals}    count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aRandom"  array={faceData.randoms}    count={count} itemSize={1} />
        <bufferAttribute attach="attributes-aColor"   array={faceData.colors}     count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aSize"    array={faceData.sizes}      count={count} itemSize={1} />
        <bufferAttribute attach="attributes-aDelay"   array={faceData.delays}     count={count} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────

class CanvasErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ─── Outer component ──────────────────────────────────────────────────────────

interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
}

export default function AvaParticleScene({
  scrollProgress,
  className,
}: AvaParticleSceneProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const count    = isMobile ? 12000 : 35000;

  const [faceData, setFaceData] = useState<FaceData | null>(null);

  useEffect(() => {
    const canUseCanvas = typeof document !== 'undefined'
      && typeof Blob !== 'undefined'
      && typeof URL?.createObjectURL === 'function';

    if (!canUseCanvas) {
      setFaceData(makeFeminineGeometry(count));
      return;
    }

    // Priority 1: /public/ava-face.png — drop a real portrait here for best results
    // Priority 2: embedded SVG face (no external files needed)
    // Priority 3: procedural geometry fallback
    loadPhotoFaceData(count).then((photoData) => {
      if (photoData) {
        setFaceData(photoData);
      } else {
        sampleFromSVG(FACE_SVG, count)
          .then(setFaceData)
          .catch(() => setFaceData(makeFeminineGeometry(count)));
      }
    });
  }, [count]);

  if (!faceData) {
    return <div className={className} style={{ width: '100%', height: '100%' }} />;
  }

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <CanvasErrorBoundary fallback={<div style={{ width: '100%', height: '100%' }} />}>
        <Canvas
          camera={{ position: [0, 0, 4.5], fov: 52, near: 0.1, far: 100 }}
          gl={{
            alpha: true,
            antialias: false,
            powerPreference: 'high-performance',
          }}
          dpr={[1, 2]}
          style={{ background: 'transparent' }}
        >
          <AdaptiveDpr pixelated />
          <AvaParticles scrollProgress={scrollProgress} faceData={faceData} />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
