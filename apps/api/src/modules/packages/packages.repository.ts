import { dbPool } from '../../db/pool';
import { mapPackageCardRow, mapPackageDetailRow } from './packages.mapping';
import type { PackageCardRecord, PackageDetailRecord } from './packages.types';

const CARD_COLUMNS = `p.code, p.slug, p.title, p.summary, p.duration_label,
  p.schedule_label, p.operating_days, p.requires_price_confirmation,
  CASE WHEN lowest.variant_key IS NULL THEN NULL ELSE jsonb_build_object(
    'variant_key', lowest.variant_key, 'min_party_size', lowest.min_party_size,
    'max_party_size', lowest.max_party_size, 'adult_unit_rate', lowest.adult_unit_rate::text,
    'currency', lowest.currency) END AS from_rate,
  CASE WHEN ma.reference IS NULL THEN NULL ELSE jsonb_build_object(
    'reference', ma.reference, 'alt_text', pm.alt_text,
    'width', ma.width, 'height', ma.height) END AS image`;

// The journey's one image, joined rather than fetched per row. `package_media`
// has UNIQUE (package_id), so this is a 0-or-1 join: it can never multiply a
// package into several rows, and a catalogue of thirty journeys still costs
// the one statement it cost before. No N+1, and no second query to batch.
//
// Only the four fields a guest may see are selected. The two ids and the
// object key are not read at all — the reference is what a URL is composed
// from, and it goes no further than the service that composes it.
const IMAGE_JOIN = `LEFT JOIN package_media pm ON pm.package_id = p.id
  LEFT JOIN media_assets ma ON ma.id = pm.media_asset_id`;

// Rate ordering is numeric, not lexicographic. Return the qualifying variant/tier,
// with stable tie-breaking, so cards cannot imply this rate applies to everyone.
const FROM_RATE_JOIN = `LEFT JOIN LATERAL (
  SELECT v.key AS variant_key, r.min_party_size, r.max_party_size, r.adult_unit_rate, r.currency
  FROM package_variants v JOIN package_rate_tiers r ON r.variant_id = v.id
  WHERE v.package_id = p.id
  ORDER BY r.adult_unit_rate, v.sort_order, v.key, r.min_party_size
  LIMIT 1
) lowest ON true`;

export async function findActivePackages(): Promise<PackageCardRecord[]> {
  const { rows } = await dbPool.query<Record<string, unknown>>(`
    SELECT ${CARD_COLUMNS} FROM packages p ${FROM_RATE_JOIN} ${IMAGE_JOIN}
    WHERE p.is_active = true ORDER BY p.sort_order, p.id`);
  return rows.map(mapPackageCardRow);
}

export async function findActivePackageBySlug(slug: string): Promise<PackageDetailRecord | null> {
  // One statement provides a consistent snapshot of parent and children; no
  // row locks, hotel joins, SELECT *, JSON serialization of whole rows, or IDs.
  const { rows } = await dbPool.query<Record<string, unknown>>(`
    SELECT ${CARD_COLUMNS}, p.description,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'day_number', s.day_number, 'heading', s.heading, 'body', s.body) ORDER BY s.sort_order)
        FROM package_itinerary_sections s WHERE s.package_id=p.id), '[]'::jsonb) AS itinerary,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'text', c.text)
        ORDER BY c.kind, c.sort_order) FROM package_content_items c WHERE c.package_id=p.id), '[]'::jsonb) AS content,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', v.key, 'label', v.label, 'is_default', v.is_default,
        'child_min_age', v.child_min_age, 'child_max_age', v.child_max_age,
        'child_discount_percent', v.child_discount_percent::text,
        'rates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'min_party_size', r.min_party_size, 'max_party_size', r.max_party_size,
          'adult_unit_rate', r.adult_unit_rate::text, 'currency', r.currency)
          ORDER BY r.min_party_size) FROM package_rate_tiers r WHERE r.variant_id=v.id), '[]'::jsonb))
        ORDER BY v.sort_order, v.key) FROM package_variants v WHERE v.package_id=p.id), '[]'::jsonb) AS variants
    FROM packages p ${FROM_RATE_JOIN} ${IMAGE_JOIN} WHERE p.slug=$1 AND p.is_active=true`, [slug]);
  return rows[0] ? mapPackageDetailRow(rows[0]) : null;
}
