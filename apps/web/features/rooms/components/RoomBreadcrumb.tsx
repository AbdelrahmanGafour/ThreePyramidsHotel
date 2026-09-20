import { Breadcrumb } from "@/shared/components/ui/Breadcrumb";
import type { RoomWithPresentation } from "@/features/rooms/api";

export function RoomBreadcrumb({ room }: { room: RoomWithPresentation }) {
  return <Breadcrumb parent={{ href: "/rooms", label: "All rooms" }} current={room.name} />;
}
