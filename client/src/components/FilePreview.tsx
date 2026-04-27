import { useEffect, useState } from "react";
import { Loader2, File, ExternalLink, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PdfPreview from "@/components/PdfPreview";

interface FilePreviewProps {
  /**
   * Authenticated, same-origin stream URL for the file
   * (e.g. `/api/bids/:code/documents/:id/stream`).
   * Cookies are sent automatically by the browser.
   */
  url: string;
  /** Original filename — used for extension detection + display. */
  fileName: string;
  /** Optional friendlier title to show above the badge. */
  title?: string;
  /** MIME type from the server, when available. */
  mimeType?: string | null;
  /** "Open in new tab" handler — typically opens a signed download URL. */
  onOpenFile?: () => void;
}

const TEXT_MAX_BYTES = 1_000_000;

const VIDEO_EXTS = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const TEXT_EXTS = [
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "log",
  "json",
  "xml",
  "yaml",
  "yml",
  "ini",
  "conf",
  "cfg",
  "html",
  "htm",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "sh",
  "sql",
];
const OFFICE_EXTS = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "pages", "numbers", "key"];
const CAD_EXTS = ["dwg", "dxf", "rvt", "ifc", "skp", "3ds", "obj", "fbx", "stl"];
const ARCHIVE_EXTS = ["zip", "rar", "7z", "tar", "gz", "tgz"];

function ext(fileName: string): string {
  const m = /\.([^.]+)$/.exec(fileName || "");
  return m ? m[1].toLowerCase() : "";
}

type Kind = "pdf" | "image" | "video" | "audio" | "text" | "office" | "cad" | "archive" | "other";

function detectKind(fileName: string, mimeType?: string | null): Kind {
  const e = ext(fileName);
  const mt = (mimeType || "").toLowerCase();

  if (mt.includes("pdf") || e === "pdf") return "pdf";
  if (mt.startsWith("image/") || IMAGE_EXTS.includes(e)) return "image";
  if (mt.startsWith("video/") || VIDEO_EXTS.includes(e)) return "video";
  if (mt.startsWith("audio/") || AUDIO_EXTS.includes(e)) return "audio";
  if (mt.startsWith("text/") || mt === "application/json" || TEXT_EXTS.includes(e)) return "text";
  if (OFFICE_EXTS.includes(e)) return "office";
  if (CAD_EXTS.includes(e)) return "cad";
  if (ARCHIVE_EXTS.includes(e)) return "archive";
  return "other";
}

function FallbackPanel({
  fileName,
  title,
  badgeLabel,
  message,
  onOpenFile,
}: {
  fileName: string;
  title?: string;
  badgeLabel: string;
  message: string;
  onOpenFile?: () => void;
}) {
  return (
    <div
      className="flex items-center justify-center h-full"
      data-testid="file-preview-fallback"
    >
      <div className="text-center space-y-4 p-8 max-w-sm">
        <div className="flex justify-center">
          <File className="w-16 h-16 text-muted-foreground/40" />
        </div>
        <div>
          <p
            className="font-medium text-sm break-words"
            data-testid="text-file-preview-name"
          >
            {title || fileName}
          </p>
          <Badge variant="secondary" className="mt-1 text-xs">
            {badgeLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        {onOpenFile && (
          <Button
            variant="outline"
            onClick={onOpenFile}
            data-testid="button-open-file-external"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open File
          </Button>
        )}
      </div>
    </div>
  );
}

function TextPreview({
  url,
  fileName,
  onOpenFile,
}: {
  url: string;
  fileName: string;
  onOpenFile?: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    setTruncated(false);

    (async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) throw new Error("You must be signed in to view this file.");
          if (res.status === 403) throw new Error("You don't have permission to view this file.");
          if (res.status === 404) throw new Error("This file was not found on the server.");
          if (res.status >= 500) throw new Error("The server failed to deliver this file.");
          throw new Error(`Could not load file (HTTP ${res.status}).`);
        }
        const lenHeader = res.headers.get("content-length");
        const len = lenHeader ? Number(lenHeader) : NaN;
        if (Number.isFinite(len) && len > TEXT_MAX_BYTES) {
          if (!cancelled) {
            setTruncated(true);
            setLoading(false);
          }
          return;
        }
        const blob = await res.blob();
        if (blob.size > TEXT_MAX_BYTES) {
          if (!cancelled) {
            setTruncated(true);
            setLoading(false);
          }
          return;
        }
        const text = await blob.text();
        if (!cancelled) setContent(text);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load text preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, retryNonce]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="text-preview-loading"
      >
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="text-preview-error">
        <div className="text-center space-y-4 p-8 max-w-md">
          <File className="w-16 h-16 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Unable to preview this file</p>
            <p
              className="text-xs text-muted-foreground break-words"
              data-testid="text-text-preview-error-detail"
            >
              {error}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryNonce((n) => n + 1)}
              data-testid="button-text-preview-retry"
            >
              <RotateCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
            {onOpenFile && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenFile}
                data-testid="button-open-file-external"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open File
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (truncated) {
    return (
      <FallbackPanel
        fileName={fileName}
        badgeLabel={ext(fileName).toUpperCase() || "TEXT"}
        message="This file is too large to preview here. Open it to view the full contents."
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div className="h-full overflow-auto bg-muted/20 p-4" data-testid="text-preview">
      <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground">
        {content}
      </pre>
    </div>
  );
}

