/**
 * Ava — Holographic AI portrait (Jarvis-style)
 *
 * Effects:
 * 1. Photo with mix-blend-mode:screen so black bg disappears
 * 2. Photo tilts in 3D to FOLLOW the mouse (parallax depth)
 * 3. Backlight moves OPPOSITE to the mouse (creates contrast drama)
 * 4. Scanlines + dot-pixel grid = digital screen / hologram feel
 * 5. Cyan HUD corner brackets frame the portrait
 */

import React, { useRef, useEffect } from 'react';

interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
}

export default function AvaParticleScene({ className }: AvaParticleSceneProps) {
  const photoRef     = useRef<HTMLImageElement>(null);
  const lightRef     = useRef<HTMLDivElement>(null);
  const rimRef       = useRef<HTMLDivElement>(null);
  const mouse        = useRef({ x: 50, y: 42, sx: 50, sy: 42 });
  const raf          = useRef<number>(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth)  * 100;
      mouse.current.y = (e.clientY / window.innerHeight) * 100;
    };
    window.addEventListener('mousemove', onMove);

    const tick = () => {
      const m = mouse.current;
      m.sx += (m.x - m.sx) * 0.05;
      m.sy += (m.y - m.sy) * 0.05;

      // ── Photo: 3D tilt FOLLOWS mouse ─────────────────────────────
      if (photoRef.current) {
        const rotY = ((m.sx - 50) / 50) * 8;    // –8° … +8° horizontal
        const rotX = ((m.sy - 50) / 50) * -5;   // –5° … +5° vertical
        const tx   = ((m.sx - 50) / 50) * 14;   // subtle x drift px
        const ty   = ((m.sy - 50) / 50) * 8;    // subtle y drift px
        photoRef.current.style.transform =
          `perspective(1400px) rotateY(${rotY}deg) rotateX(${rotX}deg) translate(${tx}px,${ty}px) scale(1.03)`;
      }

      // ── Backlight: moves OPPOSITE mouse ─────────────────────────
      if (lightRef.current) {
        const lx = 100 - m.sx;
        const ly = 100 - m.sy;
        lightRef.current.style.background =
          `radial-gradient(ellipse 58% 65% at ${lx}% ${ly}%,` +
          ` rgba(0,200,255,0.26) 0%,` +
          ` rgba(0,140,220,0.11) 42%,` +
          ` transparent 72%)`;
      }

      // ── Rim light: tight secondary glow, also opposite ─────────
      if (rimRef.current) {
        const rx = 100 - m.sx * 0.7;
        const ry = 100 - m.sy * 0.7;
        rimRef.current.style.background =
          `radial-gradient(ellipse 28% 34% at ${rx}% ${ry}%,` +
          ` rgba(0,230,255,0.18) 0%,` +
          ` transparent 55%)`;
      }

      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {/* ── Ambient base — keeps it from being totally dark when mouse is centered ── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 55% 65% at 68% 45%, rgba(0,170,255,0.07) 0%, transparent 65%)',
      }} />

      {/* ── Main backlight — moves OPPOSITE mouse ── */}
      <div
        ref={lightRef}
        style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 58% 65% at 50% 58%, rgba(0,200,255,0.26) 0%, rgba(0,140,220,0.11) 42%, transparent 72%)',
        }}
      />

      {/* ── Rim light — also opposite ── */}
      <div
        ref={rimRef}
        style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 28% 34% at 65% 35%, rgba(0,230,255,0.18) 0%, transparent 55%)',
        }}
      />

      {/* ── Ava photo — 3D tilt follows mouse ── */}
      <img
        ref={photoRef}
        src="/ava-face.png"
        alt="Ava"
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          height: '100%',
          width: '60%',
          objectFit: 'contain',
          objectPosition: 'center top',
          zIndex: 1,
          mixBlendMode: 'screen',
          filter: [
            'drop-shadow(0 0 28px rgba(0,200,255,0.60))',
            'drop-shadow(0 0 65px rgba(0,160,225,0.30))',
            'drop-shadow(0 0 120px rgba(0,100,180,0.15))',
            'saturate(1.3)',
            'contrast(1.06)',
          ].join(' '),
          transformOrigin: 'center top',
          willChange: 'transform',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />

      {/* ── Holographic cyan tint — very subtle color cast ── */}
      <div style={{
        position: 'absolute', right: 0, top: 0,
        height: '100%', width: '60%',
        zIndex: 2, pointerEvents: 'none',
        background: 'rgba(0,180,255,0.05)',
        mixBlendMode: 'screen',
      }} />

      {/* ── Scanlines — horizontal micro-lines for digital screen feel ── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(0,200,255,0.022) 3px, rgba(0,200,255,0.022) 4px)',
      }} />

      {/* ── Dot-pixel grid — gives hologram / digital display texture ── */}
      <div style={{
        position: 'absolute', right: 0, top: 0,
        height: '100%', width: '60%',
        zIndex: 3, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(0,200,255,0.07) 1px, transparent 1px)',
        backgroundSize: '6px 6px',
      }} />

      {/* ── HUD corner brackets — Jarvis frame ── */}
      {/* Top-right corner */}
      <div style={{ position: 'absolute', top: '7%', right: '3%', zIndex: 5, pointerEvents: 'none' }}>
        <div style={{ width: 20, height: 2, background: 'rgba(0,220,255,0.7)', position: 'absolute', top: 0, right: 0 }} />
        <div style={{ width: 2, height: 20, background: 'rgba(0,220,255,0.7)', position: 'absolute', top: 0, right: 0 }} />
      </div>
      {/* Bottom-right corner */}
      <div style={{ position: 'absolute', bottom: '7%', right: '3%', zIndex: 5, pointerEvents: 'none' }}>
        <div style={{ width: 20, height: 2, background: 'rgba(0,220,255,0.7)', position: 'absolute', bottom: 0, right: 0 }} />
        <div style={{ width: 2, height: 20, background: 'rgba(0,220,255,0.7)', position: 'absolute', bottom: 0, right: 0 }} />
      </div>
      {/* Top-left of portrait frame */}
      <div style={{ position: 'absolute', top: '7%', right: '41%', zIndex: 5, pointerEvents: 'none' }}>
        <div style={{ width: 20, height: 2, background: 'rgba(0,220,255,0.7)', position: 'absolute', top: 0, left: 0 }} />
        <div style={{ width: 2, height: 20, background: 'rgba(0,220,255,0.7)', position: 'absolute', top: 0, left: 0 }} />
      </div>
      {/* Bottom-left of portrait frame */}
      <div style={{ position: 'absolute', bottom: '7%', right: '41%', zIndex: 5, pointerEvents: 'none' }}>
        <div style={{ width: 20, height: 2, background: 'rgba(0,220,255,0.7)', position: 'absolute', bottom: 0, left: 0 }} />
        <div style={{ width: 2, height: 20, background: 'rgba(0,220,255,0.7)', position: 'absolute', bottom: 0, left: 0 }} />
      </div>

      {/* ── HUD data tag ── */}
      <div style={{
        position: 'absolute', bottom: '6%', right: '6%', zIndex: 5,
        pointerEvents: 'none',
        fontSize: '0.6rem',
        fontFamily: 'monospace',
        letterSpacing: '0.12em',
        color: 'rgba(0,220,255,0.45)',
        textTransform: 'uppercase',
      }}>
        AI · VOICE · ACTIVE
      </div>
    </div>
  );
}
