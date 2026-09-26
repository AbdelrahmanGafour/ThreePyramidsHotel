import { Router } from 'express';
import { requireAdminSession } from '../admin-auth/admin-auth.middleware';
import {
  createAdminPackageHandler,
  createAdminPackageVariantHandler,
  deleteAdminPackageHandler,
  deleteAdminPackageVariantHandler,
  replaceAdminPackageContentHandler,
  replaceAdminPackageItineraryHandler,
  reorderAdminPackageVariantsHandler,
  setAdminPackageDefaultVariantHandler,
  getAdminPackageHandler,
  listAdminPackagesHandler,
  updateAdminPackageHandler,
  updateAdminPackageStatusHandler,
  replaceAdminPackageRatesHandler,
  updateAdminPackageVariantHandler,
} from './admin-packages.controller';

export const adminPackagesRouter = Router();

// The guard sits in the route chain rather than inside the handler, so the
// protection is visible at the route itself and a future route added here
// cannot quietly be left unguarded. It is written per route rather than
// hoisted to router.use(), so every route states its own protection and none
// can be read as inheriting it by accident.
//
// Reading the catalogue is all that happens here. Creating, editing and
// retiring an offering are separate, later steps, and each will have to say
// what it does to a package's management source before it is written.
// Registration order is most-specific first. Express matches on segment
// count, so `/:slug` cannot swallow `/:slug/status` — the two-segment path is
// simply a different shape. The order is therefore for a reader rather than
// for the matcher, and is stated so it stays that way: a later
// optional-segment pattern would make it load-bearing.
adminPackagesRouter.get('/', requireAdminSession, listAdminPackagesHandler);

// Creating the parent row only. A new journey arrives unpublished and
// admin-owned, with no variants, rates, itinerary or content yet; each of
// those is its own later step against its own sub-resource.
adminPackagesRouter.post('/', requireAdminSession, createAdminPackageHandler);

// Whether guests can see the offering is its own sub-resource rather than a
// field of a general update: it is the one thing an administrator may change
// about a package today, and it is safe for a brochure-owned offering in a
// way that editing its wording is not.
adminPackagesRouter.patch('/:slug/status', requireAdminSession, updateAdminPackageStatusHandler);

// The running order of the journey's variants. A slot on the package, like
// the default above: the order is one property of the journey rather than of
// any single variant, and a per-variant move would be interpreted against an
// order the client last saw.
//
// PUT because the body states the whole order, so sending it twice leaves the
// same arrangement. Allowed while the journey is active — unlike adding a
// variant or moving the default, nothing in the reservation path reads a
// variant's position.
adminPackagesRouter.put(
  '/:slug/variant-order',
  requireAdminSession,
  reorderAdminPackageVariantsHandler,
);

// The journey's day-by-day plan, replaced outright. A slot on the package
// like its sibling below: the sections are one ordered property of the
// journey, and stating them together is what keeps their order coherent.
//
// PUT because the body states what the itinerary is, so sending it twice
// leaves the same rows. Allowed while the journey is active — these rows are
// prose on the detail page, and no part of the reservation path reads them.
adminPackagesRouter.put(
  '/:slug/itinerary',
  requireAdminSession,
  replaceAdminPackageItineraryHandler,
);

// What the journey says it includes, excludes and notes, replaced outright.
// A slot on the package, like the two below: the three lists are one property
// of the journey, and stating them together is what keeps them consistent.
//
// PUT because the body states what the lists are, so sending it twice leaves
// the same rows. Allowed while the journey is active — these rows are prose
// on the detail page, and no part of the reservation path reads them.
adminPackagesRouter.put('/:slug/content', requireAdminSession, replaceAdminPackageContentHandler);

// Which variant leads the journey. A slot on the package rather than a toggle
// on a variant, and deliberately so: at most one variant can hold the flag,
// which is what the partial unique index enforces, and a per-variant toggle
// would imply an unset this system must not offer — a multi-variant journey
// with no default refuses every reservation that names no variant.
//
// PUT because the request states which variant leads, so sending it twice
// leaves the same row leading and asking for the one that already leads is an
// ordinary success.
adminPackagesRouter.put(
  '/:slug/default-variant',
  requireAdminSession,
  setAdminPackageDefaultVariantHandler,
);

// Adding a variant to a journey. A two-segment path ending in a collection,
// so it cannot be confused with the three-segment route below that addresses
// one variant within it.
//
// The variant arrives with no rate tiers, which is why this is allowed only
// while the journey is inactive; its position and its default flag are the
// server's to assign, and the body may offer neither.
adminPackagesRouter.post('/:slug/variants', requireAdminSession, createAdminPackageVariantHandler);

// One variant's metadata. A three-segment path, so it cannot be confused with
// either of the routes above. Only the label and the child rule are editable
// here: the key, the default flag, the order and the rates each decide
// something a reservation depends on, and each is its own later step.
adminPackagesRouter.patch(
  '/:slug/variants/:key',
  requireAdminSession,
  updateAdminPackageVariantHandler,
);

// Removing one variant. The same three-segment address its metadata edit
// uses, under a different method, because it is the same resource.
//
// Allowed only while the journey is inactive, and never for the variant the
// journey leads with unless it is the last one: a removal must not decide,
// on the way past, what an unqualified booking resolves to. A variant that
// has ever been booked cannot be removed at all.
adminPackagesRouter.delete(
  '/:slug/variants/:key',
  requireAdminSession,
  deleteAdminPackageVariantHandler,
);

// The whole rate set of one variant, replaced outright. PUT rather than
// PATCH, and deliberately: the request states what the tiers are, so sending
// it twice leaves the same rows, and there is no way to add or remove a
// single tier in isolation — which is what keeps the set from drifting into
// an overlapping or gapped state one edit at a time.
adminPackagesRouter.put(
  '/:slug/variants/:key/rates',
  requireAdminSession,
  replaceAdminPackageRatesHandler,
);

adminPackagesRouter.get('/:slug', requireAdminSession, getAdminPackageHandler);

// Editing the package-level fields. Deliberately separate from the status
// route above: publishing a journey and rewriting one are different
// operations with different consequences, and only the second takes ownership
// of a brochure offering.
adminPackagesRouter.patch('/:slug', requireAdminSession, updateAdminPackageHandler);

// Removing a journey outright. The same address a read and an edit use,
// under a different method, because it is the same resource.
//
// Allowed only while the journey is inactive, never for an identity the
// brochure catalogue owns - the seed would simply recreate it - and never for
// a journey that has ever been booked. Everything the journey owns goes with
// it by cascade.
adminPackagesRouter.delete('/:slug', requireAdminSession, deleteAdminPackageHandler);
