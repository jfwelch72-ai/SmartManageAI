import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Download } from "lucide-react";

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentRendererProps {
  url: string;
  name: string | null;
  type: string | null;
  size?: number | null;
}

export function AttachmentRenderer({ url, name, type, size }: AttachmentRendererProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isImage = type?.startsWith("image/");
  return (
    <div className="mt-1.5">
      {isImage ? (
        <>
          <button
            onClick={() => setLightboxOpen(true)}
            className="focus:outline-none rounded-lg overflow-hidden"
            data-testid="button-attachment-image-expand"
          >
            <img
              src={url}
              alt={name || "attachment"}
              className="max-w-[200px] max-h-[160px] rounded-lg object-cover border hover:opacity-90 transition-opacity cursor-zoom-in"
            />
          </button>
          <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
            <DialogContent className="sm:max-w-3xl p-2 bg-black/90">
              <DialogHeader className="sr-only">
                <DialogTitle>{name || "Image preview"}</DialogTitle>
              </DialogHeader>
              <img
                src={url}
                alt={name || "attachment"}
                className="max-h-[80vh] w-full object-contain rounded"
              />
              <div className="flex justify-between items-center mt-2 px-2">
                <span className="text-sm text-white/70 truncate">{name}</span>
                <a
                  href={url}
                  download={name || "image"}
                  className="text-sm text-white/70 hover:text-white flex items-center gap-1"
                  data-testid="button-attachment-download"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-background/50 border rounded-lg px-3 py-2 text-sm hover:bg-muted transition-colors"
          data-testid="button-attachment-download"
        >
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="truncate max-w-[140px]">{name || "File"}</span>
          {size != null && <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtBytes(size)}</span>}
          <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </a>
      )}
    </div>
  );
}
