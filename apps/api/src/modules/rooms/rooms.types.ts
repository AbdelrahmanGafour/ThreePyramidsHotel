/**
 * Guest-facing room type shape. Internal columns (id, is_active, sort_order,
 * timestamps) and physical rooms are deliberately not part of this contract.
 *
 * PostgreSQL numeric values stay strings so no precision is lost on the way out.
 */
export type RoomTypeResponse = {
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  bedType: string | null;
  bedCount: number | null;
  sizeSqm: string | null;
  view: string | null;
  baseNightlyRate: string;
  currency: 'EGP';
};
