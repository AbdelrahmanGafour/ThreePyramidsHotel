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
        <header className="border-b border-brass/20 bg-ink text-ivory">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-[var(--page-x)] py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4">
            <div className="flex items-center justify-between gap-4 sm:justify-start sm:gap-8">
              <Link href="/" className="inner-focus group flex min-h-11 items-center gap-2.5" aria-label="Three Pyramids home">
                <BrandMark className="h-5 w-10 text-brass transition-colors group-hover:text-ivory" />
                <span className="text-[0.8125rem] font-bold uppercase tracking-[0.16em]">Three Pyramids</span>
              </Link>
              <Link
                href="/"
                className="inner-focus inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-ivory underline decoration-ivory/40 underline-offset-4 hover:decoration-brass sm:hidden"
              >
                Back to hotel
              </Link>
            </div>

            <BookingProgress />

            <Link
              href="/"
              className="inner-focus hidden min-h-11 shrink-0 items-center text-[0.9375rem] font-semibold text-ivory underline decoration-ivory/40 underline-offset-4 hover:decoration-brass sm:inline-flex"
            >
              Back to hotel
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
