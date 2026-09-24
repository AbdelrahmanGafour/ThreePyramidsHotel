import Image from "next/image";
import { toEditingOrder } from "../lib/roomTypeImages";
import type { StatusMeta } from "../lib/status";
import {
  deleteAdminRoomTypeImageAction,
  moveAdminRoomTypeImageAction,
  setAdminRoomTypeImageCoverAction,
  updateAdminRoomTypeImageAltTextAction,
  uploadAdminRoomTypeImageAction,
} from "../server/adminRoomTypeImageActions";
import type { AdminRoomTypeImage } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

// A room type's gallery: upload, alt text, cover, order and delete.
//
// A server component throughout, exactly like the physical-rooms panel beside
// it. The only client code is the shared submit button, which disables itself
// while its own form is in flight. There is no client state, no client fetch,
// no upload preview and no drag/drop: the browser posts a native `<input
// type="file">` straight to the Server Action, which reads it, converts it,
// and sends the result to the API.
//
// Every identifier — the room type's slug, an image's reference, a move
// direction — is bound on the server. Binding is not a security boundary:
// Next serialises bound arguments into the form's own payload, so a caller
// can still alter them, and each action treats every one as untrusted input.
//
// The rows are rendered in `toEditingOrder`, never the API's own list order,
// specifically because that order is cover-first while Move Up / Move Down
// are defined against `sortOrder` alone. See `lib/roomTypeImages.ts`.

const COVER_BADGE: StatusMeta = { label: "Cover", tone: "brass", shape: "filled" };
const MAX_IMAGES = 12;

/**
 * `null` means the gallery could not be read, which is not the same fact as
 * an empty one. A room type with no images yet is a real and expected state;
 * a failed read is not, and must never be shown as one — nor may it disable
 * the rest of the room-type page, which reads and writes independently.
 */
export function AdminRoomTypeImagesPanel({
  slug,
  images,
}: {
  slug: string;
  images: AdminRoomTypeImage[] | null;
}) {
  const upload = uploadAdminRoomTypeImageAction.bind(null, slug);
  const editingOrder = images === null ? null : toEditingOrder(images);

  return (
    <section className="adm-panel" aria-labelledby="room-type-images">
      <PanelHeader
        id="room-type-images"
        title="Images"
        note={`Up to ${MAX_IMAGES} images per room type. Upload a JPEG, PNG, or WebP file — the system normalizes every image before it is shown to guests.`}
      />

      <form className="adm-form" action={upload}>
        <AdminFormField
          id="room-type-image-upload"
          label="Add an image"
          hint="JPEG, PNG, or WebP, up to 8 MiB. The image is resized and re-encoded automatically; it does not need to be pre-cropped."
        >
          <input
            id="room-type-image-upload"
            name="image"
            type="file"
            className="field-control"
            accept="image/jpeg,image/png,image/webp"
            required
            aria-describedby="room-type-image-upload-hint"
          />
        </AdminFormField>

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Uploading…">
            Upload image
          </AdminActionButton>
        </div>
      </form>

      {editingOrder === null ? (
        <p className="adm-detail-note">
          {/* Deliberately not "no images yet": nothing is known about this
              room type's gallery, and an empty list would be a different
              claim. */}
          The list of images could not be loaded just now. The room type details above are
          unaffected. Reload the page in a moment; if it keeps failing, contact the hotel’s system
          administrator.
        </p>
      ) : editingOrder.length === 0 ? (
        <p className="adm-detail-note">
          <span className="adm-detail-empty">No images have been added yet.</span>
        </p>
      ) : (
        <ul className="adm-images">
          {editingOrder.map((image, index) => (
            <RoomTypeImageRow
              key={image.reference}
              slug={slug}
              image={image}
              position={index + 1}
              total={editingOrder.length}
              isFirst={index === 0}
              isLast={index === editingOrder.length - 1}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RoomTypeImageRow({
  slug,
  image,
  position,
  total,
  isFirst,
  isLast,
}: {
  slug: string;
  image: AdminRoomTypeImage;
  position: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  const updateAltText = updateAdminRoomTypeImageAltTextAction.bind(null, slug, image.reference);
  const setCover = setAdminRoomTypeImageCoverAction.bind(null, slug, image.reference);
  const moveUp = moveAdminRoomTypeImageAction.bind(null, slug, image.reference, "up");
  const moveDown = moveAdminRoomTypeImageAction.bind(null, slug, image.reference, "down");
  const deleteImage = deleteAdminRoomTypeImageAction.bind(null, slug, image.reference);

  // For the element id only, so each row's alt-text field and hint have a
  // unique id; the reference itself is never shown as text on the page.
  const altFieldId = `room-type-image-alt-${image.reference}`;

  return (
    <li>
      <div className="adm-image-thumb">
        <Image
          src={image.url}
          alt={image.altText ?? ""}
          width={image.width}
          height={image.height}
          sizes="(min-width: 640px) 160px, 100vw"
        />
      </div>

      <div className="adm-image-body">
        <div className="adm-list-top">
          {image.isCover ? <StatusBadge meta={COVER_BADGE} /> : <span />}
          <span className="adm-sub">
            Position {position} of {total} · {image.width}×{image.height}
          </span>
        </div>

        <form className="adm-form" action={updateAltText}>
          <AdminFormField
            id={altFieldId}
            label="Alt text"
            hint="Describes the image for guests using a screen reader. Leave blank if the image is purely decorative."
          >
            <input
              id={altFieldId}
              name="altText"
              type="text"
              className="field-control"
              defaultValue={image.altText ?? ""}
              maxLength={240}
              aria-describedby={`${altFieldId}-hint`}
            />
          </AdminFormField>

          <div className="adm-actions">
            <AdminActionButton tone="confirm" pendingLabel="Saving…">
              Save alt text
            </AdminActionButton>
          </div>
        </form>

        <div className="adm-actions">
          {image.isCover ? null : (
            <form action={setCover}>
              <AdminActionButton tone="confirm" pendingLabel="Setting…">
                Set as cover
              </AdminActionButton>
            </form>
          )}

          {isFirst ? null : (
            <form action={moveUp}>
              <AdminActionButton tone="confirm" pendingLabel="Moving…">
                Move up
              </AdminActionButton>
            </form>
          )}

          {isLast ? null : (
            <form action={moveDown}>
              <AdminActionButton tone="confirm" pendingLabel="Moving…">
                Move down
              </AdminActionButton>
            </form>
          )}

          <form action={deleteImage}>
            <AdminActionButton tone="cancel" pendingLabel="Deleting…">
              Delete
            </AdminActionButton>
          </form>
        </div>
      </div>
    </li>
  );
}
