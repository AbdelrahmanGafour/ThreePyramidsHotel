"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { uiEase } from "@/shared/components/motion/PremiumMotion";
import { socialLinks, type SocialLink } from "@/features/contact/data/contactData";

function MessageIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9.8L5 20.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path
        d="M7 20 4 21l1-3a8 8 0 1 1 2 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 9.3c0-.5.4-1.3.9-1.3s.9.1 1.1.6c.2.5.6 1.6.6 1.7.1.1.1.3 0 .5-.1.2-.2.3-.3.5s-.3.3-.1.6c.2.3.8 1.2 1.7 1.9 1.1.9 2 1.2 2.3 1.3.3.1.5.1.6-.1.2-.2.7-.8.9-1s.4-.2.6-.1c.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.9-.2 1.4-.3.5-1.5 1.2-2.5 1.2-.9 0-2.7-.4-4.7-2.2-2.4-2.1-3.9-4.4-4-4.9-.1-.5-.5-1.1-.2-2.1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessengerIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path
        d="M12 4c-4.7 0-8.5 3.4-8.5 7.8 0 2.5 1.2 4.7 3.2 6.2v3l2.9-1.6c.7.2 1.6.4 2.4.4 4.7 0 8.5-3.4 8.5-7.8S16.7 4 12 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m7.5 13 3-3.2L13 12l3.5-3.5-3.3 4.9-2.5-2.2-3.2 3.3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ContactOption = SocialLink & { key: "whatsapp" | "messenger"; Icon: ComponentType };

const options: ContactOption[] = [
  { key: "whatsapp", ...socialLinks.whatsapp, Icon: WhatsAppIcon },
  { key: "messenger", ...socialLinks.messenger, Icon: MessengerIcon },
];

// A restrained, brand-consistent way for a guest to reach the hotel directly
// — not a chatbot, not a support widget. Mounted once in the public
// marketing layout only, so it never appears in `/admin` or the focused
// booking checkout flow.
//
// The `lg:hidden` mobile booking bar on room detail pages (see
// `RoomMobileBookingBar`) occupies the bottom of the screen below the same
// `lg` breakpoint this launcher uses for its own offset — the two values
// below are chosen to always clear that bar rather than sit on top of it.
export function FloatingContact() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:px-6 lg:pb-6">
      <div className="pointer-events-auto relative">
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              id={panelId}
              role="group"
              aria-label="Contact the hotel"
              className="absolute bottom-[calc(100%+0.75rem)] right-0 w-[min(88vw,300px)] border border-ink/14 bg-ivory p-5 shadow-[0_20px_60px_rgba(30,24,21,0.22)]"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: uiEase }}
            >
              <p className="group-title">Need help?</p>
              <p className="fine-print mt-1.5">Contact our team directly for help with your stay.</p>

              <div className="mt-4 grid gap-2.5">
                {options.map(({ key, label, href, Icon }) =>
                  href ? (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inner-focus flex min-h-11 items-center gap-3 border border-ink/16 bg-[var(--panel-surface)] px-4 py-2.5 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-ink hover:text-ivory"
                    >
                      <Icon />
                      {label}
                    </a>
                  ) : (
                    <button
                      key={key}
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="flex min-h-11 cursor-not-allowed items-center gap-3 border border-ink/12 bg-[var(--panel-surface)] px-4 py-2.5 text-left text-[0.9375rem] font-semibold text-ink/55"
                    >
                      <Icon />
                      {label}
                      <span className="ml-auto text-[0.75rem] font-medium text-ink/40">Coming soon</span>
                    </button>
                  ),
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label="Contact the hotel"
          onClick={() => setOpen((value) => !value)}
          className="inner-focus flex h-14 min-w-14 items-center justify-center gap-2 border border-brass/70 bg-ink px-4 text-ivory shadow-[0_12px_32px_rgba(30,24,21,0.32)] transition-colors hover:border-brass hover:bg-espresso"
        >
          <MessageIcon />
          <span className="hidden text-[0.8125rem] font-semibold lg:inline">Contact the hotel</span>
        </button>
      </div>
    </div>
  );
}
