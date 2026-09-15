"use client";

import { useEffect, useRef } from "react";

const MAX_DPR = 1.5;
// Particle count scales with footer area, capped per breakpoint so it never gets canvas-heavy.
const AREA_PER_PARTICLE = 90;
const DESKTOP_MAX = 4200;
const TABLET_MAX = 1800;
const MOBILE_MAX = 700;
const MOBILE_WIDTH = 768;
const TABLET_WIDTH = 1024;

// Warm tones, from faintest/most numerous to rare and brightest.
const TONES = [
  { color: "198, 174, 144", alpha: [0.08, 0.16], share: 0.8, size: [0.4, 0.9] }, // muted sand dust
  { color: "176, 138, 81", alpha: [0.22, 0.36], share: 0.18, size: [0.9, 1.5] }, // antique brass
  { color: "232, 214, 186", alpha: [0.42, 0.68], share: 0.02, size: [1.5, 2.5] }, // rare warm-ivory glints
] as const;

// Small seeded PRNG (mulberry32) so the particle field is identical across renders/resizes.
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function maxForWidth(width: number) {
  if (width <= MOBILE_WIDTH) return MOBILE_MAX;
  if (width <= TABLET_WIDTH) return TABLET_MAX;
  return DESKTOP_MAX;
}

export function FooterSand() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const footer = canvas?.closest("footer");
    const context = canvas?.getContext("2d");
    if (!canvas || !footer || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let dpr = 1;
    let count = 0;
    let isMobile = false;

    // Per-particle static properties: a fixed anchor plus a small, individually-phased
    // sway so the field drifts organically without ever accumulating or resetting.
    let baseX = new Float32Array(0);
    let baseY = new Float32Array(0);
    let size = new Float32Array(0);
    let driftAmpX = new Float32Array(0);
    let driftAmpY = new Float32Array(0);
    let freqX = new Float32Array(0);
    let freqY = new Float32Array(0);
    let phaseX = new Float32Array(0);
    let phaseY = new Float32Array(0);
    let pulseFreq = new Float32Array(0);
    let pulsePhase = new Float32Array(0);
    let pulses = new Uint8Array(0);
    let toneEnds: number[] = [];

    let visible = false;
    let tabHidden = document.hidden;
    let staticOnly = reducedMotion.matches;
    let frame = 0;
    let startTime = 0;

    let pointerActive = false;
    let pointerX = 0;
    let pointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;

    const PUSH_RADIUS = 76;
    const PUSH_AMOUNT = 2.6;

    const positionAt = (i: number, t: number) => {
      let x = baseX[i] + Math.sin(t * freqX[i] + phaseX[i]) * driftAmpX[i];
      // Amplitude is biased so particles spend more time slightly above rest (a gentle rise).
      let y = baseY[i] - Math.abs(Math.sin(t * freqY[i] + phaseY[i])) * driftAmpY[i];

      if (pointerActive) {
        const dx = x - smoothPointerX;
        const dy = y - smoothPointerY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < PUSH_RADIUS * PUSH_RADIUS && distanceSquared > 1) {
          const distance = Math.sqrt(distanceSquared);
          const falloff = 1 - distance / PUSH_RADIUS;
          const push = (falloff * falloff * PUSH_AMOUNT) / distance;
          x += dx * push;
          y += dy * push;
        }
      }

      return [x, y] as const;
    };

    const PULSE_BUCKETS = 16;

    const draw = (t: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      let start = 0;
      TONES.forEach((tone, toneIndex) => {
        const end = toneEnds[toneIndex];
        const baseAlpha = (tone.alpha[0] + tone.alpha[1]) / 2;
        // Non-pulsing particles (the vast majority) draw as one batched fill; only the
        // small pulsing subset needs its brightness bucketed per frame.
        const steady = new Path2D();
        const buckets: (Path2D | undefined)[] = [];

        for (let i = start; i < end; i++) {
          const [x, y] = positionAt(i, t);
          if (staticOnly || !pulses[i]) {
            steady.rect(x, y, size[i], size[i]);
            continue;
          }
          const wave = (Math.sin(t * pulseFreq[i] + pulsePhase[i]) + 1) / 2;
          const a = tone.alpha[0] + (tone.alpha[1] - tone.alpha[0]) * wave;
          const key = Math.round(a * PULSE_BUCKETS);
          (buckets[key] ??= new Path2D()).rect(x, y, size[i], size[i]);
        }

        context.fillStyle = `rgba(${tone.color}, ${baseAlpha})`;
        context.fill(steady);
        buckets.forEach((path, key) => {
          if (!path) return;
          context.fillStyle = `rgba(${tone.color}, ${key / PULSE_BUCKETS})`;
          context.fill(path);
        });
        start = end;
      });
    };

    const build = () => {
      const bounds = footer.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      isMobile = width <= MOBILE_WIDTH;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      count = Math.min(maxForWidth(width), Math.round((width * height) / AREA_PER_PARTICLE));
      baseX = new Float32Array(count);
      baseY = new Float32Array(count);
      size = new Float32Array(count);
      driftAmpX = new Float32Array(count);
      driftAmpY = new Float32Array(count);
      freqX = new Float32Array(count);
      freqY = new Float32Array(count);
      phaseX = new Float32Array(count);
      phaseY = new Float32Array(count);
      pulseFreq = new Float32Array(count);
      pulsePhase = new Float32Array(count);
      pulses = new Uint8Array(count);

      const random = createRandom(2931);
      let end = 0;
      toneEnds = TONES.map((tone, t) => {
        end = t === TONES.length - 1 ? count : end + Math.round(count * tone.share);
        return end;
      });

      let toneIndex = 0;
      for (let i = 0; i < count; i++) {
        if (i >= toneEnds[toneIndex]) toneIndex++;
        const tone = TONES[toneIndex];

        baseX[i] = random() * width;
        // A fifth of the particles spread evenly; the rest settle toward the lower half.
        baseY[i] = (random() < 0.2 ? random() : Math.pow(random(), 1 / 1.6)) * height;
        size[i] = tone.size[0] + random() * (tone.size[1] - tone.size[0]);

        // Slow, individually-phased sway (18-32s per cycle) — never synchronized, never reset.
        driftAmpX[i] = 0.6 + random() * 2.2;
        driftAmpY[i] = 1 + random() * 3;
        freqX[i] = (2 * Math.PI) / (18 + random() * 14);
        freqY[i] = (2 * Math.PI) / (20 + random() * 16);
        phaseX[i] = random() * Math.PI * 2;
        phaseY[i] = random() * Math.PI * 2;

        // Only a minority of particles slowly pulse in brightness.
        pulses[i] = random() < 0.15 ? 1 : 0;
        pulseFreq[i] = (2 * Math.PI) / (4 + random() * 5);
        pulsePhase[i] = random() * Math.PI * 2;
      }

      draw(0);
    };

    const step = (time: number) => {
      if (!startTime) startTime = time;
      if (pointerActive) {
        smoothPointerX += (pointerX - smoothPointerX) * 0.12;
        smoothPointerY += (pointerY - smoothPointerY) * 0.12;
      }
      draw((time - startTime) / 1000);
      if (visible && !tabHidden && !staticOnly) {
        frame = requestAnimationFrame(step);
      } else {
        frame = 0;
      }
    };

    const schedule = () => {
      if (!frame && visible && !tabHidden && !staticOnly) {
        startTime = 0;
        frame = requestAnimationFrame(step);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || isMobile || staticOnly) return;
      const bounds = footer.getBoundingClientRect();
      pointerX = event.clientX - bounds.left;
      pointerY = event.clientY - bounds.top;
      if (!pointerActive) {
        // Snap the eased position to the entry point so it doesn't glide in from (0, 0).
        smoothPointerX = pointerX;
        smoothPointerY = pointerY;
      }
      pointerActive = true;
      schedule();
    };

    const handlePointerLeave = () => {
      pointerActive = false;
    };

    const handleVisibilityChange = () => {
      tabHidden = document.hidden;
      schedule();
    };

    const handleReducedMotionChange = () => {
      staticOnly = reducedMotion.matches;
      if (staticOnly) {
        cancelAnimationFrame(frame);
        frame = 0;
        pointerActive = false;
        draw(0);
      } else {
        schedule();
      }
    };

    const resizeObserver = new ResizeObserver(build);
    resizeObserver.observe(footer);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) schedule();
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(footer);

    footer.addEventListener("pointermove", handlePointerMove, { passive: true });
    footer.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    reducedMotion.addEventListener("change", handleReducedMotionChange);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      footer.removeEventListener("pointermove", handlePointerMove);
      footer.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
