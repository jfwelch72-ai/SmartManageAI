import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRight, Equal, Plus, Minus, RefreshCw, Eye, FileText, Columns, Layers } from "lucide-react";

interface Revision {
  id: string;
  revisionNumber: number;
  sourceType: string;
  status: string;
  createdAt: string;
  metadata: Record<string, any> | null;
}

interface CompareChange {
  field: string;
  from: any;
  to: any;
  type: "changed" | "added" | "removed";
}

interface CompareResult {
  revision1: {
    id: string;
    revisionNumber: number;
    sourceType: string;
    status: string;
    createdAt: string;
    checksum: string | null;
    storageKey: string | null;
    createdByUserId: string | null;
    metadata: Record<string, any> | null;
  };
  revision2: {
    id: string;
    revisionNumber: number;
    sourceType: string;
    status: string;
    createdAt: string;
    checksum: string | null;
    storageKey: string | null;
    createdByUserId: string | null;
    metadata: Record<string, any> | null;
  };
  changes: CompareChange[];
  checksumMatch: boolean | null;
  timeBetweenMs: number | null;
  fileSizeDelta: number | null;
}

interface RevisionCompareDialogProps {
  documentId: string;
  revisions: Revision[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const abs = Math.abs(bytes);
  const prefix = bytes >= 0 ? "+" : "-";
  if (abs < 1024) return `${prefix}${abs} B`;
  if (abs < 1024 * 1024) return `${prefix}${(abs / 1024).toFixed(1)} KB`;
  return `${prefix}${(abs / (1024 * 1024)).toFixed(1)} MB`;
}

const fieldLabels: Record<string, string> = {
  sourceType: "Source Type",
  status: "Status",
  fileName: "File Name",
  fileSize: "File Size",
  uploadedBy: "Uploaded By",
  storageKey: "Storage Key",
};

type ViewTab = "metadata" | "visual";
type VisualMode = "side-by-side" | "overlay";

function VisualComparePanel({ rev1Id, rev2Id, comparison }: { rev1Id: string; rev2Id: string; comparison: CompareResult }) {
  const [mode, setMode] = useState<VisualMode>("side-by-side");
  const [sliderPos, setSliderPos] = useState(50);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const url1Data = rev1Id && comparison.revision1.storageKey ? { url: `/api/documents/revisions/${rev1Id}/preview-url` } : undefined;
  const loading1 = false;
  const url2Data = rev2Id && comparison.revision2.storageKey ? { url: `/api/documents/revisions/${rev2Id}/preview-url` } : undefined;
  const loading2 = false;

  const bothHaveFiles = comparison.revision1.storageKey && comparison.revision2.storageKey;

  const handleMouseDown = () => { isDragging.current = true; };
  const handleMouseUp = () => { isDragging.current = false; };
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current || !sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  useEffect(() => {
    const handleUp = () => { isDragging.current = false; };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, []);

  if (!bothHaveFiles) {
    return (
      <div className="text-center py-8 text-muted-foreground" data-testid="text-no-visual-compare">
        <Eye className="w-6 h-6 mx-auto mb-2 opacity-50" />
        Visual comparison requires both revisions to have uploaded files.
      </div>
    );
  }

  if (loading1 || loading2) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const url1 = url1Data?.url;
  const url2 = url2Data?.url;

  if (!url1 || !url2) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Unable to load file previews for visual comparison.
      </div>
    );
  }

