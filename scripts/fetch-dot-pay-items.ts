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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
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

// ---------- WSDOT Standard Item Table ----------
//
// WSDOT publishes a "Standard Item Table" PDF (DOT-RGG101) that lists every
// pay item grouped by spec section. Layout is *transposed*: each page has
// one section, with up to 22 items laid out as columns. Per-column rows:
//
//   y ~ 613 : ITEM USE banner (STANDARD ITEM, GSP ITEM, REQUIRES SPECIAL PROV.)
//   y ~ 578 : Prequal code (e.g. A1, D6, T0) — informational
//   y ~ 321 : Section name (single span, e.g. "PREPARATION") — page-level
//   y ~ 299 : Section number (single span, e.g. "1") — page-level
//   y ~ 119 : Description; trailing dashes + "(NN)" page reference stripped
//   y ~ 78-90 : Unit (LS, ACRE, EACH, CY, ...) spread across a few unit rows
//   y ~ 28-33 : 4-digit STD item number (the unique within-section id)
//
// Item numbers are emitted verbatim as the 4-digit STD ITEM code from
// the PDF (e.g. "0001"). They are unique across the entire WSDOT
// catalog, so no synthetic section prefix is needed; the spec section
// is captured separately on each item.

const WSDOT_URL =
  "https://wsdot.wa.gov/sites/default/files/2024-05/Standard-Item-Table.pdf";

