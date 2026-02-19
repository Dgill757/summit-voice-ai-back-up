/**
 * AvaParticleScene — Premium Three.js particle face effect
 *
 * Full technique stack:
 *  1. MeshSurfaceSampler  — uniform surface sampling with real normals from any GLB
 *  2. Sphere → face morph — GSAP-driven uMorph 0→1 entrance reveal
 *  3. Normal-based dissolution — particles scatter along surface normals on scroll
 *  4. AdditiveBlending    — particles ADD their color → natural glow
 *  5. uPixelRatio          — correct point sizing on Retina / HiDPI screens
 *  6. Mouse parallax       — face rotates toward cursor ("Ava looks at you")
 */

import React, { useRef, useMemo, useEffect, useState, Component, ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
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
    pos.y += sin(uTime * 0.40 + aDelay)        * 0.018 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.010 * floatAmt;

    // 4. Alpha: fade in during morph, wave-out during dissolution
    float morphFade    = smoothstep(0.0, 0.42, uMorph);
    float dissolveFade = 1.0 - scatter;
    vAlpha = morphFade * dissolveFade;

    // 5. Mouse-driven specular hotspot
    vec3  lightPos  = vec3(uMouse.x * 1.8, uMouse.y * 1.2 + 0.6, 2.2);
    float lightDist = distance(pos, lightPos);
    vBrightness = 1.0 + (1.0 / (1.0 + lightDist * lightDist * 0.45)) * 0.80;

    // 6. Projection — 350.0 constant gives ~8-20px particles at camera distance 5.2
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rnd = Math.random;
const rng = (a: number, b: number) => a + rnd() * (b - a);

/** Multi-hue particle color: purple, pink, blue, and white hotspots */
function particleColor(brightness: number): [number, number, number] {
  const l   = brightness * rng(0.60, 1.0);
  const hue = rnd();
  if (hue < 0.50) {
    // Purple/violet — dominant
    return [l * rng(0.30, 0.50), l * rng(0.06, 0.18), l * rng(0.85, 1.00)];
  } else if (hue < 0.75) {
    // Pink/rose
    return [l * rng(0.78, 1.00), l * rng(0.12, 0.30), l * rng(0.55, 0.80)];
  } else if (hue < 0.88) {
    // Electric blue
    return [l * rng(0.08, 0.25), l * rng(0.40, 0.70), l * rng(0.90, 1.00)];
  } else {
    // White-hot sparkle
    return [l * rng(0.82, 1.00), l * rng(0.78, 1.00), l * rng(0.88, 1.00)];
  }
}

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

// ─── GLB sampler ──────────────────────────────────────────────────────────────

function sampleWithMeshSurfaceSampler(
  meshes: THREE.Mesh[],
  count: number,
  scale: number,
  yOffset: number,
): FaceData {
  const primary = meshes.reduce((best, m) => {
    const pa = best.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pb = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    return (pb?.count ?? 0) > (pa?.count ?? 0) ? m : best;
  }, meshes[0]);

  primary.geometry.computeVertexNormals();
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
    const [r, g, b] = particleColor(rng(0.40, 1.0));
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
    sizes[i]  = rng(0.10, 0.36) * rng(0.65, 1.20);
    delays[i] = rnd() * Math.PI * 2;
  }

  return { positions, normals, randoms, colors, sizes, delays };
}

// ─── Procedural fallback: feminine face + hair geometry ───────────────────────

