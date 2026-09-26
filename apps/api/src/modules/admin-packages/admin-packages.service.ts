import {
  isReservedBrochureCode,
  isReservedBrochureSlug,
} from './admin-packages.brochure';
import {
  findAdminPackageBySlug,
  findAdminPackages,
  insertAdminPackage,
  deleteAdminPackage,
  deleteAdminPackageVariant,
  replaceAdminPackageContent,
  replaceAdminPackageItinerary,
  insertAdminPackageVariant,
  reorderAdminPackageVariants as reorderVariants,
  setAdminPackageDefaultVariant,
  updateAdminPackageActiveState,
  updateAdminPackageFields,
  replaceAdminPackageVariantRates,
  updateAdminPackageVariant,
  type AdminPackageContentReplaceResult,
  type AdminPackageDeleteResult,
  type AdminPackageItineraryReplaceResult,
  type AdminPackageCreateResult,
  type AdminPackageDefaultVariantResult,
  type AdminPackageVariantDeleteResult,
  type AdminPackageVariantOrderResult,
  type AdminPackageRatesReplaceResult,
  type AdminPackageVariantCreateResult,
  type AdminPackageVariantEditResult,
} from './admin-packages.repository';
import type {
  AdminPackageContentReplacementInput,
  AdminPackageItinerarySection,
  AdminPackageCreateInput,
  AdminPackageDetail,
  AdminPackageList,
  AdminPackageUpdateInput,
  AdminPackageRateTierInput,
  AdminPackageVariantCreateInput,
  AdminPackageVariantUpdateInput,
} from './admin-packages.types';

/**
 * Reads the whole catalogue for the administration list, in running order.
 *
 * Thin by design, and deliberately still here: it is the seam where the rules
 * this list will grow belong — filtering by active or by management source, a
 * search, a pagination window — so neither the controller nor the repository
 * has to take on HTTP or SQL concerns to accommodate them.
 *
 * Knows nothing about Express, and returns domain data with no response
 * envelope around it. Authentication happens in the route chain, never here.
 *
 * Read-only: nothing in this module writes, so the catalogue seed and its
 * reconciliation are untouched by it.
 */
export async function listAdminPackages(): Promise<AdminPackageList> {
  return findAdminPackages();
}

/**
 * Reads one package by slug, active or not.
 *
 * Thin on purpose, and read-only. The slug arrives already validated and is
 * used exactly as given: normalising it here would mean looking up a value
 * the caller never sent.
 *
 * Returns null only when no package has that slug. A stored row that cannot
 * be trusted raises from the repository instead, so a data fault never
 * reaches a caller disguised as a missing package.
 */
export async function getAdminPackage(slug: string): Promise<AdminPackageDetail | null> {
  return findAdminPackageBySlug(slug);
}

/**
 * Publishes or withdraws one package.
 *
 * Thin on purpose. There is no rule here about which packages may be
 * withdrawn: both brochure-owned and admin-owned offerings can be, and the
 * repository writes the one column either way.
 *
 * Returns null only when no package has that slug. Asking for the state a
 * package already holds is an ordinary success, not a conflict — an
 * administrator who clicks twice has said the same true thing twice.
 */
export async function setAdminPackageActiveState(
  slug: string,
  isActive: boolean,
): Promise<AdminPackageDetail | null> {
  return updateAdminPackageActiveState(slug, isActive);
}

/** What creating a journey can answer, as values rather than thrown errors. */
export type CreateAdminPackageResult =
  | AdminPackageCreateResult
  | { outcome: 'reserved-brochure-identity' };

/**
 * Creates one admin-owned journey.
 *
 * The brochure check happens here, before the insert, and it is the reason
 * this service is not a pass-through. A unique constraint can only refuse a
 * code that is already in the table; the brochure owns its forty-two
 * identities whether or not they have been seeded yet, and taking one would
 * either be silently overwritten on the next seed run or block that run from
 * inserting the offering it owns. Neither failure is visible at the moment it
 * is caused, so it is refused at the moment it is asked for.
 *
 * Code and slug are checked independently: either one being reserved is
 * enough, and which it was is not worth telling a caller who must change the
 * request either way.
 *
 * Everything else — an ordinary duplicate against a row that does exist — is
 * left to the database, which is the only place that can answer it without a
 * race.
 */
export async function createAdminPackage(
  input: AdminPackageCreateInput,
): Promise<CreateAdminPackageResult> {
  if (isReservedBrochureCode(input.code) || isReservedBrochureSlug(input.slug)) {
    return { outcome: 'reserved-brochure-identity' };
  }

  return insertAdminPackage(input);
}

/**
 * Rewrites one journey's package-level fields.
 *
 * Thin on purpose. There is no rule here about which journeys may be edited:
 * a brochure-owned one may be, and doing so is precisely what moves it to the
 * administrator. The repository performs that move in the same statement, so
 * there is no window in which an edited journey is still seed-owned.
 *
 * Returns null only when no journey has that slug.
 */
export async function editAdminPackage(
  slug: string,
  input: AdminPackageUpdateInput,
): Promise<AdminPackageDetail | null> {
  return updateAdminPackageFields(slug, input);
}

/**
 * Adds one variant to an existing journey.
 *
 * Thin on purpose, and thin for a specific reason: every rule that governs
 * this needs the package row the transaction locks. Whether the journey may
 * take a rate-less variant depends on its publication state, and what the new
 * variant's position and default flag must be depends on the variants it
 * already has — all of which could change between a check made here and the
 * write made there. So the repository owns them, and this seam exists for the
 * rules that will not need the lock.
 *
 * There is deliberately no brochure-identity check of the kind creating a
 * journey performs. A variant key is unique within its journey rather than
 * globally, and adding a variant to a brochure journey is allowed — doing so
 * is precisely what moves that journey to the administrator.
 */
