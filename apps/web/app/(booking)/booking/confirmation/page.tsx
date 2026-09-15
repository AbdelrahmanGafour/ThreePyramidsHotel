import { BookingConfirmation } from "@/features/booking/components/BookingConfirmation";
import { rooms } from "@/features/rooms/data/roomsData";

export default function BookingConfirmationPage() {
  return <BookingConfirmation rooms={rooms} />;
}