function makeFeminineGeometry(count: number): FaceData {
  const C = {
    head:     Math.floor(count * 0.24),
    eyeRims:  Math.floor(count * 0.075),
    eyeInner: Math.floor(count * 0.025),
    brows:    Math.floor(count * 0.030),
    nose:     Math.floor(count * 0.055),
    lips:     Math.floor(count * 0.075),
    cheeks:   Math.floor(count * 0.060),
    jaw:      Math.floor(count * 0.045),
    neck:     Math.floor(count * 0.040),
    hair:     Math.floor(count * 0.110),
    shoulder: Math.floor(count * 0.085),
    ambient:  Math.floor(count * 0.055),
  };
  const used = Object.values(C).reduce((s, v) => s + v, 0);
  C.head += count - used;

  const pos: number[] = [], nrm: number[] = [], rng2: number[] = [];
  const col: number[] = [], sz: number[] = [], del: number[] = [];

  function push(x: number, y: number, z: number, bright: number, size: number) {
    pos.push(x, y, z);
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    rng2.push(rnd());
    const [r, g, b] = particleColor(bright);
    col.push(r, g, b);
    sz.push(size * rng(0.65, 1.25));
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

  // ── HEAD SHELL
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
    if (z > 0.48 && inEye(x, y)) continue;
    if (y < -0.10 && y > -0.68) {
      const t = 1 - ((-y - 0.10) / 0.54) * 0.52;
      if (Math.abs(x) > 0.66 * t * 0.92 && rnd() > 0.12) continue;
    }
    const front = (rawZ + 1) * 0.5;
    add(x, y, z, 0.30 + front * 0.60, rng(0.10, 0.28));
    n++;
  }

  // ── ORBITAL RIMS (bright eye edges)
  const eyeDefs = [EL, ER];
  const perRim  = Math.floor(C.eyeRims / 2);
  for (const { cx, cy } of eyeDefs) {
    for (let i = 0; i < perRim; i++) {
      const a    = rnd() * Math.PI * 2;
      const fade = rnd() < 0.72 ? 1.0 : rng(0.50, 0.95);
      const x = cx + 0.152 * Math.cos(a) * fade + rng(-0.008, 0.008);
      const y = cy + 0.098 * Math.sin(a) * fade + rng(-0.006, 0.006);
      const z = 0.700 - 0.018 * Math.abs(Math.cos(a)) + rng(-0.007, 0.007);
      add(x, y, z, Math.sin(a) > 0 ? rng(0.72, 1.0) : rng(0.55, 0.88), rng(0.12, 0.32));
    }
  }

  // ── EYE INNER
  const perInner = Math.floor(C.eyeInner / 2);
  for (const { cx, cy } of eyeDefs) {
    for (let i = 0; i < perInner; i++) {
      const a  = rnd() * Math.PI * 2;
      const rr = rnd() * 0.090;
      add(cx + rr * Math.cos(a) * 1.45, cy + rr * Math.sin(a) * 0.88,
          0.668 + rng(-0.008, 0.008), rng(0.18, 0.42), rng(0.06, 0.14));
    }
  }

  // ── EYEBROWS
  const perBrow = Math.floor(C.brows / 2);
  for (const bx of [-0.252, 0.252]) {
    for (let i = 0; i < perBrow; i++) {
      const t  = rng(-1, 1);
      const at = Math.abs(t);
      const arch = 0.030 * Math.max(0, 1 - ((at - 0.52) / 0.48) ** 2);
      add(bx + t * 0.168 + rng(-0.012, 0.012), 0.355 + arch + rng(-0.010, 0.010),
          0.706 + rng(-0.009, 0.009), rng(0.55, 0.95), rng(0.08, 0.22));
    }
  }

  // ── NOSE
  const nBridge  = Math.floor(C.nose * 0.38);
  const nTip     = Math.floor(C.nose * 0.22);
  const nNostril = C.nose - nBridge - nTip;
  for (let i = 0; i < nBridge; i++) {
    const t = rnd();
    add(rng(-0.018, 0.018), 0.210 - t * 0.365, 0.744 + t * 0.072, rng(0.52, 0.90), rng(0.08, 0.22));
  }
  for (let i = 0; i < nTip; i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * 0.052;
    add(rr * Math.cos(a), -0.150 + rr * Math.sin(a) * 0.65, 0.818 - rr * 0.38, rng(0.50, 0.88), rng(0.07, 0.20));
  }
  const perN = Math.floor(nNostril / 2);
  for (const nx of [-0.094, 0.094]) {
    for (let i = 0; i < perN; i++) {
      const a  = -0.10 + rnd() * Math.PI * 1.15;
      const rr = rng(0.024, 0.040);
      add(nx + rr * Math.cos(a), -0.228 + rr * Math.sin(a) * 0.65,
          0.776 - rr * 0.26, rng(0.45, 0.82), rng(0.06, 0.18));
    }
  }

  // ── LIPS (bright, full)
  const nUpper = Math.floor(C.lips * 0.40);
  const nLower = C.lips - nUpper;
  for (let i = 0; i < nUpper; i++) {
    const t = rng(-1, 1);
    const bow = 0.028 * Math.max(0, 1 - ((Math.abs(t) - 0.40) / 0.60) ** 2) - 0.009;
    add(t * 0.182 + rng(-0.011, 0.011), -0.292 + bow + rng(-0.013, 0.013),
        0.758 - 0.013 * t * t, rng(0.65, 1.0), rng(0.10, 0.28));
  }
  for (let i = 0; i < nLower; i++) {
    const t = rng(-1, 1);
    add(t * 0.192 + rng(-0.011, 0.011),
        -0.380 - 0.024 * (1 - t*t) + rng(-0.014, 0.014),
        0.754 + 0.018 * (1 - t*t), rng(0.62, 1.0), rng(0.10, 0.28));
  }

  // ── HIGH CHEEKBONES
  const perCheek = Math.floor(C.cheeks / 2);
  for (const cx of [-0.388, 0.388]) {
    for (let i = 0; i < perCheek; i++) {
      const a = rng(-0.5, 1.2) * Math.PI;
      add(cx + 0.136 * Math.cos(a) * rng(0.3, 1.0) + rng(-0.011, 0.011),
          0.068 + 0.108 * Math.sin(a) * rng(0.3, 1.0) + rng(-0.011, 0.011),
          0.644 + rng(-0.016, 0.016), rng(0.45, 0.85), rng(0.08, 0.22));
    }
  }

  // ── JAWLINE
  for (let i = 0; i < C.jaw; i++) {
    const t  = rng(-1, 1);
    const at = Math.abs(t);
    add(t * 0.358 * rng(0.88, 1.08),
        -0.270 - (1 - at) * 0.342 + rng(-0.016, 0.016),
        0.426 + (1 - at) * 0.145 + rng(-0.009, 0.009),
        rng(0.38, 0.75), rng(0.07, 0.18));
  }

  // ── NECK
  for (let i = 0; i < C.neck; i++) {
    const a  = rnd() * Math.PI * 2;
    const rr = 0.110 + rnd() * 0.055;
    add(rr * Math.cos(a), -0.84 + rnd() * 0.48, rr * Math.sin(a) * 0.70,
        rng(0.28, 0.62), rng(0.06, 0.16));
  }

  // ── HAIR — long, flowing, full volume (crown + cascades + wisps)
  for (let i = 0; i < C.hair; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    let x: number, y: number, z: number;
    const r = rnd();
    if (r < 0.25) {
      // Crown volume — thick top
      const a = rnd() * Math.PI * 2, rad = rng(0.48, 1.30);
      x = Math.cos(a) * rad * rng(0.40, 1.0);
      y = 1.15 + rnd() * 1.80;
      z = rng(-0.30, 0.32);
    } else if (r < 0.65) {
      // Long cascade down sides
      const t = rnd();
      x = side * (0.50 + t * 0.65 + rng(-0.18, 0.18));
      y = 1.05 - t * 3.10;
      z = rng(-0.40, 0.22);
    } else if (r < 0.85) {
      // Face-framing front strands
      const t = rnd();
      x = side * rng(0.28, 0.60);
      y = 1.10 - t * 1.60;
      z = rng(0.20, 0.55);
    } else {
      // Wispy flyaways
      const a = rnd() * Math.PI * 2;
      x = Math.cos(a) * rng(0.60, 1.60);
      y = rng(0.40, 2.80);
      z = rng(-0.60, 0.20);
    }
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    const bright = rng(0.32, 0.78);
    const [rc, gc, bc] = particleColor(bright);
    pos.push(x, y, z); rng2.push(rnd()); col.push(rc, gc, bc);
    sz.push(rng(0.06, 0.20) * rng(0.65, 1.25)); del.push(rnd() * Math.PI * 2);
  }

  // ── SHOULDERS
  for (let i = 0; i < C.shoulder; i++) {
    const x  = rng(-1.88, 1.88);
    const ax = Math.abs(x);
    const y  = -1.06 - ax * 0.085 + rng(-0.22, 0.22);
    const z  = rng(-0.32, 0.32) - 0.10;
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    const [rc, gc, bc] = particleColor(rng(0.22, 0.56));
    pos.push(x, y, z); rng2.push(rnd()); col.push(rc, gc, bc);
    sz.push(rng(0.07, 0.18) * rng(0.65, 1.25)); del.push(rnd() * Math.PI * 2);
  }

  // ── AMBIENT — floating particles around the figure
  for (let i = 0; i < C.ambient; i++) {
    const x = rng(-3.8, 3.8), y = rng(-3.0, 3.2), z = -(1 + rnd() * 2.5);
    const [nx, ny, nz] = faceNormal(x, y, z);
    nrm.push(nx, ny, nz);
    const [rc, gc, bc] = particleColor(rng(0.14, 0.32));
    pos.push(x, y, z); rng2.push(rnd()); col.push(rc, gc, bc);
    sz.push(rng(0.05, 0.14) * rng(0.65, 1.25)); del.push(rnd() * Math.PI * 2);
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
      p.rotation.y += (m.sx * 0.30 - p.rotation.y) * 0.055;
      p.rotation.x += (-m.sy * 0.22 - p.rotation.x) * 0.055;
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
  modelUrl?: string;
}

export default function AvaParticleScene({
  scrollProgress,
  className,
  modelUrl,
}: AvaParticleSceneProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const count    = isMobile ? 10000 : 30000;

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
            const box  = new THREE.Box3().setFromObject(gltf.scene);
            const size = new THREE.Vector3();
            box.getSize(size);
            const sc   = 2.0 / Math.max(size.x, size.y, size.z);
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
          camera={{ position: [0, 0.36, 5.2], fov: 56, near: 0.1, far: 100 }}
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
