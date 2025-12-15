import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Package, Plus, TrendingUp, TrendingDown, DollarSign, Building2,
  Calendar, Trash2, History, BarChart3
} from "lucide-react";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface MaterialPriceData {
  price: {
    id: string;
    organizationId: string;
    materialName: string;
    materialCategory: string | null;
    unitOfMeasure: string;
    pricePerUnit: string;
    sourceVendorId: string | null;
    effectiveDate: string;
    expirationDate: string | null;
    notes: string | null;
    createdById: string;
    createdAt: string;
  };
  vendor: { id: string; name: string } | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

interface CRMEntity {
  id: string;
  name: string;
  type: string;
}

export default function MaterialPriceIndexPage() {
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [vendorFilter, setVendorFilter] = useState<string>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("prices");

  const { data: prices, isLoading } = useQuery<MaterialPriceData[]>({
    queryKey: ["/api/marketplace/material-prices", categoryFilter, vendorFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoryFilter !== "ALL") params.set("category", categoryFilter);
      if (vendorFilter !== "ALL") params.set("vendorId", vendorFilter);
      params.set("activeOnly", "true");
      const queryString = params.toString();
      return fetch(`/api/marketplace/material-prices${queryString ? `?${queryString}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const { data: categories } = useQuery<string[]>({
    queryKey: ["/api/marketplace/material-prices/categories/list"],
  });

  const { data: vendors } = useQuery<CRMEntity[]>({
    queryKey: ["/api/crm"],
    queryFn: () => fetch("/api/crm", { credentials: "include" }).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/marketplace/material-prices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/material-prices"] });
      toast({ title: "Price entry deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete price entry", variant: "destructive" });
    },
  });

  const groupedPrices = prices?.reduce((acc, item) => {
    const key = item.price.materialName;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {} as Record<string, MaterialPriceData[]>) || {};

  const materialNames = Object.keys(groupedPrices);

  return (
    <div className="p-6 space-y-6" data-testid="page-material-price-index">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Material Price Index</h1>
          <p className="text-muted-foreground">Track and compare material pricing</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-price">
          <Plus className="h-4 w-4 mr-2" />
          Add Price
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="prices" data-testid="tab-prices">Current Prices</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">Price History</TabsTrigger>
        </TabsList>

        <TabsContent value="prices" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {categories?.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-vendor-filter">
                <SelectValue placeholder="Filter by vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Vendors</SelectItem>
                {vendors?.filter(v => ["SUPPLIER", "VENDOR"].includes(v.type)).map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : prices && prices.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {prices.map((item) => (
                <Card 
                  key={item.price.id}
                  className="hover-elevate transition-all"
                  data-testid={`card-price-${item.price.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          {item.price.materialName}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {item.price.materialCategory || "Uncategorized"}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-primary">
                        ${parseFloat(item.price.pricePerUnit).toFixed(2)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        per {item.price.unitOfMeasure}
                      </span>
                    </div>
                    
                    {item.vendor && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {item.vendor.name}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      Effective: {format(new Date(item.price.effectiveDate), "MMM d, yyyy")}
                      {item.price.expirationDate && (
                        <> - {format(new Date(item.price.expirationDate), "MMM d, yyyy")}</>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => setSelectedMaterial(item.price.materialName)}
                        data-testid={`button-history-${item.price.id}`}
                      >
                        <History className="h-3 w-3 mr-1" />
                        History
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(item.price.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${item.price.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Price Data</h3>
              <p className="text-muted-foreground mb-4">
                Start tracking material prices from your vendors.
              </p>
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-price">
                <Plus className="h-4 w-4 mr-2" />
                Add First Price
              </Button>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {materialNames.length > 0 ? (
            <div className="space-y-4">
              <Select value={selectedMaterial || ""} onValueChange={setSelectedMaterial}>
                <SelectTrigger className="w-[300px]" data-testid="select-material-history">
                  <SelectValue placeholder="Select material to view history" />
                </SelectTrigger>
                <SelectContent>
                  {materialNames.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedMaterial && (
                <PriceHistoryChart materialName={selectedMaterial} />
              )}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No History Available</h3>
              <p className="text-muted-foreground">
                Add price entries to track historical trends.
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <CreatePriceDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog}
        vendors={vendors || []}
        categories={categories || []}
      />
    </div>
  );
}

function PriceHistoryChart({ materialName }: { materialName: string }) {
  const { data: history, isLoading } = useQuery<{ price: any; vendor: any }[]>({
    queryKey: ["/api/marketplace/material-prices/history", materialName],
    queryFn: () => 
      fetch(`/api/marketplace/material-prices/history/${encodeURIComponent(materialName)}`, { credentials: "include" })
        .then(r => r.json()),
  });

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  if (!history || history.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No price history for this material.</p>
      </Card>
    );
  }

  const chartData = history
    .map((h) => ({
      date: format(new Date(h.price.effectiveDate), "MMM d"),
      price: parseFloat(h.price.pricePerUnit),
      vendor: h.vendor?.name || "Unknown",
    }))
    .reverse();

  const minPrice = Math.min(...chartData.map(d => d.price));
  const maxPrice = Math.max(...chartData.map(d => d.price));
  const priceChange = chartData.length > 1 
    ? ((chartData[chartData.length - 1].price - chartData[0].price) / chartData[0].price) * 100
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{materialName}</CardTitle>
            <CardDescription>{history.length} price points</CardDescription>
          </div>
          <div className="text-right">
            <div className={`flex items-center gap-1 ${priceChange >= 0 ? "text-destructive" : "text-green-500"}`}>
              {priceChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span className="font-medium">{Math.abs(priceChange).toFixed(1)}%</span>
            </div>
            <div className="text-xs text-muted-foreground">overall change</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis 
                domain={[minPrice * 0.9, maxPrice * 1.1]} 
                tickFormatter={(v) => `$${v}`}
                className="text-xs"
              />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]}
              />
              <Line 
                type="monotone" 
                dataKey="price" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={{ fill: "hsl(var(--primary))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="font-medium">${minPrice.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Lowest</div>
          </div>
          <div>
            <div className="font-medium">${((minPrice + maxPrice) / 2).toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Average</div>
          </div>
          <div>
            <div className="font-medium">${maxPrice.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Highest</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreatePriceDialog({ 
  open, 
  onOpenChange,
  vendors,
  categories 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  vendors: CRMEntity[];
  categories: string[];
}) {
  const { toast } = useToast();
  const [materialName, setMaterialName] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("EA");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split("T")[0]);
  const [expirationDate, setExpirationDate] = useState("");
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/marketplace/material-prices", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/material-prices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/material-prices/categories/list"] });
      toast({ title: "Price entry created" });
      onOpenChange(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to create price entry", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setMaterialName("");
    setCategory("");
    setNewCategory("");
    setUnitOfMeasure("EA");
    setPricePerUnit("");
    setVendorId("");
    setEffectiveDate(new Date().toISOString().split("T")[0]);
    setExpirationDate("");
    setNotes("");
  };

  const handleSubmit = () => {
    if (!materialName.trim()) {
      toast({ title: "Material name is required", variant: "destructive" });
      return;
    }
    if (!pricePerUnit || parseFloat(pricePerUnit) <= 0) {
      toast({ title: "Valid price is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      materialName,
      materialCategory: newCategory || category || undefined,
      unitOfMeasure,
      pricePerUnit,
      sourceVendorId: vendorId || undefined,
      effectiveDate,
      expirationDate: expirationDate || undefined,
      notes: notes || undefined,
    });
  };

  const vendorList = vendors.filter(v => ["SUPPLIER", "VENDOR"].includes(v.type));

  const commonUnits = ["EA", "SF", "LF", "CY", "SY", "TON", "GAL", "LB", "BAG", "BOX", "ROLL", "PALLET"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Material Price</DialogTitle>
          <DialogDescription>
            Record a new material price from a vendor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <div className="space-y-2">
            <Label>Material Name *</Label>
            <Input
              value={materialName}
              onChange={(e) => setMaterialName(e.target.value)}
              placeholder="e.g., 4000 PSI Concrete, #4 Rebar"
              data-testid="input-material-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <div className="flex gap-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="flex-1" data-testid="select-category">
                  <SelectValue placeholder="Select or add new" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">New Category</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!category && (
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="New category"
                  className="flex-1"
                  data-testid="input-new-category"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Price per Unit *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                  placeholder="0.00"
                  className="pl-8"
                  data-testid="input-price"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Unit of Measure</Label>
              <Select value={unitOfMeasure} onValueChange={setUnitOfMeasure}>
                <SelectTrigger data-testid="select-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {commonUnits.map((unit) => (
                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger data-testid="select-vendor">
                <SelectValue placeholder="Select vendor (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No Vendor</SelectItem>
                {vendorList.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                data-testid="input-effective-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Expiration Date</Label>
              <Input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                data-testid="input-expiration-date"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              data-testid="input-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-price">
            {createMutation.isPending ? "Saving..." : "Save Price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
