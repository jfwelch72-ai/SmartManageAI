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

interface SignPartArgs {
  uploadId: string;
  partNumber: number;
  body?: { size: number };
  key?: string;
  signal?: AbortSignal;
}

interface AwsS3PluginOptions {
  shouldUseMultipart: (file: { size?: number }) => boolean;
  limit: number;
  retryDelays: number[];
  getChunkSize: (file: { size?: number }) => number;
  getUploadParameters: (file: {
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
  createMultipartUpload: (file: {
    type?: string;
    size?: number;
  }) => Promise<{ uploadId: string; key: string }>;
  listParts: (
    file: unknown,
    args: { uploadId: string; key: string },
  ) => Promise<Array<{ PartNumber: number; ETag: string; Size: number }>>;
  signPart: (
    file: unknown,
    args: SignPartArgs,
  ) => Promise<{ url: string; headers?: Record<string, string> }>;
  completeMultipartUpload: (
    file: unknown,
    args: { uploadId: string; key: string; parts: unknown[] },
  ) => Promise<{ location: string }>;
  abortMultipartUpload: (
    file: unknown,
    args: { uploadId: string; key: string },
  ) => Promise<void>;
}

interface MockUppyInstance {
  handlers: Map<string, Listener[]>;
  files: Array<{ id: string; name: string; type: string; size: number }>;
  awsS3Options: AwsS3PluginOptions | null;
  pauseAll: ReturnType<typeof vi.fn>;
  resumeAll: ReturnType<typeof vi.fn>;
  cancelAll: ReturnType<typeof vi.fn>;
  use: (plugin?: unknown, opts?: AwsS3PluginOptions) => MockUppyInstance;
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
    // Captured by `use()` so tests can both:
    //   • drive the production-side `getUploadParameters` callback (which
    //     populates the internal file.id → intentId map the post-upload
    //     `complete` handler depends on); and
    //   • directly invoke the multipart sign/list/abort/complete callbacks
    //     and assert their `apiRequest(method, url, body)` triples.
    awsS3Options: AwsS3PluginOptions | null = null;
    pauseAll = vi.fn(() => this.emit("pause-all"));
    resumeAll = vi.fn(() => this.emit("resume-all"));
    cancelAll = vi.fn(() => this.emit("cancel-all"));

    constructor() {
      instances.push(this);
    }

    use(_plugin?: unknown, opts?: AwsS3PluginOptions): this {
      // The component only registers one plugin (AwsS3). Capture its
      // options so tests can both drive `getUploadParameters` (Task #2014)
      // and invoke the multipart sign/list/abort/complete callbacks
      // (Task #2015) directly. We gate on `getUploadParameters` because
      // it's the canonical signal that this is the AwsS3 options object
      // (and not some other future plugin's config).
      if (opts && typeof opts.getUploadParameters === "function") {
        this.awsS3Options = opts;
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
import { apiRequest } from "@/lib/queryClient";

const mockedApiRequest = vi.mocked(apiRequest);

function jsonResponse(body: unknown): Response {
  // Minimal Response stand-in; the production callbacks only call `.json()`.
  return {
    json: async () => body,
  } as unknown as Response;
}

function getAwsS3Options(uppy: MockUppyInstance): AwsS3PluginOptions {
  if (!uppy.awsS3Options) {
    throw new Error("AwsS3 plugin options were not captured by the mock Uppy");
  }
  return uppy.awsS3Options;
}

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
  mockedApiRequest.mockReset();
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

  /**
   * Task #2029 — Default upload-parameter flow (no `onGetUploadParameters`
   * override). When callers don't pass their own param resolver,
   * ObjectUploader falls back to `getDefaultUploadParameters`, which:
   *
   *   1. POSTs `/api/objects/upload` with `{ contentType, fileSize, fileType }`
   *      where `fileType` defaults to `"DOCUMENT"`.
   *   2. Reads back `{ uploadURL, intentId, objectKey }` and returns them
   *      to Uppy as PUT params.
   *   3. Records the returned `intentId` on the internal file.id → intentId
   *      map so the post-upload `complete` handler can fan-out confirms.
   *
   * Every form in the app that doesn't supply its own resolver depends on
   * this branch, so a regression in the request shape, the default
   * `fileType`, or the response parsing would break uploads silently.
   */
  it("default getUploadParameters POSTs /api/objects/upload with DOCUMENT fileType and returns the parsed PUT params", async () => {
    apiRequestMock.mockImplementation(
      async (_method: string, url: string) => {
        if (url === "/api/objects/upload") {
          return {
            json: async () => ({
              uploadURL: "https://s3.example.invalid/signed-put-url",
              intentId: "intent-default-1",
              objectKey: "uploads/key-default-1",
            }),
          };
        }
        throw new Error(`unexpected apiRequest URL in test: ${url}`);
      },
    );

    render(
      <ObjectUploader testId="uploader">Upload</ObjectUploader>,
    );
    const uppy = getLatestUppy();

    const file = {
      id: "default-file",
      name: "report.pdf",
      type: "application/pdf",
      size: 12_345,
    };

    let returnedParams: unknown;
    await act(async () => {
      returnedParams = await uppy.simulateGetUploadParameters(file);
    });

    const uploadCalls = apiRequestMock.mock.calls.filter(
      ([, url]) => url === "/api/objects/upload",
    );
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0][0]).toBe("POST");
    expect(uploadCalls[0][2]).toEqual({
      contentType: "application/pdf",
      fileSize: 12_345,
      fileType: "DOCUMENT",
    });

    expect(returnedParams).toEqual({
      method: "PUT",
      url: "https://s3.example.invalid/signed-put-url",
      intentId: "intent-default-1",
      objectKey: "uploads/key-default-1",
    });
  });

  it("falls back to 'application/octet-stream' contentType and 0 fileSize when the file lacks them", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url === "/api/objects/upload") {
        return {
          json: async () => ({
            uploadURL: "https://s3.example.invalid/u",
            intentId: "i-fallback",
            objectKey: "k-fallback",
          }),
        };
      }
      throw new Error(`unexpected apiRequest URL in test: ${url}`);
    });

    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const uppy = getLatestUppy();

