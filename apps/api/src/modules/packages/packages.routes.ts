import { Router, type ErrorRequestHandler } from 'express';
import { getPackageHandler, listPackagesHandler } from './packages.controller';

export const packagesRouter = Router();
packagesRouter.get('/', listPackagesHandler);
packagesRouter.get('/:slug', getPackageHandler);

const packageErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  // Express can reject malformed URI escapes before the controller runs.
  if (error instanceof URIError) {
    res.status(400).json({ error: { code: 'INVALID_PACKAGE_SLUG', message: 'Invalid package slug encoding' } });
    return;
  }
  // Never expose PostgreSQL errors or turn an outage into a missing package.
  res.status(500).json({ error: { code: 'PACKAGES_UNAVAILABLE', message: 'Package catalogue unavailable' } });
};
packagesRouter.use(packageErrorHandler);
