"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/shared/components/ui/BrandMark";
import { BookingProvider } from "@/features/booking/context/BookingContext";
import { BookingProgress } from "@/features/booking/components/BookingProgress";

// A restrained, quiet-checkout header — not the full marketing Header/Footer,
// so the booking flow keeps a guest's focus. Still unmistakably Three
// Pyramids: same brand mark, same dark/ivory/brass system, same type.
export function BookingShell({ children }: { children: ReactNode }) {
  return (
    <BookingProvider>
      <div className="flex min-h-dvh flex-col bg-ivory">
        <header className="border-b border-brass/16 bg-ink text-ivory">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-[var(--page-x)] py-4 sm:flex-row sm:items-center sm:justify-between sm:py-5">
            <div className="flex items-center justify-between gap-4 sm:justify-start sm:gap-8">
              <Link href="/" className="group flex items-center gap-2.5" aria-label="Three Pyramids home">
                <BrandMark className="h-5 w-10 text-brass transition-colors group-hover:text-ivory" />
                <span className="text-[0.6rem] font-black uppercase tracking-[0.2em]">Three Pyramids</span>
              </Link>
              <Link href="/" className="text-link text-ivory/60 sm:hidden">
                Back to hotel
              </Link>
            </div>

            <BookingProgress />

            <Link href="/" className="text-link hidden shrink-0 text-ivory/60 sm:inline-flex">
              Back to hotel -&gt;
            </Link>
          </div>
        </header>

        <main id="main-content" className="flex-1">
          {children}
        </main>
      </div>
    </BookingProvider>
  );
}