    const bareFile = { id: "bare", name: "no-meta", type: "", size: 0 };
    await act(async () => {
      await uppy.simulateGetUploadParameters(bareFile);
    });

    const uploadCall = apiRequestMock.mock.calls.find(
      ([, url]) => url === "/api/objects/upload",
    );
    expect(uploadCall?.[2]).toEqual({
      contentType: "application/octet-stream",
      fileSize: 0,
      fileType: "DOCUMENT",
    });
  });

  it.each(["MEDIA", "DOCUMENT", "RECEIPT", "BIM", "LIDAR"] as const)(
    "propagates fileType=%s through the default request body",
    async (fileType) => {
      apiRequestMock.mockImplementation(async (_method: string, url: string) => {
        if (url === "/api/objects/upload") {
          return {
            json: async () => ({
              uploadURL: "https://s3.example.invalid/u",
              intentId: `intent-${fileType}`,
              objectKey: `key-${fileType}`,
            }),
          };
        }
        throw new Error(`unexpected apiRequest URL in test: ${url}`);
      });

      render(
        <ObjectUploader testId="uploader" fileType={fileType}>
          Upload
        </ObjectUploader>,
      );
      const uppy = getLatestUppy();

      const file = {
        id: `file-${fileType}`,
        name: `payload-${fileType}.bin`,
        type: "application/octet-stream",
        size: 4096,
      };
      await act(async () => {
        await uppy.simulateGetUploadParameters(file);
      });

      const uploadCall = apiRequestMock.mock.calls.find(
        ([, url]) => url === "/api/objects/upload",
      );
      expect(uploadCall?.[2]).toEqual({
        contentType: "application/octet-stream",
        fileSize: 4096,
        fileType,
      });
    },
  );

  it("records the returned intentId so the downstream confirm fan-out picks it up", async () => {
    apiRequestMock.mockImplementation(
      async (_method: string, url: string, body: unknown) => {
        if (url === "/api/objects/upload") {
          return {
            json: async () => ({
              uploadURL: "https://s3.example.invalid/signed",
              intentId: "intent-confirmed",
              objectKey: "uploads/k",
            }),
          };
        }
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
    render(
      <ObjectUploader testId="uploader" onComplete={onComplete}>
        Upload
      </ObjectUploader>,
    );
    const uppy = getLatestUppy();

    const file = {
      id: "rec",
      name: "doc.pdf",
      type: "application/pdf",
      size: 2048,
    };

    // Drive the default getUploadParameters as Uppy would just before PUT.
    // This is the only path that records intentId → file.id.
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

    // Confirm fan-out was driven by the intentId returned from the default
    // upload-params call — proving the intent was recorded.
    const confirmCalls = apiRequestMock.mock.calls.filter(
      ([, url]) => url === "/api/objects/confirm",
    );
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0][2]).toEqual({ intentId: "intent-confirmed" });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const enriched = onComplete.mock.calls[0][0] as {
      successful: Array<{ id: string; uploadURL: string }>;
    };
    expect(enriched.successful[0].uploadURL).toBe(
      "/objects/uploads/intent-confirmed",
    );
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

/**
 * Task #2027 — Tests for the AwsS3 single-PUT `getUploadParameters`
 * callback. This is the non-multipart path used for sub-10MB uploads
 * (see MULTIPART_THRESHOLD). It branches on whether the caller passed a
 * custom `onGetUploadParameters` prop:
 *
 *   • No prop  → calls `getDefaultUploadParameters`, which POSTs
 *     `/api/objects/upload` with `{contentType, fileSize, fileType}`
 *     and resolves to `{ method: "PUT", url, intentId, objectKey }`.
 *   • Prop set → invokes the prop and bypasses the default fetch
 *     entirely (used by e.g. avatar uploads that pre-mint their own
 *     intent server-side).
 *
 * In BOTH branches, after the params are produced the callback writes
 * `params.intentId` into a per-file map keyed by `file.id`. The
 * post-upload `complete` handler reads from that map to know which
 * intents to POST to `/api/objects/confirm`. A regression that
 * accidentally swapped the map key (e.g. used `file.name` instead of
 * `file.id`) would silently break asset linking — the upload would
 * succeed in S3 but no DB record would ever be persisted.
 */
describe("ObjectUploader — getUploadParameters (single-PUT) callback", () => {
  it("default path POSTs /api/objects/upload with {contentType, fileSize, fileType} and resolves to {method:'PUT', url, intentId, objectKey}", async () => {
    render(
      <ObjectUploader testId="uploader" fileType="MEDIA">
        Upload
      </ObjectUploader>,
    );
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({
        uploadURL: "https://s3.example/signed-put?token=abc",
        intentId: "intent-001",
        objectKey: "uploads/2026/foo.png",
      }),
    );

    const result = await opts.getUploadParameters({
      id: "f1",
      name: "foo.png",
      type: "image/png",
      size: 4096,
    });

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith("POST", "/api/objects/upload", {
      contentType: "image/png",
      fileSize: 4096,
      fileType: "MEDIA",
    });
    expect(result).toEqual({
      method: "PUT",
      url: "https://s3.example/signed-put?token=abc",
      intentId: "intent-001",
      objectKey: "uploads/2026/foo.png",
    });
  });

  it("default path falls back to application/octet-stream + size 0 + DOCUMENT when file fields and fileType prop are missing", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({
        uploadURL: "https://s3.example/signed-put",
        intentId: "intent-defaults",
        objectKey: "uploads/k",
      }),
    );

    await opts.getUploadParameters({ id: "f-defaults" });

    expect(mockedApiRequest).toHaveBeenCalledWith("POST", "/api/objects/upload", {
      contentType: "application/octet-stream",
      fileSize: 0,
      fileType: "DOCUMENT",
    });
  });

  it("invokes the onGetUploadParameters prop when supplied and does NOT POST /api/objects/upload", async () => {
    const onGetUploadParameters = vi.fn(async (file: { name: string; type: string; size: number }) => ({
      method: "PUT" as const,
      url: `https://custom.example/put/${file.name}`,
      intentId: `custom-intent-${file.name}`,
      objectKey: `custom-key-${file.name}`,
    }));

    render(
      <ObjectUploader
        testId="uploader"
        onGetUploadParameters={onGetUploadParameters}
      >
        Upload
      </ObjectUploader>,
    );
    const opts = getAwsS3Options(getLatestUppy());

    const result = await opts.getUploadParameters({
      id: "f-custom",
      name: "avatar.png",
      type: "image/png",
      size: 2048,
    });

    // Prop received the same {name, type, size} shape the default path
    // would have built — proves the prop is the single source of truth
    // when supplied.
    expect(onGetUploadParameters).toHaveBeenCalledTimes(1);
    expect(onGetUploadParameters).toHaveBeenCalledWith({
      name: "avatar.png",
      type: "image/png",
      size: 2048,
    });
    // Critical regression guard: when a prop is supplied, the default
    // path must NOT also call /api/objects/upload (would double-mint
    // intents and confuse server-side bookkeeping).
    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(result).toEqual({
      method: "PUT",
      url: "https://custom.example/put/avatar.png",
      intentId: "custom-intent-avatar.png",
      objectKey: "custom-key-avatar.png",
    });
  });

  it("populates the intent map keyed by file.id (verified by the subsequent confirm fan-out)", async () => {
    // The intent map is private to the component, so we observe it
    // indirectly: drive `getUploadParameters` for a specific file id,
    // then fire the `complete` event with that same id and assert the
    // confirm endpoint is called with the intentId we returned. If the
    // map were keyed by anything else (e.g. file.name), the lookup in
    // the complete handler would miss and confirm would never be hit.
    mockedApiRequest.mockImplementation(
      async (_method: string, url: string, body: unknown) => {
        if (url === "/api/objects/upload") {
          return jsonResponse({
            uploadURL: "https://s3.example/put",
            intentId: "intent-by-id-99",
            objectKey: "uploads/key",
          }) as unknown as Response;
        }
        if (url === "/api/objects/confirm") {
          const intentId = (body as { intentId: string }).intentId;
          return jsonResponse({
            objectPath: `/objects/uploads/${intentId}`,
            intentId,
          }) as unknown as Response;
        }
        throw new Error(`unexpected apiRequest URL: ${url}`);
      },
    );

    const onComplete = vi.fn();
    render(
      <ObjectUploader testId="uploader" onComplete={onComplete}>
        Upload
      </ObjectUploader>,
    );
    const uppy = getLatestUppy();

    const file = {
      id: "the-real-file-id",
      name: "totally-different-name.png",
      type: "image/png",
      size: 1024,
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

    const confirmCalls = mockedApiRequest.mock.calls.filter(
      ([, url]) => url === "/api/objects/confirm",
    );
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0][2]).toEqual({ intentId: "intent-by-id-99" });

    // And the resulting objectPath lands on the file forwarded to
    // onComplete, proving end-to-end that the file.id keyed map worked.
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as {
      successful: Array<{ id: string; uploadURL: string }>;
    };
    expect(result.successful[0].id).toBe("the-real-file-id");
    expect(result.successful[0].uploadURL).toBe(
      "/objects/uploads/intent-by-id-99",
    );
  });

  it("skips the intent map write when the resolved params have no intentId (confirm fan-out is then a no-op for that file)", async () => {
    // Some onGetUploadParameters implementations (e.g. legacy callers
    // that hit a pre-signed URL service directly) don't return an
    // intentId. The component must NOT attempt to confirm anything in
    // that case — confirm is only meaningful when the server minted an
    // intent for us.
    const onGetUploadParameters = vi.fn(async () => ({
      method: "PUT" as const,
      url: "https://legacy.example/upload",
      // intentId intentionally omitted
    }));

    const onComplete = vi.fn();
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

    const file = {
      id: "no-intent-file",
      name: "legacy.png",
      type: "image/png",
      size: 512,
      uploadURL: "https://legacy.example/already-uploaded",
    };

    await act(async () => {
      await uppy.simulateGetUploadParameters(file);
    });

    // Reset the mock so we can assert nothing more fires during complete.
    mockedApiRequest.mockReset();

    await act(async () => {
      uppy.emit("upload-success", file);
      await uppy.emitAsync("complete", {
        successful: [file],
        failed: [],
      });
    });

    // No confirm requests because no intentId was ever recorded.
    expect(
      mockedApiRequest.mock.calls.filter(([, url]) => url === "/api/objects/confirm"),
    ).toHaveLength(0);
    // onComplete still fires with the original uploadURL preserved.
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as {
      successful: Array<{ id: string; uploadURL: string }>;
    };
    expect(result.successful[0].uploadURL).toBe(
      "https://legacy.example/already-uploaded",
    );
  });
});

