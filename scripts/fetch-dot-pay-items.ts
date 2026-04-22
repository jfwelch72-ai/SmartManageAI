/**
 * Fetch authoritative pay-item lists directly from agency websites and
 * write them as per-agency catalog files at:
 *   server/data/dot/pay-items/<AGENCY_CODE>.json
 *
 * Currently handles agencies that publish a publicly-fetchable HTML/PDF
 * with parseable item tables:
 *
 *   - FHWA  : FP-14 master pay item listing (HTML table)
 *             https://highways.dot.gov/federal-lands/estimates/pay-items-fp-14
 *   - NCDOT : 2024 Master Pay Item List (PDF, multi-line rows)
 *             https://connect.ncdot.gov/resources/Specifications/Contracts%20and%20Resources/2024%20Pay%20Item%20list.pdf
 *
 * Each fetcher:
 *   1. Downloads the source via plain HTTPS (no auth).
 *   2. For HTML pages, parses table rows out of the markup.
 *   3. For PDFs, uses `pdfjs-dist` to extract positioned text spans, then
 *      groups spans into rows by Y position and into columns by X position.
 *      This preserves multi-line description wraps that a flat
 *      "concatenate every span" extractor would split apart.
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

interface PdfSpan {
  str: string;
  x: number;
  y: number;
}

interface PdfRow {
  y: number;
  spans: PdfSpan[];
}

interface PdfTextItem {
  str: string;
  transform: number[];
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}

interface PdfJsModule {
  getDocument(args: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfDocument> };
}

async function loadPdfDocument(buf: Uint8Array): Promise<PdfDocument> {
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
  return mod.getDocument({
    data: buf,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
}

/**
 * Extract each PDF page as a list of rows (grouped by Y) of positioned spans.
 * This preserves enough geometry for fetchers to detect column positions and
 * multi-line description wraps without conflating distinct rows.
 */
async function extractPdfRows(buf: Uint8Array, url: string): Promise<PdfRow[][]> {
  try {
    const doc = await loadPdfDocument(buf);
    const pages: PdfRow[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const rowsByY = new Map<number, PdfSpan[]>();
      for (const it of tc.items) {
        const str = it.str;
        if (!str || /^\s*$/.test(str)) continue;
        const x = it.transform?.[4] ?? 0;
        const y = it.transform?.[5] ?? 0;
        // Round Y so spans whose baselines differ by sub-pixel jitter still
        // group together. NCDOT's table uses integer Y baselines per row,
        // and 14.4pt line height between rows, so a 1.0pt bucket is safe.
        const yKey = Math.round(y);
        const list = rowsByY.get(yKey) ?? [];
        list.push({ str, x, y });
        rowsByY.set(yKey, list);
      }
      const rows: PdfRow[] = Array.from(rowsByY.entries())
        .map(([yKey, spans]) => ({ y: yKey, spans: spans.sort((a, b) => a.x - b.x) }))
        .sort((a, b) => b.y - a.y);
      pages.push(rows);
    }
    return pages;
  } catch (err) {
    throw new Error(`PDF parse failed for ${url}: ${(err as Error).message}`);
  }
}

async function extractPdfText(buf: Uint8Array, url: string): Promise<string> {
  const pages = await extractPdfRows(buf, url);
  const parts: string[] = [];
  for (const rows of pages) {
    for (const row of rows) parts.push(row.spans.map((s) => s.str).join(" ").replace(/\s+/g, " ").trim());
    parts.push("");
  }
  return parts.join("\n");
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; ConstructionEstimator/1.0; +https://example.com)",
  Accept: "text/html,application/xhtml+xml,application/xml,application/pdf,*/*;q=0.8",
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return extractPdfText(buf, url);
  }
  return res.text();
}

async function fetchPdfPages(url: string): Promise<PdfRow[][]> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return extractPdfRows(buf, url);
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

