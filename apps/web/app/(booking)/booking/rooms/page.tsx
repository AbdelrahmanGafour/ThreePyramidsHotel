import { RoomSelection } from "@/features/booking/components/RoomSelection";
import { rooms } from "@/features/rooms/data/roomsData";

export default function BookingRoomsPage() {
  return <RoomSelection rooms={rooms} />;
}