/**
 * Task #2015 — Tests for the AwsS3 multipart sign/list/abort/complete
 * callbacks and the chunk-size policy.
 *
 * These callbacks shape the wire contract between the browser and
 * `/api/objects/multipart/*`. A typo in the URL template, a wrong
 * query string, or a swapped HTTP method would otherwise only be
 * caught by manually uploading a multi-GB file. We capture the
 * options object that `<ObjectUploader>` passes to `uppy.use(AwsS3, …)`
 * via the mock Uppy class and invoke each callback directly, asserting
 * the exact `apiRequest(method, url, body)` triple.
 */
describe("ObjectUploader — getChunkSize policy", () => {
  // The four documented thresholds:
  //   • size > 5 GB        → 64 MB chunks
  //   • size > 1 GB        → 32 MB chunks
  //   • size > 256 MB      → 16 MB chunks
  //   • everything smaller →  8 MB chunks (default)
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;

  it("returns 64 MB chunks for files larger than 5 GB", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    expect(opts.getChunkSize({ size: 5 * GB + 1 })).toBe(64 * MB);
    expect(opts.getChunkSize({ size: 20 * GB })).toBe(64 * MB);
  });

  it("returns 32 MB chunks for files larger than 1 GB but not exceeding 5 GB", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    expect(opts.getChunkSize({ size: 1 * GB + 1 })).toBe(32 * MB);
    expect(opts.getChunkSize({ size: 5 * GB })).toBe(32 * MB);
  });

  it("returns 16 MB chunks for files larger than 256 MB but not exceeding 1 GB", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    expect(opts.getChunkSize({ size: 256 * MB + 1 })).toBe(16 * MB);
    expect(opts.getChunkSize({ size: 1 * GB })).toBe(16 * MB);
  });

  it("returns the 8 MB default for files at or below 256 MB (and missing sizes)", () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    expect(opts.getChunkSize({ size: 256 * MB })).toBe(8 * MB);
    expect(opts.getChunkSize({ size: 50 * MB })).toBe(8 * MB);
    expect(opts.getChunkSize({ size: 0 })).toBe(8 * MB);
    expect(opts.getChunkSize({})).toBe(8 * MB);
  });
});

