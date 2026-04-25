// @vitest-environment jsdom
/**
 * Task #2004 — Component tests for the upload progress overlay.
 *
 * The overlay (MB transferred / total, throughput, ETA, retry banner,
 * pause / resume / cancel controls) is wired through Uppy events.
 * These tests mount `<ObjectUploader>` with a mocked Uppy instance and
 * dispatch the production event names — `upload-progress`,
 * `upload-retry`, `upload-pause`, `pause-all`, `resume-all`,
 * `cancel-all` — to assert the UI updates as expected.
 *
 * Key behaviors locked in:
 *   - Bytes / percent / filename text reflects per-file progress.
 *   - `upload-retry` flips the entry to "retrying" and surfaces the
 *     "Retrying part…" banner WITHOUT firing a destructive toast
 *     (transient retries are not user-facing failures).
 *   - `upload-pause` and the bulk `pause-all` / `resume-all` events
 *     flip the visible Pause/Resume button.
 *   - The Pause / Resume / Cancel buttons call the matching Uppy
 *     methods and Cancel collapses the overlay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";

type Listener = (...args: unknown[]) => unknown;

interface AwsS3PluginOptions {
  getUploadParameters?: (file: {
    id?: string;
    name?: string;
    type?: string;
    size?: number;
  }) => Promise<{
    method: "PUT";
    url: string;
    intentId?: string;
    objectKey?: string;
  }>;
}

interface MockUppyInstance {
  handlers: Map<string, Listener[]>;
  files: Array<{ id: string; name: string; type: string; size: number }>;
  awsS3Options: AwsS3PluginOptions | null;
  pauseAll: ReturnType<typeof vi.fn>;
  resumeAll: ReturnType<typeof vi.fn>;
  cancelAll: ReturnType<typeof vi.fn>;
  use: (plugin: unknown, options?: AwsS3PluginOptions) => MockUppyInstance;
  on: (event: string, handler: Listener) => MockUppyInstance;
  off: (event: string, handler: Listener) => MockUppyInstance;
  getFiles: () => Array<{ id: string; name: string; type: string; size: number }>;
  addFile: (file: { name: string; type: string; size: number; data: unknown }) => string;
  emit: (event: string, ...args: unknown[]) => void;
  emitAsync: (event: string, ...args: unknown[]) => Promise<void>;
  simulateGetUploadParameters: (file: {
    id?: string;
    name?: string;
    type?: string;
    size?: number;
  }) => Promise<unknown>;
}

const { mockToast, mockUppyInstances, MockUppyClass } = vi.hoisted(() => {
  const instances: MockUppyInstance[] = [];
  // Defined inside hoisted block so it's available when vi.mock factories run.
  class MockUppy implements MockUppyInstance {
    handlers = new Map<string, Listener[]>();
    files: Array<{ id: string; name: string; type: string; size: number }> = [];
    // Captured by `use()` so tests can drive the production-side
    // `getUploadParameters` callback (which is what populates the internal
    // file.id → intentId map the post-upload `complete` handler depends on).
    awsS3Options: AwsS3PluginOptions | null = null;
    pauseAll = vi.fn(() => this.emit("pause-all"));
    resumeAll = vi.fn(() => this.emit("resume-all"));
    cancelAll = vi.fn(() => this.emit("cancel-all"));

    constructor() {
      instances.push(this);
    }

    use(_plugin: unknown, options?: AwsS3PluginOptions): this {
      // The component only registers one plugin (AwsS3) with options that
      // include `getUploadParameters`. Capture it so tests can simulate the
      // pre-upload fan-out that seeds the intentId map.
      if (options && typeof options.getUploadParameters === "function") {
        this.awsS3Options = options;
      }
      return this;
    }

    on(event: string, handler: Listener): this {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }

    off(event: string, handler: Listener): this {
      const list = this.handlers.get(event);
      if (!list) return this;
      this.handlers.set(
        event,
        list.filter((h) => h !== handler),
      );
      return this;
    }

    getFiles() {
      return this.files;
    }

    addFile(file: { name: string; type: string; size: number; data: unknown }): string {
      const id = `mock-file-${this.files.length}`;
      this.files.push({ id, name: file.name, type: file.type, size: file.size });
      return id;
    }

    emit(event: string, ...args: unknown[]): void {
      const list = this.handlers.get(event) ?? [];
      for (const h of [...list]) h(...args);
    }

    async emitAsync(event: string, ...args: unknown[]): Promise<void> {
      // Used for the post-upload `complete` event whose listener is async.
      // Awaits each handler so tests can observe the result of the
      // confirm-fan-out + onComplete invocation.
      const list = this.handlers.get(event) ?? [];
      for (const h of [...list]) {
        await h(...args);
      }
    }

    async simulateGetUploadParameters(file: {
      id?: string;
      name?: string;
      type?: string;
      size?: number;
    }): Promise<unknown> {
      // Drive the AwsS3 plugin's `getUploadParameters` callback as Uppy
      // would just before each PUT. Production wires this up in the
      // ObjectUploader constructor; running it populates the internal
      // file.id → intentId map that the `complete` handler needs.
      if (!this.awsS3Options?.getUploadParameters) {
        throw new Error(
          "MockUppy: AwsS3 plugin options not captured; ensure ObjectUploader was rendered first.",
        );
      }
      return this.awsS3Options.getUploadParameters(file);
    }
  }
  return {
    mockToast: vi.fn(),
    mockUppyInstances: instances,
    MockUppyClass: MockUppy,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/uploadLimits", () => ({
  MAX_STORAGE_FILE_SIZE: 50 * 1024 * 1024 * 1024,
}));

vi.mock("@uppy/aws-s3", () => ({
  default: class FakeAwsS3 {
    static type = "uploader";
  },
}));

vi.mock("@uppy/react/dashboard-modal", () => ({
  default: () => null,
}));

vi.mock("@uppy/core", () => ({
  default: MockUppyClass,
}));

import { ObjectUploader, LARGE_UPLOAD_THRESHOLD } from "@/components/ObjectUploader";

function getLatestUppy(): MockUppyInstance {
  const instance = mockUppyInstances[mockUppyInstances.length - 1];
  if (!instance) throw new Error("No mock Uppy instance was constructed");
  return instance;
}

const HUGE_FILE = {
  id: "huge-1",
  name: "lidar-scan-northeast.zip",
  type: "application/zip",
  size: 2 * LARGE_UPLOAD_THRESHOLD, // 512 MB
};

/**
 * Flush the component's throttled progress dispatch. The component
 * coalesces `scheduleProgressEmit` calls within a 250ms window via a
 * setTimeout, so tests must advance timers (and trigger React re-render
 * via act) after dispatching events.
 */
