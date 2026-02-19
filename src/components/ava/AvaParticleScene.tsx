import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gsap from 'gsap';

// ─── Vertex Shader ────────────────────────────────────────────────────────────
const VERTEX_SHADER = `
  attribute vec3 aVelocity;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aDelay;

  uniform float uTime;
  uniform float uScrollProgress;
  uniform vec2 uMouse;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    vColor = aColor;

    vec3 pos = position;

    float t = uScrollProgress * 1.8;
    pos += aVelocity * t * t;

    float floatAmt = 1.0 - uScrollProgress;
    pos.y += sin(uTime * 0.4 + aDelay) * 0.018 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.010 * floatAmt;

    vAlpha = clamp(1.0 - t * 0.75, 0.0, 1.0);

    vec3 lightPos = vec3(uMouse.x * 1.8, uMouse.y * 1.2 + 0.6, 2.2);
    float lightDist = distance(pos, lightPos);
    vBrightness = 1.0 + (1.0 / (1.0 + lightDist * lightDist * 0.5)) * 0.55;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    float sizeScale = max(0.15, 1.0 - uScrollProgress * 0.25);
    gl_PointSize = aSize * sizeScale * (62.0 / -mvPosition.z);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    if (dist > 0.5) discard;

    float alpha = (1.0 - smoothstep(0.38, 0.5, dist)) * vAlpha;
    float glow  = max(0.0, 1.0 - dist * 2.2);

    vec3 color = vColor * vBrightness * (0.75 + glow * 0.25);
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rng = Math.random;
const N = (min: number, max: number) => min + rng() * (max - min);

function outwardVel(x: number, y: number, z: number, speed: number) {
  const d = Math.sqrt(x * x + y * y + z * z) + 0.001;
  const sp = speed * N(0.55, 1.45);
  return {
    vx: (x / d) * sp + N(-0.65, 0.65),
    vy: (y / d) * sp * 0.5 + N(-0.55, 0.55),
    vz: (rng() < 0.5 ? 1 : -1) * sp * 1.7 + N(-0.45, 0.45),
  };
}

function purpleColor(bright: number) {
  const lum = bright * N(0.52, 1.0);
  return { r: lum * N(0.30, 0.44), g: lum * N(0.09, 0.17), b: lum * N(0.84, 0.99) };
}

// ─── Sample points uniformly on a GLTF mesh surface ──────────────────────────
function sampleMeshPoints(
  meshes: THREE.Mesh[],
  count: number,
  scale: number,
  yOffset: number,
) {
  const positions: number[] = [];
  const velocities: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const delays: number[] = [];

  // Collect all triangles with their areas
  const triangles: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; area: number }[] = [];
  let totalArea = 0;

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpAB = new THREE.Vector3();
  const tmpAC = new THREE.Vector3();

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr) continue;

    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : posAttr.count / 3;

    for (let i = 0; i < triCount; i++) {
      const ia = idx ? idx.getX(i * 3)     : i * 3;
      const ib = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
      const ic = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

      tmpA.fromBufferAttribute(posAttr, ia);
      tmpB.fromBufferAttribute(posAttr, ib);
      tmpC.fromBufferAttribute(posAttr, ic);

      tmpAB.subVectors(tmpB, tmpA);
      tmpAC.subVectors(tmpC, tmpA);
      const area = tmpAB.cross(tmpAC).length() * 0.5;

      triangles.push({ a: tmpA.clone(), b: tmpB.clone(), c: tmpC.clone(), area });
      totalArea += area;
    }
  }

  // Build CDF for weighted random triangle sampling
  const cdf = new Float64Array(triangles.length);
  let cum = 0;
  for (let i = 0; i < triangles.length; i++) {
    cum += triangles[i].area / totalArea;
    cdf[i] = cum;
  }

  // Sample random barycentric points
  const pt = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Binary search CDF
    let lo = 0, hi = triangles.length - 1;
    const r = rng();
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1; else hi = mid;
    }
    const { a, b, c } = triangles[lo];

    // Uniform barycentric sampling
    const u = rng(), v = rng();
    const su = Math.sqrt(u);
    const s = 1 - su, t = su * (1 - v), w = su * v;

    pt.set(
      a.x * s + b.x * t + c.x * w,
      a.y * s + b.y * t + c.y * w,
      a.z * s + b.z * t + c.z * w,
    );

    const x = pt.x * scale;
    const y = pt.y * scale + yOffset;
    const z = pt.z * scale;

    const { vx, vy, vz } = outwardVel(x, y, z, N(0.8, 1.6));
    const { r: cr, g: cg, b: cb } = purpleColor(N(0.35, 0.92));

    positions.push(x, y, z);
    velocities.push(vx, vy, vz);
    colors.push(cr, cg, cb);
    sizes.push(N(0.05, 0.18) * N(0.6, 1.2));
    delays.push(rng() * Math.PI * 2);
  }

  // Add shoulders + ambient (not on face mesh)
  addShoulders(count * 0.12, positions, velocities, colors, sizes, delays);
  addAmbient(count * 0.04, positions, velocities, colors, sizes, delays);

  return {
    positions: new Float32Array(positions),
    velocities: new Float32Array(velocities),
    colors: new Float32Array(colors),
    sizes: new Float32Array(sizes),
    delays: new Float32Array(delays),
    count: positions.length / 3,
  };
}

function addShoulders(
  n: number,
  pos: number[], vel: number[], col: number[], siz: number[], del: number[],
) {
  for (let i = 0; i < n; i++) {
    const x    = N(-1.85, 1.85);
    const absX = Math.abs(x);
    const y    = -1.06 - absX * 0.085 + N(-0.24, 0.24);
    const z    = N(-0.35, 0.35) - 0.10;
    pos.push(x, y, z);
    vel.push(x * 0.36 + N(-1.3, 1.3), -(1.15 + rng() * 1.55), N(-1.4, 1.4));
    const { r, g, b } = purpleColor(N(0.20, 0.50));
    col.push(r, g, b);
    siz.push(N(0.05, 0.13) * N(0.6, 1.2));
    del.push(rng() * Math.PI * 2);
  }
}

function addAmbient(
  n: number,
  pos: number[], vel: number[], col: number[], siz: number[], del: number[],
) {
  for (let i = 0; i < n; i++) {
    const x = N(-3.8, 3.8), y = N(-3.0, 3.2), z = -(1.0 + rng() * 2.5);
    const d = Math.sqrt(x * x + y * y) + 0.01;
    pos.push(x, y, z);
    vel.push((x / d) * N(0.7, 1.5), (y / d) * N(0.7, 1.5), N(-1.0, 1.0));
    const { r, g, b } = purpleColor(N(0.14, 0.28));
    col.push(r, g, b);
    siz.push(N(0.04, 0.10) * N(0.6, 1.2));
    del.push(rng() * Math.PI * 2);
  }
}

// ─── Feminine Procedural Fallback ─────────────────────────────────────────────
// Used when no GLB model is provided. Tuned for feminine proportions:
// narrower jaw, higher cheekbones, fuller lips, tapered chin, elegant neck.
function generateFeminineGeometry(count: number) {
  const pos: number[] = [], vel: number[] = [], col: number[] = [];
  const siz: number[] = [], del: number[] = [];

  const addP = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    bright: number, size: number,
  ) => {
    pos.push(x + N(-0.010, 0.010), y + N(-0.010, 0.010), z + N(-0.006, 0.006));
    vel.push(vx, vy, vz);
    const { r, g, b } = purpleColor(bright);
    col.push(r, g, b);
    siz.push(size * N(0.55, 1.20));
    del.push(rng() * Math.PI * 2);
  };

  const addS = (x: number, y: number, z: number, speed: number, bright: number, size: number) => {
    const { vx, vy, vz } = outwardVel(x, y, z, speed);
    addP(x, y, z, vx, vy, vz, bright, size);
  };

  // ── Feminine face constants
  // Oval face: wider at cheeks, tapers to narrow chin (heart/oval shape)
  const Rx = 0.66, Ry = 1.02, Rz = 0.68, yOff = 0.36;

  // Eye socket exclusion zones — keep these dark so they read as eyes
  const EYE_L = { cx: -0.248, cy: 0.218, rx: 0.158, ry: 0.102 };
  const EYE_R = { cx:  0.248, cy: 0.218, rx: 0.158, ry: 0.102 };
  const inEye = (x: number, y: number) =>
    ((x - EYE_L.cx) / EYE_L.rx) ** 2 + ((y - EYE_L.cy) / EYE_L.ry) ** 2 < 1 ||
    ((x - EYE_R.cx) / EYE_R.rx) ** 2 + ((y - EYE_R.cy) / EYE_R.ry) ** 2 < 1;

  // ── 1. HEAD SURFACE (front-biased ellipsoid, eye sockets masked)
  const headN = Math.floor(count * 0.26);
  for (let i = 0; i < headN; i++) {
    const theta = rng() * Math.PI * 2;
    const phi   = Math.acos(1 - 2 * rng());
    const sinP  = Math.sin(phi), cosP = Math.cos(phi);
    const rawZ  = sinP * Math.sin(theta);
    if (rawZ < -0.05 && rng() > 0.20) continue;

    const r = 1.0 + (rng() < 0.75 ? 0 : N(-0.05, 0.05));
    const x = r * Rx * sinP * Math.cos(theta);
    const y = r * Ry * cosP + yOff;
    const z = r * Rz * sinP * Math.sin(theta);

    if (z > 0.52 && inEye(x, y)) continue;

    // Narrow the jaw region — feminine faces taper below the cheekbones
    const isJaw = y < -0.10 && y > -0.65;
    if (isJaw) {
      // Scale x inward to make jaw narrower: at y=-0.10 full width, at y=-0.62 only 50%
      const taper = 1.0 - ((-y - 0.10) / 0.52) * 0.48;
      if (Math.abs(x) > Rx * taper * 0.92 && rng() > 0.15) continue;
    }

    const front = (rawZ + 1) * 0.5;
    addS(x, y, z, N(0.75, 1.5), 0.28 + front * 0.55, N(0.05, 0.16));
  }

  // ── 2. ORBITAL RIMS (feminine: larger-looking eyes, thinner rim)
  const eyeN = Math.floor(count * 0.072);
  const eyeDefs = [EYE_L, EYE_R];
  for (const { cx, cy } of eyeDefs) {
    const perEye  = eyeN / 2;
    const rimN    = Math.floor(perEye * 0.75);
    const innerN  = Math.floor(perEye * 0.25);

    for (let i = 0; i < rimN; i++) {
      const angle = rng() * Math.PI * 2;
      const fade  = rng() < 0.72 ? 1.0 : N(0.50, 0.95);
      // Feminine: slightly larger eye, more horizontal (wider rw)
      const rw = 0.148, rh = 0.095;
      const x = cx + rw * Math.cos(angle) * fade + N(-0.008, 0.008);
      const y = cy + rh * Math.sin(angle) * fade + N(-0.006, 0.006);
      const z = 0.698 - 0.018 * Math.abs(Math.cos(angle)) + N(-0.007, 0.007);
      // Upper lash line brighter (top half of rim)
      const isUpper = Math.sin(angle) > 0;
      addS(x, y, z, N(0.9, 1.7), isUpper ? N(0.65, 1.0) : N(0.50, 0.85), N(0.06, 0.18));
    }

    // Sparse inner socket — dark, recessed (eye depth illusion)
    for (let i = 0; i < innerN; i++) {
      const angle = rng() * Math.PI * 2;
      const r     = rng() * 0.090;
      const x     = cx + r * Math.cos(angle) * 1.45;
      const y     = cy + r * Math.sin(angle) * 0.88;
      const z     = 0.668 + N(-0.008, 0.008);
      addS(x, y, z, N(0.6, 1.1), N(0.18, 0.38), N(0.03, 0.09));
    }
  }

  // ── 3. EYEBROWS — feminine: higher arch, thinner, more lateral
  const browN = Math.floor(count * 0.030);
  for (const bxBase of [-0.255, 0.255]) {
    for (let i = 0; i < browN / 2; i++) {
      const t    = N(-1, 1);
      const absT = Math.abs(t);
      // Higher arch peak (feminine brow: peaks toward outer 1/3)
      const arch = 0.028 * Math.max(0, 1.0 - Math.pow((absT - 0.55) / 0.45, 2));
      const x    = bxBase + t * 0.168 + N(-0.014, 0.014);
      const y    = 0.348 + arch + N(-0.012, 0.012);
      const z    = 0.702 + N(-0.010, 0.010);
      addS(x, y, z, N(0.8, 1.5), N(0.48, 0.85), N(0.05, 0.15));
    }
  }

  // ── 4. NOSE — delicate, narrow
  const noseTotal = Math.floor(count * 0.052);

  // Bridge: very narrow, straight
  for (let i = 0; i < Math.floor(noseTotal * 0.38); i++) {
    const t = rng();
    addS(N(-0.020, 0.020), 0.210 - t * 0.365, 0.744 + t * 0.072 + N(-0.007, 0.007), N(0.9, 1.6), N(0.50, 0.88), N(0.05, 0.14));
  }
  // Tip: small, refined
  for (let i = 0; i < Math.floor(noseTotal * 0.22); i++) {
    const angle = rng() * Math.PI * 2;
    const r     = rng() * 0.052;
    addS(r * Math.cos(angle), -0.152 + r * Math.sin(angle) * 0.65 + N(-0.007, 0.007), 0.818 - r * 0.38, N(0.8, 1.5), N(0.48, 0.84), N(0.04, 0.13));
  }
  // Nostrils: delicate C-arcs
  for (let side = 0; side < 2; side++) {
    const nx = (side === 0 ? -1 : 1) * 0.094;
    for (let i = 0; i < Math.floor(noseTotal * 0.40) / 2; i++) {
      const angle = -0.10 + rng() * Math.PI * 1.15;
      const r     = N(0.026, 0.042);
      addS(nx + r * Math.cos(angle), -0.232 + r * Math.sin(angle) * 0.65, 0.776 - r * 0.26 + N(-0.007, 0.007), N(0.7, 1.4), N(0.42, 0.80), N(0.04, 0.12));
    }
  }

  // ── 5. LIPS — full and prominent (feminine feature)
  const lipTotal = Math.floor(count * 0.065); // more than before

  // Upper lip — pronounced Cupid's bow
  for (let i = 0; i < Math.floor(lipTotal * 0.40); i++) {
    const t   = N(-1, 1);
    const bow = 0.026 * Math.max(0, 1.0 - Math.pow(Math.abs(Math.abs(t) - 0.42) / 0.58, 2)) - 0.008;
    const x   = t * 0.178 + N(-0.012, 0.012);
    const y   = -0.300 + bow + N(-0.014, 0.014);
    const z   = 0.755 - 0.014 * t * t + N(-0.006, 0.006);
    addS(x, y, z, N(0.85, 1.7), N(0.55, 0.95), N(0.06, 0.18));
  }
  // Lower lip — fuller, more rounded
  for (let i = 0; i < Math.floor(lipTotal * 0.60); i++) {
    const t    = N(-1, 1);
    const arch = 0.022 * (1.0 - t * t);
    const x    = t * 0.188 + N(-0.012, 0.012);
    const y    = -0.388 - arch + N(-0.016, 0.016);
    const z    = 0.752 + 0.016 * (1.0 - t * t) + N(-0.006, 0.006);
    addS(x, y, z, N(0.85, 1.7), N(0.52, 0.92), N(0.06, 0.18));
  }

  // ── 6. HIGH CHEEKBONES (feminine: prominent, high, slightly wide)
  const cheekN = Math.floor(count * 0.042);
  for (const cx of [-0.390, 0.390]) {
    for (let i = 0; i < cheekN / 2; i++) {
      const angle = N(-0.5, 1.2) * Math.PI;
      const x     = cx + 0.138 * Math.cos(angle) * N(0.3, 1.0) + N(-0.012, 0.012);
      const y     = 0.062 + 0.108 * Math.sin(angle) * N(0.3, 1.0) + N(-0.012, 0.012);
      const z     = 0.644 + N(-0.018, 0.018);
      addS(x, y, z, N(0.75, 1.45), N(0.38, 0.75), N(0.05, 0.14));
    }
  }

  // ── 7. JAWLINE — feminine: narrow, gently curved, soft
  // Jaw angle at ±0.36 (vs masculine ±0.60), gentle curve to chin
  const jawTotal = Math.floor(count * 0.042);
  for (let i = 0; i < jawTotal; i++) {
    const t    = N(-1, 1);
    const absT = Math.abs(t);
    const x    = t * 0.360 * N(0.88, 1.08);
    const y    = -0.272 - (1 - absT) * 0.338 + N(-0.018, 0.018);
    const z    = 0.420 + (1 - absT) * 0.148 + N(-0.010, 0.010);
    addS(x, y, z, N(0.7, 1.35), N(0.35, 0.70), N(0.04, 0.13));
  }

  // Chin — narrow, slightly pointed (feminine)
  const chinN = Math.floor(count * 0.015);
  for (let i = 0; i < chinN; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = rng() * 0.040; // narrower radius than masculine
    addS(r * Math.cos(angle) * 0.65, -0.608 + r * Math.sin(angle) * 0.60, 0.568 - r * 0.35, N(0.7, 1.3), N(0.38, 0.70), N(0.04, 0.12));
  }

  // ── 8. NECK — long, slender (feminine proportion)
  const neckN = Math.floor(count * 0.042);
  for (let i = 0; i < neckN; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = 0.112 + rng() * 0.058; // thinner than before
    const y     = -0.85 + rng() * 0.48;  // slightly longer
    addS(r * Math.cos(angle), y, r * Math.sin(angle) * 0.70, N(0.6, 1.3), N(0.26, 0.58), N(0.04, 0.12));
  }

  // ── 9. HAIR — long, flowing down sides (feminine silhouette)
  const hairN = Math.floor(count * 0.075);
  for (let i = 0; i < hairN; i++) {
    const side  = rng() < 0.5 ? -1 : 1;
    const isTop = rng() < 0.35;

    if (isTop) {
      // Crown / top of head
      const angle = rng() * Math.PI * 2;
      const rad   = 0.55 + rng() * 0.72;
      const x     = Math.cos(angle) * rad * N(0.45, 1.0);
      const y     = 1.20 + rng() * 1.60;
      const z     = N(-0.28, 0.30);
      pos.push(x, y, z);
      vel.push(N(-1.0, 1.0), 1.6 + rng() * 2.0, N(-0.9, 0.9));
    } else {
      // Long flowing hair — cascades past shoulders
      const t  = rng(); // 0 = crown, 1 = mid-back
      const yH = 1.05 - t * 2.80;
      const xH = side * (0.50 + t * 0.55 + N(-0.18, 0.18));
      const zH = N(-0.38, 0.18);
      pos.push(xH, yH, zH);
      vel.push(side * N(0.8, 2.0), N(-0.5, 1.2), N(-1.0, 1.0));
    }

    const { r, g, b } = purpleColor(N(0.28, 0.65));
    col.push(r, g, b);
    siz.push(N(0.04, 0.13) * N(0.55, 1.20));
    del.push(rng() * Math.PI * 2);
  }

  // ── 10. SHOULDERS
  addShoulders(count * 0.088, pos, vel, col, siz, del);

  // ── 11. AMBIENT
  addAmbient(count * 0.045, pos, vel, col, siz, del);

  return {
    positions:  new Float32Array(pos),
    velocities: new Float32Array(vel),
    colors:     new Float32Array(col),
    sizes:      new Float32Array(siz),
    delays:     new Float32Array(del),
    count:      pos.length / 3,
  };
}

// ─── Build Three.js geometry from raw arrays ──────────────────────────────────
function buildGeometry(data: ReturnType<typeof generateFeminineGeometry>) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',  new THREE.BufferAttribute(data.positions,  3));
  geo.setAttribute('aVelocity', new THREE.BufferAttribute(data.velocities, 3));
  geo.setAttribute('aColor',    new THREE.BufferAttribute(data.colors,     3));
  geo.setAttribute('aSize',     new THREE.BufferAttribute(data.sizes,      1));
  geo.setAttribute('aDelay',    new THREE.BufferAttribute(data.delays,     1));
  return geo;
}

// ─── Component ─────────────────────────────────────────────────────────────────
interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
  /** Optional path to a GLB head model in /public, e.g. "/ava-head.glb"   */
  modelUrl?: string;
}

const AvaParticleScene: React.FC<AvaParticleSceneProps> = ({
  scrollProgress,
  className,
  modelUrl,
}) => {
  const mountRef    = useRef<HTMLDivElement>(null);
  const uniformsRef = useRef<Record<string, { value: unknown }> | null>(null);
  const particleRef = useRef<THREE.Points | null>(null);
  const rafRef      = useRef<number>(0);
  const mouseRef    = useRef({ smoothX: 0, smoothY: 0 });

  const particleCount = useMemo(
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 11000 : 22000),
    [],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 5.5);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { return; }

    renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.background = 'transparent';
    mount.appendChild(renderer.domElement);

    const uniforms = {
      uTime:           { value: 0 },
      uScrollProgress: { value: 0 },
      uMouse:          { value: new THREE.Vector2(0, 0) },
    };
    uniformsRef.current = uniforms as Record<string, { value: unknown }>;

    const material = new THREE.ShaderMaterial({
      vertexShader:    VERTEX_SHADER,
      fragmentShader:  FRAGMENT_SHADER,
      uniforms,
      transparent:        true,
      depthWrite:         false,
      blending:           THREE.NormalBlending,
      premultipliedAlpha: true,
    });

    let particles: THREE.Points | null = null;
    let cancelled = false;

    const initParticles = (data: ReturnType<typeof generateFeminineGeometry>) => {
      if (cancelled) return;
      const geo  = buildGeometry(data);
      particles  = new THREE.Points(geo, material);
      scene.add(particles);
      particleRef.current = particles;
    };

    if (modelUrl) {
      // ── Load real GLB and sample points on the mesh surface
      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          const meshes: THREE.Mesh[] = [];
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
          });

          if (meshes.length === 0) {
            // Fallback if no meshes found
            initParticles(generateFeminineGeometry(particleCount));
            return;
          }

          // Auto-scale: normalise model to fit our scene
          const box    = new THREE.Box3().setFromObject(gltf.scene);
          const size   = new THREE.Vector3();
          box.getSize(size);
          const scale  = 2.0 / Math.max(size.x, size.y, size.z);
          const yOff   = -box.getCenter(new THREE.Vector3()).y * scale + 0.36;

          const data = sampleMeshPoints(meshes, particleCount, scale, yOff);
          initParticles(data);
        },
        undefined,
        () => {
          // Load error — fall through to procedural
          initParticles(generateFeminineGeometry(particleCount));
        },
      );
    } else {
      // ── Procedural feminine geometry (no model provided)
      initParticles(generateFeminineGeometry(particleCount));
    }

    // ── Mouse
    const quickX = gsap.quickTo(mouseRef.current, 'smoothX', { duration: 0.85, ease: 'power2.out' });
    const quickY = gsap.quickTo(mouseRef.current, 'smoothY', { duration: 0.85, ease: 'power2.out' });
    const onMouse = (e: MouseEvent) => {
      quickX((e.clientX / window.innerWidth)  * 2 - 1);
      quickY(-((e.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener('mousemove', onMouse);

    // ── Resize
    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // ── Animate
    const startTime = Date.now();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      uniforms.uTime.value = (Date.now() - startTime) / 1000;
      (uniforms.uMouse.value as THREE.Vector2).set(mouseRef.current.smoothX, mouseRef.current.smoothY);
      if (particles) {
        const tY = mouseRef.current.smoothX * 0.30;
        const tX = -mouseRef.current.smoothY * 0.22;
        particles.rotation.y += (tY - particles.rotation.y) * 0.055;
        particles.rotation.x += (tX - particles.rotation.x) * 0.055;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
      material.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [particleCount, modelUrl]);

  useEffect(() => {
    if (uniformsRef.current) {
      (uniformsRef.current.uScrollProgress as { value: number }).value = scrollProgress;
    }
  }, [scrollProgress]);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

export default AvaParticleScene;
