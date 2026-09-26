import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACKAGES_PATH,
  packageChildPricingLabel,
  packageDetailHref,
  OverlappingRateRowsError,
  RATES_REQUIRED_MESSAGE,
  hasChildPricing,
  packageAllowsEmptyRates,
  packageAllowsVariantCreate,
  packageDefaultVariantAction,
  DEFAULT_BLOCKS_DELETE_NOTE,
  PACKAGE_DELETE_BLOCKED_NOTE,
  packageDeleteBrochureAdvisory,
  packageDeleteConfirmation,
  packageDeleteState,
  TooManyContentEntriesError,
  TooManyItinerarySectionsError,
  packageItineraryHref,
  packageItineraryOwnershipWarning,
  packageItineraryRowCount,
  parsePackageItineraryForm,
  packageContentHref,
  packageContentMatches,
  packageContentOwnershipWarning,
  packageContentRowCount,
  parsePackageContentForm,
  packageVariantDeleteConfirmation,
  packageVariantDeleteOwnershipWarning,
  packageVariantDeleteState,
  packageVariantMove,
  packageVariantMoves,
  packageVariantOrderNote,
  packageVariantOrderOwnershipWarning,
  packageDefaultVariantNote,
  packageDefaultVariantOwnershipWarning,
  packageVariantCreateOwnershipWarning,
  packageVariantDefaultNote,
  packageVariantNewHref,
  VARIANT_CREATE_BLOCKED_MESSAGE,
  packageEditHref,
  packageOwnershipWarning,
  packageRatesHref,
  packageRatesOwnershipWarning,
  packageVariantEditHref,
  packageVariantOwnershipWarning,
  packagePartySizeLabel,
  packageRateLabel,
  InvalidPackageSubmissionError,
  packageStatusAction,
  packageStatusNote,
  parsePackageCreateForm,
  parsePackageEditForm,
  parsePackageRatesForm,
  parsePackageVariantCreateForm,
  parsePackageVariantEditForm,
  packageVariantsLabel,
  packageVariantsRateSummary,
} from "./packages";
import type { AdminPackageRateTier, AdminPackageVariant } from "../types";

const tier = (overrides: Partial<AdminPackageRateTier> = {}): AdminPackageRateTier => ({
  minPartySize: 1,
  maxPartySize: 1,
  adultUnitRate: "100.00",
  currency: "USD",
  ...overrides,
});

const variant = (overrides: Partial<AdminPackageVariant> = {}): AdminPackageVariant => ({
  key: "standard",
  label: "Standard",
  isDefault: true,
  sortOrder: 1,
  childMinAge: null,
  childMaxAge: null,
  childDiscountPercent: null,
  rates: [],
  ...overrides,
});

describe("package catalogue labels", () => {
  it("encodes the detail href into one path segment", () => {
    assert.equal(packageDetailHref("nile-dinner-cruise"), "/admin/journeys/nile-dinner-cruise");
    assert.equal(packageDetailHref("a/b?c#d"), "/admin/journeys/a%2Fb%3Fc%23d");
  });

  it("counts variants in words", () => {
    assert.equal(packageVariantsLabel(0), "No variants");
    assert.equal(packageVariantsLabel(1), "1 variant");
    assert.equal(packageVariantsLabel(3), "3 variants");
  });

  it("describes every shape of party-size range", () => {
    assert.equal(packagePartySizeLabel(tier({ minPartySize: 1, maxPartySize: 1 })), "1 person");
    assert.equal(packagePartySizeLabel(tier({ minPartySize: 2, maxPartySize: 2 })), "2 people");
    assert.equal(packagePartySizeLabel(tier({ minPartySize: 2, maxPartySize: 4 })), "2–4 people");
    // The brochure's open-ended tier, never given an invented ceiling.
    assert.equal(packagePartySizeLabel(tier({ minPartySize: 3, maxPartySize: null })), "3 or more");
  });

  it("prices a tier from the stored string alone", () => {
    assert.equal(packageRateLabel(tier({ adultUnitRate: "100.00" })), "USD 100.00 per adult");
    assert.equal(packageRateLabel(tier({ adultUnitRate: "1234.5" })), "USD 1,234.50 per adult");
  });

  it("states a child rule only when all three fields are set", () => {
    assert.equal(
      packageChildPricingLabel(
        variant({ childMinAge: 6, childMaxAge: 12, childDiscountPercent: "50.00" }),
      ),
      "Ages 6–12 at 50.00% off",
    );
    assert.equal(packageChildPricingLabel(variant()), "No child pricing");
    // A partial rule cannot exist in the database, and is never half-rendered.
    assert.equal(packageChildPricingLabel(variant({ childMinAge: 6 })), "No child pricing");
  });
});

describe("packageStatusAction", () => {
  it("offers only Deactivate for an active journey", () => {
    const action = packageStatusAction(true);

    assert.equal(action.label, "Deactivate journey");
    assert.equal(action.target, false, "the target is what it becomes, not what it is");
    assert.equal(action.tone, "cancel");
    assert.equal(action.pendingLabel, "Deactivating…");
  });

  it("offers only Activate for an inactive journey", () => {
    const action = packageStatusAction(false);

    assert.equal(action.label, "Activate journey");
    assert.equal(action.target, true);
    assert.equal(action.tone, "confirm");
    assert.equal(action.pendingLabel, "Activating…");
  });

  it("always targets the opposite of where the journey stands", () => {
    for (const isActive of [true, false]) {
      assert.equal(packageStatusAction(isActive).target, !isActive, "never a no-op");
    }
  });

  it("explains what each change does, and mentions nothing it does not do", () => {
    for (const isActive of [true, false]) {
      const note = packageStatusNote(isActive);
      assert.ok(note.length > 0);
      for (const forbidden of [/delete/i, /remove/i, /refund/i, /payment/i, /charge/i,
        /reservation/i, /booking/i]) {
        assert.ok(!forbidden.test(note), `${note} must not imply something this does not do`);
      }
    }
    assert.match(packageStatusNote(true), /stays in the catalogue/);
  });

  it("names the catalogue route once", () => {
    assert.equal(PACKAGES_PATH, "/admin/journeys");
    assert.ok(packageDetailHref("x").startsWith(PACKAGES_PATH));
  });
});

/** Builds a FormData the way the create form submits one. */
function createForm(overrides: Record<string, string | string[] | null> = {}): FormData {
  const base: Record<string, string | string[] | null> = {
    code: "ADMIN-001",
    slug: "a-new-journey",
    title: "A New Journey",
    summary: "Something the hotel put together.",
    description: "A longer passage.",
    durationLabel: "Half day",
    scheduleLabel: "On request",
    operatingDays: ["monday", "wednesday"],
    sortOrder: "0",
    ...overrides,
  };

  const form = new FormData();

  for (const [name, value] of Object.entries(base)) {
    if (value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) form.append(name, entry);
    } else {
      form.set(name, value);
    }
  }

  return form;
}

