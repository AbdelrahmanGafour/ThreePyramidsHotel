import { formatUsd } from "./format";
import type { AdminPackageRateTier, AdminPackageVariant } from "../types";

// The words the journey catalogue screens use, and the one place the detail
// route is spelled.
//
// Shared by the list and the detail view so the two can never describe the
// same journey differently.

/** Shown wherever the catalogue records nothing for a field. */
export const NOT_SET = "Not set";

/** Shown for a collection an administrator has not filled in. */
export const NONE_RECORDED = "None recorded";

/** The catalogue route, re-read whenever a journey on it changes. */
export const PACKAGES_PATH = "/admin/journeys";

export const packageDetailHref = (slug: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}`;

/** The one control a journey offers, given where it stands now. */
export type PackageStatusAction = {
  /** What the journey becomes, not what it is. */
  target: boolean;
  tone: "confirm" | "cancel";
  label: string;
  pendingLabel: string;
};

/**
 * Which control to offer for a journey in this state.
 *
 * Exactly one, always: a journey is either on sale or it is not, so the only
 * useful action is the opposite of where it stands. Offering both would ask
 * an administrator to work out which one is the no-op.
 *
 * Pure, so it can be tested without a server action in the module graph. The
 * API decides what is allowed; this only decides what to show, and the state
 * it was rendered from may already be out of date.
 */
export function packageStatusAction(isActive: boolean): PackageStatusAction {
  if (isActive) {
    return {
      target: false,
      tone: "cancel",
      label: "Deactivate journey",
      pendingLabel: "Deactivating…",
    };
  }

  return {
    target: true,
    tone: "confirm",
    label: "Activate journey",
    pendingLabel: "Activating…",
  };
}

/** What withdrawing or publishing a journey actually does, in one line. */
export function packageStatusNote(isActive: boolean): string {
  return isActive
    ? "This journey is offered to guests. Deactivating hides it from the website; it stays in the catalogue."
    : "This journey is hidden from the website. Activating offers it to guests again.";
}

/** "3 variants" / "1 variant" / "No variants". */
export function packageVariantsLabel(variantCount: number): string {
  if (variantCount === 0) {
    return "No variants";
  }

  return `${variantCount} variant${variantCount === 1 ? "" : "s"}`;
}

/**
 * The party sizes one tier covers.
 *
 * A null upper bound is an open-ended tier — the brochure's "3 or more" — and
 * is never rendered as a missing number or an invented ceiling.
 */
export function packagePartySizeLabel(tier: AdminPackageRateTier): string {
  const { minPartySize, maxPartySize } = tier;

  if (maxPartySize === null) {
    return `${minPartySize} or more`;
  }

  if (maxPartySize === minPartySize) {
    return `${minPartySize} ${minPartySize === 1 ? "person" : "people"}`;
  }

  return `${minPartySize}–${maxPartySize} people`;
}

/**
 * One tier as a line: who it covers and what each adult pays.
 *
 * The stored decimal string is formatted and nothing more. No total is
 * derived here — a party's price is settled when a reservation is taken, and
 * working one out on a catalogue screen would invent a second opinion about
 * it.
 */
export function packageRateLabel(tier: AdminPackageRateTier): string {
  return `${formatUsd(tier.adultUnitRate)} per adult`;
}

/**
 * A variant's rate tiers in one line: how many, and the lowest adult rate.
 *
 * The lowest is chosen by comparing minor units with BigInt, never by
 * parsing the decimals into numbers — this is money, and the string that
 * comes back is the exact one that was stored.
 *
 * "From" is deliberate: a tier's price depends on party size, so a single
 * figure can only ever be the floor. Nothing is totalled here.
 */
export function packageVariantsRateSummary(variant: {
  rates: readonly AdminPackageRateTier[];
}): string {
  if (variant.rates.length === 0) {
    return "No rate tiers";
  }

  let lowest = variant.rates[0]!.adultUnitRate;

  for (const tier of variant.rates) {
    if (BigInt(tier.adultUnitRate.replace(".", "")) < BigInt(lowest.replace(".", ""))) {
      lowest = tier.adultUnitRate;
    }
  }

  const count = variant.rates.length === 1 ? "1 rate tier" : `${variant.rates.length} rate tiers`;

  return `${count} · from ${formatUsd(lowest)} per adult`;
}

/**
 * The variant's child rule, or the fact that it has none.
 *
 * The three fields are null together or set together — a database CHECK makes
 * the trio all-or-nothing — so one sentence covers it, and "no child pricing"
 * is a real answer rather than a gap.
 */
export function packageChildPricingLabel(variant: AdminPackageVariant): string {
  const { childMinAge, childMaxAge, childDiscountPercent } = variant;

  if (childMinAge === null || childMaxAge === null || childDiscountPercent === null) {
    return "No child pricing";
  }

  // The stored percent is shown as stored; trailing zeros are part of the
  // value the hotel recorded, not noise to tidy away.
  return `Ages ${childMinAge}–${childMaxAge} at ${childDiscountPercent}% off`;
}

/** Where the create form lives. */
export const PACKAGES_NEW_PATH = "/admin/journeys/new";

/** The weekdays the API accepts, in the order a form should present them. */
export const PACKAGE_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** Exactly the fields `POST /api/v1/admin/packages` accepts. */
export type PackageCreateInput = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  requiresPriceConfirmation: boolean;
  sortOrder: number;
};

/** Raised only for a submission this form can already see is unusable. */
export class InvalidPackageSubmissionError extends Error {}

function field(form: FormData, name: string): string {
  const value = form.get(name);

  // A file, or a field the form never carried, is not a value this form sends.
  if (typeof value !== "string") {
    throw new InvalidPackageSubmissionError();
  }

  return value;
}

/**
 * Optional text: an empty box means "no value", not an empty string. The API
 * stores null for both, so the form says so plainly rather than sending "".
 *
 * Trimmed, because a box containing only spaces is an empty box — and because
 * the API refuses untrimmed text outright, so sending it would be a round trip
 * that could only fail.
 */
function optionalText(form: FormData, name: string, maxLength: number): string | null {
  const trimmed = field(form, name).trim();

  if (trimmed.length > maxLength) {
    throw new InvalidPackageSubmissionError();
  }

  return trimmed.length === 0 ? null : trimmed;
}

function requiredText(form: FormData, name: string, maxLength: number): string {
  const trimmed = field(form, name).trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new InvalidPackageSubmissionError();
  }

  return trimmed;
}

/**
 * An identity, submitted exactly as typed.
 *
 * Deliberately NOT trimmed, unlike the prose above. The API refuses a code or
 * slug with surrounding whitespace rather than repairing it, and this form
 * must not disagree: quietly trimming here would create a journey under an
 * identity the administrator did not type, and identities cannot be changed
 * afterwards.
 */
function identity(form: FormData, name: string, maxLength: number): string {
  const value = field(form, name);

  if (value.length === 0 || value.length > maxLength) {
    throw new InvalidPackageSubmissionError();
  }

  return value;
}

/**
 * The selected weekdays, or null when none were chosen.
 *
 * Returned in the canonical week order rather than the order the checkboxes
 * happened to arrive in, so the same selection always serializes identically.
 * An empty selection is null, never `[]`: the API refuses an empty array,
 * and "runs on no particular day" is what null already means.
 */
function operatingDays(form: FormData): string[] | null {
  const selected = form.getAll("operatingDays");

  if (selected.length === 0) {
    return null;
  }

  const chosen = new Set<string>();

  for (const value of selected) {
    if (typeof value !== "string" || !PACKAGE_WEEKDAYS.includes(value as never)) {
      throw new InvalidPackageSubmissionError();
    }
    chosen.add(value);
  }

  return PACKAGE_WEEKDAYS.filter((day) => chosen.has(day));
}

/** A non-negative whole number. An empty box means the default, 0. */
function sortOrder(form: FormData): number {
  const raw = field(form, "sortOrder").trim();

  if (raw.length === 0) {
    return 0;
  }

  if (!/^\d+$/.test(raw)) {
    throw new InvalidPackageSubmissionError();
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) {
    throw new InvalidPackageSubmissionError();
  }

  return parsed;
}

/**
 * Turns the submitted form into exactly the API's create shape.
 *
 * Only the ten fields the endpoint accepts are read. `isActive` and anything
 * about ownership are not read even if a crafted submission adds them: a new
 * journey is always created unpublished and admin-owned, and that is the
 * API's decision, not a value this form can carry.
 *
 * The checks here exist to stop an obviously bad submission becoming a round
 * trip, and to turn form strings into the typed shape the client expects. The
 * API remains the authority on what is valid.
 */
export function parsePackageCreateForm(form: FormData): PackageCreateInput {
  return {
    code: identity(form, "code", 120),
    slug: identity(form, "slug", 120),
    title: requiredText(form, "title", 200),
    summary: optionalText(form, "summary", 500),
    description: optionalText(form, "description", 5000),
    durationLabel: optionalText(form, "durationLabel", 120),
    scheduleLabel: optionalText(form, "scheduleLabel", 120),
    operatingDays: operatingDays(form),
    // An unchecked box sends nothing at all, which is how HTML says false.
    requiresPriceConfirmation: form.get("requiresPriceConfirmation") !== null,
    sortOrder: sortOrder(form),
  };
}

export const packageEditHref = (slug: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}/edit`;

