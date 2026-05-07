import { useState } from "react";
import { FileDown, FileText, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface Props {
  estimateId: string;
  disabled?: boolean;
}

/**
 * Task #2578 — Phase C export menu: branded customer-facing proposal PDF
 * and AIA G703 Schedule of Values workbook.
 */
export function EstimatePhaseCExports({ estimateId, disabled }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  const downloadFile = async (kind: "proposal" | "sov") => {
    if (busy) return;
    setBusy(kind);
    try {
      const path = kind === "proposal"
        ? `/api/estimates/${estimateId}/export/proposal-pdf`
        : `/api/estimates/${estimateId}/export/sov-g703.xlsx`;
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) {
        toast({
          title: "Export failed",
          description: `Server returned ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "proposal" ? `proposal-${estimateId}.pdf` : `sov-g703-${estimateId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !!busy}
          data-testid="button-phase-c-exports"
        >
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Layers className="h-4 w-4 mr-2" />}
          More Exports
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Customer-facing</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => downloadFile("proposal")}
          data-testid="menu-export-proposal-pdf"
        >
          <FileText className="h-4 w-4 mr-2" />
          Branded Proposal (PDF)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Billing</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => downloadFile("sov")}
          data-testid="menu-export-sov-g703"
        >
          <FileDown className="h-4 w-4 mr-2" />
          AIA G703 Schedule of Values (XLSX)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default EstimatePhaseCExports;
