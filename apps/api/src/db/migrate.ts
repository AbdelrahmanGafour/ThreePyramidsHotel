import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

/**
 * Minimal MySQL migration runner.
 *
 * Applies src/db/schema/*.sql in filename order and records each applied file
 * in `schema_migrations`. A file holds several statements separated by a line
 * containing only `-- ;;` (so no multipleStatements is needed). Usage:
 *   DATABASE_URL=mysql://... tsx src/db/migrate.ts up
 */

const DELIMITER = /^\s*--\s*;;\s*$/m;
const SCHEMA_DIR = path.join(__dirname, 'schema');

export function splitStatements(source: string): string[] {
  return source
    .split(DELIMITER)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !/^\s*--/.test(line) || /^\s*--\s*;;\s*$/.test(line))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

async function up(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }

  const connection = await mysql.createConnection(url);

  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name VARCHAR(255) NOT NULL PRIMARY KEY,
         applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );

    const [rows] = await connection.query('SELECT name FROM schema_migrations');
    const applied = new Set((rows as { name: string }[]).map((row) => row.name));

    const files = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const statements = splitStatements(await readFile(path.join(SCHEMA_DIR, file), 'utf8'));
      for (const statement of statements) {
        await connection.query(statement);
      }
      await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log(`applied ${file} (${statements.length} statements)`);
    }

    console.log('schema is up to date');
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  const command = process.argv[2] ?? 'up';
  if (command !== 'up') {
    console.error(`Unsupported command "${command}" (only "up" is supported)`);
    process.exit(1);
  }
  up().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