/** Exactly the fields `PATCH /api/v1/admin/packages/:slug` accepts. */
export type PackageUpdateInput = {
  title: string;
  summary: string | null;
  description: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: string[] | null;
  requiresPriceConfirmation: boolean;
  sortOrder: number;
};

/**
 * Turns the submitted edit form into exactly the API's update shape.
 *
 * The same eight fields the endpoint accepts, parsed by the same helpers the
 * create form uses — so a value that can be created can be edited to and back.
 *
 * `code` and `slug` are not read even if a crafted submission adds them: they
 * are the journey's identity, the API refuses a body that offers them, and
 * this form does not disagree. Neither is publication or ownership read;
 * ownership moves as a consequence of saving, not as a value sent.
 */
export function parsePackageEditForm(form: FormData): PackageUpdateInput {
  return {
    title: requiredText(form, "title", 200),
    summary: optionalText(form, "summary", 500),
    description: optionalText(form, "description", 5000),
    durationLabel: optionalText(form, "durationLabel", 120),
    scheduleLabel: optionalText(form, "scheduleLabel", 120),
    operatingDays: operatingDays(form),
    requiresPriceConfirmation: form.get("requiresPriceConfirmation") !== null,
    sortOrder: sortOrder(form),
  };
}

/**
 * What saving does to a brochure-owned journey, stated before it happens.
 *
 * Only for a journey the seed still owns. Editing one is a one-way door: the
 * catalogue seed stops reconciling it from that moment, so brochure
 * corrections will no longer reach it. There is deliberately no offer to undo
 * that here — no such action exists, and implying one would be worse than
 * saying nothing.
 */
