/**
 * pg-adapter.ts – Drop-in replacement for @supabase/supabase-js using raw pg.Pool.
 *
 * Supports the query-builder patterns used in supabase.ts:
 *   .from(table).select/insert/update/upsert/delete  with chained filters
 *   .rpc(funcName, params)
 *
 * Return format always: { data, error, count? }
 */

import pg from 'pg';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PgError {
  code: string;
  message: string;
  details?: string;
}

interface PgResult<T = any> {
  data: T | null;
  error: PgError | null;
  count?: number | null;
}

type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'is' | 'not_is' | 'not_eq' | 'not_in';

interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

interface OrderClause {
  column: string;
  ascending: boolean;
}

// ---------------------------------------------------------------------------
// QueryBuilder
// ---------------------------------------------------------------------------

class QueryBuilder implements PromiseLike<PgResult> {
  private pool: pg.Pool;
  private table: string;
  private operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private selectColumns: string = '*';
  private filters: Filter[] = [];
  private orderClauses: OrderClause[] = [];
  private limitValue: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleRow: boolean = false;
  private maybeSingleRow: boolean = false;
  private countMode: 'exact' | null = null;
  private headOnly: boolean = false;
  private insertData: Record<string, unknown> | null = null;
  private updateData: Record<string, unknown> | null = null;
  private upsertConflict: string | null = null;
  private returningColumns: string | null = null;

  constructor(pool: pg.Pool, table: string) {
    this.pool = pool;
    this.table = table;
  }

  // -- Operation methods ---------------------------------------------------

  select(
    columns: string = '*',
    opts?: { count?: 'exact'; head?: boolean }
  ): this {
    this.operation = 'select';
    this.selectColumns = columns;
    if (opts?.count === 'exact') this.countMode = 'exact';
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(data: Record<string, unknown>): this {
    this.operation = 'insert';
    this.insertData = data;
    return this;
  }

  update(data: Record<string, unknown>): this {
    this.operation = 'update';
    this.updateData = data;
    return this;
  }

  upsert(
    data: Record<string, unknown>,
    opts?: { onConflict?: string }
  ): this {
    this.operation = 'upsert';
    this.insertData = data;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this.operation = 'delete';
    return this;
  }

  // -- Filters -------------------------------------------------------------

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'neq', value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gt', value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lt', value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lte', value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  not(column: string, op: string, value: unknown): this {
    this.filters.push({ column, op: ('not_' + op) as FilterOp, value });
    return this;
  }

  // -- Modifiers -----------------------------------------------------------

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderClauses.push({
      column,
      ascending: opts?.ascending ?? true,
    });
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single(): this {
    this.singleRow = true;
    return this;
  }

  maybeSingle(): this {
    this.maybeSingleRow = true;
    return this;
  }

  // -- Returning (chained after insert/update/upsert/delete) ---------------

  /**
   * When called after insert/update/upsert/delete, adds RETURNING clause.
   * When called at the top level (from().select()), it's the normal select.
   * We detect by checking the current operation.
   */
  private applyReturning(columns: string = '*'): this {
    this.returningColumns = columns;
    return this;
  }

  // ---------------------------------------------------------------------------
  // The tricky part: `.select()` after `.insert()` means RETURNING,
  // not a new SELECT query. We handle this by overriding select() to
  // detect the current operation.
  // We need to re-define select() to serve dual purpose. The initial
  // `select()` call from from().select() sets operation='select'.
  // A subsequent `.select()` after `.insert()` should set returning.
  // Since the builder is created fresh each time and operations are set
  // by the specific methods (insert/update/etc), we override select:
  // ---------------------------------------------------------------------------

  // Override: redefine select to handle both cases
  // (Already defined above – we need a smarter approach.)

  // ---------------------------------------------------------------------------
  // Build SQL
  // ---------------------------------------------------------------------------

