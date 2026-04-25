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

type Listener = (...args: unknown[]) => void;

interface MockUppyInstance {
  handlers: Map<string, Listener[]>;
  files: Array<{ id: string; name: string; type: string; size: number }>;
  pauseAll: ReturnType<typeof vi.fn>;
  resumeAll: ReturnType<typeof vi.fn>;
  cancelAll: ReturnType<typeof vi.fn>;
  use: () => MockUppyInstance;
  on: (event: string, handler: Listener) => MockUppyInstance;
  off: (event: string, handler: Listener) => MockUppyInstance;
  getFiles: () => Array<{ id: string; name: string; type: string; size: number }>;
  addFile: (file: { name: string; type: string; size: number; data: unknown }) => string;
  emit: (event: string, ...args: unknown[]) => void;
}

const { mockToast, mockUppyInstances, MockUppyClass } = vi.hoisted(() => {
  const instances: MockUppyInstance[] = [];
  // Defined inside hoisted block so it's available when vi.mock factories run.
  class MockUppy implements MockUppyInstance {
    handlers = new Map<string, Listener[]>();
    files: Array<{ id: string; name: string; type: string; size: number }> = [];
    pauseAll = vi.fn(() => this.emit("pause-all"));
    resumeAll = vi.fn(() => this.emit("resume-all"));
    cancelAll = vi.fn(() => this.emit("cancel-all"));

    constructor() {
      instances.push(this);
    }

    use(): this {
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
