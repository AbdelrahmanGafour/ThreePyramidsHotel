/**
 * Who owns a package row: the brochure seed, or an administrator.
 *
 * `seed:packages` reconciles a brochure offering destructively — it rewrites
 * the package's fields and replaces its itinerary, content items and rate
 * tiers outright. That is correct while the brochure is the only author. It
 * stops being correct the moment an administrator can edit a package, because
 * the next seed run would silently undo their work.
 *
 * This column is the boundary. `true` means the brochure still owns the row
 * and the seed may reconcile it; `false` means an administrator has taken it
 * over and the seed must leave it alone entirely.
 *
 * The default is `true`, which is what makes this migration a no-op in
 * behaviour: every existing package — the 42 brochure offerings — is
 * backfilled as seed-owned and keeps reconciling exactly as before. Nothing
 * sets it to `false` yet; the admin write paths that will do so are not built.
 *
 * Deliberately NOT nullable and deliberately not three-valued. "Nobody has
 * decided yet" is not a state this needs: a row is either the brochure's or
 * an administrator's, and a NULL would only invite each reader to guess which.
 *
 * Internal metadata. It describes who may write the row, which is a fact about
 * this system's processes and not about the journey being sold, so it belongs
 * in no public or admin response.
 *
 * Additive and reversible: one column on one table, no constraint on any
 * other, no existing column, index or row touched.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // NOT NULL with a DEFAULT backfills every existing row in one statement, so
  // the 42 brochure packages become seed-owned without a data migration and
  // without this file needing to know a single package code.
  pgm.addColumn('packages', {
    seed_managed: { type: 'boolean', notNull: true, default: true },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drops exactly what `up` added and nothing else. The ownership this column
  // recorded is lost, which is the honest outcome: without it every package is
  // seed-owned again, and that is precisely the state this migration found.
  pgm.dropColumn('packages', 'seed_managed');
};