describe("parsePackageCreateForm", () => {
  it("builds exactly the API's create shape", () => {
    const input = parsePackageCreateForm(createForm());

    assert.deepEqual(Object.keys(input).sort(), [
      "code",
      "description",
      "durationLabel",
      "operatingDays",
      "requiresPriceConfirmation",
      "scheduleLabel",
      "slug",
      "sortOrder",
      "summary",
      "title",
    ]);
  });

  it("turns an empty optional box into null, never an empty string", () => {
    const input = parsePackageCreateForm(createForm({
      summary: "", description: "   ", durationLabel: "", scheduleLabel: "  ",
    }));

    assert.equal(input.summary, null);
    assert.equal(input.description, null, "a box of spaces is an empty box");
    assert.equal(input.durationLabel, null);
    assert.equal(input.scheduleLabel, null);
  });

  it("serializes selected weekdays in canonical order", () => {
    // Submitted out of order; the same selection must always serialize the same.
    const input = parsePackageCreateForm(createForm({
      operatingDays: ["friday", "monday", "wednesday"],
    }));

    assert.deepEqual(input.operatingDays, ["monday", "wednesday", "friday"]);
  });

  it("sends null rather than an empty array when no day is ticked", () => {
    const input = parsePackageCreateForm(createForm({ operatingDays: null }));

    assert.equal(input.operatingDays, null, "the API refuses an empty array");
  });

  it("de-duplicates a repeated weekday", () => {
    const input = parsePackageCreateForm(createForm({
      operatingDays: ["monday", "monday", "tuesday"],
    }));

    assert.deepEqual(input.operatingDays, ["monday", "tuesday"]);
  });

  it("refuses a weekday the API would not accept", () => {
    assert.throws(
      () => parsePackageCreateForm(createForm({ operatingDays: ["funday"] })),
      InvalidPackageSubmissionError,
    );
  });

  it("reads an unticked confirmation box as false", () => {
    assert.equal(parsePackageCreateForm(createForm()).requiresPriceConfirmation, false);

    const ticked = createForm();
    ticked.set("requiresPriceConfirmation", "yes");
    assert.equal(parsePackageCreateForm(ticked).requiresPriceConfirmation, true);
  });

  it("submits the code and slug exactly as typed, never trimmed", () => {
    // The API refuses surrounding whitespace rather than repairing it, and this
    // form must not disagree: an identity cannot be changed afterwards.
    const input = parsePackageCreateForm(createForm({ code: " ADMIN-001 ", slug: "a-new-journey" }));

    assert.equal(input.code, " ADMIN-001 ", "the API decides, not the form");
  });

  it("trims prose, which the API also requires trimmed", () => {
    const input = parsePackageCreateForm(createForm({ title: "  A New Journey  " }));

    assert.equal(input.title, "A New Journey");
  });

  it("treats an empty position as the default of zero", () => {
    assert.equal(parsePackageCreateForm(createForm({ sortOrder: "" })).sortOrder, 0);
    assert.equal(parsePackageCreateForm(createForm({ sortOrder: "12" })).sortOrder, 12);
  });

  it("refuses a position that is not a non-negative whole number", () => {
    for (const sortOrder of ["-1", "1.5", "abc", "1e3", "0x10"]) {
      assert.throws(
        () => parsePackageCreateForm(createForm({ sortOrder })),
        InvalidPackageSubmissionError,
        `${sortOrder} should be refused`,
      );
    }
  });

  it("refuses a missing or empty required field", () => {
    for (const field of ["code", "slug", "title"]) {
      assert.throws(
        () => parsePackageCreateForm(createForm({ [field]: null })),
        InvalidPackageSubmissionError,
        `a form without ${field} should be refused`,
      );
      assert.throws(
        () => parsePackageCreateForm(createForm({ [field]: "" })),
        InvalidPackageSubmissionError,
      );
    }
  });

  it("reads nothing about publication or ownership, however the form is crafted", () => {
    const crafted = createForm();
    crafted.set("isActive", "true");
    crafted.set("seedManaged", "true");
    crafted.set("managementSource", "brochure");

    const input = parsePackageCreateForm(crafted) as Record<string, unknown>;

    assert.equal(input.isActive, undefined);
    assert.equal(input.seedManaged, undefined);
    assert.equal(input.managementSource, undefined);
  });
});

/** Builds a FormData the way the edit form submits one. */
function editForm(overrides: Record<string, string | string[] | null> = {}): FormData {
  const base: Record<string, string | string[] | null> = {
    title: "A Renamed Journey",
    summary: "A new summary.",
    description: "A new description.",
    durationLabel: "Full day",
    scheduleLabel: "Weekends",
    operatingDays: ["saturday", "sunday"],
    sortOrder: "5",
    ...overrides,
  };

  const form = new FormData();

  for (const [name, value] of Object.entries(base)) {
    if (value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) form.append(name, entry);
    } else {
      form.set(name, value);
    }
  }

  return form;
}

describe("parsePackageEditForm", () => {
  it("builds exactly the API's eight-field edit shape", () => {
    const input = parsePackageEditForm(editForm());

    assert.deepEqual(Object.keys(input).sort(), [
      "description",
      "durationLabel",
      "operatingDays",
      "requiresPriceConfirmation",
      "scheduleLabel",
      "sortOrder",
      "summary",
      "title",
    ]);
  });

  it("never reads the journey's identity, however the form is crafted", () => {
    const crafted = editForm();
    crafted.set("code", "NEW-CODE");
    crafted.set("slug", "a-new-address");
    crafted.set("isActive", "true");
    crafted.set("seedManaged", "true");
    crafted.set("managementSource", "brochure");
    crafted.set("variants", "[]");

    const input = parsePackageEditForm(crafted) as Record<string, unknown>;

    for (const forbidden of ["code", "slug", "isActive", "seedManaged", "managementSource", "variants"]) {
      assert.equal(input[forbidden], undefined, `${forbidden} must never be submitted`);
    }
  });

  it("turns a cleared optional box into null, never an empty string", () => {
    const input = parsePackageEditForm(editForm({
      summary: "", description: "   ", durationLabel: "", scheduleLabel: "  ",
    }));

    assert.equal(input.summary, null);
    assert.equal(input.description, null);
    assert.equal(input.durationLabel, null);
    assert.equal(input.scheduleLabel, null);
  });

  it("sends null when every weekday is unticked", () => {
    assert.equal(parsePackageEditForm(editForm({ operatingDays: null })).operatingDays, null);
  });

  it("serializes weekdays in canonical order, de-duplicated", () => {
    const input = parsePackageEditForm(editForm({
      operatingDays: ["sunday", "monday", "sunday"],
    }));

    assert.deepEqual(input.operatingDays, ["monday", "sunday"]);
  });

  it("applies the same rules the create form uses", () => {
    for (const overrides of [
      { title: "" },
      { title: null },
      { operatingDays: ["funday"] },
      { sortOrder: "-1" },
      { sortOrder: "1.5" },
      { sortOrder: "abc" },
    ] as Array<Record<string, string | string[] | null>>) {
      assert.throws(
        () => parsePackageEditForm(editForm(overrides)),
        InvalidPackageSubmissionError,
        `${JSON.stringify(overrides)} should be refused`,
      );
    }
  });

  it("reads an unticked confirmation box as false", () => {
    assert.equal(parsePackageEditForm(editForm()).requiresPriceConfirmation, false);

    const ticked = editForm();
    ticked.set("requiresPriceConfirmation", "yes");
    assert.equal(parsePackageEditForm(ticked).requiresPriceConfirmation, true);
  });
});

describe("packageOwnershipWarning", () => {
  it("warns before the first edit to a brochure-owned journey", () => {
    const warning = packageOwnershipWarning("brochure");

    assert.ok(warning);
    assert.match(warning, /admin-managed/);
    assert.match(warning, /no longer reconcile or overwrite/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(packageOwnershipWarning("admin"), null);
  });

  it("offers no resync action, because none exists", () => {
    const warning = packageOwnershipWarning("brochure")!;

    for (const forbidden of [/resync/i, /restore/i, /revert/i, /undo it/i]) {
      assert.ok(!forbidden.test(warning), "the warning must not imply an action that does not exist");
    }
  });
});

describe("packageEditHref", () => {
  it("addresses the edit route beneath the journey", () => {
    assert.equal(packageEditHref("nile-dinner-cruise"), "/admin/journeys/nile-dinner-cruise/edit");
    assert.equal(packageEditHref("a/b?c"), "/admin/journeys/a%2Fb%3Fc/edit");
  });
});

/** Builds a FormData the way the variant edit form submits one. */
function variantForm(overrides: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    label: "Premium service",
    childPricingEnabled: "yes",
    childMinAge: "6",
    childMaxAge: "12",
    childDiscountPercent: "50.00",
    ...overrides,
  };

  const form = new FormData();

  for (const [name, value] of Object.entries(base)) {
    if (value === null) continue;
    form.set(name, value);
  }

  return form;
}