function wsdotPickAt(spans: PdfSpan[], xCenter: number, tol: number): string {
  return spans
    .filter((s) => Math.abs(s.x - xCenter) <= tol)
    .map((s) => s.str.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function wsdotNormalizeUnit(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/^L S$/, "LS")
    .replace(/^LSUM$/, "LS")
    .trim();
}

async function fetchWsdot(): Promise<AgencyCatalog> {
  const pages = await fetchPdfPages(WSDOT_URL);
  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (const rows of pages) {
    const secNameRow = rows.find((r) => r.y >= 310 && r.y <= 340);
    const secNumRow = rows.find((r) => r.y >= 290 && r.y <= 310);
    if (!secNameRow || !secNumRow) continue;
    // Some pages render the section name twice on adjacent baselines; dedupe
    // consecutive identical tokens so we don't emit "IN STOCKPILE IN STOCKPILE".
    const nameTokens = secNameRow.spans
      .map((s) => s.str.trim())
      .filter(Boolean);
    const dedupedName: string[] = [];
    for (const t of nameTokens) {
      if (dedupedName[dedupedName.length - 1] !== t) dedupedName.push(t);
    }
    let sectionName = dedupedName.join(" ").trim();
    // Also collapse "FOO BAR FOO BAR" -> "FOO BAR" (full-phrase doubles).
    const half = sectionName.length >>> 1;
    if (sectionName.length > 0 && sectionName.length % 2 === 1) {
      const mid = (sectionName.length - 1) / 2;
      if (sectionName[mid] === " " &&
          sectionName.slice(0, mid) === sectionName.slice(mid + 1)) {
        sectionName = sectionName.slice(0, mid);
      }
    } else if (half > 0 && sectionName.slice(0, half).trimEnd() === sectionName.slice(half).trimStart()) {
      sectionName = sectionName.slice(0, half).trimEnd();
    }
    const sectionNumber = secNumRow.spans
      .map((s) => s.str.trim())
      .filter(Boolean)
      .join("")
      .trim();
    if (!/^\d+$/.test(sectionNumber)) continue;

    const stdItemRows = rows.filter((r) => r.y >= 25 && r.y <= 35);
    const xSet = new Map<number, number>();
    for (const row of stdItemRows) {
      for (const s of row.spans) {
        if (/^\d{4}$/.test(s.str.trim())) {
          const xR = Math.round(s.x);
          xSet.set(xR, (xSet.get(xR) ?? 0) + 1);
        }
      }
    }
    const cols = [...xSet.keys()].sort((a, b) => a - b);
    if (cols.length === 0) continue;

    const descRow = rows.find((r) => r.y >= 110 && r.y <= 130);
    const unitRows = rows.filter((r) => r.y >= 75 && r.y <= 95);

    for (const xCol of cols) {
      let stdNum = "";
      for (const row of stdItemRows) {
        const v = wsdotPickAt(row.spans, xCol, 4);
        if (/^\d{4}$/.test(v)) {
          stdNum = v;
          break;
        }
      }
      if (!stdNum) continue;
      // STD ITEM numbers are unique across the whole WSDOT catalog, so we
      // emit them verbatim (matching the PDF's "STD ITEM" column exactly).
      const itemNumber = stdNum;
      if (seen.has(itemNumber)) continue;

      const descRaw = descRow ? wsdotPickAt(descRow.spans, xCol, 11) : "";
      const description = descRaw
        .replace(/-+\s*\(\d+\)\s*$/, "")
        .replace(/-+$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!description) continue;

      const unitParts: string[] = [];
      for (const row of unitRows) {
        const v = wsdotPickAt(row.spans, xCol, 11);
        if (v && !/^EST\.?$/i.test(v)) unitParts.push(v);
      }
      const unit = wsdotNormalizeUnit(unitParts.join(" "));
      if (!unit) continue;

      seen.add(itemNumber);
      items.push({
        itemNumber,
        description,
        unit,
        specSection: sectionNumber,
        category: sectionName,
      });
    }
  }
  return {
    specBook: {
      edition: "2024",
      title:
        "WSDOT Standard Specifications for Road, Bridge, and Municipal Construction — Standard Item Table (English, DOT-RGG101)",
    },
    source: WSDOT_URL,
    items,
  };
}

// ---------- CDOT (Colorado) ----------
//
// CDOT publishes its complete Item Code Book as an XLSX workbook updated
// periodically (the latest as of writing is the 2025-10-14 edition). The
// sheet has a single tab with one row per pay item and four columns:
//
//   A: Item Code (e.g. "201-00005", verbatim 9-character code)
//   B: Long Description
//   C: Short Description (used by AASHTOWare CES bid forms)
//   D: Unit of Measurement (L S, EACH, CY, T, ...)
//
// We emit the long description verbatim, normalize the unit to the same
// canonical form used elsewhere in this codebase, and derive a category
// from the section number prefix using CDOT's Standard Specifications
// section ranges (200 = Earthwork, 300 = Bases, etc.).

const CDOT_URL =
  "https://www.codot.gov/business/eema/assets/item-code-book-20251014.xlsx";

function cdotNormalizeUnit(raw: string): string {
  const u = String(raw || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  // CDOT writes "L S" with a space; match the existing canonical "LS".
  if (u === "L S" || u === "LSUM" || u === "LUMP SUM") return "LS";
  return u;
}

function cdotCategoryForSection(section: string): string {
  const n = parseInt(section, 10);
  if (Number.isNaN(n)) return "MISCELLANEOUS";
  if (n < 200) return "MOBILIZATION & PROJECT ADMINISTRATION";
  if (n < 300) return "EARTHWORK & SITE PREPARATION";
  if (n < 400) return "BASES";
  if (n < 500) return "PAVEMENTS";
  if (n < 600) return "STRUCTURES";
  if (n < 700) return "INCIDENTAL CONSTRUCTION";
  if (n < 800) return "MATERIALS";
  return "SPECIAL & FORCE ACCOUNT";
}

interface XlsxModule {
  read(data: Uint8Array, opts: { type: "buffer" }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json(
      sheet: unknown,
      opts: { header: 1; defval: string },
    ): unknown[][];
  };
}

async function fetchCdot(): Promise<AgencyCatalog> {
  const res = await fetch(CDOT_URL);
  if (!res.ok) {
    throw new Error(`CDOT XLSX fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const xlsxMod = (await import("xlsx")) as unknown as XlsxModule;
  const wb = xlsxMod.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("CDOT XLSX has no sheets");
  const rows = xlsxMod.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
  });

  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const itemNumber = String(r[0] ?? "").trim();
    if (!/^\d{3}-\d{5}$/.test(itemNumber)) continue;
    if (seen.has(itemNumber)) continue;
    const description = String(r[1] ?? "").replace(/\s+/g, " ").trim();
    if (!description) continue;
    const unit = cdotNormalizeUnit(String(r[3] ?? ""));
    if (!unit) continue;
    const sectionNumber = itemNumber.slice(0, 3);
    seen.add(itemNumber);
    items.push({
      itemNumber,
      description,
      unit,
      specSection: sectionNumber,
      category: cdotCategoryForSection(sectionNumber),
    });
  }

  return {
    specBook: {
      edition: "2021",
      title:
        "CDOT Standard Specifications for Road and Bridge Construction — Item Code Book (2025-10-14 edition)",
    },
    source: CDOT_URL,
    items,
  };
}

// ---------- INDOT (Indiana) ----------
//
// INDOT publishes its master English Pay Items catalog as an XLSX with a
// single sheet. Header row 3 declares the columns (SECTION, ITEM,
// DESCRIPTION, UNIT, TYPE, COMMENTS, MANDATORY SUPPLEMENTAL DESCRIPTION).
// Items are 10-character codes ("104-000195") with a 3-digit section
// prefix. Categories are derived from the section number using INDOT's
// Standard Specifications section ranges, which mirror AASHTO's.

const INDOT_URL =
  "https://www.in.gov/indot/doing-business-with-indot/files/Current-English-Pay-Items-4.1.2026.xlsx";

function indotCategoryForSection(section: string): string {
  const n = parseInt(section, 10);
  if (Number.isNaN(n)) return "MISCELLANEOUS";
  if (n < 200) return "GENERAL CONTRACT REQUIREMENTS";
  if (n < 300) return "EARTHWORK & SUBGRADE";
  if (n < 400) return "BASES";
  if (n < 500) return "PAVEMENTS";
  if (n < 600) return "STRUCTURES";
  if (n < 700) return "INCIDENTAL CONSTRUCTION";
  if (n < 800) return "MATERIALS";
  return "SPECIAL & CONTINGENT";
}

function indotNormalizeUnit(raw: string): string {
  const u = String(raw || "").toUpperCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (u === "L S" || u === "LSUM") return "LS";
  return u;
}

async function fetchIndot(): Promise<AgencyCatalog> {
  const res = await fetch(INDOT_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`INDOT XLSX fetch failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const xlsxMod = (await import("xlsx")) as unknown as XlsxModule;
  const wb = xlsxMod.read(buf, { type: "buffer" });
  const sn = wb.SheetNames[0];
  if (!sn) throw new Error("INDOT XLSX has no sheets");
  const rows = xlsxMod.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" });

  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const sec = String(r[0] ?? "").trim();
    const itemNumber = String(r[1] ?? "").trim();
    // INDOT codes use either 3-5 ("104-05404") or 3-6 ("104-000195") digits.
    if (!/^\d{3}-\d{5,6}$/.test(itemNumber)) continue;
    if (seen.has(itemNumber)) continue;
    const description = String(r[2] ?? "").replace(/\s+/g, " ").trim();
    const unit = indotNormalizeUnit(String(r[3] ?? ""));
    if (!description || !unit) continue;
    const sectionNumber = /^\d+$/.test(sec) ? sec : itemNumber.slice(0, 3);
    seen.add(itemNumber);
    items.push({
      itemNumber,
      description,
      unit,
      specSection: sectionNumber,
      category: indotCategoryForSection(sectionNumber),
    });
  }

  return {
    specBook: {
      edition: "2024",
      title:
        "INDOT Standard Specifications — Current English Pay Items List (2026-04-01 edition)",
    },
    source: INDOT_URL,
    items,
  };
}

// ---------- IADOT (Iowa) ----------
//
// Iowa DOT publishes its English Item Catalog as an XLSX workbook with
// three sheets: Current, Obsolete, and Testing Frequencies. We pull only
// the Current sheet. Header row 4 declares the columns (Item Code,
// Description, Units, Form, Support Forms, ...). Item codes are 12-char
// codes like "2101-0850001"; the first 4 digits are the spec section.

const IADOT_URL =
  "https://iowadot.gov/Construction_Materials/inspection_tools/englishforms/current_e_pay_items.xlsx";

function iadotCategoryForSection(section: string): string {
  // Iowa DOT uses 4-digit section numbers grouped into Divisions:
  // 21xx Earthwork; 22xx Base Course; 23xx Surface Course;
  // 24xx Bridges; 25xx Misc Construction; 26xx Drainage; 27xx Curbs/Walks;
  // 41xx-44xx Materials; 81xx-85xx Structures.
  const n = parseInt(section, 10);
  if (Number.isNaN(n)) return "MISCELLANEOUS";
  if (n < 2200) return "EARTHWORK";
  if (n < 2300) return "BASE COURSE";
  if (n < 2400) return "SURFACE COURSE";
  if (n < 2500) return "BRIDGES & STRUCTURES";
  if (n < 2600) return "INCIDENTAL CONSTRUCTION";
  if (n < 2700) return "DRAINAGE";
  if (n < 2800) return "CURBS, GUTTERS & WALKS";
  if (n < 2900) return "FENCES & GUARDRAIL";
  if (n < 4000) return "TRAFFIC CONTROL & SAFETY";
  if (n < 5000) return "MATERIALS";
  return "SPECIAL & SUPPLEMENTAL";
}

function iadotNormalizeUnit(raw: string): string {
  const u = String(raw || "").toUpperCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (u === "L S" || u === "LSUM") return "LS";
  return u;
}

async function fetchIadot(): Promise<AgencyCatalog> {
  const res = await fetch(IADOT_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`IADOT XLSX fetch failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const xlsxMod = (await import("xlsx")) as unknown as XlsxModule;
  const wb = xlsxMod.read(buf, { type: "buffer" });
  if (!wb.SheetNames.includes("Current")) {
    throw new Error("IADOT XLSX missing 'Current' sheet");
  }
  const rows = xlsxMod.utils.sheet_to_json(wb.Sheets["Current"], { header: 1, defval: "" });

  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const itemNumber = String(r[0] ?? "").trim();
    if (!/^\d{4}-\d{7}$/.test(itemNumber)) continue;
    if (seen.has(itemNumber)) continue;
    const description = String(r[1] ?? "").replace(/\s+/g, " ").trim();
    const unit = iadotNormalizeUnit(String(r[2] ?? ""));
    if (!description || !unit) continue;
    const sectionNumber = itemNumber.slice(0, 4);
    seen.add(itemNumber);
    items.push({
      itemNumber,
      description,
      unit,
      specSection: sectionNumber,
      category: iadotCategoryForSection(sectionNumber),
    });
  }

  return {
    specBook: {
      edition: "2023",
      title:
        "Iowa DOT Standard Specifications — Index to English Item Forms (Current as of October 2025 Letting)",
    },
    source: IADOT_URL,
    items,
  };
}

// ---------- MAINEDOT (Maine) ----------
//
// Maine DOT publishes its English Item Catalog as a multi-page PDF with
// a stable column layout on each data page:
//   ITEM        x ~ 53-95  (item number like "102.06" or "202.0791")
//   DESCRIPTION x ~ 115
//   UNITS       x ~ 421-449
//   HYBRID LS   x ~ 477-508 (a secondary unit, ignored)
// Page 1 is identical in layout to subsequent pages. The header row
// (y ~ 727) and page title (y ~ 759) are filtered out.

const MAINEDOT_URL =
  "https://www.maine.gov/dot/sites/maine.gov.dot/files/2023-08/english-03-29-23.pdf";

function mainedotCategoryForSection(section: string): string {
  // Maine DOT spec sections follow AASHTO's broad ranges:
  // 100s general; 200s earthwork; 300s bases; 400s pavements;
  // 500s structures; 600s incidental; 700s materials.
  const n = parseInt(section, 10);
  if (Number.isNaN(n)) return "MISCELLANEOUS";
  if (n < 200) return "GENERAL CONTRACT REQUIREMENTS";
  if (n < 300) return "EARTHWORK & SUBGRADE";
  if (n < 400) return "BASES";
  if (n < 500) return "PAVEMENTS";
  if (n < 600) return "STRUCTURES";
  if (n < 700) return "INCIDENTAL CONSTRUCTION";
  return "MATERIALS & SPECIAL";
}

function mainedotPick(spans: PdfSpan[], xMin: number, xMax: number): string {
  return spans
    .filter((s) => s.x >= xMin && s.x <= xMax)
    .map((s) => s.str.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchMaineDot(): Promise<AgencyCatalog> {
  const pages = await fetchPdfPages(MAINEDOT_URL);
  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (const rows of pages) {
    for (const row of rows) {
      // Skip header band and page title.
      if (row.y >= 720) continue;
      // Skip page footers (small y values for page numbers).
      if (row.y < 50) continue;
      const itemRaw = mainedotPick(row.spans, 50, 100);
      if (!/^\d{3}(\.\d+)?$/.test(itemRaw)) continue;
      if (seen.has(itemRaw)) continue;
      const description = mainedotPick(row.spans, 110, 420)
        .replace(/^[\s\-]+|[\s\-]+$/g, "")
        .trim();
      const unitRaw = mainedotPick(row.spans, 420, 470);
      const unit = unitRaw
        .toUpperCase()
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!description || !unit) continue;
      const sectionNumber = itemRaw.split(".")[0];
      seen.add(itemRaw);
      items.push({
        itemNumber: itemRaw,
        description,
        unit,
        specSection: sectionNumber,
        category: mainedotCategoryForSection(sectionNumber),
      });
    }
  }
  return {
    specBook: {
      edition: "2020",
      title:
        "MaineDOT Standard Specifications — English Item Catalog (2023-03-29 edition)",
    },
    source: MAINEDOT_URL,
    items,
  };
}

// ---------- MODOT (Missouri) ----------
//
// MoDOT publishes a complete Bid Items Listing PDF (linked from
// https://www.modot.org/bid-items-listing). Each data row carries:
//   ITEM NO.         x ~ 72  (numeric/alpha-suffixed item codes)
//   UNIT             x ~ 131
//   TYPE             x ~ 169 (accuracy multiplier; ignored)
//   ITEM DESCRIPTION x ~ 207
// Page 1 is a title page; page 2 onward begin with a two-line header
// (y ~ 745 with state name and y ~ 725 with column titles).

const MODOT_URL = "https://www.modot.org/media/54227";

function modotCategoryForSection(itemNumber: string): string {
  // MoDOT item numbers begin with the related Standard Specification
  // section number (Sec. 100-1000). Example: 1041000 -> Sec. 104,
  // 2026010 -> Sec. 202.
  const sec = itemNumber.length >= 3 ? itemNumber.slice(0, 3) : "";
  const n = parseInt(sec, 10);
  if (Number.isNaN(n)) return "MISCELLANEOUS";
  if (n < 200) return "GENERAL CONTRACT REQUIREMENTS";
  if (n < 300) return "REMOVALS & PREPARATION";
  if (n < 400) return "EARTHWORK";
  if (n < 500) return "PAVEMENTS";
  if (n < 600) return "STRUCTURES";
  if (n < 700) return "INCIDENTAL CONSTRUCTION";
  if (n < 800) return "MATERIALS";
  return "SPECIAL & MAINTENANCE";
}

function modotPick(spans: PdfSpan[], xMin: number, xMax: number): string {
  return spans
    .filter((s) => s.x >= xMin && s.x <= xMax)
    .map((s) => s.str.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchModot(): Promise<AgencyCatalog> {
  const pages = await fetchPdfPages(MODOT_URL);
  const items: PayItem[] = [];
  const seen = new Set<string>();
  for (let p = 0; p < pages.length; p++) {
    const rows = pages[p];
    for (const row of rows) {
      // Skip top-of-page header band.
      if (row.y >= 720) continue;
      if (row.y < 60) continue;
      const itemRaw = modotPick(row.spans, 60, 120);
      if (!/^\d{6,8}[A-Z]?$/.test(itemRaw)) continue;
      if (seen.has(itemRaw)) continue;
      const unit = modotPick(row.spans, 125, 165)
        .toUpperCase()
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim();
      const description = modotPick(row.spans, 200, 600)
        .replace(/\s+/g, " ")
        .trim();
      if (!description || !unit) continue;
      const sectionNumber = itemRaw.length >= 3 ? itemRaw.slice(0, 3) : "";
      seen.add(itemRaw);
      items.push({
        itemNumber: itemRaw,
        description,
        unit,
        specSection: sectionNumber,
        category: modotCategoryForSection(itemRaw),
      });
    }
  }
  return {
    specBook: {
      edition: "2024",
      title:
        "MoDOT Standard Specifications for Highway Construction — Bid Items Listing (effective January 1, 2026; issued November 12, 2025)",
    },
    source: MODOT_URL,
    items,
  };
}

// ---------- Registry ----------

// ---------- Staged-drop manifest for the remaining 10 DOT agencies ----------
//
// The agencies below publish their authoritative pay-item lists behind
// portals, JS apps, login walls, or CDNs (Akamai) that reject scripted
// clients from this sandbox. Until those drops can be fetched directly, the
// workflow is:
//
//   1. A human on a host with outbound access downloads the published file
//      from `sourceUrl` (or the agency's portal noted in `notes`).
//   2. They normalize it to CSV (or XML) and drop it at `incoming/<CODE>.csv`
//      (or `.xml`). See `incoming/README.md` for column conventions.
//   3. They run `tsx scripts/fetch-dot-pay-items.ts <CODE>` which loads the
//      drop, validates it against `expectedMinItems`, and writes
//      `server/data/dot/pay-items/<CODE>.json`. Equivalent to the importer
//      but with the manifest's edition/title/source pre-filled.
//
// `expectedMinItems` mirrors the floors enforced in
// `server/seedDotAgencies.ts` so the fetcher refuses to overwrite a real
// catalog with a truncated drop.
interface StagedDrop {
  edition: string;
  title: string;
  sourceUrl: string;
  expectedMinItems: number;
  // Optional column-name overrides for CSV drops. Keys are the canonical
  // fields; values are the header names in the source file.
  csvColumnMap?: Partial<{
    item: string;
    description: string;
    unit: string;
    section: string;
    category: string;
  }>;
  notes?: string;
}

const STAGED_AGENCIES: Record<string, StagedDrop> = {
  FHWA: {
    edition: "2014",
    title:
      "FP-14 Standard Specifications for Construction of Roads and Bridges on Federal Highway Projects",
    sourceUrl: "https://highways.dot.gov/federal-lands/estimates/pay-items-fp-14",
    expectedMinItems: 3500,
    notes:
      "Akamai blocks scripted clients (HTTP 403). Open the page in a browser, copy the FP-14 master list table, and save as CSV with columns Item,Description,Unit,Section,Category.",
  },
  TXDOT: {
    edition: "2014",
    title:
      "Standard Specifications for Construction and Maintenance of Highways, Streets, and Bridges",
    sourceUrl:
      "https://www.txdot.gov/business/resources/standard-specifications-construction.html",
    expectedMinItems: 3000,
    notes:
      "TxDOT does not publish a flat pay-item file; the canonical list is the AASHTOWare/Site Manager export. Pull a current `LCS_BIDLIST.csv` from a recent letting (https://www.txdot.gov/business/letting-bids.html) and rename to incoming/TXDOT.csv. Common headers: Item,Description,Unit.",
  },
  CALTRANS: {
    edition: "2022",
    title: "Standard Specifications",
    sourceUrl:
      "https://dot.ca.gov/programs/design/ccs-standard-plans-and-standard-specifications",
    expectedMinItems: 2400,
    notes:
      "Caltrans publishes the Standard Pay Item List and Coded Pay Items List as PDFs that 200-but-return-HTML to scripted clients. Download std-pay-item-<year>-a11y.pdf via a browser, run it through a PDF-to-CSV converter, and drop as incoming/CALTRANS.csv.",
  },
  FDOT: {
    edition: "2024",
    title: "Standard Specifications for Road and Bridge Construction",
    sourceUrl:
      "https://www.fdot.gov/programmanagement/Implemented/SpecBooks/",
    expectedMinItems: 3000,
    notes:
      "FDOT's pay items live in the Basis of Estimates Online tool (https://fdotwp1.fdot.gov/BasisOfEstimatesOnline/). Use its `Export to Excel` action, save as incoming/FDOT.csv. Default headers Pay Item Number,Description,Unit,Spec,Category.",
    csvColumnMap: {
      item: "Pay Item Number",
      description: "Description",
      unit: "Unit",
      section: "Spec",
      category: "Category",
    },
  },
  NYSDOT: {
    edition: "2024",
    title: "Standard Specifications",
    sourceUrl:
      "https://www.dot.ny.gov/main/business-center/engineering/specifications/pay-item-catalog",
    expectedMinItems: 2500,
    notes:
      "Pay Item Catalog (PIC) is a JS web app with no flat-file export. Use the `Pay Item List` interface, click `Export`, save as incoming/NYSDOT.csv. Headers: Pay Item #,Pay Item Description,Unit.",
    csvColumnMap: {
      item: "Pay Item #",
      description: "Pay Item Description",
      unit: "Unit",
    },
  },
  PENNDOT: {
    edition: "2020",
    title: "Publication 408 — Specifications",
    sourceUrl: "https://www.dot.state.pa.us/",
    expectedMinItems: 2700,
    notes:
      "PennDOT ECMS hosts the master item-number list behind login. From an authenticated ECMS session export `Item Number List.csv` and drop as incoming/PENNDOT.csv.",
  },
  ODOT: {
    edition: "2023",
    title: "Construction and Material Specifications (C&MS)",
    sourceUrl:
      "https://www.transportation.ohio.gov/working/engineering/specifications",
    expectedMinItems: 2700,
    notes:
      "Ohio DOT publishes the C&MS pay-item list inside its AASHTOWare Estimator reference data (https://www.transportation.ohio.gov/working/engineering/cadd-mapping/aashtoware/reference-data). Export `OHIO_PayItemList.csv` and drop as incoming/ODOT.csv.",
  },
  IDOT: {
    edition: "2022",
    title: "Standard Specifications for Road and Bridge Construction",
    sourceUrl:
      "https://idot.illinois.gov/doing-business/procurements/construction-services/transportation-bulletin/Specifications.html",
    expectedMinItems: 2400,
    notes:
      "IDOT's master pay-item list ships with the AASHTOWare BAMS/DSS reference data download. Pull the latest `IL_PayItemMaster.csv` and drop as incoming/IDOT.csv.",
  },
  GDOT: {
    edition: "2021",
    title: "Standard Specifications",
    sourceUrl:
      "http://www.dot.ga.gov/PartnerSmart/Business/Source2Pay/Pages/PayItems.aspx",
    expectedMinItems: 2400,
    notes:
      "GDOT publishes Source2Pay item exports in XLSX. Save the latest `GDOT_PayItems.xlsx`, convert to CSV, drop as incoming/GDOT.csv. Default headers: Pay Item Code,Description,Unit,Spec Section.",
    csvColumnMap: {
      item: "Pay Item Code",
      description: "Description",
      unit: "Unit",
      section: "Spec Section",
    },
  },
  VDOT: {
    edition: "2020",
    title: "Road and Bridge Specifications",
    sourceUrl:
      "https://www.virginiadot.org/business/const/spec-default.asp",
    expectedMinItems: 2400,
    notes:
      "VDOT's pay-item master ships inside the AASHTOWare BAMS reference set on the Construction Division SharePoint. Download the latest `VDOT_PayItem.xml` and drop as incoming/VDOT.xml; the importer's XML mode handles the <PayItem> blocks directly.",
  },
};

// --- Minimal CSV/XML parsers (mirror scripts/import-dot-pay-items.ts) ---
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

function parseXmlItems(text: string): PayItem[] {
  const out: PayItem[] = [];
  const itemRe = /<(item|payItem|PayItem)\b[^>]*>([\s\S]*?)<\/\1>/g;
  const tag = (block: string, name: string) => {
    const r = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
    return r.exec(block)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() ?? "";
  };
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(text)) !== null) {
    const block = m[2];
    const itemNumber =
      tag(block, "itemNumber") || tag(block, "Item") || tag(block, "PayItemNumber") || tag(block, "Code");
    const description =
      tag(block, "description") || tag(block, "Description");
    const unit = tag(block, "unit") || tag(block, "Unit");
    if (!itemNumber || !description || !unit) continue;
    out.push({
      itemNumber,
      description,
      unit: unit.toUpperCase(),
      specSection:
        tag(block, "section") || tag(block, "specSection") || tag(block, "SpecSection") || itemNumber.split("-")[0] || "",
      category:
        tag(block, "category") || tag(block, "Category") || "Standard",
    });
  }
  return out;
}

const INCOMING_DIR = join(process.cwd(), "incoming");

function pickHeader(row: Record<string, string>, names: (string | undefined)[]): string {
  for (const n of names) {
    if (n && row[n] !== undefined && row[n] !== "") return row[n];
  }
  // Case-insensitive fallback
  const lc = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    if (!n) continue;
    const v = lc[n.toLowerCase()];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function loadIncomingCatalog(code: string, drop: StagedDrop): AgencyCatalog {
  const csvPath = join(INCOMING_DIR, `${code}.csv`);
  const xmlPath = join(INCOMING_DIR, `${code}.xml`);
  let items: PayItem[] = [];
  let usedPath = "";
  if (existsSync(csvPath)) {
    usedPath = csvPath;
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    const map = drop.csvColumnMap ?? {};
    items = rows.map((r) => {
      const itemNumber = pickHeader(r, [map.item, "item", "Item", "ItemNumber", "Pay Item", "Pay Item #", "Pay Item Number", "Code"]).trim();
      const description = pickHeader(r, [map.description, "description", "Description", "Pay Item Description", "Item Description"]).trim();
      const unit = pickHeader(r, [map.unit, "unit", "Unit", "UOM", "Units"]).trim().toUpperCase();
      const section = pickHeader(r, [map.section, "section", "Section", "Spec", "Spec Section", "specSection"]).trim();
      const category = pickHeader(r, [map.category, "category", "Category", "Type"]).trim();
      return {
        itemNumber,
        description,
        unit,
        specSection: section || (itemNumber.match(/^(\d{2,3})/)?.[1] ?? ""),
        category: category || "Standard",
      };
    }).filter((it) => it.itemNumber && it.description && it.unit);
  } else if (existsSync(xmlPath)) {
    usedPath = xmlPath;
    items = parseXmlItems(readFileSync(xmlPath, "utf8"));
  } else {
    throw new Error(
      `No staged drop found for ${code}.\n` +
        `  Expected: ${csvPath} or ${xmlPath}\n` +
        `  Source:   ${drop.sourceUrl}\n` +
        `  Notes:    ${drop.notes ?? "(none)"}\n` +
        `  See incoming/README.md for the staging runbook.`,
    );
  }
  if (items.length < drop.expectedMinItems) {
    throw new Error(
      `${code} drop at ${usedPath} parsed only ${items.length} items; ` +
        `expected at least ${drop.expectedMinItems}. Investigate the source file or column map.`,
    );
  }
  return {
    specBook: { edition: drop.edition, title: drop.title },
    source: drop.sourceUrl,
    items,
  };
}

const AGENCY_FETCHERS: Record<string, () => Promise<AgencyCatalog>> = {
  FHWA: fetchFhwa,
  NCDOT: fetchNcdot,
  WSDOT: fetchWsdot,
  CDOT: fetchCdot,
  INDOT: fetchIndot,
  IADOT: fetchIadot,
  MAINEDOT: fetchMaineDot,
  MODOT: fetchModot,
};

// Register a generic incoming-drop fetcher for every staged agency. FHWA
// keeps its scraping fetcher above (still preferred when reachable); the
// staged-drop wrapper takes over only if a manual `incoming/FHWA.csv` is
// present.
for (const [code, drop] of Object.entries(STAGED_AGENCIES)) {
  if (code === "FHWA") {
    const direct = AGENCY_FETCHERS.FHWA;
    AGENCY_FETCHERS.FHWA = async () => {
      if (existsSync(join(INCOMING_DIR, "FHWA.csv")) || existsSync(join(INCOMING_DIR, "FHWA.xml"))) {
        return loadIncomingCatalog("FHWA", drop);
      }
      return direct();
    };
    continue;
  }
  AGENCY_FETCHERS[code] = async () => loadIncomingCatalog(code, drop);
}

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