function flushThrottle() {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

function emitProgress(
  uppy: MockUppyInstance,
  file: typeof HUGE_FILE,
  bytesUploaded: number,
) {
  act(() => {
    uppy.emit("upload");
    uppy.emit("upload-progress", file, {
      bytesUploaded,
      bytesTotal: file.size,
    });
  });
  flushThrottle();
}

beforeEach(() => {
  mockUppyInstances.length = 0;
  mockToast.mockReset();
  cleanup();
  // Pin the clock so the throttled progress dispatch is deterministic
  // and so we can advance time precisely with vi.advanceTimersByTime().
  vi.useFakeTimers({ now: 1_700_000_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ObjectUploader — upload-progress overlay", () => {
  it("renders the overlay with file name, bytes, percent, and ETA when a large upload is in flight", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    // 256 MB out of 512 MB transferred → 50%.
    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);

    expect(screen.getByTestId("uploader-progress")).toBeTruthy();
    expect(screen.getByTestId("text-upload-filename").textContent).toContain(
      HUGE_FILE.name,
    );
    expect(screen.getByTestId("text-upload-bytes").textContent).toBe(
      "256.0 MB / 512.0 MB",
    );
    expect(screen.getByTestId("text-upload-percent").textContent).toBe("50.0%");
    // First sample → throughput unknown (em-dash sentinel).
    expect(screen.getByTestId("text-upload-rate").textContent).toBe("—");
    expect(screen.getByTestId("text-upload-eta").textContent).toContain("ETA");
    // Progress bar reflects 50%.
    const bar = screen.getByTestId("bar-upload-progress") as HTMLElement;
    expect(bar.style.width).toBe("50%");
  });

  it("does NOT render the overlay for sub-threshold uploads", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    const smallFile = { ...HUGE_FILE, id: "small-1", size: 1024 * 1024 }; // 1 MB
    emitProgress(uppy, smallFile, 512 * 1024);

    expect(screen.queryByTestId("uploader-progress")).toBeNull();
  });
});

