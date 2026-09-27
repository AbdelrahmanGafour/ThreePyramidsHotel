import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The journey image panel, inspected rather than rendered.
//
// It binds four Server Actions, each of which imports `next/headers` and
// loads only under the react-server condition, while the submit button
// inside it is a Client Component that cannot. The same pincer every admin
// write screen hits — so what is asserted here is the structure, and the
// pieces that genuinely decide something are rendered and tested elsewhere:
// the outcome planner in `lib/packageImageOutcomes.test.ts` and the request
// shape in `server/adminPackageImagesApi.test.ts`.

const panel = readFileSync("features/admin/components/AdminPackageImagePanel.tsx", "utf8");

/**
 * The same source with its comments removed.
 *
 * Used for every "this must not appear" scan. The prose in these files
 * explains what the code deliberately does NOT do — it names
 * `window.confirm`, a bucket and an object key precisely to say they are
 * absent — so scanning the comments would fail on the explanation rather
 * than on the behaviour.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const detail = readFileSync("features/admin/components/AdminPackageDetail.tsx", "utf8");
const page = readFileSync("app/(dashboard)/admin/journeys/[slug]/page.tsx", "utf8");
const actions = readFileSync("features/admin/server/adminPackageImageActions.ts", "utf8");

/** The branch of the panel that runs when the journey has no image. */
// Newline-agnostic: this checkout carries CRLF, so a literal \n run pins the
// bytes a checkout happened to write rather than the branch this slice is
// about. `search` finds the populated branch's own opening — the empty one
// above it opens with a different note — and an unmatched boundary would
// return -1 here exactly as `indexOf` did.
const emptyState = panel.slice(
  panel.indexOf("if (image === null)"),
  panel.search(
    /return \(\s*<DetailSection\s*id="journey-detail-image"\s*title="Image"\s*note="The picture/,
  ),
);

/** The branch that runs when it has one. */
const populated = panel.slice(panel.indexOf('note="The picture guests see'));

describe("journey image panel: the empty state", () => {
  it("offers one file picker and says which formats are accepted", () => {
    assert.match(emptyState, /<UploadForm slug=\{slug\} \/>/);
    assert.match(panel, /JPEG, PNG, or WebP/);
    assert.match(panel, /accept=\{ACCEPTED_TYPES\}/);
    assert.match(panel, /const ACCEPTED_TYPES = "image\/jpeg,image\/png,image\/webp"/);
  });

  it("says plainly that there is no picture yet", () => {
    assert.match(emptyState, /has no picture yet/);
  });

  it("offers no replace, delete or description control", () => {
    for (const absent of ["ReplaceForm", "DeleteControl", "AltTextForm"]) {
      assert.ok(!emptyState.includes(absent), `${absent} belongs to the populated state`);
    }
  });
});

describe("journey image panel: with an image", () => {
  it("renders the picture from the URL the API composed", () => {
    assert.match(populated, /<Image\s+src=\{image\.url\}/);
    assert.match(populated, /alt=\{image\.altText \?\? ""\}/);
    assert.match(populated, /width=\{image\.width\}/);
    assert.match(populated, /height=\{image\.height\}/);
  });

  it("shows the stored dimensions", () => {
    assert.match(populated, /\{image\.width\}×\{image\.height\}/);
  });

  it("offers replace, delete and a description editor", () => {
    assert.match(populated, /<AltTextForm slug=\{slug\} image=\{image\} \/>/);
    assert.match(populated, /<ReplaceForm slug=\{slug\} \/>/);
    assert.match(populated, /<DeleteControl slug=\{slug\} \/>/);
  });

  it("never falls back to the website's hardcoded image map", () => {
    // The admin shows API truth only. The public site still carries that
    // map; this panel must not consult it.
    const code = codeOnly(panel);
    assert.ok(!code.includes("packageMedia"));
    assert.ok(!code.includes("getPackageMedia"));
    assert.ok(!code.includes("/images/placeholders/"));
  });

  it("keeps the current picture on screen while a replacement is in flight", () => {
    // Nothing clears it: the preview renders from `image`, which only
    // changes when the server re-reads the journey after a committed write.
    // There is no client state that could blank it optimistically.
    const code = codeOnly(panel);
    assert.ok(!code.includes("useState"));
    assert.ok(!code.includes("useOptimistic"));
    assert.ok(!code.includes('"use client"'));
  });
});

describe("journey image panel: the four actions", () => {
  it("binds each action to the slug the server rendered", () => {
    for (const action of [
      "uploadPackageImageAction",
      "replacePackageImageAction",
      "updatePackageImageAltTextAction",
      "deletePackageImageAction",
    ]) {
      assert.match(panel, new RegExp(`${action}\\.bind\\(null, slug\\)`), action);
    }
  });

  it("keeps upload and replace as separate actions rather than guessing", () => {
    // The API refuses POST when an image exists and PUT when none does.
    // Choosing between them here is what turns a stale page into a clear
    // conflict instead of a silent overwrite.
    assert.match(actions, /uploadAdminPackageImage\(slug, parsed\.value, cookie\)/);
    assert.match(actions, /replaceAdminPackageImage\(slug, parsed\.value, cookie\)/);
  });

  it("disables every submit while its own form is in flight", () => {
    // A second click cannot send a second request, and nothing is queued.
    const buttons = panel.match(/<ImageMutationButton/g) ?? [];

    assert.equal(buttons.length, 4, "upload, description, replace, delete");
    for (const label of ["Uploading…", "Saving…", "Replacing…", "Deleting…"]) {
      assert.ok(panel.includes(`pendingLabel="${label}"`), label);
    }
  });

  it("gives each control its own name, so one can never release another", () => {
    const ids = [...panel.matchAll(/<ImageMutationButton id="([^"]+)"/g)].map((m) => m[1]);

    assert.deepEqual(ids.sort(), ["alt-text", "delete", "replace", "upload"]);
    assert.equal(new Set(ids).size, ids.length, "no two controls share a name");
  });

  it("uses no button that coordinates with nothing", () => {
    // `AdminActionButton` knows only about its own form. Every control here
    // acts on the same single image, so none of them may use it.
    assert.ok(!panel.includes("AdminActionButton"), "the uncoordinated button has no place here");
  });
});

describe("journey image panel: one mutation at a time", () => {
  it("puts the three controls that conflict in a single group", () => {
    // Replacing, deleting and describing all act on the same one image, so
    // while any of them is running the other two must be disabled. They can
    // only see each other if one group wraps all three.
    const group = populated.slice(
      populated.indexOf("<ImageMutationGroup>"),
      populated.indexOf("</ImageMutationGroup>"),
    );

    for (const control of ["<AltTextForm", "<ReplaceForm", "<DeleteControl"]) {
      assert.ok(group.includes(control), `${control} must sit inside the group`);
    }
  });

  it("wraps the upload too, so it cannot be sent twice", () => {
    const group = emptyState.slice(
      emptyState.indexOf("<ImageMutationGroup>"),
      emptyState.indexOf("</ImageMutationGroup>"),
    );

    assert.ok(group.includes("<UploadForm"));
  });

  it("opens exactly one group in each state", () => {
    // Two groups would be two locks, and a control in one would not see a
    // control in the other.
    for (const [name, state] of [["empty", emptyState], ["populated", populated]] as const) {
      assert.equal(
        (state.match(/<ImageMutationGroup>/g) ?? []).length,
        1,
        `the ${name} state should hold one group`,
      );
      assert.equal((state.match(/<\/ImageMutationGroup>/g) ?? []).length, 1);
    }
  });

  it("leaves every control on its own form and its own action", () => {
    // Coordination disables buttons; it does not merge the four mutations
    // into one submission, and it re-points none of them.
    assert.equal((panel.match(/<form/g) ?? []).length, 4);
    for (const action of ["action={upload}", "action={replace}", "action={save}", "action={remove}"]) {
      assert.ok(panel.includes(action), action);
    }
  });

  it("keeps the picture inside the group without making it depend on it", () => {
    // The preview is wrapped only because the group wraps the whole panel
    // body. Nothing about what it renders is conditional on the lock, so a
    // pending replace or delete cannot clear it.
    const code = codeOnly(populated);
    const preview = code.slice(
      code.indexOf('<div className="adm-journey-image">'),
      code.indexOf("<AltTextForm"),
    );

    assert.match(preview, /<Image\s+src=\{image\.url\}/);
    for (const conditional of ["busy", "pending", "isBlocked", "&&", "? ("]) {
      assert.ok(
        !preview.includes(conditional),
        `${conditional} would let a running mutation change the picture`,
      );
    }
  });

  it("queues nothing and retries nothing from the page", () => {
    const code = codeOnly(panel);

    for (const forbidden of ["setTimeout", "setInterval", "requestSubmit", ".submit(", "retry", "queue"]) {
      assert.ok(!code.includes(forbidden), `${forbidden} would act without being asked`);
    }
  });

  it("keeps the page a server component, with the island only around the controls", () => {
    // The coordinator is the only client code involved, and it is imported
    // by the panel rather than declared by the page.
    assert.ok(!codeOnly(panel).includes('"use client"'), "the panel stays a server component");
    assert.ok(!codeOnly(page).includes('"use client"'), "and so does the journey page");
    assert.match(panel, /import \{ ImageMutationButton, ImageMutationGroup \} from "\.\/AdminPackageImageMutation";/);
    assert.ok(
      !page.includes("ImageMutationGroup"),
      "the page composes the panel; the group is the panel's own business",
    );
  });

  it("puts the delete behind the project's existing disclosure", () => {
    // A plain <details>, matching the journey and variant deletes. No
    // window.confirm and no dialog framework.
    assert.match(panel, /<details className="adm-confirm">/);
    assert.match(panel, /<summary className="adm-ref-link">Delete image<\/summary>/);
    assert.match(panel, /tone="cancel"/);
    assert.ok(!codeOnly(panel).includes("window.confirm"));
    assert.ok(!codeOnly(panel).includes("alert("));
  });

  it("saves the description explicitly, never as it is typed", () => {
    assert.match(panel, /Save description/);
    for (const live of ["onChange", "onInput", "onBlur", "useEffect"]) {
      assert.ok(!codeOnly(panel).includes(live), `${live} would send on keystrokes`);
    }
  });

  it("opens the description field on what is stored, capped at 240", () => {
    assert.match(panel, /defaultValue=\{image\.altText \?\? ""\}/);
    assert.match(panel, /maxLength=\{240\}/);
  });

  it("neither generates a description nor borrows the journey title", () => {
    assert.ok(!codeOnly(panel).includes("journey.title"));
    assert.ok(!codeOnly(panel).includes("title ??"));
  });
});

describe("journey image panel: where it sits", () => {
  it("is composed at the page and passed into the detail view", () => {
    // The same arrangement `actions` uses, and for the same reason: the
    // panel binds Server Actions the view cannot load.
    assert.match(page, /<AdminPackageImagePanel slug=\{data\.slug\} image=\{data\.image\} \/>/);
    assert.match(page, /imagePanel=\{<AdminPackageImagePanel/);
    assert.match(detail, /imagePanel\?: React\.ReactNode;/);
  });

  it("renders above the journey's own details", () => {
    const panelAt = detail.indexOf("{imagePanel}");
    const detailsAt = detail.indexOf('id="journey-detail-details"');

    assert.ok(panelAt > 0 && panelAt < detailsAt, "the picture comes before the fields");
  });

  it("shows its notices through the planner's own closed map", () => {
    assert.match(page, /parsePackageImageNotice/);
    assert.match(page, /PACKAGE_IMAGE_NOTICES\[token\]/);
    assert.match(page, /<ImageNotice notice=\{image\} \/>/);
  });

  it("leaves every other journey notice and control alone", () => {
    for (const existing of [
      "<StatusNotice notice={statusAction} />",
      "<DefaultVariantNotice notice={defaultVariant} />",
      "<VariantOrderNotice notice={variantOrder} />",
      "<VariantDeleteNotice notice={variantDelete} />",
      "<ContentNotice notice={content} />",
      "<ItineraryNotice notice={itinerary} />",
      "<PackageDeleteNotice notice={packageDelete} />",
      "<AdminPackageDeleteAction journey={data} />",
    ]) {
      assert.ok(page.includes(existing), `${existing} must remain`);
    }
  });
});

describe("journey image panel: what it never does", () => {
  it("contacts no storage host from the browser", () => {
    for (const source of [panel, actions]) {
      for (const forbidden of ["r2.cloudflarestorage", "cloudflare", "amazonaws", "S3Client", "fetch("]) {
        assert.ok(!codeOnly(source).includes(forbidden), `${forbidden} must not appear`);
      }
    }
  });

  it("mentions no storage key, bucket, checksum or asset id", () => {
    for (const leaked of [
      "storage_key",
      "storageKey",
      "bucket",
      "checksum",
      "media_asset",
      "mediaAssetId",
      "contentType",
      "byteSize",
    ]) {
      assert.ok(!codeOnly(panel).includes(leaked), `${leaked} must not reach the UI`);
    }
  });

  it("does not show the reference as text, though the type carries it", () => {
    // `reference` is how the media endpoints address an image; it is not
    // something to put in front of an administrator.
    assert.ok(!codeOnly(panel).includes("image.reference"));
  });

  it("checks no size or type locally, leaving the API authoritative", () => {
    // Deliberate, and the same decision the room-type upload action made: a
    // second ceiling in this process is a second ceiling that can drift.
    // The hint text says 8 MiB; no code here enforces it.
    for (const source of [codeOnly(panel), codeOnly(actions)]) {
      assert.ok(!/8\s*\*\s*1024/.test(source));
      assert.ok(!source.includes("MAX_SOURCE_BYTES"));
      assert.ok(!/\.size\s*>/.test(source));
    }
  });

  it("retries nothing on the administrator's behalf", () => {
    const code = codeOnly(actions);
    assert.ok(!code.includes("retry"));
    assert.ok(!/for\s*\(|while\s*\(/.test(code), "no loop around a request");
  });
});
