import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureTakeoffEnhancements(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'quantity_categories' AND column_name = 'waste_factor'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`ALTER TABLE "quantity_categories" ADD COLUMN IF NOT EXISTS "waste_factor" double precision NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "quantity_categories" ADD COLUMN IF NOT EXISTS "unit_cost" double precision`);
      logInfo("[migration] quantity_categories waste_factor/unit_cost — applied");
    } else {
      logInfo("[migration] quantity_categories waste_factor/unit_cost — already present, skipped");
    }

    const deductionsCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'takeoff_measurements' AND column_name = 'deductions'
      )::boolean AS col_exists
    `);
    const deductionsExists = deductionsCheck.rows[0]?.col_exists === true;

    if (!deductionsExists) {
      await db.execute(sql`ALTER TABLE "takeoff_measurements" ADD COLUMN IF NOT EXISTS "deductions" text`);
      logInfo("[migration] takeoff_measurements deductions — applied");
    } else {
      logInfo("[migration] takeoff_measurements deductions — already present, skipped");
    }
    const conditionCols = [
      { table: "takeoff_conditions", col: "is_favorite", ddl: `boolean NOT NULL DEFAULT false` },
      { table: "takeoff_conditions", col: "formula", ddl: `text` },
      { table: "takeoff_conditions", col: "assembly_components", ddl: `text` },
      { table: "takeoff_sheets", col: "scale_label", ddl: `text` },
    ];
    for (const c of conditionCols) {
      const chk = await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${c.table}' AND column_name='${c.col}')::boolean AS e`
      ));
      if (chk.rows[0]?.e !== true) {
        await db.execute(sql.raw(`ALTER TABLE "${c.table}" ADD COLUMN IF NOT EXISTS "${c.col}" ${c.ddl}`));
        logInfo(`[migration] ${c.table}.${c.col} — applied`);
      }
    }

    const scaleTableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'saved_scale_templates'
      )::boolean AS e
    `);
    if (scaleTableCheck.rows[0]?.e !== true) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "saved_scale_templates" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          "name" text NOT NULL,
          "label" text NOT NULL,
          "px_per_foot" double precision NOT NULL,
          "category" text NOT NULL DEFAULT 'custom',
          "is_built_in" boolean NOT NULL DEFAULT false,
          "created_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "saved_scale_templates_org_idx" ON "saved_scale_templates" ("organization_id")`);
      logInfo("[migration] saved_scale_templates table — created");
    } else {
      const scaleColChecks = [
        { col: "name", ddl: "text NOT NULL DEFAULT ''" },
        { col: "px_per_foot", ddl: "double precision" },
        { col: "category", ddl: "text NOT NULL DEFAULT 'custom'" },
        { col: "is_built_in", ddl: "boolean NOT NULL DEFAULT false" },
      ];
      for (const sc of scaleColChecks) {
        const colChk = await db.execute(sql.raw(
          `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saved_scale_templates' AND column_name='${sc.col}')::boolean AS e`
        ));
        if (colChk.rows[0]?.e !== true) {
          await db.execute(sql.raw(`ALTER TABLE "saved_scale_templates" ADD COLUMN IF NOT EXISTS "${sc.col}" ${sc.ddl}`));
          logInfo(`[migration] saved_scale_templates.${sc.col} — applied`);
        }
      }
    }

  } catch (err) {
    logError("[migration] Failed to ensure takeoff enhancement columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
