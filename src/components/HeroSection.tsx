import React, { useState, useEffect, useRef } from 'react';
import AvaParticleScene from './ava/AvaParticleScene';
import CalendarDialog from './CalendarDialog';

interface HeroSectionProps {
  calendarOpen: boolean;
  setCalendarOpen: (open: boolean) => void;
}

const HeroSection: React.FC<HeroSectionProps> = ({ calendarOpen, setCalendarOpen }) => {
  const [scrollProgress, setScrollProgress] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);

  // Track scroll to dissolve Ava as section leaves viewport
  useEffect(() => {
    const handleScroll = () => {
      if (!heroRef.current) return;
      const rect = heroRef.current.getBoundingClientRect();
      // Dissolve over the first 60% of viewport height of scrolling away
      const progress = Math.max(0, Math.min(1, -rect.top / (window.innerHeight * 0.6)));
      setScrollProgress(progress);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToDemo = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      ref={heroRef}
      style={{
        position: 'relative',
        minHeight: '100vh',
        background: '#000000',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Pure black — no decorative glows, particles are the only light source */}

      {/* ── Ava Particle Canvas (full-section overlay, pointer-events none on canvas) ── */}
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        opacity: 1 - scrollProgress * 0.8,
        transition: 'opacity 0.1s linear',
        pointerEvents: scrollProgress > 0.5 ? 'none' : 'auto',
      }}>
        <AvaParticleScene
          scrollProgress={scrollProgress}
          className="w-full h-full"
          modelUrl="/Ava.glb"
        />
      </div>

      {/* ── Hero Content ── */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        maxWidth: 1280,
        width: '100%',
        margin: '0 auto',
        padding: '0 1.5rem',
        paddingTop: '7rem',
        paddingBottom: '6rem',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '3rem',
      }}
        className="flex-col lg:flex-row"
      >
        {/* Left: Text */}
        <div style={{ flex: '1', minWidth: 0, maxWidth: 640 }}>
          {/* Live badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: 'rgba(124,58,237,0.12)',
            border: '1px solid rgba(124,58,237,0.28)',
            borderRadius: 999,
            padding: '0.45rem 1.1rem',
            marginBottom: '2rem',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#7C3AED',
              boxShadow: '0 0 12px rgba(124,58,237,0.9)',
              animation: 'pulse-glow 2.5s ease-in-out infinite',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.04em' }}>
              LIVE AI VOICE AGENT
            </span>
          </div>

          {/* Headline */}
          <h1 style={{
            fontWeight: 900,
            fontSize: 'clamp(2.6rem, 5.5vw, 4.8rem)',
            lineHeight: 1.06,
            letterSpacing: '-0.035em',
            marginBottom: '1.5rem',
            color: '#fff',
          }}>
            Meet{' '}
            <span style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #3B82F6 50%, #F472B6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Ava
            </span>
            {' '}—{' '}
            <br />
            Your AI Voice{' '}
            <br className="hidden sm:block" />
            Agent
          </h1>

          {/* Sub-headline */}
          <p style={{
            fontSize: 'clamp(1rem, 2vw, 1.2rem)',
            lineHeight: 1.65,
            color: 'rgba(255,255,255,0.62)',
            marginBottom: '2.5rem',
            maxWidth: 520,
            fontWeight: 400,
          }}>
            Stop losing revenue to missed calls and static forms. Ava answers every call, qualifies
            leads, books appointments, and follows up—24/7, while you sleep.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '3rem' }}>
            <button
              onClick={() => setCalendarOpen(true)}
              className="btn-primary"
              style={{ padding: '1rem 2.2rem', fontSize: '1rem' }}
            >
              <span>Book a Free Demo</span>
            </button>
            <button
              onClick={scrollToDemo}
              className="btn-outline"
              style={{ padding: '1rem 2.2rem', fontSize: '1rem' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Hear Ava
              </span>
            </button>
          </div>

          {/* Feature Pills */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {[
              'Never Miss a Call',
              'Auto Scheduling',
              '24/7 Lead Capture',
              'Billing & Invoicing',
            ].map((feat) => (
              <div key={feat} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                padding: '0.5rem 1rem',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 999,
                fontSize: '0.8rem',
                color: 'rgba(255,255,255,0.75)',
                fontWeight: 500,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {feat}
              </div>
            ))}
          </div>
        </div>

        {/* Right: stats floating cards (desktop only) */}
        <div className="hidden lg:flex" style={{ flex: '0 0 auto', width: 320, position: 'relative', height: 420 }}>
          {/* Stat card 1 */}
          <div style={{
            position: 'absolute', top: 0, right: 0,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 20,
            padding: '1.5rem',
            backdropFilter: 'blur(20px)',
            width: 240,
            animation: 'float-y 7s ease-in-out infinite',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.5rem', fontWeight: 500, letterSpacing: '0.06em' }}>
              MONTHLY SAVINGS
            </div>
            <div style={{
              fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.04em',
              background: 'linear-gradient(135deg,#7C3AED,#3B82F6)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              $8,500<span style={{ fontSize: '1.2rem' }}>/mo</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
              vs. traditional staff
            </div>
          </div>
          {/* Stat card 2 */}
          <div style={{
            position: 'absolute', bottom: 40, left: 0,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 20,
            padding: '1.5rem',
            backdropFilter: 'blur(20px)',
            width: 220,
            animation: 'float-y 9s ease-in-out infinite',
            animationDelay: '1.5s',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.5rem', fontWeight: 500, letterSpacing: '0.06em' }}>
              CALLS CAPTURED
            </div>
            <div style={{
              fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.04em',
              background: 'linear-gradient(135deg,#F472B6,#7C3AED)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              100%
            </div>
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
              every call answered
            </div>
          </div>
          {/* Stat card 3 */}
          <div style={{
            position: 'absolute', top: 140, right: 20,
            background: 'rgba(124,58,237,0.12)',
            border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: 16,
            padding: '1rem 1.2rem',
            backdropFilter: 'blur(20px)',
            animation: 'float-y 6s ease-in-out infinite',
            animationDelay: '3s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#22C55E',
                boxShadow: '0 0 8px rgba(34,197,94,0.8)',
                animation: 'pulse-glow 2s ease-in-out infinite',
              }} />
              <span style={{ fontSize: '0.8rem', color: '#22C55E', fontWeight: 600 }}>Ava is live</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)', marginTop: '0.3rem' }}>
              Handling calls 24/7
            </div>
          </div>
        </div>
      </div>

      {/* ── Scroll Indicator ── */}
      <div style={{
        position: 'absolute',
        bottom: '2.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        opacity: Math.max(0, 1 - scrollProgress * 3),
        transition: 'opacity 0.2s',
      }}>
        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}>
          Scroll to explore
        </span>
        <div style={{
          width: 24, height: 38, borderRadius: 12,
          border: '1.5px solid rgba(255,255,255,0.18)',
          display: 'flex', justifyContent: 'center', paddingTop: '0.4rem',
        }}>
          <div style={{
            width: 4, height: 8, borderRadius: 2, background: 'rgba(255,255,255,0.5)',
            animation: 'float-y 1.5s ease-in-out infinite',
          }} />
        </div>
      </div>

      <CalendarDialog open={calendarOpen} setOpen={setCalendarOpen} />
    </section>
  );
};

export default HeroSection;
