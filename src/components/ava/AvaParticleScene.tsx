import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
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

    // Scroll dissolution: particles fly in pre-baked velocity direction
    float t = uScrollProgress * 1.8;
    pos += aVelocity * t * t;

    // Subtle organic float when not dissolving
    float floatAmt = 1.0 - uScrollProgress;
    pos.y += sin(uTime * 0.4 + aDelay) * 0.018 * floatAmt;
    pos.x += cos(uTime * 0.32 + aDelay + 1.57) * 0.010 * floatAmt;

    // Alpha fade as particles dissolve
    vAlpha = clamp(1.0 - t * 0.75, 0.0, 1.0);

    // Mouse-driven light simulation: brighten particles near virtual light
    vec3 lightPos = vec3(uMouse.x * 1.8, uMouse.y * 1.2 + 0.6, 2.2);
    float lightDist = distance(pos, lightPos);
    vBrightness = 1.0 + (1.0 / (1.0 + lightDist * lightDist * 0.5)) * 0.55;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    float sizeScale = max(0.15, 1.0 - uScrollProgress * 0.25);
    gl_PointSize = aSize * sizeScale * (90.0 / -mvPosition.z);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

// ─── Fragment Shader ──────────────────────────────────────────────────────────
const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    if (dist > 0.5) discard;

    // Sharp pixel-like dot with tiny soft edge
    float alpha = (1.0 - smoothstep(0.38, 0.5, dist)) * vAlpha;
    float glow  = max(0.0, 1.0 - dist * 2.2);

    vec3 color = vColor * vBrightness * (0.75 + glow * 0.25);
    color = clamp(color, 0.0, 1.0);

    // Premultiplied alpha — required for NormalBlending to composite cleanly
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// ─── Anatomical Face Geometry ─────────────────────────────────────────────────
//
// Built from explicit facial landmark regions so the particle cloud actually
// reads as a human face (orbital rims, nose ridge, lips, jawline, cheekbones).
//
function generateAvaGeometry(count: number) {
  const pos: number[] = [];
  const vel: number[] = [];
  const col: number[] = [];
  const siz: number[] = [];
  const del: number[] = [];

  const rng = Math.random;
  const N = (min: number, max: number) => min + rng() * (max - min);

  // Add a particle with explicit velocity components
  const addP = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    bright: number, size: number,
  ) => {
    pos.push(x, y, z);
    vel.push(vx, vy, vz);
    const lum = bright * N(0.52, 1.0);
    col.push(lum * N(0.30, 0.44), lum * N(0.09, 0.17), lum * N(0.84, 0.99));
    siz.push(size * N(0.45, 1.25));
    del.push(rng() * Math.PI * 2);
  };

  // Add a surface particle — velocity computed radially outward
  const addS = (
    x: number, y: number, z: number,
    speed: number, bright: number, size: number,
  ) => {
    const d = Math.sqrt(x * x + y * y + z * z) + 0.001;
    const sp = speed * N(0.55, 1.50);
    addP(
      x + N(-0.013, 0.013), y + N(-0.013, 0.013), z + N(-0.007, 0.007),
      (x / d) * sp + N(-0.65, 0.65),
      (y / d) * sp * 0.50 + N(-0.55, 0.55),
      (rng() < 0.5 ? 1 : -1) * sp * 1.7 + N(-0.45, 0.45),
      bright, size,
    );
  };

  // ── 1. HEAD SHELL ───────────────────────────────────────────────────────────
  // Ellipsoid base: Rx=0.75, Ry=1.02, Rz=0.70, yOffset=0.36
  // Front-biased sampling — back of head gets far fewer particles
  const headN = Math.floor(count * 0.30);
  for (let i = 0; i < headN; i++) {
    const theta = rng() * Math.PI * 2;
    const phi   = Math.acos(1 - 2 * rng());
    const sinP  = Math.sin(phi);
    const cosP  = Math.cos(phi);
    const rawZ  = sinP * Math.sin(theta); // +1 = pure front, -1 = pure back

    // Reject ~78 % of back-hemisphere particles
    if (rawZ < -0.05 && rng() > 0.22) continue;

    const dr = rng() < 0.72 ? 0 : N(-0.06, 0.06);
    const r  = 1.0 + dr;

    const x = r * 0.75 * sinP * Math.cos(theta);
    const y = r * 1.02 * cosP + 0.36;
    const z = r * 0.70 * sinP * Math.sin(theta);

    const front   = (rawZ + 1) * 0.5;
    const bright  = 0.28 + front * 0.55;
    addS(x, y, z, N(0.75, 1.55), bright, N(0.18, 0.60));
  }

  // ── 2. ORBITAL RIMS — the single most important feature ────────────────────
  // A clearly defined elliptical ring at each eye socket instantly reads as "face".
  // Dense on the orbital rim, sparse inside (hollow socket = dark depth).
  const eyeN = Math.floor(count * 0.065); // ~3.25 % per eye
  const eyes = [
    { ex: -0.278, ey: 0.218, ez: 0.698 },
    { ex:  0.278, ey: 0.218, ez: 0.698 },
  ];

  for (const { ex, ey, ez } of eyes) {
    const perEye = eyeN / 2;

    // Orbital rim — tight ellipse, high density
    const rimN = Math.floor(perEye * 0.72);
    for (let i = 0; i < rimN; i++) {
      const angle = rng() * Math.PI * 2;
      const fade  = rng() < 0.68 ? 1.0 : N(0.45, 0.95); // mostly on rim

      const rw = 0.148; // horizontal semi-axis
      const rh = 0.093; // vertical semi-axis

      const x = ex + rw * Math.cos(angle) * fade + N(-0.010, 0.010);
      const y = ey + rh * Math.sin(angle) * fade + N(-0.007, 0.007);
      // Socket recesses toward sides
      const z = ez - 0.020 * Math.abs(Math.cos(angle)) + N(-0.008, 0.008);

      addS(x, y, z, N(0.9, 1.7), N(0.55, 0.95), N(0.22, 0.65));
    }

    // Inner socket — sparse, slightly recessed (dark hollow effect)
    const innerN = Math.floor(perEye * 0.28);
    for (let i = 0; i < innerN; i++) {
      const angle = rng() * Math.PI * 2;
      const r     = rng() * 0.105;
      const x     = ex + r * Math.cos(angle) * 1.45;
      const y     = ey + r * Math.sin(angle) * 0.88;
      const z     = ez - 0.030 + N(-0.008, 0.008);

      addS(x, y, z, N(0.7, 1.3), N(0.28, 0.52), N(0.14, 0.40));
    }
  }

  // ── 3. EYEBROW RIDGES ──────────────────────────────────────────────────────
  const browN = Math.floor(count * 0.032);
  const brows = [{ bx: -0.268 }, { bx: 0.268 }];

  for (const { bx } of brows) {
    const perBrow = browN / 2;
    for (let i = 0; i < perBrow; i++) {
      const t      = N(-1, 1);
      const absT   = Math.abs(t);
      // Arch shape: peaks at ±0.35 of brow center
      const arch   = 0.032 * (1.0 - Math.pow(Math.abs(absT - 0.38) / 0.62, 2));
      const x      = bx + t * 0.175 + N(-0.018, 0.018);
      const y      = 0.332 + arch + N(-0.015, 0.015);
      const z      = 0.705 + N(-0.012, 0.012);

      addS(x, y, z, N(0.8, 1.5), N(0.45, 0.82), N(0.18, 0.55));
    }
  }

  // ── 4. NOSE ────────────────────────────────────────────────────────────────
  const noseTotal = Math.floor(count * 0.058);

  // Bridge: vertical ridge from brow to tip, protrudes forward
  const bridgeN = Math.floor(noseTotal * 0.38);
  for (let i = 0; i < bridgeN; i++) {
    const t  = rng(); // 0 = top of bridge, 1 = tip
    const y  = 0.215 - t * 0.378;
    const x  = N(-0.028, 0.028);
    const z  = 0.742 + t * 0.075 + N(-0.008, 0.008);
    addS(x, y, z, N(0.9, 1.6), N(0.50, 0.88), N(0.18, 0.52));
  }

  // Tip: small rounded protrusion
  const tipN = Math.floor(noseTotal * 0.22);
  for (let i = 0; i < tipN; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = rng() * 0.065;
    const x     = r * Math.cos(angle);
    const y     = -0.148 + r * Math.sin(angle) * 0.68 + N(-0.008, 0.008);
    const z     = 0.820 - r * 0.42;
    addS(x, y, z, N(0.8, 1.5), N(0.48, 0.84), N(0.16, 0.50));
  }

  // Nostril arcs: two C-shaped loops below the tip
  const nostrilN = Math.floor(noseTotal * 0.40);
  for (let side = 0; side < 2; side++) {
    const nx = (side === 0 ? -1 : 1) * 0.108;
    const perNostril = nostrilN / 2;
    for (let i = 0; i < perNostril; i++) {
      const angle = -0.10 + rng() * Math.PI * 1.20; // C-arc
      const r     = N(0.033, 0.052);
      const x     = nx + r * Math.cos(angle);
      const y     = -0.238 + r * Math.sin(angle) * 0.68;
      const z     = 0.780 - r * 0.28 + N(-0.008, 0.008);
      addS(x, y, z, N(0.7, 1.4), N(0.42, 0.80), N(0.15, 0.46));
    }
  }

  // ── 5. LIPS ────────────────────────────────────────────────────────────────
  const lipTotal = Math.floor(count * 0.042);

  // Upper lip — Cupid's bow (subtle M shape)
  const upperN = Math.floor(lipTotal * 0.44);
  for (let i = 0; i < upperN; i++) {
    const t   = N(-1, 1);
    // Two peaks at ±0.48, dip at center
    const bow = 0.020 * (Math.pow(Math.abs(t) * 1.55, 2) - 1.0) * -1;
    const x   = t * 0.172 + N(-0.014, 0.014);
    const y   = -0.312 + Math.max(0, bow) + N(-0.016, 0.016);
    const z   = 0.750 - 0.016 * t * t + N(-0.007, 0.007);
    addS(x, y, z, N(0.8, 1.6), N(0.50, 0.88), N(0.18, 0.54));
  }

  // Lower lip — fuller downward arc
  const lowerN = Math.floor(lipTotal * 0.56);
  for (let i = 0; i < lowerN; i++) {
    const t    = N(-1, 1);
    const arch = 0.016 * (1.0 - t * t);
    const x    = t * 0.180 + N(-0.014, 0.014);
    const y    = -0.402 - arch + N(-0.018, 0.018);
    const z    = 0.748 + 0.012 * (1.0 - t * t) + N(-0.007, 0.007);
    addS(x, y, z, N(0.8, 1.6), N(0.48, 0.86), N(0.18, 0.54));
  }

  // ── 6. CHEEKBONES ──────────────────────────────────────────────────────────
  const cheekN = Math.floor(count * 0.038);
  const cheeks = [{ cx: -0.472 }, { cx: 0.472 }];

  for (const { cx } of cheeks) {
    const perCheek = cheekN / 2;
    for (let i = 0; i < perCheek; i++) {
      // Crescent-shaped region following the cheekbone arc
      const angle = N(-0.6, 1.1) * Math.PI;
      const rx    = 0.145, ry = 0.110;
      const x     = cx + rx * Math.cos(angle) * N(0.3, 1.0) + N(-0.015, 0.015);
      const y     = 0.018 + ry * Math.sin(angle) * N(0.3, 1.0) + N(-0.015, 0.015);
      const z     = 0.640 + N(-0.022, 0.022);
      addS(x, y, z, N(0.7, 1.4), N(0.32, 0.70), N(0.15, 0.48));
    }
  }

  // ── 7. JAWLINE ─────────────────────────────────────────────────────────────
  // Sharp arc: from jaw angle (±0.60, -0.28, 0.38) curving through chin (0, -0.62, 0.55)
  const jawTotal = Math.floor(count * 0.048);
  for (let i = 0; i < jawTotal; i++) {
    const t    = N(-1, 1);
    const absT = Math.abs(t);

    // Lerp from jaw angle to chin along a slight curve
    const x  = t * 0.600 * N(0.88, 1.08);
    const y  = -0.280 - (1 - absT) * 0.340 + N(-0.022, 0.022);
    const z  = 0.380 + (1 - absT) * 0.170 + N(-0.012, 0.012);

    addS(x, y, z, N(0.7, 1.4), N(0.36, 0.72), N(0.16, 0.48));
  }

  // Chin mass
  const chinN = Math.floor(count * 0.018);
  for (let i = 0; i < chinN; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = rng() * 0.065;
    addS(
      r * Math.cos(angle) * 0.80,
      -0.595 + r * Math.sin(angle) * 0.65,
      0.558 - r * 0.38,
      N(0.7, 1.3), N(0.38, 0.70), N(0.15, 0.46),
    );
  }

  // ── 8. NECK ────────────────────────────────────────────────────────────────
  const neckN = Math.floor(count * 0.038);
  for (let i = 0; i < neckN; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = 0.148 + rng() * 0.082;
    const y     = -0.82 + rng() * 0.40;
    addS(
      r * Math.cos(angle),
      y,
      r * Math.sin(angle) * 0.72,
      N(0.6, 1.3), N(0.26, 0.58), N(0.14, 0.42),
    );
  }

  // ── 9. HAIR / CROWN VEIL ──────────────────────────────────────────────────
  const hairN = Math.floor(count * 0.048);
  for (let i = 0; i < hairN; i++) {
    const angle = rng() * Math.PI * 2;
    const rad   = 0.82 + rng() * 0.68;
    const x     = Math.cos(angle) * rad * N(0.50, 1.0);
    const y     = 1.40 + rng() * 1.55;
    const z     = N(-0.30, 0.32);

    addP(
      x, y, z,
      N(-1.2, 1.2), 1.4 + rng() * 2.0, N(-1.0, 1.0),
      N(0.28, 0.60), N(0.16, 0.48),
    );
  }

  // ── 10. SHOULDERS ──────────────────────────────────────────────────────────
  const shoulderN = Math.floor(count * 0.088);
  for (let i = 0; i < shoulderN; i++) {
    const x    = N(-1.85, 1.85);
    const absX = Math.abs(x);
    const y    = -1.06 - absX * 0.085 + N(-0.24, 0.24);
    const z    = N(-0.35, 0.35) - 0.10;

    addP(
      x, y, z,
      x * 0.36 + N(-1.3, 1.3),
      -(1.15 + rng() * 1.55),
      N(-1.4, 1.4),
      N(0.20, 0.50), N(0.15, 0.42),
    );
  }

  // ── 11. AMBIENT DEPTH PARTICLES ────────────────────────────────────────────
  const ambN = Math.floor(count * 0.048);
  for (let i = 0; i < ambN; i++) {
    const x = N(-3.8, 3.8);
    const y = N(-3.0, 3.2);
    const z = -(1.0 + rng() * 2.5);
    const d = Math.sqrt(x * x + y * y) + 0.01;

    addP(
      x, y, z,
      (x / d) * N(0.7, 1.5), (y / d) * N(0.7, 1.5), N(-1.0, 1.0),
      N(0.14, 0.28), N(0.10, 0.28),
    );
  }

  return {
    positions:  new Float32Array(pos),
    velocities: new Float32Array(vel),
    colors:     new Float32Array(col),
    sizes:      new Float32Array(siz),
    delays:     new Float32Array(del),
    count:      pos.length / 3,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────
interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
}

