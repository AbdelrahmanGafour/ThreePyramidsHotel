import type { Ref } from "react";
import { demoAdministrator, demoToday } from "../data/adminDemoData";
import { formatLongDate } from "../lib/format";
import { AdminIcon } from "./AdminIcon";

type AdminTopBarProps = {
  sectionLabel: string;
  menuOpen: boolean;
  onMenuClick: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
};

export function AdminTopBar({ sectionLabel, menuOpen, onMenuClick, menuButtonRef }: AdminTopBarProps) {
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
        <p className="adm-topbar-date">{formatLongDate(demoToday)}</p>
        <a className="adm-topbar-link" href="/" target="_blank" rel="noopener noreferrer">
          View website
          <AdminIcon name="external" className="adm-icon-sm" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <div className="adm-identity">
          <span className="adm-identity-mark" aria-hidden="true">
            {demoAdministrator.initials}
          </span>
          <span className="adm-identity-text">
            <span className="adm-identity-name">{demoAdministrator.name}</span>
            <span className="adm-identity-role">{demoAdministrator.role}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
