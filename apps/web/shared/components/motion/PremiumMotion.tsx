"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, type Variants } from "motion/react";

export const luxuryEase = [0.22, 1, 0.36, 1] as const;
export const uiEase = [0.4, 0, 0.2, 1] as const;

export const motionPrimitives = {
  staggerContainer: {
    hidden: {},
    show: {
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.06,
      },
    },
  },
  revealUp: {
    hidden: { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.72, ease: luxuryEase } },
  },
  editorialText: {
    hidden: { opacity: 0, y: 18, clipPath: "inset(12% 0 0 0)" },
    show: {
      opacity: 1,
      y: 0,
      clipPath: "inset(0 0 0 0)",
      transition: { duration: 0.82, ease: luxuryEase },
    },
  },
  precisionDetail: {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.44, ease: uiEase } },
  },
  revealMask: {
    hidden: { opacity: 0, clipPath: "inset(0 0 18% 0)" },
    show: {
      opacity: 1,
      clipPath: "inset(0 0 0% 0)",
      transition: { duration: 1.05, ease: luxuryEase },
    },
  },
  subtleScale: {
    hidden: { opacity: 0, scale: 1.018 },
    show: { opacity: 1, scale: 1, transition: { duration: 1.15, ease: luxuryEase } },
  },
  fadeCross: {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.86, ease: luxuryEase } },
    exit: { opacity: 0, transition: { duration: 0.5, ease: uiEase } },
  },
} satisfies Record<string, Variants>;

type DepthImageProps = {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  imageClassName?: string;
  objectPosition?: string;
};

export function DepthImage({
  src,
  alt,
  sizes,
  className,
  imageClassName,
  objectPosition,
}: DepthImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [canHover, setCanHover] = useState(false);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px" }}
      variants={motionPrimitives.revealMask}
      onPointerMove={(event) => {
        if (!canHover || reduceMotion) return;

        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const yy = (event.clientY - bounds.top) / bounds.height - 0.5;

        rotateX.set(yy * -0.75);
        rotateY.set(x * 0.75);
      }}
      onPointerLeave={() => {
        rotateX.set(0);
        rotateY.set(0);
      }}
      style={{
        perspective: 1400,
        rotateX: reduceMotion ? 0 : rotateX,
        rotateY: reduceMotion ? 0 : rotateY,
      }}
      transition={{ duration: 0.7, ease: luxuryEase }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className={imageClassName}
        style={{ objectPosition }}
      />
    </motion.div>
  );
}
