import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EstimateExcelExportButtonProps {
  estimateId: string;
  disabled?: boolean;
}

/**
 * "Export Excel" trigger that opens a small popover with toggles for
 * the optional sheets in the estimate workbook. Mirrors
 * `EstimatePdfExportButton` so estimators get the same formula
 * breakdown opt-in for spreadsheet exports.
 */
export function EstimateExcelExportButton({
  estimateId,
  disabled,
}: EstimateExcelExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [includeFormulas, setIncludeFormulas] = useState(false);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (includeFormulas) params.set("includeFormulas", "true");
    const qs = params.toString();
    const url = `/api/estimates/${estimateId}/export/excel${qs ? `?${qs}` : ""}`;
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
          data-testid="button-export-estimate-excel"
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export Excel
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Export Estimate as Excel</p>
            <p className="text-xs text-muted-foreground">
              Choose what to include in the spreadsheet.
            </p>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label
                htmlFor="export-excel-include-formulas"
                className="text-sm font-medium"
              >
                Step-by-step formula breakdowns
              </Label>
              <p className="text-xs text-muted-foreground">
                Adds a "Calculation Breakdowns" sheet with the same
                derivations the Material Calculator shows on screen.
              </p>
            </div>
            <Switch
              id="export-excel-include-formulas"
              checked={includeFormulas}
              onCheckedChange={setIncludeFormulas}
              data-testid="switch-export-excel-include-formulas"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={handleExport}
            data-testid="button-export-estimate-excel-confirm"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Download Excel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default EstimateExcelExportButton;
