import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { File as GcsFile } from "@google-cloud/storage";
import {
  PDF_BUFFERED_PARSE_MAX_BYTES,
  getPdfPageCountFromGcs,
  openPdfFromGcs,
} from "../pdfPageCount";

vi.mock("../logger", () => ({
  logError: vi.fn(),
}));

interface FakeGcsFile {
  download: ReturnType<typeof vi.fn>;
  rangeCalls: Array<{ start: number; end: number; bytes: number }>;
  totalBytesRead: number;
}

async function buildPdf(numPages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    doc.addPage([612, 792]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function makeFakeFile(buffer: Buffer): FakeGcsFile {
  const fake: FakeGcsFile = {
    download: vi.fn(),
    rangeCalls: [],
    totalBytesRead: 0,
  };
  fake.download.mockImplementation(async (opts?: { start?: number; end?: number }) => {
    if (opts && typeof opts.start === "number" && typeof opts.end === "number") {
      const start = opts.start;
      const end = Math.min(opts.end, buffer.length - 1);
      const slice = buffer.subarray(start, end + 1);
      fake.rangeCalls.push({ start, end, bytes: slice.length });
      fake.totalBytesRead += slice.length;
      return [Buffer.from(slice)];
    }
    fake.totalBytesRead += buffer.length;
    return [buffer];
  });
  return fake;
}

function asGcsFile(file: FakeGcsFile): GcsFile {
  return file as unknown as GcsFile;
}

describe("getPdfPageCountFromGcs (range-only)", () => {
  it("returns the correct page count for a small PDF using only range reads", async () => {
    const pdf = await buildPdf(7);
    const fakeFile = makeFakeFile(pdf);

    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: pdf.length,
    });

    expect(count).toBe(7);
    // Every download call must be a range read — no full-file downloads.
    for (const call of fakeFile.download.mock.calls) {
      const opts = call[0];
      expect(opts).toBeDefined();
      expect(typeof opts!.start).toBe("number");
      expect(typeof opts!.end).toBe("number");
    }
  });

  it("opens a large PDF without buffering the full file", async () => {
    const pdf = await buildPdf(120);
    const fakeFile = makeFakeFile(pdf);

    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: pdf.length,
    });

    expect(count).toBe(120);
    expect(fakeFile.totalBytesRead).toBeLessThanOrEqual(pdf.length);
  }, 30_000);

  it("returns null when the file size is unknown", async () => {
    const fakeFile = makeFakeFile(Buffer.alloc(0));
    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: 0,
    });
    expect(count).toBeNull();
    expect(fakeFile.download).not.toHaveBeenCalled();
  });

  it("does not refuse files larger than the legacy 8 GB cap (range transport scales)", async () => {
    // We don't actually allocate 16 GB; we just prove the function no
    // longer short-circuits. The download mock will be hit but pdfjs
    // will fail to parse — what we're asserting is "no early return on
    // size alone".
    const fakeFile = makeFakeFile(Buffer.alloc(0));
    await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: 16 * 1024 * 1024 * 1024,
    });
    expect(fakeFile.download).toHaveBeenCalled();
  });

  it("returns null gracefully on malformed PDF bytes", async () => {
    const garbage = Buffer.from("not a pdf");
    const fakeFile = makeFakeFile(garbage);
    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: garbage.length,
    });
    expect(count).toBeNull();
  });

  it("preserves PDF_BUFFERED_PARSE_MAX_BYTES export for inline-vision callers", () => {
    expect(PDF_BUFFERED_PARSE_MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe("openPdfFromGcs (range-only)", () => {
  it("opens a small PDF and exposes pages via range transport", async () => {
    const pdf = await buildPdf(3);
    const fakeFile = makeFakeFile(pdf);

    const opened = await openPdfFromGcs(asGcsFile(fakeFile), {
      fileSize: pdf.length,
    });

    expect(opened).not.toBeNull();
    expect(opened!.numPages).toBe(3);
    const page = await opened!.pdfDoc.getPage(1);
    expect(page).toBeTruthy();
    await opened!.close();
  });

  it("opens a large PDF and only fetches the bytes pdfjs asks for", async () => {
    const pdf = await buildPdf(75);
    const fakeFile = makeFakeFile(pdf);

    const opened = await openPdfFromGcs(asGcsFile(fakeFile), {
      fileSize: pdf.length,
    });

    expect(opened).not.toBeNull();
    expect(opened!.numPages).toBe(75);
    const page = await opened!.pdfDoc.getPage(2);
    expect(page).toBeTruthy();
    await opened!.close();
    expect(fakeFile.totalBytesRead).toBeLessThanOrEqual(pdf.length);
  }, 30_000);

  it("returns null when the file size is unknown", async () => {
    const fakeFile = makeFakeFile(Buffer.alloc(0));
    const opened = await openPdfFromGcs(asGcsFile(fakeFile), {
      fileSize: 0,
    });
    expect(opened).toBeNull();
  });

  it("returns null gracefully on malformed PDF bytes", async () => {
    const garbage = Buffer.from("not a pdf");
    const fakeFile = makeFakeFile(garbage);
    const opened = await openPdfFromGcs(asGcsFile(fakeFile), {
      fileSize: garbage.length,
    });
    expect(opened).toBeNull();
  });
});