export function packageOwnershipWarning(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Saving these changes makes it " +
    "admin-managed: later brochure updates will no longer reconcile or overwrite it, and that " +
    "cannot be undone here."
  );
}

export const packageVariantEditHref = (slug: string, key: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}/variants/${encodeURIComponent(key)}/edit`;

/** Exactly the fields the variant edit endpoint accepts. */
export type PackageVariantUpdateInput = {
  label: string;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
};

/** The checkbox that decides whether a child rule exists at all. */
const CHILD_PRICING_TOGGLE = "childPricingEnabled";

/**
 * A percentage as an exact two-decimal string.
 *
 * Normalised by padding the text, never by parsing a number: `"50"` and
 * `"50.5"` become `"50.00"` and `"50.50"` without a float ever touching the
 * value. The API stores `numeric(5,2)`, so two decimals is the one form it
 * accepts, and typing the trailing zeros should not be the administrator's
 * job.
 *
 * The bound is checked in hundredths with BigInt for the same reason.
 */
function childDiscountPercent(form: FormData): string {
  const raw = field(form, "childDiscountPercent").trim();

  const match = /^(\d{1,3})(?:\.(\d{1,2}))?(?![\s\S])/.exec(raw);

  if (!match) {
    throw new InvalidPackageSubmissionError();
  }

  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const normalised = `${whole}.${fraction}`;

  if (BigInt(whole + fraction) > 10000n) {
    throw new InvalidPackageSubmissionError();
  }

  return normalised;
}

/** A whole, non-negative age. */
function childAge(form: FormData, name: string): number {
  const raw = field(form, name).trim();

  if (!/^\d+$/.test(raw)) {
    throw new InvalidPackageSubmissionError();
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) {
    throw new InvalidPackageSubmissionError();
  }

  return parsed;
}

/**
 * Turns the submitted variant form into exactly the API's update shape.
 *
 * The child rule is all-or-nothing, and one checkbox decides which. Unticked,
 * the three age and discount boxes are not read at all and three nulls are
 * sent — so a half-filled rule left behind from a previous edit cannot leak
 * through. Ticked, all three are required; there is no way to express a
 * partial rule from this form, which is what the database CHECK demands.
 *
 * The variant's key, its default state, its order and its rates are not read
 * even if a crafted submission adds them: the identity is bound server-side,
 * and the API refuses a body that offers any of them.
 */
export function parsePackageVariantEditForm(form: FormData): PackageVariantUpdateInput {
  const label = requiredText(form, "label", 200);

  if (form.get(CHILD_PRICING_TOGGLE) === null) {
    return { label, childMinAge: null, childMaxAge: null, childDiscountPercent: null };
  }

  const min = childAge(form, "childMinAge");
  const max = childAge(form, "childMaxAge");

  if (max < min) {
    throw new InvalidPackageSubmissionError();
  }

  return {
    label,
    childMinAge: min,
    childMaxAge: max,
    childDiscountPercent: childDiscountPercent(form),
  };
}

/**
 * Whether this screen may offer to delete the journey at all.
 *
 * `hidden` — the journey is live. Permanent removal is not offered until it
 * has been withdrawn and seen to be gone.
 * `available` — a delete may be attempted. Whether it succeeds is still the
 * backend's to decide.
 *
 * Only publication is judged here, and deliberately so. The backend refuses a
 * journey whose CODE or SLUG belongs to the brochure catalogue, which is a
 * question only it can answer: `managementSource` is not the same fact — a
 * journey that was once the brochure's and has since become an
 * administrator's still carries a brochure identity — and reconstructing the
 * brochure's forty-two identities in the browser would be a second copy of a
 * list that would drift. So the control is offered and the refusal, if it
 * comes, is reported.
 */
export type PackageDeleteState = "hidden" | "available";

export function packageDeleteState(journey: { isActive: boolean }): PackageDeleteState {
  return journey.isActive ? "hidden" : "available";
}

export const PACKAGE_DELETE_BLOCKED_NOTE =
  "This journey is active, so it cannot be deleted. Deactivate it first, check that it is gone "
  + "from the website, then delete it.";

/**
 * What the administrator is about to destroy, named precisely.
 *
 * Title, code and slug together: a title can be duplicated, and the code and
 * slug are what actually identify the row.
 */
export function packageDeleteConfirmation(journey: {
  title: string;
  code: string;
  slug: string;
}): string {
  return (
    `Permanently delete “${journey.title}” (${journey.code} / ${journey.slug})? ` +
    "This removes the journey and every variant, rate, itinerary section and content line it " +
    "has. It cannot be undone. A journey that has ever been booked cannot be deleted at all — " +
    "bookings are kept as a record of what was sold."
  );
}

export const DELETE_PACKAGE_LABEL = "Delete this journey permanently";

/**
 * Guidance for a journey the brochure catalogue manages.
 *
 * Shown as advice rather than as a verdict. The backend decides on the
 * journey's code and slug, which this app cannot see; what it can see is that
 * the catalogue seed currently owns the row, and every such row exists
 * because the brochure lists it. Saying so beforehand saves an administrator
 * a refusal they can already anticipate.
 *
 * No resync or reseed control is offered, because none exists.
 */
export function packageDeleteBrochureAdvisory(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey is managed by the brochure catalogue. Brochure journeys cannot be deleted — " +
    "the catalogue seed recreates them — so deactivating it is the durable way to keep it off " +
    "the public site."
  );
}

/**
 * What this screen may offer for one variant.
 *
 * `hidden` — the journey is live, so nothing is offered at all. Removing a
 * variant takes away the thing a booking resolves to, and the backend refuses
 * it outright.
 * `blocked-default` — this variant leads the journey and others remain. The
 * remedy is to choose another default first, so the note says that instead of
 * offering a button that could only fail.
 * `available` — a delete may be attempted. Whether it succeeds is still the
 * backend's to decide: whether the variant has ever been booked is not asked
 * here, and could not be answered honestly from a page this old.
 */
export type PackageVariantDeleteState = "hidden" | "blocked-default" | "available";

export function packageVariantDeleteState(
  journey: { isActive: boolean; variants: readonly unknown[] },
  variant: { isDefault: boolean },
): PackageVariantDeleteState {
  if (journey.isActive) {
    return "hidden";
  }

  // The last variant is deletable even though it almost always leads the
  // journey: there is no successor to choose, so no choice is being made.
  if (variant.isDefault && journey.variants.length > 1) {
    return "blocked-default";
  }

  return "available";
}

export const DEFAULT_BLOCKS_DELETE_NOTE =
  "This variant leads the journey, so it cannot be deleted while others remain. "
  + "Make another variant the default first.";

/**
 * What the administrator is about to do, named precisely.
 *
 * Both the label and the key, because a journey can carry two variants whose
 * labels read alike, and the key is the thing that is actually unique.
 */
export function packageVariantDeleteConfirmation(variant: {
  key: string;
  label: string;
}): string {
  return (
    `Delete “${variant.label}” (${variant.key})? This removes the variant and its rates ` +
    "permanently, and cannot be undone."
  );
}

export const DELETE_VARIANT_LABEL = "Delete variant";

/**
 * What deleting a variant does to a brochure-owned journey.
 *
 * Shown only where a delete is actually on offer. A live journey has no
 * controls, and a journey whose only deletable variant is blocked by the
 * default rule has none either — warning about ownership in those cases would
 * be warning about something no button can do.
 *
 * No revert is offered, because none exists.
 */
export function packageVariantDeleteOwnershipWarning(journey: {
  isActive: boolean;
  managementSource: "brochure" | "admin";
  variants: readonly { isDefault: boolean }[];
}): string | null {
  if (journey.managementSource !== "brochure") {
    return null;
  }

  const deletable = journey.variants.some(
    (variant) => packageVariantDeleteState(journey, variant) === "available",
  );

  if (!deletable) {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Deleting a variant makes the whole " +
    "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, and " +
    "that cannot be undone here."
  );
}

/** Which way a variant can travel in the running order. */
export type PackageVariantMoveDirection = "up" | "down";

/**
 * The COMPLETE order that moving one variant would produce, or null when
 * that move does not exist.
 *
 * A whole list, never a key and a direction. The API takes the end state and
 * checks it against the journey's actual variants, so building the list here
 * is what makes a stale page detectable: if a variant was added since this
 * page rendered, the list it submits no longer matches the set and the
 * request is refused rather than half-applied. A key-and-direction request
 * would instead be interpreted against whatever order the server found, which
 * is how two administrators rearranging at once produce something neither
 * asked for.
 *
 * Returns null for the first variant moving up, the last moving down, and any
 * journey with fewer than two variants — the caller renders no control at all
 * in those cases rather than one that would do nothing.
 *
 * Keys are carried through exactly as the journey reported them. Nothing is
 * trimmed or recased: these are identities, and a repaired key is not the key
 * of any variant.
 */
export function packageVariantMove(
  keys: readonly string[],
  index: number,
  direction: PackageVariantMoveDirection,
): string[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
    return null;
  }

  const target = direction === "up" ? index - 1 : index + 1;

  if (target < 0 || target >= keys.length) {
    return null;
  }

  const moved = [...keys];
  const [lifted] = moved.splice(index, 1);
  moved.splice(target, 0, lifted!);

  return moved;
}

/**
 * Both moves available to one variant, each as a complete order.
 *
 * Computed together so a caller renders the pair from one decision rather
 * than asking twice and risking two different answers.
 */
export function packageVariantMoves(
  keys: readonly string[],
  index: number,
): { up: string[] | null; down: string[] | null } {
  return {
    up: packageVariantMove(keys, index, "up"),
    down: packageVariantMove(keys, index, "down"),
  };
}

export const MOVE_UP_LABEL = "Move up";
export const MOVE_DOWN_LABEL = "Move down";

/**
 * What the variants panel says about the running order.
 *
 * Nothing about publication: unlike adding a variant or moving the default,
 * rearranging is allowed on a live journey. No part of a booking reads a
 * variant's position — it decides what a guest sees listed, not what an
 * unqualified booking resolves to or what it costs.
 */
export function packageVariantOrderNote(variantCount: number): string {
  return variantCount < 2
    ? "The order matters once a journey has more than one variant."
    : "This is the order guests see the variants in. It does not change which variant a booking "
      + "resolves to, or what it costs.";
}

/**
 * What saving a new order does to a brochure-owned journey.
 *
 * Shown only where a move is actually on offer — a journey with fewer than
 * two variants has none — so the warning is never about a change no button
 * can make. Merely looking at the controls changes nothing; the wording says
 * "saving a new order", not "opening this page".
 *
 * No revert is offered, because none exists.
 */
export function packageVariantOrderOwnershipWarning(journey: {
  managementSource: "brochure" | "admin";
  variants: readonly unknown[];
}): string | null {
  if (journey.managementSource !== "brochure" || journey.variants.length < 2) {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Saving a new order makes the whole " +
    "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, and " +
    "that cannot be undone here."
  );
}

/** The one control this slice offers, or nothing at all. */
export type PackageDefaultVariantAction = {
  label: string;
  pendingLabel: string;
  tone: "confirm";
};

/**
 * Whether this variant may be made the one the journey leads with.
 *
 * Two reasons to offer nothing, and they are different facts. A variant that
 * already leads has nothing to ask for — the API would treat it as an
 * idempotent success, but a button that does nothing is a button that lies.
 * And on a live journey no variant may be promoted at all, because moving the
 * default changes what a booking without a named variant resolves to.
 *
 * There is deliberately no second control. Clearing the default is not
 * offered anywhere: a journey with several variants and none leading refuses
 * every reservation that names no variant, so it is a state to repair, never
 * one to create.
 */
export function packageDefaultVariantAction(
  journey: { isActive: boolean },
  variant: { isDefault: boolean },
): PackageDefaultVariantAction | null {
  if (variant.isDefault || journey.isActive) {
    return null;
  }

  return { label: "Make default", pendingLabel: "Making default…", tone: "confirm" };
}

/**
 * What the variants panel says about the default, given where the journey
 * stands.
 *
 * A live journey gets the reason rather than the control. Nothing here
 * withdraws it — that is a separate, deliberate act on this same page.
 */
export function packageDefaultVariantNote(journey: { isActive: boolean }): string {
  return journey.isActive
    ? "The default is the variant a booking resolves to when a guest names none. It can only be "
      + "changed while the journey is inactive, because moving it changes what those bookings "
      + "resolve to. Deactivate the journey first."
    : "The default is the variant a booking resolves to when a guest names none. Exactly one "
      + "variant leads a journey, so choosing another moves it.";
}

/**
 * What promoting a different variant does to a brochure-owned journey.
 *
 * Shown only where a promotion is actually on offer: a live journey has no
 * such control, and a journey whose every variant already leads — the
 * single-variant case — has nothing to promote. Claiming ownership would move
 * when no button exists to move it would be a warning about nothing.
 *
 * No revert is offered, because none exists.
 */
export function packageDefaultVariantOwnershipWarning(journey: {
  isActive: boolean;
  managementSource: "brochure" | "admin";
  variants: readonly { isDefault: boolean }[];
}): string | null {
  if (journey.managementSource !== "brochure" || journey.isActive) {
    return null;
  }

  if (!journey.variants.some((variant) => !variant.isDefault)) {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Choosing a different default makes " +
    "the whole journey admin-managed: later brochure updates will no longer reconcile or " +
    "overwrite it, and that cannot be undone here."
  );
}

export const packageItineraryHref = (slug: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}/itinerary`;

