import { db } from "../db";
import { sql, getTableName, getTableColumns, SQL } from "drizzle-orm";
import {
  PgTable,
  PgColumn,
  isPgEnum,
  getTableConfig,
  type ForeignKey,
  type Index,
  type PrimaryKey,
  type UniqueConstraint,
} from "drizzle-orm/pg-core";
import { logInfo, logWarn, logError } from "./logger";
import * as schema from "@shared/schema";

export interface SchemaDriftResult {
  missingTables: string[];
  missingColumns: { table: string; column: string }[];
  hasDrift: boolean;
}

interface DrizzleTableMeta {
  name: string;
  columns: Map<string, PgColumn>;
}

function extractDrizzleSchema(): Map<string, DrizzleTableMeta> {
  const result = new Map<string, DrizzleTableMeta>();
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      try {
        const tableName = getTableName(value);
        if (!tableName) continue;
        const cols = getTableColumns(value) as Record<string, PgColumn>;
        const colMap = new Map<string, PgColumn>();
        for (const c of Object.values(cols)) {
          if (c?.name) colMap.set(c.name, c);
        }
        result.set(tableName, { name: tableName, columns: colMap });
      } catch {
        // ignore individual table errors
      }
    }
  }
  return result;
}

function extractDrizzleTables(): Map<string, PgTable> {
  const result = new Map<string, PgTable>();
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      try {
        const name = getTableName(value);
        if (name) result.set(name, value);
      } catch {
        // ignore
      }
    }
  }
  return result;
}

export async function detectSchemaDrift(): Promise<SchemaDriftResult> {
  const empty: SchemaDriftResult = { missingTables: [], missingColumns: [], hasDrift: false };
  try {
    const drizzleSchema = extractDrizzleSchema();

    if (drizzleSchema.size === 0) {
      logWarn("[schema-drift] Could not extract table names from Drizzle schema — skipping drift detection");
      return empty;
    }

    const tableResult = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const dbTables = new Set((tableResult.rows as { table_name: string }[]).map(r => r.table_name));

    const columnResult = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const dbColumns = new Map<string, Set<string>>();
    for (const row of columnResult.rows as { table_name: string; column_name: string }[]) {
      let set = dbColumns.get(row.table_name);
      if (!set) {
        set = new Set<string>();
        dbColumns.set(row.table_name, set);
      }
      set.add(row.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: { table: string; column: string }[] = [];

    const sortedTableEntries = [...drizzleSchema.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [tableName, meta] of sortedTableEntries) {
      if (!dbTables.has(tableName)) {
        missingTables.push(tableName);
        continue;
      }
      const actualCols = dbColumns.get(tableName) ?? new Set<string>();
      for (const colName of meta.columns.keys()) {
        if (!actualCols.has(colName)) {
          missingColumns.push({ table: tableName, column: colName });
        }
      }
    }

    let untrackedCount = 0;
    for (const table of dbTables) {
      if (!drizzleSchema.has(table)) untrackedCount++;
    }

    if (missingTables.length > 0) {
      logWarn(`[schema-drift] ${missingTables.length} table(s) defined in Drizzle schema but MISSING from database: ${missingTables.join(", ")}`);
    }
    if (missingColumns.length > 0) {
      const sample = missingColumns.slice(0, 10).map(c => `${c.table}.${c.column}`).join(", ");
      const more = missingColumns.length > 10 ? ` (and ${missingColumns.length - 10} more)` : "";
      logWarn(`[schema-drift] ${missingColumns.length} column(s) defined in Drizzle schema but MISSING from database: ${sample}${more}`);
    }

    if (missingTables.length === 0 && missingColumns.length === 0) {
      logInfo(`[schema-drift] All ${drizzleSchema.size} schema tables/columns present in DB — no drift detected (${untrackedCount} additional DB-only tables)`);
    } else {
      logInfo(`[schema-drift] Check complete: ${drizzleSchema.size} schema tables, ${dbTables.size} DB tables, ${missingTables.length} missing tables, ${missingColumns.length} missing columns, ${untrackedCount} DB-only`);
    }

    return {
      missingTables,
      missingColumns,
      hasDrift: missingTables.length > 0 || missingColumns.length > 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV === "production") {
      // In production, an introspection failure must not be silently treated
      // as "no drift" — that would defeat the fail-loudly contract. Surface
      // it so the startup wrapper can exit.
      throw new Error(`[schema-drift] Detection failed in production: ${msg}`);
    }
    logWarn(`[schema-drift] Detection failed (non-blocking in dev): ${msg}`);
    return empty;
  }
}

const SYNC_COMMAND = "npx drizzle-kit push";

interface DrizzleEnumMeta {
  name: string;
  values: readonly string[];
}

function extractDrizzleEnums(): DrizzleEnumMeta[] {
  const result: DrizzleEnumMeta[] = [];
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) {
      const name = value.enumName;
      const values = value.enumValues;
      if (name && Array.isArray(values)) {
        result.push({ name, values });
      }
    }
  }
  return result;
}

