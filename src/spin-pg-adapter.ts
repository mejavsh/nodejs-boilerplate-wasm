/**
 * Adapter that wraps @spinframework/spin-postgres with a pg-compatible API.
 *
 * Drizzle ORM's node-postgres driver expects:
 *   - `Pool` and `Client` classes with query(configObj, params)
 *   - `types` object with `builtins` enum and `getTypeParser()`
 * This adapter translates those calls into Spin's WIT-based Postgres binding.
 */
import * as Postgres from '@spinframework/spin-postgres';

// pg `types` stub — Drizzle uses it for type parser overrides
const builtins = {
  BOOL: 16,
  BYTEA: 17,
  CHAR: 18,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  TEXT: 25,
  OID: 26,
  JSON: 114,
  FLOAT4: 700,
  FLOAT8: 701,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  DATE: 1082,
  INTERVAL: 1186,
  NUMERIC: 1700,
};

export const types = {
  builtins,
  getTypeParser(_typeId: number, _format?: string) {
    // Return identity — Spin already returns JS values
    return (val: any) => val;
  },
};

class SpinPgClient {
  private readonly conn: ReturnType<typeof Postgres.open>;

  constructor(address: string) {
  console.log('[spin-pg] Connecting to:', address);
  try {
    this.conn = Postgres.open(address);
    console.log('[spin-pg] Connection opened successfully');
  } catch (err: any) {
    console.error('[spin-pg] Failed to open connection:', JSON.stringify(err));
    throw err;
  }
}

  /**
   * Drizzle calls: client.query(configObj, params)  where configObj = { text, name, types, rowMode }
   * Also support: client.query(sqlString, params)
   */
   async query(
    textOrConfig: string | { text: string; rowMode?: string; [k: string]: any },
    values?: unknown[],
  ) {
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const rowMode = typeof textOrConfig === 'object' ? textOrConfig.rowMode : undefined;
    const params = (values ?? []).map(toSpinParam);

    let result: any;
    try {
      result = this.conn.query(text, params);
    } catch (error: any) {
      // If we get a WrongType error, retry with swapped int types.
      // Always use BigInt for int64 values — the WIT binding requires bigint.
      const errStr = error?.payload?.val ?? '';
      const match = errStr.match?.(/ToSql\((\d+)\)/);
      if (match) {
        const idx = Number(match[1]);
        const p = params[idx];
        if (p && p.tag === 'int32') {
          params[idx] = { tag: 'int64', val: BigInt(p.val) };
        } else if (p && p.tag === 'int64') {
          params[idx] = { tag: 'int32', val: Number(p.val) };
        }
        try {
          result = this.conn.query(text, params);
        } catch (e2: any) {
          // If it fails again with another param, retry once more
          const errStr2 = e2?.payload?.val ?? '';
          const match2 = errStr2.match?.(/ToSql\((\d+)\)/);
          if (match2) {
            const idx2 = Number(match2[1]);
            const p2 = params[idx2];
            if (p2 && p2.tag === 'int32') {
              params[idx2] = { tag: 'int64', val: BigInt(p2.val) };
            } else if (p2 && p2.tag === 'int64') {
              params[idx2] = { tag: 'int32', val: Number(p2.val) };
            }
            result = this.conn.query(text, params);
          } else {
            throw e2;
          }
        }
      } else {
        console.error('[spin-pg] Query error:', text, JSON.stringify(error?.payload));
        throw error;
      }
    }

    // Convert Spin's row format to what Drizzle expects
    const columns = result.columns ?? [];
    const fields = columns.map((c: any) => ({ name: c.name }));

    let rows: any[];
    if (rowMode === 'array') {
      // Return rows as arrays of values (ordered by column)
      rows = result.rows.map((row: any) => columns.map((c: any) => row[c.name]));
    } else {
      ({ rows } = result);
    }

    return Promise.resolve({ rows, rowCount: rows.length, fields });
  }

  release() {}
}

export class Pool {
  private readonly address: string;

  constructor(config?: { connectionString?: string } | string) {
    if (typeof config === 'string') {
      this.address = config;
    } else {
      this.address = config?.connectionString ?? 'host=localhost user=postgres dbname=spin_counter';
    }
  }

  on() {
    return this;
  }

   async query(textOrConfig: string | { text: string; [k: string]: any }, values?: unknown[]) {
    const client = new SpinPgClient(this.address);
    return client.query(textOrConfig, values);
  }

   async connect() {
    return Promise.resolve(new SpinPgClient(this.address));
  }

   async end() {
    return Promise.resolve();
  }
}

export class Client {
  private readonly address: string;

  constructor(config?: { connectionString?: string } | string) {
    if (typeof config === 'string') {
      this.address = config;
    } else {
      this.address = config?.connectionString ?? 'host=localhost user=postgres dbname=spin_counter';
    }
  }

   async connect() {
    return Promise.resolve();
  }

   async query(textOrConfig: string | { text: string; [k: string]: any }, values?: unknown[]) {
    const client = new SpinPgClient(this.address);
    return client.query(textOrConfig, values);
  }

   async end() {
    return Promise.resolve();
  }
}

function toSpinParam(v: unknown) {
  if (v === null || v === undefined) {return { tag: 'db-null' as const };}
  if (typeof v === 'string') {return { tag: 'str' as const, val: v };}
  if (typeof v === 'boolean') {return { tag: 'boolean' as const, val: v };}
  if (typeof v === 'bigint') {return { tag: 'int64' as const, val: v };}
  if (typeof v === 'number') {
    // Spin's Postgres WIT binding requires exact type matching.
    // Postgres uses int4 for most integer columns, int8 for LIMIT/OFFSET.
    // We can't know which at the adapter level, so try int32 first.
    // If the number is larger than int32 range, use int64.
    if (v % 1 !== 0) {return { tag: 'floating64' as const, val: v };}
    if (v > 2_147_483_647 || v < -2_147_483_648) {return { tag: 'int64' as const, val: BigInt(v) };}
    return { tag: 'int32' as const, val: v };
  }
  if (v instanceof Uint8Array) {return { tag: 'binary' as const, val: v };}
  if (v instanceof Date) {
    // Use the WIT 'datetime' parameter type: (year, month, day, hour, minute, second, nanosecond).
    // Datetime is always treated as UTC by the Spin Postgres binding.
    return {
      tag: 'datetime' as const,
      val: [
        v.getUTCFullYear(),
        v.getUTCMonth() + 1,
        v.getUTCDate(),
        v.getUTCHours(),
        v.getUTCMinutes(),
        v.getUTCSeconds(),
        v.getUTCMilliseconds() * 1_000_000, // ms → ns
      ] as [number, number, number, number, number, number, number],
    };
  }
  return { tag: 'str' as const, val: String(v) };
}

export default { Pool, Client, types };