/** Exactly the fields one itinerary section carries. */
export type PackageItinerarySectionInput = {
  dayNumber: number | null;
  heading: string | null;
  body: string;
};

/** Blank rows offered beneath the existing sections, for adding more. */
export const SPARE_ITINERARY_ROWS = 3;

/** The API's own bounds, restated so the form refuses before the round trip. */
export const MAX_ITINERARY_SECTIONS = 100;
export const MAX_ITINERARY_HEADING_LENGTH = 200;
export const MAX_ITINERARY_BODY_LENGTH = 2000;
export const MAX_ITINERARY_DAY_NUMBER = 2147483647;

/**
 * How many rows the form should offer.
 *
 * The sections it already has plus a few blanks, capped so the form cannot
 * present more rows than the API would accept — a hundred filled rows and
 * three spares would be a form that can only be refused.
 */
export function packageItineraryRowCount(existing: number): number {
  return Math.min(existing + SPARE_ITINERARY_ROWS, MAX_ITINERARY_SECTIONS);
}

/** Raised only when an itinerary carries more sections than the API accepts. */
export class TooManyItinerarySectionsError extends Error {}

/** One row's three boxes, as strings straight off the form. */
function itineraryRow(form: FormData, index: number): [string, string, string] {
  const read = (name: string, values: FormDataEntryValue[]): string => {
    const value = values[index];

    if (typeof value !== "string") {
      throw new InvalidPackageSubmissionError();
    }

    return value;
  };

  return [
    read("dayNumber", form.getAll("dayNumber")),
    read("heading", form.getAll("heading")),
    read("body", form.getAll("body")),
  ];
}