// NCDOT's Master Pay Item List PDF is a 5-column table with these baseline X
// positions (values measured from page 1; the layout repeats on every page):
//
//   Type ~ 47   ItemNumber ~ 65   Section ~ 153   Units ~ 190   Description >= 215
//
// Every "real" item row begins at the Type column. Long descriptions wrap onto
// follow-up rows that contain *only* a span in the Description column; those
// rows must be appended to the current item's description.
const NCDOT_COLS = {
  type: { min: 40, max: 60 },
  itemNumber: { min: 60, max: 130 },
  section: { min: 145, max: 180 },
  unit: { min: 180, max: 215 },
  // Description column ends before the rightmost "Foot Note No." footnote
  // reference column (centered at x ~ 545). Capping at 530 keeps stray
  // footnote digits from leaking into the description.
  description: { min: 215, max: 530 },
} as const;
const NCDOT_ITEM_RE = /^\d{10}-[NE]$/;
const NCDOT_ARTIFACT_RE =
  /\b(End Of Report|Master Pay Item List|Spec Year|Item Number|^Description$|Foot Note)\b/i;

function ncdotPickColumn(spans: PdfSpan[], col: { min: number; max: number }): string {
  return spans
    .filter((s) => s.x >= col.min && s.x < col.max)
    .map((s) => s.str.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNcdotDescription(s: string): string {
  return s
    .replace(/\s*\|\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchNcdot(): Promise<AgencyCatalog> {
  const url =
    "https://connect.ncdot.gov/resources/Specifications/Contracts%20and%20Resources/2024%20Pay%20Item%20list.pdf";
  const pages = await fetchPdfPages(url);
  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (const rows of pages) {
    let current: PayItem | null = null;
    for (const row of rows) {
      const itemNumber = ncdotPickColumn(row.spans, NCDOT_COLS.itemNumber);
      if (NCDOT_ITEM_RE.test(itemNumber)) {
        // Header row of a new item.
        if (current && !seen.has(current.itemNumber)) {
          current.description = cleanNcdotDescription(current.description);
          if (current.description) {
            items.push(current);
            seen.add(current.itemNumber);
          }
        }
        const type = ncdotPickColumn(row.spans, NCDOT_COLS.type);
        const section = ncdotPickColumn(row.spans, NCDOT_COLS.section);
        const unit = ncdotPickColumn(row.spans, NCDOT_COLS.unit).toUpperCase();
        const description = ncdotPickColumn(row.spans, NCDOT_COLS.description);
        if (!unit) { current = null; continue; }
        current = {
          itemNumber,
          description,
          unit,
          specSection: section,
          category: NCDOT_CATEGORY[type] ?? "Standard",
        };
      } else if (current) {
        // Continuation row: only a description-column span. Reject page
        // header/footer artifacts (top-of-page column titles, "Spec Year 24"
        // banner, "*** End Of Report ***" trailer) so they can't bleed into
        // a description.
        if (row.y < 60 || row.y > 660) continue;
        const desc = ncdotPickColumn(row.spans, NCDOT_COLS.description);
        const hasOtherCols =
          ncdotPickColumn(row.spans, NCDOT_COLS.type) ||
          ncdotPickColumn(row.spans, NCDOT_COLS.itemNumber) ||
          ncdotPickColumn(row.spans, NCDOT_COLS.section) ||
          ncdotPickColumn(row.spans, NCDOT_COLS.unit);
        if (!desc || hasOtherCols) continue;
        if (NCDOT_ARTIFACT_RE.test(desc)) continue;
        current.description = `${current.description} ${desc}`.trim();
      }
    }
    if (current && !seen.has(current.itemNumber)) {
      current.description = cleanNcdotDescription(current.description);
      if (current.description) {
        items.push(current);
        seen.add(current.itemNumber);
      }
    }
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

// Page/report boilerplate that should never appear inside an item description.
// Used as a final guard before we accept the parsed catalog.
const ARTIFACT_PATTERNS: RegExp[] = [
  /End Of Report/i,
  /Master Pay Item List/i,
  /Spec Year \d+/i,
  /^Description$/,
  /\bFoot Note\b/i,
  /\bPage \d+ of \d+\b/i,
];

function findArtifacts(catalog: AgencyCatalog): PayItem[] {
  return catalog.items.filter((it) =>
    ARTIFACT_PATTERNS.some((re) => re.test(it.description)),
  );
}

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
      const artifacts = findArtifacts(catalog);
      if (artifacts.length > 0) {
        console.error(
          `[fetch] ${code}: refusing to write — ${artifacts.length} item(s) have descriptions matching page header/footer artifacts:`,
        );
        for (const a of artifacts.slice(0, 5)) {
          console.error(`         ${a.itemNumber}: ${a.description}`);
        }
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
