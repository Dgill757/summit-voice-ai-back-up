/**
 * AvaPhoto — Ava portrait with a mouse-tracking backlight.
 *
 * The photo has a pure-black background. mix-blend-mode:screen makes
 * black = transparent so Ava floats on the dark hero without a box.
 * A cyan radial gradient sits behind her and slowly follows the cursor,
 * shifting the light direction and throwing contrast across her face.
 */

import React, { useRef, useEffect } from 'react';

interface AvaParticleSceneProps {
  scrollProgress: number;
  className?: string;
}

export default function AvaParticleScene({
  className,
}: AvaParticleSceneProps) {
  const lightRef = useRef<HTMLDivElement>(null);
  const rimRef   = useRef<HTMLDivElement>(null);
  const mouse    = useRef({ x: 68, y: 42, sx: 68, sy: 42 });
  const raf      = useRef<number>(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth)  * 100;
      mouse.current.y = (e.clientY / window.innerHeight) * 100;
    };
    window.addEventListener('mousemove', onMove);

    const tick = () => {
      const m = mouse.current;
      // Slow lerp — light drifts behind the cursor, feels atmospheric
      m.sx += (m.x - m.sx) * 0.04;
      m.sy += (m.y - m.sy) * 0.04;

      if (lightRef.current) {
        lightRef.current.style.background =
          `radial-gradient(ellipse 52% 58% at ${m.sx}% ${m.sy}%,` +
          ` rgba(0,210,255,0.30) 0%,` +
          ` rgba(0,160,220,0.13) 38%,` +
          ` rgba(0,80,160,0.05) 62%,` +
          ` transparent 78%)`;
      }

      // Rim light: tighter bright spot offset toward face centre —
      // creates edge contrast as the main light shifts away
      if (rimRef.current) {
        const rx = m.sx + (50 - m.sx) * 0.18;
        const ry = m.sy + (45 - m.sy) * 0.18;
        rimRef.current.style.background =
          `radial-gradient(ellipse 26% 32% at ${rx}% ${ry}%,` +
          ` rgba(0,230,255,0.20) 0%,` +
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
      {/* Main moving backlight */}
      <div
        ref={lightRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 52% 58% at 68% 42%, rgba(0,210,255,0.30) 0%, rgba(0,160,220,0.13) 38%, transparent 70%)',
        }}
      />

      {/* Rim light — tighter highlight for face-edge contrast */}
      <div
        ref={rimRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 26% 32% at 62% 38%, rgba(0,230,255,0.20) 0%, transparent 55%)',
        }}
      />

      {/* Ava photo — mix-blend-mode:screen makes the black bg disappear */}
      <img
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
            'drop-shadow(0 0 24px rgba(0,210,255,0.55))',
            'drop-shadow(0 0 60px rgba(0,170,220,0.28))',
            'drop-shadow(0 0 110px rgba(0,100,180,0.14))',
          ].join(' '),
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    </div>
  );
}
