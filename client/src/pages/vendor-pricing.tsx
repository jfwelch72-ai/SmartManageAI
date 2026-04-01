import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import VendorPricingSync from "@/components/VendorPricingSync";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess } from "@/lib/rbac";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Search,
  Upload,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Loader2,
  FileSpreadsheet,
  BarChart3,
  CheckCircle2,
  ArrowUpDown,
  Package,
  Building2,
} from "lucide-react";

interface CatalogItem {
  id: string;
  itemName: string;
  itemCode: string;
  category: string;
  description: string;
  unit: string;
  unitPrice: string;
  minimumOrder: number | null;
  deliveryFee: string | null;
  effectiveQuarter: string;
  leadTimeDays: number | null;
  vendorId: string;
  vendorName: string;
  vendorType: string;
}

interface PriceHistoryEntry {
  quarter: string;
  unitPrice: string;
  leadTimeDays: number | null;
  minimumOrder: number | null;
}

function CatalogSearchPanel() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [compareItems, setCompareItems] = useState<string[]>([]);
  const { toast } = useToast();

  const now = new Date();
  const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  const quarterOptions = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i * 3);
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  });

  const searchParam = searchTerm.length >= 2 ? searchTerm : "";
  const categoryParam = categoryFilter !== "all" ? categoryFilter : "";
  const quarterParam = quarterFilter !== "all" ? quarterFilter : "";

  const { data: results = [], isLoading } = useQuery<CatalogItem[]>({
    queryKey: ["/api/vendor-pricing/search", searchParam, categoryParam, quarterParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchParam) params.set("search", searchParam);
      if (categoryParam) params.set("category", categoryParam);
      if (quarterParam) params.set("quarter", quarterParam);
      const res = await fetch(`/api/vendor-pricing/search?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: searchParam.length >= 2 || categoryParam.length > 0 || quarterParam.length > 0,
  });

  const { data: priceHistory = [] } = useQuery<PriceHistoryEntry[]>({
    queryKey: ["/api/vendor-pricing/history", selectedItem?.itemCode],
    queryFn: async () => {
      const res = await fetch(`/api/vendor-pricing/history/${encodeURIComponent(selectedItem?.itemCode || "")}`, { credentials: "include" });
      if (!res.ok) throw new Error("History fetch failed");
      return res.json();
    },
    enabled: !!selectedItem?.itemCode && historyDialogOpen,
  });

  const categories = [...new Set(results.map(r => r.category).filter(Boolean))];

  const toggleCompare = (itemId: string) => {
    setCompareItems(prev =>
      prev.includes(itemId) ? prev.filter(i => i !== itemId) : prev.length < 4 ? [...prev, itemId] : prev
    );
  };

  const comparedItems = results.filter(r => compareItems.includes(r.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search vendor catalog by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-catalog-search"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40" data-testid="select-catalog-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="Lumber">Lumber</SelectItem>
            <SelectItem value="Concrete">Concrete</SelectItem>
            <SelectItem value="Steel">Steel</SelectItem>
            <SelectItem value="Electrical">Electrical</SelectItem>
            <SelectItem value="Plumbing">Plumbing</SelectItem>
            <SelectItem value="HVAC">HVAC</SelectItem>
            <SelectItem value="Insulation">Insulation</SelectItem>
            <SelectItem value="Roofing">Roofing</SelectItem>
            <SelectItem value="Drywall">Drywall</SelectItem>
            <SelectItem value="Flooring">Flooring</SelectItem>
          </SelectContent>
        </Select>
        <Select value={quarterFilter} onValueChange={setQuarterFilter}>
          <SelectTrigger className="w-36" data-testid="select-catalog-quarter">
            <SelectValue placeholder="All Quarters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Quarters</SelectItem>
            {[...new Set(quarterOptions)].map(q => (
              <SelectItem key={q} value={q}>{q}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((item) => (
                  <TableRow key={item.id} data-testid={`row-catalog-item-${item.id}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={compareItems.includes(item.id)}
                        onChange={() => toggleCompare(item.id)}
                        className="w-3.5 h-3.5 rounded"
                        data-testid={`checkbox-compare-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium text-sm">{item.itemName}</span>
                        <div className="text-xs text-muted-foreground font-mono">{item.itemCode}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm">{item.vendorName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Number(item.unitPrice).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.unit}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.leadTimeDays ? `${item.leadTimeDays}d` : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setSelectedItem(item); setHistoryDialogOpen(true); }}
                        data-testid={`button-price-history-${item.id}`}
                      >
                        <BarChart3 className="w-3.5 h-3.5 mr-1" />
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!isLoading && searchParam.length >= 2 && results.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No items found for "{searchTerm}"</p>
        </div>
      )}

      {compareItems.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4" />
              Price Comparison ({compareItems.length} items)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Min Order</TableHead>
                  <TableHead className="text-right">Delivery Fee</TableHead>
                  <TableHead className="text-right">Effective Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparedItems.sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice)).map((item, idx) => (
                  <TableRow key={item.id} className={idx === 0 ? "bg-green-50 dark:bg-green-950/20" : ""}>
                    <TableCell className="font-medium text-sm">{item.itemName}</TableCell>
                    <TableCell className="text-sm">{item.vendorName}</TableCell>
                    <TableCell className="text-right font-mono">
                      ${Number(item.unitPrice).toFixed(2)}
                      {idx === 0 && <Badge className="ml-1 text-[9px] bg-green-600">Best</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-sm">{item.minimumOrder || "—"}</TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {item.deliveryFee ? `$${Number(item.deliveryFee).toFixed(2)}` : "Free"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      ${(Number(item.unitPrice) + Number(item.deliveryFee || 0)).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Price History: {selectedItem?.itemName}</DialogTitle>
            <DialogDescription>
              {selectedItem?.vendorName} · {selectedItem?.itemCode}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            {priceHistory.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quarter</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead>Lead Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceHistory.map((entry, idx) => {
                    const prevPrice = idx < priceHistory.length - 1 ? Number(priceHistory[idx + 1].unitPrice) : null;
                    const change = prevPrice ? ((Number(entry.unitPrice) - prevPrice) / prevPrice * 100) : null;
                    return (
                      <TableRow key={entry.quarter}>
                        <TableCell className="font-mono text-sm">{entry.quarter}</TableCell>
                        <TableCell className="text-right font-mono">${Number(entry.unitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          {change !== null ? (
                            <span className={change > 0 ? "text-red-600" : change < 0 ? "text-green-600" : "text-muted-foreground"}>
                              {change > 0 ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : change < 0 ? <TrendingDown className="w-3 h-3 inline mr-0.5" /> : null}
                              {change > 0 ? "+" : ""}{change.toFixed(1)}%
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {entry.leadTimeDays ? `${entry.leadTimeDays}d` : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No historical data available</p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ReviewItem {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  vendorMatchConfidence: string | null;
  materialCost: string;
  alternatives: Array<{
    id: string;
    itemName: string;
    itemCode: string;
    category: string;
    unit: string;
    unitPrice: number;
    score: number;
  }>;
}

function MatchReviewPanel() {
  const [estimateId, setEstimateId] = useState("");
  const { toast } = useToast();

  const { data: reviewData, isLoading, refetch } = useQuery<{ items: ReviewItem[] }>({
    queryKey: ["/api/estimates", estimateId, "match-review"],
    queryFn: async () => {
      const res = await fetch(`/api/estimates/${estimateId}/match-review`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch review queue");
      return res.json();
    },
    enabled: estimateId.length > 5,
  });

  const acceptMutation = useMutation({
    mutationFn: async ({ lineItemId, vendorPricingId }: { lineItemId: string; vendorPricingId: string }) => {
      const res = await apiRequest("POST", `/api/estimates/${estimateId}/match-review/${lineItemId}/accept`, { vendorPricingId });
      if (!res.ok) throw new Error("Failed to accept match");
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Match accepted", description: "Pricing updated" });
    },
    onError: () => {
      toast({ title: "Failed to accept match", variant: "destructive" });
    },
  });

  const reviewItems = reviewData?.items || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Match Review Queue</CardTitle>
          <CardDescription>Review low-confidence pricing matches and select correct alternatives</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Enter estimate ID..."
              value={estimateId}
              onChange={(e) => setEstimateId(e.target.value)}
              className="max-w-xs"
              data-testid="input-review-estimate-id"
            />
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {reviewItems.length > 0 && (
              <Badge variant="secondary" data-testid="badge-review-count">{reviewItems.length} items need review</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {reviewItems.length === 0 && estimateId.length > 5 && !isLoading && (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">All pricing matches are resolved</p>
        </div>
      )}

      {reviewItems.map((item) => (
        <Card key={item.id} data-testid={`card-review-item-${item.id}`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className="font-medium text-sm">{item.description}</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground font-mono">{item.quantity} {item.unit}</span>
                  <Badge
                    variant={item.vendorMatchConfidence === "LOW" ? "destructive" : item.vendorMatchConfidence === "FUZZY" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {item.vendorMatchConfidence || "NO_MATCH"}
                  </Badge>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Current: ${Number(item.materialCost).toFixed(2)}</span>
            </div>

            {item.alternatives.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Suggested Alternatives</span>
                {item.alternatives.map((alt) => (
                  <div key={alt.id} className="flex items-center justify-between p-2 rounded border bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`row-alternative-${alt.id}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{alt.itemName}</span>
                        <Badge variant="outline" className="text-[9px]">{alt.score}% match</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{alt.itemCode} · {alt.category} · {alt.unit}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">${alt.unitPrice.toFixed(2)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acceptMutation.mutate({ lineItemId: item.id, vendorPricingId: alt.id })}
                        disabled={acceptMutation.isPending}
                        data-testid={`button-accept-match-${alt.id}`}
                      >
                        {acceptMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                        Accept
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No matching alternatives found in catalog</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BulkImportPanel() {
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const { toast } = useToast();

  interface CrmOrg { id: string; name: string; type: string; }
  const { data: vendors = [] } = useQuery<CrmOrg[]>({
    queryKey: ["/api/crm/organisations"],
    select: (data) => data.filter(org => org.type === "SUPPLIER" || org.type === "VENDOR"),
  });

  const handleBulkImport = async () => {
    if (!csvText.trim() || !selectedVendorId) return;
    setImporting(true);
    const lines = csvText.trim().split("\n").filter(l => l.trim());
    const items = lines.map(line => {
      const parts = line.split(/[\t,]/).map(p => p.trim());
      return {
        itemCode: parts[0] || "",
        itemName: parts[1] || parts[0] || "",
        category: parts[2] || "General",
        unit: parts[3] || "EA",
        unitPrice: parts[4] || "0",
      };
    }).filter(item => item.itemCode);

    try {
      const res = await apiRequest("POST", "/api/vendor-pricing/bulk-import", { items, vendorId: selectedVendorId });
      const result = await res.json();
      toast({ title: "Import Complete", description: `Imported ${result.imported} items${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}` });
      setCsvText("");
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-pricing"] });
    } catch {
      toast({ title: "Import Failed", description: "Check your data format and try again", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Bulk CSV Import
        </CardTitle>
        <CardDescription>Select a vendor and paste CSV data: ItemCode, Name, Category, Unit, Price (one per line)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Vendor</label>
          <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
            <SelectTrigger data-testid="select-bulk-vendor">
              <SelectValue placeholder="Select vendor..." />
            </SelectTrigger>
            <SelectContent>
              {vendors.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3 h-3 text-muted-foreground" />
                    {v.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <textarea
          className="w-full h-32 p-3 text-sm border rounded-md bg-background resize-none font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={"PLY-001, Plywood 4x8, Lumber, SHT, 42.50\nCNC-100, Concrete Mix 80lb, Concrete, BAG, 6.25"}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          data-testid="textarea-bulk-csv"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {csvText.trim() ? `${csvText.trim().split("\n").filter(l => l.trim()).length} row(s)` : "Paste data above"}
          </span>
          <Button onClick={handleBulkImport} disabled={importing || !csvText.trim() || !selectedVendorId} size="sm" data-testid="button-bulk-csv-import">
            {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
            {importing ? "Importing..." : "Import"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VendorPricingPage() {
  const { user } = useAuth();

  if (!hasManagementAccess(user?.role)) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container max-w-full mx-auto px-4 py-8">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription>
              You do not have permission to access vendor pricing management.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="container max-w-full mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Vendor Pricing</h1>
          <p className="text-muted-foreground text-sm mt-1">Search, compare, and manage vendor pricing catalogs</p>
        </div>

        <Tabs defaultValue="catalog" className="w-full">
          <TabsList data-testid="tabs-vendor-pricing">
            <TabsTrigger value="catalog" data-testid="tab-catalog">
              <Search className="w-4 h-4 mr-1.5" />
              Catalog Search
            </TabsTrigger>
            <TabsTrigger value="pricebooks" data-testid="tab-pricebooks">
              <DollarSign className="w-4 h-4 mr-1.5" />
              Pricebooks
            </TabsTrigger>
            <TabsTrigger value="import" data-testid="tab-import">
              <Upload className="w-4 h-4 mr-1.5" />
              Bulk Import
            </TabsTrigger>
            <TabsTrigger value="review" data-testid="tab-review">
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              Match Review
            </TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="mt-4">
            <CatalogSearchPanel />
          </TabsContent>

          <TabsContent value="pricebooks" className="mt-4">
            <VendorPricingSync />
          </TabsContent>

          <TabsContent value="import" className="mt-4">
            <BulkImportPanel />
          </TabsContent>

          <TabsContent value="review" className="mt-4">
            <MatchReviewPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