describe("ObjectUploader — upload-retry behavior", () => {
  it("flips the entry to 'retrying' and shows the retry banner when upload-retry fires", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    act(() => {
      uppy.emit("upload-retry", HUGE_FILE);
    });
    flushThrottle();

    expect(screen.getByTestId("text-upload-retrying").textContent).toMatch(
      /retrying part/i,
    );
  });

  it("does NOT fire a destructive toast when upload-retry is emitted (transient recovery)", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    act(() => {
      uppy.emit("upload-retry", HUGE_FILE);
      uppy.emit("upload-retry", HUGE_FILE);
      uppy.emit("upload-retry", HUGE_FILE);
    });
    flushThrottle();

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("after the retry succeeds (next upload-progress), shows '<n> retries recovered'", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    act(() => {
      uppy.emit("upload-retry", HUGE_FILE);
      uppy.emit("upload-retry", HUGE_FILE);
    });
    flushThrottle();
    // Subsequent progress flips status back to "uploading".
    act(() => {
      uppy.emit("upload-progress", HUGE_FILE, {
        bytesUploaded: HUGE_FILE.size * 0.6,
        bytesTotal: HUGE_FILE.size,
      });
    });
    flushThrottle();

    expect(screen.queryByTestId("text-upload-retrying")).toBeNull();
    expect(screen.getByTestId("text-upload-retry-count").textContent).toBe(
      "2 retries recovered",
    );
  });

  it("singular wording when exactly one retry was recovered", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    act(() => {
      uppy.emit("upload-retry", HUGE_FILE);
    });
    flushThrottle();
    act(() => {
      uppy.emit("upload-progress", HUGE_FILE, {
        bytesUploaded: HUGE_FILE.size * 0.6,
        bytesTotal: HUGE_FILE.size,
      });
    });
    flushThrottle();

    expect(screen.getByTestId("text-upload-retry-count").textContent).toBe(
      "1 retry recovered",
    );
  });
});

describe("ObjectUploader — pause / resume / cancel behavior", () => {
  it("upload-pause swaps the Pause button for Resume", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    expect(screen.getByTestId("button-upload-pause")).toBeTruthy();

    act(() => {
      uppy.emit("upload-pause", HUGE_FILE, true);
    });
    flushThrottle();

    expect(screen.queryByTestId("button-upload-pause")).toBeNull();
    expect(screen.getByTestId("button-upload-resume")).toBeTruthy();
    // ETA collapses to "paused" while the upload is held.
    expect(screen.getByTestId("text-upload-eta").textContent).toContain("ETA paused");
  });

  it("`pause-all` flips every uploading file to paused and shows Resume", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    const fileA = { ...HUGE_FILE, id: "a", name: "a.zip" };
    const fileB = { ...HUGE_FILE, id: "b", name: "b.zip" };
    emitProgress(uppy, fileA, LARGE_UPLOAD_THRESHOLD);
    act(() => {
      uppy.emit("upload-progress", fileB, {
        bytesUploaded: LARGE_UPLOAD_THRESHOLD,
        bytesTotal: fileB.size,
      });
    });
    flushThrottle();

    act(() => {
      uppy.emit("pause-all");
    });
    flushThrottle();

    expect(screen.getByTestId("button-upload-resume")).toBeTruthy();
    expect(screen.queryByTestId("button-upload-pause")).toBeNull();
  });

  it("`resume-all` flips paused files back to uploading and shows Pause", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    act(() => {
      uppy.emit("pause-all");
    });
    flushThrottle();
    expect(screen.getByTestId("button-upload-resume")).toBeTruthy();

    act(() => {
      uppy.emit("resume-all");
    });
    flushThrottle();

    expect(screen.getByTestId("button-upload-pause")).toBeTruthy();
    expect(screen.queryByTestId("button-upload-resume")).toBeNull();
  });

  it("clicking Pause invokes uppy.pauseAll(); clicking Resume invokes uppy.resumeAll()", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);

    fireEvent.click(screen.getByTestId("button-upload-pause"));
    flushThrottle();
    expect(uppy.pauseAll).toHaveBeenCalledTimes(1);
    // pauseAll() emits pause-all in our mock, which flips the UI to "Resume".
    expect(screen.getByTestId("button-upload-resume")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-upload-resume"));
    flushThrottle();
    expect(uppy.resumeAll).toHaveBeenCalledTimes(1);
  });

  it("`cancel-all` clears the overlay and Cancel click invokes uppy.cancelAll()", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    emitProgress(uppy, HUGE_FILE, LARGE_UPLOAD_THRESHOLD);
    expect(screen.getByTestId("uploader-progress")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-upload-cancel"));
    flushThrottle();

    expect(uppy.cancelAll).toHaveBeenCalledTimes(1);
    // cancel-all listener calls resetProgress() → overlay disappears.
    expect(screen.queryByTestId("uploader-progress")).toBeNull();
  });
});