  private buildWhere(paramOffset: number): { clause: string; values: unknown[] } {
    if (this.filters.length === 0) return { clause: '', values: [] };

    const parts: string[] = [];
    const values: unknown[] = [];
    let idx = paramOffset;

    for (const f of this.filters) {
      const col = quoteIdent(f.column);
      switch (f.op) {
        case 'eq':
          parts.push(`${col} = $${++idx}`);
          values.push(f.value);
          break;
        case 'neq':
          parts.push(`${col} != $${++idx}`);
          values.push(f.value);
          break;
        case 'gt':
          parts.push(`${col} > $${++idx}`);
          values.push(f.value);
          break;
        case 'lt':
          parts.push(`${col} < $${++idx}`);
          values.push(f.value);
          break;
        case 'gte':
          parts.push(`${col} >= $${++idx}`);
          values.push(f.value);
          break;
        case 'lte':
          parts.push(`${col} <= $${++idx}`);
          values.push(f.value);
          break;
        case 'in':
          // value is an array
          const arr = f.value as unknown[];
          parts.push(`${col} = ANY($${++idx})`);
          values.push(arr);
          break;
        case 'is':
          if (f.value === null) {
            parts.push(`${col} IS NULL`);
          } else {
            parts.push(`${col} IS $${++idx}`);
            values.push(f.value);
          }
          break;
        case 'not_is':
          if (f.value === null) {
            parts.push(`${col} IS NOT NULL`);
          } else {
            parts.push(`${col} IS NOT $${++idx}`);
            values.push(f.value);
          }
          break;
        case 'not_eq':
          parts.push(`${col} != $${++idx}`);
          values.push(f.value);
          break;
        case 'not_in':
          parts.push(`${col} != ALL($${++idx})`);
          values.push(f.value);
          break;
      }
    }

    return { clause: `WHERE ${parts.join(' AND ')}`, values };
  }

  /**
   * Parse Supabase-style FK join syntax in select columns.
   * e.g. '*, users(telegram_chat_id)' → SELECT t.*, "users"."telegram_chat_id" + LEFT JOIN
   * Returns the joined row data as a nested JSON object to match Supabase format.
   */
  private parseSelectWithJoins(): { selectExpr: string; joinClause: string } {
    const fkPattern = /(\w+)\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const joins: { table: string; columns: string[] }[] = [];

    // Extract FK join patterns
    let cleanSelect = this.selectColumns;
    while ((match = fkPattern.exec(this.selectColumns)) !== null) {
      const joinTable = match[1];
      const joinCols = match[2].split(',').map((c) => c.trim());
      joins.push({ table: joinTable, columns: joinCols });
      // Remove the FK pattern from select string
      cleanSelect = cleanSelect.replace(match[0], '').replace(/,\s*,/, ',').replace(/,\s*$/, '').replace(/^\s*,/, '').trim();
    }

    if (joins.length === 0) {
      const selectCols = this.selectColumns === '*' ? '*' : this.selectColumns;
      return { selectExpr: selectCols, joinClause: '' };
    }

    // Build select expression with join columns as JSON
    const mainCols = cleanSelect || '*';
    const mainTable = quoteIdent(this.table);
    const selectParts = [`${mainTable}.${mainCols === '*' ? '*' : mainCols}`];
    const joinClauses: string[] = [];

    for (const j of joins) {
      const jt = quoteIdent(j.table);
      // Build a JSON object from join columns: json_build_object('col1', jt.col1, ...)
      const jsonParts = j.columns
        .map((c) => `'${c}', ${jt}.${quoteIdent(c)}`)
        .join(', ');
      selectParts.push(`json_build_object(${jsonParts}) AS ${quoteIdent(j.table)}`);

      // Infer FK column using known relationships + convention fallback
      const fkCol = inferFkColumn(this.table, j.table);
      joinClauses.push(`LEFT JOIN ${jt} ON ${mainTable}.${quoteIdent(fkCol)} = ${jt}."id"`);
    }

    return {
      selectExpr: selectParts.join(', '),
      joinClause: joinClauses.join(' '),
    };
  }

  private buildOrderBy(): string {
    if (this.orderClauses.length === 0) return '';
    const parts = this.orderClauses.map(
      (o) => `${quoteIdent(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`
    );
    return `ORDER BY ${parts.join(', ')}`;
  }

