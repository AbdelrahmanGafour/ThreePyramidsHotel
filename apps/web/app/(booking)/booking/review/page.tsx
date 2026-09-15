import { BookingSummary } from "@/features/booking/components/BookingSummary";
import { rooms } from "@/features/rooms/data/roomsData";

export default function BookingReviewPage() {
  return <BookingSummary rooms={rooms} />;
}
