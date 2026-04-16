import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Calendar as CalendarIcon, Package, Receipt, Truck, CheckCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectReceipts } from "@/hooks/use-data";
import type { PODeliveryReceipt } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { Project } from "@shared/schema";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";

interface ReceiptsTabProps {
  projectCode: string;
  project: Project;
}

export default function ReceiptsTab({ projectCode, project }: ReceiptsTabProps) {
  const { toast } = useToast();
  const { data: receiptsData, isLoading: receiptsLoading } = useProjectReceipts(projectCode);

  const expenseReceipts = receiptsData?.expenseReceipts ?? [];
  const deliveryReceipts = receiptsData?.deliveryReceipts ?? [];

  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptVendor, setReceiptVendor] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptCategory, setReceiptCategory] = useState("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [receiptCostCode, setReceiptCostCode] = useState("");
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  const handleReceiptUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingReceipt(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/receipts", {
        projectId: project?.id,
        vendor: receiptVendor,
        amount: receiptAmount,
        category: receiptCategory,
        costCode: receiptCostCode || null,
        date: new Date(receiptDate).toISOString(),
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "receipts"] });
      toast({ title: "Success", description: "Receipt uploaded successfully" });
      setShowReceiptDialog(false);
      setReceiptVendor("");
      setReceiptAmount("");
      setReceiptCategory("");
      setReceiptCostCode("");
      setReceiptDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to save receipt", variant: "destructive" });
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const totalCount = expenseReceipts.length + deliveryReceipts.length;

  const statusBadge = (status: string) => {
    switch (status) {
      case "COMPLETE": return <Badge variant="default" className="text-xs"><CheckCircle className="h-3 w-3 mr-1" />Complete</Badge>;
      case "PARTIAL": return <Badge variant="secondary" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Partial</Badge>;
      default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const conditionBadge = (condition: string) => {
    switch (condition) {
      case "GOOD": return <Badge variant="default" className="text-xs bg-green-600">Good</Badge>;
      case "DAMAGED": return <Badge variant="destructive" className="text-xs">Damaged</Badge>;
      case "PARTIAL": return <Badge variant="secondary" className="text-xs">Partial</Badge>;
      default: return <Badge variant="outline" className="text-xs">{condition}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Receipts</CardTitle>
          {totalCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {deliveryReceipts.length} delivery receipt{deliveryReceipts.length !== 1 ? "s" : ""}
              {expenseReceipts.length > 0 && `, ${expenseReceipts.length} expense receipt${expenseReceipts.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-upload-receipt">
              <Upload className="w-4 h-4 mr-2" />
              Upload Receipt
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-upload-receipt">
            <DialogHeader>
              <DialogTitle>Upload Receipt</DialogTitle>
              <DialogDescription>
                Fill in the details below and then select a file to upload.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="receipt-vendor">Vendor</Label>
                <Input
                  id="receipt-vendor"
                  value={receiptVendor}
                  onChange={(e) => setReceiptVendor(e.target.value)}
                  placeholder="Enter vendor name..."
                  data-testid="input-receipt-vendor"
                />
              </div>
              <div>
                <Label htmlFor="receipt-amount">Amount ($)</Label>
                <Input
                  id="receipt-amount"
                  type="number"
                  step="0.01"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-receipt-amount"
                />
              </div>
              <div>
                <Label htmlFor="receipt-category">Category</Label>
                <Input
                  id="receipt-category"
                  value={receiptCategory}
                  onChange={(e) => setReceiptCategory(e.target.value)}
                  placeholder="Enter category..."
                  data-testid="input-receipt-category"
                />
              </div>
              <div>
                <Label>Cost Code</Label>
                <CostCodeCombobox
                  value={receiptCostCode}
                  onChange={setReceiptCostCode}
                  data-testid="select-cost-code-receipt"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt-date">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !receiptDate && "text-muted-foreground"
                      )}
                      data-testid="input-receipt-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {receiptDate ? format(parseISO(receiptDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={receiptDate ? parseISO(receiptDate) : undefined}
                      onSelect={(date) => setReceiptDate(date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowReceiptDialog(false);
                  setReceiptVendor("");
                  setReceiptAmount("");
                  setReceiptCategory("");
                  setReceiptCostCode("");
                  setReceiptDate(format(new Date(), "yyyy-MM-dd"));
                }}
                data-testid="button-cancel-receipt"
              >
                Cancel
              </Button>
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={104857600}
                allowedFileTypes={["image/*", "application/pdf"]}
                fileType="RECEIPT"
                onComplete={(result) => {
                  setIsUploadingReceipt(true);
                  handleReceiptUploadComplete(result);
                }}
                buttonVariant="default"
                buttonClassName="bg-orange-500 hover:bg-orange-600 text-white"
                testId="button-select-receipt-file"
              >
                {isUploadingReceipt ? "Uploading..." : "Select File"}
              </ObjectUploader>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {receiptsLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading receipts...</div>
        ) : totalCount === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No receipts uploaded yet</div>
        ) : (
          <Tabs defaultValue={deliveryReceipts.length > 0 ? "delivery" : "expense"}>
            <TabsList className="mb-4">
              <TabsTrigger value="delivery" data-testid="tab-delivery-receipts">
                <Truck className="h-4 w-4 mr-1" />
                Delivery Receipts ({deliveryReceipts.length})
              </TabsTrigger>
              <TabsTrigger value="expense" data-testid="tab-expense-receipts">
                <Receipt className="h-4 w-4 mr-1" />
                Expense Receipts ({expenseReceipts.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="delivery">
              {deliveryReceipts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No delivery receipts recorded yet</div>
              ) : (
                <div className="space-y-3">
                  {deliveryReceipts.map((receipt: PODeliveryReceipt) => (
                    <div key={receipt.id} className="p-4 border rounded-md space-y-2" data-testid={`delivery-receipt-${receipt.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium text-sm">{receipt.poNumber}</span>
                            {statusBadge(receipt.status)}
                          </div>
                          {receipt.vendorName && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Vendor: {receipt.vendorName}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Received: {format(new Date(receipt.receivedAt), "MMM d, yyyy h:mm a")}
                            {receipt.receivedByName && ` by ${receipt.receivedByName}`}
                          </p>
                          {receipt.deliveryNote && (
                            <p className="text-xs text-muted-foreground mt-0.5">Note: {receipt.deliveryNote}</p>
                          )}
                          {receipt.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5">Notes: {receipt.notes}</p>
                          )}
                        </div>
                      </div>
                      {receipt.items.length > 0 && (
                        <div className="mt-2 border-t pt-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Items Received:</p>
                          <div className="space-y-1">
                            {receipt.items.map((item) => (
                              <div key={item.id} className="flex items-center justify-between text-sm pl-2" data-testid={`delivery-receipt-item-${item.id}`}>
                                <span className="truncate">{item.description || "Item"}</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-muted-foreground">Qty: {item.quantityReceived}</span>
                                  {conditionBadge(item.condition)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="expense">
              {expenseReceipts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No expense receipts uploaded yet</div>
              ) : (
                <div className="space-y-3">
                  {expenseReceipts.map((receipt) => (
                    <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`receipt-${receipt.id}`}>
                      <div className="flex-1">
                        <p className="font-medium mb-1">{receipt.vendor || "Unknown vendor"}</p>
                        <p className="text-sm text-muted-foreground">
                          {receipt.category}
                          {receipt.costCode && <span> · {receipt.costCode}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(receipt.date), "MMM d, yyyy")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold font-mono">
                          ${parseFloat(receipt.amount).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
