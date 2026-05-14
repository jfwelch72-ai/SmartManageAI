import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Send, AlertTriangle, FileText, Loader2, Paperclip, X } from "lucide-react";

interface RfqInfo {
  quoteId: string;
  bidName: string;
  gcOrganizationName: string;
  scopeOfWork: string;
  subcontractorName: string;
  dueDate: string | null;
  alreadyResponded: boolean;
}

export default function RfqResponsePage() {
  const { token } = useParams<{ token: string }>();
  const [rfqInfo, setRfqInfo] = useState<RfqInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    quoteAmount: "",
    leadTime: "",
    notes: "",
    contactName: "",
    contactPhone: "",
  });
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadRfq() {
      try {
        const res = await fetch(`/api/public/rfq-response/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Invalid or expired RFQ link");
          return;
        }
        const data = await res.json();
        setRfqInfo(data);
        if (data.alreadyResponded) {
          setSubmitted(true);
        }
      } catch {
        setError("Failed to load RFQ details");
      } finally {
        setLoading(false);
      }
    }
    if (token) loadRfq();
  }, [token]);

  const handleSubmit = async () => {
    if (!form.quoteAmount || isNaN(parseFloat(form.quoteAmount))) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("quoteAmount", form.quoteAmount);
      if (form.leadTime) formData.append("leadTime", form.leadTime);
      if (form.notes) formData.append("notes", form.notes);
      if (form.contactName) formData.append("contactName", form.contactName);
      if (form.contactPhone) formData.append("contactPhone", form.contactPhone);
      attachments.forEach(file => formData.append("attachments", file));

      const res = await fetch(`/api/public/rfq-response/${token}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to submit quote");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Failed to submit quote");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setAttachments(prev => [...prev, ...newFiles]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
            <h2 className="text-lg font-semibold mb-2">Unable to Load RFQ</h2>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h2 className="text-lg font-semibold mb-2" data-testid="text-rfq-success">Quote Submitted</h2>
            <p className="text-muted-foreground">
              Your quote has been submitted to {rfqInfo?.gcOrganizationName}. They will review and follow up.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <FileText className="h-10 w-10 mx-auto mb-3 text-indigo-600" />
          <h1 className="text-2xl font-bold" data-testid="text-rfq-title">Request for Quote</h1>
          <p className="text-muted-foreground mt-1">from {rfqInfo?.gcOrganizationName}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base" data-testid="text-rfq-bid-name">{rfqInfo?.bidName}</CardTitle>
            <CardDescription>
              {rfqInfo?.subcontractorName}
              {rfqInfo?.dueDate && (
                <span className="ml-2">
                  <Badge variant="outline" className="text-xs" data-testid="badge-rfq-due">
                    Due: {new Date(rfqInfo.dueDate).toLocaleDateString()}
                  </Badge>
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Label className="text-xs text-muted-foreground">Scope of Work</Label>
              <p className="text-sm mt-1 whitespace-pre-wrap" data-testid="text-rfq-scope">{rfqInfo?.scopeOfWork}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit Your Quote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="quoteAmount">Quote Amount ($) *</Label>
              <Input
                id="quoteAmount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.quoteAmount}
                onChange={e => setForm(f => ({ ...f, quoteAmount: e.target.value }))}
                data-testid="input-rfq-amount"
              />
            </div>
            <div>
              <Label htmlFor="leadTime">Lead Time</Label>
              <Input
                id="leadTime"
                placeholder='e.g., "2 weeks", "30 days"'
                value={form.leadTime}
                onChange={e => setForm(f => ({ ...f, leadTime: e.target.value }))}
                data-testid="input-rfq-lead-time"
              />
            </div>
            <div>
              <Label htmlFor="contactName">Your Name</Label>
              <Input
                id="contactName"
                placeholder="Contact name"
                value={form.contactName}
                onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                data-testid="input-rfq-contact-name"
              />
            </div>
            <div>
              <Label htmlFor="contactPhone">Phone Number</Label>
              <Input
                id="contactPhone"
                placeholder="(555) 555-5555"
                value={form.contactPhone}
                onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                data-testid="input-rfq-contact-phone"
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes / Comments</Label>
              <Textarea
                id="notes"
                placeholder="Any additional details, exclusions, or conditions..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                data-testid="input-rfq-notes"
              />
            </div>
            <div>
              <Label>Attachments</Label>
              <div className="mt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-rfq-attachments"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-add-attachment"
                >
                  <Paperclip className="h-4 w-4 mr-2" />
                  Add Files
                </Button>
                {attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {attachments.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-2 py-1">
                        <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {(file.size / 1024).toFixed(0)}KB
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="text-muted-foreground hover:text-red-500"
                          data-testid={`button-remove-attachment-${idx}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={!form.quoteAmount || submitting}
              data-testid="button-submit-rfq-response"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {submitting ? "Submitting..." : "Submit Quote"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
