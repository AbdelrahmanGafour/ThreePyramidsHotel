import type { Request, Response } from 'express';
import {
  addAdminPackageVariant,
  chooseAdminPackageDefaultVariant,
  createAdminPackage,
  removeAdminPackage,
  removeAdminPackageVariant,
  setAdminPackageContent,
  setAdminPackageItinerary,
  reorderAdminPackageVariants,
  editAdminPackage,
  editAdminPackageVariant,
  replaceAdminPackageRates,
  getAdminPackage,
  listAdminPackages,
  setAdminPackageActiveState,
} from './admin-packages.service';
import {
  PACKAGE_CODE_IN_USE_RESPONSE,
  PACKAGE_DELETE_MUST_BE_INACTIVE_RESPONSE,
  PACKAGE_HAS_RESERVATIONS_RESPONSE,
  PACKAGE_IS_BROCHURE_MANAGED_RESPONSE,
  PACKAGE_DEFAULT_VARIANT_MUST_BE_INACTIVE_RESPONSE,
  PACKAGE_MUST_BE_INACTIVE_RESPONSE,
  PACKAGE_NOT_FOUND_RESPONSE,
  PACKAGE_SLUG_IN_USE_RESPONSE,
  OVERLAPPING_RATE_TIERS_RESPONSE,
  PACKAGE_VARIANT_DEFAULT_UNSAFE_RESPONSE,
  PACKAGE_VARIANT_DELETE_MUST_BE_INACTIVE_RESPONSE,
  PACKAGE_VARIANT_HAS_RESERVATIONS_RESPONSE,
  PACKAGE_VARIANT_IS_DEFAULT_RESPONSE,
  PACKAGE_VARIANT_KEY_IN_USE_RESPONSE,
  PACKAGE_VARIANT_NOT_FOUND_RESPONSE,
  PACKAGE_VARIANT_ORDER_EXHAUSTED_RESPONSE,
  PACKAGE_VARIANT_SET_MISMATCH_RESPONSE,
  RATES_REQUIRED_RESPONSE,
  RESERVED_BROCHURE_IDENTITY_RESPONSE,
  isInvalidAdminPackageError,
  isInvalidAdminPackageSlugError,
  isInvalidAdminPackageStatusError,
  isInvalidAdminPackageVariantKeyError,
  isOverlappingRateTiersError,
  type AdminPackageContentReplacementInput,
  type AdminPackageItineraryReplacementInput,
  type AdminPackageCreateInput,
  type AdminPackageDefaultVariantInput,
  type AdminPackageVariantOrderInput,
  type AdminPackageUpdateInput,
  type AdminPackageRatesReplacementInput,
  type AdminPackageVariantCreateInput,
  type AdminPackageVariantUpdateInput,
} from './admin-packages.types';
import {
  parseAdminPackageContentReplacement,
  parseAdminPackageItineraryReplacement,
  parseAdminPackageCreate,
  parseAdminPackageDefaultVariant,
  parseAdminPackageVariantOrder,
  parseAdminPackageSlugParam,
  parseAdminPackageUpdate,
  parseAdminPackageStatusUpdate,
  parseAdminPackageRatesReplacement,
  parseAdminPackageVariantCreate,
  parseAdminPackageVariantKeyParam,
  parseAdminPackageVariantUpdate,
} from './admin-packages.validation';

/**
 * Creates one journey for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * Three outcomes are kept strictly apart. A body that is not a package is a
 * malformed request (400). An identity something else already has a claim on
 * is a conflict (409), and the brochure's claim is reported distinctly from
 * an ordinary duplicate because the administrator must do something different
 * about each. Anything else is the server's problem and stays a server error.
 *
 * The journey is created unpublished and admin-owned; neither is something
 * the request can ask for, and neither is read from the body.
 */
