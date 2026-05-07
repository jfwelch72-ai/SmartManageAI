import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  scanConfirmedUpload,
  registerUploadAvScanner,
  __testHooks,
} from "../uploadAvScanner";

describe("uploadAvScanner", () => {
  const originalMode = process.env.UPLOAD_AV_SCAN_MODE;

  beforeEach(() => {
    registerUploadAvScanner(null);
  });

  afterEach(() => {
    registerUploadAvScanner(null);
    if (originalMode === undefined) delete process.env.UPLOAD_AV_SCAN_MODE;
    else process.env.UPLOAD_AV_SCAN_MODE = originalMode;
  });

  it("skips when mode=disabled", async () => {
    process.env.UPLOAD_AV_SCAN_MODE = "disabled";
    const r = await scanConfirmedUpload({ objectKey: "/bucket/x", organizationId: null });
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("mode_disabled");
  });

  it("blocks when registered scanner reports infected", async () => {
    process.env.UPLOAD_AV_SCAN_MODE = "permissive";
    registerUploadAvScanner(async () => ({ clean: false, reason: "test_virus", scannerId: "fake" }));
    const r = await scanConfirmedUpload({ objectKey: "/bucket/uploads/x", organizationId: "org" });
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("test_virus");
  });

  it("passes when registered scanner reports clean", async () => {
    process.env.UPLOAD_AV_SCAN_MODE = "permissive";
    registerUploadAvScanner(async () => ({ clean: true, scannerId: "fake" }));
    const r = await scanConfirmedUpload({ objectKey: "/bucket/uploads/x", organizationId: "org" });
    expect(r.status).toBe("clean");
  });

  it("scanner error fails-closed in enforce mode", async () => {
    process.env.UPLOAD_AV_SCAN_MODE = "enforce";
    registerUploadAvScanner(async () => {
      throw new Error("boom");
    });
    const r = await scanConfirmedUpload({ objectKey: "/bucket/uploads/x", organizationId: "org" });
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("scanner_error");
  });

  it("scanner error fails-open in permissive mode", async () => {
    process.env.UPLOAD_AV_SCAN_MODE = "permissive";
    registerUploadAvScanner(async () => {
      throw new Error("boom");
    });
    const r = await scanConfirmedUpload({ objectKey: "/bucket/uploads/x", organizationId: "org" });
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("scanner_error_permissive");
  });

  it("EICAR signature constant is the canonical 68-byte test string", () => {
    expect(__testHooks.EICAR_SIGNATURE.length).toBe(68);
    expect(__testHooks.EICAR_SIGNATURE.startsWith("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR")).toBe(true);
  });
});