describe("parsePackageVariantEditForm", () => {
  it("builds exactly the API's four-field shape", () => {
    const input = parsePackageVariantEditForm(variantForm());

    assert.deepEqual(Object.keys(input).sort(), [
      "childDiscountPercent",
      "childMaxAge",
      "childMinAge",
      "label",
    ]);
  });

  it("sends three nulls when child pricing is unticked", () => {
    // The age and discount boxes still carry values; they must be ignored, so
    // a rule left behind from a previous edit cannot leak through.
    const input = parsePackageVariantEditForm(variantForm({ childPricingEnabled: null }));

    assert.equal(input.childMinAge, null);
    assert.equal(input.childMaxAge, null);
    assert.equal(input.childDiscountPercent, null);
    assert.equal(input.label, "Premium service", "the label is still saved");
  });

  it("requires all three values when child pricing is ticked", () => {
    for (const missing of ["childMinAge", "childMaxAge", "childDiscountPercent"]) {
      assert.throws(
        () => parsePackageVariantEditForm(variantForm({ [missing]: "" })),
        InvalidPackageSubmissionError,
        `${missing} should be required when the rule is on`,
      );
      assert.throws(
        () => parsePackageVariantEditForm(variantForm({ [missing]: null })),
        InvalidPackageSubmissionError,
      );
    }
  });

  it("refuses an oldest age below the youngest", () => {
    assert.throws(
      () => parsePackageVariantEditForm(variantForm({ childMinAge: "12", childMaxAge: "6" })),
      InvalidPackageSubmissionError,
    );
  });

  it("normalises the discount by padding text, never through a float", () => {
    assert.equal(parsePackageVariantEditForm(variantForm({ childDiscountPercent: "50" }))
      .childDiscountPercent, "50.00");
    assert.equal(parsePackageVariantEditForm(variantForm({ childDiscountPercent: "50.5" }))
      .childDiscountPercent, "50.50");
    assert.equal(parsePackageVariantEditForm(variantForm({ childDiscountPercent: "33.33" }))
      .childDiscountPercent, "33.33");
    // 0.1 + 0.2 territory: the value survives exactly as written.
    assert.equal(parsePackageVariantEditForm(variantForm({ childDiscountPercent: "0.30" }))
      .childDiscountPercent, "0.30");
  });

  it("accepts the bounds and refuses anything outside them", () => {
    for (const valid of ["0", "0.00", "100", "100.00"]) {
      assert.doesNotThrow(() =>
        parsePackageVariantEditForm(variantForm({ childDiscountPercent: valid })));
    }

    // Surrounding whitespace is padding on a numeric box, not a different
    // value — unlike a code or an address, a discount is not an identity, so
    // it is trimmed rather than refused.
    assert.equal(
      parsePackageVariantEditForm(variantForm({ childDiscountPercent: " 50 " }))
        .childDiscountPercent,
      "50.00",
    );

    for (const invalid of ["100.01", "101", "-1", "50.555", "fifty", "1e2"]) {
      assert.throws(
        () => parsePackageVariantEditForm(variantForm({ childDiscountPercent: invalid })),
        InvalidPackageSubmissionError,
        `${invalid} should be refused`,
      );
    }
  });

  it("refuses an age that is not a whole non-negative number", () => {
    for (const age of ["-1", "1.5", "six", "1e3"]) {
      assert.throws(
        () => parsePackageVariantEditForm(variantForm({ childMinAge: age })),
        InvalidPackageSubmissionError,
      );
    }
  });

  it("requires a label", () => {
    for (const label of ["", "   ", null]) {
      assert.throws(
        () => parsePackageVariantEditForm(variantForm({ label })),
        InvalidPackageSubmissionError,
      );
    }
  });

  it("never reads the variant's identity or anything it does not own", () => {
    const crafted = variantForm();
    crafted.set("key", "renamed");
    crafted.set("slug", "another-journey");
    crafted.set("isDefault", "true");
    crafted.set("sortOrder", "2");
    crafted.set("rates", "[]");

    const input = parsePackageVariantEditForm(crafted) as Record<string, unknown>;

    for (const forbidden of ["key", "slug", "isDefault", "sortOrder", "rates"]) {
      assert.equal(input[forbidden], undefined, `${forbidden} must never be submitted`);
    }
  });
});

describe("hasChildPricing", () => {
  it("is true only when all three fields are set", () => {
    assert.equal(hasChildPricing({
      childMinAge: 6, childMaxAge: 12, childDiscountPercent: "50.00",
    }), true);
    assert.equal(hasChildPricing({
      childMinAge: null, childMaxAge: null, childDiscountPercent: null,
    }), false);
    assert.equal(hasChildPricing({
      childMinAge: 6, childMaxAge: null, childDiscountPercent: null,
    }), false);
  });
});

