import mysql, { type Pool as MysqlPool, type PoolConnection } from 'mysql2/promise';
import { env } from '../config/env';

/**
 * MySQL access with the small `pg`-shaped surface the modules were written
 * against: `query(text, values)` resolves to `{ rows, rowCount }`, and
 * `connect()` hands out a client with `query` and `release`.
 *
 * Differences callers must know about:
 *  - Placeholders may be `?` or numbered `$1, $2, ...` (a number may repeat;
 *    the values are expanded to match).
 *  - SELECT yields `rows` = result rows, `rowCount` = row count. INSERT /
 *    UPDATE / DELETE yield `rows` = [], `rowCount` = affectedRows, and
 *    `insertId` (string) for the first auto-increment id of an INSERT.
 *  - BIGINT / DECIMAL come back as strings (like pg); TINYINT(1) as boolean;
 *    JSON columns are parsed; DATETIME is UTC and comes back as a Date.
 *  - Errors keep `pg`-style `code` / `constraint` so callers can branch on
 *    them: 23505 unique, 23503 foreign key, 23514 check, 40P01 deadlock,
 *    40001 lock-wait timeout / serialization. `constraint` is the index,
 *    foreign key or check name, which the schema keeps identical to the old
 *    PostgreSQL names.
 */

export type QueryResultRow = Record<string, any>;

export type QueryResult<R extends QueryResultRow = QueryResultRow> = {
  rows: R[];
  rowCount: number;
  insertId?: string;
};

export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export type PoolClient = Queryable & { release(discard?: boolean): void };

export type DbPool = Queryable & { connect(): Promise<PoolClient>; end(): Promise<void> };

const NUMBERED = /\$(\d+)/g;

/** Rewrites `$n` placeholders to `?`, reordering/duplicating values to match. */
export function toPositional(text: string, values: unknown[] = []): [string, unknown[]] {
  if (!NUMBERED.test(text)) {
    NUMBERED.lastIndex = 0;
    return [text, values];
  }
  NUMBERED.lastIndex = 0;
  const out: unknown[] = [];
  const sql = text.replace(NUMBERED, (_m, n: string) => {
    out.push(values[Number(n) - 1]);
    return '?';
  });
  return [sql, out];
}

function lastQuoted(message: string, after: RegExp): string | undefined {
  const m = after.exec(message);
  return m?.[1];
}

/** Adds pg-style `code` / `constraint` to a mysql2 error. */
export function translateError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return error;
  }
  const e = error as { code?: string; errno?: number; sqlMessage?: string; constraint?: string };
  const message = e.sqlMessage ?? '';
  switch (e.errno) {
    case 1062: {
      // Duplicate entry 'x' for key 'table.index' (8.0.19+) or 'index'
      const key = lastQuoted(message, /for key '([^']+)'$/);
      e.code = '23505';
      e.constraint = key?.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
      break;
    }
    case 1451:
    case 1452: {
      e.code = '23503';
      e.constraint = lastQuoted(message, /CONSTRAINT `([^`]+)`/);
      break;
    }
    case 3819: {
      e.code = '23514';
      e.constraint = lastQuoted(message, /Check constraint '([^']+)'/);
      break;
    }
    case 1213:
      e.code = '40P01';
      break;
    case 1205:
      e.code = '40001';
      break;
    default:
  }
  return error;
}

function shape<R extends QueryResultRow>(raw: unknown): QueryResult<R> {
  if (Array.isArray(raw)) {
    return { rows: raw as R[], rowCount: raw.length };
  }
  const header = raw as { affectedRows?: number; insertId?: number | string };
  const result: QueryResult<R> = { rows: [], rowCount: header.affectedRows ?? 0 };
  if (header.insertId !== undefined && String(header.insertId) !== '0') {
    result.insertId = String(header.insertId);
  }
  return result;
}

async function run<R extends QueryResultRow>(
  target: MysqlPool | PoolConnection,
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  const [sql, params] = toPositional(text, values);
  try {
    const [raw] = await target.query(sql, params);
    return shape<R>(raw);
  } catch (error) {
    throw translateError(error);
  }
}

const mysqlPool: MysqlPool = mysql.createPool({
  uri: env.databaseUrl,
  connectionLimit: 10,
  timezone: 'Z',
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: false,
  dateStrings: ['DATE'],
  multipleStatements: false,
  typeCast(field, next) {
    if (field.type === 'TINY' && field.length === 1) {
      const value = field.string();
      return value === null ? null : value === '1';
    }
    return next();
  },
});

export const dbPool: DbPool = {
  query: (text, values) => run(mysqlPool, text, values),
  async connect() {
    const connection = await mysqlPool.getConnection();
    return {
      query: (text, values) => run(connection, text, values),
      release: (discard) => (discard ? connection.destroy() : connection.release()),
    };
  },
  end: () => mysqlPool.end(),
};

export async function verifyDatabaseConnection(): Promise<void> {
  await dbPool.query('SELECT 1');
}

export async function closeDatabasePool(): Promise<void> {
  await dbPool.end();
}
