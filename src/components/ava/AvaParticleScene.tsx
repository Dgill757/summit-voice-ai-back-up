/**
 * AvaParticleScene — Premium Three.js particle face effect
 *
 * Full technique stack from the article:
 *  1. MeshSurfaceSampler  — uniform surface sampling with real normals from any GLB
 *  2. Sphere → face morph — GSAP-driven uMorph 0→1 entrance reveal
 *  3. Normal-based dissolution — particles scatter along surface normals on scroll,
 *     staggered via per-particle aRandom so they dissolve in organic waves
 *  4. AdditiveBlending    — particles ADD their color to the buffer → natural glow
 *  5. Bloom post-processing — @react-three/postprocessing for the purple aura
 *  6. uPixelRatio          — correct point sizing on Retina / HiDPI screens
 *  7. Mouse parallax       — face rotates toward cursor ("Ava looks at you")
 */

import React, { useRef, useMemo, useEffect, useState, Component, ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import gsap from 'gsap';

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT = /* glsl */`
  // Custom face attributes
  attribute vec3  aFacePos;   // face target position (morph end)
  attribute vec3  aNormal;    // surface normal → dissolution direction
  attribute float aRandom;    // [0,1] per-particle random → dissolve threshold
  attribute float aSize;      // per-particle size
  attribute vec3  aColor;     // purple/lavender color
  attribute float aDelay;     // phase offset for organic float

  // Uniforms
  uniform float uTime;
  uniform float uMorph;        // GSAP: 0=sphere, 1=face
  uniform float uScroll;       // scroll progress: 0=visible, 1=dissolved
  uniform vec2  uMouse;        // smoothed mouse (NDC -1..1)
  uniform float uPixelRatio;   // capped device pixel ratio

  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;
  varying float vRandom;

  void main() {
    vColor  = aColor;
    vRandom = aRandom;

    // ── 1. Sphere → face morph (entrance animation driven by GSAP)
    vec3 pos = mix(position, aFacePos, uMorph);

    // ── 2. Staggered normal-based dissolution (scroll-driven)
    //    Each particle's dissolve threshold = aRandom → they dissolve in waves
    //    Multiplication by uMorph prevents dissolving before face has formed
    float scatter = smoothstep(aRandom - 0.12, aRandom + 0.02, uScroll * uMorph);
    pos += aNormal * scatter * 2.6;             // push along surface normal
    pos.y += scatter * (aRandom - 0.5) * 1.8;  // subtle random vertical drift

    // ── 3. Organic float (only when fully morphed in, fades on scroll)
    float floatAmt = smoothstep(0.78, 1.0, uMorph) * (1.0 - uScroll);
    pos.y += sin(uTime * 0.40 + aDelay)        * 0.018 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.010 * floatAmt;

    // ── 4. Alpha: fade in during morph reveal, wave-out during dissolution
    float morphFade    = smoothstep(0.0, 0.42, uMorph);
    float dissolveFade = 1.0 - scatter;
    vAlpha = morphFade * dissolveFade;

    // ── 5. Mouse-driven specular hotspot (gives the face dimensionality)
    vec3  lightPos  = vec3(uMouse.x * 1.8, uMouse.y * 1.2 + 0.6, 2.2);
    float lightDist = distance(pos, lightPos);
    vBrightness = 1.0 + (1.0 / (1.0 + lightDist * lightDist * 0.45)) * 0.65;

    // ── 6. Projection — uPixelRatio keeps point size correct on Retina
    vec4  mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (55.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const FRAG = /* glsl */`
  // AdditiveBlending: gl_FragColor.rgb * gl_FragColor.a is ADDED to destination
  // → overlapping bright particles naturally create luminous hotspots on cheeks/eyes

  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;
  varying float vRandom;

  void main() {
    vec2  coord = gl_PointCoord - 0.5;
    float dist  = length(coord);
    if (dist > 0.5) discard;

    // Crisp core + soft outer halo (two-layer glow)
    float core    = pow(max(0.0, 1.0 - dist * 2.6), 2.0);
    float halo    = exp(-dist * 5.5) * 0.32;
    float strength = core + halo;

    vec3 color = vColor * vBrightness;

    // AdditiveBlending formula: result = src.rgb * src.a + dst.rgb
    // So: color * strength gets added to the buffer → genuine glow
    gl_FragColor = vec4(color * strength * vAlpha, strength * vAlpha);
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rnd = Math.random;
const rng = (a: number, b: number) => a + rnd() * (b - a);

/** Purple/lavender particle color with brightness variation */
function purpleColor(brightness: number): [number, number, number] {
  const l = brightness * rng(0.55, 1.0);
  return [l * rng(0.28, 0.44), l * rng(0.08, 0.18), l * rng(0.82, 0.99)];
}

/**
 * Outward-from-face-center normal, biased toward +Z for front-facing geometry.
 * During dissolution, front particles fly toward the camera (cinematic) while
 * side particles fly sideways (organic).
 */
function faceNormal(x: number, y: number, z: number): [number, number, number] {
  const cx = 0, cy = 0.36, cz = 0;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const dl = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.001;
  const fwdBias = Math.max(0, z) * 0.65;
  const nx = dx / dl, ny = dy / dl, nz = dz / dl + fwdBias;
  const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) + 0.001;
  return [nx / nl, ny / nl, nz / nl];
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

// ─── GLB path: MeshSurfaceSampler (article's recommended approach) ────────────

function sampleWithMeshSurfaceSampler(
  meshes: THREE.Mesh[],
  count: number,
  scale: number,
  yOffset: number,
): FaceData {
  // Find the mesh with the most surface area (usually the face/head)
  const primary = meshes.reduce((best, m) => {
    const pa = best.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pb = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    return (pb?.count ?? 0) > (pa?.count ?? 0) ? m : best;
  }, meshes[0]);

  // Ensure normals exist
  primary.geometry.computeVertexNormals();

  // MeshSurfaceSampler: area-weighted uniform sampling + surface normals
  const sampler = new MeshSurfaceSampler(primary).build();

  const positions = new Float32Array(count * 3);
  const normals   = new Float32Array(count * 3);
  const randoms   = new Float32Array(count);
  const colors    = new Float32Array(count * 3);
  const sizes     = new Float32Array(count);
  const delays    = new Float32Array(count);

  const tmpPos = new THREE.Vector3();
  const tmpNrm = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    sampler.sample(tmpPos, tmpNrm);

    positions[i*3]   = tmpPos.x * scale;
    positions[i*3+1] = tmpPos.y * scale + yOffset;
    positions[i*3+2] = tmpPos.z * scale;

    normals[i*3]   = tmpNrm.x;
    normals[i*3+1] = tmpNrm.y;
    normals[i*3+2] = tmpNrm.z;

    randoms[i] = rnd();
    const [r, g, b] = purpleColor(rng(0.38, 0.96));
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
    sizes[i]  = rng(0.045, 0.170) * rng(0.55, 1.20);
    delays[i] = rnd() * Math.PI * 2;
  }

  return { positions, normals, randoms, colors, sizes, delays };
}

// ─── Procedural fallback: feminine face geometry ───────────────────────────────

function makeFeminineGeometry(count: number): FaceData {
  // Fixed per-region counts that always sum exactly to `count`
  const C = {
    head:     Math.floor(count * 0.26),
    eyeRims:  Math.floor(count * 0.075),
    eyeInner: Math.floor(count * 0.025),
    brows:    Math.floor(count * 0.030),
    nose:     Math.floor(count * 0.055),
    lips:     Math.floor(count * 0.070),
    cheeks:   Math.floor(count * 0.050),
    jaw:      Math.floor(count * 0.045),
    neck:     Math.floor(count * 0.040),
    hair:     Math.floor(count * 0.080),
    shoulder: Math.floor(count * 0.095),
    ambient:  Math.floor(count * 0.045),
  };
  // Assign rounding remainder to head
  const used = Object.values(C).reduce((s, v) => s + v, 0);
  C.head += count - used;

  const pos: number[] = [], nrm: number[] = [], rng2: number[] = [];
  const col: number[] = [], sz: number[] = [], del: number[] = [];

  function push(x: number, y: number, z: number, bright: number, size: number) {
    pos.push(x, y, z);
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    rng2.push(rnd());
    const [r, g, b] = purpleColor(bright);
    col.push(r, g, b);
    sz.push(size * rng(0.55, 1.20));
    del.push(rnd() * Math.PI * 2);
  }

  function add(x: number, y: number, z: number, bright: number, size: number) {
    push(
      x + rng(-0.009, 0.009),
      y + rng(-0.009, 0.009),
      z + rng(-0.005, 0.005),
      bright, size,
    );
  }

  // ── HEAD SHELL — oval ellipsoid, jaw narrowed, eye sockets masked
  const EL = { cx: -0.248, cy: 0.218, rx: 0.165, ry: 0.108 };
  const ER = { cx:  0.248, cy: 0.218, rx: 0.165, ry: 0.108 };
  const inEye = (x: number, y: number) =>
    ((x-EL.cx)/EL.rx)**2 + ((y-EL.cy)/EL.ry)**2 < 1.0 ||
    ((x-ER.cx)/ER.rx)**2 + ((y-ER.cy)/ER.ry)**2 < 1.0;

  let n = 0;
  while (n < C.head) {
    const theta = rnd() * Math.PI * 2;
    const phi   = Math.acos(1 - 2 * rnd());
    const sinP  = Math.sin(phi), cosP = Math.cos(phi);
    const rawZ  = sinP * Math.sin(theta);
    if (rawZ < -0.05 && rnd() > 0.20) continue;
    const rr = 1 + (rnd() < 0.75 ? 0 : rng(-0.04, 0.04));
    const x = rr * 0.66 * sinP * Math.cos(theta);
    const y = rr * 1.03 * cosP + 0.36;
    const z = rr * 0.69 * sinP * Math.sin(theta);
    // Mask eye sockets (front-facing)
    if (z > 0.48 && inEye(x, y)) continue;
    // Taper jaw (feminine narrow oval — max x ±0.60 at jaw)
    if (y < -0.10 && y > -0.68) {
      const t = 1 - ((-y - 0.10) / 0.54) * 0.52;
      if (Math.abs(x) > 0.66 * t * 0.92 && rnd() > 0.12) continue;
    }
    const front = (rawZ + 1) * 0.5;
    add(x, y, z, 0.28 + front * 0.55, rng(0.045, 0.150));
    n++;
  }

  // ── ORBITAL RIMS — eye definition, upper half brighter (lash simulation)
  const eyeDefs = [EL, ER];
  const perRim  = Math.floor(C.eyeRims / 2);
  for (const { cx, cy } of eyeDefs) {
    for (let i = 0; i < perRim; i++) {
      const a    = rnd() * Math.PI * 2;
      const fade = rnd() < 0.72 ? 1.0 : rng(0.50, 0.95);
      const x = cx + 0.152 * Math.cos(a) * fade + rng(-0.008, 0.008);
      const y = cy + 0.098 * Math.sin(a) * fade + rng(-0.006, 0.006);
      const z = 0.700 - 0.018 * Math.abs(Math.cos(a)) + rng(-0.007, 0.007);
      add(x, y, z, Math.sin(a) > 0 ? rng(0.68, 1.0) : rng(0.50, 0.85), rng(0.06, 0.20));
    }
  }

  // ── EYE INNER — dark hollow (depth illusion)
  const perInner = Math.floor(C.eyeInner / 2);
  for (const { cx, cy } of eyeDefs) {
    for (let i = 0; i < perInner; i++) {
      const a  = rnd() * Math.PI * 2;
      const rr = rnd() * 0.090;
      add(cx + rr * Math.cos(a) * 1.45, cy + rr * Math.sin(a) * 0.88,
          0.668 + rng(-0.008, 0.008), rng(0.16, 0.36), rng(0.025, 0.080));
    }
  }

  // ── EYEBROWS — high feminine arch, thin
  const perBrow = Math.floor(C.brows / 2);
  for (const bx of [-0.252, 0.252]) {
    for (let i = 0; i < perBrow; i++) {
      const t  = rng(-1, 1);
      const at = Math.abs(t);
      const arch = 0.030 * Math.max(0, 1 - ((at - 0.52) / 0.48) ** 2);
      add(bx + t * 0.168 + rng(-0.012, 0.012), 0.355 + arch + rng(-0.010, 0.010),
          0.706 + rng(-0.009, 0.009), rng(0.48, 0.88), rng(0.045, 0.140));
    }
  }

  // ── NOSE — delicate bridge, tip, nostrils
  const nBridge  = Math.floor(C.nose * 0.38);
  const nTip     = Math.floor(C.nose * 0.22);
  const nNostril = C.nose - nBridge - nTip;
  for (let i = 0; i < nBridge; i++) {
    const t = rnd();
    add(rng(-0.018, 0.018), 0.210 - t * 0.365, 0.744 + t * 0.072, rng(0.50, 0.88), rng(0.045, 0.135));
  }
  for (let i = 0; i < nTip; i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * 0.052;
    add(rr * Math.cos(a), -0.150 + rr * Math.sin(a) * 0.65, 0.818 - rr * 0.38, rng(0.46, 0.84), rng(0.038, 0.122));
  }
  const perN = Math.floor(nNostril / 2);
  for (const nx of [-0.094, 0.094]) {
    for (let i = 0; i < perN; i++) {
      const a  = -0.10 + rnd() * Math.PI * 1.15;
      const rr = rng(0.024, 0.040);
      add(nx + rr * Math.cos(a), -0.228 + rr * Math.sin(a) * 0.65,
          0.776 - rr * 0.26, rng(0.42, 0.80), rng(0.035, 0.112));
    }
  }

  // ── LIPS — full upper + lower (key feminine feature), Cupid's bow
  const nUpper = Math.floor(C.lips * 0.40);
  const nLower = C.lips - nUpper;
  for (let i = 0; i < nUpper; i++) {
    const t = rng(-1, 1);
    const bow = 0.028 * Math.max(0, 1 - ((Math.abs(t) - 0.40) / 0.60) ** 2) - 0.009;
    add(t * 0.182 + rng(-0.011, 0.011), -0.292 + bow + rng(-0.013, 0.013),
        0.758 - 0.013 * t * t, rng(0.58, 0.98), rng(0.055, 0.178));
  }
  for (let i = 0; i < nLower; i++) {
    const t = rng(-1, 1);
    add(t * 0.192 + rng(-0.011, 0.011),
        -0.380 - 0.024 * (1 - t*t) + rng(-0.014, 0.014),
        0.754 + 0.018 * (1 - t*t), rng(0.55, 0.96), rng(0.055, 0.178));
  }

  // ── HIGH CHEEKBONES — prominent (defines facial structure)
  const perCheek = Math.floor(C.cheeks / 2);
  for (const cx of [-0.388, 0.388]) {
    for (let i = 0; i < perCheek; i++) {
      const a = rng(-0.5, 1.2) * Math.PI;
      add(cx + 0.136 * Math.cos(a) * rng(0.3, 1.0) + rng(-0.011, 0.011),
          0.068 + 0.108 * Math.sin(a) * rng(0.3, 1.0) + rng(-0.011, 0.011),
          0.644 + rng(-0.016, 0.016), rng(0.40, 0.78), rng(0.045, 0.136));
    }
  }

  // ── JAWLINE — narrow oval
  for (let i = 0; i < C.jaw; i++) {
    const t  = rng(-1, 1);
    const at = Math.abs(t);
    add(t * 0.358 * rng(0.88, 1.08),
        -0.270 - (1 - at) * 0.342 + rng(-0.016, 0.016),
        0.426 + (1 - at) * 0.145 + rng(-0.009, 0.009),
        rng(0.34, 0.70), rng(0.038, 0.122));
  }

  // ── NECK — slender cylindrical
  for (let i = 0; i < C.neck; i++) {
    const a  = rnd() * Math.PI * 2;
    const rr = 0.110 + rnd() * 0.055;
    add(rr * Math.cos(a), -0.84 + rnd() * 0.48, rr * Math.sin(a) * 0.70,
        rng(0.26, 0.58), rng(0.035, 0.112));
  }

  // ── HAIR — long, flowing, feminine silhouette
  for (let i = 0; i < C.hair; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    let x: number, y: number, z: number;
    if (rnd() < 0.28) {
      // Crown volume
      const a = rnd() * Math.PI * 2, rad = rng(0.52, 1.26);
      x = Math.cos(a) * rad * rng(0.42, 1.0);
      y = 1.18 + rnd() * 1.65;
      z = rng(-0.26, 0.28);
    } else {
      // Long cascade down sides
      const t = rnd();
      x = side * (0.48 + t * 0.60 + rng(-0.16, 0.16));
      y = 1.08 - t * 2.95;
      z = rng(-0.36, 0.18);
    }
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    const [r, g, b] = purpleColor(rng(0.28, 0.68));
    pos.push(x, y, z); rng2.push(rnd()); col.push(r, g, b);
    sz.push(rng(0.032, 0.120) * rng(0.55, 1.20)); del.push(rnd() * Math.PI * 2);
  }

  // ── SHOULDERS — subtle, grounds the portrait
  for (let i = 0; i < C.shoulder; i++) {
    const x  = rng(-1.88, 1.88);
    const ax = Math.abs(x);
    const y  = -1.06 - ax * 0.085 + rng(-0.22, 0.22);
    const z  = rng(-0.32, 0.32) - 0.10;
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    const [r, g, b] = purpleColor(rng(0.20, 0.52));
    pos.push(x, y, z); rng2.push(rnd()); col.push(r, g, b);
    sz.push(rng(0.040, 0.120) * rng(0.55, 1.20)); del.push(rnd() * Math.PI * 2);
  }

  // ── AMBIENT — floating particles around the figure
  for (let i = 0; i < C.ambient; i++) {
    const x = rng(-3.8, 3.8), y = rng(-3.0, 3.2), z = -(1 + rnd() * 2.5);
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    const [r, g, b] = purpleColor(rng(0.12, 0.28));
    pos.push(x, y, z); rng2.push(rnd()); col.push(r, g, b);
    sz.push(rng(0.028, 0.090) * rng(0.55, 1.20)); del.push(rnd() * Math.PI * 2);
  }

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

  // Sphere start positions for the morph-in reveal
  const spherePos = useMemo(() => makeSpherePositions(count), [count]);

  // Stable uniforms — mutated in-place each frame, never recreated
  const uniforms = useMemo(() => ({
    uTime:       { value: 0 },
    uMorph:      { value: 0 },
    uScroll:     { value: 0 },
    uMouse:      { value: new THREE.Vector2(0, 0) },
    uPixelRatio: { value: Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.5,
    ) },
  }), []);

  // ── Entrance: GSAP animates sphere → face morph
  useEffect(() => {
    gsap.to(uniforms.uMorph, {
      value: 1, duration: 2.8, delay: 0.35, ease: 'power3.inOut',
    });
  }, [uniforms]);

  // ── Scroll sync
  useEffect(() => {
    uniforms.uScroll.value = scrollProgress;
  }, [scrollProgress, uniforms]);

  // ── Mouse tracking
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      mouseRef.current.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouseRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', handle);
    return () => window.removeEventListener('mousemove', handle);
  }, []);

  // ── Animation loop
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;

    // Smooth mouse tracking
    const m = mouseRef.current;
    m.sx += (m.x - m.sx) * 0.055;
    m.sy += (m.y - m.sy) * 0.055;
    uniforms.uMouse.value.set(m.sx, m.sy);

    // "Ava looks at you" — group rotation follows mouse with lerp
    if (pointsRef.current) {
      const p = pointsRef.current;
      p.rotation.y += (m.sx * 0.30 - p.rotation.y) * 0.055;
      p.rotation.x += (-m.sy * 0.22 - p.rotation.x) * 0.055;
    }
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        {/* `position` = sphere positions (morph start — built-in ThreeJS attribute) */}
        <bufferAttribute attach="attributes-position" array={spherePos}           count={count} itemSize={3} />
        {/* Custom face attributes */}
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

