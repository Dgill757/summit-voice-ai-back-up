/**
 * AvaParticleScene — sphere-to-face morph particle system
 *
 * Technique: two position arrays (sphere + face) stored as buffer attributes.
 * The vertex shader lerps between them using a `uMorph` uniform that GSAP
 * animates 0 → 1 on mount, creating the "particles coalesce into a face"
 * reveal effect used by high-end creative studios.
 *
 * Optionally pass `modelUrl="/your-head.glb"` to sample particles from a
 * real 3-D head mesh (GLB) instead of the procedural feminine fallback.
 */

import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gsap from 'gsap';

// ─── Vertex shader ─────────────────────────────────────────────────────────────
// `position`  = sphere start positions  (attribute)
// `aFacePos`  = face  target positions  (attribute)
// `uMorph`    = GSAP-driven 0→1 blend   (uniform)
const VERT = /* glsl */`
  attribute vec3  aFacePos;
  attribute vec3  aVelocity;
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aDelay;

  uniform float uTime;
  uniform float uMorph;    // 0 = sphere, 1 = face
  uniform float uScroll;
  uniform vec2  uMouse;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    vColor = aColor;

    // ── Core morph: sphere → face
    vec3 pos = mix(position, aFacePos, uMorph);

    // ── Scroll dissolution (only once face is formed)
    float t = uScroll * 1.8 * uMorph;
    pos += aVelocity * t * t;

    // ── Subtle organic float (only at full morph, no scroll)
    float floatAmt = smoothstep(0.75, 1.0, uMorph) * (1.0 - uScroll);
    pos.y += sin(uTime * 0.40 + aDelay)        * 0.018 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.010 * floatAmt;

    // ── Alpha: fade in during morph, fade out on scroll
    float morphFade  = smoothstep(0.0, 0.45, uMorph);
    float scrollFade = clamp(1.0 - uScroll * 1.8 * 0.75, 0.0, 1.0);
    vAlpha = morphFade * scrollFade;

    // ── Mouse-driven light
    vec3  lightPos  = vec3(uMouse.x * 1.8, uMouse.y * 1.2 + 0.6, 2.2);
    float lightDist = distance(pos, lightPos);
    vBrightness = 1.0 + (1.0 / (1.0 + lightDist * lightDist * 0.5)) * 0.55;

    vec4  mvPos      = modelViewMatrix * vec4(pos, 1.0);
    float sizeScale  = max(0.15, 1.0 - uScroll * 0.25);
    gl_PointSize = aSize * sizeScale * (62.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

// ─── Fragment shader ───────────────────────────────────────────────────────────
const FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    vec2  coord = gl_PointCoord - 0.5;
    float dist  = length(coord);
    if (dist > 0.5) discard;

    float alpha = (1.0 - smoothstep(0.36, 0.5, dist)) * vAlpha;
    float glow  = max(0.0, 1.0 - dist * 2.2);

    vec3 color = vColor * vBrightness * (0.75 + glow * 0.25);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const r = Math.random;
const N = (a: number, b: number) => a + r() * (b - a);

function vel(x: number, y: number, z: number, spd: number) {
  const d  = Math.sqrt(x*x + y*y + z*z) + 0.001;
  const sp = spd * N(0.55, 1.45);
  return [
    (x/d)*sp + N(-0.65, 0.65),
    (y/d)*sp*0.5 + N(-0.55, 0.55),
    (r() < 0.5 ? 1 : -1)*sp*1.7 + N(-0.45, 0.45),
  ];
}

function purple(bright: number) {
  const l = bright * N(0.52, 1.0);
  return [l*N(0.28,0.44), l*N(0.08,0.17), l*N(0.82,0.99)];
}

// ─── Sphere positions (morph start) ───────────────────────────────────────────
function makeSphere(count: number, radius = 1.62): Float32Array {
  const a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi   = Math.acos(1 - 2*r());
    const theta = r() * Math.PI * 2;
    const rad   = radius * (0.88 + r() * 0.24);
    a[i*3]   = rad * Math.sin(phi) * Math.cos(theta);
    a[i*3+1] = rad * Math.cos(phi);
    a[i*3+2] = rad * Math.sin(phi) * Math.sin(theta);
  }
  return a;
}

// ─── Feminine face positions (morph target, procedural fallback) ────────────
function makeFeminineGeometry(count: number) {
  // Fixed per-region particle counts that always sum to exactly `count`
  const C = {
    head:     Math.floor(count * 0.27),
    eyeRims:  Math.floor(count * 0.075),
    eyeInner: Math.floor(count * 0.025),
    brows:    Math.floor(count * 0.030),
    nose:     Math.floor(count * 0.055),
    lips:     Math.floor(count * 0.070),
    cheeks:   Math.floor(count * 0.045),
    jaw:      Math.floor(count * 0.045),
    neck:     Math.floor(count * 0.040),
    hair:     Math.floor(count * 0.080),
    shoulder: Math.floor(count * 0.095),
    ambient:  Math.floor(count * 0.045),
  };
  // Assign any rounding remainder to head
  const used = Object.values(C).reduce((s, v) => s + v, 0);
  C.head += count - used;

  const pos: number[] = [], vels: number[] = [], col: number[] = [];
  const siz: number[] = [], del: number[] = [];

  const add = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    bright: number, size: number,
  ) => {
    pos.push(x, y, z); vels.push(vx, vy, vz);
    const [r2,g2,b2] = purple(bright); col.push(r2,g2,b2);
    siz.push(size * N(0.55, 1.20)); del.push(r() * Math.PI * 2);
  };

  const addS = (x:number, y:number, z:number, spd:number, bright:number, size:number) => {
    const [vx,vy,vz] = vel(x,y,z,spd);
    add(x+N(-0.009,0.009), y+N(-0.009,0.009), z+N(-0.005,0.005), vx,vy,vz, bright, size);
  };

  // ── 1. HEAD SHELL — oval, jaw tapered, eye sockets masked
  const EL = { cx:-0.248, cy:0.218, rx:0.160, ry:0.104 };
  const ER = { cx: 0.248, cy:0.218, rx:0.160, ry:0.104 };
  const inEye = (x:number,y:number) =>
    ((x-EL.cx)/EL.rx)**2 + ((y-EL.cy)/EL.ry)**2 < 1 ||
    ((x-ER.cx)/ER.rx)**2 + ((y-ER.cy)/ER.ry)**2 < 1;

  let n = 0;
  while (n < C.head) {
    const theta = r()*Math.PI*2, phi = Math.acos(1-2*r());
    const sinP = Math.sin(phi), cosP = Math.cos(phi);
    const rawZ = sinP*Math.sin(theta);
    if (rawZ < -0.05 && r() > 0.20) continue;
    const rr = 1 + (r()<0.75 ? 0 : N(-0.04,0.04));
    const x = rr*0.65*sinP*Math.cos(theta);
    const y = rr*1.02*cosP + 0.36;
    const z = rr*0.68*sinP*Math.sin(theta);
    if (z > 0.50 && inEye(x,y)) continue;
    // Taper jaw inward (feminine oval)
    if (y < -0.10 && y > -0.65) {
      const taper = 1 - ((-y-0.10)/0.52)*0.50;
      if (Math.abs(x) > 0.65*taper*0.92 && r() > 0.12) continue;
    }
    const front = (rawZ+1)*0.5;
    addS(x, y, z, N(0.75,1.5), 0.28+front*0.55, N(0.045,0.150));
    n++;
  }

  // ── 2. ORBITAL RIMS — key feature; upper half brighter (lash effect)
  const eyeDefs = [EL, ER];
  const perRim  = Math.floor(C.eyeRims / 2);
  for (const { cx, cy } of eyeDefs) {
    for (let i = 0; i < perRim; i++) {
      const angle = r()*Math.PI*2;
      const fade  = r()<0.72 ? 1.0 : N(0.50,0.95);
      const rw = 0.150, rh = 0.096;
      const x = cx + rw*Math.cos(angle)*fade + N(-0.008,0.008);
      const y = cy + rh*Math.sin(angle)*fade + N(-0.006,0.006);
      const z = 0.698 - 0.018*Math.abs(Math.cos(angle)) + N(-0.007,0.007);
      const upper = Math.sin(angle) > 0;
      addS(x, y, z, N(0.9,1.7), upper ? N(0.68,1.0) : N(0.50,0.85), N(0.06,0.19));
    }
  }

  // ── 3. EYE INNER — sparse/dark hollow depth illusion
  const perInner = Math.floor(C.eyeInner / 2);
  for (const { cx, cy } of eyeDefs) {
    for (let i = 0; i < perInner; i++) {
      const angle = r()*Math.PI*2, rr = r()*0.088;
      addS(cx+rr*Math.cos(angle)*1.45, cy+rr*Math.sin(angle)*0.88, 0.665+N(-0.008,0.008), N(0.6,1.1), N(0.16,0.36), N(0.025,0.080));
    }
  }

  // ── 4. EYEBROWS — high arch (feminine), thin
  const perBrow = Math.floor(C.brows / 2);
  for (const bx of [-0.252, 0.252]) {
    for (let i = 0; i < perBrow; i++) {
      const t = N(-1,1), aT = Math.abs(t);
      const arch = 0.030 * Math.max(0, 1 - ((aT-0.52)/0.48)**2);
      addS(bx+t*0.165+N(-0.012,0.012), 0.352+arch+N(-0.010,0.010), 0.704+N(-0.009,0.009), N(0.8,1.5), N(0.48,0.86), N(0.045,0.140));
    }
  }

  // ── 5. NOSE — delicate
  const nBridge = Math.floor(C.nose*0.38), nTip = Math.floor(C.nose*0.22), nNostril = C.nose - nBridge - nTip;
  for (let i = 0; i < nBridge; i++) {
    const t = r();
    addS(N(-0.018,0.018), 0.210-t*0.365, 0.742+t*0.072+N(-0.007,0.007), N(0.9,1.6), N(0.50,0.88), N(0.045,0.135));
  }
  for (let i = 0; i < nTip; i++) {
    const a = r()*Math.PI*2, rr = r()*0.050;
    addS(rr*Math.cos(a), -0.152+rr*Math.sin(a)*0.65+N(-0.007,0.007), 0.816-rr*0.38, N(0.8,1.5), N(0.46,0.82), N(0.038,0.120));
  }
  const perNostril = Math.floor(nNostril/2);
  for (const nx of [-0.092, 0.092]) {
    for (let i = 0; i < perNostril; i++) {
      const a = -0.10+r()*Math.PI*1.15, rr = N(0.024,0.040);
      addS(nx+rr*Math.cos(a), -0.230+rr*Math.sin(a)*0.65, 0.774-rr*0.26+N(-0.007,0.007), N(0.7,1.4), N(0.42,0.80), N(0.035,0.110));
    }
  }

  // ── 6. LIPS — full, prominent (key feminine feature)
  const nUpper = Math.floor(C.lips*0.40), nLower = C.lips - nUpper;
  for (let i = 0; i < nUpper; i++) {
    const t = N(-1,1);
    const bow = 0.028 * Math.max(0, 1-((Math.abs(t)-0.40)/0.60)**2) - 0.009;
    addS(t*0.180+N(-0.011,0.011), -0.295+bow+N(-0.013,0.013), 0.756-0.013*t*t+N(-0.006,0.006), N(0.85,1.7), N(0.58,0.96), N(0.055,0.175));
  }
  for (let i = 0; i < nLower; i++) {
    const t = N(-1,1);
    addS(t*0.190+N(-0.011,0.011), -0.382-0.023*(1-t*t)+N(-0.014,0.014), 0.752+0.017*(1-t*t)+N(-0.006,0.006), N(0.85,1.7), N(0.55,0.94), N(0.055,0.175));
  }

  // ── 7. HIGH CHEEKBONES
  const perCheek = Math.floor(C.cheeks/2);
  for (const cx of [-0.385, 0.385]) {
    for (let i = 0; i < perCheek; i++) {
      const a = N(-0.5,1.2)*Math.PI;
      addS(cx+0.135*Math.cos(a)*N(0.3,1.0)+N(-0.011,0.011), 0.065+0.105*Math.sin(a)*N(0.3,1.0)+N(-0.011,0.011), 0.642+N(-0.016,0.016), N(0.75,1.45), N(0.38,0.76), N(0.045,0.135));
    }
  }

  // ── 8. JAWLINE — narrow, feminine oval (max x ±0.355)
  for (let i = 0; i < C.jaw; i++) {
    const t = N(-1,1), aT = Math.abs(t);
    addS(t*0.355*N(0.88,1.08), -0.268-(1-aT)*0.340+N(-0.016,0.016), 0.425+(1-aT)*0.143+N(-0.009,0.009), N(0.7,1.35), N(0.33,0.68), N(0.038,0.120));
  }

  // ── 9. NECK — slender
  for (let i = 0; i < C.neck; i++) {
    const a = r()*Math.PI*2, rr = 0.108+r()*0.055;
    addS(rr*Math.cos(a), -0.84+r()*0.48, rr*Math.sin(a)*0.70, N(0.6,1.3), N(0.25,0.56), N(0.035,0.110));
  }

  // ── 10. HAIR — long flowing (feminine silhouette)
  for (let i = 0; i < C.hair; i++) {
    const side = r()<0.5 ? -1 : 1;
    let x:number, y:number, z:number, vx:number, vy:number, vz:number;
    if (r() < 0.30) {
      // Crown
      const a = r()*Math.PI*2, rad = 0.52+r()*0.74;
      x = Math.cos(a)*rad*N(0.42,1.0); y = 1.18+r()*1.65; z = N(-0.26,0.28);
      vx = N(-1.0,1.0); vy = 1.6+r()*2.0; vz = N(-0.9,0.9);
    } else {
      // Long cascade down sides
      const t = r();
      x = side*(0.48+t*0.58+N(-0.16,0.16)); y = 1.08-t*2.90; z = N(-0.36,0.16);
      vx = side*N(0.9,2.0); vy = N(-0.5,1.2); vz = N(-1.0,1.0);
    }
    const [r2,g2,b2] = purple(N(0.28,0.66));
    pos.push(x,y,z); vels.push(vx,vy,vz); col.push(r2,g2,b2);
    siz.push(N(0.032,0.118)*N(0.55,1.20)); del.push(r()*Math.PI*2);
  }

  // ── 11. SHOULDERS
  for (let i = 0; i < C.shoulder; i++) {
    const x = N(-1.85,1.85), aX = Math.abs(x);
    const y = -1.04-aX*0.085+N(-0.22,0.22);
    const z = N(-0.32,0.32)-0.10;
    const [r2,g2,b2] = purple(N(0.20,0.50));
    pos.push(x,y,z); vels.push(x*0.36+N(-1.3,1.3), -(1.15+r()*1.55), N(-1.4,1.4));
    col.push(r2,g2,b2); siz.push(N(0.040,0.118)*N(0.55,1.20)); del.push(r()*Math.PI*2);
  }

  // ── 12. AMBIENT
  for (let i = 0; i < C.ambient; i++) {
    const x = N(-3.8,3.8), y = N(-3.0,3.2), z = -(1+r()*2.5);
    const d = Math.sqrt(x*x+y*y)+0.01;
    const [r2,g2,b2] = purple(N(0.12,0.26));
    pos.push(x,y,z); vels.push((x/d)*N(0.7,1.5),(y/d)*N(0.7,1.5),N(-1,1));
    col.push(r2,g2,b2); siz.push(N(0.028,0.088)*N(0.55,1.20)); del.push(r()*Math.PI*2);
  }

  return {
    positions:  new Float32Array(pos),
    velocities: new Float32Array(vels),
    colors:     new Float32Array(col),
    sizes:      new Float32Array(siz),
    delays:     new Float32Array(del),
  };
}

// ─── Sample points from a GLTF mesh (area-weighted barycentric) ───────────────
function sampleGLTFMesh(
  meshes: THREE.Mesh[], count: number, scale: number, yOff: number,
) {
  const tris: [THREE.Vector3,THREE.Vector3,THREE.Vector3][] = [];
  const areas: number[] = [];
  let total = 0;
  const A=new THREE.Vector3(), B=new THREE.Vector3(), C=new THREE.Vector3();
  const AB=new THREE.Vector3(), AC=new THREE.Vector3();

  for (const m of meshes) {
    const g = m.geometry, p = g.getAttribute('position') as THREE.BufferAttribute;
    if (!p) continue;
    const idx = g.index, tc = idx ? idx.count/3 : p.count/3;
    for (let i = 0; i < tc; i++) {
      const ia = idx?idx.getX(i*3):i*3, ib = idx?idx.getX(i*3+1):i*3+1, ic = idx?idx.getX(i*3+2):i*3+2;
      A.fromBufferAttribute(p,ia); B.fromBufferAttribute(p,ib); C.fromBufferAttribute(p,ic);
      AB.subVectors(B,A); AC.subVectors(C,A);
      const area = AB.cross(AC).length()*0.5;
      tris.push([A.clone(),B.clone(),C.clone()]); areas.push(area); total+=area;
    }
  }
  const cdf = new Float64Array(tris.length);
  let cum=0; for(let i=0;i<tris.length;i++){cum+=areas[i]/total;cdf[i]=cum;}

  const positions:number[]=[], velocities:number[]=[], colors:number[]=[], sizes:number[]=[], delays:number[]=[];
  const pt = new THREE.Vector3();
  for (let i=0;i<count;i++) {
    let lo=0, hi=tris.length-1; const rv=r();
    while(lo<hi){const m=(lo+hi)>>1; cdf[m]<rv?lo=m+1:hi=m;}
    const [a,b,c]=tris[lo];
    const u=r(),v=r(),su=Math.sqrt(u),s=1-su,t=su*(1-v),w=su*v;
    pt.set(a.x*s+b.x*t+c.x*w, a.y*s+b.y*t+c.y*w, a.z*s+b.z*t+c.z*w);
    const x=pt.x*scale, y=pt.y*scale+yOff, z=pt.z*scale;
    const [vx,vy,vz]=vel(x,y,z,N(0.8,1.6));
    const [r2,g2,b2]=purple(N(0.35,0.92));
    positions.push(x,y,z); velocities.push(vx,vy,vz); colors.push(r2,g2,b2);
    sizes.push(N(0.045,0.165)*N(0.55,1.20)); delays.push(r()*Math.PI*2);
  }
  return { positions:new Float32Array(positions), velocities:new Float32Array(velocities), colors:new Float32Array(colors), sizes:new Float32Array(sizes), delays:new Float32Array(delays) };
}

// ─── Inner R3F component (uses hooks) ─────────────────────────────────────────
interface ParticlesProps {
  scrollProgress: number;
  faceData: {
    positions: Float32Array; velocities: Float32Array;
    colors: Float32Array;    sizes: Float32Array; delays: Float32Array;
  };
}

function AvaParticles({ scrollProgress, faceData }: ParticlesProps) {
  const pointsRef  = useRef<THREE.Points>(null!);
  const matRef     = useRef<THREE.ShaderMaterial>(null!);
  const mouseRef   = useRef({ x:0, y:0, sx:0, sy:0 });

  const count = faceData.positions.length / 3;

  // Sphere start positions (same count as face)
  const spherePos = useMemo(() => makeSphere(count), [count]);

  // Stable uniforms object (never recreated)
  const uniforms = useMemo(() => ({
    uTime:   { value: 0 },
    uMorph:  { value: 0 },
    uScroll: { value: 0 },
    uMouse:  { value: new THREE.Vector2(0,0) },
  }), []);

  // Trigger morph-in on mount
  useEffect(() => {
    gsap.to(uniforms.uMorph, {
      value: 1, duration: 2.8, delay: 0.35, ease: 'power3.inOut',
    });
  }, [uniforms]);

  // Mouse tracking
  useEffect(() => {
    const h = (e: MouseEvent) => {
      mouseRef.current.x =  (e.clientX/window.innerWidth )*2-1;
      mouseRef.current.y = -((e.clientY/window.innerHeight)*2-1);
    };
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);

  // Sync scroll
  useEffect(() => {
    uniforms.uScroll.value = scrollProgress;
  }, [scrollProgress, uniforms]);

  // Animation loop
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const m = mouseRef.current;
    m.sx += (m.x - m.sx)*0.058; m.sy += (m.y - m.sy)*0.058;
    uniforms.uMouse.value.set(m.sx, m.sy);
    if (pointsRef.current) {
      const p = pointsRef.current;
      p.rotation.y += (m.sx*0.30 - p.rotation.y)*0.055;
      p.rotation.x += (-m.sy*0.22 - p.rotation.x)*0.055;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        {/* position = sphere (morph start) */}
        <bufferAttribute attach="attributes-position" array={spherePos}            count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aFacePos"  array={faceData.positions}  count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aVelocity" array={faceData.velocities} count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aColor"    array={faceData.colors}     count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aSize"     array={faceData.sizes}      count={count} itemSize={1} />
        <bufferAttribute attach="attributes-aDelay"    array={faceData.delays}     count={count} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
        premultipliedAlpha
      />
    </points>
  );
}

// ─── Outer component — Canvas wrapper ────────────────────────────────────────
interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
  /**
   * Optional: path to a GLB head model in /public, e.g. "/ava-head.glb"
   * When provided, particles are sampled from the real mesh surface.
   * Without it the feminine procedural fallback is used.
   */
  modelUrl?: string;
}

export default function AvaParticleScene({ scrollProgress, className, modelUrl }: AvaParticleSceneProps) {
  const count = typeof window !== 'undefined' && window.innerWidth < 768 ? 10000 : 22000;
  const [faceData, setFaceData] = useState<ParticlesProps['faceData'] | null>(null);

  useEffect(() => {
    if (modelUrl) {
      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          const meshes: THREE.Mesh[] = [];
          gltf.scene.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
          if (!meshes.length) { setFaceData(makeFeminineGeometry(count)); return; }
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const sz  = new THREE.Vector3(); box.getSize(sz);
          const sc  = 2.0/Math.max(sz.x,sz.y,sz.z);
          const yO  = -box.getCenter(new THREE.Vector3()).y*sc+0.36;
          setFaceData(sampleGLTFMesh(meshes, count, sc, yO));
        },
        undefined,
        () => setFaceData(makeFeminineGeometry(count)),
      );
    } else {
      setFaceData(makeFeminineGeometry(count));
    }
  }, [count, modelUrl]);

  if (!faceData) return <div className={className} style={{ width:'100%', height:'100%' }} />;

  return (
    <div className={className} style={{ width:'100%', height:'100%' }}>
      <Canvas
        camera={{ position: [0,0,5.5], fov: 52, near: 0.1, far: 100 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
        dpr={[1, 2]}
      >
        <AvaParticles scrollProgress={scrollProgress} faceData={faceData} />
      </Canvas>
    </div>
  );
}