/**
 * Turns the submitted itinerary form into exactly the API's section list.
 *
 * Each field is a set of identically named inputs, so the three arrive as
 * parallel arrays and a row is one index across all three.
 *
 * A row with all three boxes empty is an unused slot — or a section the
 * administrator cleared — and is skipped. A row with ANY box filled is a
 * section being described, so it is validated rather than discarded: silently
 * dropping a half-written section would lose work without saying so.
 *
 * Within a used row, an empty day number and an empty heading become null,
 * because null is what "no particular day" and "no heading" mean in this
 * contract. The body is required, since a section with nothing to say is not
 * a section.
 *
 * Whitespace in the heading or body is NOT repaired. A box holding only
 * spaces, or text with a leading or trailing space, is refused rather than
 * quietly trimmed: the API refuses untrimmed text too, and silently altering
 * what someone typed is worse than telling them. The day number is the one
 * exception — it is a numeric box, not an identity, so surrounding space is
 * trimmed before it is read, exactly as the rate editor treats its own
 * numeric fields.
 *
 * Order is the row order, and duplicates are preserved: two sections can
 * legitimately read alike.
 */
export function parsePackageItineraryForm(form: FormData): PackageItinerarySectionInput[] {
  const days = form.getAll("dayNumber");
  const headings = form.getAll("heading");
  const bodies = form.getAll("body");

  // Three parallel arrays that disagree are a form this app did not render.
  if (days.length !== headings.length || days.length !== bodies.length) {
    throw new InvalidPackageSubmissionError();
  }

  const sections: PackageItinerarySectionInput[] = [];

  for (let index = 0; index < days.length; index += 1) {
    const [rawDay, rawHeading, rawBody] = itineraryRow(form, index);

    // An untouched spare, or a section cleared to remove it.
    if (rawDay === "" && rawHeading === "" && rawBody === "") {
      continue;
    }

    sections.push({
      dayNumber: itineraryDayNumber(rawDay),
      heading: itineraryHeading(rawHeading),
      body: itineraryBody(rawBody),
    });
  }

  if (sections.length > MAX_ITINERARY_SECTIONS) {
    throw new TooManyItinerarySectionsError();
  }

  return sections;
}

