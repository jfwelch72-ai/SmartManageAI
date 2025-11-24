import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Link2 } from "lucide-react";

interface ScopeItem {
  id: string;
  description: string;
  unit: string;
  totalQuantity: number;
  completedQuantity: number;
  sourceEstimate?: {
    id: string;
    name: string;
    status: string;
  } | null;
}

interface ScopeOfWorkTableProps {
  items: ScopeItem[];
  onUpdateProgress?: (itemId: string, completed: number) => void;
  readOnly?: boolean;
}

export default function ScopeOfWorkTable({ items, onUpdateProgress, readOnly = false }: ScopeOfWorkTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleSave = (itemId: string) => {
    const value = parseFloat(editValue);
    if (!isNaN(value) && onUpdateProgress) {
      onUpdateProgress(itemId, value);
    }
    setEditingId(null);
    setEditValue("");
  };

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-semibold">Item Description</TableHead>
              <TableHead className="font-semibold">Source</TableHead>
              <TableHead className="font-semibold">Unit</TableHead>
              <TableHead className="font-semibold text-right">Total Qty</TableHead>
              <TableHead className="font-semibold text-right">Completed</TableHead>
              <TableHead className="font-semibold">Progress</TableHead>
              {!readOnly && <TableHead className="font-semibold">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const progressPercent = (item.completedQuantity / item.totalQuantity) * 100;
              const isEditing = editingId === item.id;

              return (
                <TableRow key={item.id} data-testid={`row-scope-${item.id}`}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell>
                    {item.sourceEstimate ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="gap-1" data-testid={`badge-estimate-${item.id}`}>
                            <Link2 className="h-3 w-3" />
                            <span className="text-xs">Estimate</span>
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs space-y-1">
                            <div className="font-semibold">{item.sourceEstimate.name}</div>
                            <div className="text-muted-foreground">Status: {item.sourceEstimate.status}</div>
                            <div className="text-muted-foreground">Synced from estimate line item</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="outline" className="gap-1" data-testid={`badge-manual-${item.id}`}>
                        <FileText className="h-3 w-3" />
                        <span className="text-xs">Manual</span>
                      </Badge>
                    )}
                  </TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-right font-mono">{item.totalQuantity.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-24 text-right font-mono"
                      autoFocus
                      data-testid={`input-completed-${item.id}`}
                    />
                  ) : (
                    <span className="font-mono">{item.completedQuantity.toLocaleString()}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={progressPercent} className="flex-1" />
                    <span className="text-xs text-muted-foreground font-mono w-12 text-right">
                      {Math.round(progressPercent)}%
                    </span>
                  </div>
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleSave(item.id)}
                          data-testid={`button-save-${item.id}`}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                            setEditValue("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditValue(item.completedQuantity.toString());
                        }}
                        data-testid={`button-update-${item.id}`}
                      >
                        Update
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
    </TooltipProvider>
  );
}
