import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Particles, { ParticlesProvider, useParticlesProvider } from '@tsparticles/react';
import type { Engine, ISourceOptions } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';

type SparklesProps = {
  id?: string;
  className?: string;
  background?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};

function ParticlesLayer({
  id,
  className,
  options,
}: {
  id: string;
  className?: string;
  options: ISourceOptions;
}) {
  const { loaded } = useParticlesProvider();
  if (!loaded) return null;
  return <Particles id={id} className={className} options={options} />;
}

// Adapted from Aceternity UI's SparklesCore (tsParticles) for a plain-CSS,
// Astro + React-island setup. No Tailwind, no extra motion dependency.
export default function Sparkles({
  id,
  className,
  background = 'transparent',
  minSize = 0.5,
  maxSize = 1.2,
  speed = 1.4,
  particleColor = '#7AA2FF',
  particleDensity = 110,
}: SparklesProps) {
  const generatedId = useId();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setEnabled(false);
    }
  }, []);

  const init = useCallback(async (engine: Engine) => {
    await loadSlim(engine);
  }, []);

  const options = useMemo<ISourceOptions>(
    () => ({
      background: { color: { value: background } },
      fullScreen: { enable: false, zIndex: 0 },
      fpsLimit: 120,
      detectRetina: true,
      interactivity: { events: { resize: { enable: true } } },
      particles: {
        color: { value: particleColor },
        move: {
          enable: true,
          direction: 'none',
          straight: false,
          random: true,
          speed: { min: 0.04, max: 0.3 },
          outModes: { default: 'out' },
        },
        number: {
          value: particleDensity,
          density: { enable: true, width: 900, height: 900 },
        },
        opacity: {
          value: { min: 0.12, max: 0.95 },
          animation: { enable: true, sync: false, speed, startValue: 'random' },
        },
        size: { value: { min: minSize, max: maxSize } },
        shape: { type: 'circle' },
      },
    }),
    [background, particleColor, particleDensity, minSize, maxSize, speed],
  );

  if (!enabled) return null;

  return (
    <ParticlesProvider init={init}>
      <ParticlesLayer id={id || generatedId} className={className} options={options} />
    </ParticlesProvider>
  );
}