/** Blank means "no particular day"; anything else must be a whole day number. */
function itineraryDayNumber(raw: string): number | null {
  // Trimmed before reading, unlike the prose fields: this is a numeric box,
  // not an identity, so surrounding space carries no meaning to preserve.
  const value = raw.trim();

  if (value === "") {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw new InvalidPackageSubmissionError();
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ITINERARY_DAY_NUMBER) {
    throw new InvalidPackageSubmissionError();
  }

  return parsed;
}

/** Blank means "no heading"; anything else must be canonical text. */
function itineraryHeading(raw: string): string | null {
  if (raw === "") {
    return null;
  }

  if (raw !== raw.trim() || raw.length > MAX_ITINERARY_HEADING_LENGTH) {
    throw new InvalidPackageSubmissionError();
  }

  return raw;
}

/** Required: a section with nothing to say is not a section. */
function itineraryBody(raw: string): string {
  if (raw === "" || raw !== raw.trim() || raw.length > MAX_ITINERARY_BODY_LENGTH) {
    throw new InvalidPackageSubmissionError();
  }

  return raw;
}

/**
 * What saving an itinerary change does to a brochure-owned journey.
 *
 * The wording is about saving, never about opening the page: looking at the
 * form changes nothing, and the API treats resubmitting the itinerary a
 * journey already has as a no-op that moves no ownership.
 *
 * No revert is offered, because none exists.
 */
export function packageItineraryOwnershipWarning(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Saving a change here makes the whole " +
    "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, and " +
    "that cannot be undone here."
  );
}

export const packageContentHref = (slug: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}/content`;

/** Exactly the three lists the content endpoint accepts. */
export type PackageContentInput = {
  included: string[];
  excluded: string[];
  notes: string[];
};

/** The three lists, in the order the form presents them. */
export const PACKAGE_CONTENT_LISTS = ["included", "excluded", "notes"] as const;

export type PackageContentList = (typeof PACKAGE_CONTENT_LISTS)[number];

export const PACKAGE_CONTENT_LIST_LABELS: Record<PackageContentList, string> = {
  included: "Included",
  excluded: "Excluded",
  notes: "Notes",
};

/** Blank rows offered beneath the existing entries, for adding more. */
export const SPARE_CONTENT_ROWS = 3;

/** The API's own bounds, restated so the form refuses before the round trip. */
export const MAX_CONTENT_ENTRIES = 100;
export const MAX_CONTENT_ENTRY_LENGTH = 500;

/**
 * How many rows one list should offer.
 *
 * The entries it already has plus a few blanks, capped so the form cannot
 * present more rows than the API would accept — a hundred filled rows and
 * three spares would be a form that can only be refused.
 */
export function packageContentRowCount(existing: number): number {
  return Math.min(existing + SPARE_CONTENT_ROWS, MAX_CONTENT_ENTRIES);
}

/** Raised when a list carries more entries than the API accepts. */
export class TooManyContentEntriesError extends Error {}

/**
 * Turns the submitted content form into exactly the API's replacement shape.
 *
 * Each list is a set of identically named inputs, so they arrive as an
 * ordered array. A row left completely empty is an unused slot — or an entry
 * the administrator cleared — and is skipped; everything else must be a real
 * value.
 *
 * Whitespace is NOT repaired. A row holding only spaces, or text with a
 * leading or trailing space, is refused rather than quietly trimmed: the API
 * refuses untrimmed text too, and silently altering what someone typed is
 * worse than telling them. That is also why the skip test is for the exactly
 * empty string rather than for blank-after-trim — a row of spaces is
 * something typed, so it is reported instead of vanishing.
 *
 * Duplicates are preserved, and so is order: two items can legitimately read
 * alike, and the order is what a guest sees.
 *
 * All three lists are always returned, even when empty. This is a whole-set
 * replacement, and an omitted list would be ambiguous between leaving it and
 * clearing it.
 */
export function parsePackageContentForm(form: FormData): PackageContentInput {
  const content: PackageContentInput = { included: [], excluded: [], notes: [] };

  for (const list of PACKAGE_CONTENT_LISTS) {
    const rows = form.getAll(list);

    for (const row of rows) {
      if (typeof row !== "string") {
        throw new InvalidPackageSubmissionError();
      }

      // An untouched spare, or an entry cleared to remove it.
      if (row === "") {
        continue;
      }

      if (row !== row.trim() || row.length > MAX_CONTENT_ENTRY_LENGTH) {
        throw new InvalidPackageSubmissionError();
      }

      content[list].push(row);
    }

    if (content[list].length > MAX_CONTENT_ENTRIES) {
      throw new TooManyContentEntriesError();
    }
  }

  return content;
}

/** Whether two content sets are the same lists in the same order. */
export function packageContentMatches(
  left: PackageContentInput,
  right: PackageContentInput,
): boolean {
  return PACKAGE_CONTENT_LISTS.every((list) => {
    const a = left[list];
    const b = right[list];

    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  });
}

/**
 * What saving a content change does to a brochure-owned journey.
 *
 * The wording is about saving, never about opening the page: looking at the
 * form changes nothing, and the API treats resubmitting the content a journey
 * already has as a no-op that moves no ownership.
 *
 * No revert is offered, because none exists.
 */
export function packageContentOwnershipWarning(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Saving a change here makes the whole " +
    "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, and " +
    "that cannot be undone here."
  );
}

export const packageVariantNewHref = (slug: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}/variants/new`;

