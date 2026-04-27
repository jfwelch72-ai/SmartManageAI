import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EstimatePdfExportButtonProps {
  estimateId: string;
  disabled?: boolean;
}

/**
 * "Export PDF" trigger that opens a small popover with toggles for the
 * optional sections of the estimate PDF. Today the only toggle is
 * "Include step-by-step formula breakdowns", but the popover is the
 * natural home for future export options (cost detail, photos, etc.).
 */
export function EstimatePdfExportButton({
  estimateId,
  disabled,
}: EstimatePdfExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [includeFormulas, setIncludeFormulas] = useState(false);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (includeFormulas) params.set("includeFormulas", "true");
    const qs = params.toString();
    const url = `/api/estimates/${estimateId}/export/pdf${qs ? `?${qs}` : ""}`;
    window.open(url, "_blank");
    setOpen(false);
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
              data-testid="switch-export-include-formulas"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={handleExport}
            data-testid="button-export-estimate-pdf-confirm"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default EstimatePdfExportButton;
