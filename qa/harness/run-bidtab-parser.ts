// Executes the product's Bid Tab parser (client/src/lib/bidTabParser.ts) against a workbook,
// reproducing parseFile()'s xlsx branch exactly (XLSX.read + sheet_to_json header:1 defval:"").
import fs from "node:fs";
import * as XLSX from "xlsx";
import { parseRows } from "../../client/src/lib/bidTabParser";
const buf = fs.readFileSync(process.argv[2]);
const wb = XLSX.read(buf, { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];
const parsed = parseRows(rows);
fs.writeFileSync(process.argv[3], JSON.stringify(parsed, null, 1));
console.log(JSON.stringify({ count: parsed.length, first: parsed.slice(0, 10), last: parsed.slice(-3) }));
