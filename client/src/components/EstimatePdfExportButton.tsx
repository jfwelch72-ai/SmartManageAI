import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useExportIncludeFormulas } from "@/hooks/use-export-include-formulas";

interface EstimatePdfExportButtonProps {
  estimateId: string;
  disabled?: boolean;
}

/**
 * "Export PDF" trigger that opens a small popover with toggles for the
 * optional sections of the estimate PDF. Today the only toggle is
 * "Include step-by-step formula breakdowns", but the popover is the
 * natural home for future export options (cost detail, photos, etc.).
 *
 * The download is fetched in-page (instead of `window.open`) so that
 * non-2xx responses surface as a toast and the popover stays open for
 * the user to retry — rather than leaving them with a blank tab when
 * the server returns 403/404/500.
 */
export function EstimatePdfExportButton({
  estimateId,
  disabled,
}: EstimatePdfExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [includeFormulas, setIncludeFormulas] = useExportIncludeFormulas();
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const filenameFromContentDisposition = (
    header: string | null,
  ): string | undefined => {
    if (!header) return undefined;
    const match =
      /filename\*=UTF-8''([^;\n]+)/i.exec(header) ||
      /filename="?([^";\n]+)"?/i.exec(header);
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  };

  const handleExport = async () => {
    if (isExporting) return;
    const params = new URLSearchParams();
    if (includeFormulas) params.set("includeFormulas", "true");
    const qs = params.toString();
    const url = `/api/estimates/${estimateId}/export/pdf${qs ? `?${qs}` : ""}`;

    setIsExporting(true);
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let detail: string | undefined;
        try {
          const body = await res.clone().json();
          if (body && typeof body.error === "string") detail = body.error;
        } catch {
          /* non-JSON error body — fall back to status */
        }
        throw new Error(detail || `Server responded with ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download =
        filenameFromContentDisposition(res.headers.get("Content-Disposition")) ||
        `estimate-${estimateId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't generate PDF",
        description:
          err instanceof Error
            ? `${err.message}. Please try again.`
            : "Please try again.",
        variant: "destructive",
      });
      // Leave the popover open so the user can retry without re-toggling
      // their export settings.
      setOpen(true);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          data-testid="button-export-estimate-pdf"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export PDF
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Export Estimate as PDF</p>
            <p className="text-xs text-muted-foreground">
              Choose what to include in the printable estimate.
            </p>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label
                htmlFor="export-include-formulas"
                className="text-sm font-medium"
              >
                Step-by-step formula breakdowns
              </Label>
              <p className="text-xs text-muted-foreground">
                Same derivations the Material Calculator shows on screen.
              </p>
            </div>
            <Switch
              id="export-include-formulas"
              checked={includeFormulas}
              onCheckedChange={setIncludeFormulas}
              disabled={isExporting}
              data-testid="switch-export-include-formulas"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={handleExport}
            disabled={isExporting}
            data-testid="button-export-estimate-pdf-confirm"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            {isExporting ? "Generating…" : "Download PDF"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default EstimatePdfExportButton;
