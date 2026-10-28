import type { PoolClient } from '../pool';
import {
  isUnreadableVariantSortOrderError,
  isVariantSortOrderExhaustedError,
  parkPackageVariantSortOrders,
} from '../packageVariantOrdering';

export const PACKAGE_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type PackageWeekday = (typeof PACKAGE_WEEKDAYS)[number];
export type PackageContentKind = 'included' | 'excluded' | 'note';

export type PackageRateTierSeed = {
  minPartySize: number;
  maxPartySize: number | null;
  adultUnitRate: string;
};

export type PackageVariantSeed = {
  key: string;
  label: string;
  isDefault: boolean;
  childMinAge: number | null;
  childMaxAge: number | null;
  childDiscountPercent: string | null;
  rates: PackageRateTierSeed[];
};

export type PackageItinerarySeed = {
  dayNumber: number | null;
  heading: string | null;
  body: string;
};

export type PackageContentSeed = {
  kind: PackageContentKind;
  text: string;
};

export type BrochurePackageSeed = {
  code: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  durationLabel: string | null;
  scheduleLabel: string | null;
  operatingDays: PackageWeekday[] | null;
  requiresPriceConfirmation: boolean;
  itinerary: PackageItinerarySeed[];
  content: PackageContentSeed[];
  variants: PackageVariantSeed[];
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}(?![\s\S])/;
const POSTGRES_INTEGER_MAX = 2147483647;

