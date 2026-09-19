import type { Metadata } from "next";
import { LatestInquiries } from "@/features/admin/components/LatestInquiries";
import { ManagementAreas } from "@/features/admin/components/ManagementAreas";
import { OverviewMetrics } from "@/features/admin/components/OverviewMetrics";
import { RoomStatusPanel } from "@/features/admin/components/RoomStatusPanel";
import { TodaysStays } from "@/features/admin/components/TodaysStays";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <>
      <header className="adm-page-head">
        <h1 className="adm-page-title">Overview</h1>
        <p className="adm-page-lede">A clear view of today’s stays, availability and guest requests.</p>
        <p className="adm-demo-note">
          <span className="adm-status-mark" data-shape="ring" aria-hidden="true" />
          Showing demo data. Live figures appear once the hotel’s systems are connected.
        </p>
      </header>

      <OverviewMetrics />

      <div className="adm-grid">
        <TodaysStays />
        <RoomStatusPanel />
        <LatestInquiries />
        <ManagementAreas />
      </div>
    </>
  );
}
