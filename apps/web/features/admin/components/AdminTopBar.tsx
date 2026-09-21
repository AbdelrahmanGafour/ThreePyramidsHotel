import type { Ref } from "react";
import { demoToday } from "../data/adminDemoData";
import { formatLongDate, initialsFromName } from "../lib/format";
import type { AdminAccount } from "../types";
import { AdminIcon } from "./AdminIcon";
import { AdminLogoutButton } from "./AdminLogoutButton";

type AdminTopBarProps = {
  /** The real signed-in administrator, from the protected layout's session check. */
  administrator: AdminAccount;
  sectionLabel: string;
  menuOpen: boolean;
  onMenuClick: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
};

export function AdminTopBar({
  administrator,
  sectionLabel,
  menuOpen,
  onMenuClick,
  menuButtonRef,
}: AdminTopBarProps) {
  const initials = initialsFromName(administrator.displayName);

  return (
    <header className="adm-topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="adm-menu-btn"
        aria-expanded={menuOpen}
        aria-controls="admin-sidebar"
        onClick={onMenuClick}
      >
        <AdminIcon name="menu" />
        <span>Menu</span>
      </button>

      <nav className="adm-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>Administration</li>
          <li aria-current="page">{sectionLabel}</li>
        </ol>
      </nav>

      <div className="adm-topbar-tools">
        {/* The date is still demo data; the identity beside it is not. */}
        <p className="adm-topbar-date">{formatLongDate(demoToday)}</p>
        <a className="adm-topbar-link" href="/" target="_blank" rel="noopener noreferrer">
          View website
          <AdminIcon name="external" className="adm-icon-sm" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <div className="adm-identity">
          <span className="adm-identity-mark" aria-hidden="true">
            {initials}
          </span>
          <span className="adm-identity-text">
            <span className="sr-only">Signed in as </span>
            <span className="adm-identity-name">{administrator.displayName}</span>
            <span className="adm-identity-role">{administrator.email}</span>
          </span>
        </div>
      </div>

      {/* Outside `adm-topbar-tools` on purpose: those hide below desktop, and
          signing out must be reachable at every width. */}
      <AdminLogoutButton />
    </header>
  );
}
