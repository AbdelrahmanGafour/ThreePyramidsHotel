import type { Metadata } from "next";
import { AdminShell } from "@/features/admin/components/AdminShell";
import "@/features/admin/admin.css";

export const metadata: Metadata = {
  title: {
    default: "Administration | Three Pyramids",
    template: "%s | Three Pyramids Administration",
  },
  description: "Hotel administration for Three Pyramids Boutique Hotel.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AdminShell>{children}</AdminShell>;
}
