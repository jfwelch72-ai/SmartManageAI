import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, CheckCircle, XCircle, Eye, Ruler } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { ChangeOrder } from "@shared/schema";
import { useCreateChangeOrder, useApproveChangeOrder, useRejectChangeOrder, useRequestApprovalChangeOrder, useSubmitChangeOrder, useReturnToDraftChangeOrder } from "@/hooks/use-data";
import { ChangeOrderFiles } from "@/components/ChangeOrderFiles";
import { ChangeOrderDialog } from "@/components/ChangeOrderDialog";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import AiChangeOrderGenerator from "@/components/AiChangeOrderGenerator";
import { hasManagementAccess } from "@/lib/rbac";

interface ChangeOrdersTabProps {
  changeOrders: ChangeOrder[];
  projectCode: string;
  projectId: string;
  projectName: string;
  isLoading: boolean;
  userRole: string;
}

export default function ChangeOrdersTab({ changeOrders, projectCode, projectId, projectName, isLoading, userRole }: ChangeOrdersTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedChangeOrder, setSelectedChangeOrder] = useState<ChangeOrder | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [changeOrderNumber, setChangeOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [scopeSelection, setScopeSelection] = useState<ScopeSelectionData | null>(null);
  const [scopeQuantity, setScopeQuantity] = useState("");
  const { toast } = useToast();

  const createMutation = useCreateChangeOrder();
  const requestApprovalMutation = useRequestApprovalChangeOrder();
  const approveMutation = useApproveChangeOrder();
  const rejectMutation = useRejectChangeOrder();
  const submitMutation = useSubmitChangeOrder();
  const returnToDraftMutation = useReturnToDraftChangeOrder();

  const handleCreate = async () => {
    if (!changeOrderNumber || !description || !amount) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        projectCode,
        changeOrderNumber,
        description,
        amount,
        workTypeId: scopeSelection?.workTypeId || undefined,
        workTypeCode: scopeSelection?.workTypeCode || undefined,
        workTypeName: scopeSelection?.workTypeName || undefined,
        categoryName: scopeSelection?.categoryName || undefined,
        scopeModifierIds: scopeSelection ? JSON.stringify(scopeSelection.modifierIds || []) : undefined,
        scopeModifierNames: scopeSelection ? JSON.stringify(scopeSelection.modifierNames || []) : undefined,
        canonicalName: scopeSelection?.canonicalName || undefined,
        scopeUnit: scopeSelection?.unit || undefined,
        scopeQuantity: scopeQuantity || undefined,
      });
      toast({ title: "Success", description: "Change order created" });
      setShowCreateDialog(false);
      setChangeOrderNumber("");
      setDescription("");
      setAmount("");
      setScopeSelection(null);
      setScopeQuantity("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to create change order", variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason:");
    if (!reason) return;

    try {
      await rejectMutation.mutateAsync({ id, reason, projectCode });
      toast({ title: "Success", description: "Change order rejected" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    }
  };

  const handleSubmit = async (id: string) => {
    try {
      await submitMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order submitted to client" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to submit", variant: "destructive" });
    }
  };

  const handleReturnToDraft = async (id: string) => {
    const reason = prompt("Reason for returning to draft (optional):");
    
    try {
      await returnToDraftMutation.mutateAsync({ id, reason: reason || undefined, projectCode });
      toast({ title: "Success", description: "Change order returned to draft" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to return to draft", variant: "destructive" });
    }
  };

  const handleRequestApproval = async (id: string) => {
    try {
      await requestApprovalMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order sent for approval" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to request approval", variant: "destructive" });
    }
  };

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle>Change Orders</CardTitle>
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-change-order" className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  New Change Order
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-change-order">
              <DialogHeader>
                <DialogTitle>Create Change Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="co-number">Change Order Number</Label>
                    <Input
                      id="co-number"
                      value={changeOrderNumber}
                      onChange={(e) => setChangeOrderNumber(e.target.value)}
                      placeholder="CO-001"
                      data-testid="input-change-order-number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="co-amount">Amount ($)</Label>
                    <Input
                      id="co-amount"
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="2500.00"
                      data-testid="input-change-order-amount"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter positive for additions or negative for deductions
                    </p>
                  </div>
                </div>

                <Card className="p-4 bg-muted/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Ruler className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Scope of Work (for Production Rate Tracking)</Label>
                  </div>
                  <StandardizedScopeSelector
                    value={scopeSelection || undefined}
                    onChange={setScopeSelection}
                    showDimensionInputs={false}
                  />
                  {scopeSelection && (
                    <div className="mt-3 grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="co-scope-quantity">Quantity</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="co-scope-quantity"
                            type="number"
                            step="0.01"
                            value={scopeQuantity}
                            onChange={(e) => setScopeQuantity(e.target.value)}
                            placeholder="0"
                            data-testid="input-co-scope-quantity"
                          />
                          <span className="text-sm text-muted-foreground whitespace-nowrap">{scopeSelection.unit}</span>
                        </div>
                      </div>
                      <div className="flex items-end">
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">Selected:</span> {scopeSelection.canonicalName}
                        </div>
                      </div>
                    </div>
                  )}
                  {!scopeSelection && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Select a work type to enable production rate tracking for this change order.
                    </p>
                  )}
                </Card>

                <div>
                  <Label htmlFor="co-description">Description</Label>
                  <Textarea
                    id="co-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the change..."
                    data-testid="input-change-order-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-change-order"
                >
                  {createMutation.isPending ? "Creating..." : "Create Change Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading change orders...</div>
          ) : changeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders yet</div>
          ) : (
            <div className="space-y-3">
              {changeOrders.map((co) => (
                <Card key={co.id} data-testid={`change-order-${co.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-mono">{co.changeOrderNumber}</Badge>
                          <Badge
                            variant={
                              co.status === "APPROVED" ? "default" :
                              co.status === "REJECTED" ? "destructive" :
                              co.status === "SUBMITTED" ? "secondary" :
                              "outline"
                            }
                          >
                            {co.status?.replace("_", " ")}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedChangeOrder(co);
                              setShowViewDialog(true);
                            }}
                            data-testid={`button-view-change-order-${co.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View Details
                          </Button>
                        </div>
                        <p className="font-medium mb-1">{co.description}</p>
                        <p className="text-sm text-muted-foreground">
                          Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                        </p>
                        {co.rejectionReason && (
                          <p className="text-sm text-destructive mt-2">
                            Rejected: {co.rejectionReason}
                          </p>
                        )}
                        
                        <ChangeOrderFiles changeOrderId={co.id} />
                      </div>
                      <div className="text-right">
                        {hasManagementAccess(userRole) && (
                          <>
                            <p className={`text-xl font-bold font-mono ${parseFloat(co.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>
                              {parseFloat(co.amount) >= 0 ? '+' : ''}${parseFloat(co.amount).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {parseFloat(co.amount) >= 0 ? 'Addition' : 'Deduction'}
                            </p>
                          </>
                        )}
                        {canManage && co.status === "DRAFT" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleSubmit(co.id)}
                              disabled={submitMutation.isPending}
                              data-testid={`button-submit-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Submit to Client
                            </Button>
                          </div>
                        )}
                        {canManage && co.status === "SUBMITTED" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(co.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(co.id)}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${co.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div className="mt-6">
          <AiChangeOrderGenerator
            projectId={projectId}
            projectName={projectName}
            onCreateChangeOrder={(draft) => {
              setChangeOrderNumber(`CO-${Date.now().toString().slice(-4)}`);
              setAmount(draft.suggestedAmount.toString());
              setDescription(draft.aiGeneratedDescription);
              setShowCreateDialog(true);
            }}
          />
        </div>
      )}

      <ChangeOrderDialog
        changeOrder={selectedChangeOrder}
        open={showViewDialog}
        onOpenChange={(open) => {
          setShowViewDialog(open);
          if (!open) setSelectedChangeOrder(null);
        }}
        projectCode={projectCode}
        userRole={userRole}
      />
    </>
  );
}
