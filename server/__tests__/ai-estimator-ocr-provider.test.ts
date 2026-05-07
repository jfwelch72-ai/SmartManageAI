/**
 * Task #2577 Phase B Step 3 — OCR provider abstraction.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerOcrProvider,
  clearOcrProvider,
  getOcrProvider,
  type OcrProvider,
} from "../ai/ocrProvider";

describe("OCR provider registry", () => {
  afterEach(() => clearOcrProvider());

  it("returns null when no provider is registered", () => {
    clearOcrProvider();
    expect(getOcrProvider()).toBeNull();
  });

  it("returns the registered provider", async () => {
    const fake: OcrProvider = {
      id: "FAKE",
      label: "Fake OCR",
      async recognize() {
        return "hello world";
      },
    };
    registerOcrProvider(fake);
    const got = getOcrProvider();
    expect(got).not.toBeNull();
    expect(got!.id).toBe("FAKE");
    const out = await got!.recognize({ buffer: Buffer.from(""), mimeType: "image/png" });
    expect(out).toBe("hello world");
  });

  it("clears registration", () => {
    registerOcrProvider({ id: "X", label: "X", async recognize() { return null; } });
    clearOcrProvider();
    expect(getOcrProvider()).toBeNull();
  });
});