describe("packageVariantOwnershipWarning", () => {
  it("warns that saving moves the whole journey, not just the variant", () => {
    const warning = packageVariantOwnershipWarning("brochure");

    assert.ok(warning);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /no longer reconcile or overwrite/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(packageVariantOwnershipWarning("admin"), null);
  });

  it("offers no revert, because none exists", () => {
    const warning = packageVariantOwnershipWarning("brochure")!;

    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

describe("packageVariantEditHref", () => {
  it("addresses the variant beneath its journey", () => {
    assert.equal(
      packageVariantEditHref("nile-dinner-cruise", "standard-service"),
      "/admin/journeys/nile-dinner-cruise/variants/standard-service/edit",
    );
    assert.equal(
      packageVariantEditHref("a/b", "c?d"),
      "/admin/journeys/a%2Fb/variants/c%3Fd/edit",
    );
  });
});

/** Builds the parallel-array FormData the rate editor submits. */
function ratesForm(rows: Array<[string, string, string]>): FormData {
  const form = new FormData();

  for (const [min, max, rate] of rows) {
    form.append("minPartySize", min);
    form.append("maxPartySize", max);
    form.append("adultUnitRate", rate);
  }

  return form;
}

describe("parsePackageRatesForm", () => {
  it("builds tiers carrying only the three API fields", () => {
    const [tier] = parsePackageRatesForm(ratesForm([["1", "2", "100.00"]]));

    assert.deepEqual(Object.keys(tier!).sort(), [
      "adultUnitRate",
      "maxPartySize",
      "minPartySize",
    ]);
    assert.equal((tier as Record<string, unknown>).currency, undefined, "currency is never sent");
  });

  it("reads a blank largest party as an open-ended tier", () => {
    const [tier] = parsePackageRatesForm(ratesForm([["3", "", "80.00"]]));

    assert.equal(tier!.maxPartySize, null);
  });

  it("skips entirely empty rows, which are unused or cleared slots", () => {
    const rates = parsePackageRatesForm(ratesForm([
      ["1", "2", "100.00"],
      ["", "", ""],
      ["3", "", "80.00"],
      ["", "", ""],
    ]));

    assert.equal(rates.length, 2, "blank slots are not tiers");
  });

  it("refuses a half-filled row rather than guessing", () => {
    for (const row of [["1", "2", ""], ["", "2", "100.00"], ["", "", "100.00"]] as Array<[string, string, string]>) {
      assert.throws(
        () => parsePackageRatesForm(ratesForm([row])),
        InvalidPackageSubmissionError,
        `${JSON.stringify(row)} should be refused`,
      );
    }
  });

  it("serializes deterministically by smallest party", () => {
    const rates = parsePackageRatesForm(ratesForm([
      ["3", "", "80.00"],
      ["1", "1", "100.00"],
      ["2", "2", "90.00"],
    ]));

    assert.deepEqual(rates.map((tier) => tier.minPartySize), [1, 2, 3]);
  });

  it("keeps money as an exact string, padded by text and never by a float", () => {
    const rates = parsePackageRatesForm(ratesForm([
      ["1", "1", "80"],
      ["2", "2", "90.5"],
      ["3", "", "0.30"],
    ]));

    assert.deepEqual(rates.map((tier) => tier.adultUnitRate), ["80.00", "90.50", "0.30"]);
    for (const tier of rates) {
      assert.equal(typeof tier.adultUnitRate, "string");
    }
  });

  it("refuses a rate that is not a plain decimal amount", () => {
    for (const rate of ["-1.00", "1.005", "1e3", "abc", "", " ", "10000000000.00"]) {
      assert.throws(
        () => parsePackageRatesForm(ratesForm([["1", "", rate]])),
        InvalidPackageSubmissionError,
        `${rate} should be refused`,
      );
    }
  });

  it("refuses a party size that is not a whole number above zero", () => {
    for (const min of ["0", "-1", "1.5", "one"]) {
      assert.throws(
        () => parsePackageRatesForm(ratesForm([[min, "", "10.00"]])),
        InvalidPackageSubmissionError,
      );
    }
  });

  it("refuses a largest party below the smallest", () => {
    assert.throws(
      () => parsePackageRatesForm(ratesForm([["5", "2", "10.00"]])),
      InvalidPackageSubmissionError,
    );
  });

  it("rejects overlapping rows before they reach the API", () => {
    const overlapping: Array<Array<[string, string, string]>> = [
      [["1", "2", "10.00"], ["2", "3", "9.00"]],
      [["1", "1", "10.00"], ["1", "2", "9.00"]],
      [["1", "", "10.00"], ["5", "", "9.00"]],
      [["1", "10", "10.00"], ["3", "4", "9.00"]],
    ];

    for (const rows of overlapping) {
      assert.throws(
        () => parsePackageRatesForm(ratesForm(rows)),
        OverlappingRateRowsError,
        `${JSON.stringify(rows)} should be refused`,
      );
    }
  });

  it("accepts adjacent and gapped tiers, which do not overlap", () => {
    assert.doesNotThrow(() => parsePackageRatesForm(ratesForm([
      ["1", "1", "100.00"], ["2", "2", "90.00"], ["3", "", "80.00"],
    ])));
    assert.doesNotThrow(() => parsePackageRatesForm(ratesForm([
      ["1", "1", "100.00"], ["5", "", "80.00"],
    ])));
  });

  it("returns an empty set when every row is blank", () => {
    assert.deepEqual(parsePackageRatesForm(ratesForm([["", "", ""], ["", "", ""]])), []);
  });

  it("refuses arrays of mismatched length", () => {
    const form = new FormData();
    form.append("minPartySize", "1");
    form.append("maxPartySize", "2");

    assert.throws(() => parsePackageRatesForm(form), InvalidPackageSubmissionError);
  });
});

describe("packageAllowsEmptyRates", () => {
  it("allows an empty set for an inactive journey", () => {
    assert.equal(
      packageAllowsEmptyRates({ isActive: false, requiresPriceConfirmation: false }),
      true,
    );
  });

  it("allows an empty set for a journey quoted on request", () => {
    assert.equal(
      packageAllowsEmptyRates({ isActive: true, requiresPriceConfirmation: true }),
      true,
    );
  });

  it("blocks an empty set for an active deterministically-priced journey", () => {
    assert.equal(
      packageAllowsEmptyRates({ isActive: true, requiresPriceConfirmation: false }),
      false,
    );
  });

  it("explains the rule without offering to deactivate anything", () => {
    assert.match(RATES_REQUIRED_MESSAGE, /must keep at least one/);
    assert.match(RATES_REQUIRED_MESSAGE, /Deactivate it, or mark it quoted on request/);
  });
});

describe("packageRatesOwnershipWarning", () => {
  it("warns that saving rates moves the whole journey", () => {
    const warning = packageRatesOwnershipWarning("brochure");

    assert.ok(warning);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(packageRatesOwnershipWarning("admin"), null);
  });

  it("offers no revert, because none exists", () => {
    const warning = packageRatesOwnershipWarning("brochure")!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

describe("packageRatesHref", () => {
  it("addresses the rates editor beneath its variant", () => {
    assert.equal(
      packageRatesHref("nile-dinner-cruise", "standard"),
      "/admin/journeys/nile-dinner-cruise/variants/standard/rates",
    );
    assert.equal(packageRatesHref("a/b", "c?d"), "/admin/journeys/a%2Fb/variants/c%3Fd/rates");
  });
});

/** Builds the FormData the new-variant form submits. */
function variantCreateForm(overrides: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    key: "premium-service",
    label: "Premium service",
    childPricingEnabled: "yes",
    childMinAge: "6",
    childMaxAge: "12",
    childDiscountPercent: "33.33",
    ...overrides,
  };

  const form = new FormData();

  for (const [name, value] of Object.entries(base)) {
    if (value === null) continue;
    form.set(name, value);
  }

  return form;
}

describe("parsePackageVariantCreateForm", () => {
  it("builds exactly the API's create shape", () => {
    const input = parsePackageVariantCreateForm(variantCreateForm());

    assert.deepEqual(Object.keys(input).sort(), [
      "childDiscountPercent",
      "childMaxAge",
      "childMinAge",
      "key",
      "label",
    ]);
  });

  it("reads no server-owned field, even when one is submitted", () => {
    const form = variantCreateForm();
    form.set("isDefault", "true");
    form.set("sortOrder", "0");
    form.set("rates", "[]");
    form.set("isActive", "true");
    form.set("seedManaged", "false");

    const input = parsePackageVariantCreateForm(form) as Record<string, unknown>;

    for (const field of ["isDefault", "sortOrder", "rates", "isActive", "seedManaged"]) {
      assert.equal(input[field], undefined, `${field} must never be forwarded`);
    }
  });

  it("submits the key exactly as typed, never repaired", () => {
    // The API refuses an untrimmed key rather than fixing it, and this form
    // must not disagree: a variant created under a key nobody typed cannot be
    // renamed afterwards.
    for (const key of [" premium-service", "premium-service ", "Premium-Service"]) {
      const input = parsePackageVariantCreateForm(variantCreateForm({ key }));
      assert.equal(input.key, key, `${JSON.stringify(key)} should travel verbatim`);
    }
  });

  it("refuses an empty key rather than sending one", () => {
    assert.throws(
      () => parsePackageVariantCreateForm(variantCreateForm({ key: "" })),
      InvalidPackageSubmissionError,
    );
  });

  it("refuses a key longer than the column holds", () => {
    assert.throws(
      () => parsePackageVariantCreateForm(variantCreateForm({ key: "a".repeat(121) })),
      InvalidPackageSubmissionError,
    );
    assert.doesNotThrow(
      () => parsePackageVariantCreateForm(variantCreateForm({ key: "a".repeat(120) })),
    );
  });

  it("sends three nulls when the child rate is not ticked", () => {
    // The three boxes are not read at all, so a half-filled rule left in the
    // form cannot leak through.
    const input = parsePackageVariantCreateForm(variantCreateForm({
      childPricingEnabled: null,
      childMinAge: "6",
      childMaxAge: "",
      childDiscountPercent: "nonsense",
    }));

    assert.equal(input.childMinAge, null);
    assert.equal(input.childMaxAge, null);
    assert.equal(input.childDiscountPercent, null);
  });

  it("requires all three when the child rate is ticked", () => {
    const cases: Array<Record<string, string | null>> = [
      { childMinAge: "" },
      { childMaxAge: "" },
      { childDiscountPercent: "" },
      { childMinAge: "", childMaxAge: "", childDiscountPercent: "" },
    ];

    for (const overrides of cases) {
      assert.throws(
        () => parsePackageVariantCreateForm(variantCreateForm(overrides)),
        InvalidPackageSubmissionError,
        `${JSON.stringify(overrides)} should be refused`,
      );
    }
  });

  it("refuses an oldest age below the youngest", () => {
    assert.throws(
      () => parsePackageVariantCreateForm(variantCreateForm({
        childMinAge: "12", childMaxAge: "6",
      })),
      InvalidPackageSubmissionError,
    );
  });

  it("keeps the discount an exact string, padded by text and never by a float", () => {
    for (const [typed, sent] of [["50", "50.00"], ["33.33", "33.33"], ["7.5", "7.50"],
      ["0", "0.00"], ["100", "100.00"]] as Array<[string, string]>) {
      const input = parsePackageVariantCreateForm(variantCreateForm({
        childDiscountPercent: typed,
      }));

      assert.equal(input.childDiscountPercent, sent);
      assert.equal(typeof input.childDiscountPercent, "string");
    }
  });

  it("refuses a discount outside the percentage the column holds", () => {
    for (const discount of ["100.01", "-1", "50.005", "1e2", "abc"]) {
      assert.throws(
        () => parsePackageVariantCreateForm(variantCreateForm({
          childDiscountPercent: discount,
        })),
        InvalidPackageSubmissionError,
        `${discount} should be refused`,
      );
    }
  });

  it("refuses a missing or blank label", () => {
    for (const label of ["", "   "]) {
      assert.throws(
        () => parsePackageVariantCreateForm(variantCreateForm({ label })),
        InvalidPackageSubmissionError,
      );
    }
  });
});

/** A journey carrying both fields, so the ignored one genuinely reaches the helper. */
const journeyState = (isActive: boolean, requiresPriceConfirmation: boolean) =>
  ({ isActive, requiresPriceConfirmation });

describe("packageAllowsVariantCreate", () => {
  it("allows a variant on a withdrawn journey", () => {
    assert.equal(
      packageAllowsVariantCreate(journeyState(false, false)),
      true,
    );
  });

  it("refuses a variant on a live journey", () => {
    assert.equal(
      packageAllowsVariantCreate(journeyState(true, false)),
      false,
    );
  });

  it("still refuses when the live journey is quoted on request", () => {
    // Being quoted changes what a guest is told about the price, not whether
    // a rate tier has to exist.
    assert.equal(
      packageAllowsVariantCreate(journeyState(true, true)),
      false,
    );
  });

  it("depends on publication alone", () => {
    for (const requiresPriceConfirmation of [true, false]) {
      assert.equal(
        packageAllowsVariantCreate(journeyState(false, requiresPriceConfirmation)),
        true,
      );
    }
  });

  it("explains the rule without offering to withdraw anything", () => {
    assert.match(VARIANT_CREATE_BLOCKED_MESSAGE, /Deactivate the journey first/);
    assert.match(VARIANT_CREATE_BLOCKED_MESSAGE, /no rates/);
  });
});

describe("packageVariantDefaultNote", () => {
  it("says the first variant will lead the journey", () => {
    const note = packageVariantDefaultNote(0);

    assert.match(note, /first variant/);
    assert.match(note, /default/);
  });

  it("says a later variant is appended and changes nothing", () => {
    const note = packageVariantDefaultNote(2);

    assert.match(note, /added after/);
    assert.match(note, /keep leading/);
  });

  it("describes both outcomes without implying a control over either", () => {
    for (const count of [0, 1, 5]) {
      const note = packageVariantDefaultNote(count);
      for (const forbidden of [/choose/i, /select/i, /pick/i, /reorder/i]) {
        assert.ok(!forbidden.test(note), `${note} must not imply a control`);
      }
    }
  });
});

describe("packageVariantCreateOwnershipWarning", () => {
  it("warns that adding a variant moves the whole journey", () => {
    const warning = packageVariantCreateOwnershipWarning("brochure");

    assert.ok(warning);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /no longer reconcile/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(packageVariantCreateOwnershipWarning("admin"), null);
  });

  it("offers no revert, because none exists", () => {
    const warning = packageVariantCreateOwnershipWarning("brochure")!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

describe("packageVariantNewHref", () => {
  it("addresses the create form beneath its journey", () => {
    assert.equal(
      packageVariantNewHref("nile-dinner-cruise"),
      "/admin/journeys/nile-dinner-cruise/variants/new",
    );
    assert.equal(packageVariantNewHref("a/b"), "/admin/journeys/a%2Fb/variants/new");
  });
});

describe("packageDefaultVariantAction", () => {
  it("offers exactly one control for a non-default variant on a withdrawn journey", () => {
    const action = packageDefaultVariantAction({ isActive: false }, { isDefault: false });

    assert.ok(action);
    assert.equal(action.label, "Make default");
    assert.equal(action.pendingLabel, "Making default…");
    assert.equal(action.tone, "confirm");
  });

  it("offers nothing for the variant that already leads", () => {
    // The API would treat it as an idempotent success, but a button that does
    // nothing is a button that lies.
    assert.equal(packageDefaultVariantAction({ isActive: false }, { isDefault: true }), null);
  });

  it("offers nothing at all on a live journey", () => {
    for (const isDefault of [true, false]) {
      assert.equal(packageDefaultVariantAction({ isActive: true }, { isDefault }), null);
    }
  });

  it("never offers a way to clear the default", () => {
    // A journey with several variants and none leading refuses every booking
    // that names no variant: a state to repair, never one to create.
    const action = packageDefaultVariantAction({ isActive: false }, { isDefault: false })!;

    for (const forbidden of [/clear/i, /unset/i, /remove/i, /none/i]) {
      assert.ok(!forbidden.test(action.label), `${action.label} must not offer to clear`);
    }
  });

  it("lets a lone unflagged variant be repaired", () => {
    // The state variant creation refuses as unsafe; this is its cure.
    assert.ok(packageDefaultVariantAction({ isActive: false }, { isDefault: false }));
  });
});

describe("packageDefaultVariantNote", () => {
  it("explains what the default is, either way", () => {
    for (const isActive of [true, false]) {
      assert.match(packageDefaultVariantNote({ isActive }), /when a guest names none/);
    }
  });

  it("tells a live journey what to do first, and offers to do none of it", () => {
    const note = packageDefaultVariantNote({ isActive: true });

    assert.match(note, /only be changed while the journey is inactive/);
    assert.match(note, /Deactivate the journey first/);
  });

  it("says nothing about deactivating a journey that is already withdrawn", () => {
    assert.ok(!/Deactivate/.test(packageDefaultVariantNote({ isActive: false })));
  });
});

/** A journey as the warning helper reads one. */
const defaultJourney = (overrides: {
  isActive?: boolean;
  managementSource?: "brochure" | "admin";
  variants?: Array<{ isDefault: boolean }>;
} = {}) => ({
  isActive: overrides.isActive ?? false,
  managementSource: overrides.managementSource ?? ("brochure" as const),
  variants: overrides.variants ?? [{ isDefault: true }, { isDefault: false }],
});

describe("packageDefaultVariantOwnershipWarning", () => {
  it("warns when a promotion is actually on offer", () => {
    const warning = packageDefaultVariantOwnershipWarning(defaultJourney());

    assert.ok(warning);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /no longer reconcile/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(
      packageDefaultVariantOwnershipWarning(defaultJourney({ managementSource: "admin" })),
      null,
    );
  });

  it("says nothing on a live journey, where no promotion is offered", () => {
    assert.equal(packageDefaultVariantOwnershipWarning(defaultJourney({ isActive: true })), null);
  });

  it("says nothing when every variant already leads, because nothing can be promoted", () => {
    // The single-variant case: the only variant is the default, so the
    // warning would be about a change no button can make.
    assert.equal(
      packageDefaultVariantOwnershipWarning(defaultJourney({ variants: [{ isDefault: true }] })),
      null,
    );
  });

  it("says nothing for a journey with no variants at all", () => {
    assert.equal(
      packageDefaultVariantOwnershipWarning(defaultJourney({ variants: [] })),
      null,
    );
  });

  it("warns for a lone unflagged variant, which can be promoted", () => {
    assert.ok(
      packageDefaultVariantOwnershipWarning(defaultJourney({ variants: [{ isDefault: false }] })),
    );
  });

  it("warns where several variants have no default at all", () => {
    assert.ok(
      packageDefaultVariantOwnershipWarning(defaultJourney({
        variants: [{ isDefault: false }, { isDefault: false }],
      })),
    );
  });

  it("offers no revert, because none exists", () => {
    const warning = packageDefaultVariantOwnershipWarning(defaultJourney())!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

describe("packageVariantMove", () => {
  const three = ["alpha", "beta", "gamma"];

  it("swaps a variant with the one above it", () => {
    assert.deepEqual(packageVariantMove(three, 1, "up"), ["beta", "alpha", "gamma"]);
    assert.deepEqual(packageVariantMove(three, 2, "up"), ["alpha", "gamma", "beta"]);
  });

  it("swaps a variant with the one below it", () => {
    assert.deepEqual(packageVariantMove(three, 0, "down"), ["beta", "alpha", "gamma"]);
    assert.deepEqual(packageVariantMove(three, 1, "down"), ["alpha", "gamma", "beta"]);
  });

  it("returns the COMPLETE list every time, never a fragment", () => {
    for (const index of [0, 1, 2]) {
      for (const direction of ["up", "down"] as const) {
        const moved = packageVariantMove(three, index, direction);
        if (!moved) continue;

        assert.equal(moved.length, three.length, "every variant is still listed");
        assert.deepEqual([...moved].sort(), [...three].sort(), "and it is the same set");
      }
    }
  });

  it("offers no Move up for the first variant", () => {
    assert.equal(packageVariantMove(three, 0, "up"), null);
  });

  it("offers no Move down for the last variant", () => {
    assert.equal(packageVariantMove(three, 2, "down"), null);
  });

  it("offers nothing at all for a lone variant", () => {
    assert.equal(packageVariantMove(["alpha"], 0, "up"), null);
    assert.equal(packageVariantMove(["alpha"], 0, "down"), null);
  });

  it("offers nothing for an empty journey", () => {
    assert.equal(packageVariantMove([], 0, "up"), null);
    assert.equal(packageVariantMove([], 0, "down"), null);
  });

  it("refuses an index that is not one of the variants", () => {
    for (const index of [-1, 3, 1.5, Number.NaN]) {
      assert.equal(packageVariantMove(three, index, "up"), null);
      assert.equal(packageVariantMove(three, index, "down"), null);
    }
  });

  it("does not mutate the list it was given", () => {
    const original = [...three];
    packageVariantMove(three, 1, "up");

    assert.deepEqual(three, original, "the rendered order is not disturbed");
  });

  it("carries keys through exactly, without repair", () => {
    // These could not be real variant keys, which is the point: this helper
    // rearranges identities and never inspects or fixes them.
    const odd = ["Alpha", " beta", "gamma-service"];

    assert.deepEqual(packageVariantMove(odd, 0, "down"), [" beta", "Alpha", "gamma-service"]);
  });

  it("is reversible: a move and its opposite restore the order", () => {
    const down = packageVariantMove(three, 0, "down")!;

    assert.deepEqual(packageVariantMove(down, 1, "up"), three);
  });
});

describe("packageVariantMoves", () => {
  const three = ["alpha", "beta", "gamma"];

  it("gives a middle variant both moves", () => {
    const moves = packageVariantMoves(three, 1);

    assert.deepEqual(moves.up, ["beta", "alpha", "gamma"]);
    assert.deepEqual(moves.down, ["alpha", "gamma", "beta"]);
  });

  it("gives the first variant only a way down", () => {
    const moves = packageVariantMoves(three, 0);

    assert.equal(moves.up, null);
    assert.deepEqual(moves.down, ["beta", "alpha", "gamma"]);
  });

  it("gives the last variant only a way up", () => {
    const moves = packageVariantMoves(three, 2);

    assert.deepEqual(moves.up, ["alpha", "gamma", "beta"]);
    assert.equal(moves.down, null);
  });

  it("gives two variants exactly one valid action each", () => {
    const two = ["alpha", "beta"];
    const first = packageVariantMoves(two, 0);
    const second = packageVariantMoves(two, 1);

    assert.equal(first.up, null);
    assert.deepEqual(first.down, ["beta", "alpha"]);
    assert.deepEqual(second.up, ["beta", "alpha"]);
    assert.equal(second.down, null);
  });

  it("gives a lone variant nothing", () => {
    assert.deepEqual(packageVariantMoves(["alpha"], 0), { up: null, down: null });
  });
});

describe("packageVariantOrderNote", () => {
  it("says what the order does, and what it does not", () => {
    const note = packageVariantOrderNote(3);

    assert.match(note, /order guests see/);
    assert.match(note, /does not change which variant a booking resolves to/);
  });

  it("says nothing about deactivating, because reordering never needs it", () => {
    for (const count of [1, 2, 5]) {
      assert.ok(!/[Dd]eactivat/.test(packageVariantOrderNote(count)));
    }
  });

  it("explains why a lone variant has no controls", () => {
    assert.match(packageVariantOrderNote(1), /more than one variant/);
    assert.match(packageVariantOrderNote(0), /more than one variant/);
  });
});

describe("packageVariantOrderOwnershipWarning", () => {
  const brochure = (count: number) => ({
    managementSource: "brochure" as const,
    variants: Array.from({ length: count }, () => ({})),
  });

  it("warns when a move is actually on offer", () => {
    const warning = packageVariantOrderOwnershipWarning(brochure(2));

    assert.ok(warning);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /no longer reconcile/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing when there is nothing to move", () => {
    assert.equal(packageVariantOrderOwnershipWarning(brochure(1)), null);
    assert.equal(packageVariantOrderOwnershipWarning(brochure(0)), null);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(
      packageVariantOrderOwnershipWarning({
        managementSource: "admin",
        variants: [{}, {}],
      }),
      null,
    );
  });

  it("warns about saving, never about looking", () => {
    const warning = packageVariantOrderOwnershipWarning(brochure(2))!;

    assert.match(warning, /Saving a new order/);
    for (const forbidden of [/viewing/i, /opening/i, /this page/i]) {
      assert.ok(!forbidden.test(warning), "merely seeing the controls changes nothing");
    }
  });

  it("offers no revert, because none exists", () => {
    const warning = packageVariantOrderOwnershipWarning(brochure(2))!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

/** A journey as the delete helpers read one. */
const deleteJourney = (overrides: {
  isActive?: boolean;
  managementSource?: "brochure" | "admin";
  variants?: Array<{ isDefault: boolean }>;
} = {}) => ({
  isActive: overrides.isActive ?? false,
  managementSource: overrides.managementSource ?? ("brochure" as const),
  variants: overrides.variants ?? [{ isDefault: true }, { isDefault: false }],
});

describe("packageVariantDeleteState", () => {
  it("offers nothing at all on a live journey", () => {
    const journey = deleteJourney({ isActive: true });

    for (const variant of [{ isDefault: true }, { isDefault: false }]) {
      assert.equal(packageVariantDeleteState(journey, variant), "hidden");
    }
  });

  it("allows a non-default variant on a withdrawn journey", () => {
    assert.equal(
      packageVariantDeleteState(deleteJourney(), { isDefault: false }),
      "available",
    );
  });

  it("blocks the leading variant while others remain", () => {
    assert.equal(
      packageVariantDeleteState(deleteJourney(), { isDefault: true }),
      "blocked-default",
    );
  });

  it("allows the final variant even though it leads the journey", () => {
    // There is no successor to choose, so no choice is being made.
    assert.equal(
      packageVariantDeleteState(
        deleteJourney({ variants: [{ isDefault: true }] }),
        { isDefault: true },
      ),
      "available",
    );
  });

  it("allows a lone variant that leads nothing", () => {
    assert.equal(
      packageVariantDeleteState(
        deleteJourney({ variants: [{ isDefault: false }] }),
        { isDefault: false },
      ),
      "available",
    );
  });

  it("puts publication ahead of every other rule", () => {
    // A live journey hides the control even for the final variant.
    assert.equal(
      packageVariantDeleteState(
        deleteJourney({ isActive: true, variants: [{ isDefault: true }] }),
        { isDefault: true },
      ),
      "hidden",
    );
  });

  it("names the remedy for the blocked case", () => {
    assert.match(DEFAULT_BLOCKS_DELETE_NOTE, /Make another variant the default first/);
    assert.match(DEFAULT_BLOCKS_DELETE_NOTE, /while others remain/);
  });
});

describe("packageVariantDeleteConfirmation", () => {
  it("names the variant by label and by key", () => {
    const copy = packageVariantDeleteConfirmation({
      key: "premium-service",
      label: "Premium service",
    });

    assert.match(copy, /Premium service/, "the label an administrator reads");
    assert.match(copy, /premium-service/, "and the key, which is what is unique");
  });

  it("says what goes and that it cannot be undone", () => {
    const copy = packageVariantDeleteConfirmation({ key: "beta", label: "Beta" });

    assert.match(copy, /removes the variant and its rates/);
    assert.match(copy, /permanently/);
    assert.match(copy, /cannot be undone/);
  });

  it("distinguishes two variants whose labels read alike", () => {
    const first = packageVariantDeleteConfirmation({ key: "standard", label: "Standard" });
    const second = packageVariantDeleteConfirmation({ key: "standard-plus", label: "Standard" });

    assert.notEqual(first, second, "the key is what tells them apart");
  });
});

describe("packageVariantDeleteOwnershipWarning", () => {
  it("warns when a delete is actually on offer", () => {
    const warning = packageVariantDeleteOwnershipWarning(deleteJourney());

    assert.ok(warning);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /no longer reconcile/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing on a live journey, where no variant can be deleted", () => {
    assert.equal(packageVariantDeleteOwnershipWarning(deleteJourney({ isActive: true })), null);
  });

  it("says nothing when the only variant is blocked by the default rule", () => {
    // Two variants, both flagged is impossible; this is the shape where the
    // single deletable candidate is the leader with a sibling.
    assert.equal(
      packageVariantDeleteOwnershipWarning(deleteJourney({
        variants: [{ isDefault: true }],
        isActive: true,
      })),
      null,
    );
  });

  it("warns for a journey whose lone variant can go", () => {
    assert.ok(
      packageVariantDeleteOwnershipWarning(deleteJourney({ variants: [{ isDefault: true }] })),
    );
  });

  it("says nothing for a journey with no variants at all", () => {
    assert.equal(packageVariantDeleteOwnershipWarning(deleteJourney({ variants: [] })), null);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(
      packageVariantDeleteOwnershipWarning(deleteJourney({ managementSource: "admin" })),
      null,
    );
  });

  it("offers no revert, because none exists", () => {
    const warning = packageVariantDeleteOwnershipWarning(deleteJourney())!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i, /undelete/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

/** Builds the FormData the content editor submits. */
function contentForm(lists: {
  included?: string[];
  excluded?: string[];
  notes?: string[];
}): FormData {
  const form = new FormData();

  for (const list of ["included", "excluded", "notes"] as const) {
    for (const entry of lists[list] ?? []) {
      form.append(list, entry);
    }
  }

  return form;
}

describe("parsePackageContentForm", () => {
  it("builds exactly the API's three lists", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["Dinner"], excluded: ["Drinks"], notes: ["Smart dress."],
    }));

    assert.deepEqual(Object.keys(content).sort(), ["excluded", "included", "notes"]);
  });

  it("always returns all three, even when the form sent none", () => {
    // A whole-set replacement cannot say "leave that one alone".
    assert.deepEqual(parsePackageContentForm(new FormData()), {
      included: [], excluded: [], notes: [],
    });
  });

  it("preserves the order of the rows", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["zebra", "apple", "mango"],
    }));

    assert.deepEqual(content.included, ["zebra", "apple", "mango"], "never re-sorted");
  });

  it("preserves duplicates", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["Transfer", "Transfer"],
    }));

    assert.deepEqual(content.included, ["Transfer", "Transfer"]);
  });

  it("skips a completely blank row, wherever it sits", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["", "Dinner", "", "Guide", ""],
    }));

    assert.deepEqual(content.included, ["Dinner", "Guide"], "unused slots and cleared lines");
  });

  it("clears a list when every box is empty", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["", "", ""], excluded: ["Drinks"],
    }));

    assert.deepEqual(content.included, []);
    assert.deepEqual(content.excluded, ["Drinks"]);
  });

  it("clears all three when the whole form is empty", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["", ""], excluded: [""], notes: ["", ""],
    }));

    assert.deepEqual(content, { included: [], excluded: [], notes: [] });
  });

  it("refuses untrimmed text rather than silently trimming it", () => {
    for (const entry of [" Dinner", "Dinner ", " Dinner ", "\tDinner", "Dinner\n"]) {
      assert.throws(
        () => parsePackageContentForm(contentForm({ included: [entry] })),
        InvalidPackageSubmissionError,
        `${JSON.stringify(entry)} should be reported, not repaired`,
      );
    }
  });

  it("refuses a row holding only whitespace", () => {
    // Something was typed, so it is reported rather than vanishing.
    for (const entry of [" ", "   ", "\t", "\n"]) {
      assert.throws(
        () => parsePackageContentForm(contentForm({ included: [entry] })),
        InvalidPackageSubmissionError,
      );
    }
  });

  it("refuses an entry longer than the cap, and accepts the cap itself", () => {
    assert.throws(
      () => parsePackageContentForm(contentForm({ included: ["a".repeat(501)] })),
      InvalidPackageSubmissionError,
    );
    assert.doesNotThrow(
      () => parsePackageContentForm(contentForm({ included: ["a".repeat(500)] })),
    );
  });

  it("refuses more entries than a list may hold, and accepts the cap itself", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_unused, index) => `Item ${index + 1}`);

    assert.throws(
      () => parsePackageContentForm(contentForm({ included: many(101) })),
      TooManyContentEntriesError,
    );
    assert.doesNotThrow(() => parsePackageContentForm(contentForm({ included: many(100) })));
  });

  it("counts only the filled rows against the cap", () => {
    const rows = [...Array.from({ length: 100 }, (_u, i) => `Item ${i + 1}`), "", "", ""];

    assert.doesNotThrow(() => parsePackageContentForm(contentForm({ included: rows })));
  });

  it("checks each list against the cap on its own", () => {
    const many = Array.from({ length: 101 }, (_unused, index) => `Item ${index}`);

    for (const list of ["included", "excluded", "notes"] as const) {
      assert.throws(
        () => parsePackageContentForm(contentForm({ [list]: many })),
        TooManyContentEntriesError,
        `${list} should be capped`,
      );
    }
  });

  it("reads each list independently, keeping them apart", () => {
    const content = parsePackageContentForm(contentForm({
      included: ["a", "b"], excluded: ["c"], notes: ["d", "e", "f"],
    }));

    assert.deepEqual(content, {
      included: ["a", "b"], excluded: ["c"], notes: ["d", "e", "f"],
    });
  });
});