export async function addAdminPackageVariant(
  slug: string,
  input: AdminPackageVariantCreateInput,
): Promise<AdminPackageVariantCreateResult> {
  return insertAdminPackageVariant(slug, input);
}

/**
 * Rewrites one variant's metadata.
 *
 * Thin on purpose. There is no rule here about which variants may be edited:
 * a brochure-owned package's variant may be, and doing so is what moves that
 * package to the administrator. The repository performs the edit and the
 * ownership move in one transaction, so there is no window in which an edited
 * variant belongs to a journey the seed still reconciles.
 *
 * The two ways of not finding the variant are reported separately, because an
 * administrator who mistyped the journey needs to go somewhere different from
 * one who mistyped the variant.
 */
export async function editAdminPackageVariant(
  slug: string,
  key: string,
  input: AdminPackageVariantUpdateInput,
): Promise<AdminPackageVariantEditResult> {
  return updateAdminPackageVariant(slug, key, input);
}

/**
 * Replaces a journey's itinerary.
 *
 * Thin on purpose. The only question that matters — whether the submitted
 * sections already are the stored ones — can only be answered against rows
 * read under the package lock, so the repository owns it.
 *
 * There is deliberately no publication rule here. The itinerary is prose on
 * the detail page and no part of the reservation path reads it, so rewriting
 * it on a live journey changes nothing a guest can book.
 */
export async function setAdminPackageItinerary(
  slug: string,
  sections: readonly AdminPackageItinerarySection[],
): Promise<AdminPackageItineraryReplaceResult> {
  return replaceAdminPackageItinerary(slug, sections);
}

/**
 * Replaces a journey's three content lists.
 *
 * Thin on purpose. The only question that matters — whether the submitted
 * lists already are the stored ones — can only be answered against rows read
 * under the package lock, so the repository owns it.
 *
 * There is deliberately no publication rule here. These rows are prose on the
 * detail page and no part of the reservation path reads them, so rewriting
 * them on a live journey changes nothing a guest can book.
 */
export async function setAdminPackageContent(
  slug: string,
  content: AdminPackageContentReplacementInput,
): Promise<AdminPackageContentReplaceResult> {
  return replaceAdminPackageContent(slug, content);
}

/**
 * Removes one journey and everything it owns.
 *
 * Thin on purpose, and unusually so: every one of the three refusals needs
 * the package row the transaction locks. Whether it is still on sale, what
 * identity it currently carries, and whether it has ever been booked are all
 * questions that can only be answered against state no concurrent writer can
 * move, so the repository owns all three.
 *
 * That includes the brochure identity check, which sits in the repository
 * rather than here — unlike the one guarding package creation, which can be
 * answered from the request alone. This one is about the code and slug the
 * row currently has, and reading those before the lock would be judging a
 * journey that could already have been renamed.
 */
export async function removeAdminPackage(slug: string): Promise<AdminPackageDeleteResult> {
  return deleteAdminPackage(slug);
}

/**
 * Removes one variant from a journey.
 *
 * Thin on purpose. Every rule needs the package row the transaction locks —
 * whether the journey may lose a variant at all depends on its publication
 * state, whether this one may go depends on the siblings it has, and whether
 * it has ever been booked can only be asked safely while no new booking can
 * be taken. So the repository owns all three.
 */
export async function removeAdminPackageVariant(
  slug: string,
  key: string,
): Promise<AdminPackageVariantDeleteResult> {
  return deleteAdminPackageVariant(slug, key);
}

/**
 * Rearranges a journey's variants.
 *
 * Thin on purpose. Every rule needs the rows the transaction locks — whether
 * the submitted list is the journey's whole variant set can only be answered
 * against them, and answering it before the lock would be answering about a
 * set that could already have changed.
 *
 * There is deliberately no publication rule here. Reordering is allowed on a
 * live journey because no part of the reservation path reads a variant's
 * position; the repository says why at length.
 */
export async function reorderAdminPackageVariants(
  slug: string,
  variantKeys: readonly string[],
): Promise<AdminPackageVariantOrderResult> {
  return reorderVariants(slug, variantKeys);
}

/**
 * Chooses which variant leads a journey.
 *
 * Thin on purpose. Every rule here needs the package row the transaction
 * locks — whether the journey may be rearranged at all depends on its
 * publication state, and whether anything needs writing depends on which
 * variant currently holds the flag — so the repository owns them.
 *
 * There is deliberately no rule here about which journeys may be rearranged:
 * a brochure-owned one may be, and doing so is what moves it to the
 * administrator. The repository performs the switch and the ownership move in
 * one transaction, so there is no window in which a rearranged journey is
 * still one the seed reconciles.
 */
export async function chooseAdminPackageDefaultVariant(
  slug: string,
  variantKey: string,
): Promise<AdminPackageDefaultVariantResult> {
  return setAdminPackageDefaultVariant(slug, variantKey);
}

/**
 * Replaces one variant's whole rate set.
 *
 * Thin on purpose. Every rule that matters here needs the package row the
 * transaction locks — whether an empty set is allowed depends on the
 * journey's publication and pricing mode — so the repository owns it, and
 * this seam exists for the rules that will not.
 */
export async function replaceAdminPackageRates(
  slug: string,
  key: string,
  rates: readonly AdminPackageRateTierInput[],
): Promise<AdminPackageRatesReplaceResult> {
  return replaceAdminPackageVariantRates(slug, key, rates);
}
