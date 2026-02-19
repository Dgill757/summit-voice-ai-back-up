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

// ─── Particle Geometry Generator ──────────────────────────────────────────────
function generateAvaGeometry(count: number) {
  const pos: number[] = [];
  const vel: number[] = [];
  const col: number[] = [];
  const siz: number[] = [];
  const del: number[] = [];

  const add = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    size: number
  ) => {
    pos.push(x, y, z);
    vel.push(vx, vy, vz);
    col.push(r, g, b);
    siz.push(size);
    del.push(Math.random() * Math.PI * 2);
  };

  const rng = Math.random;

  // ── HEAD ELLIPSOID (62%)
  const headN = Math.floor(count * 0.62);
  for (let i = 0; i < headN; i++) {
    const theta = rng() * Math.PI * 2;
    const phi   = Math.acos(2 * rng() - 1);
    const r     = rng() < 0.65
      ? 0.88 + rng() * 0.12          // surface
      : Math.cbrt(rng()) * 0.88;     // interior

    let x = r * Math.sin(phi) * Math.cos(theta) * 1.13;
    let y = r * Math.cos(phi) * 1.56 + 0.40;
    let z = r * Math.sin(phi) * Math.sin(theta) * 0.82;

    x += (rng() - 0.5) * 0.055;
    y += (rng() - 0.5) * 0.055;
    z += (rng() - 0.5) * 0.035;

    const d     = Math.sqrt(x*x + y*y + z*z) + 0.001;
    const speed = 0.6 + rng() * 1.9;
    const vx    = (x / d) * speed + (rng() - 0.5) * 1.2;
    const vy    = (y / d) * speed * 0.55 + (rng() - 0.5) * 1.0;
    const vz    = (rng() < 0.5 ? 1 : -1) * speed * 1.5 + (rng() - 0.5) * 0.8;

    const bright     = 0.42 + rng() * 0.58;
    const faceFactor = (z + 0.82) / 1.64;
    const lum        = bright * (0.80 + faceFactor * 0.20);

    // Deep purple: R ~0.38, G ~0.14, B ~0.92  (#7C3AED range)
    add(x, y, z, vx, vy, vz,
      lum * (0.36 + rng() * 0.10),
      lum * (0.13 + rng() * 0.06),
      lum * (0.90 + rng() * 0.10),
      0.25 + rng() * 0.75);
  }

  // ── HAIR / VEIL (6%)
  const hairN = Math.floor(count * 0.06);
  for (let i = 0; i < hairN; i++) {
    const angle = rng() * Math.PI * 2;
    const rad   = 0.85 + rng() * 0.72;
    const x     = Math.cos(angle) * rad * (0.55 + rng() * 0.45);
    const y     = 1.45 + rng() * 1.45;
    const z     = (rng() - 0.5) * 0.40;

    add(x, y, z,
      (rng() - 0.5) * 2.4, 1.4 + rng() * 2.0, (rng() - 0.5) * 2.0,
      0.30 + rng() * 0.10, 0.09 + rng() * 0.06, 0.68 + rng() * 0.20,
      0.18 + rng() * 0.50);
  }

  // ── NECK (4%)
  const neckN = Math.floor(count * 0.04);
  for (let i = 0; i < neckN; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = 0.14 + rng() * 0.13;
    const x     = r * Math.cos(angle);
    const y     = -0.82 + rng() * 0.52;
    const z     = r * Math.sin(angle) * 0.66;

    add(x, y, z,
      (rng() - 0.5) * 2.6, -(1.0 + rng() * 2.0), (rng() - 0.5) * 2.0,
      0.34 + rng() * 0.10, 0.10 + rng() * 0.06, 0.72 + rng() * 0.20,
      0.18 + rng() * 0.45);
  }

  // ── SHOULDERS / BUST (22%)
  const shoulderN = Math.floor(count * 0.22);
  for (let i = 0; i < shoulderN; i++) {
    const x    = (rng() - 0.5) * 3.7;
    const xAbs = Math.abs(x);
    const y    = -0.95 - xAbs * 0.11 + (rng() - 0.5) * 0.48;
    const z    = (rng() - 0.5) * 0.78 - 0.12;

    add(x, y, z,
      x * 0.38 + (rng() - 0.5) * 2.5, -(1.2 + rng() * 1.5), (rng() - 0.5) * 2.6,
      0.26 + rng() * 0.10, 0.08 + rng() * 0.05, 0.55 + rng() * 0.20,
      0.18 + rng() * 0.55);
  }

  // ── AMBIENT DEPTH PARTICLES (6%)
  const ambN = Math.floor(count * 0.06);
  for (let i = 0; i < ambN; i++) {
    const x  = (rng() - 0.5) * 7.5;
    const y  = (rng() - 0.5) * 6.0 + 0.3;
    const z  = -(1.0 + rng() * 2.5);
    const d  = Math.sqrt(x*x + y*y) + 0.01;

    add(x, y, z,
      x / d * (0.7 + rng() * 1.4), y / d * (0.7 + rng() * 1.4), (rng() - 0.5) * 2.0,
      0.16 + rng() * 0.08, 0.05 + rng() * 0.04, 0.32 + rng() * 0.14,
      0.12 + rng() * 0.30);
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
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 8000 : 14000),
    []
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Scene / Camera / Renderer
    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 100);
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
    const geo = generateAvaGeometry(particleCount);
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
      vertexShader:   VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      transparent:       true,
      depthWrite:        false,
      blending:          THREE.NormalBlending,
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
      uniforms.uTime.value           = elapsed;
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
