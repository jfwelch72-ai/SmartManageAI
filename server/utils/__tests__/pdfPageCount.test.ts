import { describe, it, expect, vi } from "vitest";
import { Readable } from "stream";
import { PDFDocument } from "pdf-lib";
import type { File as GcsFile } from "@google-cloud/storage";
import {
  PDF_BUFFERED_PARSE_MAX_BYTES,
  getPdfPageCountFromGcs,
} from "../pdfPageCount";

vi.mock("../logger", () => ({
  logError: vi.fn(),
}));

interface FakeGcsFile {
  download: ReturnType<typeof vi.fn<[], Promise<[Buffer]>>>;
  createReadStream: ReturnType<typeof vi.fn<[], NodeJS.ReadableStream>>;
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
  return {
    download: vi.fn(async () => [buffer] as [Buffer]),
    createReadStream: vi.fn(() => Readable.from([buffer])),
  };
}

function asGcsFile(file: FakeGcsFile): GcsFile {
  return file as unknown as GcsFile;
}

describe("getPdfPageCountFromGcs", () => {
  it("returns the correct page count for a small PDF via the buffered path", async () => {
    const pdf = await buildPdf(7);
    const fakeFile = makeFakeFile(pdf);

    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: pdf.length,
    });

    expect(count).toBe(7);
    expect(fakeFile.download).toHaveBeenCalledTimes(1);
    expect(fakeFile.createReadStream).not.toHaveBeenCalled();
  });

  it("returns the correct page count for a large PDF via the streaming path", async () => {
    const pdf = await buildPdf(120);
    const fakeFile = makeFakeFile(pdf);

    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: PDF_BUFFERED_PARSE_MAX_BYTES + 1,
    });

    expect(count).toBe(120);
    expect(fakeFile.createReadStream).toHaveBeenCalledTimes(1);
    expect(fakeFile.download).not.toHaveBeenCalled();
  }, 30_000);

  it("returns null when the file size is unknown", async () => {
    const fakeFile = makeFakeFile(Buffer.alloc(0));
    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: 0,
    });
    expect(count).toBeNull();
  });

  it("returns null when the file exceeds the hard cap", async () => {
    const fakeFile = makeFakeFile(Buffer.alloc(0));
    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: 16 * 1024 * 1024 * 1024,
    });
    expect(count).toBeNull();
  });

  it("returns null gracefully on malformed PDF bytes", async () => {
    const garbage = Buffer.from("not a pdf");
    const fakeFile = makeFakeFile(garbage);
    const count = await getPdfPageCountFromGcs(asGcsFile(fakeFile), {
      fileSize: garbage.length,
    });
    expect(count).toBeNull();
  });
});