describe("ObjectUploader — multipart createMultipartUpload callback", () => {
  it("POSTs to /api/objects/multipart with contentType, fileSize, and the resolved fileType", async () => {
    render(
      <ObjectUploader testId="uploader" fileType="LIDAR">
        Upload
      </ObjectUploader>,
    );
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({ uploadId: "uid-123", key: "uploads/abc.zip" }),
    );

    const result = await opts.createMultipartUpload({
      type: "application/zip",
      size: 700 * 1024 * 1024,
    });

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith("POST", "/api/objects/multipart", {
      contentType: "application/zip",
      fileSize: 700 * 1024 * 1024,
      fileType: "LIDAR",
    });
    expect(result).toEqual({ uploadId: "uid-123", key: "uploads/abc.zip" });
  });

  it("falls back to application/octet-stream + size 0 + DOCUMENT when fields are missing", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({ uploadId: "uid-defaults", key: "uploads/k" }),
    );

    await opts.createMultipartUpload({});

    expect(mockedApiRequest).toHaveBeenCalledWith("POST", "/api/objects/multipart", {
      contentType: "application/octet-stream",
      fileSize: 0,
      fileType: "DOCUMENT",
    });
  });
});

describe("ObjectUploader — multipart listParts callback", () => {
  it("GETs /api/objects/multipart/{uploadId} with no body and returns the parts array", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    const fakeParts = [
      { PartNumber: 1, ETag: "etag-1", Size: 8 * 1024 * 1024 },
      { PartNumber: 2, ETag: "etag-2", Size: 8 * 1024 * 1024 },
    ];
    mockedApiRequest.mockResolvedValueOnce(jsonResponse({ parts: fakeParts }));

    const parts = await opts.listParts(
      { id: "f1" },
      { uploadId: "uid-xyz", key: "uploads/abc" },
    );

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/objects/multipart/uid-xyz",
      undefined,
    );
    expect(parts).toEqual(fakeParts);
  });
});

