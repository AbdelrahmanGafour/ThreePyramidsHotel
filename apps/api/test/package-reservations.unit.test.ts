import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generatePackageBookingReference, isPackageBookingReference } from '../src/modules/package-reservations/booking-reference';
import {
  calculatePackagePrice,
  selectVariant,
  validateOperatingDay,
} from '../src/modules/package-reservations/package-reservations.pricing';
import type {
  PackageReservationInput,
  ReservationPackage,
  ReservationVariant,
} from '../src/modules/package-reservations/package-reservations.types';
import { PackageReservationError } from '../src/modules/package-reservations/package-reservations.types';
import { parsePackageReservationInput } from '../src/modules/package-reservations/package-reservations.validation';

const baseInput = (): PackageReservationInput => ({
  packageSlug: 'synthetic-tour',
  variantKey: null,
  tourDate: '2030-01-07',
  adults: 2,
  children: 0,
  childAges: null,
  guestFirstName: 'Guest',
  guestLastName: 'Example',
  guestEmail: 'guest@example.com',
  guestPhone: '+201000000000',
  guestCountry: 'Egypt',
  specialRequests: null,
});

const pkg = (overrides: Partial<ReservationPackage> = {}): ReservationPackage => ({
  id: '1',
  code: 'TEST',
  slug: 'synthetic-tour',
  title: 'Synthetic Tour',
  operatingDays: null,
  requiresPriceConfirmation: false,
  ...overrides,
});

const variant = (overrides: Partial<ReservationVariant> = {}): ReservationVariant => ({
  id: '2',
  key: 'standard',
  label: 'Standard',
  isDefault: true,
  childMinAge: null,
  childMaxAge: null,
  childDiscountPercent: null,
  ...overrides,
});

describe('package reservation input validation', () => {
  it('normalizes a valid browser body without accepting server-owned data', () => {
    const parsed = parsePackageReservationInput({
      packageSlug: 'synthetic-tour', tourDate: '2030-01-07', adults: 2, children: 1, childAges: [10],
      guestFirstName: ' Guest ', guestLastName: ' Example ', guestEmail: 'Guest@Example.COM',
      guestPhone: ' +201000000000 ', guestCountry: ' Egypt ', specialRequests: ' Window seat ',
    }, '2026-01-01');
    assert.deepEqual(parsed, {
      packageSlug: 'synthetic-tour', variantKey: null, tourDate: '2030-01-07', adults: 2, children: 1,
      childAges: [10], guestFirstName: 'Guest', guestLastName: 'Example', guestEmail: 'guest@example.com',
      guestPhone: '+201000000000', guestCountry: 'Egypt', specialRequests: 'Window seat',
    });
  });

  for (const key of ['price', 'currency', 'total', 'status', 'pricingStatus', 'bookingReference', 'id', 'createdAt']) {
    it(`rejects browser-controlled ${key}`, () => {
      assert.throws(() => parsePackageReservationInput({
        packageSlug: 'synthetic-tour', tourDate: '2030-01-07', adults: 1,
        guestFirstName: 'A', guestLastName: 'B', guestEmail: 'a@example.com', guestPhone: '1', guestCountry: 'Egypt',
        [key]: 'attacker-value',
      }, '2026-01-01'), (error: unknown) => error instanceof PackageReservationError && error.code === 'INVALID_PACKAGE_RESERVATION');
    });
  }

  it('rejects impossible, past and mismatched child-age inputs', () => {
    const valid = { packageSlug: 'synthetic-tour', adults: 1, guestFirstName: 'A', guestLastName: 'B',
      guestEmail: 'a@example.com', guestPhone: '1', guestCountry: 'Egypt' };
    assert.throws(() => parsePackageReservationInput({ ...valid, tourDate: '2030-02-30' }, '2026-01-01'));
    assert.throws(() => parsePackageReservationInput({ ...valid, tourDate: '2025-12-31' }, '2026-01-01'));
    assert.throws(() => parsePackageReservationInput({ ...valid, tourDate: '2030-01-07', children: 2, childAges: [10] }, '2026-01-01'));
  });
});

