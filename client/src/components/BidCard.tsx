import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, MapPin, DollarSign, Calendar, FileText, CheckCircle, Trash2, Award } from "lucide-react";

interface BidCardProps {
  code: string;
  name: string;
  clientName: string;
  bidAmount?: string;
  dueDate?: string;
  location?: string;
  estimator: string;
  status?: "ACTIVE" | "AWARDED" | "LOST" | "CANCELLED";
  onClick?: () => void;
  onConvertToProject?: () => void;
  onDelete?: () => void;
  estimateData?: {
    totalCost: number;
    lineItemCount: number;
    status: string;
  } | null;
}

export default function BidCard({
  code,
  name,
  clientName,
  bidAmount,
  dueDate,
  location,
  estimator,
  status = "ACTIVE",
  onClick,
  onConvertToProject,
  onDelete,
  estimateData,
}: BidCardProps) {
  const isAwarded = status === "AWARDED";
  
  return (
    <Card
      className={`p-6 hover-elevate cursor-pointer ${isAwarded ? "border-green-500/50 bg-green-50/30 dark:bg-green-900/10" : ""}`}
      onClick={onClick}
      data-testid={`card-bid-${code}`}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {code}
              </Badge>
              {isAwarded ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1">
                  <Award className="w-3 h-3" />
                  AWARDED
                </Badge>
              ) : (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  BID
                </Badge>
              )}
            </div>
            <h3 className="text-lg font-semibold text-card-foreground truncate mb-1">
              {name}
            </h3>
          </div>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{clientName}</span>
          </div>
          
          {location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0" />
              <span className="truncate">{location}</span>
            </div>
          )}
          
          {bidAmount && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="w-4 h-4 shrink-0" />
              <span className="font-mono font-medium">{bidAmount}</span>
            </div>
          )}
          
          {dueDate && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4 shrink-0" />
              <span>Due: {dueDate}</span>
            </div>
          )}
          
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">Estimator: {estimator}</p>
          </div>
        </div>

        {estimateData && (
          <div className="p-3 bg-primary/5 rounded-md border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Estimate</span>
              </div>
              {estimateData.status === "APPROVED" && (
                <Badge variant="default" className="text-xs gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Approved
                </Badge>
              )}
              {estimateData.status === "DRAFT" && (
                <Badge variant="secondary" className="text-xs">
                  Draft
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Total Cost</p>
                <p className="font-mono font-semibold text-foreground" data-testid={`text-estimate-cost-${code}`}>
                  ${estimateData.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Line Items</p>
                <p className="font-semibold text-foreground" data-testid={`text-estimate-items-${code}`}>
                  {estimateData.lineItemCount}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {onConvertToProject && !isAwarded && (
            <Button
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onConvertToProject();
              }}
              data-testid={`button-convert-${code}`}
            >
              Mark as Awarded
            </Button>
          )}
          {onDelete && !isAwarded && (
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              data-testid={`button-delete-bid-${code}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
