"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/shared/components/ui/BrandMark";
import { isAdminNavItemActive, sidebarNavigation } from "../data/adminNavigation";
import type { AdminNavItem } from "../types";
import { AdminIcon } from "./AdminIcon";

type AdminSidebarProps = {
  open: boolean;
  onNavigate: () => void;
  onClose: () => void;
};

function NavEntry({
  item,
  pathname,
  onNavigate,
}: {
  item: AdminNavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  if (!item.available) {
    return (
      <li>
        <span className="adm-nav-item" data-state="unavailable" aria-disabled="true">
          <AdminIcon name={item.key} />
          <span className="adm-nav-label">{item.label}</span>
          <span className="adm-nav-soon">
            <span className="sr-only">, coming soon</span>
            <span aria-hidden="true">Soon</span>
          </span>
        </span>
      </li>
    );
  }

  const active = isAdminNavItemActive(pathname, item);
  return (
    <li>
      <Link
        href={item.href}
        className="adm-nav-item"
        data-state={active ? "active" : "idle"}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        <AdminIcon name={item.key} />
        <span className="adm-nav-label">{item.label}</span>
      </Link>
    </li>
  );
}

export function AdminSidebar({ open, onNavigate, onClose }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      id="admin-sidebar"
      className="adm-sidebar"
      data-open={open}
      // Only a dialog while it is the mobile drawer (open implies < desktop width).
      {...(open ? { role: "dialog", "aria-modal": true, "aria-label": "Administration menu" } : {})}
    >
      <div className="adm-brand">
        <BrandMark className="adm-brand-mark" />
        <div className="adm-brand-text">
          <p className="adm-brand-name">Three Pyramids</p>
          <p className="adm-brand-sub">Hotel Administration</p>
        </div>
        <button type="button" className="adm-drawer-close" onClick={onClose}>
          <AdminIcon name="close" />
          <span className="sr-only">Close menu</span>
        </button>
      </div>

      <nav className="adm-nav" aria-label="Administration">
        <ul>
          {sidebarNavigation.map((item) => (
            <NavEntry key={item.key} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>

      {/* The last entry, and the only one that leaves the admin. It stays an
          ordinary anchor rather than a nav item: it opens a new tab and has
          no active state to hold. */}
      <div className="adm-sidebar-foot">
        <ul>
          <li>
            <a className="adm-nav-item" href="/" target="_blank" rel="noopener noreferrer">
              <AdminIcon name="external" />
              <span className="adm-nav-label">View Website</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </div>
    </aside>
  );
}
