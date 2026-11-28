import { createElement, useEffect, useRef, useState } from 'react';

export function useSpotlightTracker(): void {
  useEffect(() => {
    const handlePointerMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest?.('.mg-spotlight') as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };

    document.addEventListener('mousemove', handlePointerMove, { passive: true });
    return () => document.removeEventListener('mousemove', handlePointerMove);
  }, []);
}

export function KineticCounter({
  target,
  prefix = '',
  duration = 1000,
}: {
  target: number;
  prefix?: string;
  duration?: number;
}) {
  const safeTarget = Math.max(0, Math.round(Number(target) || 0));
  const [displayValue, setDisplayValue] = useState<number>(safeTarget);
  const prevTargetRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
        document.body.classList.contains('no-animations') ||
        document.body.classList.contains('fx-off-counter'));

    if (prefersReduced) {
      setDisplayValue(safeTarget);
      prevTargetRef.current = safeTarget;
      return;
    }

    const startVal = prevTargetRef.current === null ? 0 : prevTargetRef.current;
    prevTargetRef.current = safeTarget;
    if (startVal === safeTarget) {
      setDisplayValue(safeTarget);
      return;
    }

    const t0 = performance.now();
    let rafId = 0;

    const frame = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayValue(Math.round(startVal + (safeTarget - startVal) * ease));
      if (p < 1) {
        rafId = requestAnimationFrame(frame);
      }
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [safeTarget, duration]);

  return createElement('span', null, `${prefix}${displayValue.toLocaleString('en-IN')}`);
}