/** Exactly the fields the variant create endpoint accepts. */
export type PackageVariantCreateInput = {
  key: string;
  label: string;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
};

/**
 * Turns the submitted new-variant form into exactly the API's create shape.
 *
 * The key is read with the identity rule rather than the prose one, so it is
 * submitted exactly as typed. The API refuses a key with surrounding
 * whitespace rather than repairing it, and this form must not disagree:
 * quietly trimming would create a variant under a key the administrator did
 * not type, and a key cannot be changed afterwards. Its format is the API's
 * to judge — one authority, not two that could drift.
 *
 * The child rule is the same all-or-nothing trio an edit uses, decided by the
 * same checkbox, so a variant that can be created can be edited to and back.
 *
 * The default flag, the position and the rates are not read even if a crafted
 * submission adds them: both server-owned fields are derived by the API from
 * the variants the journey already has, and rates are a separate step.
 */
export function parsePackageVariantCreateForm(form: FormData): PackageVariantCreateInput {
  return {
    key: identity(form, "key", 120),
    ...parsePackageVariantEditForm(form),
  };
}

/**
 * Whether a variant may be added to this journey at all.
 *
 * A new variant is created with no rate tiers, so it is not reservable the
 * moment it appears; adding one to a live journey would put a choice on the
 * website that refuses every reservation made against it. The API enforces
 * this, and the form asks the same question first so the administrator is
 * told why rather than watching a round trip fail.
 *
 * `requiresPriceConfirmation` is deliberately not consulted. A quoted-on-
 * request journey still resolves a rate tier before it accepts anything;
 * being quoted changes what a guest is told about the price, not whether a
 * tier exists.
 */
export function packageAllowsVariantCreate(journey: { isActive: boolean }): boolean {
  return !journey.isActive;
}

export const VARIANT_CREATE_BLOCKED_MESSAGE =
  "This journey is active, so a variant cannot be added to it yet. A new variant starts with no "
  + "rates, and guests would be offered a choice that refuses every reservation. Deactivate the "
  + "journey first, add the variant, price it, then offer it again.";

/**
 * What the server will decide about this variant, said plainly beforehand.
 *
 * Neither is offered as a control: which variant leads a journey and what
 * order the choices read in are the API's to assign, and changing them is a
 * separate operation that does not exist yet. Saying so is the alternative to
 * an administrator discovering it afterwards.
 */
export function packageVariantDefaultNote(variantCount: number): string {
  return variantCount === 0
    ? "This is the journey's first variant, so it will automatically become the default — the one "
      + "a booking resolves to when a guest names no variant."
    : "This variant will be added after the ones the journey already has, and the variant that "
      + "currently leads the journey will keep leading it.";
}

/**
 * What creating a variant does to a brochure-owned journey.
 *
 * The same principle as the edit warning, said about an addition: the seed
 * reconciles the whole variant set of a journey it owns and refuses outright
 * when it finds a variant the brochure does not list, so creating one has to
 * move ownership. No revert is offered, because none exists.
 */
export function packageVariantCreateOwnershipWarning(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Adding a variant makes the whole " +
    "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, and " +
    "that cannot be undone here."
  );
}

/** Whether a variant currently carries a child rule. */
export function hasChildPricing(variant: {
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
}): boolean {
  return variant.childMinAge !== null
    && variant.childMaxAge !== null
    && variant.childDiscountPercent !== null;
}

/**
 * What saving a variant edit does to a brochure-owned journey.
 *
 * The same principle as the package-level warning, said about the whole
 * journey rather than the one variant: editing any part of it is what moves
 * ownership. No revert is offered, because none exists.
 */
export function packageVariantOwnershipWarning(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Saving this variant makes the whole " +
    "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, and " +
    "that cannot be undone here."
  );
}

export const packageRatesHref = (slug: string, key: string) =>
  `/admin/journeys/${encodeURIComponent(slug)}/variants/${encodeURIComponent(key)}/rates`;