function assertNonBlank(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Package seed validation failed: ${label} must not be blank`);
  }
}

function assertCanonicalText(value: string, label: string): void {
  assertNonBlank(value, label);
  if (value !== value.trim()) {
    throw new Error(`Package seed validation failed: ${label} must be trimmed`);
  }
}

function isPostgresInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= POSTGRES_INTEGER_MAX;
}

// Validate decimal strings without ever converting money or percentages to Number.
function isDecimalAmount(value: unknown): value is string {
  return typeof value === 'string' && MONEY_PATTERN.test(value);
}

function assertRateTiers(variant: PackageVariantSeed, packageCode: string): void {
  // A brochure product may intentionally have no deterministic rate rows yet.
  // That is represented as unavailable/requires-confirmation data, never as a fabricated zero.
  const sorted = [...variant.rates].sort((left, right) => left.minPartySize - right.minPartySize);

  for (let index = 0; index < sorted.length; index += 1) {
    const tier = sorted[index];
    if (!tier) continue;

    if (!isPostgresInteger(tier.minPartySize) || tier.minPartySize <= 0) {
      throw new Error(`Package seed validation failed: ${packageCode}/${variant.key} invalid min party size`);
    }
    if (
      tier.maxPartySize !== null &&
      (!isPostgresInteger(tier.maxPartySize) || tier.maxPartySize < tier.minPartySize)
    ) {
      throw new Error(`Package seed validation failed: ${packageCode}/${variant.key} invalid max party size`);
    }
    if (!isDecimalAmount(tier.adultUnitRate)) {
      throw new Error(`Package seed validation failed: ${packageCode}/${variant.key} invalid USD rate`);
    }

    const previous = sorted[index - 1];
    if (previous) {
      if (previous.maxPartySize === null || previous.maxPartySize >= tier.minPartySize) {
        throw new Error(`Package seed validation failed: ${packageCode}/${variant.key} has overlapping rate tiers`);
      }
    }
  }
}

export function assertBrochureCatalogue(catalogue: readonly BrochurePackageSeed[]): void {
  const seenCodes = new Set<string>();
  const seenSlugs = new Set<string>();

  for (const item of catalogue) {
    assertCanonicalText(item.code, 'code');
    if (seenCodes.has(item.code)) {
      throw new Error(`Package seed validation failed: duplicate/invalid code ${item.code}`);
    }
    if (typeof item.slug !== 'string' || !SLUG_PATTERN.test(item.slug) || seenSlugs.has(item.slug)) {
      throw new Error(`Package seed validation failed: duplicate/invalid slug ${item.slug}`);
    }
    seenCodes.add(item.code);
    seenSlugs.add(item.slug);

    assertCanonicalText(item.title, `${item.code} title`);
    if (typeof item.requiresPriceConfirmation !== 'boolean') {
      throw new Error(`Package seed validation failed: ${item.code} invalid confirmation flag`);
    }
    if (item.summary !== null) assertNonBlank(item.summary, `${item.code} summary`);
    if (item.description !== null) assertNonBlank(item.description, `${item.code} description`);
    if (item.durationLabel !== null) assertNonBlank(item.durationLabel, `${item.code} duration`);
    if (item.scheduleLabel !== null) assertNonBlank(item.scheduleLabel, `${item.code} schedule`);

    if (item.operatingDays !== null) {
      if (
        !Array.isArray(item.operatingDays) || item.operatingDays.length === 0
        || new Set(item.operatingDays).size !== item.operatingDays.length
        || Array.from(item.operatingDays).some((day) => !PACKAGE_WEEKDAYS.includes(day))
      ) {
        throw new Error(`Package seed validation failed: ${item.code} has invalid operating days`);
      }
    }

    item.itinerary.forEach((section) => {
      if (section.dayNumber !== null && (!isPostgresInteger(section.dayNumber) || section.dayNumber <= 0)) {
        throw new Error(`Package seed validation failed: ${item.code} invalid itinerary day number`);
      }
      if (section.heading !== null) assertNonBlank(section.heading, `${item.code} itinerary heading`);
      assertNonBlank(section.body, `${item.code} itinerary body`);
    });

    item.content.forEach((content) => {
      if (!['included', 'excluded', 'note'].includes(content.kind)) {
        throw new Error(`Package seed validation failed: ${item.code} invalid content kind`);
      }
      assertNonBlank(content.text, `${item.code} ${content.kind} item`);
    });

    if (item.variants.length === 0) {
      throw new Error(`Package seed validation failed: ${item.code} has no sellable variants`);
    }

    const variantKeys = new Set<string>();
    let defaultCount = 0;
    for (const variant of item.variants) {
      if (typeof variant.key !== 'string' || !SLUG_PATTERN.test(variant.key) || variantKeys.has(variant.key)) {
        throw new Error(`Package seed validation failed: ${item.code} duplicate/invalid variant ${variant.key}`);
      }
      variantKeys.add(variant.key);
      assertNonBlank(variant.label, `${item.code}/${variant.key} label`);
      if (typeof variant.isDefault !== 'boolean') {
        throw new Error(`Package seed validation failed: ${item.code}/${variant.key} invalid default flag`);
      }
      if (variant.isDefault) defaultCount += 1;

      const childFields = [variant.childMinAge, variant.childMaxAge, variant.childDiscountPercent];
      const hasAnyChildField = childFields.some((value) => value !== null);
      const hasAllChildFields = childFields.every((value) => value !== null);
      if (hasAnyChildField !== hasAllChildFields) {
        throw new Error(`Package seed validation failed: ${item.code}/${variant.key} incomplete child pricing`);
      }
      if (hasAllChildFields) {
        if (
          !isPostgresInteger(variant.childMinAge) ||
          !isPostgresInteger(variant.childMaxAge) ||
          (variant.childMaxAge as number) < (variant.childMinAge as number) ||
          !isDecimalAmount(variant.childDiscountPercent)
        ) {
          throw new Error(`Package seed validation failed: ${item.code}/${variant.key} invalid child pricing`);
        }
        const discountHundredths = BigInt((variant.childDiscountPercent as string).replace('.', ''));
        if (discountHundredths > 10000n) {
          throw new Error(`Package seed validation failed: ${item.code}/${variant.key} invalid child discount`);
        }
      }

      assertRateTiers(variant, item.code);
    }

    if (defaultCount > 1 || (item.variants.length === 1 && defaultCount !== 1)) {
      throw new Error(`Package seed validation failed: ${item.code} has invalid default variant count`);
    }
  }
}

/**
 * Finds or creates the package this brochure entry describes, or reports that
 * an administrator now owns it.
 *
 * Returns null for a row whose `seed_managed` is false. That is not a failure
 * and not a conflict: it is an offering an administrator has taken over, and
 * the brochure no longer has an opinion about it. The caller skips it whole.
 */
async function resolvePackageId(
  client: PoolClient,
  item: BrochurePackageSeed,
): Promise<string | null> {
  const existing = await client.query<{
    id: string;
    code: string;
    slug: string;
    seed_managed: boolean;
  }>(
    `SELECT id, code, slug, seed_managed
       FROM packages
      WHERE code = $1 OR slug = $2
      FOR UPDATE`,
    [item.code, item.slug],
  );

  if (existing.rows.length > 1) {
    throw new Error(`Package seed conflict: ${item.code}/${item.slug} resolves to more than one package row`);
  }

  const current = existing.rows[0];

  // Checked before the identity guard below, and deliberately so. Once a row
  // is an administrator's, its code and slug are theirs to change; measuring
  // them against the brochure would turn an ordinary rename into a conflict
  // that aborts the whole run. A row the brochure does not own is a row the
  // brochure does not judge.
  //
  // Exactly `false`, never merely falsy: the column is NOT NULL, so anything
  // else means the row was read from somewhere that does not have it, and
  // reconciling is the safer reading of that.
  if (current?.seed_managed === false) {
    return null;
  }

  if (current && (current.code !== item.code || current.slug !== item.slug)) {
    throw new Error(
      `Package seed conflict: immutable package identity mismatch for ${item.code}/${item.slug}`,
    );
  }

  if (current) {
    await client.query(
      `UPDATE packages
          SET title = $2,
              summary = $3,
              description = $4,
              duration_label = $5,
              schedule_label = $6,
              operating_days = CAST($7 AS JSON),
              requires_price_confirmation = $8,
              sort_order = $9,
              updated_at = UTC_TIMESTAMP(3)
        WHERE id = $1`,
      [
        current.id,
        item.title,
        item.summary,
        item.description,
        item.durationLabel,
        item.scheduleLabel,
        item.operatingDays === null ? null : JSON.stringify(item.operatingDays),
        item.requiresPriceConfirmation,
        0,
      ],
    );
    return current.id;
  }

  // `seed_managed` is stated rather than left to the column default: a row
  // this function creates is one the brochure owns, and that should be legible
  // here rather than inferred from a migration.
  const inserted = await client.query(
    `INSERT INTO packages (
       code, slug, title, summary, description, duration_label, schedule_label,
       operating_days, is_active, requires_price_confirmation, sort_order, seed_managed
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, CAST($8 AS JSON), true, $9, $10, true)`,
    [
      item.code,
      item.slug,
      item.title,
      item.summary,
      item.description,
      item.durationLabel,
      item.scheduleLabel,
      item.operatingDays === null ? null : JSON.stringify(item.operatingDays),
      item.requiresPriceConfirmation,
      0,
    ],
  );

  const id = inserted.insertId;
  if (!id) throw new Error(`Package seed failed to insert ${item.code}`);
  return id;
}

async function reconcilePackageContent(
  client: PoolClient,
  packageId: string,
  item: BrochurePackageSeed,
): Promise<void> {
  await client.query('DELETE FROM package_itinerary_sections WHERE package_id = $1', [packageId]);
  for (const [index, section] of item.itinerary.entries()) {
    await client.query(
      `INSERT INTO package_itinerary_sections (
         package_id, day_number, heading, body, sort_order
       ) VALUES ($1, $2, $3, $4, $5)`,
      [packageId, section.dayNumber, section.heading, section.body, index + 1],
    );
  }

  await client.query('DELETE FROM package_content_items WHERE package_id = $1', [packageId]);
  const kindOrder: Record<PackageContentKind, number> = { included: 0, excluded: 0, note: 0 };
  for (const content of item.content) {
    kindOrder[content.kind] += 1;
    await client.query(
      `INSERT INTO package_content_items (package_id, kind, \`text\`, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [packageId, content.kind, content.text, kindOrder[content.kind]],
    );
  }
}

async function reconcilePackageVariants(
  client: PoolClient,
  packageId: string,
  item: BrochurePackageSeed,
): Promise<void> {
  const expectedKeys = item.variants.map((variant) => variant.key);
  // `sort_order` is read here so the parking base below comes from rows this
  // transaction already holds locks on, without a second round trip.
  const existing = await client.query<{ key: string; sort_order: number }>(
    'SELECT `key`, sort_order FROM package_variants WHERE package_id = $1 FOR UPDATE',
    [packageId],
  );
  const unexpected = existing.rows.map((row) => row.key).filter((key) => !expectedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Package seed conflict: ${item.code} has unexpected existing variants: ${unexpected.join(', ')}`,
    );
  }

  // Reordering variants in place would otherwise trip
  // UNIQUE(package_id, sort_order), which is NOT DEFERRABLE. The mechanics of
  // parking every existing row clear of the final range live in
  // `packageVariantOrdering`, shared with the admin reordering endpoint so
  // there is one implementation rather than two that could drift.
  //
  // The errors come back as types and are re-worded here: a seed failure
  // names the brochure entry that caused it, which is the only thing that
  // makes it actionable when forty-two packages are being reconciled.
  try {
    await parkPackageVariantSortOrders(client, packageId, existing.rows, item.variants.length);
  } catch (error) {
    if (isUnreadableVariantSortOrderError(error)) {
      throw new Error(`Package seed conflict: ${item.code} has an unreadable variant sort order`);
    }
    if (isVariantSortOrderExhaustedError(error)) {
      throw new Error(
        `Package seed conflict: ${item.code} cannot reorder variants without exceeding the sort order range`,
      );
    }
    throw error;
  }

  await client.query('UPDATE package_variants SET is_default = false WHERE package_id = $1', [packageId]);

  for (const [index, variant] of item.variants.entries()) {
    await client.query(
      `INSERT INTO package_variants (
         package_id, \`key\`, label, is_default, sort_order,
         child_min_age, child_max_age, child_discount_percent
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) AS excluded
       ON DUPLICATE KEY UPDATE
         label = excluded.label,
         is_default = excluded.is_default,
         sort_order = excluded.sort_order,
         child_min_age = excluded.child_min_age,
         child_max_age = excluded.child_max_age,
         child_discount_percent = excluded.child_discount_percent`,
      [
        packageId,
        variant.key,
        variant.label,
        variant.isDefault,
        index + 1,
        variant.childMinAge,
        variant.childMaxAge,
        variant.childDiscountPercent,
      ],
    );

    const upserted = await client.query<{ id: string }>(
      'SELECT id FROM package_variants WHERE package_id = $1 AND `key` = $2',
      [packageId, variant.key],
    );
    const variantId = upserted.rows[0]?.id;
    if (!variantId) throw new Error(`Package seed failed to upsert ${item.code}/${variant.key}`);

    await client.query('DELETE FROM package_rate_tiers WHERE variant_id = $1', [variantId]);
    for (const rate of variant.rates) {
      await client.query(
        `INSERT INTO package_rate_tiers (
           variant_id, min_party_size, max_party_size, adult_unit_rate, currency
         ) VALUES ($1, $2, $3, $4, 'USD')`,
        [variantId, rate.minPartySize, rate.maxPartySize, rate.adultUnitRate],
      );
    }
  }
}

/**
 * Generic catalogue reconciliation; contains no brochure rows or automatic runner.
 * The caller must own a transaction on this client and roll back on any failure.
 * Rates are USD per person; party-size tiers count adults + children.
 */
export async function seedBrochurePackageCatalogue(
  client: PoolClient,
  catalogue: readonly BrochurePackageSeed[],
): Promise<void> {
  assertBrochureCatalogue(catalogue);

  for (const [index, item] of catalogue.entries()) {
    const packageId = await resolvePackageId(client, item);

    // An administrator owns this offering now: its fields, itinerary, content
    // items, variants and rate tiers are all left exactly as they are. Even
    // `sort_order` is left alone — where an administrator's package sits in
    // the list is their arrangement, not the brochure's. The gap this leaves
    // in the brochure's own numbering is harmless: `packages.sort_order` is
    // only ordered by, never required to be contiguous or unique.
    if (packageId === null) {
      continue;
    }

    await client.query('UPDATE packages SET sort_order = $2 WHERE id = $1', [packageId, index + 1]);
    await reconcilePackageContent(client, packageId, item);
    await reconcilePackageVariants(client, packageId, item);
  }
}