const AvaParticleScene: React.FC<AvaParticleSceneProps> = ({ scrollProgress, className }) => {
  const mountRef    = useRef<HTMLDivElement>(null);
  const uniformsRef = useRef<Record<string, { value: unknown }> | null>(null);
  const particleRef = useRef<THREE.Points | null>(null);
  const rafRef      = useRef<number>(0);
  const mouseRef    = useRef({ smoothX: 0, smoothY: 0 });

  const particleCount = useMemo(
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 9000 : 16000),
    [],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Scene / Camera / Renderer
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 5.5);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return;
    }
    renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.background = 'transparent';
    mount.appendChild(renderer.domElement);

    // ── Particles
    const geo      = generateAvaGeometry(particleCount);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',  new THREE.BufferAttribute(geo.positions,  3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(geo.velocities, 3));
    geometry.setAttribute('aColor',    new THREE.BufferAttribute(geo.colors,     3));
    geometry.setAttribute('aSize',     new THREE.BufferAttribute(geo.sizes,      1));
    geometry.setAttribute('aDelay',    new THREE.BufferAttribute(geo.delays,     1));

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

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    particleRef.current = particles;

    // ── GSAP mouse smoothing
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

    // ── Animation loop
    const startTime = Date.now();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      const elapsed = (Date.now() - startTime) / 1000;
      uniforms.uTime.value = elapsed;
      (uniforms.uMouse.value as THREE.Vector2).set(mouseRef.current.smoothX, mouseRef.current.smoothY);

      // Smooth rotation toward mouse
      const tY = mouseRef.current.smoothX * 0.30;
      const tX = -mouseRef.current.smoothY * 0.22;
      particles.rotation.y += (tY - particles.rotation.y) * 0.055;
      particles.rotation.x += (tX - particles.rotation.x) * 0.055;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [particleCount]);

  // Sync scroll progress into uniform without re-mounting
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
