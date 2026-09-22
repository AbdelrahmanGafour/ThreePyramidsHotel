import { InvalidPackageSlugError } from './packages.types';

// Absolute end assertion also rejects a trailing newline. Never trim, lowercase
// or decode a second time: Express has already decoded the path parameter.
export function isPackageSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120
    && /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(value);
}

export function parsePackageSlug(value: unknown): string {
  if (!isPackageSlug(value)) throw new InvalidPackageSlugError();
  return value;
}
