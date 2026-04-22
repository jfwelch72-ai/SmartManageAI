/**
 * Import a DOT spec-book pay-item drop (CSV or XML) into the seeder format
 * and/or directly into the database.
 *
 * The output is written to `server/data/dot/pay-items/<AGENCY_CODE>.json`
 * which is consumed by `server/seedDotAgencies.ts` on next boot. When
 * `--push-db` is set and DATABASE_URL is configured, items are also bulk
 * inserted into the dotPayItems table (using the existing /api/dot
 * bulk-upload conflict semantics: skip on existing item-number).
 *
 * Usage examples:
 *   tsx scripts/import-dot-pay-items.ts \
 *     --agency=TXDOT --edition=2014 \
 *     --title="Standard Specifications for Construction and Maintenance" \
 *     --source="https://www.txdot.gov/business/resources/standard-specifications-construction.html" \
 *     --file=./incoming/txdot-2014.csv \
 *     --map=item:Item,desc:Description,unit:Unit,section:Spec,category:Category
 *
 *   tsx scripts/import-dot-pay-items.ts --agency=FDOT --file=./incoming/fdot.xml --format=xml
 *
 *   # Also push to DB
 *   DATABASE_URL=... tsx scripts/import-dot-pay-items.ts --agency=NYSDOT --file=./drop.csv --push-db
 *
 * Required CSV columns (default names; override via --map):
 *   item, description, unit
 * Optional:
 *   section, category
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";

interface ParsedItem {
  itemNumber: string;
  description: string;
  unit: string;
  specSection?: string;
  category?: string;
}

interface CliArgs {
  agency: string;
  file: string;
  format: "csv" | "xml" | "auto";
  edition: string | null;
  title: string | null;
  source: string | null;
  map: Record<string, string>;
  pushDb: boolean;
  outDir: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const [k, v] = a.replace(/^--/, "").split("=");
      args[k] = v === undefined ? true : v;
    }
  }
  if (!args.agency) throw new Error("Missing --agency=<CODE>");
  if (!args.file) throw new Error("Missing --file=<path>");
  const map: Record<string, string> = {
    item: "item",
    desc: "description",
    unit: "unit",
    section: "section",
    category: "category",
  };
  if (typeof args.map === "string") {
    for (const pair of args.map.split(",")) {
      const [k, v] = pair.split(":");
      if (k && v) map[k.trim()] = v.trim();
    }
  }
  return {
    agency: String(args.agency),
    file: String(args.file),
    format: (args.format as CliArgs["format"]) ?? "auto",
    edition: args.edition ? String(args.edition) : null,
    title: args.title ? String(args.title) : null,
    source: args.source ? String(args.source) : null,
    map,
    pushDb: Boolean(args["push-db"]),
    outDir: String(args["out-dir"] ?? "server/data/dot/pay-items"),
    dryRun: Boolean(args["dry-run"]),
    force: Boolean(args.force),
  };
}

// --- Minimal CSV parser (RFC 4180-ish, supports quotes and embedded commas) ---
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let i = 0;
  let inQuote = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuote = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuote = true; i++; continue; }
    if (ch === ",") { cur.push(cell); cell = ""; i++; continue; }
    if (ch === "\n" || ch === "\r") {
      if (cell !== "" || cur.length > 0) { cur.push(cell); rows.push(cur); cur = []; cell = ""; }
      // swallow \r\n pair
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++; continue;
    }
    cell += ch; i++;
  }
  if (cell !== "" || cur.length > 0) { cur.push(cell); rows.push(cur); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = (r[j] ?? "").trim();
    return obj;
  });
}

// --- Minimal XML extractor (looks for <item>...</item> blocks) ---
function parseXmlItems(text: string, map: Record<string, string>): ParsedItem[] {
  const out: ParsedItem[] = [];
  const itemRe = /<(item|payItem|PayItem)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  const tag = (block: string, name: string) => {
    const r = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
    return r.exec(block)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() ?? "";
  };
  while ((m = itemRe.exec(text)) !== null) {
    const block = m[2];
    const it: ParsedItem = {
      itemNumber: tag(block, map.item) || tag(block, "itemNumber") || tag(block, "Item"),
      description: tag(block, map.desc) || tag(block, "description") || tag(block, "Description"),
      unit: tag(block, map.unit) || tag(block, "unit") || tag(block, "Unit"),
      specSection: tag(block, map.section) || tag(block, "section") || undefined,
      category: tag(block, map.category) || tag(block, "category") || undefined,
    };
    if (it.itemNumber && it.description && it.unit) out.push(it);
  }
  return out;
}

function detectFormat(file: string, fmt: CliArgs["format"]): "csv" | "xml" {
  if (fmt !== "auto") return fmt;
  const ext = extname(file).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") return "csv";
  if (ext === ".xml") return "xml";
  // Sniff
  return "csv";
}

function loadItems(args: CliArgs): ParsedItem[] {
  const text = readFileSync(args.file, "utf8");
  const fmt = detectFormat(args.file, args.format);
  if (fmt === "xml") return parseXmlItems(text, args.map);
  // CSV
  const rows = parseCsv(text);
  return rows.map((r) => ({
    itemNumber: r[args.map.item] ?? r.item ?? r.Item ?? "",
    description: r[args.map.desc] ?? r.description ?? r.Description ?? "",
    unit: r[args.map.unit] ?? r.unit ?? r.Unit ?? "",
    specSection: r[args.map.section] || undefined,
    category: r[args.map.category] || undefined,
  })).filter((it) => it.itemNumber && it.description && it.unit);
}

async function maybePushToDb(agency: string, items: ParsedItem[], edition: string | null, title: string | null, source: string | null): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[importer] --push-db requested but DATABASE_URL not set — skipping DB push.");
    return;
  }
  const { db } = await import("../server/db");
  const { dotAgencies, dotSpecBooks, dotPayItems } = await import("@shared/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const a = await db.select().from(dotAgencies).where(eq(dotAgencies.code, agency)).limit(1);
  if (a.length === 0) throw new Error(`Agency ${agency} not found in database`);
  const ed = edition ?? "imported";
  let sb = await db.select().from(dotSpecBooks)
    .where(and(eq(dotSpecBooks.agencyId, a[0].id), eq(dotSpecBooks.edition, ed))).limit(1);
  if (sb.length === 0) {
    const [created] = await db.insert(dotSpecBooks).values({
      agencyId: a[0].id,
      edition: ed,
      title: title ?? `${agency} ${ed} (imported)`,
      isCurrent: true,
      notes: source ? `Source: ${source}` : null,
    }).returning();
    sb = [created];
  }
  const specBookId = sb[0].id;
  const rows = items.map((it) => ({
    specBookId,
    agencyId: a[0].id,
    itemNumber: it.itemNumber,
    description: it.description,
    unit: it.unit,
    specSection: it.specSection ?? null,
    category: it.category ?? null,
    searchTokens: `${it.itemNumber} ${it.description}`.toLowerCase(),
  }));
  // Batched insert with onConflictDoNothing on (specBookId, itemNumber)
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const result = await db.insert(dotPayItems).values(slice).onConflictDoNothing().returning({ id: dotPayItems.id });
    inserted += result.length;
  }
  await db.update(dotSpecBooks).set({
    itemCount: sql`(SELECT COUNT(*) FROM dot_pay_items WHERE spec_book_id = ${specBookId})`,
  }).where(eq(dotSpecBooks.id, specBookId));
  console.log(`[importer] DB push complete: agency=${agency} edition=${ed} inserted=${inserted} (skipped=${rows.length - inserted})`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const items = loadItems(args);
  if (items.length === 0) throw new Error(`No usable rows parsed from ${args.file}`);

  const edition = args.edition ?? `imported-${new Date().toISOString().slice(0, 10)}`;
  const title = args.title ?? `${args.agency} Pay Items (${edition})`;
  const outPath = join(args.outDir, `${args.agency}.json`);

  // Safety: refuse to silently shrink an existing catalog. Importing a small
  // delta drop into the agency file would otherwise replace the entire file.
  // Pass --force to bypass when the shrink is intentional.
  try {
    const existing = JSON.parse(readFileSync(outPath, "utf8"));
    const existingCount = Array.isArray(existing.items) ? existing.items.length : 0;
    if (existingCount > items.length && !args.force) {
      console.error(
        `[importer] REFUSING TO SHRINK: existing ${args.agency}.json has ${existingCount} items; ` +
        `import would write only ${items.length}. Pass --force to override, or use --dry-run to preview.`,
      );
      if (!args.dryRun) process.exit(2);
    }
  } catch {
    // No existing file or unreadable JSON — proceed.
  }

  const out = {
    specBook: { edition, title },
    source: args.source ?? `imported from ${basename(args.file)}`,
    items,
  };

  if (args.dryRun) {
    console.log(`[importer] DRY RUN: would write ${items.length} items -> ${outPath}`);
    console.log(`[importer] Sample item:`, JSON.stringify(items[0]));
    return;
  }

  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[importer] Wrote ${items.length} items -> ${outPath}`);

  if (args.pushDb) await maybePushToDb(args.agency, items, args.edition, args.title, args.source);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
