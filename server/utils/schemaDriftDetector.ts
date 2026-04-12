import { db } from "../db";
import { sql, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { logInfo, logWarn } from "./logger";
import * as schema from "@shared/schema";

function extractDrizzleTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      try {
        const name = getTableName(value);
        if (name) names.push(name);
      } catch {
      }
    }
  }
  return [...new Set(names)].sort();
}

export async function detectSchemaDrift(): Promise<void> {
  try {
    const drizzleTableNames = extractDrizzleTableNames();

    if (drizzleTableNames.length === 0) {
      logWarn("[schema-drift] Could not extract table names from Drizzle schema — skipping drift detection");
      return;
    }

    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const dbTables = new Set((result.rows as { table_name: string }[]).map(r => r.table_name));
    const drizzleTables = new Set(drizzleTableNames);

    const missingFromDb: string[] = [];
    for (const table of drizzleTables) {
      if (!dbTables.has(table)) {
        missingFromDb.push(table);
      }
    }

    let untrackedCount = 0;
    for (const table of dbTables) {
      if (!drizzleTables.has(table)) {
        untrackedCount++;
      }
    }

    if (missingFromDb.length > 0) {
      logWarn(`[schema-drift] ${missingFromDb.length} table(s) defined in Drizzle schema but MISSING from database: ${missingFromDb.join(", ")}`);
    }

    if (missingFromDb.length === 0) {
      logInfo(`[schema-drift] All ${drizzleTables.size} schema tables present in DB — no drift detected (${untrackedCount} additional DB-only tables)`);
    } else {
      logInfo(`[schema-drift] Check complete: ${drizzleTables.size} schema tables, ${dbTables.size} DB tables, ${missingFromDb.length} missing, ${untrackedCount} DB-only`);
    }
  } catch (err) {
    logWarn(`[schema-drift] Detection failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
  }
}
