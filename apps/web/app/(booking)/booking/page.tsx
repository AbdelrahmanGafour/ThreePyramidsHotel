import { Suspense } from "react";
import { StaySearchForm } from "@/features/booking/components/StaySearchForm";

export default function BookingStayPage() {
  return (
    <Suspense fallback={null}>
      <StaySearchForm />
    </Suspense>
  );
}
