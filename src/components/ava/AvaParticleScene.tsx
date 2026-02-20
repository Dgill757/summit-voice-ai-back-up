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

  void main() {
    vColor = aColor;

    // 1. Sphere → face morph
    vec3 pos = mix(position, aFacePos, uMorph);

    // 2. Staggered normal-based dissolution on scroll
    float scatter = smoothstep(aRandom - 0.12, aRandom + 0.02, uScroll * uMorph);
    pos += aNormal * scatter * 2.8;
    pos.y += scatter * (aRandom - 0.5) * 2.0;

    // 3. Organic float (only when fully morphed in, fades on scroll)
    float floatAmt = smoothstep(0.78, 1.0, uMorph) * (1.0 - uScroll);
    pos.y += sin(uTime * 0.40 + aDelay)        * 0.015 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.008 * floatAmt;

    // 4. Alpha: fade in during morph, wave-out during dissolution
    float morphFade    = smoothstep(0.0, 0.42, uMorph);
    float dissolveFade = 1.0 - scatter;
    vAlpha = morphFade * dissolveFade;

    // 5. Mouse-driven specular hotspot
    vec3  lightPos  = vec3(uMouse.x * 1.8, uMouse.y * 1.2 + 0.6, 2.2);
    float lightDist = distance(pos, lightPos);
    vBrightness = 1.0 + (1.0 / (1.0 + lightDist * lightDist * 0.45)) * 0.80;

    // 6. Projection — 350.0 constant gives ~8-20 px particles at camera z=4.2
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (350.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    vec2  coord = gl_PointCoord - 0.5;
    float dist  = length(coord);
    if (dist > 0.5) discard;

    // Crisp core + soft outer halo (two-layer glow)
    float core     = pow(max(0.0, 1.0 - dist * 2.6), 2.0);
    float halo     = exp(-dist * 5.5) * 0.38;
    float strength = core + halo;

    vec3 color = vColor * vBrightness;
    gl_FragColor = vec4(color * strength * vAlpha, strength * vAlpha);
  }
`;

// ─── Embedded face SVG ────────────────────────────────────────────────────────
//
// A detailed feminine portrait rendered at 512×640 in grayscale (white on black).
// Brightness maps directly to particle density — bright = more/larger particles.
// All color comes from particleColor(); the SVG is grayscale only.

const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 640" width="512" height="640">
  <rect width="512" height="640" fill="black"/>

  <!-- ══ HAIR BACK VOLUME ══ -->
  <!-- Crown — wide, thick at top -->
  <ellipse cx="256" cy="50" rx="215" ry="128" fill="rgba(255,255,255,0.88)"/>
  <!-- Left cascade — long flowing hair down left side -->
  <path d="M 41 165 C 18 290 14 420 42 568 Q 60 615 78 572 C 58 448 64 318 95 202 Z" fill="rgba(255,255,255,0.82)"/>
  <!-- Right cascade — mirror -->
  <path d="M 471 165 C 494 290 498 420 470 568 Q 452 615 434 572 C 454 448 448 318 417 202 Z" fill="rgba(255,255,255,0.82)"/>
  <!-- Left inner cascade -->
  <path d="M 75 160 C 62 270 64 380 88 500 C 96 460 100 360 108 250 Z" fill="rgba(255,255,255,0.68)"/>
  <!-- Right inner cascade -->
  <path d="M 437 160 C 450 270 448 380 424 500 C 416 460 412 360 404 250 Z" fill="rgba(255,255,255,0.68)"/>

  <!-- ══ NECK & SHOULDERS ══ -->
  <path d="M 218 512 L 208 592 Q 256 640 304 592 L 294 512 Z" fill="rgba(255,255,255,0.62)"/>
  <ellipse cx="256" cy="636" rx="220" ry="52" fill="rgba(255,255,255,0.48)"/>
  <!-- Collarbone hints -->
  <path d="M 148 610 Q 256 595 364 610" stroke="rgba(255,255,255,0.35)" stroke-width="12" fill="none" stroke-linecap="round"/>

  <!-- ══ FACE OVAL ══ -->
  <ellipse cx="256" cy="308" rx="164" ry="206" fill="rgba(255,255,255,0.74)"/>

  <!-- ══ HAIR FRONT STRANDS — drape over face edges at temples ══ -->
  <!-- Left temple strand -->
  <path d="M 92 128 C 86 210 88 310 100 400" stroke="rgba(255,255,255,0.82)" stroke-width="30" fill="none" stroke-linecap="round"/>
  <!-- Right temple strand -->
  <path d="M 420 128 C 426 210 424 310 412 400" stroke="rgba(255,255,255,0.82)" stroke-width="30" fill="none" stroke-linecap="round"/>
  <!-- Left wispy strand (thinner) -->
  <path d="M 118 112 C 114 190 118 278 136 356" stroke="rgba(255,255,255,0.62)" stroke-width="16" fill="none" stroke-linecap="round"/>
  <!-- Right wispy strand -->
  <path d="M 394 112 C 398 190 394 278 376 356" stroke="rgba(255,255,255,0.62)" stroke-width="16" fill="none" stroke-linecap="round"/>
  <!-- Left face-framing strand (closest to face) -->
  <path d="M 135 105 C 130 175 135 250 148 322" stroke="rgba(255,255,255,0.48)" stroke-width="10" fill="none" stroke-linecap="round"/>
  <!-- Right face-framing strand -->
  <path d="M 377 105 C 382 175 377 250 364 322" stroke="rgba(255,255,255,0.48)" stroke-width="10" fill="none" stroke-linecap="round"/>

  <!-- ══ EYEBROWS — high feminine arches ══ -->
  <path d="M 154 232 Q 194 212 238 226" stroke="rgba(255,255,255,0.94)" stroke-width="11" fill="none" stroke-linecap="round"/>
  <path d="M 274 226 Q 318 212 358 232" stroke="rgba(255,255,255,0.94)" stroke-width="11" fill="none" stroke-linecap="round"/>

  <!-- ══ EYES ══ -->
  <!-- Left eye — upper lash line arc (bright, indicates lashes) -->
  <path d="M 152 266 Q 196 251 240 266" stroke="rgba(255,255,255,0.90)" stroke-width="8" fill="none" stroke-linecap="round"/>
  <!-- Left eye white -->
  <ellipse cx="196" cy="274" rx="42" ry="23" fill="rgba(255,255,255,0.96)"/>
  <!-- Left iris -->
  <ellipse cx="196" cy="274" rx="19" ry="19" fill="rgba(55,55,80,0.72)"/>
  <!-- Left pupil -->
  <ellipse cx="196" cy="274" rx="10" ry="10" fill="rgba(0,0,0,0.92)"/>
  <!-- Left eye highlight sparkle -->
  <ellipse cx="203" cy="267" rx="5" ry="5" fill="rgba(255,255,255,0.98)"/>
  <ellipse cx="188" cy="280" rx="2" ry="2" fill="rgba(255,255,255,0.70)"/>
  <!-- Left lower lash (subtle) -->
  <path d="M 155 282 Q 196 292 237 282" stroke="rgba(255,255,255,0.30)" stroke-width="4" fill="none" stroke-linecap="round"/>

  <!-- Right eye — upper lash line arc -->
  <path d="M 272 266 Q 316 251 360 266" stroke="rgba(255,255,255,0.90)" stroke-width="8" fill="none" stroke-linecap="round"/>
  <!-- Right eye white -->
  <ellipse cx="316" cy="274" rx="42" ry="23" fill="rgba(255,255,255,0.96)"/>
  <!-- Right iris -->
  <ellipse cx="316" cy="274" rx="19" ry="19" fill="rgba(55,55,80,0.72)"/>
  <!-- Right pupil -->
  <ellipse cx="316" cy="274" rx="10" ry="10" fill="rgba(0,0,0,0.92)"/>
  <!-- Right eye highlight sparkle -->
  <ellipse cx="323" cy="267" rx="5" ry="5" fill="rgba(255,255,255,0.98)"/>
  <ellipse cx="308" cy="280" rx="2" ry="2" fill="rgba(255,255,255,0.70)"/>
  <!-- Right lower lash -->
  <path d="M 275 282 Q 316 292 357 282" stroke="rgba(255,255,255,0.30)" stroke-width="4" fill="none" stroke-linecap="round"/>

  <!-- ══ NOSE ══ -->
  <!-- Bridge (subtle, delicate) -->
  <path d="M 253 302 L 250 354" stroke="rgba(255,255,255,0.36)" stroke-width="7" fill="none" stroke-linecap="round"/>
  <!-- Nose tip -->
  <ellipse cx="253" cy="360" rx="15" ry="10" fill="rgba(255,255,255,0.46)"/>
  <!-- Nostrils -->
  <ellipse cx="237" cy="367" rx="10" ry="7" fill="rgba(255,255,255,0.34)"/>
  <ellipse cx="271" cy="367" rx="10" ry="7" fill="rgba(255,255,255,0.34)"/>
  <!-- Nostril shadow separation -->
  <path d="M 237 361 Q 253 366 271 361" stroke="rgba(0,0,0,0.28)" stroke-width="3" fill="none"/>

  <!-- ══ LIPS ══ -->
  <!-- Upper lip — Cupid's bow (slightly brighter center dip) -->
  <path d="M 206 402 Q 226 392 256 398 Q 286 392 306 402 L 302 408 Q 280 400 256 404 Q 232 400 210 408 Z" fill="rgba(255,255,255,0.88)"/>
  <!-- Upper lip center peak highlight -->
  <ellipse cx="256" cy="398" rx="18" ry="5" fill="rgba(255,255,255,0.60)"/>
  <!-- Lower lip — fuller, rounder -->
  <path d="M 210 408 Q 256 440 302 408 L 298 416 Q 256 446 214 416 Z" fill="rgba(255,255,255,0.92)"/>
  <!-- Lip center highlight (lower lip is fullest at center) -->
  <ellipse cx="256" cy="426" rx="26" ry="8" fill="rgba(255,255,255,0.55)"/>
  <!-- Lip line separation (subtle shadow) -->
  <path d="M 212 408 Q 256 414 300 408" stroke="rgba(0,0,0,0.35)" stroke-width="2" fill="none"/>

  <!-- ══ CHEEKBONE HIGHLIGHTS ══ -->
  <ellipse cx="155" cy="334" rx="58" ry="26" fill="rgba(255,255,255,0.16)" transform="rotate(-18,155,334)"/>
  <ellipse cx="357" cy="334" rx="58" ry="26" fill="rgba(255,255,255,0.16)" transform="rotate(18,357,334)"/>

  <!-- ══ CHIN DEFINITION ══ -->
  <ellipse cx="256" cy="500" rx="62" ry="18" fill="rgba(255,255,255,0.28)"/>

  <!-- ══ AMBIENT SPARKLE WISPS (loose particles around the silhouette) ══ -->
  <circle cx="38"  cy="280" r="4" fill="rgba(255,255,255,0.18)"/>
  <circle cx="28"  cy="350" r="3" fill="rgba(255,255,255,0.14)"/>
  <circle cx="474" cy="300" r="4" fill="rgba(255,255,255,0.18)"/>
  <circle cx="484" cy="380" r="3" fill="rgba(255,255,255,0.14)"/>
  <circle cx="170" cy="44"  r="5" fill="rgba(255,255,255,0.22)"/>
  <circle cx="342" cy="38"  r="5" fill="rgba(255,255,255,0.22)"/>
  <circle cx="96"  cy="100" r="4" fill="rgba(255,255,255,0.20)"/>
  <circle cx="416" cy="100" r="4" fill="rgba(255,255,255,0.20)"/>
</svg>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rnd = Math.random;
const rng = (a: number, b: number) => a + rnd() * (b - a);

/** Multi-hue particle color: purple, pink, blue, white hotspots */
function particleColor(brightness: number): [number, number, number] {
  const l   = brightness * rng(0.55, 1.0);
  const hue = rnd();
  if (hue < 0.50) {
    // Purple/violet — dominant
    return [l * rng(0.28, 0.50), l * rng(0.05, 0.18), l * rng(0.85, 1.00)];
  } else if (hue < 0.75) {
    // Pink/rose
    return [l * rng(0.78, 1.00), l * rng(0.10, 0.28), l * rng(0.52, 0.80)];
  } else if (hue < 0.88) {
    // Electric blue
    return [l * rng(0.06, 0.22), l * rng(0.38, 0.68), l * rng(0.90, 1.00)];
  } else {
    // White-hot sparkle
    return [l * rng(0.82, 1.00), l * rng(0.78, 1.00), l * rng(0.88, 1.00)];
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

async function sampleFromSVG(svgString: string, count: number): Promise<FaceData> {
  return new Promise((resolve) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);

      const data = ctx.getImageData(0, 0, W, H).data;

      // Build weighted pool: each bright pixel added 1–4 times based on brightness
      // This biases sampling toward brighter (more important) features
      type Pixel = { px: number; py: number; b: number };
      const pool: Pixel[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const b = (data[i] + data[i+1] + data[i+2]) / (3 * 255);
        if (b < 0.06) continue; // skip near-black pixels
        const px = (i / 4) % W;
        const py = Math.floor((i / 4) / W);
        const weight = Math.ceil(b * 4); // 1-4 based on brightness
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

        // Add sub-pixel jitter so particles don't stack on a grid
        const jx = rng(-0.8, 0.8);
        const jy = rng(-0.8, 0.8);

        const x = ((px + jx) / W - 0.5) * 3.0;
        const y = -(((py + jy) / H) - 0.5) * 4.0;
        const z = rng(-0.08, 0.18);

        positions[i*3]   = x;
        positions[i*3+1] = y;
        positions[i*3+2] = z;

        // Normals face outward from face center (for scroll dissolution effect)
        const nx = x * 0.35, ny = y * 0.20, nz = 1.0;
        const nl = Math.sqrt(nx*nx + ny*ny + nz*nz);
        normals[i*3]   = nx/nl;
        normals[i*3+1] = ny/nl;
        normals[i*3+2] = nz/nl;

        randoms[i] = rnd();

        // Brightness drives particle intensity — but cap to prevent additive blowout
        const [r, g, gc] = particleColor(b * rng(0.12, 0.46));
        colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = gc;

        // Sizes: brighter pixels → slightly larger particles
        sizes[i]  = rng(0.04, 0.09) + b * rng(0.00, 0.06);
        delays[i] = rnd() * Math.PI * 2;
      }

      resolve({ positions, normals, randoms, colors, sizes, delays });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(makeFeminineGeometry(count));
    };

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
      && typeof URL !== 'undefined'
      && typeof URL.createObjectURL === 'function';

    if (canUseCanvas) {
      sampleFromSVG(FACE_SVG, count)
        .then(setFaceData)
        .catch(() => setFaceData(makeFeminineGeometry(count)));
    } else {
      setFaceData(makeFeminineGeometry(count));
    }
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
