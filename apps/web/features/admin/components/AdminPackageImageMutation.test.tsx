import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ImageMutationButton,
  ImageMutationGroup,
  isBlocked,
  nextBusy,
} from "./AdminPackageImageMutation";

// Coordinating the four controls that act on a journey's one image.
//
// The conflict matrix is asserted against the group's own state machine
// rather than against rendered markup: `useFormStatus` reports `pending:
// false` on a server render, so a test that only rendered could never see a
// blocked control and would pass whatever the coordination did. The two
// functions below are that machine, and the component is built from them.

/** The four controls, named as the panel names them. */
const UPLOAD = "upload";
const REPLACE = "replace";
const DELETE = "delete";
const ALT_TEXT = "alt-text";

/** Everything that acts on an image that already exists. */
const CONFLICTING = [REPLACE, DELETE, ALT_TEXT] as const;

describe("image mutation group: claiming and releasing", () => {
  it("is idle until something starts", () => {
    assert.equal(nextBusy(null, REPLACE, false), null);
    assert.equal(isBlocked(null, REPLACE), false);
    assert.equal(isBlocked(null, DELETE), false);
  });

  it("is claimed by whichever control starts", () => {
    for (const id of [UPLOAD, ...CONFLICTING]) {
      assert.equal(nextBusy(null, id, true), id);
    }
  });

  it("is released by the control that claimed it", () => {
    assert.equal(nextBusy(REPLACE, REPLACE, false), null);
  });

  it("is not released by a control that did not claim it", () => {
    // A late report from a control that already finished must not unlock the
    // group under the one still running.
    assert.equal(nextBusy(REPLACE, DELETE, false), REPLACE);
    assert.equal(nextBusy(REPLACE, ALT_TEXT, false), REPLACE);
  });

  it("returns to idle after the claim is released, so nothing stays stuck", () => {
    let busy: string | null = null;

    busy = nextBusy(busy, DELETE, true);
    assert.equal(busy, DELETE);

    busy = nextBusy(busy, DELETE, false);
    assert.equal(busy, null);

    // And the next mutation can start normally.
    assert.equal(isBlocked(busy, REPLACE), false);
  });
});

describe("image mutation group: the conflict matrix", () => {
  it("blocks every other control while one is pending", () => {
    for (const running of CONFLICTING) {
      const busy = nextBusy(null, running, true);

      for (const other of CONFLICTING) {
        if (other === running) continue;

        assert.equal(isBlocked(busy, other), true, `${running} pending must block ${other}`);
      }
    }
  });

  it("does not report the running control as blocked by itself", () => {
    // It disables itself through its own form status and shows its pending
    // wording; calling it blocked as well would make it claim two things.
    for (const running of CONFLICTING) {
      assert.equal(isBlocked(nextBusy(null, running, true), running), false);
    }
  });

  it("blocks delete and the description save while a replacement runs", () => {
    const busy = nextBusy(null, REPLACE, true);

    assert.equal(isBlocked(busy, DELETE), true);
    assert.equal(isBlocked(busy, ALT_TEXT), true);
  });

  it("blocks replace and the description save while a delete runs", () => {
    const busy = nextBusy(null, DELETE, true);

    assert.equal(isBlocked(busy, REPLACE), true);
    assert.equal(isBlocked(busy, ALT_TEXT), true);
  });

  it("blocks replace and delete while the description is saving", () => {
    const busy = nextBusy(null, ALT_TEXT, true);

    assert.equal(isBlocked(busy, REPLACE), true);
    assert.equal(isBlocked(busy, DELETE), true);
  });

  it("keeps the only control of the empty state from being sent twice", () => {
    // One control, so there is nothing to block — the duplicate it must
    // prevent is its own, which its form status already disables. The group
    // is still claimed so the state machine reads the same either way.
    const busy = nextBusy(null, UPLOAD, true);

    assert.equal(busy, UPLOAD);
    assert.equal(isBlocked(busy, UPLOAD), false, "disabled by its own pending, not by the group");
  });
});