function MediaErrorOverlay({
  fileName,
  badgeLabel,
  onOpenFile,
  onRetry,
}: {
  fileName: string;
  badgeLabel: string;
  onOpenFile?: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex items-center justify-center h-full"
      data-testid="media-preview-error"
    >
      <div className="text-center space-y-4 p-8 max-w-sm">
        <File className="w-16 h-16 text-muted-foreground/40 mx-auto" />
        <div>
          <p className="font-medium text-sm break-words">{fileName}</p>
          <Badge variant="secondary" className="mt-1 text-xs">
            {badgeLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          This file couldn't be loaded. It may be missing, you may not have access,
          or your connection dropped.
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            data-testid="button-media-retry"
          >
            <RotateCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
          {onOpenFile && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenFile}
              data-testid="button-open-file-external"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open File
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FilePreview({
  url,
  fileName,
  title,
  mimeType,
  onOpenFile,
}: FilePreviewProps) {
  const kind = detectKind(fileName, mimeType);
  const badgeLabel = (ext(fileName) || kind).toUpperCase();
  const [mediaError, setMediaError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Reset media error whenever the underlying file/url changes.
  useEffect(() => {
    setMediaError(false);
  }, [url]);

  const handleRetry = () => {
    setMediaError(false);
    setRetryNonce((n) => n + 1);
  };

  if (kind === "pdf") {
    return <PdfPreview url={url} onOpenFile={onOpenFile} />;
  }

  if (kind === "image") {
    if (mediaError) {
      return (
        <MediaErrorOverlay
          fileName={title || fileName}
          badgeLabel={badgeLabel}
          onOpenFile={onOpenFile}
          onRetry={handleRetry}
        />
      );
    }
    return (
      <div
        className="flex items-center justify-center h-full bg-muted/20 p-4"
        data-testid="image-preview"
      >
        <img
          key={retryNonce}
          src={url}
          alt={title || fileName}
          className="max-w-full max-h-full object-contain"
          data-testid="preview-image"
          onError={() => setMediaError(true)}
        />
      </div>
    );
  }

  if (kind === "video") {
    if (mediaError) {
      return (
        <MediaErrorOverlay
          fileName={title || fileName}
          badgeLabel={badgeLabel}
          onOpenFile={onOpenFile}
          onRetry={handleRetry}
        />
      );
    }
    return (
      <div
        className="flex items-center justify-center h-full bg-black"
        data-testid="video-preview"
      >
        <video
          key={retryNonce}
          src={url}
          controls
          className="max-w-full max-h-full"
          data-testid="preview-video"
          onError={() => setMediaError(true)}
        >
          Your browser does not support video playback.
        </video>
      </div>
    );
  }

  if (kind === "audio") {
    if (mediaError) {
      return (
        <MediaErrorOverlay
          fileName={title || fileName}
          badgeLabel={badgeLabel}
          onOpenFile={onOpenFile}
          onRetry={handleRetry}
        />
      );
    }
    return (
      <div
        className="flex flex-col items-center justify-center h-full bg-muted/20 p-8 gap-4"
        data-testid="audio-preview"
      >
        <File className="w-16 h-16 text-muted-foreground/40" />
        <div className="text-center">
          <p className="font-medium text-sm break-words" data-testid="text-audio-name">
            {title || fileName}
          </p>
          <Badge variant="secondary" className="mt-1 text-xs">
            {badgeLabel}
          </Badge>
        </div>
        <audio
          key={retryNonce}
          src={url}
          controls
          className="w-full max-w-md"
          data-testid="preview-audio"
          onError={() => setMediaError(true)}
        >
          Your browser does not support audio playback.
        </audio>
      </div>
    );
  }

  if (kind === "text") {
    return <TextPreview url={url} fileName={fileName} onOpenFile={onOpenFile} />;
  }

  if (kind === "office") {
    return (
      <FallbackPanel
        fileName={fileName}
        title={title}
        badgeLabel={badgeLabel}
        message="Office documents can't be rendered inline. Download the file to open it in your desktop app."
        onOpenFile={onOpenFile}
      />
    );
  }

  if (kind === "cad") {
    return (
      <FallbackPanel
        fileName={fileName}
        title={title}
        badgeLabel={badgeLabel}
        message="CAD/BIM files require a specialized viewer. Download the file or use the BIM viewer if supported."
        onOpenFile={onOpenFile}
      />
    );
  }

  if (kind === "archive") {
    return (
      <FallbackPanel
        fileName={fileName}
        title={title}
        badgeLabel={badgeLabel}
        message="Archives can't be previewed. Download to extract the contents."
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <FallbackPanel
      fileName={fileName}
      title={title}
      badgeLabel={badgeLabel}
      message="This file type can't be previewed in the browser."
      onOpenFile={onOpenFile}
    />
  );
}