describe("ObjectUploader — multi-file aggregate label", () => {
  it("shows '<N> files' instead of a filename when multiple files are in flight", () => {
    render(
      <ObjectUploader testId="uploader" maxNumberOfFiles={5}>
        Upload
      </ObjectUploader>,
    );
    const uppy = getLatestUppy();

    const fileA = { ...HUGE_FILE, id: "a", name: "a.zip" };
    const fileB = { ...HUGE_FILE, id: "b", name: "b.zip" };
    const fileC = { ...HUGE_FILE, id: "c", name: "c.zip" };
    act(() => {
      uppy.emit("upload");
      uppy.emit("upload-progress", fileA, { bytesUploaded: 100, bytesTotal: fileA.size });
      uppy.emit("upload-progress", fileB, { bytesUploaded: 100, bytesTotal: fileB.size });
      uppy.emit("upload-progress", fileC, { bytesUploaded: 100, bytesTotal: fileC.size });
    });
    flushThrottle();

    expect(screen.getByTestId("text-upload-filename").textContent).toContain("3 files");
  });
});

/**
 * Task #2014 — Post-upload "complete" / confirm fan-out coverage.
 *
 * After Uppy finishes streaming bytes to S3 it emits `upload-success` per
 * file and a single `complete` event with `{ successful, failed }`. The
 * `complete` handler in ObjectUploader.tsx then:
 *
 *   1. Pulls the recorded intentId for each successful file (set earlier by
 *      the AwsS3 `getUploadParameters` callback) and POSTs each one to
 *      `/api/objects/confirm` to materialize the persistent object path.
 *   2. Spreads the returned objectPaths back onto the successful files and
 *      forwards the enriched result to `onComplete` so the parent form
 *      knows which canonical path to attach.
 *   3. If any confirm call rejects, surfaces a destructive
 *      "Upload processing error" toast but STILL invokes onComplete with
 *      the original file list so the user does not silently lose their
 *      uploads.
 *   4. If no successful files were produced (all failed), surfaces the
 *      destructive "Upload failed" toast and explicitly does NOT call
 *      onComplete.
 *
 * These tests lock in the contract for callers (e.g. document upload
 * forms) that depend on receiving exactly one onComplete with correctly
 * mapped objectPaths.
 */
