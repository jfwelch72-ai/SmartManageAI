// prompt-injection-guard: spreadsheet text extractor — this module downloads and parses
// spreadsheet bytes into plain text. It makes no LLM calls. All extracted text MUST be
// passed through detectPromptInjection / quarantineDocumentBlocks at the call site
// before being included in any LLM prompt (enforced in takeoffDraft.ts and ingestion.ts).

import * as XLSX from "xlsx";
import { objectStorageClient, ObjectStorageService } from "../../objectStorage";
import { logWarn } from "../../utils/logger";

export const SPREADSHEET_MAX_CHARS = 20_000;
const SPREADSHEET_MAX_ROWS = 500;

export interface ExtractedSpreadsheet {
  text: string;
  sheetCount: number;
  rowCount: number;
  truncated: boolean;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("/objects/")) {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(url);
    const [buf] = await file.download();
    return buf;
  }
  const m = url.match(/storage\.googleapis\.com\/([^/?]+)\/([^?]+)/);
  if (!m) throw new Error(`Unsupported URL for spreadsheet download: ${url}`);
  const bucket = objectStorageClient.bucket(m[1]);
  const file = bucket.file(decodeURIComponent(m[2]));
  const [buf] = await file.download();
  return buf;
}

function parseBuffer(buffer: Buffer, isCsv: boolean): ExtractedSpreadsheet {
  let wb: XLSX.WorkBook;
  if (isCsv) {
    const csvText = buffer.toString("utf-8");
    wb = XLSX.read(csvText, { type: "string" });
  } else {
    wb = XLSX.read(buffer, { type: "buffer" });
  }

  const parts: string[] = [];
  let totalRows = 0;
  let truncated = false;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    if (rows.length === 0) continue;
    parts.push(`[Sheet: ${sheetName}]`);
    for (const row of rows) {
      if (totalRows >= SPREADSHEET_MAX_ROWS) {
        truncated = true;
        break;
      }
      const cells = (row as unknown[]).map((c) =>
        String(c ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " "),
      );
      parts.push(cells.join("\t"));
      totalRows++;
    }
    if (truncated) break;
  }

  let text = parts.join("\n");
  if (text.length > SPREADSHEET_MAX_CHARS) {
    text = `${text.slice(0, SPREADSHEET_MAX_CHARS)}\n…[truncated]`;
    truncated = true;
  }

  return { text, sheetCount: wb.SheetNames.length, rowCount: totalRows, truncated };
}

/**
 * Parse an already-downloaded buffer as a spreadsheet.
 * Useful in the ingestion pipeline where the file is already in memory.
 */
export function extractSpreadsheetFromBuffer(
  buffer: Buffer,
  fileName: string,
): ExtractedSpreadsheet | null {
  try {
    const ext = (fileName.split(".").pop() ?? "").toLowerCase();
    const isCsv = ext === "csv";
    return parseBuffer(buffer, isCsv);
  } catch (err) {
    logWarn("[extractSpreadsheet] buffer parse failed", {
      fileName,
      error: String(err),
    });
    return null;
  }
}

/**
 * Download a spreadsheet from GCS and convert to a plain-text table suitable
 * for inclusion in an LLM prompt. Supports .xlsx, .xls, and .csv.
 * Truncated at SPREADSHEET_MAX_CHARS to avoid token-limit failures.
 */
export async function extractSpreadsheetFromUrl(
  url: string,
  fileName: string,
): Promise<ExtractedSpreadsheet | null> {
  let buffer: Buffer;
  try {
    buffer = await downloadBuffer(url);
  } catch (err) {
    logWarn("[extractSpreadsheet] download failed", { url, error: String(err) });
    return null;
  }
  return extractSpreadsheetFromBuffer(buffer, fileName);
}
