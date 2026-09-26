"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BrandMark } from "@/shared/components/ui/BrandMark";
import { navItems } from "@/features/home/data/homeData";

const leftNavItems = navItems.slice(0, 3);
const rightNavItems = navItems.slice(3);

// Items that are real pages now — always the same destination regardless of
// which page you're currently on. Everything else in `navItems` is a
// homepage section anchor: on the homepage itself that's a smooth in-page
// scroll, from any other page it's a link back to `/` with the hash so the
// browser lands on the right section once the homepage has mounted.
const PAGE_LINKS: Record<string, string> = {
  Stay: "/rooms",
  Journeys: "/packages",
};

// Routes that render a light background from the first frame, so the
// transparent top-of-page treatment (designed for a dark hero image) would
// read as low-contrast there. This intentionally includes routes that are
// not in the primary nav (like Contact) — nav membership and "is this a
// light page" are separate questions.
const LIGHT_BACKGROUND_ROUTES = [...Object.values(PAGE_LINKS), "/contact", "/faq", "/policies", "/privacy"];

function slugify(item: string) {
  return item.toLowerCase().replace(/ /g, "-");
}

export function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  // Those routes render the header's existing dark/scrolled surface
  // immediately instead of waiting for a scroll event; the homepage keeps
  // the scroll-driven behavior unchanged.
  const isLightBackgroundRoute = LIGHT_BACKGROUND_ROUTES.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
  const [scrolled, setScrolled] = useState(false);
  const showDarkSurface = scrolled || isLightBackgroundRoute;
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState("");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }, []);

  const hrefFor = useCallback((item: string) => {
    const pageHref = PAGE_LINKS[item];
    if (pageHref) return pageHref;
    // `/#id` resolves correctly from any route, including the homepage
    // itself — Next's Link treats it as a same-page scroll there rather
    // than a reload, so no pathname branching is needed for the href.
    return `/#${slugify(item)}`;
  }, []);

  const isActive = useCallback(
    (item: string) => {
      const pageHref = PAGE_LINKS[item];
      if (pageHref) return pathname === pageHref || pathname.startsWith(`${pageHref}/`);
      return isHome && activeAnchor === slugify(item);
    },
    [pathname, isHome, activeAnchor],
  );

  useEffect(() => {
    // React skips re-rendering when the value is unchanged, so this only renders when the threshold is crossed.
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isHome) return;

    const anchorItems = navItems.filter((item) => !PAGE_LINKS[item]);
    const sections = anchorItems
      .map((item) => document.getElementById(slugify(item)))
      .filter((section): section is HTMLElement => Boolean(section));

    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target.id) setActiveAnchor(visible.target.id);
      },
      { rootMargin: "-38% 0px -52% 0px", threshold: [0.12, 0.28, 0.44] },
    );

    sections.forEach((section) => observer.observe(section));
    // Resetting `activeAnchor` here — as this effect tears down, whether from
    // leaving the homepage or unmounting — rather than in a second effect
    // keyed on `isHome`, is what stops a section highlighted just before
    // navigating away (e.g. "Gallery") from reappearing as active the
    // instant the guest returns to "/", before a fresh intersection reading
    // has arrived: by the time `isHome` is true again, this cleanup has
    // already cleared it.
    return () => {
      observer.disconnect();
      setActiveAnchor("");
    };
  }, [isHome]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) closeMenu();
      if (event.key !== "Tab" || !menuOpen) return;

      const menu = document.getElementById("mobile-menu");
      const focusable = menu?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = menuOpen ? "hidden" : "";
    if (menuOpen) window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 text-ivory">
      {/* Top of page: a barely-there scrim that only lifts contrast over the hero. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(30,24,21,0.26),rgba(30,24,21,0.1)_60%,transparent)] transition-opacity duration-500 ${
          showDarkSurface ? "opacity-0" : "opacity-100"
        }`}
      />
      {/* Scrolled: near-black translucent glass with a light blur and a hairline edge.
          The blur itself is desktop-only — on inner pages (contact/faq/policies/
          privacy/rooms/packages) this surface is permanently on, so backdrop-filter
          would otherwise recompute every scroll frame for the life of the page.
          The rest of the design system already drops backdrop-filter at this same
          1024px cutoff (see globals.css); this brings the header in line with it. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-[rgba(18,15,13,0.72)] shadow-[inset_0_-1px_0_rgba(244,238,229,0.09)] transition-opacity duration-500 ${
          showDarkSurface ? "opacity-100 lg:backdrop-blur-[12px]" : "opacity-0"
        }`}
      />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-[70] focus:bg-ivory focus:px-4 focus:py-3 focus:text-sm focus:text-ink"
      >
        Skip to content
      </a>

      <nav
        className={`relative grid grid-cols-[1fr_auto] items-center px-[var(--page-x)] pt-[env(safe-area-inset-top)] transition-[height] duration-500 ease-[var(--ease-luxury)] min-[1180px]:grid-cols-[1fr_auto_1fr] min-[1180px]:pt-0 ${
          showDarkSurface ? "h-[58px] min-[1180px]:h-[64px]" : "h-[68px] min-[1180px]:h-[80px]"
        }`}
      >
        <div className="hidden items-center justify-end gap-5 pr-7 min-[1180px]:flex">
          {leftNavItems.map((item) => (
            <Link
              href={hrefFor(item)}
              key={item}
              aria-current={isActive(item) ? "page" : undefined}
              className={`group relative py-4 text-[0.58rem] font-extrabold uppercase tracking-[0.2em] transition-colors hover:text-brass! ${
                isActive(item) ? "text-brass!" : "text-ivory/90!"
              }`}
            >
              <span
                className={`absolute bottom-2 left-1/2 h-px w-5 -translate-x-1/2 bg-brass transition-transform duration-500 ${
                  isActive(item) ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                }`}
              />
              {item}
            </Link>
          ))}
          <span className="h-px w-[clamp(2.5rem,6vw,6.5rem)] bg-[linear-gradient(90deg,transparent,rgba(176,138,81,0.62))]" />
        </div>

        <Link href="/" className="group justify-self-start min-[1180px]:justify-self-center" aria-label="Three Pyramids home">
          <span
            className={`grid grid-cols-[auto_1fr] items-center gap-2 leading-none transition-transform duration-500 ease-[var(--ease-luxury)] min-[1180px]:block min-[1180px]:justify-items-center ${
              showDarkSurface ? "min-[1180px]:scale-[0.88]" : ""
            }`}
          >
            <BrandMark className="h-5 w-10 text-brass transition-colors group-hover:text-ivory min-[1180px]:mx-auto min-[1180px]:h-7 min-[1180px]:w-14" />
            <span className="block text-left text-[0.58rem] font-black uppercase tracking-[0.2em] min-[1180px]:mt-1 min-[1180px]:text-center min-[1180px]:text-[0.62rem] min-[1180px]:tracking-[0.24em]">
              Three Pyramids
            </span>
            <span className="col-start-2 mt-0.5 hidden text-left text-[0.46rem] font-bold uppercase tracking-[0.22em] text-brass min-[1180px]:mt-1 min-[1180px]:block min-[1180px]:text-center min-[1180px]:text-[0.48rem] min-[1180px]:tracking-[0.24em]">
              Giza · Egypt
            </span>
          </span>
        </Link>

        <div className="hidden items-center justify-start gap-5 pl-7 min-[1180px]:flex">
          <span className="h-px w-[clamp(2.5rem,6vw,6.5rem)] bg-[linear-gradient(90deg,rgba(176,138,81,0.62),transparent)]" />
          {rightNavItems.map((item) => (
            <Link
              href={hrefFor(item)}
              key={item}
              aria-current={isActive(item) ? "page" : undefined}
              className={`group relative py-4 text-[0.58rem] font-extrabold uppercase tracking-[0.2em] transition-colors hover:text-brass! ${
                isActive(item) ? "text-brass!" : "text-ivory/90!"
              }`}
            >
              <span
                className={`absolute bottom-2 left-1/2 h-px w-5 -translate-x-1/2 bg-brass transition-transform duration-500 ${
                  isActive(item) ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                }`}
              />
              {item}
            </Link>
          ))}
          <Link href="/booking" className="reserve-plate ml-1">
            Reserve
          </Link>
        </div>

        <button
          ref={menuButtonRef}
          className="grid min-h-11 min-w-16 content-center justify-items-end gap-2 justify-self-end text-[0.58rem] font-black uppercase tracking-[0.18em] min-[1180px]:hidden"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
        >
          <span>Menu</span>
          <span className="block h-px w-8 bg-current" />
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            id="mobile-menu"
            className="fixed inset-0 z-[90] h-[100dvh] overflow-y-auto bg-[rgba(30,24,21,0.98)] px-[var(--page-x)] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-ivory min-[1180px]:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex min-h-full flex-col">
              <div className="grid grid-cols-[1fr_auto] items-start gap-5 border-b border-brass/24 pb-5">
                <div className="grid grid-cols-[auto_1fr] items-center gap-3 leading-none">
                  <BrandMark className="h-6 w-12 text-brass" />
                  <div>
                    <span className="block text-[0.68rem] font-black uppercase tracking-[0.22em]">
                      Three Pyramids
                    </span>
                    <span className="mt-1 block text-[0.52rem] font-bold uppercase tracking-[0.24em] text-brass">
                      Giza · Egypt
                    </span>
                  </div>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close menu"
                  className="grid min-h-11 min-w-11 place-items-center justify-self-end border border-ivory/12 px-3 text-[0.62rem] font-black uppercase tracking-[0.18em] text-ivory/72 transition-colors hover:text-brass"
                  onClick={closeMenu}
                >
                  Close
                </button>
              </div>

              <div className="grid flex-1 content-center py-8 sm:py-10">
                <p className="label mb-5 text-brass">Navigation</p>
                <div className="grid" aria-label="Mobile navigation links">
                  {navItems.map((item, index) => {
                    const selected = isActive(item);

                    return (
                      <motion.div
                        key={item}
                        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: reduceMotion ? 0 : 0.42,
                          delay: reduceMotion ? 0 : index * 0.035,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      >
                        <Link
                          href={hrefFor(item)}
                          aria-current={selected ? "page" : undefined}
                          className={`group grid min-h-14 grid-cols-[2.25rem_1fr] items-center border-b border-ivory/10 py-3 text-ivory transition-colors ${
                            selected ? "text-brass!" : "text-ivory/82! hover:text-brass!"
                          }`}
                          onClick={closeMenu}
                        >
                          <span className="text-[0.64rem] font-black tracking-[0.2em] text-brass/74">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="font-sans text-[clamp(1.45rem,7.2vw,2rem)] font-semibold uppercase leading-none tracking-[0.03em]">
                            {item}
                          </span>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-brass/24 pt-5">
                <Link href="/booking" className="reserve-plate min-h-11 w-full" onClick={closeMenu}>
                  Reserve your stay -&gt;
                </Link>
                <div className="mt-5 flex items-center justify-between gap-4 text-[0.58rem] font-black uppercase tracking-[0.2em] text-ivory/44">
                  <p>Giza · Egypt</p>
                  <p className="text-brass/78">Boutique stay</p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