describe("ObjectUploader — post-upload confirm fan-out", () => {
  let apiRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const queryClient = await import("@/lib/queryClient");
    apiRequestMock = queryClient.apiRequest as unknown as ReturnType<typeof vi.fn>;
    apiRequestMock.mockReset();
  });

  it("hits /api/objects/confirm exactly once per successful file with the matching intentId and forwards enriched objectPaths to onComplete", async () => {
    apiRequestMock.mockImplementation(
      async (_method: string, url: string, body: unknown) => {
        if (url === "/api/objects/confirm") {
          const intentId = (body as { intentId: string }).intentId;
          return {
            json: async () => ({
              objectPath: `/objects/uploads/${intentId}`,
              intentId,
            }),
          };
        }
        throw new Error(`unexpected apiRequest URL in test: ${url}`);
      },
    );

    const onComplete = vi.fn();
    const onGetUploadParameters = vi.fn(async (file: { name: string }) => ({
      method: "PUT" as const,
      url: `https://example.invalid/upload/${file.name}`,
      intentId: `intent-${file.name}`,
      objectKey: `key-${file.name}`,
    }));

    render(
      <ObjectUploader
        testId="uploader"
        maxNumberOfFiles={3}
        onComplete={onComplete}
        onGetUploadParameters={onGetUploadParameters}
      >
        Upload
      </ObjectUploader>,
    );
    const uppy = getLatestUppy();

    const fileA = { ...HUGE_FILE, id: "a", name: "a.zip" };
    const fileB = { ...HUGE_FILE, id: "b", name: "b.zip" };

    // Drive the same callback Uppy invokes before each PUT — this is what
    // populates the internal intentMap the `complete` handler reads from.
    await act(async () => {
      await uppy.simulateGetUploadParameters(fileA);
      await uppy.simulateGetUploadParameters(fileB);
    });

    await act(async () => {
      uppy.emit("upload-success", fileA);
      uppy.emit("upload-success", fileB);
      await uppy.emitAsync("complete", {
        successful: [fileA, fileB],
        failed: [],
      });
    });

    const confirmCalls = apiRequestMock.mock.calls.filter(
      ([, url]) => url === "/api/objects/confirm",
    );
    expect(confirmCalls).toHaveLength(2);
    expect(confirmCalls.map(([method]) => method)).toEqual(["POST", "POST"]);
    expect(confirmCalls.map(([, , body]) => body)).toEqual([
      { intentId: "intent-a.zip" },
      { intentId: "intent-b.zip" },
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const enriched = onComplete.mock.calls[0][0] as {
      successful: Array<{ id: string; uploadURL: string }>;
      failed: unknown[];
    };
    expect(enriched.successful).toHaveLength(2);
    // objectPaths must be forwarded onto the matching files in order.
    expect(enriched.successful[0].id).toBe("a");
    expect(enriched.successful[0].uploadURL).toBe(
      "/objects/uploads/intent-a.zip",
    );
    expect(enriched.successful[1].id).toBe("b");
    expect(enriched.successful[1].uploadURL).toBe(
      "/objects/uploads/intent-b.zip",
    );
    // No toast on the happy path.
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("surfaces the destructive 'Upload processing error' toast when confirm rejects, AND still invokes onComplete with the original successful files (no silent data loss)", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url === "/api/objects/confirm") {
        throw new Error("boom: confirm endpoint unavailable");
      }
      throw new Error(`unexpected apiRequest URL in test: ${url}`);
    });

    const onComplete = vi.fn();
    const onGetUploadParameters = vi.fn(async () => ({
      method: "PUT" as const,
      url: "https://example.invalid/upload",
      intentId: "intent-doomed",
      objectKey: "key-doomed",
    }));

    // The catch branch logs the underlying error; suppress it so the
    // test output stays clean and intentional.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ObjectUploader
        testId="uploader"
        onComplete={onComplete}
        onGetUploadParameters={onGetUploadParameters}
      >
        Upload
      </ObjectUploader>,
    );
    const uppy = getLatestUppy();

    // Use a file that already carries a pre-existing uploadURL so we can
    // verify the fallback path (`f.uploadURL ?? ""`) preserves it.
    const file = {
      ...HUGE_FILE,
      id: "doomed",
      name: "doomed.zip",
      uploadURL: "https://s3.example.invalid/original-key",
    };

    await act(async () => {
      await uppy.simulateGetUploadParameters(file);
    });

    await act(async () => {
      uppy.emit("upload-success", file);
      await uppy.emitAsync("complete", {
        successful: [file],
        failed: [],
      });
    });

    // Exactly one confirm attempt was made and it rejected.
    expect(
      apiRequestMock.mock.calls.filter(([, url]) => url === "/api/objects/confirm"),
    ).toHaveLength(1);

    // Destructive toast surfaces the processing error.
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Upload processing error",
      description: "Files uploaded but could not be confirmed. Please try again.",
      variant: "destructive",
    });

    // Critical regression guard: callers (e.g. document attachment forms)
    // still receive their successful file so the user does not silently
    // lose freshly-uploaded data.
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as {
      successful: Array<{ id: string; uploadURL: string }>;
      failed: unknown[];
    };
    expect(result.successful).toHaveLength(1);
    expect(result.successful[0].id).toBe("doomed");
    // Falls back to the original uploadURL on the file.
    expect(result.successful[0].uploadURL).toBe(
      "https://s3.example.invalid/original-key",
    );
    expect(result.failed).toEqual([]);

    errSpy.mockRestore();
  });

  it("surfaces the destructive 'Upload failed' toast and does NOT invoke onComplete (or hit confirm) when only failed files are present", async () => {
    const onComplete = vi.fn();

    render(
      <ObjectUploader testId="uploader" onComplete={onComplete}>
        Upload
      </ObjectUploader>,
    );
    const uppy = getLatestUppy();

    const failedA = { ...HUGE_FILE, id: "f1", name: "f1.zip" };
    const failedB = { ...HUGE_FILE, id: "f2", name: "f2.zip" };

    await act(async () => {
      await uppy.emitAsync("complete", {
        successful: [],
        failed: [failedA, failedB],
      });
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Upload failed",
      description: "2 file(s) could not be uploaded. Please try again.",
      variant: "destructive",
    });

    // No onComplete fan-out and no confirm requests when there are no
    // successful files to attach.
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      apiRequestMock.mock.calls.filter(([, url]) => url === "/api/objects/confirm"),
    ).toHaveLength(0);
  });
});
