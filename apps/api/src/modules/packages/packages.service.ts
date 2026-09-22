import { findActivePackageBySlug, findActivePackages } from './packages.repository';
import { parsePackageSlug } from './packages.validation';
import { PackageNotFoundError, type PackageCard, type PackageCardRecord, type PackageDetail } from './packages.types';

export function toPackageCard(record: PackageCardRecord): PackageCard {
  const status = record.requiresPriceConfirmation ? 'requires_confirmation' : record.fromRate ? 'from' : 'unavailable';
  return {
    code: record.code, slug: record.slug, title: record.title, summary: record.summary,
    durationLabel: record.durationLabel, scheduleLabel: record.scheduleLabel, operatingDays: record.operatingDays,
    currency: record.currency, requiresPriceConfirmation: record.requiresPriceConfirmation,
    pricing: { status, unit: 'per_person', from: status === 'from' ? record.fromRate : null },
  };
}

export async function listPackages(): Promise<PackageCard[]> {
  return (await findActivePackages()).map(toPackageCard);
}

export async function getPackageBySlug(input: unknown): Promise<PackageDetail> {
  const slug = parsePackageSlug(input);
  const record = await findActivePackageBySlug(slug);
  if (!record) throw new PackageNotFoundError();
  return { ...toPackageCard(record), description: record.description, itinerary: record.itinerary,
    included: record.included, excluded: record.excluded, notes: record.notes, variants: record.variants };
}
