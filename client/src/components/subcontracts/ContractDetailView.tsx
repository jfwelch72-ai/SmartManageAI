import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Building2, DollarSign, FileText, Calendar, CheckCircle2, Clock, XCircle, Download, Edit, Trash2, ListOrdered, FileSignature, Shield, BarChart3, Loader2, Paperclip, History } from "lucide-react";
import { format } from "date-fns";
import { SubcontractScopeTab } from "./SubcontractScopeTab";
import { SubPayApplicationsTab } from "./SubPayApplicationsTab";
import { RetentionTab } from "./RetentionTab";
import { PerformanceTab } from "./PerformanceTab";
import { DocumentsTab } from "./DocumentsTab";
import { RevisionHistoryTab } from "./RevisionHistoryTab";
import { useState } from "react";

interface SubcontractorContract {
  id: string;
  projectId: string;
  subcontractorId: string;
  contractNumber: string;
  scopeOfWork: string;
  contractAmount: string;
  startDate: string | null;
  completionDate: string | null;
  status: string;
  paymentTerms: string | null;
  retentionPercent: string | null;
  notes: string | null;
  costCode: string | null;
  billingFrequency?: string;
  paymentDueDays?: number;
  earlyPayDiscount?: string | null;
  lienWaiverRequired?: boolean;
  createdAt: string;
  project: { code: string; name: string };
  subcontractor: { id: string; companyName?: string; name?: string };
}

interface ContractDetailViewProps {
  contract: SubcontractorContract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
  onDownloadPDF: (withSignatures: boolean) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}

export function ContractDetailView({
  contract, open, onOpenChange, canEdit, canDelete, onEdit, onDelete, onStatusChange, onDownloadPDF, isUpdating, isDeleting
}: ContractDetailViewProps) {
  const [detailTab, setDetailTab] = useState("overview");

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING": return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "ACTIVE": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>;
      case "COMPLETED": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
      case "TERMINATED": return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Terminated</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const fmt = (v: string | null) => {
    if (!v) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(v));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {contract.contractNumber}
            {getStatusBadge(contract.status)}
          </DialogTitle>
          <DialogDescription>
            {contract.project.code} - {contract.project.name} | {contract.subcontractor?.name || contract.subcontractor?.companyName || "Unknown"}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={detailTab} onValueChange={setDetailTab} data-testid="tabs-contract-detail">
          <TabsList className="grid grid-cols-7 w-full">
            <TabsTrigger value="overview" data-testid="tab-detail-overview">
              <FileSignature className="h-3 w-3 mr-1" />Overview
            </TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-detail-scope">
              <ListOrdered className="h-3 w-3 mr-1" />Scope
            </TabsTrigger>
            <TabsTrigger value="pay-apps" data-testid="tab-detail-pay-apps">
              <FileText className="h-3 w-3 mr-1" />Pay Apps
            </TabsTrigger>
            <TabsTrigger value="retention" data-testid="tab-detail-retention">
              <Shield className="h-3 w-3 mr-1" />Retention
            </TabsTrigger>
            <TabsTrigger value="performance" data-testid="tab-detail-performance">
              <BarChart3 className="h-3 w-3 mr-1" />Performance
            </TabsTrigger>
            <TabsTrigger value="documents" data-testid="tab-detail-documents">
              <Paperclip className="h-3 w-3 mr-1" />Docs
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-detail-history">
              <History className="h-3 w-3 mr-1" />History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><Building2 className="h-4 w-4" />Subcontractor</CardTitle></CardHeader>
                <CardContent><p className="font-medium">{contract.subcontractor?.name || contract.subcontractor?.companyName || "Unknown"}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><DollarSign className="h-4 w-4" />Contract Value</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{fmt(contract.contractAmount)}</p>
                  {contract.retentionPercent && <p className="text-sm text-muted-foreground">{contract.retentionPercent}% retention</p>}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Scope of Work</CardTitle></CardHeader>
              <CardContent><p className="text-sm whitespace-pre-wrap">{contract.scopeOfWork}</p></CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              {contract.startDate && (
                <div className="flex items-center gap-2 text-sm"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Start:</span><span>{format(new Date(contract.startDate), "MMM d, yyyy")}</span></div>
              )}
              {contract.completionDate && (
                <div className="flex items-center gap-2 text-sm"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Completion:</span><span>{format(new Date(contract.completionDate), "MMM d, yyyy")}</span></div>
              )}
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Payment Terms</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Billing: </span><span className="font-medium">{contract.billingFrequency || "Monthly"}</span></div>
                  <div><span className="text-muted-foreground">Due: </span><span className="font-medium">Net {contract.paymentDueDays || 30}</span></div>
                  <div><span className="text-muted-foreground">Early Discount: </span><span className="font-medium">{contract.earlyPayDiscount ? `${contract.earlyPayDiscount}%` : "None"}</span></div>
                  <div><span className="text-muted-foreground">Lien Waiver: </span><span className="font-medium">{contract.lienWaiverRequired ? "Required" : "Not Required"}</span></div>
                </div>
                {contract.paymentTerms && <p className="mt-2 text-sm text-muted-foreground">{contract.paymentTerms}</p>}
              </CardContent>
            </Card>

            {contract.costCode && <div className="text-sm"><span className="text-muted-foreground">Cost Code:</span> <span className="font-medium">{contract.costCode}</span></div>}
            {contract.notes && (
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{contract.notes}</p></CardContent></Card>
            )}

            <div className="flex items-center justify-between gap-4 pt-4 border-t flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {canEdit && contract.status === "PENDING" && (
                  <Button onClick={() => onStatusChange("ACTIVE")} disabled={isUpdating} data-testid="button-activate-contract">
                    <CheckCircle2 className="h-4 w-4 mr-2" />Activate
                  </Button>
                )}
                {canEdit && contract.status === "ACTIVE" && (
                  <Button onClick={() => onStatusChange("COMPLETED")} disabled={isUpdating} data-testid="button-complete-contract">
                    <CheckCircle2 className="h-4 w-4 mr-2" />Mark Complete
                  </Button>
                )}
                {canEdit && <Button variant="outline" onClick={onEdit} data-testid="button-edit-contract"><Edit className="h-4 w-4 mr-2" />Edit</Button>}
                {canDelete && (
                  <Button variant="destructive" onClick={onDelete} disabled={isDeleting} data-testid="button-delete-contract">
                    <Trash2 className="h-4 w-4 mr-2" />Delete
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => onDownloadPDF(false)} data-testid="button-download-pdf-no-sig">
                  <Download className="h-4 w-4 mr-2" />PDF (No Sig)
                </Button>
                <Button onClick={() => onDownloadPDF(true)} data-testid="button-download-pdf">
                  <Download className="h-4 w-4 mr-2" />Download PDF
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="scope" className="mt-4">
            <SubcontractScopeTab contractId={contract.id} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="pay-apps" className="mt-4">
            <SubPayApplicationsTab contractId={contract.id} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="retention" className="mt-4">
            <RetentionTab contractId={contract.id} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <PerformanceTab contractId={contract.id} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <DocumentsTab contractId={contract.id} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <RevisionHistoryTab contractId={contract.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