/** One tier exactly as the replacement endpoint accepts it. No currency. */
export type PackageRateTierInput = {
  minPartySize: number;
  maxPartySize: number | null;
  adultUnitRate: string;
};

/** How many blank slots the editor offers beyond the tiers that exist. */
export const SPARE_RATE_ROWS = 3;

/** A party size: a whole number above zero. */
function partySize(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new InvalidPackageSubmissionError();
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new InvalidPackageSubmissionError();
  }

  return parsed;
}

/**
 * An amount as an exact two-decimal string.
 *
 * Normalised by padding the text, never by parsing a number: `"80"` and
 * `"80.5"` become `"80.00"` and `"80.50"` without a float ever touching the
 * value, and the upper bound is compared in minor units with BigInt. Money is
 * the one thing in this form that must survive exactly as written.
 */
function adultUnitRate(raw: string): string {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?(?![\s\S])/.exec(raw);

  if (!match) {
    throw new InvalidPackageSubmissionError();
  }

  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(2, "0");

  if (BigInt(whole + fraction) > 999999999999n) {
    throw new InvalidPackageSubmissionError();
  }

  return `${whole}.${fraction}`;
}

/**
 * Whether any two tiers cover the same party size.
 *
 * The same rule the API applies, restated here rather than imported: the two
 * apps share no code, and a form that submitted a set it could already see
 * was impossible would waste a round trip to be told so. The API remains the
 * authority — this only catches the obvious case earlier.
 *
 * Sorted by lower bound, then each tier compared with the one before it. An
 * open-ended tier swallows everything after it, so a null upper bound
 * anywhere but last is an overlap.
 */
export function rateRowsOverlap(rates: readonly PackageRateTierInput[]): boolean {
  const sorted = [...rates].sort((left, right) => left.minPartySize - right.minPartySize);

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;

    if (previous.maxPartySize === null || current.minPartySize <= previous.maxPartySize) {
      return true;
    }
  }

  return false;
}

/** Raised when the submitted rows describe an impossible price list. */
export class OverlappingRateRowsError extends Error {}

/**
 * Turns the submitted rate rows into exactly the API's replacement shape.
 *
 * The editor renders a fixed number of row slots, so the three fields arrive
 * as parallel arrays. A row with all three boxes empty is not a tier — it is
 * an unused slot, or one the administrator cleared to remove it — and is
 * skipped. A row with some boxes filled and others empty is a mistake worth
 * reporting rather than guessing at.
 *
 * Returned sorted by `minPartySize`, so the same set of rows always
 * serializes identically whatever order they were typed in.
 */
export function parsePackageRatesForm(form: FormData): PackageRateTierInput[] {
  const mins = form.getAll("minPartySize");
  const maxes = form.getAll("maxPartySize");
  const amounts = form.getAll("adultUnitRate");

  if (mins.length !== maxes.length || mins.length !== amounts.length) {
    throw new InvalidPackageSubmissionError();
  }

  const rates: PackageRateTierInput[] = [];

  for (let index = 0; index < mins.length; index += 1) {
    const min = mins[index];
    const max = maxes[index];
    const amount = amounts[index];

    if (typeof min !== "string" || typeof max !== "string" || typeof amount !== "string") {
      throw new InvalidPackageSubmissionError();
    }

    const trimmedMin = min.trim();
    const trimmedMax = max.trim();
    const trimmedAmount = amount.trim();

    // An entirely empty row is an unused slot, not a tier.
    if (trimmedMin === "" && trimmedMax === "" && trimmedAmount === "") {
      continue;
    }

    // A blank upper bound is the open-ended "3 or more"; the other two are
    // required for any row that says anything at all.
    if (trimmedMin === "" || trimmedAmount === "") {
      throw new InvalidPackageSubmissionError();
    }

    const minPartySize = partySize(trimmedMin);
    const maxPartySize = trimmedMax === "" ? null : partySize(trimmedMax);

    if (maxPartySize !== null && maxPartySize < minPartySize) {
      throw new InvalidPackageSubmissionError();
    }

    rates.push({ minPartySize, maxPartySize, adultUnitRate: adultUnitRate(trimmedAmount) });
  }

  if (rateRowsOverlap(rates)) {
    throw new OverlappingRateRowsError();
  }

  return [...rates].sort((left, right) => left.minPartySize - right.minPartySize);
}

/**
 * Whether this journey may have no rate tiers at all.
 *
 * An active journey priced from its tiers would stay on the website and
 * refuse every reservation, so it must keep at least one. The API decides
 * this too; knowing it here lets the form say so before a round trip, and
 * lets the editor explain the rule rather than simply refusing.
 */
export function packageAllowsEmptyRates(journey: {
  isActive: boolean;
  requiresPriceConfirmation: boolean;
}): boolean {
  return !journey.isActive || journey.requiresPriceConfirmation;
}

/** Why an empty set is refused, for the journey that refuses it. */
export const RATES_REQUIRED_MESSAGE =
  "This journey is active and priced from its rate tiers, so it must keep at least one. "
  + "Deactivate it, or mark it quoted on request, before removing them all.";

/** What saving rates does to a brochure-owned journey. */
export function packageRatesOwnershipWarning(
  managementSource: "brochure" | "admin",
): string | null {
  if (managementSource !== "brochure") {
    return null;
  }

  return (
    "This journey still comes from the brochure catalogue. Saving these rates makes the whole "
    + "journey admin-managed: later brochure updates will no longer reconcile or overwrite it, "
    + "and that cannot be undone here."
  );
}