  const isImage = (key: string | null) => {
    if (!key) return false;
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg|tiff?)$/i.test(key);
  };

  const rev1IsImage = isImage(comparison.revision1.storageKey);
  const rev2IsImage = isImage(comparison.revision2.storageKey);

  if (!rev1IsImage && !rev2IsImage) {
    return (
      <div className="space-y-3">
        <div className="text-center py-4 text-muted-foreground text-sm">
          Visual overlay is available for image files. These files can be previewed below.
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium mb-1">Rev {comparison.revision1.revisionNumber}</div>
            <iframe src={url1} className="w-full h-64 border rounded" title="Revision 1" />
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Rev {comparison.revision2.revisionNumber}</div>
            <iframe src={url2} className="w-full h-64 border rounded" title="Revision 2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant={mode === "side-by-side" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("side-by-side")}
          data-testid="button-visual-side-by-side"
        >
          <Columns className="w-4 h-4 mr-1" /> Side by Side
        </Button>
        <Button
          variant={mode === "overlay" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("overlay")}
          data-testid="button-visual-overlay"
        >
          <Layers className="w-4 h-4 mr-1" /> Overlay Slider
        </Button>
      </div>

      {mode === "side-by-side" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="border rounded overflow-hidden">
            <div className="bg-muted px-2 py-1 text-xs font-medium border-b">
              Rev {comparison.revision1.revisionNumber} (Earlier)
            </div>
            <img
              src={url1}
              alt={`Revision ${comparison.revision1.revisionNumber}`}
              className="w-full h-auto"
              data-testid="img-revision-1"
            />
          </div>
          <div className="border rounded overflow-hidden">
            <div className="bg-muted px-2 py-1 text-xs font-medium border-b">
              Rev {comparison.revision2.revisionNumber} (Later)
            </div>
            <img
              src={url2}
              alt={`Revision ${comparison.revision2.revisionNumber}`}
              className="w-full h-auto"
              data-testid="img-revision-2"
            />
          </div>
        </div>
      ) : (
        <div
          ref={sliderRef}
          className="relative border rounded overflow-hidden cursor-col-resize select-none"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          data-testid="overlay-slider-container"
        >
          <img
            src={url2}
            alt={`Revision ${comparison.revision2.revisionNumber}`}
            className="w-full h-auto block"
          />
          <div
            className="absolute top-0 left-0 h-full overflow-hidden"
            style={{ width: `${sliderPos}%` }}
          >
            <img
              src={url1}
              alt={`Revision ${comparison.revision1.revisionNumber}`}
              className="h-full object-cover"
              style={{ width: `${sliderRef.current?.offsetWidth || 600}px`, maxWidth: "none" }}
            />
          </div>
          <div
            className="absolute top-0 h-full w-1 bg-primary cursor-col-resize z-10"
            style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
            onMouseDown={handleMouseDown}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center shadow-md">
              <ArrowRight className="w-3 h-3 -rotate-180" />
              <ArrowRight className="w-3 h-3" />
            </div>
          </div>
          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
            Rev {comparison.revision1.revisionNumber}
          </div>
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
            Rev {comparison.revision2.revisionNumber}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RevisionCompareDialog({
  documentId,
  revisions,
  open,
  onOpenChange,
}: RevisionCompareDialogProps) {
  const [rev1Id, setRev1Id] = useState("");
  const [rev2Id, setRev2Id] = useState("");
  const [viewTab, setViewTab] = useState<ViewTab>("metadata");

  useEffect(() => {
    if (revisions.length >= 2 && !rev1Id && !rev2Id) {
      setRev1Id(revisions[1].id);
      setRev2Id(revisions[0].id);
    } else if (revisions.length === 1 && !rev2Id) {
      setRev2Id(revisions[0].id);
    }
  }, [revisions, rev1Id, rev2Id]);

  const { data: comparison, isLoading } = useQuery<CompareResult>({
    queryKey: ["/api/documents", documentId, "compare", rev1Id, rev2Id],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/compare?rev1=${rev1Id}&rev2=${rev2Id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
    enabled: !!rev1Id && !!rev2Id && rev1Id !== rev2Id,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-revision-compare">
        <DialogHeader>
          <DialogTitle>Compare Revisions</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label>Earlier Revision</Label>
            <Select value={rev1Id} onValueChange={setRev1Id}>
              <SelectTrigger data-testid="select-compare-rev1">
                <SelectValue placeholder="Select revision" />
              </SelectTrigger>
              <SelectContent>
                {revisions.map((r) => (
                  <SelectItem key={r.id} value={r.id} disabled={r.id === rev2Id}>
                    Rev {r.revisionNumber} — {r.sourceType} ({r.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Later Revision</Label>
            <Select value={rev2Id} onValueChange={setRev2Id}>
              <SelectTrigger data-testid="select-compare-rev2">
                <SelectValue placeholder="Select revision" />
              </SelectTrigger>
              <SelectContent>
                {revisions.map((r) => (
                  <SelectItem key={r.id} value={r.id} disabled={r.id === rev1Id}>
                    Rev {r.revisionNumber} — {r.sourceType} ({r.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {comparison && (
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant={viewTab === "metadata" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewTab("metadata")}
              data-testid="button-tab-metadata"
            >
              <FileText className="w-4 h-4 mr-1" /> Metadata
            </Button>
            <Button
              variant={viewTab === "visual" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewTab("visual")}
              data-testid="button-tab-visual"
            >
              <Eye className="w-4 h-4 mr-1" /> Visual Compare
            </Button>
          </div>
        )}

        {rev1Id === rev2Id && rev1Id && (
          <div className="text-center py-4 text-muted-foreground" data-testid="text-same-revision">
            Please select two different revisions to compare.
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {comparison && viewTab === "metadata" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              {comparison.timeBetweenMs !== null && (
                <Badge variant="outline" className="text-xs">
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {formatDuration(comparison.timeBetweenMs)} apart
                </Badge>
              )}
              {comparison.fileSizeDelta !== null && (
                <Badge
                  variant="outline"
                  className={`text-xs ${comparison.fileSizeDelta > 0 ? "text-green-600 border-green-300" : comparison.fileSizeDelta < 0 ? "text-red-600 border-red-300" : ""}`}
                >
                  {comparison.fileSizeDelta > 0 ? <Plus className="w-3 h-3 mr-1" /> : comparison.fileSizeDelta < 0 ? <Minus className="w-3 h-3 mr-1" /> : <Equal className="w-3 h-3 mr-1" />}
                  {formatFileSize(comparison.fileSizeDelta)}
                </Badge>
              )}
              {comparison.checksumMatch !== null && (
                <Badge
                  variant={comparison.checksumMatch ? "default" : "destructive"}
                  className="text-xs"
                >
                  {comparison.checksumMatch ? "Checksum Match" : "Checksum Differs"}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg border">
                <div className="text-sm font-medium mb-2">
                  Revision {comparison.revision1.revisionNumber}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>Source: <span className="text-foreground">{comparison.revision1.sourceType}</span></div>
                  <div>Status: <Badge variant={comparison.revision1.status === "active" ? "default" : "secondary"} className="text-xs ml-1">{comparison.revision1.status}</Badge></div>
                  <div>Date: <span className="text-foreground">{new Date(comparison.revision1.createdAt).toLocaleString()}</span></div>
                  {comparison.revision1.checksum && <div>Checksum: <span className="text-foreground font-mono text-[10px]">{comparison.revision1.checksum.slice(0, 12)}...</span></div>}
                </div>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="text-sm font-medium mb-2">
                  Revision {comparison.revision2.revisionNumber}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>Source: <span className="text-foreground">{comparison.revision2.sourceType}</span></div>
                  <div>Status: <Badge variant={comparison.revision2.status === "active" ? "default" : "secondary"} className="text-xs ml-1">{comparison.revision2.status}</Badge></div>
                  <div>Date: <span className="text-foreground">{new Date(comparison.revision2.createdAt).toLocaleString()}</span></div>
                  {comparison.revision2.checksum && <div>Checksum: <span className="text-foreground font-mono text-[10px]">{comparison.revision2.checksum.slice(0, 12)}...</span></div>}
                </div>
              </div>
            </div>

            {comparison.changes.length > 0 ? (
              <div>
                <div className="text-sm font-medium mb-2">Changes Detected</div>
                <div className="space-y-2">
                  {comparison.changes.map((change, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 p-2 rounded-md text-sm ${
                        change.type === "added"
                          ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                          : change.type === "removed"
                          ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                          : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                      }`}
                      data-testid={`change-row-${change.field}`}
                    >
                      <span className="font-medium min-w-[100px]">{fieldLabels[change.field] || change.field}</span>
                      {change.type === "added" ? (
                        <>
                          <Plus className="w-4 h-4 text-green-600 shrink-0" />
                          <span className="text-green-700 dark:text-green-400">{String(change.to)}</span>
                        </>
                      ) : change.type === "removed" ? (
                        <>
                          <Minus className="w-4 h-4 text-red-600 shrink-0" />
                          <span className="text-red-700 dark:text-red-400 line-through">{String(change.from)}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground">{String(change.from || "—")}</span>
                          <ArrowRight className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="text-amber-700 dark:text-amber-400">{String(change.to || "—")}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground" data-testid="text-no-changes">
                <Equal className="w-5 h-5 mx-auto mb-1" />
                No metadata differences detected between these revisions.
              </div>
            )}
          </div>
        )}

        {comparison && viewTab === "visual" && (
          <VisualComparePanel
            rev1Id={rev1Id}
            rev2Id={rev2Id}
            comparison={comparison}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
