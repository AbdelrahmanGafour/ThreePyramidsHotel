import { Breadcrumb } from "@/shared/components/ui/Breadcrumb";
import type { Room } from "@/features/rooms/data/roomsData";

export function RoomBreadcrumb({ room }: { room: Room }) {
  return <Breadcrumb parent={{ href: "/rooms", label: "All rooms" }} current={room.name} />;
}