  private buildLimitOffset(): string {
    const parts: string[] = [];

    if (this.singleRow || this.maybeSingleRow) {
      parts.push('LIMIT 1');
    } else if (this.rangeTo !== null && this.rangeFrom !== null) {
      const limit = this.rangeTo - this.rangeFrom + 1;
      parts.push(`LIMIT ${limit} OFFSET ${this.rangeFrom}`);
    } else if (this.limitValue !== null) {
      parts.push(`LIMIT ${this.limitValue}`);
    }

    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Execute
  // ---------------------------------------------------------------------------

  async execute(): Promise<PgResult> {
    try {
      switch (this.operation) {
        case 'select':
          return await this.executeSelect();
        case 'insert':
          return await this.executeInsert();
        case 'update':
          return await this.executeUpdate();
        case 'upsert':
          return await this.executeUpsert();
        case 'delete':
          return await this.executeDelete();
        default:
          return { data: null, error: { code: 'UNKNOWN', message: `Unknown op: ${this.operation}` } };
      }
    } catch (err: any) {
      return {
        data: null,
        error: {
          code: err.code || 'PG_ERROR',
          message: err.message || String(err),
          details: err.detail,
        },
      };
    }
  }

  private async executeSelect(): Promise<PgResult> {
    const { clause: whereClause, values } = this.buildWhere(0);
    const orderBy = this.buildOrderBy();
    const limitOffset = this.buildLimitOffset();

    // If head-only + count mode, just return COUNT
    if (this.headOnly && this.countMode === 'exact') {
      const sql = `SELECT COUNT(*) AS cnt FROM ${quoteIdent(this.table)} ${whereClause}`;
      const result = await this.pool.query(sql, values);
      const count = parseInt(result.rows[0]?.cnt ?? '0', 10);
      return { data: null, error: null, count };
    }

    // Build main query — handle Supabase FK join syntax: *, table(col1, col2)
    const { selectExpr, joinClause } = this.parseSelectWithJoins();
    let sql = `SELECT ${selectExpr} FROM ${quoteIdent(this.table)} ${joinClause} ${whereClause} ${orderBy} ${limitOffset}`;

    // If count mode, run count in parallel
    let count: number | null = null;
    if (this.countMode === 'exact') {
      const countSql = `SELECT COUNT(*) AS cnt FROM ${quoteIdent(this.table)} ${joinClause} ${whereClause}`;
      const [dataResult, countResult] = await Promise.all([
        this.pool.query(sql, values),
        this.pool.query(countSql, values),
      ]);
      count = parseInt(countResult.rows[0]?.cnt ?? '0', 10);

      if (this.singleRow) {
        if (dataResult.rows.length === 0) {
          return {
            data: null,
            error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
            count,
          };
        }
        return { data: dataResult.rows[0], error: null, count };
      }
      if (this.maybeSingleRow) {
        return { data: dataResult.rows[0] ?? null, error: null, count };
      }
      return { data: dataResult.rows, error: null, count };
    }

    const result = await this.pool.query(sql, values);

    if (this.singleRow) {
      if (result.rows.length === 0) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
        };
      }
      return { data: result.rows[0], error: null };
    }

    if (this.maybeSingleRow) {
      return { data: result.rows[0] ?? null, error: null };
    }

