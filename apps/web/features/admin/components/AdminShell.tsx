"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminNavigation } from "../data/adminNavigation";
import type { AdminAccount } from "../types";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopBar } from "./AdminTopBar";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DESKTOP = "(min-width: 1024px)";

// `administrator` arrives from the protected layout, which got it from the API.
// The shell only displays it; it is never fetched or stored on the client.
export function AdminShell({
  administrator,
  children,
}: {
  administrator: AdminAccount;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const section =
    adminNavigation.find((item) => (item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href))) ??
    adminNavigation[0];

  const closeMenu = useCallback(() => {
    setOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  // Drawer behaviour: focus in, Escape out, Tab kept inside, page scroll locked.
  useEffect(() => {
    if (!open) return;
    const sidebar = shellRef.current?.querySelector<HTMLElement>("#admin-sidebar");
    sidebar?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const items = Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [open, closeMenu]);

  // The sidebar is persistent at desktop width, so an open drawer means nothing there.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="adm" ref={shellRef}>
      <a className="adm-skip" href="#admin-main">
        Skip to main content
      </a>
      <AdminSidebar open={open} onNavigate={() => setOpen(false)} onClose={closeMenu} />
      <div className="adm-scrim" data-open={open} onClick={closeMenu} aria-hidden="true" />
      <div className="adm-frame">
        <AdminTopBar
          administrator={administrator}
          sectionLabel={section.label}
          menuOpen={open}
          onMenuClick={() => setOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main id="admin-main" className="adm-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
