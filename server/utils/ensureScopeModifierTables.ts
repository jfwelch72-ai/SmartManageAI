import { pool } from "../db";

export async function ensureScopeModifierTables(): Promise<void> {
  try {
    const { rows: tmRows } = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'tm_ticket_scope_modifiers'
      ) AS exists
    `);
    const { rows: coRows } = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'change_order_scope_modifiers'
      ) AS exists
    `);

    const tmExists = tmRows[0].exists;
    const coExists = coRows[0].exists;

    if (tmExists && coExists) {
      console.log("[migration] scope modifier junction tables — already present, skipped");
      return;
    }

    if (!tmExists) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tm_ticket_scope_modifiers (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          ticket_id VARCHAR NOT NULL REFERENCES tm_tickets(id) ON DELETE CASCADE,
          modifier_id VARCHAR NOT NULL,
          modifier_name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(ticket_id, modifier_id)
        );
        CREATE INDEX IF NOT EXISTS tm_ticket_scope_modifiers_ticket_id_idx ON tm_ticket_scope_modifiers(ticket_id);
      `);
    }

    if (!coExists) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS change_order_scope_modifiers (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          change_order_id VARCHAR NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
          modifier_id VARCHAR NOT NULL,
          modifier_name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(change_order_id, modifier_id)
        );
        CREATE INDEX IF NOT EXISTS change_order_scope_modifiers_co_id_idx ON change_order_scope_modifiers(change_order_id);
      `);
    }

    await backfillScopeModifiers(!tmExists, !coExists);

    console.log("[migration] scope modifier junction tables — created and backfilled");
  } catch (err) {
    console.error("[migration] scope modifier junction tables — failed:", err);
  }
}

async function backfillScopeModifiers(backfillTickets: boolean, backfillCOs: boolean): Promise<void> {
  let ticketCount = 0;
  let coCount = 0;

  if (backfillTickets) {
    const { rows: tickets } = await pool.query(`
      SELECT id, scope_modifier_ids, scope_modifier_names
      FROM tm_tickets
      WHERE scope_modifier_ids IS NOT NULL AND scope_modifier_ids != '' AND scope_modifier_ids != '[]'
    `);

    for (const ticket of tickets) {
      try {
        const ids: string[] = JSON.parse(ticket.scope_modifier_ids);
        let names: string[] = [];
        try { names = ticket.scope_modifier_names ? JSON.parse(ticket.scope_modifier_names) : []; } catch { names = []; }
        if (ids.length === 0) continue;

        const placeholders = ids.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(", ");
        const params = ids.flatMap((modId, i) => [ticket.id, modId, names[i] || modId, i]);

        await pool.query(
          `INSERT INTO tm_ticket_scope_modifiers (ticket_id, modifier_id, modifier_name, sort_order) VALUES ${placeholders} ON CONFLICT (ticket_id, modifier_id) DO NOTHING`,
          params
        );
        ticketCount++;
      } catch (e) {
        console.error(`[migration] scope modifier backfill failed for ticket ${ticket.id}:`, e);
      }
    }
  }

  if (backfillCOs) {
    const { rows: cos } = await pool.query(`
      SELECT id, scope_modifier_ids, scope_modifier_names
      FROM change_orders
      WHERE scope_modifier_ids IS NOT NULL AND scope_modifier_ids != '' AND scope_modifier_ids != '[]'
    `);

    for (const co of cos) {
      try {
        const ids: string[] = JSON.parse(co.scope_modifier_ids);
        let names: string[] = [];
        try { names = co.scope_modifier_names ? JSON.parse(co.scope_modifier_names) : []; } catch { names = []; }
        if (ids.length === 0) continue;

        const placeholders = ids.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(", ");
        const params = ids.flatMap((modId, i) => [co.id, modId, names[i] || modId, i]);

        await pool.query(
          `INSERT INTO change_order_scope_modifiers (change_order_id, modifier_id, modifier_name, sort_order) VALUES ${placeholders} ON CONFLICT (change_order_id, modifier_id) DO NOTHING`,
          params
        );
        coCount++;
      } catch (e) {
        console.error(`[migration] scope modifier backfill failed for change order ${co.id}:`, e);
      }
    }
  }

  console.log(`[migration] scope modifier backfill: ${ticketCount} tickets, ${coCount} change orders`);
}