// ─── Error boundary: prevents Canvas crashes from killing the page ────────────

class CanvasErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ─── Outer component: Canvas + data loading + Bloom ──────────────────────────

interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
  /**
   * Optional path to a GLB head model in /public (e.g. "/ava-face.glb").
   * When provided, MeshSurfaceSampler gives you perfectly uniform sampling
   * with real surface normals. Without it, the procedural feminine fallback runs.
   */
  modelUrl?: string;
}

export default function AvaParticleScene({
  scrollProgress,
  className,
  modelUrl,
}: AvaParticleSceneProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const count    = isMobile ? 8000 : 22000;

  const [faceData, setFaceData] = useState<FaceData | null>(null);

  useEffect(() => {
    if (modelUrl) {
      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          try {
            const meshes: THREE.Mesh[] = [];
            gltf.scene.traverse(c => {
              if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
            });

            if (!meshes.length) {
              setFaceData(makeFeminineGeometry(count));
              return;
            }

            // Scale model to fit the scene (face occupies ~2 units vertically)
            const box  = new THREE.Box3().setFromObject(gltf.scene);
            const size = new THREE.Vector3();
            box.getSize(size);
            const sc  = 2.0 / Math.max(size.x, size.y, size.z);
            const yOff = -box.getCenter(new THREE.Vector3()).y * sc + 0.36;

            setFaceData(sampleWithMeshSurfaceSampler(meshes, count, sc, yOff));
          } catch {
            setFaceData(makeFeminineGeometry(count));
          }
        },
        undefined,
        () => setFaceData(makeFeminineGeometry(count)),
      );
    } else {
      setFaceData(makeFeminineGeometry(count));
    }
  }, [count, modelUrl]);

  if (!faceData) {
    return <div className={className} style={{ width: '100%', height: '100%' }} />;
  }

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <CanvasErrorBoundary fallback={<div style={{ width: '100%', height: '100%' }} />}>
      <Canvas
        camera={{ position: [0, 0, 5.5], fov: 52, near: 0.1, far: 100 }}
        gl={{
          alpha: true,
          antialias: false,          // off = better perf; particles don't need MSAA
          powerPreference: 'high-performance',
        }}
        dpr={[1, 1.5]}              // cap at 1.5x — indistinguishable at 3x+ cost
        style={{ background: 'transparent' }}
      >
        <AdaptiveDpr pixelated />   {/* auto-lower resolution if GPU is struggling */}

        <AvaParticles scrollProgress={scrollProgress} faceData={faceData} />

        {/* Bloom — amplifies particle glow, creates ethereal purple aura */}
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.15}
            luminanceSmoothing={0.85}
            intensity={1.6}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