describe('package booking references', () => {
  it('generates package-specific secure-format references', () => {
    const refs = new Set(Array.from({ length: 128 }, () => generatePackageBookingReference()));
    assert.equal(refs.size, 128);
    for (const value of refs) assert.equal(isPackageBookingReference(value), true);
    assert.equal(isPackageBookingReference('TPH-23456789ABCD'), false);
    assert.equal(isPackageBookingReference('TPP-000000000000'), false);
  });
});

describe('variant and operating-day selection', () => {
  it('uses an explicit variant key, otherwise the single default variant', () => {
    const standard = variant({ key: 'standard', isDefault: true });
    const premium = variant({ id: '3', key: 'premium', label: 'Premium', isDefault: false });
    assert.equal(selectVariant([standard, premium], 'premium').key, 'premium');
    assert.equal(selectVariant([standard, premium], null).key, 'standard');
  });

  it('allows a sole variant even if legacy data did not mark it default', () => {
    assert.equal(selectVariant([variant({ isDefault: false })], null).key, 'standard');
  });

  it('requires a key when multiple variants have no default', () => {
    assert.throws(() => selectVariant([
      variant({ isDefault: false }),
      variant({ id: '3', key: 'premium', label: 'Premium', isDefault: false }),
    ], null), (error: unknown) => error instanceof PackageReservationError && error.code === 'PACKAGE_VARIANT_REQUIRED');
  });

  it('enforces only explicitly configured operating weekdays', () => {
    assert.doesNotThrow(() => validateOperatingDay(pkg({ operatingDays: ['monday'] }), '2030-01-07'));
    assert.throws(() => validateOperatingDay(pkg({ operatingDays: ['monday'] }), '2030-01-08'),
      (error: unknown) => error instanceof PackageReservationError && error.code === 'PACKAGE_OPERATING_DAY_MISMATCH');
    assert.doesNotThrow(() => validateOperatingDay(pkg({ operatingDays: null }), '2030-01-08'));
  });
});

describe('exact package pricing', () => {
  it('calculates adult and explicit child-discount totals in integer minor units', () => {
    const input = { ...baseInput(), adults: 2, children: 1, childAges: [10] };
    const priced = calculatePackagePrice(input, pkg(), variant({
      childMinAge: 6, childMaxAge: 12, childDiscountPercent: '50.00',
    }), '80.25');
    assert.deepEqual(priced, {
      pricingStatus: 'quoted', adultUnitRate: '80.25', childUnitRate: '40.13', totalAmount: '200.63',
    });
  });

  it('requires confirmation when a child cannot be priced without invention', () => {
    const input = { ...baseInput(), children: 1, childAges: null };
    assert.deepEqual(calculatePackagePrice(input, pkg(), variant({
      childMinAge: 6, childMaxAge: 12, childDiscountPercent: '50.00',
    }), '80.00'), {
      pricingStatus: 'requires_confirmation', adultUnitRate: '80.00', childUnitRate: null, totalAmount: null,
    });
  });

  it('preserves known display rates but withholds a total for confirmation-required packages', () => {
    const priced = calculatePackagePrice(baseInput(), pkg({ requiresPriceConfirmation: true }), variant(), '90.00');
    assert.deepEqual(priced, {
      pricingStatus: 'requires_confirmation', adultUnitRate: '90.00', childUnitRate: null, totalAmount: null,
    });
  });

  it('rejects child ages when no age-based catalogue rule exists', () => {
    assert.throws(() => calculatePackagePrice({ ...baseInput(), children: 1, childAges: [10] }, pkg(), variant(), '80.00'),
      (error: unknown) => error instanceof PackageReservationError && error.code === 'INVALID_PACKAGE_RESERVATION');
  });
});
