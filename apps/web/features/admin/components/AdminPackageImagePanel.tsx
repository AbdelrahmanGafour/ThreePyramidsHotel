import Image from "next/image";
import {
  deletePackageImageAction,
  replacePackageImageAction,
  updatePackageImageAltTextAction,
  uploadPackageImageAction,
} from "../server/adminPackageImageActions";
import type { AdminPackageImage } from "../types";
import { DetailSection } from "./AdminDetail";
import { ImageMutationButton, ImageMutationGroup } from "./AdminPackageImageMutation";
import { AdminFormField } from "./AdminFormField";

// The one image a journey may have.
//
// A server component rendering plain forms. The only client code involved is
// the submit buttons and the group that coordinates them: four controls act
// on the same single image, so while any one of them is running the others
// are disabled. That group holds the only client state on this panel — one
// string naming which control is busy — and it changes nothing about what is
// rendered: there is no optimistic update, the picture below is never
// cleared or swapped by it, and the browser never sends a request to the API
// itself. Every byte goes to a Server Action, which talks to Express.
// Nothing here knows about Cloudflare, R2, a bucket or an object key, and no
// storage host is ever contacted from a page.
//
// Exactly one image, so there is no gallery: no ordering, no cover, no
// counter. The panel is in one of two states, and which one it is in is a
// fact about the journey rather than about anything this component remembers.
//
// ---------------------------------------------------------------------------
// WHY UPLOAD AND REPLACE ARE DIFFERENT BUTTONS
//
// The API refuses `POST` when an image exists and `PUT` when none does, and
// this panel keeps that distinction rather than sending whichever seems
// right. A page rendered before somebody else uploaded a picture will send
// the upload, be refused with a clear conflict, and re-read the journey —
// which is exactly what should happen, and strictly better than silently
// overwriting work that arrived in between.
// ---------------------------------------------------------------------------

/** The three source types the API accepts, restated for the file picker only. */
const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

/**
 * The hint under every file picker here.
 *
 * States the accepted formats and the ceiling because an administrator
 * choosing a file benefits from knowing before they wait for an upload. It
 * is a hint, not a rule: no size or type is checked in this process, so this
 * text can never disagree with the API — the API refuses, and the refusal
 * becomes a notice on this page.
 */
const FILE_HINT =
  "JPEG, PNG, or WebP, up to 8 MiB. The image is resized and re-encoded automatically; it does not need to be pre-cropped.";

const ALT_TEXT_HINT =
  "Describes the picture for guests using a screen reader. Leave it blank if the image is purely decorative. Up to 240 characters.";

function UploadForm({ slug }: { slug: string }) {
  // Bound server-side to the slug this page rendered: the form posts no
  // journey address of its own.
  const upload = uploadPackageImageAction.bind(null, slug);

  return (
    <form className="adm-form" action={upload}>
      <AdminFormField id="journey-image-file" label="Image" hint={FILE_HINT}>
        <input
          id="journey-image-file"
          name="image"
          type="file"
          className="field-control"
          accept={ACCEPTED_TYPES}
          required
          aria-describedby="journey-image-file-hint"
        />
      </AdminFormField>

      <div className="adm-actions">
        {/* Disables itself while its own form is in flight, so an impatient
            second click cannot send a second upload. Nothing is queued and
            nothing is retried. */}
        <ImageMutationButton id="upload" tone="confirm" pendingLabel="Uploading…">
          Upload image
        </ImageMutationButton>
      </div>
    </form>
  );
}

function ReplaceForm({ slug }: { slug: string }) {
  const replace = replacePackageImageAction.bind(null, slug);

  return (
    <form className="adm-form" action={replace}>
      <AdminFormField id="journey-image-replacement" label="Replace image" hint={FILE_HINT}>
        <input
          id="journey-image-replacement"
          name="image"
          type="file"
          className="field-control"
          accept={ACCEPTED_TYPES}
          required
          aria-describedby="journey-image-replacement-hint"
        />
      </AdminFormField>

      <div className="adm-actions">
        <ImageMutationButton id="replace" tone="confirm" pendingLabel="Replacing…">
          Replace image
        </ImageMutationButton>
      </div>
    </form>
  );
}