async function ensureMissingEnums(): Promise<{ created: number; failed: number }> {
  const enums = extractDrizzleEnums();
  if (enums.length === 0) return { created: 0, failed: 0 };

  const result = await db.execute(sql`
    SELECT typname FROM pg_type WHERE typtype = 'e'
  `);
  const existing = new Set((result.rows as { typname: string }[]).map(r => r.typname));

  let created = 0;
  let failed = 0;
  for (const e of enums) {
    if (existing.has(e.name)) continue;
    try {
      const valuesList = e.values.map(v => `'${v.replace(/'/g, "''")}'`).join(",");
      await db.execute(sql.raw(`CREATE TYPE "${e.name}" AS ENUM (${valuesList})`));
      created++;
      logInfo(`[schema-drift] Auto-created missing enum ${e.name}`);
    } catch (err) {
      failed++;
      logWarn(`[schema-drift] Failed to auto-create enum ${e.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { created, failed };
}

function literalDefault(def: unknown, sqlType: string): string | null {
  // PostgreSQL `DEFAULT` clauses require a constant expression, not a bind
  // parameter, so we render primitive defaults as inlined SQL literals.
  if (typeof def === "string") return `'${def.replace(/'/g, "''")}'`;
  if (typeof def === "boolean") return def ? "TRUE" : "FALSE";
  if (typeof def === "number") return Number.isFinite(def) ? String(def) : null;
  if (Array.isArray(def)) {
    if (def.length === 0) return `'{}'::${sqlType}`;
    if (def.every(v => typeof v === "string")) {
      const items = def.map(v => `"${(v as string).replace(/"/g, '\\"')}"`).join(",");
      return `'{${items}}'::${sqlType}`;
    }
    if (def.every(v => typeof v === "number" && Number.isFinite(v))) {
      return `'{${def.join(",")}}'::${sqlType}`;
    }
    return null;
  }
  return null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderColumnDefault(column: PgColumn, sqlType: string): string | null {
  if (!column.hasDefault || column.default === undefined) return null;
  const def = column.default;
  if (def instanceof SQL) {
    // Render the SQL fragment by inlining bind params. Drizzle defaults use
    // simple template literals like `gen_random_uuid()` or `now()`, so this
    // is sufficient in practice.
    try {
      const dialect = (db as unknown as { dialect?: { sqlToQuery?: (s: SQL) => { sql: string; params: unknown[] } } }).dialect;
      if (dialect && typeof dialect.sqlToQuery === "function") {
        const compiled = dialect.sqlToQuery(def);
        if (!compiled.params || compiled.params.length === 0) {
          return compiled.sql;
        }
      }
    } catch {
      // fall through
    }
    return null;
  }
  return literalDefault(def, sqlType);
}

/**
 * Synthesize a CREATE TABLE statement (without foreign keys — those are
 * added in a second pass) from a Drizzle table definition. Mirrors the
 * subset of DDL that the hand-written `ensure*Tables.ts` files produced.
 */
function buildCreateTableSql(table: PgTable): { create: SQL; alters: SQL[]; indexes: SQL[] } | null {
  const config = getTableConfig(table);
  const tableName = config.name;
  const cols = config.columns as PgColumn[];
  if (cols.length === 0) return null;

  const colDefs: string[] = [];
  for (const col of cols) {
    const sqlType = col.getSQLType();
    const parts = [`${quoteIdent(col.name)} ${sqlType}`];
    if (col.notNull) parts.push("NOT NULL");
    const defaultLiteral = renderColumnDefault(col, sqlType);
    if (defaultLiteral !== null) parts.push(`DEFAULT ${defaultLiteral}`);
    if (col.primary) parts.push("PRIMARY KEY");
    if (col.isUnique) {
      const uname = col.uniqueName ?? `${tableName}_${col.name}_unique`;
      parts.push(`CONSTRAINT ${quoteIdent(uname)} UNIQUE`);
    }
    colDefs.push(parts.join(" "));
  }

  // Composite primary keys
  const primaryKeys = config.primaryKeys as PrimaryKey[];
  for (const pk of primaryKeys) {
    const colNames = pk.columns.map(c => quoteIdent(c.name)).join(", ");
    const name = pk.getName();
    colDefs.push(`CONSTRAINT ${quoteIdent(name)} PRIMARY KEY (${colNames})`);
  }

  // Composite unique constraints
  const uniques = config.uniqueConstraints as UniqueConstraint[];
  for (const u of uniques) {
    const colNames = u.columns.map(c => quoteIdent(c.name)).join(", ");
    const uname = u.getName() ?? `${tableName}_${u.columns.map(c => c.name).join("_")}_unique`;
    const nullsClause = u.nullsNotDistinct ? " NULLS NOT DISTINCT" : "";
    colDefs.push(`CONSTRAINT ${quoteIdent(uname)} UNIQUE${nullsClause} (${colNames})`);
  }

  const create = sql.raw(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (\n  ${colDefs.join(",\n  ")}\n)`,
  );

  // Foreign keys — emit as ALTER TABLE in a DO-block that swallows
  // duplicate_object so re-runs are idempotent.
  const alters: SQL[] = [];
  const fks = config.foreignKeys as ForeignKey[];
  for (const fk of fks) {
    try {
      const ref = fk.reference();
      const localCols = ref.columns.map(c => quoteIdent(c.name)).join(", ");
      const foreignTableName = getTableName(ref.foreignTable);
      const foreignCols = ref.foreignColumns.map(c => quoteIdent(c.name)).join(", ");
      const fkName = fk.getName();
      let stmt = `ALTER TABLE ${quoteIdent(tableName)} ADD CONSTRAINT ${quoteIdent(fkName)} FOREIGN KEY (${localCols}) REFERENCES ${quoteIdent(foreignTableName)} (${foreignCols})`;
      if (fk.onDelete) stmt += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
      if (fk.onUpdate) stmt += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
      alters.push(sql.raw(`DO $$ BEGIN ${stmt}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`));
    } catch {
      // skip unresolvable FK
    }
  }

  // Indexes
  const indexes: SQL[] = [];
  const idxList = config.indexes as Index[];
  for (const idx of idxList) {
    const cfg = idx.config;
    const colExprs: string[] = [];
    let supported = true;
    for (const c of cfg.columns) {
      if (c instanceof SQL) {
        // Skip indexes with raw SQL expressions — too risky to render.
        supported = false;
        break;
      }
      const colName = (c as { name?: string }).name;
      if (!colName) {
        supported = false;
        break;
      }
      colExprs.push(quoteIdent(colName));
    }
    if (!supported || colExprs.length === 0) continue;
    const name = cfg.name ?? `${tableName}_${colExprs.map(e => e.replace(/"/g, "")).join("_")}_idx`;
    const unique = cfg.unique ? "UNIQUE " : "";
    const using = cfg.method && cfg.method !== "btree" ? ` USING ${cfg.method}` : "";
    indexes.push(sql.raw(
      `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(tableName)}${using} (${colExprs.join(", ")})`,
    ));
  }

  return { create, alters, indexes };
}

interface SynthesizeStats {
  created: number;
  failed: { table: string; reason: string }[];
}

async function synthesizeMissingTables(missingTables: string[]): Promise<SynthesizeStats> {
  const stats: SynthesizeStats = { created: 0, failed: [] };
  if (missingTables.length === 0) return stats;
  const tables = extractDrizzleTables();

  // Pass 1: CREATE TABLE for every missing table (no FKs yet).
  const builds: { name: string; built: ReturnType<typeof buildCreateTableSql> }[] = [];
  for (const name of missingTables) {
    const t = tables.get(name);
    if (!t) {
      stats.failed.push({ table: name, reason: "table not found in Drizzle schema" });
      continue;
    }
    let built: ReturnType<typeof buildCreateTableSql> = null;
    try {
      built = buildCreateTableSql(t);
    } catch (err) {
      stats.failed.push({ table: name, reason: `synthesize failed: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    if (!built) {
      stats.failed.push({ table: name, reason: "no columns or unsupported definition" });
      continue;
    }
    builds.push({ name, built });
  }

  for (const { name, built } of builds) {
    try {
      await db.execute(built!.create);
      stats.created++;
      logInfo(`[schema-drift] Auto-created missing table ${name} from Drizzle schema`);
    } catch (err) {
      stats.failed.push({ table: name, reason: `CREATE TABLE failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Pass 2: foreign keys (after all tables exist so cross-batch refs resolve).
  for (const { name, built } of builds) {
    for (const stmt of built!.alters) {
      try {
        await db.execute(stmt);
      } catch (err) {
        stats.failed.push({ table: name, reason: `ADD CONSTRAINT failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  // Pass 3: indexes.
  for (const { name, built } of builds) {
    for (const stmt of built!.indexes) {
      try {
        await db.execute(stmt);
      } catch (err) {
        stats.failed.push({ table: name, reason: `CREATE INDEX failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  return stats;
}

function buildAddColumnSql(tableName: string, column: PgColumn): SQL | null {
  const sqlType = column.getSQLType();
  const parts: SQL[] = [];
  parts.push(sql`ALTER TABLE ${sql.identifier(tableName)} ADD COLUMN IF NOT EXISTS ${sql.identifier(column.name)} ${sql.raw(sqlType)}`);
  if (column.notNull) parts.push(sql.raw("NOT NULL"));
  if (column.hasDefault && column.default !== undefined) {
    const def = column.default;
    if (def instanceof SQL) {
      parts.push(sql`DEFAULT ${def}`);
    } else {
      const literal = literalDefault(def, sqlType);
      if (literal !== null) {
        parts.push(sql.raw(`DEFAULT ${literal}`));
      } else if (column.notNull) {
        // Can't synthesize a default for a NOT NULL column — adding it would
        // fail on a non-empty table. Bail and surface in the drift banner.
        return null;
      }
    }
  }
  return sql.join(parts, sql` `);
}

/**
 * Task #1075: when schema drift is detected at startup, automatically apply
 * the safe, append-only fixes (ADD COLUMN IF NOT EXISTS) so a freshly-pulled
 * checkout doesn't 500 on /api/dev/test-login because of new columns like
 * `users.crm_backfill_summary_channel`.
 *
 * For drift that we can't auto-apply safely (missing tables, columns whose
 * default we can't synthesize, or any failure), we print a loud banner with
 * the exact one-line repro command (`npx drizzle-kit push`) so the next
 * contributor doesn't lose an hour to a mysterious 500.
 *
 * In production we never auto-mutate the schema — instead we throw so the
 * deploy fails loudly with the same banner.
 *
 * Set `DISABLE_AUTO_DB_SYNC=true` to opt out of the auto-add in dev.
 */
export async function reconcileSchemaDrift(): Promise<void> {
  const drift = await detectSchemaDrift();
  if (!drift.hasDrift) return;

  const isProduction = process.env.NODE_ENV === "production";
  const optOut = process.env.DISABLE_AUTO_DB_SYNC === "true";
  const drizzleSchema = extractDrizzleSchema();

  const printBanner = (kind: "warn" | "error", lines: string[]) => {
    const banner = ["", "============================================================", ...lines, "============================================================", ""].join("\n");
    if (kind === "error") logError(banner);
    else logWarn(banner);
  };

  if (isProduction) {
    printBanner("error", [
      `[schema-drift] DRIFT DETECTED in production — refusing to auto-mutate schema.`,
      `[schema-drift] Missing tables: ${drift.missingTables.length}; missing columns: ${drift.missingColumns.length}`,
      `[schema-drift] Run this against the production DB before retrying deploy:`,
      `[schema-drift]   ${SYNC_COMMAND}`,
    ]);
    throw new Error(`Schema drift detected in production. Run \`${SYNC_COMMAND}\` before starting the server.`);
  }

  if (optOut) {
    printBanner("warn", [
      `[schema-drift] DRIFT DETECTED and auto-sync is disabled (DISABLE_AUTO_DB_SYNC=true).`,
      `[schema-drift] Missing tables: ${drift.missingTables.length}; missing columns: ${drift.missingColumns.length}`,
      `[schema-drift] Run this to sync your dev database:`,
      `[schema-drift]   ${SYNC_COMMAND}`,
    ]);
    return;
  }

  // Auto-add missing columns via append-only ALTER TABLE statements. This is
  // the actual reported pain point (Task #1075) — drizzle-kit push is
  // interactive and can prompt for ambiguous renames, so we don't shell out
  // to it; instead we apply the safe subset directly. First make sure any
  // missing enum types exist, since column ADDs that reference them would
  // otherwise fail with `type "<enum>" does not exist`.
  const enumStats = await ensureMissingEnums();
  if (enumStats.created > 0) {
    logInfo(`[schema-drift] Auto-created ${enumStats.created} missing enum type(s).`);
  }

  // Task #1138: synthesize CREATE TABLE statements for any tables that exist
  // in the Drizzle schema but not in the DB, so adding a new table no longer
  // requires a hand-written `ensure*Tables.ts` migration. This is the table
  // analogue of the column auto-add below — safe (CREATE TABLE IF NOT EXISTS)
  // and bounded to dev (`isProduction` returns above).
  const tableStats = await synthesizeMissingTables(drift.missingTables);
  if (tableStats.created > 0) {
    logInfo(`[schema-drift] Auto-created ${tableStats.created} missing table(s) from Drizzle schema.`);
  }
  for (const f of tableStats.failed) {
    logWarn(`[schema-drift] Failed to auto-create table ${f.table}: ${f.reason}`);
  }

  const failedColumns: { table: string; column: string; reason: string }[] = [];
  let appliedColumns = 0;
  for (const { table, column } of drift.missingColumns) {
    const meta = drizzleSchema.get(table);
    const colDef = meta?.columns.get(column);
    if (!colDef) {
      failedColumns.push({ table, column, reason: "column metadata not found in Drizzle schema" });
      continue;
    }
    try {
      const stmt = buildAddColumnSql(table, colDef);
      if (!stmt) {
        const reason = colDef.notNull && !colDef.hasDefault
          ? "NOT NULL column with no default — cannot be safely auto-added"
          : "unsupported column definition for auto-add";
        failedColumns.push({ table, column, reason });
        logWarn(`[schema-drift] Skipping auto-add for ${table}.${column}: ${reason}`);
        continue;
      }
      await db.execute(stmt);
      appliedColumns++;
      logInfo(`[schema-drift] Auto-added missing column ${table}.${column}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failedColumns.push({ table, column, reason: msg });
      logWarn(`[schema-drift] Failed to auto-add ${table}.${column}: ${msg}`);
    }
  }

  if (appliedColumns > 0) {
    logInfo(`[schema-drift] Auto-added ${appliedColumns} missing column(s) to dev DB.`);
  }

  // Re-check to confirm the auto-add actually closed the column gap.
  const after = await detectSchemaDrift();
  const stillMissingColumns = after.missingColumns.length;
  const stillMissingTables = after.missingTables.length;

  if (stillMissingTables > 0 || stillMissingColumns > 0 || failedColumns.length > 0) {
    const lines = [
      `[schema-drift] Auto-sync handled ${appliedColumns} column(s) but drift remains.`,
      `[schema-drift] Missing tables: ${stillMissingTables}; missing columns: ${stillMissingColumns}; failed adds: ${failedColumns.length}`,
      `[schema-drift] Run this to fully sync your dev database:`,
      `[schema-drift]   ${SYNC_COMMAND}`,
    ];
    if (failedColumns.length > 0) {
      const sample = failedColumns.slice(0, 5).map(f => `${f.table}.${f.column} (${f.reason})`).join("; ");
      lines.push(`[schema-drift] First failures: ${sample}`);
    }
    printBanner("warn", lines);
  }
}