export async function createAdminPackageHandler(req: Request, res: Response): Promise<void> {
  let input: AdminPackageCreateInput;

  try {
    input = parseAdminPackageCreate(req.body);
  } catch (error) {
    if (isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await createAdminPackage(input);

  if (result.outcome === 'reserved-brochure-identity') {
    res.status(409).json(RESERVED_BROCHURE_IDENTITY_RESPONSE);
    return;
  }

  if (result.outcome === 'code-in-use') {
    res.status(409).json(PACKAGE_CODE_IN_USE_RESPONSE);
    return;
  }

  if (result.outcome === 'slug-in-use') {
    res.status(409).json(PACKAGE_SLUG_IN_USE_RESPONSE);
    return;
  }

  res.status(201).json({ data: result.package });
}

/**
 * Lists the package catalogue for a signed-in administrator, in running order.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * There is no try/catch. A database failure is a server problem and must stay
 * one — it must never be softened into an empty catalogue, which would read
 * as "this hotel offers no journeys" while forty-two sat in the table.
 * Express 5 turns this rejected async handler into a 500.
 *
 * No query parameters are read yet, so there is nothing to validate and no
 * 400 this endpoint can produce. When filtering arrives it gets its own
 * validation and its own error code.
 */
export async function listAdminPackagesHandler(_req: Request, res: Response): Promise<void> {
  const { packages } = await listAdminPackages();

  // `packages` is nested under `data` rather than being the whole of it, so a
  // pagination sibling can be added later without changing the shape a caller
  // already reads.
  res.status(200).json({ data: { packages } });
}

/**
 * Returns one package in full for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session and an unauthenticated request
 * never reaches this function — it cannot learn whether a package exists or
 * whether its slug is even well formed.
 *
 * Three outcomes are kept strictly apart. A slug that is not a slug is a
 * malformed request (400). A well-formed slug nothing matches is an answered
 * question (404). Anything else that goes wrong is the server's problem and
 * stays a server error — softening a database failure into "not found" would
 * report an offering as missing while it sat right there in the table.
 */
export async function getAdminPackageHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;

  try {
    slug = parseAdminPackageSlugParam(req.params.slug);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const found = await getAdminPackage(slug);

  if (!found) {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: found });
}

/**
 * Offers one package to guests, or withdraws it.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session and an unauthenticated request
 * never reaches this function — it cannot learn whether a package exists or
 * whether its slug is even well formed.
 *
 * Three outcomes are kept strictly apart. A slug or body that is not valid
 * input is a malformed request (400). A well-formed slug nothing matches is
 * an answered question (404). Anything else is the server's problem and stays
 * a server error.
 *
 * There is deliberately no fourth outcome for "it was already like that".
 * Asking for the state a package already holds succeeds and returns the
 * package: it is true either way, and refusing would make a retry after a
 * lost response fail for no reason.
 */
export async function updateAdminPackageStatusHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let isActive: boolean;

  try {
    // Order is deliberate and fixed. The slug says which package is being
    // changed, so a request that names nothing valid is refused before its
    // body matters: when both are malformed, the slug wins, and the answer is
    // the same every time.
    slug = parseAdminPackageSlugParam(req.params.slug);
    isActive = parseAdminPackageStatusUpdate(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageStatusError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const updated = await setAdminPackageActiveState(slug, isActive);

  if (!updated) {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: updated });
}

/**
 * Rewrites one journey's package-level fields for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * Three outcomes are kept strictly apart. A slug or body that is not valid
 * input is a malformed request (400) — and a body offering the journey's
 * identity, its publication or its ownership is invalid, not something to
 * accept in part. A well-formed slug nothing matches is an answered question
 * (404). Anything else is the server's problem and stays a server error.
 *
 * A successful edit always answers with `managementSource: "admin"`, because
 * the write that changed the journey is the write that took ownership of it.
 */
export async function updateAdminPackageHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let input: AdminPackageUpdateInput;

  try {
    // Order is deliberate and fixed. The slug says which journey is being
    // changed, so a request that names nothing valid is refused before its
    // body matters.
    slug = parseAdminPackageSlugParam(req.params.slug);
    input = parseAdminPackageUpdate(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const updated = await editAdminPackage(slug, input);

  if (!updated) {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: updated });
}

/**
 * Adds one variant to a journey for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * Six outcomes are kept strictly apart, because each asks the administrator
 * for something different.
 *
 * A slug or body that is not valid input is a malformed request (400) — and a
 * body offering the variant's default flag, its position or its rates is
 * invalid, not something to accept in part. A journey nothing matches is 404.
 *
 * The four conflicts are all 409 and all distinct. The key is taken: pick
 * another. The journey is live: a rate-less variant cannot be added to
 * something guests can see, so withdraw it first. The journey has one
 * unflagged variant: flag it, or adding a second would change which variant
 * an unqualified reservation resolves to. The ordering is exhausted: there is
 * no position left to append to.
 *
 * Anything else is the server's problem and stays a server error.
 *
 * A successful creation answers 201 with the whole journey, which always
 * reads `managementSource: "admin"` — the transaction that added the variant
 * is the transaction that took ownership of its journey. The new variant
 * arrives with no rates; pricing it is a separate request.
 */
export async function createAdminPackageVariantHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let input: AdminPackageVariantCreateInput;

  try {
    // The address before the body, as everywhere else in this module.
    slug = parseAdminPackageSlugParam(req.params.slug);
    input = parseAdminPackageVariantCreate(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await addAdminPackageVariant(slug, input);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'package-active') {
    res.status(409).json(PACKAGE_MUST_BE_INACTIVE_RESPONSE);
    return;
  }

  if (result.outcome === 'unsafe-default-state') {
    res.status(409).json(PACKAGE_VARIANT_DEFAULT_UNSAFE_RESPONSE);
    return;
  }

  if (result.outcome === 'key-in-use') {
    res.status(409).json(PACKAGE_VARIANT_KEY_IN_USE_RESPONSE);
    return;
  }

  if (result.outcome === 'order-exhausted') {
    res.status(409).json(PACKAGE_VARIANT_ORDER_EXHAUSTED_RESPONSE);
    return;
  }

  res.status(201).json({ data: result.package });
}

/**
 * Rewrites one variant's metadata for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * Four outcomes are kept strictly apart. A slug, key or body that is not
 * valid input is a malformed request (400) — and a body offering the
 * variant's key, its default state, its order or its rates is invalid, not
 * something to accept in part. A journey nothing matches and a variant
 * nothing matches are both 404, but distinct ones, because the administrator
 * must correct a different part of the address. Anything else is the server's
 * problem and stays a server error.
 *
 * A successful edit always answers with `managementSource: "admin"`, because
 * the transaction that changed the variant is the transaction that took
 * ownership of its journey.
 */
export async function updateAdminPackageVariantHandler(
  req: Request<{ slug: string; key: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let key: string;
  let input: AdminPackageVariantUpdateInput;

  try {
    // Order is deliberate and fixed: the address before the body, and the
    // journey before the variant within it.
    slug = parseAdminPackageSlugParam(req.params.slug);
    key = parseAdminPackageVariantKeyParam(req.params.key);
    input = parseAdminPackageVariantUpdate(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error)
      || isInvalidAdminPackageVariantKeyError(error)
      || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await editAdminPackageVariant(slug, key, input);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-not-found') {
    res.status(404).json(PACKAGE_VARIANT_NOT_FOUND_RESPONSE);
    return;
  }

  res.status(200).json({ data: result.package });
}

/**
 * Replaces a journey's itinerary for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * PUT because the body states what the itinerary is, so sending it twice
 * leaves the same rows. Submitting the itinerary a journey already has is
 * therefore an ordinary success that wrote nothing.
 *
 * Only two refusals exist, and that is a property of the contract rather than
 * an omission. A slug or body that is not valid input is a malformed request
 * (400), and a journey nothing matches is 404. There is no publication
 * conflict, because these rows are prose that no booking reads, and no
 * ordering conflict, because the write deletes the itinerary before
 * renumbering it.
 */
export async function replaceAdminPackageItineraryHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let input: AdminPackageItineraryReplacementInput;

  try {
    // The address before the body, as everywhere else in this module.
    slug = parseAdminPackageSlugParam(req.params.slug);
    input = parseAdminPackageItineraryReplacement(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await setAdminPackageItinerary(slug, input.sections);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  // `replaced` and `unchanged` answer identically. The caller asked for an
  // itinerary and that itinerary holds; which of the two it took is not a
  // difference they can act on.
  res.status(200).json({ data: result.package });
}

/**
 * Replaces a journey's content lists for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * PUT because the body states what the lists are, so sending it twice leaves
 * the same rows. Submitting the content a journey already has is therefore an
 * ordinary success that wrote nothing.
 *
 * Only two refusals exist, and that is a property of the contract rather than
 * an omission. A slug or body that is not valid input is a malformed request
 * (400), and a journey nothing matches is 404. There is no publication
 * conflict, because these rows are prose that no booking reads; there is no
 * invalid-kind conflict, because three named arrays cannot express a fourth
 * kind; and there is no ordering conflict, because the write deletes the set
 * before renumbering it.
 */
export async function replaceAdminPackageContentHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let input: AdminPackageContentReplacementInput;

  try {
    // The address before the body, as everywhere else in this module.
    slug = parseAdminPackageSlugParam(req.params.slug);
    input = parseAdminPackageContentReplacement(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await setAdminPackageContent(slug, input);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  // `replaced` and `unchanged` answer identically. The caller asked for a set
  // and that set holds; which of the two it took is not a difference they can
  // act on.
  res.status(200).json({ data: result.package });
}

/**
 * Removes one journey for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * No request body. The journey is named in the path, and a removal has
 * nothing else to say.
 *
 * Four refusals, each asking for something different. A slug that is not one
 * is a malformed request (400). A journey nothing matches is 404. A live
 * journey, a brochure identity and a journey that has been booked are three
 * separate conflicts (409): withdraw it first, deactivate it instead because
 * the seed would recreate it, or nothing at all.
 *
 * Success answers 204 with no body, which is the one place this module breaks
 * its own convention of returning the journey. There is no journey left to
 * return, and handing back a representation of something that no longer
 * exists would be worse than handing back nothing.
 */
export async function deleteAdminPackageHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;

  try {
    slug = parseAdminPackageSlugParam(req.params.slug);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await removeAdminPackage(slug);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'package-active') {
    res.status(409).json(PACKAGE_DELETE_MUST_BE_INACTIVE_RESPONSE);
    return;
  }

  if (result.outcome === 'brochure-managed') {
    res.status(409).json(PACKAGE_IS_BROCHURE_MANAGED_RESPONSE);
    return;
  }

  if (result.outcome === 'has-reservations') {
    res.status(409).json(PACKAGE_HAS_RESERVATIONS_RESPONSE);
    return;
  }

  res.status(204).end();
}

/**
 * Removes one variant from a journey for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * No request body. The variant is named in the path, where every other
 * per-variant operation already addresses it, and there is nothing else to
 * say about a removal.
 *
 * Five refusals, kept apart because each asks for something different. A slug
 * or key that is not valid input is a malformed request (400), and the two
 * are reported separately so the administrator knows which half of the
 * address to correct. A journey nothing matches and a variant nothing matches
 * are both 404, also distinct. A live journey, the variant the journey leads
 * with, and a variant that has been booked are three different conflicts
 * (409) with three different remedies — change the journey's availability,
 * choose another default, or nothing at all.
 *
 * Repeating a successful removal answers 404: the variant is gone, and there
 * is no unchanged state to report.
 */
export async function deleteAdminPackageVariantHandler(
  req: Request<{ slug: string; key: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let key: string;

  try {
    // Order is deliberate and fixed: the journey before the variant within it.
    slug = parseAdminPackageSlugParam(req.params.slug);
    key = parseAdminPackageVariantKeyParam(req.params.key);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageVariantKeyError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await removeAdminPackageVariant(slug, key);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-not-found') {
    res.status(404).json(PACKAGE_VARIANT_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'package-active') {
    res.status(409).json(PACKAGE_VARIANT_DELETE_MUST_BE_INACTIVE_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-is-default') {
    res.status(409).json(PACKAGE_VARIANT_IS_DEFAULT_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-has-reservations') {
    res.status(409).json(PACKAGE_VARIANT_HAS_RESERVATIONS_RESPONSE);
    return;
  }

  res.status(200).json({ data: result.package });
}

/**
 * Rearranges a journey's variants for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * PUT because the body states the whole running order, so sending it twice
 * leaves the same order. Submitting the order a journey already has is
 * therefore an ordinary success (200) that wrote nothing.
 *
 * Five refusals, kept apart because each asks for something different. A slug
 * or body that is not valid input is a malformed request (400) — including a
 * repeated key, which is not an order, and any field beyond `variantKeys`. A
 * journey nothing matches and a listed key naming no variant are both 404,
 * but distinct. A list that omits a variant the journey has is a conflict
 * (409) and usually means the page went stale. A journey with no ordering
 * range left is its own conflict (409).
 *
 * There is no publication refusal: reordering is allowed while the journey is
 * active, because nothing in the reservation path reads a variant's position.
 */
export async function reorderAdminPackageVariantsHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let input: AdminPackageVariantOrderInput;

  try {
    // The address before the body, as everywhere else in this module.
    slug = parseAdminPackageSlugParam(req.params.slug);
    input = parseAdminPackageVariantOrder(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await reorderAdminPackageVariants(slug, input.variantKeys);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-not-found') {
    res.status(404).json(PACKAGE_VARIANT_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'set-mismatch') {
    res.status(409).json(PACKAGE_VARIANT_SET_MISMATCH_RESPONSE);
    return;
  }

  if (result.outcome === 'order-exhausted') {
    res.status(409).json(PACKAGE_VARIANT_ORDER_EXHAUSTED_RESPONSE);
    return;
  }

  // `reordered` and `unchanged` answer identically. The caller asked for an
  // order and that order holds; which of the two it took is not a difference
  // they can act on.
  res.status(200).json({ data: result.package });
}

/**
 * Chooses which variant leads a journey, for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * PUT rather than PATCH, and deliberately: the request states which variant
 * leads, so sending it twice leaves the same row leading. Asking for the
 * variant that already leads is therefore an ordinary success (200) that
 * wrote nothing — not a conflict. An administrator who clicked twice, and one
 * whose colleague got there first, both said something true.
 *
 * Four refusals are kept apart. A slug or body that is not valid input is a
 * malformed request (400) — and a body offering anything beyond `variantKey`
 * is invalid, not something to read past. A journey nothing matches and a
 * variant nothing matches are both 404, but distinct ones, because the
 * administrator must correct a different part of the request. A live journey
 * is a conflict (409): moving the default changes what a booking without a
 * named variant resolves to, which is not something to do underneath guests.
 *
 * Anything else is the server's problem and stays a server error.
 */
export async function setAdminPackageDefaultVariantHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let input: AdminPackageDefaultVariantInput;

  try {
    // The address before the body, as everywhere else in this module.
    slug = parseAdminPackageSlugParam(req.params.slug);
    input = parseAdminPackageDefaultVariant(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error) || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await chooseAdminPackageDefaultVariant(slug, input.variantKey);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-not-found') {
    res.status(404).json(PACKAGE_VARIANT_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'package-active') {
    res.status(409).json(PACKAGE_DEFAULT_VARIANT_MUST_BE_INACTIVE_RESPONSE);
    return;
  }

  // `updated` and `unchanged` answer identically. The caller asked for a
  // state and that state holds; which of the two it took to get there is not
  // a difference they can act on.
  res.status(200).json({ data: result.package });
}

/**
 * Replaces one variant's whole rate set for a signed-in administrator.
 *
 * The caller is already authenticated: `requireAdminSession` guards this
 * route, so nothing here re-checks a session.
 *
 * Five outcomes are kept strictly apart. A slug, key or body that is not
 * valid input is a malformed request (400). Tiers that overlap are a conflict
 * (409): each is well formed, and what is wrong is how they sit together. An
 * empty set on an active, deterministically-priced journey is a different
 * conflict (409) with its own message, because the administrator has two real
 * choices and the system must not pick one for them. A journey or a variant
 * nothing matches are both 404, but distinct ones. Anything else is the
 * server's problem and stays a server error.
 */
export async function replaceAdminPackageRatesHandler(
  req: Request<{ slug: string; key: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let key: string;
  let input: AdminPackageRatesReplacementInput;

  try {
    slug = parseAdminPackageSlugParam(req.params.slug);
    key = parseAdminPackageVariantKeyParam(req.params.key);
    input = parseAdminPackageRatesReplacement(req.body);
  } catch (error) {
    // Overlap is caught by the same validator but is not a bad request: the
    // tiers are individually valid, so it answers 409 like its database-side
    // counterpart.
    if (isOverlappingRateTiersError(error)) {
      res.status(409).json(OVERLAPPING_RATE_TIERS_RESPONSE);
      return;
    }

    if (isInvalidAdminPackageSlugError(error)
      || isInvalidAdminPackageVariantKeyError(error)
      || isInvalidAdminPackageError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    throw error;
  }

  // Deliberately outside the catch above: Express 5 turns a rejected async
  // handler into a 500, which is what a database failure is.
  const result = await replaceAdminPackageRates(slug, key, input.rates);

  if (result.outcome === 'package-not-found') {
    res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'variant-not-found') {
    res.status(404).json(PACKAGE_VARIANT_NOT_FOUND_RESPONSE);
    return;
  }

  if (result.outcome === 'overlapping-tiers') {
    res.status(409).json(OVERLAPPING_RATE_TIERS_RESPONSE);
    return;
  }

  if (result.outcome === 'rates-required') {
    res.status(409).json(RATES_REQUIRED_RESPONSE);
    return;
  }

  res.status(200).json({ data: result.package });
}
