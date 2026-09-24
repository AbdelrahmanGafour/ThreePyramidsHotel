import type { Request, Response } from 'express';
import { getPackageBySlug, listPackages } from './packages.service';
import { InvalidPackageSlugError, PackageNotFoundError } from './packages.types';

export async function listPackagesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await listPackages() });
}

export async function getPackageHandler(req: Request<{ slug: string }>, res: Response): Promise<void> {
  try {
    res.status(200).json({ data: await getPackageBySlug(req.params.slug) });
  } catch (error) {
    if (error instanceof InvalidPackageSlugError || error instanceof PackageNotFoundError) {
      res.status(error instanceof InvalidPackageSlugError ? 400 : 404)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    throw error;
  }
}