describe("image mutation group: what it renders", () => {
  const renderGroup = () =>
    renderToStaticMarkup(
      <ImageMutationGroup>
        <form>
          <ImageMutationButton id={REPLACE} tone="confirm" pendingLabel="Replacing…">
            Replace image
          </ImageMutationButton>
        </form>
        <form>
          <ImageMutationButton id={DELETE} tone="cancel" pendingLabel="Deleting…">
            Delete this image
          </ImageMutationButton>
        </form>
      </ImageMutationGroup>,
    );

  it("renders enabled submits in the admin's own button shape", () => {
    const html = renderGroup();

    assert.equal((html.match(/<button/g) ?? []).length, 2);
    assert.match(html, /type="submit" class="adm-action-btn" data-tone="confirm"/);
    assert.match(html, /type="submit" class="adm-action-btn" data-tone="cancel"/);
    assert.ok(!html.includes("disabled"), "nothing is disabled before anything starts");
  });

  it("shows each control's own words, never a pending label, when idle", () => {
    const html = renderGroup();

    assert.match(html, /Replace image/);
    assert.match(html, /Delete this image/);
    assert.ok(!html.includes("Replacing…"));
    assert.ok(!html.includes("Deleting…"));
  });

  it("adds no wrapper of its own around the controls", () => {
    // A provider and nothing else: the panel's own layout is untouched.
    const html = renderToStaticMarkup(
      <ImageMutationGroup>
        <p>only child</p>
      </ImageMutationGroup>,
    );

    assert.equal(html, "<p>only child</p>");
  });

  it("works outside a group, coordinating with nothing", () => {
    // A missing provider must not throw and must not leave a control
    // permanently disabled.
    const html = renderToStaticMarkup(
      <form>
        <ImageMutationButton id={REPLACE} tone="confirm" pendingLabel="Replacing…">
          Replace image
        </ImageMutationButton>
      </form>,
    );

    assert.match(html, /Replace image/);
    assert.ok(!html.includes("disabled"));
  });
});

describe("image mutation group: what it is not", () => {
  const source = readFileSync("features/admin/components/AdminPackageImageMutation.tsx", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("moves no request into the browser", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "axios", "/api/", "r2.cloudflarestorage", "amazonaws", "S3"]) {
      assert.ok(!code.includes(forbidden), `${forbidden} must not appear in a client component`);
    }
  });

  it("retries nothing and queues nothing", () => {
    for (const forbidden of ["retry", "setTimeout", "setInterval", "queue", "requestSubmit", ".submit("]) {
      assert.ok(!code.includes(forbidden), `${forbidden} would act on the administrator's behalf`);
    }
  });

  it("is a local island rather than a store", () => {
    // Scoped to whatever subtree the panel wraps. Nothing outside it can
    // read this state, and nothing outside it is coordinated by it.
    assert.match(code, /createContext/);
    for (const forbidden of ["zustand", "redux", "globalThis", "window.", "localStorage"]) {
      assert.ok(!code.includes(forbidden), `${forbidden} would put this state outside the panel`);
    }

    // One piece of state, and it is a name rather than a copy of anything.
    assert.equal((code.match(/useState[<(]/g) ?? []).length, 1, "one piece of state");
    assert.match(code, /useState<string \| null>\(null\)/);
  });

  it("holds nothing about the image itself, so it can clear no picture", () => {
    // It coordinates buttons. It never learns what the picture is, which is
    // why no pending mutation can blank or swap the preview: there is
    // nothing here to render optimistically from.
    for (const forbidden of ["altText", "reference", "width", "height", "src", "useOptimistic"]) {
      assert.ok(!code.includes(forbidden), `${forbidden} is not this component's business`);
    }

    // The only markup it owns is the button; everything else it is handed.
    assert.match(code, /<button/);
    for (const tag of ["div", "form", "img", "Image", "p", "span", "details"]) {
      assert.ok(
        !new RegExp(`<${tag}[\\s/>]`).test(code),
        `<${tag}> belongs to the panel, not to the coordinator`,
      );
    }
  });
});
