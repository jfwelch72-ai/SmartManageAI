import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrmQuote } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { FileText, Plus, Download, Trash2, FileSignature, Save, FolderOpen, Package, Copy } from "lucide-react";
import { format } from "date-fns";

interface OpportunityLite { id: string; name: string }

interface QuoteWithItems extends CrmQuote {
  lineItems?: { id?: string; description: string; quantity: string | number; unitPrice: string | number; subtotal?: string }[];
}

const STATUS_VARIANTS: Record<string, "outline" | "default" | "secondary" | "destructive"> = {
  DRAFT: "outline",
  SENT: "default",
  ACCEPTED: "secondary",
  REJECTED: "destructive",
  EXPIRED: "outline",
};

export function CrmQuotesView() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QuoteWithItems | null>(null);

  const { data: quotes = [], isLoading } = useQuery<CrmQuote[]>({ queryKey: ["/api/crm/quotes"] });
  const { data: opportunities = [] } = useQuery<OpportunityLite[]>({ queryKey: ["/api/crm/opportunities"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/quotes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
      toast({ title: "Quote deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-crm-quotes">
      <CardHeader className="pb-4 flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" /> Quotes & Proposals
          {!isLoading && <Badge variant="secondary" className="text-xs">{quotes.length}</Badge>}
        </CardTitle>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="button-new-quote">
          <Plus className="w-4 h-4 mr-1" /> New Quote
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No quotes yet"
            description="Build branded proposals you can send as PDFs."
            actionLabel="New Quote"
            onAction={() => { setEditing(null); setDialogOpen(true); }}
            testId="empty-crm-quotes"
          />
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2">Quote #</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Valid Until</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => (
                  <tr key={q.id} className="border-t hover-elevate" data-testid={`row-quote-${q.id}`}>
                    <td className="px-3 py-2 font-mono text-xs">{q.quoteNumber}</td>
                    <td className="px-3 py-2">{q.title}</td>
                    <td className="px-3 py-2"><Badge variant={STATUS_VARIANTS[q.status] || "outline"}>{q.status}</Badge></td>
                    <td className="px-3 py-2 text-right font-mono">${Number(q.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{q.validUntil ? format(new Date(q.validUntil), "MMM d, yyyy") : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="sm" asChild data-testid={`button-quote-pdf-${q.id}`}>
                          <a href={`/api/crm/quotes/${q.id}/pdf`} target="_blank" rel="noopener noreferrer"><Download className="w-4 h-4" /></a>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={async () => {
                          const res = await fetch(`/api/crm/quotes/${q.id}`, { credentials: "include" });
                          if (res.ok) { setEditing(await res.json()); setDialogOpen(true); }
                        }} data-testid={`button-edit-quote-${q.id}`}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(q.id)} data-testid={`button-delete-quote-${q.id}`}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <QuoteDialog open={dialogOpen} onOpenChange={setDialogOpen} quote={editing} opportunities={opportunities} />
    </Card>
  );
}

interface LineItemDraft { description: string; quantity: number; unitPrice: number }

function QuoteDialog({ open, onOpenChange, quote, opportunities }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  quote: QuoteWithItems | null;
  opportunities: OpportunityLite[];
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([{ description: "", quantity: 1, unitPrice: 0 }]);

  useEffect(() => {
    if (open) {
      setTitle(quote?.title ?? "");
      setOpportunityId(quote?.opportunityId ?? "");
      setValidUntil(quote?.validUntil ? format(new Date(quote.validUntil), "yyyy-MM-dd") : format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd"));
      setTaxRate(String(quote?.taxRate ?? 0));
      setDiscountAmount(String(quote?.discountAmount ?? 0));
      setNotes(quote?.notes ?? "");
      setTerms(quote?.terms ?? "");
      setItems(
        quote?.lineItems && quote.lineItems.length > 0
          ? quote.lineItems.map(li => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }))
          : [{ description: "", quantity: 1, unitPrice: 0 }]
      );
    }
  }, [open, quote?.id]);

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discount = Number(discountAmount) || 0;
  const tax = (subtotal - discount) * (Number(taxRate) || 0) / 100;
  const total = subtotal - discount + tax;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        opportunityId: opportunityId || null,
        validUntil,
        taxRate: Number(taxRate) || 0,
        discountAmount: Number(discountAmount) || 0,
        notes: notes || null,
        terms: terms || null,
        lineItems: items.filter(i => i.description.trim()).map((i, idx) => ({
          description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, sortOrder: idx,
        })),
      };
      if (quote) return apiRequest("PATCH", `/api/crm/quotes/${quote.id}`, body);
      return apiRequest("POST", "/api/crm/quotes", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
      toast({ title: quote ? "Quote updated" : "Quote created" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-quote-editor">
        <DialogHeader><DialogTitle>{quote ? `Edit Quote ${quote.quoteNumber}` : "New Quote"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-quote-title" />
            </div>
            <div>
              <Label>Opportunity</Label>
              <Select value={opportunityId || "_none"} onValueChange={(v) => setOpportunityId(v === "_none" ? "" : v)}>
                <SelectTrigger data-testid="select-quote-opportunity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {opportunities.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Line Items</Label>
            <div className="space-y-2 mt-1">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-line-${idx}`}>
                  <Input className="col-span-6" placeholder="Description" value={it.description}
                    onChange={(e) => setItems(arr => arr.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                    data-testid={`input-line-desc-${idx}`} />
                  <Input className="col-span-2" type="number" step="0.01" placeholder="Qty" value={it.quantity}
                    onChange={(e) => setItems(arr => arr.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))}
                    data-testid={`input-line-qty-${idx}`} />
                  <Input className="col-span-3" type="number" step="0.01" placeholder="Unit Price" value={it.unitPrice}
                    onChange={(e) => setItems(arr => arr.map((x, i) => i === idx ? { ...x, unitPrice: Number(e.target.value) } : x))}
                    data-testid={`input-line-price-${idx}`} />
                  <Button variant="ghost" size="sm" className="col-span-1" onClick={() => setItems(arr => arr.filter((_, i) => i !== idx))} data-testid={`button-remove-line-${idx}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setItems(arr => [...arr, { description: "", quantity: 1, unitPrice: 0 }])} data-testid="button-add-line">
              <Plus className="w-4 h-4 mr-1" /> Add Line
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Tax %</Label>
              <Input type="number" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} data-testid="input-quote-tax" />
            </div>
            <div>
              <Label>Discount $</Label>
              <Input type="number" step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} data-testid="input-quote-discount" />
            </div>
            <div className="col-span-2">
              <Label>Valid Until</Label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} data-testid="input-quote-valid" />
            </div>
          </div>

          <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1" data-testid="totals-preview">
            <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">${subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Discount</span><span className="font-mono">-${discount.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span className="font-mono">${tax.toFixed(2)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total</span><span className="font-mono">${total.toFixed(2)}</span></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="input-quote-notes" />
            </div>
            <div>
              <Label>Terms & Conditions</Label>
              <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} data-testid="input-quote-terms" />
            </div>
          </div>
        </div>
        <QuoteTemplateAndCatalogActions
          quote={quote}
          title={title}
          taxRate={taxRate}
          discountAmount={discountAmount}
          notes={notes}
          terms={terms}
          items={items}
          onApplyTemplate={(t) => {
            setTitle(t.title || title);
            setTaxRate(String(t.taxRate ?? taxRate));
            setDiscountAmount(String(t.discountAmount ?? discountAmount));
            setNotes(t.notes ?? notes);
            setTerms(t.terms ?? terms);
            if (Array.isArray(t.lineItems) && t.lineItems.length > 0) {
              setItems(t.lineItems.map((li: any) => ({ description: li.description, quantity: Number(li.quantity ?? 1), unitPrice: Number(li.unitPrice ?? 0) })));
            }
          }}
          onAddCatalogItem={(c) => setItems(arr => [...arr.filter(i => i.description.trim()), { description: c.name, quantity: 1, unitPrice: Number(c.unitPrice ?? 0) }])}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-quote-cancel">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!title || saveMutation.isPending} data-testid="button-quote-save">
            {saveMutation.isPending ? "Saving..." : quote ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CatalogItem { id: string; name: string; description?: string | null; unitPrice: string | number; sku?: string | null }
interface QuoteTemplate { id: string; name: string; title: string | null; taxRate: string | number | null; discountAmount: string | number | null; notes: string | null; terms: string | null; lineItems?: any[] }

function QuoteTemplateAndCatalogActions({ quote, title, taxRate, discountAmount, notes, terms, items, onApplyTemplate, onAddCatalogItem }: {
  quote: QuoteWithItems | null;
  title: string; taxRate: string; discountAmount: string; notes: string; terms: string;
  items: LineItemDraft[];
  onApplyTemplate: (t: QuoteTemplate) => void;
  onAddCatalogItem: (c: CatalogItem) => void;
}) {
  const { toast } = useToast();
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [signatureLink, setSignatureLink] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const { data: templates = [] } = useQuery<QuoteTemplate[]>({ queryKey: ["/api/crm/quote-templates"], enabled: showTemplates });
  const { data: catalog = [] } = useQuery<CatalogItem[]>({ queryKey: ["/api/crm/catalog-items"], enabled: showCatalog });

  const sendForSig = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/crm/quotes/${quote!.id}/send-for-acceptance`, {}),
    onSuccess: async (res: any) => {
      const data = await res.json();
      const link = `${window.location.origin}/quotes/accept/${data.token}`;
      setSignatureLink(link);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
      toast({ title: "Signature link generated", description: "Copy and share with the client." });
    },
    onError: (e: Error) => toast({ title: "Failed to generate link", description: e.message, variant: "destructive" }),
  });

  const saveAsTemplate = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/crm/quotes/${quote!.id}/save-as-template`, { name: templateName || `Template — ${title}` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quote-templates"] });
      setSavingTemplate(false);
      setTemplateName("");
      toast({ title: "Saved as template" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="border-t pt-3 mt-1 flex flex-wrap gap-2 items-center">
      <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)} data-testid="button-apply-template">
        <FolderOpen className="w-4 h-4 mr-1" /> Apply Template
      </Button>
      <Button variant="outline" size="sm" onClick={() => setShowCatalog(true)} data-testid="button-add-catalog">
        <Package className="w-4 h-4 mr-1" /> Add from Catalog
      </Button>
      {quote && (
        <>
          <Button variant="outline" size="sm" onClick={() => setSavingTemplate(true)} data-testid="button-save-template">
            <Save className="w-4 h-4 mr-1" /> Save as Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => sendForSig.mutate()} disabled={sendForSig.isPending} data-testid="button-send-signature">
            <FileSignature className="w-4 h-4 mr-1" /> {sendForSig.isPending ? "Generating..." : "Send for Signature"}
          </Button>
        </>
      )}

      {signatureLink && (
        <div className="w-full mt-2 p-2 bg-muted rounded-md flex items-center gap-2 text-xs" data-testid="signature-link-display">
          <Input readOnly value={signatureLink} className="text-xs h-7" />
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(signatureLink); toast({ title: "Copied" }); }} data-testid="button-copy-sig-link">
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent data-testid="dialog-apply-template">
          <DialogHeader><DialogTitle>Apply Template</DialogTitle></DialogHeader>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No templates yet. Save a quote as a template first.</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {templates.map(t => (
                <button key={t.id} className="w-full text-left p-2 rounded hover-elevate border" onClick={() => { onApplyTemplate(t); setShowTemplates(false); toast({ title: "Template applied" }); }} data-testid={`button-template-${t.id}`}>
                  <div className="font-medium text-sm">{t.name}</div>
                  {t.title && <div className="text-xs text-muted-foreground">{t.title}</div>}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCatalog} onOpenChange={setShowCatalog}>
        <DialogContent data-testid="dialog-add-catalog">
          <DialogHeader><DialogTitle>Add from Catalog</DialogTitle></DialogHeader>
          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No catalog items yet. Add some in CRM Settings.</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {catalog.map(c => (
                <button key={c.id} className="w-full text-left p-2 rounded hover-elevate border flex items-center justify-between" onClick={() => { onAddCatalogItem(c); toast({ title: "Item added" }); }} data-testid={`button-catalog-${c.id}`}>
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    {c.sku && <div className="text-xs text-muted-foreground">{c.sku}</div>}
                  </div>
                  <span className="font-mono text-sm">${Number(c.unitPrice).toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={savingTemplate} onOpenChange={setSavingTemplate}>
        <DialogContent data-testid="dialog-save-template">
          <DialogHeader><DialogTitle>Save as Template</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Template Name</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={`Template — ${title}`} data-testid="input-template-name" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavingTemplate(false)} data-testid="button-template-cancel">Cancel</Button>
            <Button onClick={() => saveAsTemplate.mutate()} disabled={saveAsTemplate.isPending} data-testid="button-template-confirm">
              {saveAsTemplate.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
