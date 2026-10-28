/**
 * One image of a room type, as a guest is allowed to see it.
 *
 * Five fields, and deliberately no more. The database id, the media asset id,
 * `storage_key`, `checksum_sha256`, `content_type`, `sort_order`, the
 * timestamps, and anything naming a bucket or a storage provider are all
 * absent: none of them helps a browser display an image, and the object key
 * and digest in particular are internal facts about how the bytes are stored.
 *
 * `url` is composed when this is built, never read from a column — no URL is
 * stored anywhere in the schema. `width` and `height` are the stored object's
 * own dimensions, so a page can reserve the right space without downloading
 * the image first. `altText` is nullable because a decorative image is a real
 * case. `isCover` is the room's single representative image, a role the
 * database enforces with a partial unique index.
 *
 * `sortOrder` is intentionally omitted even though it decides the sequence:
 * the array is already in that sequence, so exposing the number would invite
 * a second, redundant sort by a consumer.
 */
export type PublicRoomTypeImage = {
  url: string;
  altText: string | null;
  width: number;
  height: number;
  isCover: boolean;
};

/**
 * Guest-facing room type shape. Internal columns (id, is_active, sort_order,
 * timestamps) and physical rooms are deliberately not part of this contract.
 *
 * MySQL numeric values stay strings so no precision is lost on the way out.
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
  /**
   * Cover first, then the administrator's arrangement. Always present, always
   * an array: a room type with no images returns `[]`, never null and never a
   * missing key, so a consumer never has to distinguish "no images" from
   * "this response predates images".
   */
  images: PublicRoomTypeImage[];
};

/**
 * One image as the repository reads it: identity, not address.
 *
 * The difference from `PublicRoomTypeImage` is `reference` in place of `url`.
 * Composing a URL needs the deployment's public media base, which is
 * configuration the repository has no business reading — so the repository
 * reports which image it is, and the controller says where it lives. That
 * split is what lets a room type with no images be served without the media
 * base being configured at all.
 */
export type PublicRoomTypeImageRecord = {
  reference: string;
  altText: string | null;
  width: number;
  height: number;
  isCover: boolean;
};

/** A room type as the repository reads it, with images still unaddressed. */
export type RoomTypeRecord = Omit<RoomTypeResponse, 'images'> & {
  images: PublicRoomTypeImageRecord[];
};