describe("ObjectUploader — multipart signPart callback", () => {
  it("GETs /api/objects/multipart/{uploadId}/{partNumber}?chunkSize={size} when a body is supplied", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({
        url: "https://s3.example/sign?part=7",
        headers: { "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
      }),
    );

    const result = await opts.signPart(
      { id: "f1" },
      { uploadId: "uid-1", partNumber: 7, body: { size: 9_437_184 } },
    );

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/objects/multipart/uid-1/7?chunkSize=9437184",
      undefined,
    );
    expect(result).toEqual({
      url: "https://s3.example/sign?part=7",
      headers: { "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
    });
  });

  it("omits the ?chunkSize query string entirely when no body is provided", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({ url: "https://s3.example/sign?part=2" }),
    );

    const result = await opts.signPart(
      { id: "f1" },
      { uploadId: "uid-2", partNumber: 2 },
    );

    expect(mockedApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/objects/multipart/uid-2/2",
      undefined,
    );
    // Headers default to undefined when the server omits them.
    expect(result).toEqual({
      url: "https://s3.example/sign?part=2",
      headers: undefined,
    });
  });
});

describe("ObjectUploader — multipart completeMultipartUpload callback", () => {
  it("POSTs to /api/objects/multipart/{uploadId}/complete with an empty body and returns the location", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(
      jsonResponse({ location: "https://s3.example/uploads/abc.zip" }),
    );

    const result = await opts.completeMultipartUpload(
      { id: "f1" },
      { uploadId: "uid-99", key: "uploads/abc.zip", parts: [] },
    );

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/objects/multipart/uid-99/complete",
      {},
    );
    expect(result).toEqual({ location: "https://s3.example/uploads/abc.zip" });
  });
});

describe("ObjectUploader — multipart abortMultipartUpload callback", () => {
  it("DELETEs /api/objects/multipart/{uploadId} with no body on the happy path", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await opts.abortMultipartUpload(
      { id: "f1" },
      { uploadId: "uid-abort", key: "uploads/abc.zip" },
    );

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/objects/multipart/uid-abort",
      undefined,
    );
  });

  it("swallows errors from apiRequest so a failed abort never surfaces to Uppy", async () => {
    render(<ObjectUploader testId="uploader">Upload</ObjectUploader>);
    const opts = getAwsS3Options(getLatestUppy());

    mockedApiRequest.mockRejectedValueOnce(new Error("503 Service Unavailable"));

    // Critical: the production callback chains `.catch(() => {})`, so even
    // a failing DELETE must resolve without throwing — Uppy treats abort
    // as best-effort cleanup.
    await expect(
      opts.abortMultipartUpload(
        { id: "f1" },
        { uploadId: "uid-broken", key: "uploads/abc.zip" },
      ),
    ).resolves.toBeUndefined();

    expect(mockedApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/objects/multipart/uid-broken",
      undefined,
    );
  });
});
