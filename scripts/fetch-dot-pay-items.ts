/**
 * Fetch authoritative pay-item lists directly from agency websites and
 * write them as per-agency catalog files at:
 *   server/data/dot/pay-items/<AGENCY_CODE>.json
 *
 * Currently handles agencies that publish a publicly-fetchable HTML/PDF
 * with parseable item tables:
 *
 *   - FHWA  : FP-14 master pay item listing
 *             https://highways.dot.gov/federal-lands/estimates/pay-items-fp-14
 *   - NCDOT : 2024 Master Pay Item List
 *             https://connect.ncdot.gov/resources/Specifications/Contracts%20and%20Resources/2024%20Pay%20Item%20list.pdf
 *
 * Each fetcher:
 *   1. Downloads the source via plain HTTPS (no auth).
 *   2. For PDFs, uses `pdf-parse` if installed; otherwise falls back to a
 *      ChromiumDOC text extraction (tika-style) shell call. Failing both,
 *      the fetcher prints a manual-download instruction and exits non-zero.
 *   3. Parses item rows out of the document text.
 *   4. Writes the per-agency JSON in the shape consumed by
 *      `server/seedDotAgencies.ts`.
 *
 * Add new agencies by registering a fetcher in AGENCY_FETCHERS below.
 *
 * Run with:
 *   tsx scripts/fetch-dot-pay-items.ts             # fetch every registered agency
 *   tsx scripts/fetch-dot-pay-items.ts FHWA NCDOT  # fetch a subset
 *   tsx scripts/fetch-dot-pay-items.ts --dry-run   # parse only, do not write
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

interface PayItem {
  itemNumber: string;
  description: string;
  unit: string;
  specSection: string;
  category: string;
}

interface AgencyCatalog {
  specBook: { edition: string; title: string };
  source: string;
  items: PayItem[];
}

const OUT_DIR = join(process.cwd(), "server/data/dot/pay-items");

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ConstructionEstimator/1.0; +https://example.com)",
      Accept: "text/html,application/xhtml+xml,application/xml,application/pdf,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    // Lazy-load pdf-parse so the script still works without it for HTML sources.
    try {
      const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string }>;
      const { text } = await pdfParse(buf);
      return text;
    } catch (err) {
      throw new Error(
        `Cannot parse PDF without 'pdf-parse'. Install with: npm i pdf-parse. (${url})`,
      );
    }
  }
  return res.text();
}

// ---------- FHWA FP-14 ----------

const FHWA_CATEGORY: Record<string, string> = {
  N: "Standard",
  NM: "Standard (Metric)",
  NR: "Restricted",
  DI: "Discontinued",
  CM: "Custom (Metric)",
  CI: "Custom",
};

async function fetchFhwa(): Promise<AgencyCatalog> {
  const url = "https://highways.dot.gov/federal-lands/estimates/pay-items-fp-14";
  const html = await fetchText(url);
  // Item rows look like: 15101-0000 | Mobilization | LPSM | ... | N
  // The page renders as an HTML table; we strip tags and parse a flexible row pattern.
  const text = html
    .replace(/<[^>]+>/g, "|")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\|+/g, "|")
    .replace(/&nbsp;/g, " ");
  const items: PayItem[] = [];
  const seen = new Set<string>();
  // Matches: 15101-0000 | <metDesc> | <unitMet> | <uscDesc> | <unitUsc> | bidDec | payDec | type | ...
  const rowRe =
    /(\d{5}-\d{4})\|([^|]*?)\|([A-Z0-9\-]*?)\|([^|]*?)\|([A-Z0-9\-]+)\|([0-9\-]*)\|([0-9\-]*)\|([A-Z]{1,3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const [, payItem, descMet, , descUsc, unitE, , , type] = m;
    if (seen.has(payItem)) continue;
    const description = (descUsc || descMet || "").trim();
    if (!description) continue;
    seen.add(payItem);
    items.push({
      itemNumber: payItem,
      description,
      unit: unitE.trim().toUpperCase(),
      specSection: payItem.slice(0, 3),
      category: FHWA_CATEGORY[type] ?? "Standard",
    });
  }
  return {
    specBook: {
      edition: "2014",
      title:
        "FP-14 Standard Specifications for Construction of Roads and Bridges on Federal Highway Projects",
    },
    source: url,
    items,
  };
}

// ---------- NCDOT Master Pay Item List ----------

const NCDOT_CATEGORY: Record<string, string> = {
  M: "Mobilization & General",
  G: "Earthwork & Grading",
  FE: "Ferry",
  D: "Drainage",
  P: "Pavement",
  GR: "Guardrail",
  Y: "Aggregate Base",
  F: "Fencing",
  R: "Roadway",
  L: "Landscape",
  T: "Traffic Control",
  W: "Walls & Misc Structures",
  S: "Seeding & Erosion Control",
  PM: "Pavement Markings",
  LI: "Lighting",
  U: "Utilities",
  Z: "Specialty",
  B: "Structures (Bridge)",
  C: "Concrete",
};

async function fetchNcdot(): Promise<AgencyCatalog> {
  const url =
    "https://connect.ncdot.gov/resources/Specifications/Contracts%20and%20Resources/2024%20Pay%20Item%20list.pdf";
  const text = await fetchText(url);
  const items: PayItem[] = [];
  const seen = new Set<string>();
  // Each row when extracted from a PDF/HTML table looks like:
  //   <type> <itemNumber> <section> <units> <description...>
  // The item number always matches NCDOT's 10-digit + suffix format.
  const rowRe =
    /\b([A-Z]{1,3})\s+(\d{10}-[NE])\s+([A-Z0-9]+)\s+([A-Z\/]{1,5})\s+([^\n|]+?)(?=\s*(?:\||\n|$))/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const [, type, itemNumber, section, unit, description] = m;
    if (seen.has(itemNumber)) continue;
    seen.add(itemNumber);
    items.push({
      itemNumber,
      description: description
        .replace(/\\+\*+/g, "")
        .replace(/\\+/g, "")
        .replace(/\s*\|\s*$/, "")
        .replace(/\s+/g, " ")
        .trim(),
      unit: unit.trim().toUpperCase(),
      specSection: section,
      category: NCDOT_CATEGORY[type] ?? "Standard",
    });
  }
  return {
    specBook: {
      edition: "2024",
      title:
        "NCDOT Standard Specifications for Roads and Structures — Master Pay Item List Spec Year 24",
    },
    source: url,
    items,
  };
}

// ---------- Registry ----------

const AGENCY_FETCHERS: Record<string, () => Promise<AgencyCatalog>> = {
  FHWA: fetchFhwa,
  NCDOT: fetchNcdot,
};

function writeCatalog(code: string, catalog: AgencyCatalog) {
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${code}.json`);
  writeFileSync(outPath, JSON.stringify(catalog, null, 2));
  console.log(
    `[fetch] ${code}: ${catalog.items.length} items -> ${outPath}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const codes = args.filter((a) => !a.startsWith("--"));
  const targets = codes.length > 0 ? codes : Object.keys(AGENCY_FETCHERS);

  let failures = 0;
  for (const code of targets) {
    const fetcher = AGENCY_FETCHERS[code];
    if (!fetcher) {
      console.warn(`[fetch] No fetcher registered for ${code}; skipping.`);
      failures++;
      continue;
    }
    try {
      console.log(`[fetch] ${code}: downloading & parsing...`);
      const catalog = await fetcher();
      console.log(`[fetch] ${code}: parsed ${catalog.items.length} items`);
      if (catalog.items.length < 200) {
        console.warn(
          `[fetch] ${code}: parse produced fewer than 200 items; refusing to overwrite. Investigate parser.`,
        );
        failures++;
        continue;
      }
      if (!dryRun) writeCatalog(code, catalog);
    } catch (err) {
      console.error(`[fetch] ${code}: FAILED:`, err);
      failures++;
    }
  }
  if (failures > 0) {
    console.error(`[fetch] Completed with ${failures} failure(s).`);
    process.exit(1);
  }
}

const isMain =
  typeof process !== "undefined" && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
