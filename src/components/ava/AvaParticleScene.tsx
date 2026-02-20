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

  // Clone geometry and bake the world matrix into it so sampled positions
  // are in world space (not the mesh's local space which may be offset/rotated)
  const worldGeo = primary.geometry.clone();
  worldGeo.applyMatrix4(primary.matrixWorld);
  worldGeo.computeVertexNormals();
  const tmpMesh = new THREE.Mesh(worldGeo);
  const sampler = new MeshSurfaceSampler(tmpMesh).build();

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

// ─── Procedural fallback: 2D outline-based feminine face ──────────────────────
//
// Strategy: trace CONTOURS of facial features (oval ring, eye circles, lip
// curves, brow arcs) instead of filling a 3D head volume.  Contour-based faces
// are instantly readable at any size and avoid the "white blob" caused by
// thousands of overlapping additive particles at the nose centre.
//
// Coordinate space (before the 1.6× group scale applied in JSX):
//   x: –0.65 … +0.65   (face width ~1.3 units)
//   y: –1.15 … +2.95   (chin to top of hair)
//   z: –0.15 … +0.15   (very shallow — camera-facing plane)

function makeFeminineGeometry(count: number): FaceData {
  const C = {
    headRing:  Math.floor(count * 0.090), // face oval outline ring
    eyeLeft:   Math.floor(count * 0.065), // left eye circle (bright)
    eyeRight:  Math.floor(count * 0.065), // right eye circle (bright)
    iris:      Math.floor(count * 0.025), // iris fill dots
    brows:     Math.floor(count * 0.048), // eyebrow arcs
    nose:      Math.floor(count * 0.038), // nose bridge + tip + nostrils
    lipsUp:    Math.floor(count * 0.055), // upper lip Cupid's bow
    lipsLow:   Math.floor(count * 0.060), // lower lip (fuller)
    cheeks:    Math.floor(count * 0.038), // cheekbone highlight arcs
    jaw:       Math.floor(count * 0.040), // jawline curve
    neck:      Math.floor(count * 0.028), // neck column
    hair:      Math.floor(count * 0.255), // hair (dominant — crown + cascades)
    shoulder:  Math.floor(count * 0.065), // shoulders
    fill:      Math.floor(count * 0.055), // dim sparse face interior
    ambient:   Math.floor(count * 0.040), // floating atmosphere
  };
  const used = Object.values(C).reduce((s, v) => s + v, 0);
  C.hair += count - used; // assign rounding remainder to hair

  const pos: number[] = [], nrm: number[] = [], rng2: number[] = [];
  const col: number[] = [], sz: number[] = [], del: number[] = [];

  // ch: 0=purple  1=pink/rose  2=electric-blue  3=white-hot
  function push(x: number, y: number, z: number,
                bright: number, size: number, ch = 0) {
    const l = bright * rng(0.62, 1.0);
    let r: number, g: number, b: number;
    if      (ch === 1) { r = l*rng(0.78,1.00); g = l*rng(0.10,0.28); b = l*rng(0.52,0.78); }
    else if (ch === 2) { r = l*rng(0.06,0.22); g = l*rng(0.38,0.68); b = l*rng(0.90,1.00); }
    else if (ch === 3) { r = l*rng(0.85,1.00); g = l*rng(0.80,1.00); b = l*rng(0.88,1.00); }
    else               { r = l*rng(0.28,0.48); g = l*rng(0.05,0.16); b = l*rng(0.85,1.00); }
    pos.push(x + rng(-0.005,0.005), y + rng(-0.005,0.005), z + rng(-0.004,0.004));
    nrm.push(0, 0, 1);           // all normals face camera
    rng2.push(rnd());
    col.push(r, g, b);
    sz.push(size * rng(0.72, 1.28));
    del.push(rnd() * Math.PI * 2);
  }

  function autoColor(): number {
    const h = rnd();
    return h < 0.50 ? 0 : h < 0.75 ? 1 : h < 0.88 ? 2 : 3;
  }

  // ── HEAD OVAL RING — face silhouette contour (NOT filled)
  // Oval: rx=0.62 temples, taller forehead (sa>0) than chin (sa<0)
  for (let i = 0; i < C.headRing; i++) {
    const a  = rnd() * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rx = 0.62 + rng(-0.018, 0.018);
    const ry = sa > 0 ? 0.88 + rng(-0.018, 0.018) : 0.70 + rng(-0.018, 0.018);
    push(rx * ca, ry * sa + 0.16, rng(-0.02, 0.02),
         rng(0.42, 0.78), rng(0.07, 0.17));
  }

  // ── EYE RINGS — bright elliptical halos, upper half brighter (lash effect)
  const eyeCentres = [{ ex: -0.245, ey: 0.245 }, { ex: 0.245, ey: 0.245 }];
  const eyeCounts  = [C.eyeLeft, C.eyeRight];
  for (let ei = 0; ei < 2; ei++) {
    const { ex, ey } = eyeCentres[ei];
    for (let i = 0; i < eyeCounts[ei]; i++) {
      const a      = rnd() * Math.PI * 2;
      const spread = rng(0.88, 1.12);
      const x      = ex + 0.158 * spread * Math.cos(a);
      const y      = ey + 0.100 * spread * Math.sin(a);
      const bright = Math.sin(a) > 0 ? rng(0.80, 1.00) : rng(0.52, 0.78);
      const ch     = rnd() < 0.40 ? 2 : rnd() < 0.50 ? 3 : 0; // blue / white / purple
      push(x, y, 0.08, bright, rng(0.11, 0.26), ch);
    }
  }

  // ── IRIS — soft blue glow inside each eye
  for (const { ex, ey } of eyeCentres) {
    const n = Math.floor(C.iris / 2);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 0.070;
      push(ex + r * Math.cos(a) * 1.45, ey + r * Math.sin(a) * 0.90,
           0.06, rng(0.22, 0.52), rng(0.05, 0.13), 2);
    }
  }

  // ── EYEBROWS — high feminine arch
  for (const ex of [-0.245, 0.245]) {
    const n = Math.floor(C.brows / 2);
    for (let i = 0; i < n; i++) {
      const t    = rng(-1, 1);
      const arch = 0.026 * (1 - Math.abs(t));
      push(ex + t * 0.158, 0.378 + arch, 0.09,
           rng(0.58, 0.94), rng(0.06, 0.17));
    }
  }

  // ── NOSE — delicate bridge, tip, nostrils
  for (let i = 0; i < C.nose; i++) {
    const q = rnd();
    if (q < 0.42) {
      // Bridge line
      push(rng(-0.013, 0.013), 0.155 - rnd() * 0.245, 0.10,
           rng(0.48, 0.82), rng(0.05, 0.13));
    } else if (q < 0.68) {
      // Tip
      const a = rnd() * Math.PI * 2;
      push(rnd() * 0.032 * Math.cos(a), -0.108 + rnd() * 0.026 * Math.sin(a),
           0.13, rng(0.52, 0.86), rng(0.05, 0.13));
    } else {
      // Nostrils
      const s = rnd() < 0.5 ? -1 : 1;
      push(s * (0.064 + rnd() * 0.024), -0.148 + rng(-0.012, 0.012),
           0.11, rng(0.42, 0.78), rng(0.04, 0.11));
    }
  }

  // ── UPPER LIP — Cupid's bow (pink)
  for (let i = 0; i < C.lipsUp; i++) {
    const t   = rng(-1, 1);
    const bow = 0.022 * Math.max(0, 1 - ((Math.abs(t) - 0.35) / 0.65) ** 2) - 0.005;
    push(t * 0.178, -0.278 + bow, 0.11, rng(0.72, 1.00), rng(0.09, 0.23), 1);
  }

  // ── LOWER LIP — fuller curve (pink)
  for (let i = 0; i < C.lipsLow; i++) {
    const t = rng(-1, 1);
    push(t * 0.188, -0.358 - 0.022 * (1 - t * t), 0.11,
         rng(0.70, 1.00), rng(0.09, 0.23), 1);
  }

  // ── CHEEKBONES — soft arc highlight on each side
  for (const cx of [-0.355, 0.355]) {
    const n = Math.floor(C.cheeks / 2);
    for (let i = 0; i < n; i++) {
      push(cx + rng(-0.105, 0.105), 0.052 + rng(-0.072, 0.072), rng(0.03, 0.09),
           rng(0.28, 0.60), rng(0.05, 0.15));
    }
  }

  // ── JAWLINE — lower parabolic arc
  for (let i = 0; i < C.jaw; i++) {
    const t  = rng(-1, 1);
    const at = Math.abs(t);
    push(t * 0.47 * (0.82 + at * 0.18), -0.50 - (1 - at * at) * 0.22, rng(0, 0.05),
         rng(0.30, 0.62), rng(0.06, 0.15));
  }

  // ── NECK — slender column
  for (let i = 0; i < C.neck; i++) {
    push(rng(-0.112, 0.112), -0.72 - rnd() * 0.40, rng(-0.01, 0.05),
         rng(0.20, 0.50), rng(0.04, 0.13));
  }

  // ── HAIR — large volumetric area: crown + long cascades + face-framing + wisps
  for (let i = 0; i < C.hair; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    let x: number, y: number, z: number, bright: number, size: number;
    const q = rnd();
    if (q < 0.22) {
      // Crown — thick top above forehead
      const a = rnd() * Math.PI * 2, rad = rng(0.22, 1.18);
      x = Math.cos(a) * rad * rng(0.42, 1.0);
      y = 0.98 + rnd() * 1.90;
      z = rng(-0.08, 0.10);
      bright = rng(0.32, 0.72); size = rng(0.06, 0.19);
    } else if (q < 0.60) {
      // Long cascades down both sides
      const t = rnd();
      x = side * (0.50 + t * 0.62 + rng(-0.14, 0.14));
      y = 0.94 - t * 2.85;
      z = rng(-0.10, 0.05);
      bright = rng(0.24, 0.62); size = rng(0.05, 0.17);
    } else if (q < 0.80) {
      // Face-framing front strands
      const t = rnd();
      x = side * rng(0.24, 0.58);
      y = 0.90 - t * 1.50;
      z = rng(0.04, 0.15);
      bright = rng(0.28, 0.65); size = rng(0.05, 0.15);
    } else {
      // Wispy flyaways
      const a = rnd() * Math.PI * 2;
      x = Math.cos(a) * rng(0.55, 1.52);
      y = rng(0.32, 2.72);
      z = rng(-0.18, 0.07);
      bright = rng(0.14, 0.42); size = rng(0.03, 0.12);
    }
    const ch = rnd() < 0.55 ? 0 : rnd() < 0.55 ? 1 : 2; // purple / pink / blue
    push(x, y, z, bright, size, ch);
  }

  // ── SHOULDERS — wide base grounding the portrait
  for (let i = 0; i < C.shoulder; i++) {
    const x  = rng(-1.80, 1.80);
    const ax = Math.abs(x);
    push(x, -1.04 - ax * 0.068 + rng(-0.17, 0.17), rng(-0.06, 0.06),
         rng(0.16, 0.46), rng(0.05, 0.15));
  }

  // ── FACE FILL — dim sparse interior (adds atmosphere without clouding features)
  let filled = 0, guard = 0;
  while (filled < C.fill && guard < C.fill * 20) {
    guard++;
    const x = rng(-0.56, 0.56), y = rng(-0.64, 0.94);
    // Must be inside face oval
    if ((x / 0.62) ** 2 + ((y - 0.16) / 0.84) ** 2 > 0.88) continue;
    // Skip eye zones (let eye rings pop through)
    if (((x + 0.245) / 0.18) ** 2 + ((y - 0.245) / 0.12) ** 2 < 1.0) continue;
    if (((x - 0.245) / 0.18) ** 2 + ((y - 0.245) / 0.12) ** 2 < 1.0) continue;
    push(x, y, rng(-0.01, 0.03), rng(0.06, 0.18), rng(0.03, 0.09));
    filled++;
  }

  // ── AMBIENT — dim floating atmosphere around the figure
  for (let i = 0; i < C.ambient; i++) {
    push(rng(-2.4, 2.4), rng(-1.8, 2.7), rng(-1.4, -0.2),
         rng(0.06, 0.18), rng(0.03, 0.09), autoColor());
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
    <points ref={pointsRef} frustumCulled={false} scale={[1.6, 1.6, 1.6]}>
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
            // Force all scene-graph matrices to be computed — without this,
            // matrixWorld on each mesh may be identity regardless of transforms
            gltf.scene.updateMatrixWorld(true);

            const meshes: THREE.Mesh[] = [];
            gltf.scene.traverse(c => {
              if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
            });
            if (!meshes.length) {
              setFaceData(makeFeminineGeometry(count));
              return;
            }

            // Bounding box from the scene in world space (correct reference)
            const box  = new THREE.Box3().setFromObject(gltf.scene);
            const size = new THREE.Vector3();
            box.getSize(size);
            const sc   = 2.0 / Math.max(size.x, size.y, size.z);
            const yOff = -box.getCenter(new THREE.Vector3()).y * sc + 0.36;
            setFaceData(sampleWithMeshSurfaceSampler(meshes, count, sc, yOff));
          } catch (err) {
            console.error('[Ava] GLB sampling error:', err);
            setFaceData(makeFeminineGeometry(count));
          }
        },
        undefined,
        (err) => {
          console.error('[Ava] GLB load error:', err);
          setFaceData(makeFeminineGeometry(count));
        },
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
          camera={{ position: [-0.3, 0.6, 3.6], fov: 60, near: 0.1, far: 100 }}
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
