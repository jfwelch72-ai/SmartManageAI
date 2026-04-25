import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode, DragEvent } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult, UppyFile } from "@uppy/core";
import { Pause, Play, X, RotateCw, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";

export const MULTIPART_THRESHOLD = 10 * 1024 * 1024;
export const LARGE_UPLOAD_THRESHOLD = 256 * 1024 * 1024;

interface UploadParams {
  method: "PUT";
  url: string;
  intentId?: string;
  objectKey?: string;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  fileType?: "MEDIA" | "DOCUMENT" | "RECEIPT" | "BIM" | "LIDAR";
  onGetUploadParameters?: (file: { name: string; type: string; size: number }) => Promise<UploadParams>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
  buttonClassName?: string;
  children: ReactNode;
  testId?: string;
}

interface FileProgressEntry {
  id: string;
  name: string;
  size: number;
  bytesUploaded: number;
  retries: number;
  status: "uploading" | "retrying" | "paused" | "completed" | "failed";
}

interface AggregateProgress {
  active: boolean;
  files: FileProgressEntry[];
  bytesUploaded: number;
  bytesTotal: number;
  bytesPerSecond: number;
  paused: boolean;
  retries: number;
  hasLargeFile: boolean;
}

const INITIAL_PROGRESS: AggregateProgress = {
  active: false,
  files: [],
  bytesUploaded: 0,
  bytesTotal: 0,
  bytesPerSecond: 0,
  paused: false,
  retries: 0,
  hasLargeFile: false,
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const remainingM = m - h * 60;
  return `${h}h ${remainingM.toString().padStart(2, "0")}m`;
}

async function confirmIntent(intentId: string): Promise<string> {
  const res = await apiRequest("POST", "/api/objects/confirm", { intentId });
  const data = (await res.json()) as { objectPath: string; intentId: string };
  return data.objectPath;
}

async function confirmIntents(intentIds: string[]): Promise<string[]> {
  return Promise.all(intentIds.map((id) => confirmIntent(id)));
}

async function getDefaultUploadParameters(
  file: { name: string; type: string; size: number },
  fileType?: string
): Promise<UploadParams> {
  const contentType = file.type || "application/octet-stream";
  const fileSize = file.size || 0;

  const res = await apiRequest("POST", "/api/objects/upload", {
    contentType,
    fileSize,
    fileType: fileType ?? "DOCUMENT",
  });
  const data = (await res.json()) as { uploadURL: string; intentId: string; objectKey: string };
  return {
    method: "PUT" as const,
    url: data.uploadURL,
    intentId: data.intentId,
    objectKey: data.objectKey,
  };
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = MAX_STORAGE_FILE_SIZE,
  allowedFileTypes,
  fileType,
  onGetUploadParameters,
  onComplete,
  children,
  testId,
}: ObjectUploaderProps) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<AggregateProgress>(INITIAL_PROGRESS);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intentMapRef = useRef<Map<string, string>>(new Map());
  const onCompleteRef = useRef(onComplete);
  const toastRef = useRef(toast);
  const resolvedFileType = fileType ?? "DOCUMENT";

  // Per-file tracking & rolling-window throughput sampling
  const fileStateRef = useRef<Map<string, FileProgressEntry>>(new Map());
  const samplesRef = useRef<Array<{ t: number; bytes: number }>>([]);
  const lastEmitRef = useRef<number>(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const computeAggregate = useCallback((): AggregateProgress => {
    const files = Array.from(fileStateRef.current.values());
    let bytesUploaded = 0;
    let bytesTotal = 0;
    let retries = 0;
    let hasLargeFile = false;
    let active = false;
    let anyPaused = false;
    let anyMoving = false;
    for (const f of files) {
      bytesUploaded += f.bytesUploaded;
      bytesTotal += f.size;
      retries += f.retries;
      if (f.size >= LARGE_UPLOAD_THRESHOLD) hasLargeFile = true;
      if (f.status === "uploading" || f.status === "retrying" || f.status === "paused") {
        active = true;
      }
      if (f.status === "paused") anyPaused = true;
      if (f.status === "uploading" || f.status === "retrying") anyMoving = true;
    }
    // Show "paused" state whenever at least one in-flight file is paused
    // and no other file is still actively uploading/retrying. This keeps
    // the Resume button visible for mixed sets like (completed + paused).
    const paused = anyPaused && !anyMoving;

    // Throughput from rolling sample window (last 5s)
    const now = Date.now();
    const cutoff = now - 5000;
    const samples = samplesRef.current.filter((s) => s.t >= cutoff);
    samplesRef.current = samples;
    let bytesPerSecond = 0;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      const db = last.bytes - first.bytes;
      if (dt > 0 && db > 0) bytesPerSecond = db / dt;
    }

    return {
      active,
      files,
      bytesUploaded,
      bytesTotal,
      bytesPerSecond,
      paused,
      retries,
      hasLargeFile,
    };
  }, []);

  const scheduleProgressEmit = useCallback(() => {
    const now = Date.now();
    const sinceLast = now - lastEmitRef.current;
    if (sinceLast >= 250) {
      lastEmitRef.current = now;
      setProgress(computeAggregate());
      return;
    }
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      lastEmitRef.current = Date.now();
      setProgress(computeAggregate());
    }, 250 - sinceLast);
  }, [computeAggregate]);

  const resetProgress = useCallback(() => {
    fileStateRef.current.clear();
    samplesRef.current = [];
    lastEmitRef.current = 0;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setProgress(INITIAL_PROGRESS);
  }, []);

  const [uppy] = useState(() => {
    const instance = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes,
      },
      autoProceed: false,
    });

    instance.use(AwsS3, {
      shouldUseMultipart: (file) => !onGetUploadParameters && (file.size ?? 0) > MULTIPART_THRESHOLD,
      limit: 4,
      // S3 multipart retries are handled internally by @uppy/aws-s3 — these
      // retries are surfaced as `upload-retry` events so the UI can show a
      // friendly indicator instead of a scary toast.
      retryDelays: [0, 1000, 3000, 5000, 10000],
      getChunkSize: (file) => {
        const size = file.size ?? 0;
        if (size > 5 * 1024 * 1024 * 1024) return 64 * 1024 * 1024; // 5GB+: 64MB chunks
        if (size > 1024 * 1024 * 1024) return 32 * 1024 * 1024; // 1GB+: 32MB chunks
        if (size > 256 * 1024 * 1024) return 16 * 1024 * 1024; // 256MB+: 16MB chunks
        return 8 * 1024 * 1024; // default 8MB
      },

      getUploadParameters: async (file) => {
        const fileInfo = {
          name: file.name ?? "",
          type: file.type ?? "application/octet-stream",
          size: file.size ?? 0,
        };

        let params: UploadParams;
        if (onGetUploadParameters) {
          params = await onGetUploadParameters(fileInfo);
        } else {
          params = await getDefaultUploadParameters(fileInfo, resolvedFileType);
        }

        if (params.intentId && file.id) {
          intentMapRef.current.set(file.id, params.intentId);
        }

        return params;
      },

      createMultipartUpload: async (file) => {
        const res = await apiRequest("POST", "/api/objects/multipart", {
          contentType: file.type ?? "application/octet-stream",
          fileSize: file.size ?? 0,
          fileType: resolvedFileType,
        });
        const data = (await res.json()) as { uploadId: string; key: string };
        return { uploadId: data.uploadId, key: data.key };
      },

      listParts: async (_file, { uploadId }) => {
        const res = await apiRequest("GET", `/api/objects/multipart/${uploadId}`, undefined);
        const data = (await res.json()) as { parts: Array<{ PartNumber: number; ETag: string; Size: number }> };
        return data.parts;
      },

      signPart: async (_file, { uploadId, partNumber, body }) => {
        const qs = body ? `?chunkSize=${body.size}` : "";
        const res = await apiRequest("GET", `/api/objects/multipart/${uploadId}/${partNumber}${qs}`, undefined);
        const data = (await res.json()) as { url: string; headers?: Record<string, string> };
        return { url: data.url, headers: data.headers };
      },

      completeMultipartUpload: async (_file, { uploadId }) => {
        const res = await apiRequest("POST", `/api/objects/multipart/${uploadId}/complete`, {});
        const data = (await res.json()) as { location: string };
        return { location: data.location };
      },

      abortMultipartUpload: async (_file, { uploadId }) => {
        await apiRequest("DELETE", `/api/objects/multipart/${uploadId}`, undefined).catch(() => {});
      },
    });

    const ensureEntry = (file: UppyFile<Record<string, unknown>, Record<string, unknown>> | undefined): FileProgressEntry | null => {
      if (!file) return null;
      const id = file.id;
      let entry = fileStateRef.current.get(id);
      if (!entry) {
        entry = {
          id,
          name: file.name ?? "file",
          size: file.size ?? 0,
          bytesUploaded: 0,
          retries: 0,
          status: "uploading",
        };
        fileStateRef.current.set(id, entry);
      }
      return entry;
    };

    instance.on("upload", () => {
      // Reset rolling samples and seed entries from current files.
      samplesRef.current = [];
      const files = instance.getFiles();
      for (const file of files) {
        if (!fileStateRef.current.has(file.id)) {
          fileStateRef.current.set(file.id, {
            id: file.id,
            name: file.name ?? "file",
            size: file.size ?? 0,
            bytesUploaded: 0,
            retries: 0,
            status: "uploading",
          });
        }
      }
      scheduleProgressEmit();
    });

    instance.on("upload-progress", (file, fileProgress) => {
      const entry = ensureEntry(file);
      if (!entry) return;
      const bytesUploaded = typeof fileProgress.bytesUploaded === "number" ? fileProgress.bytesUploaded : entry.bytesUploaded;
      // Sample total bytes uploaded across all files into the rolling window.
      const delta = Math.max(0, bytesUploaded - entry.bytesUploaded);
      entry.bytesUploaded = bytesUploaded;
      if (entry.status !== "paused") entry.status = "uploading";
      if (delta > 0) {
        let cumulative = 0;
        const allEntries = Array.from(fileStateRef.current.values());
        for (const f of allEntries) cumulative += f.bytesUploaded;
        samplesRef.current.push({ t: Date.now(), bytes: cumulative });
        if (samplesRef.current.length > 80) samplesRef.current.shift();
      }
      scheduleProgressEmit();
    });

    instance.on("upload-retry", (file) => {
      const entry = ensureEntry(file);
      if (!entry) return;
      entry.retries += 1;
      entry.status = "retrying";
      scheduleProgressEmit();
    });

    instance.on("upload-pause", (file, isPaused) => {
      const entry = ensureEntry(file);
      if (!entry) return;
      entry.status = isPaused ? "paused" : "uploading";
      scheduleProgressEmit();
    });

    instance.on("pause-all", () => {
      const allEntries = Array.from(fileStateRef.current.values());
      for (const f of allEntries) {
        if (f.status === "uploading" || f.status === "retrying") f.status = "paused";
      }
      scheduleProgressEmit();
    });

    instance.on("resume-all", () => {
      const allEntries = Array.from(fileStateRef.current.values());
      for (const f of allEntries) {
        if (f.status === "paused") f.status = "uploading";
      }
      scheduleProgressEmit();
    });

    instance.on("upload-success", (file) => {
      const entry = ensureEntry(file);
      if (!entry) return;
      entry.bytesUploaded = entry.size;
      entry.status = "completed";
      scheduleProgressEmit();
    });

    instance.on("upload-error", (file) => {
      const entry = ensureEntry(file);
      if (!entry) return;
      // Only flagged terminal at this stage; final aggregation happens in `complete`.
      entry.status = "failed";
      scheduleProgressEmit();
    });

    instance.on("file-removed", (file) => {
      fileStateRef.current.delete(file.id);
      scheduleProgressEmit();
    });

    instance.on("cancel-all", () => {
      resetProgress();
    });

    instance.on("complete", async (result) => {
      const successfulFiles = result.successful ?? [];
      const failedFiles = result.failed ?? [];

      if (successfulFiles.length === 0 && failedFiles.length > 0) {
        toastRef.current({
          title: "Upload failed",
          description: `${failedFiles.length} file(s) could not be uploaded. Please try again.`,
          variant: "destructive",
        });
        setShowModal(false);
        resetProgress();
        return;
      }

      if (successfulFiles.length === 0) {
        setShowModal(false);
        resetProgress();
        return;
      }

      const intentIds = successfulFiles
        .map((f) => intentMapRef.current.get(f.id))
        .filter((id): id is string => !!id);

      intentMapRef.current.clear();

      try {
        let objectPaths: string[] = [];
        if (intentIds.length > 0) {
          objectPaths = await confirmIntents(intentIds);
        }

        let pathIdx = 0;
        const enrichedResult: UploadResult<Record<string, unknown>, Record<string, unknown>> = {
          ...result,
          successful: successfulFiles.map((f) => ({
            ...f,
            uploadURL: objectPaths[pathIdx++] ?? f.uploadURL,
          })),
        };
        onCompleteRef.current?.(enrichedResult);
      } catch (err) {
        console.error("Upload confirm failed:", err);
        toastRef.current({
          title: "Upload processing error",
          description: "Files uploaded but could not be confirmed. Please try again.",
          variant: "destructive",
        });
        onCompleteRef.current?.({
          ...result,
          successful: successfulFiles.map((f) => ({
            ...f,
            uploadURL: f.uploadURL ?? "",
          })),
          failed: failedFiles,
        });
      } finally {
        setShowModal(false);
        resetProgress();
      }
    });

    return instance;
  });

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const addFilesToUppy = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      fileArray.forEach((file) => {
        try {
          uppy.addFile({
            name: file.name,
            type: file.type,
            data: file,
            source: "local",
          });
        } catch (error) {
          console.warn("File add error:", error);
          toast({ title: "File error", description: error instanceof Error ? error.message : "Could not add file.", variant: "destructive" });
        }
      });

      if (fileArray.length > 0) {
        setShowModal(true);
      }
    },
    [uppy, toast]
  );

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        addFilesToUppy(e.dataTransfer.files);
      }
    },
    [addFilesToUppy]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToUppy(e.target.files);
        e.target.value = "";
      }
    },
    [addFilesToUppy]
  );

  const handlePauseAll = useCallback(() => {
    uppy.pauseAll();
  }, [uppy]);

  const handleResumeAll = useCallback(() => {
    uppy.resumeAll();
  }, [uppy]);

  const handleCancelAll = useCallback(() => {
    uppy.cancelAll();
    resetProgress();
    setShowModal(false);
  }, [uppy, resetProgress]);

  const handleReopen = useCallback(() => {
    setShowModal(true);
  }, []);

  const showAggregate = progress.active && progress.bytesTotal > 0;
  const isLargeUpload = progress.hasLargeFile || progress.bytesTotal >= LARGE_UPLOAD_THRESHOLD;
  const percent = showAggregate ? Math.min(100, (progress.bytesUploaded / progress.bytesTotal) * 100) : 0;
  const remainingBytes = Math.max(0, progress.bytesTotal - progress.bytesUploaded);
  const etaSeconds = progress.bytesPerSecond > 0 ? remainingBytes / progress.bytesPerSecond : 0;
  const isRetrying = progress.files.some((f) => f.status === "retrying");
  const primaryName =
    progress.files.length === 1
      ? progress.files[0].name
      : `${progress.files.length} files`;

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        multiple={maxNumberOfFiles > 1}
        accept={allowedFileTypes?.join(",")}
        className="hidden"
        onChange={handleFileInput}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="cursor-pointer transition-colors pl-[10px] pr-[10px] pt-[3px] pb-[3px] ml-[0px] mr-[0px] rounded-sm text-center mt-[0px] mb-[0px] flex justify-center items-center bg-[#fa6b1b00]"
        data-testid={testId}
      >
        {children}
      </div>
      {showAggregate && isLargeUpload && (
        <div
          className="mt-2 rounded-md border border-border bg-card text-card-foreground p-3 text-sm shadow-sm"
          role="status"
          aria-live="polite"
          data-testid={testId ? `${testId}-progress` : "upload-progress"}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {progress.paused ? (
                <Pause className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : isRetrying ? (
                <RotateCw className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 animate-spin" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 text-primary animate-spin" />
              )}
              <span className="truncate font-medium" data-testid="text-upload-filename" title={primaryName}>
                {primaryName}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {progress.paused ? (
                <button
                  type="button"
                  onClick={handleResumeAll}
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-background px-2 text-xs hover:bg-accent"
                  data-testid="button-upload-resume"
                  aria-label="Resume upload"
                >
                  <Play className="h-3 w-3" />
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePauseAll}
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-background px-2 text-xs hover:bg-accent"
                  data-testid="button-upload-pause"
                  aria-label="Pause upload"
                >
                  <Pause className="h-3 w-3" />
                  Pause
                </button>
              )}
              <button
                type="button"
                onClick={handleCancelAll}
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-background px-2 text-xs hover:bg-destructive hover:text-destructive-foreground"
                data-testid="button-upload-cancel"
                aria-label="Cancel upload"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
              {!showModal && (
                <button
                  type="button"
                  onClick={handleReopen}
                  className="inline-flex h-7 items-center rounded-sm border border-border bg-background px-2 text-xs hover:bg-accent"
                  data-testid="button-upload-reopen"
                >
                  Details
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all duration-300 ease-out ${
                progress.paused ? "bg-muted-foreground" : "bg-primary"
              }`}
              style={{ width: `${percent}%` }}
              data-testid="bar-upload-progress"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span data-testid="text-upload-bytes">
              {formatBytes(progress.bytesUploaded)} / {formatBytes(progress.bytesTotal)}
            </span>
            <span data-testid="text-upload-percent">{percent.toFixed(1)}%</span>
            <span data-testid="text-upload-rate">{formatRate(progress.bytesPerSecond)}</span>
            <span data-testid="text-upload-eta">
              ETA {progress.paused ? "paused" : formatEta(etaSeconds)}
            </span>
            {isRetrying && (
              <span
                className="text-amber-700 dark:text-amber-300"
                data-testid="text-upload-retrying"
              >
                Retrying part…
              </span>
            )}
            {progress.retries > 0 && !isRetrying && (
              <span data-testid="text-upload-retry-count">
                {progress.retries} retr{progress.retries === 1 ? "y" : "ies"} recovered
              </span>
            )}
          </div>
        </div>
      )}
      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
        hidePauseResumeButton={false}
        hideCancelButton={false}
        hideProgressDetails={false}
        note="Multi-GB uploads pause, resume, and recover from network blips automatically."
      />
    </div>
  );
}
