import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Upload, Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectReceipts } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { Project } from "@shared/schema";

interface ReceiptsTabProps {
  projectCode: string;
  project: Project;
}

export default function ReceiptsTab({ projectCode, project }: ReceiptsTabProps) {
  const { toast } = useToast();
  const { data: receipts = [], isLoading: receiptsLoading } = useProjectReceipts(projectCode);

  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptVendor, setReceiptVendor] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptCategory, setReceiptCategory] = useState("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

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
      setReceiptDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to save receipt", variant: "destructive" });
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Receipts</CardTitle>
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
                onGetUploadParameters={onGetUploadParameters}
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
        ) : receipts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No receipts uploaded yet</div>
        ) : (
          <div className="space-y-3">
            {receipts.map((receipt) => (
              <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`receipt-${receipt.id}`}>
                <div className="flex-1">
                  <p className="font-medium mb-1">{receipt.vendor || "Unknown vendor"}</p>
                  <p className="text-sm text-muted-foreground">{receipt.category}</p>
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
      </CardContent>
    </Card>
  );
}
