import { Pool } from 'pg';
import { env } from '../config/env';

export const dbPool = new Pool({
  connectionString: env.databaseUrl,
});

export async function verifyDatabaseConnection(): Promise<void> {
  const client = await dbPool.connect();

  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function closeDatabasePool(): Promise<void> {
  await dbPool.end();
}