describe("packageContentRowCount", () => {
  it("offers spare rows beneath the entries a list has", () => {
    assert.equal(packageContentRowCount(0), 3);
    assert.equal(packageContentRowCount(2), 5);
  });

  it("never offers more rows than the API would accept", () => {
    assert.equal(packageContentRowCount(100), 100);
    assert.equal(packageContentRowCount(99), 100, "a form that can only be refused is no form");
  });
});

describe("packageContentMatches", () => {
  const base = { included: ["a", "b"], excluded: ["c"], notes: ["d"] };

  it("matches identical lists", () => {
    assert.equal(packageContentMatches(base, { ...base }), true);
  });

  it("treats a reordered list as different", () => {
    assert.equal(
      packageContentMatches(base, { ...base, included: ["b", "a"] }),
      false,
      "order is part of the content",
    );
  });

  it("treats a changed length as different", () => {
    assert.equal(packageContentMatches(base, { ...base, included: ["a"] }), false);
    assert.equal(packageContentMatches(base, { ...base, notes: [] }), false);
  });

  it("matches two empty sets", () => {
    const empty = { included: [], excluded: [], notes: [] };
    assert.equal(packageContentMatches(empty, { ...empty }), true);
  });
});

describe("packageContentOwnershipWarning", () => {
  it("warns a brochure journey about saving", () => {
    const warning = packageContentOwnershipWarning("brochure");

    assert.ok(warning);
    assert.match(warning, /Saving a change here/);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(packageContentOwnershipWarning("admin"), null);
  });

  it("warns about saving, never about looking", () => {
    const warning = packageContentOwnershipWarning("brochure")!;

    for (const forbidden of [/viewing/i, /opening/i, /this page/i]) {
      assert.ok(!forbidden.test(warning), "merely opening the editor changes nothing");
    }
  });

  it("offers no revert, because none exists", () => {
    const warning = packageContentOwnershipWarning("brochure")!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

describe("packageContentHref", () => {
  it("addresses the editor beneath its journey", () => {
    assert.equal(packageContentHref("nile-dinner-cruise"), "/admin/journeys/nile-dinner-cruise/content");
    assert.equal(packageContentHref("a/b"), "/admin/journeys/a%2Fb/content");
  });
});

/** Builds the parallel-array FormData the itinerary editor submits. */
function itineraryForm(rows: Array<[string, string, string]>): FormData {
  const form = new FormData();

  for (const [day, heading, body] of rows) {
    form.append("dayNumber", day);
    form.append("heading", heading);
    form.append("body", body);
  }

  return form;
}

const usedRow = (): [string, string, string] => ["1", "Arrival", "Meet at the airport."];

describe("parsePackageItineraryForm", () => {
  it("builds sections carrying only the three API fields", () => {
    const [section] = parsePackageItineraryForm(itineraryForm([usedRow()]));

    assert.deepEqual(Object.keys(section!).sort(), ["body", "dayNumber", "heading"]);
  });

  it("preserves the row order exactly", () => {
    const sections = parsePackageItineraryForm(itineraryForm([
      ["3", "Third", "Third day first."],
      ["1", "First", "Then day one."],
      ["2", "Second", "Then day two."],
    ]));

    assert.deepEqual(
      sections.map((section) => section.dayNumber),
      [3, 1, 2],
      "never sorted by day number",
    );
  });

  it("preserves duplicate sections", () => {
    const sections = parsePackageItineraryForm(itineraryForm([usedRow(), usedRow()]));

    assert.equal(sections.length, 2);
    assert.deepEqual(sections[0], sections[1]);
  });

  it("skips a row with all three boxes empty, wherever it sits", () => {
    const sections = parsePackageItineraryForm(itineraryForm([
      ["", "", ""],
      usedRow(),
      ["", "", ""],
      ["2", "Departure", "Transfer back."],
      ["", "", ""],
    ]));

    assert.deepEqual(
      sections.map((section) => section.body),
      ["Meet at the airport.", "Transfer back."],
      "unused slots and cleared sections",
    );
  });

  it("accepts a completely empty itinerary", () => {
    assert.deepEqual(parsePackageItineraryForm(itineraryForm([["", "", ""], ["", "", ""]])), []);
    assert.deepEqual(parsePackageItineraryForm(new FormData()), []);
  });

  it("reads a blank day number as null", () => {
    const [section] = parsePackageItineraryForm(itineraryForm([["", "General", "Applies throughout."]]));

    assert.equal(section!.dayNumber, null, "no particular day, not day zero");
    assert.equal(section!.heading, "General");
  });

  it("reads a blank heading as null", () => {
    const [section] = parsePackageItineraryForm(itineraryForm([["1", "", "An unheaded passage."]]));

    assert.equal(section!.heading, null, "no heading, not an empty string");
  });

  it("round-trips a section with both nullable fields blank", () => {
    const [section] = parsePackageItineraryForm(itineraryForm([["", "", "Applies throughout."]]));

    assert.deepEqual(section, {
      dayNumber: null, heading: null, body: "Applies throughout.",
    });
  });

  it("refuses a partially filled row rather than discarding it", () => {
    // Any box filled means a section is being described, so losing it
    // silently would lose work without saying so.
    for (const row of [
      ["1", "", ""],
      ["", "Arrival", ""],
      ["1", "Arrival", ""],
    ] as Array<[string, string, string]>) {
      assert.throws(
        () => parsePackageItineraryForm(itineraryForm([row])),
        InvalidPackageSubmissionError,
        `${JSON.stringify(row)} should be refused`,
      );
    }
  });

  it("requires a body for any used section", () => {
    assert.throws(
      () => parsePackageItineraryForm(itineraryForm([["1", "Arrival", "   "]])),
      InvalidPackageSubmissionError,
    );
  });

  it("refuses a day number that is not a whole number above zero", () => {
    for (const day of ["0", "-1", "1.5", "one", "1e3", "2147483648", "+1"]) {
      assert.throws(
        () => parsePackageItineraryForm(itineraryForm([[day, "Arrival", "Body."]])),
        InvalidPackageSubmissionError,
        `${day} should be refused`,
      );
    }
  });

  it("accepts the largest day number the column holds", () => {
    const [section] = parsePackageItineraryForm(
      itineraryForm([["2147483647", "", "Body."]]),
    );

    assert.equal(section!.dayNumber, 2147483647);
  });

  it("trims the numeric box, which is not an identity", () => {
    // Consistent with the rate editor: surrounding space round a number
    // carries no meaning to preserve, unlike prose.
    const [section] = parsePackageItineraryForm(itineraryForm([[" 2 ", "", "Body."]]));

    assert.equal(section!.dayNumber, 2);
  });

  it("refuses untrimmed heading or body rather than repairing them", () => {
    for (const row of [
      ["1", " Arrival", "Body."],
      ["1", "Arrival ", "Body."],
      ["1", "Arrival", " Body."],
      ["1", "Arrival", "Body. "],
      ["1", "\tArrival", "Body."],
    ] as Array<[string, string, string]>) {
      assert.throws(
        () => parsePackageItineraryForm(itineraryForm([row])),
        InvalidPackageSubmissionError,
        `${JSON.stringify(row)} should be reported, not repaired`,
      );
    }
  });

  it("refuses a heading or body holding only whitespace", () => {
    assert.throws(
      () => parsePackageItineraryForm(itineraryForm([["1", "   ", "Body."]])),
      InvalidPackageSubmissionError,
    );
    assert.throws(
      () => parsePackageItineraryForm(itineraryForm([["1", "Arrival", "   "]])),
      InvalidPackageSubmissionError,
    );
  });

  it("refuses a heading longer than the cap, and accepts the cap itself", () => {
    assert.throws(
      () => parsePackageItineraryForm(itineraryForm([["1", "a".repeat(201), "Body."]])),
      InvalidPackageSubmissionError,
    );
    assert.doesNotThrow(
      () => parsePackageItineraryForm(itineraryForm([["1", "a".repeat(200), "Body."]])),
    );
  });

  it("refuses a body longer than the cap, and accepts the cap itself", () => {
    assert.throws(
      () => parsePackageItineraryForm(itineraryForm([["1", "Arrival", "a".repeat(2001)]])),
      InvalidPackageSubmissionError,
    );
    assert.doesNotThrow(
      () => parsePackageItineraryForm(itineraryForm([["1", "Arrival", "a".repeat(2000)]])),
    );
  });

  it("refuses more sections than the cap, and accepts the cap itself", () => {
    const rows = (count: number): Array<[string, string, string]> =>
      Array.from({ length: count }, (_unused, index) => [`${index + 1}`, "", `Day ${index + 1}.`]);

    assert.throws(
      () => parsePackageItineraryForm(itineraryForm(rows(101))),
      TooManyItinerarySectionsError,
    );
    assert.doesNotThrow(() => parsePackageItineraryForm(itineraryForm(rows(100))));
  });

  it("counts only the used rows against the cap", () => {
    const rows: Array<[string, string, string]> = [
      ...Array.from({ length: 100 }, (_u, i) => [`${i + 1}`, "", `Day ${i + 1}.`] as [string, string, string]),
      ["", "", ""], ["", "", ""], ["", "", ""],
    ];

    assert.doesNotThrow(() => parsePackageItineraryForm(itineraryForm(rows)));
  });

  it("refuses arrays of mismatched length", () => {
    const form = new FormData();
    form.append("dayNumber", "1");
    form.append("heading", "Arrival");

    assert.throws(() => parsePackageItineraryForm(form), InvalidPackageSubmissionError);
  });
});

describe("packageItineraryRowCount", () => {
  it("offers spare rows beneath the sections a journey has", () => {
    assert.equal(packageItineraryRowCount(0), 3);
    assert.equal(packageItineraryRowCount(4), 7);
  });

  it("never offers more rows than the API would accept", () => {
    assert.equal(packageItineraryRowCount(100), 100);
    assert.equal(packageItineraryRowCount(98), 100, "a form that can only be refused is no form");
  });
});

describe("packageItineraryOwnershipWarning", () => {
  it("warns a brochure journey about saving", () => {
    const warning = packageItineraryOwnershipWarning("brochure");

    assert.ok(warning);
    assert.match(warning, /Saving a change here/);
    assert.match(warning, /whole\s+journey admin-managed/);
    assert.match(warning, /cannot be undone/);
  });

  it("says nothing for a journey the administrator already owns", () => {
    assert.equal(packageItineraryOwnershipWarning("admin"), null);
  });

  it("warns about saving, never about looking", () => {
    const warning = packageItineraryOwnershipWarning("brochure")!;

    for (const forbidden of [/viewing/i, /opening/i, /this page/i]) {
      assert.ok(!forbidden.test(warning), "merely opening the editor changes nothing");
    }
  });

  it("offers no revert, because none exists", () => {
    const warning = packageItineraryOwnershipWarning("brochure")!;
    for (const forbidden of [/resync/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(warning));
    }
  });
});

describe("packageItineraryHref", () => {
  it("addresses the editor beneath its journey", () => {
    assert.equal(
      packageItineraryHref("nile-dinner-cruise"),
      "/admin/journeys/nile-dinner-cruise/itinerary",
    );
    assert.equal(packageItineraryHref("a/b"), "/admin/journeys/a%2Fb/itinerary");
  });
});

describe("packageDeleteState", () => {
  it("offers nothing while the journey is live", () => {
    assert.equal(packageDeleteState({ isActive: true }), "hidden");
  });

  it("offers the control once the journey is withdrawn", () => {
    assert.equal(packageDeleteState({ isActive: false }), "available");
  });

  it("judges publication and nothing else", () => {
    // Brochure identity and bookings are the backend's to answer: the first
    // needs a catalogue this app does not hold, the second a lock it cannot
    // take. Neither is guessed at here.
    assert.equal(packageDeleteState({ isActive: false }), "available");
  });

  it("names the remedy for a live journey", () => {
    assert.match(PACKAGE_DELETE_BLOCKED_NOTE, /Deactivate it first/);
    assert.match(PACKAGE_DELETE_BLOCKED_NOTE, /gone from the website/);
  });
});

describe("packageDeleteConfirmation", () => {
  const journey = { title: "Nile Dinner Cruise", code: "T016", slug: "nile-dinner-cruise" };

  it("names the journey by title, code and slug", () => {
    const copy = packageDeleteConfirmation(journey);

    assert.match(copy, /Nile Dinner Cruise/);
    assert.match(copy, /T016/);
    assert.match(copy, /nile-dinner-cruise/);
  });

  it("says the deletion is permanent and what else goes with it", () => {
    const copy = packageDeleteConfirmation(journey);

    assert.match(copy, /Permanently delete/);
    assert.match(copy, /cannot be undone/);
    assert.match(copy, /variant/);
    assert.match(copy, /rate/);
    assert.match(copy, /itinerary/);
    assert.match(copy, /content/);
  });

  it("says a booked journey cannot be deleted at all", () => {
    const copy = packageDeleteConfirmation(journey);

    assert.match(copy, /ever been booked cannot be deleted/);
    assert.match(copy, /record of what was sold/);
  });

  it("never suggests that cancelling bookings would help", () => {
    const copy = packageDeleteConfirmation(journey);

    for (const forbidden of [/cancel/i, /once the/i, /after the/i, /first remove/i]) {
      assert.ok(!forbidden.test(copy), `${forbidden} would promise a door that does not exist`);
    }
  });

  it("distinguishes two journeys whose titles read alike", () => {
    const first = packageDeleteConfirmation({ title: "Cruise", code: "A", slug: "a" });
    const second = packageDeleteConfirmation({ title: "Cruise", code: "B", slug: "b" });

    assert.notEqual(first, second, "the code and slug are what tell them apart");
  });
});

describe("packageDeleteBrochureAdvisory", () => {
  it("warns a brochure-managed journey that deletion will not work", () => {
    const advisory = packageDeleteBrochureAdvisory("brochure");

    assert.ok(advisory);
    assert.match(advisory, /cannot be deleted/);
    assert.match(advisory, /catalogue seed recreates them/);
    assert.match(advisory, /deactivating it/i);
  });

  it("says nothing for a journey the administrator owns", () => {
    // Which is not the same as saying the delete will succeed: a formerly
    // brochure-owned journey still carries a brochure identity, and only the
    // backend knows that.
    assert.equal(packageDeleteBrochureAdvisory("admin"), null);
  });

  it("offers no resync or reseed control", () => {
    const advisory = packageDeleteBrochureAdvisory("brochure")!;

    for (const forbidden of [/resync/i, /reseed/i, /revert/i, /restore/i]) {
      assert.ok(!forbidden.test(advisory));
    }
  });
});

describe("packageVariantsRateSummary", () => {
  const tiers = (...amounts: string[]) =>
    amounts.map((adultUnitRate, index) => ({
      minPartySize: index + 1,
      maxPartySize: null,
      adultUnitRate,
      currency: "USD" as const,
    }));

  it("counts the tiers and names the lowest adult rate", () => {
    assert.equal(
      packageVariantsRateSummary({ rates: tiers("100.00", "90.00", "80.00") }),
      "3 rate tiers · from USD 80.00 per adult",
    );
  });

  it("finds the lowest wherever it sits in the list", () => {
    assert.equal(
      packageVariantsRateSummary({ rates: tiers("80.00", "100.00", "90.00") }),
      "3 rate tiers · from USD 80.00 per adult",
    );
  });

  it("speaks of one tier in the singular", () => {
    assert.equal(
      packageVariantsRateSummary({ rates: tiers("100.00") }),
      "1 rate tier · from USD 100.00 per adult",
    );
  });

  it("compares money as minor units, never as floats", () => {
    // 9.90 vs 10.00: a lexicographic or naive comparison picks the wrong one.
    assert.match(
      packageVariantsRateSummary({ rates: tiers("10.00", "9.90") }),
      /from USD 9\.90 per adult/,
    );

    // A figure a float would not hold exactly comes back byte for byte.
    assert.match(
      packageVariantsRateSummary({ rates: tiers("1234567.89", "9999999.99") }),
      /from USD 1,234,567\.89 per adult/,
    );
  });

  it("says so plainly when a variant has no tiers", () => {
    assert.equal(packageVariantsRateSummary({ rates: [] }), "No rate tiers");
  });

  it("never totals anything, because a party's price is settled at booking", () => {
    const summary = packageVariantsRateSummary({ rates: tiers("100.00", "90.00") });

    assert.match(summary, /from /, "a floor, never a price");
    assert.ok(!/total/i.test(summary));
  });
});