    return { data: result.rows, error: null };
  }

  private async executeInsert(): Promise<PgResult> {
    const data = this.insertData!;
    const keys = Object.keys(data);
    const cols = keys.map(quoteIdent).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map((k) => serializeValue(data[k]));

    const returning = this.returningColumns
      ? `RETURNING ${this.returningColumns === '*' ? '*' : this.returningColumns}`
      : '';

    const sql = `INSERT INTO ${quoteIdent(this.table)} (${cols}) VALUES (${placeholders}) ${returning}`;
    const result = await this.pool.query(sql, values);

    if (!this.returningColumns) {
      return { data: null, error: null };
    }

    if (this.singleRow) {
      if (result.rows.length === 0) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
        };
      }
      return { data: result.rows[0], error: null };
    }

    if (this.maybeSingleRow) {
      return { data: result.rows[0] ?? null, error: null };
    }

    return { data: result.rows, error: null };
  }

  private async executeUpdate(): Promise<PgResult> {
    const data = this.updateData!;
    const keys = Object.keys(data);
    const setClauses = keys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(', ');
    const values = keys.map((k) => serializeValue(data[k]));

    const { clause: whereClause, values: whereValues } = this.buildWhere(keys.length);
    const allValues = [...values, ...whereValues];

    const returning = this.returningColumns
      ? `RETURNING ${this.returningColumns === '*' ? '*' : this.returningColumns}`
      : '';

    const sql = `UPDATE ${quoteIdent(this.table)} SET ${setClauses} ${whereClause} ${returning}`;
    const result = await this.pool.query(sql, allValues);

    if (!this.returningColumns) {
      return { data: null, error: null };
    }

    if (this.singleRow) {
      if (result.rows.length === 0) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
        };
      }
      return { data: result.rows[0], error: null };
    }

    if (this.maybeSingleRow) {
      return { data: result.rows[0] ?? null, error: null };
    }

    return { data: result.rows, error: null };
  }

  private async executeUpsert(): Promise<PgResult> {
    const data = this.insertData!;
    const keys = Object.keys(data);
    const cols = keys.map(quoteIdent).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map((k) => serializeValue(data[k]));

    const conflictTarget = this.upsertConflict
      ? `(${this.upsertConflict.split(',').map((c) => quoteIdent(c.trim())).join(', ')})`
      : ''; // empty string shouldn't happen in practice

    // Build SET clause excluding the conflict columns
    const conflictCols = new Set(
      (this.upsertConflict || '').split(',').map((c) => c.trim())
    );
    const updateKeys = keys.filter((k) => !conflictCols.has(k));
    const setClause = updateKeys.length > 0
      ? updateKeys.map((k) => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`).join(', ')
      : keys[0] ? `${quoteIdent(keys[0])} = EXCLUDED.${quoteIdent(keys[0])}` : '';

    const returning = this.returningColumns
      ? `RETURNING ${this.returningColumns === '*' ? '*' : this.returningColumns}`
      : '';

    const sql = `INSERT INTO ${quoteIdent(this.table)} (${cols}) VALUES (${placeholders}) ON CONFLICT ${conflictTarget} DO UPDATE SET ${setClause} ${returning}`;
    const result = await this.pool.query(sql, values);

    if (!this.returningColumns) {
      return { data: null, error: null };
    }

    if (this.singleRow) {
      if (result.rows.length === 0) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
        };
      }
      return { data: result.rows[0], error: null };
    }

    if (this.maybeSingleRow) {
      return { data: result.rows[0] ?? null, error: null };
    }

    return { data: result.rows, error: null };
  }

  private async executeDelete(): Promise<PgResult> {
    const { clause: whereClause, values } = this.buildWhere(0);

    const returning = this.returningColumns
      ? `RETURNING ${this.returningColumns === '*' ? '*' : this.returningColumns}`
      : '';

    const sql = `DELETE FROM ${quoteIdent(this.table)} ${whereClause} ${returning}`;
    const result = await this.pool.query(sql, values);

    if (!this.returningColumns) {
      return { data: null, error: null };
    }

    return { data: result.rows, error: null };
  }

  // -- PromiseLike ---------------------------------------------------------

  then<TResult1 = PgResult, TResult2 = never>(
    onfulfilled?: ((value: PgResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// We need `.select()` to serve dual purpose:
//   1. As the primary operation on from(): `from('t').select('*')` → SELECT
//   2. As RETURNING after insert/update/upsert/delete: `from('t').insert({}).select()`
//
// Solution: Override select in a way that detects if an operation is already set.
// ---------------------------------------------------------------------------

const originalSelect = QueryBuilder.prototype.select;

QueryBuilder.prototype.select = function (
  this: QueryBuilder,
  columns?: string,
  opts?: { count?: 'exact'; head?: boolean }
): QueryBuilder {
  // Access the private operation field
  const op = (this as any).operation;
  if (op === 'insert' || op === 'update' || op === 'upsert' || op === 'delete') {
    // This is a RETURNING clause
    (this as any).returningColumns = columns || '*';
    // If opts provided (e.g. count), apply those too
    if (opts?.count === 'exact') (this as any).countMode = 'exact';
    if (opts?.head) (this as any).headOnly = true;
    return this;
  }
  // Otherwise it's a real SELECT
  return originalSelect.call(this, columns, opts);
};

// ---------------------------------------------------------------------------
// FromBuilder – returned by .from(), exposes operation starters
// ---------------------------------------------------------------------------

class FromBuilder {
  private pool: pg.Pool;
  private table: string;

  constructor(pool: pg.Pool, table: string) {
    this.pool = pool;
    this.table = table;
  }

  select(columns?: string, opts?: { count?: 'exact'; head?: boolean }): QueryBuilder {
    const qb = new QueryBuilder(this.pool, this.table);
    return qb.select(columns, opts);
  }

  insert(data: Record<string, unknown>): QueryBuilder {
    const qb = new QueryBuilder(this.pool, this.table);
    return qb.insert(data);
  }

  update(data: Record<string, unknown>): QueryBuilder {
    const qb = new QueryBuilder(this.pool, this.table);
    return qb.update(data);
  }

  upsert(data: Record<string, unknown>, opts?: { onConflict?: string }): QueryBuilder {
    const qb = new QueryBuilder(this.pool, this.table);
    return qb.upsert(data, opts);
  }

  delete(): QueryBuilder {
    const qb = new QueryBuilder(this.pool, this.table);
    return qb.delete();
  }
}

// ---------------------------------------------------------------------------
// PgAdapter – the top-level "supabase-like" client
// ---------------------------------------------------------------------------

class PgAdapter {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  from(table: string): FromBuilder {
    return new FromBuilder(this.pool, table);
  }

  /**
   * Call a stored function: SELECT * FROM func_name(p1 := $1, p2 := $2, ...)
   * Returns { data, error }
   */
  async rpc(funcName: string, params?: Record<string, unknown>): Promise<PgResult> {
    try {
      const paramEntries = params ? Object.entries(params) : [];
      const values = paramEntries.map(([, v]) => serializeValue(v));
      const argList = paramEntries.length > 0
        ? paramEntries.map(([name], i) => `${quoteIdent(name)} := $${i + 1}`).join(', ')
        : '';

      const sql = `SELECT * FROM ${quoteIdent(funcName)}(${argList})`;
      const result = await this.pool.query(sql, values);

      // RPC functions may return a single row with a single column, or multiple rows.
      // Supabase returns the value of the single column if there's only one column,
      // or the full row objects otherwise.
      if (result.rows.length === 0) {
        return { data: null, error: null };
      }

      const cols = result.fields.map((f) => f.name);

      if (cols.length === 1) {
        const colName = cols[0];
        // Single row, single column → return the scalar value
        if (result.rows.length === 1) {
          return { data: result.rows[0][colName], error: null };
        }
        // Multiple rows, single column → return array of values
        return { data: result.rows.map((r) => r[colName]), error: null };
      }

      // Multiple columns → return row objects
      if (result.rows.length === 1) {
        return { data: result.rows[0], error: null };
      }
      return { data: result.rows, error: null };
    } catch (err: any) {
      return {
        data: null,
        error: {
          code: err.code || 'PG_ERROR',
          message: err.message || String(err),
          details: err.detail,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Known foreign key relationships: { sourceTable: { joinTable: fkColumn } }
 * Falls back to convention: singularize(joinTable) + '_id'
 */
const FK_MAP: Record<string, Record<string, string>> = {
  positions:  { users: 'user_id' },
  wallets:    { users: 'user_id' },
  strategies: { users: 'user_id' },
  trade_jobs: { strategies: 'strategy_id', users: 'user_id' },
  executions: { trade_jobs: 'job_id' },
};

/**
 * Infer the foreign key column on `sourceTable` that points to `joinTable`.id.
 */
function inferFkColumn(sourceTable: string, joinTable: string): string {
  const explicit = FK_MAP[sourceTable]?.[joinTable];
  if (explicit) return explicit;
  // Convention: strip trailing 's' to singularize, then add '_id'
  const singular = joinTable.endsWith('s') ? joinTable.slice(0, -1) : joinTable;
  return `${singular}_id`;
}

/**
 * Quote a SQL identifier (table/column name).
 * Simple quoting: wrap in double quotes, escape internal double quotes.
 */
function quoteIdent(name: string): string {
  // Don't quote *, don't quote already-quoted names, and don't quote
  // expressions that contain parentheses or commas (e.g. join selects).
  if (name === '*' || name.includes('(') || name.includes(',')) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Serialize a value for parameterized queries.
 * Objects/arrays → JSON string (for JSONB columns).
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // Check if it's an array of primitives (for IN queries) vs an array of objects (JSONB)
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return JSON.stringify(value);
    }
    // Primitive arrays are passed as-is for ANY() / array parameters
    return value;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL must be set to use pg-adapter');
    }
    _pool = new Pool({ connectionString });
  }
  return _pool;
}

/**
 * Create a PgAdapter instance (lazy pool initialization).
 * Returns an object that quacks like a SupabaseClient for the patterns
 * used in supabase.ts.
 */
export function createPgAdapter(): PgAdapter {
  return new PgAdapter(getPool());
}

export type { PgAdapter, PgResult, PgError };
