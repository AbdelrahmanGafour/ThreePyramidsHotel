import { BROCHURE_PACKAGE_CATALOGUE } from '../../db/seeds/packageCatalogue';

/**
 * The identities the brochure owns, derived from the catalogue itself.
 *
 * Imported rather than restated. Writing the forty-two codes out again would
 * create a second list that could fall out of step with the first, and the
 * failure would be silent: an administrator would take a brochure identity,
 * and the next seed run would either overwrite their work or be unable to
 * insert the offering it is supposed to own.
 *
 * Reserved whether or not the row is currently in the database. That is the
 * whole point — a brochure package that has not been seeded yet, or that was
 * removed, still owns its code and slug, because the next seed run will
 * insert it and the unique constraints would then refuse.
 *
 * Built once at module load. The catalogue is a frozen-in-practice constant
 * compiled into the build, so there is nothing to invalidate.
 */
const RESERVED_CODES: ReadonlySet<string> = new Set(
  BROCHURE_PACKAGE_CATALOGUE.map((item) => item.code),
);

const RESERVED_SLUGS: ReadonlySet<string> = new Set(
  BROCHURE_PACKAGE_CATALOGUE.map((item) => item.slug),
);

/** How many identities the brochure holds. Exposed so a test can prove none was missed. */
export const RESERVED_BROCHURE_IDENTITY_COUNT = BROCHURE_PACKAGE_CATALOGUE.length;

/**
 * Whether this code belongs to the brochure.
 *
 * Compared exactly, with no case folding or trimming: the codes are stored as
 * the brochure writes them, and a value that differs by case is a different
 * code that the database would happily accept alongside the real one.
 */
export function isReservedBrochureCode(code: string): boolean {
  return RESERVED_CODES.has(code);
}

export function isReservedBrochureSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Both sets, for tests that need to walk every identity. */
export function reservedBrochureIdentities(): { codes: string[]; slugs: string[] } {
  return { codes: [...RESERVED_CODES], slugs: [...RESERVED_SLUGS] };
}
