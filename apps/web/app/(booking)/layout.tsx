import type { Metadata } from "next";
import { BookingShell } from "@/features/booking/components/BookingShell";

export const metadata: Metadata = {
  title: "Reserve your stay | Three Pyramids Boutique Hotel",
  description: "Reserve a room at Three Pyramids Boutique Hotel in Giza.",
};

export default function BookingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <BookingShell>{children}</BookingShell>;
}