function AltTextForm({ slug, image }: { slug: string; image: AdminPackageImage }) {
  const save = updatePackageImageAltTextAction.bind(null, slug);

  return (
    <form className="adm-form" action={save}>
      <AdminFormField id="journey-image-alt" label="Description" hint={ALT_TEXT_HINT}>
        <input
          id="journey-image-alt"
          name="altText"
          type="text"
          className="field-control"
          // What is stored, not what was last typed: the API trims the text
          // and turns anything empty into no description at all, so the
          // field always opens showing the value that actually exists.
          defaultValue={image.altText ?? ""}
          maxLength={240}
          aria-describedby="journey-image-alt-hint"
        />
      </AdminFormField>

      <div className="adm-actions">
        {/* An explicit save. Nothing is sent as the field is typed in. */}
        <ImageMutationButton id="alt-text" tone="confirm" pendingLabel="Saving…">
          Save description
        </ImageMutationButton>
      </div>
    </form>
  );
}

/**
 * Removing the picture, behind the project's existing disclosure.
 *
 * A plain `<details>`, not a modal and not `window.confirm`: it needs no
 * client state, no focus trap and no JavaScript, so it works before
 * hydration exactly as the journey and variant deletes already do. There is
 * no dialog framework here and this panel does not add one.
 */
function DeleteControl({ slug }: { slug: string }) {
  const remove = deletePackageImageAction.bind(null, slug);

  return (
    <details className="adm-confirm">
      <summary className="adm-ref-link">Delete image</summary>

      <p className="adm-sub">
        The picture is removed from this journey and from the website. The journey itself, its
        variants and its rates are unaffected, and a new image can be uploaded afterwards.
      </p>

      <form action={remove}>
        <ImageMutationButton id="delete" tone="cancel" pendingLabel="Deleting…">
          Delete this image
        </ImageMutationButton>
      </form>
    </details>
  );
}

/**
 * `image` comes from the journey the page already read. There is no second
 * request and no client-side fetch: when a mutation changes it, the Server
 * Action re-reads the journey and the page re-renders with what is stored.
 */
export function AdminPackageImagePanel({
  slug,
  image,
}: {
  slug: string;
  image: AdminPackageImage | null;
}) {
  if (image === null) {
    return (
      <DetailSection
        id="journey-detail-image"
        title="Image"
        note="This journey has no picture yet. One image is shown on the website's journey card and on its own page."
      >
        <ImageMutationGroup>
          <UploadForm slug={slug} />
        </ImageMutationGroup>
      </DetailSection>
    );
  }

  return (
    <DetailSection
      id="journey-detail-image"
      title="Image"
      note="The picture guests see for this journey. Replacing it keeps the description; deleting it leaves the journey with none."
    >
      {/* One group for all three: replacing, deleting and describing act on
          the same single image, so while any of them is running the other
          two are disabled. Nothing is queued — a second mutation from this
          page cannot be started, only attempted after the first finishes. */}
      <ImageMutationGroup>
        <div className="adm-journey-image">
          <div className="adm-journey-image-preview">
            {/* Served from the media origin `next.config.ts` already allows,
                using the URL the API composed. The old hardcoded slug-to-file
                map the public site still carries is deliberately not
                consulted here: this panel shows what is stored, nothing
                else — and nothing clears it while a mutation runs. */}
            <Image
              src={image.url}
              alt={image.altText ?? ""}
              width={image.width}
              height={image.height}
              sizes="(min-width: 720px) 320px, 100vw"
            />
          </div>

          <p className="adm-sub">
            {image.width}×{image.height}
          </p>
        </div>

        <AltTextForm slug={slug} image={image} />

        <ReplaceForm slug={slug} />

        <DeleteControl slug={slug} />
      </ImageMutationGroup>
    </DetailSection>
  );
}
