import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Download,
  FileText,
  Image,
  Video,
  Receipt,
  FileCheck,
  Send,
  HelpCircle,
  FileEdit,
  Eye,
  Archive,
  FileDown,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ProjectVaultTabProps {
  projectCode: string;
  projectId: string;
  userRole: string;
}

interface VaultDocument {
  id: string;
  name: string;
  category: string;
  sourceTab: string;
  uploadDate: string;
  uploadedBy: string;
  fileSize: number | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  objectKey: string | null;
}

const CATEGORY_OPTIONS = [
  "all",
  "Receipts",
  "Contracts",
  "Change Orders",
  "RFIs",
  "Submittals",
  "Transmittals",
  "Plans/Specs",
  "Photos",
  "Videos",
  "Invoices",
  "Other",
];

function getCategoryIcon(category: string) {
  switch (category) {
    case "Receipts": return <Receipt className="h-4 w-4" />;
    case "Contracts": return <FileText className="h-4 w-4" />;
    case "Change Orders": return <FileEdit className="h-4 w-4" />;
    case "RFIs": return <HelpCircle className="h-4 w-4" />;
    case "Submittals": return <FileCheck className="h-4 w-4" />;
    case "Transmittals": return <Send className="h-4 w-4" />;
    case "Plans/Specs": return <FileText className="h-4 w-4" />;
    case "Photos": return <Image className="h-4 w-4" />;
    case "Videos": return <Video className="h-4 w-4" />;
    case "Invoices": return <FileDown className="h-4 w-4" />;
    default: return <FileText className="h-4 w-4" />;
  }
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCategoryColor(category: string) {
  switch (category) {
    case "Receipts": return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "Contracts": return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "Change Orders": return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    case "RFIs": return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    case "Submittals": return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300";
    case "Transmittals": return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300";
    case "Plans/Specs": return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
    case "Photos": return "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300";
    case "Invoices": return "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300";
    case "Videos": return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    default: return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

export default function ProjectVaultTab({ projectCode, projectId, userRole }: ProjectVaultTabProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [sortField, setSortField] = useState<"name" | "category" | "uploadDate" | "fileSize">("uploadDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const queryParams = new URLSearchParams();
  if (categoryFilter !== "all") queryParams.set("type", categoryFilter);
  if (dateFrom) queryParams.set("dateFrom", dateFrom);
  if (dateTo) queryParams.set("dateTo", dateTo);
  const qs = queryParams.toString();

  const { data: vaultDocs = [], isLoading } = useQuery<VaultDocument[]>({
    queryKey: ["/api/projects", projectCode, "vault", qs],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectCode}/vault${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vault documents");
      return res.json();
    },
  });

  const filteredDocs = useMemo(() => {
    let docs = vaultDocs;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.sourceTab.toLowerCase().includes(q) ||
        (d.fileName || "").toLowerCase().includes(q)
      );
    }
    docs = [...docs].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "category": cmp = a.category.localeCompare(b.category); break;
        case "uploadDate": cmp = new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime(); break;
        case "fileSize": cmp = (a.fileSize || 0) - (b.fileSize || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return docs;
  }, [vaultDocs, searchQuery, sortField, sortDir]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const d of vaultDocs) {
      stats[d.category] = (stats[d.category] || 0) + 1;
    }
    return stats;
  }, [vaultDocs]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDocs.map(d => d.id)));
    }
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const getSignedUrl = async (doc: VaultDocument): Promise<{ url: string; fileName: string | null } | null> => {
    if (!doc.objectKey) {
      toast({ title: "No file", description: "This document has no downloadable file.", variant: "destructive" });
      return null;
    }
    try {
      const res = await fetch(`/api/projects/${projectCode}/vault/${doc.id}/signed-url`, { credentials: "include" });
      if (res.ok) {
        return await res.json();
      }
      toast({ title: "Access denied", description: "Could not access this file.", variant: "destructive" });
    } catch {
      toast({ title: "Error", description: "Failed to get file URL.", variant: "destructive" });
    }
    return null;
  };

  const handlePreview = async (doc: VaultDocument) => {
    const result = await getSignedUrl(doc);
    if (result) {
      window.open(result.url, "_blank");
    }
  };

  const handleDownload = async (doc: VaultDocument) => {
    const result = await getSignedUrl(doc);
    if (result) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.fileName || doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleExportPdf = async () => {
    const selectedDocs = filteredDocs.filter(d => selectedIds.has(d.id));
    if (selectedDocs.length === 0) {
      toast({ title: "No documents selected", description: "Select documents to include in the PDF export.", variant: "destructive" });
      return;
    }

    setIsExporting(true);
    try {
      const res = await fetch(`/api/projects/${projectCode}/vault/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          documentIds: selectedDocs.map(d => d.id),
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Project_Vault_${projectCode}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Export complete", description: `PDF with ${selectedDocs.length} documents downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: "Could not generate PDF package.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="project-vault-container">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5" />
          <h3 className="text-lg font-semibold" data-testid="vault-title">Project Vault</h3>
          <Badge variant="secondary" data-testid="vault-total-count">{vaultDocs.length} documents</Badge>
        </div>
        <Button
          onClick={handleExportPdf}
          disabled={selectedIds.size === 0 || isExporting}
          data-testid="button-export-pdf"
        >
          <FileDown className="h-4 w-4 mr-2" />
          {isExporting ? "Exporting..." : `Export PDF (${selectedIds.size})`}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {Object.entries(categoryStats).map(([cat, count]) => (
          <Card
            key={cat}
            className={`cursor-pointer transition-colors ${categoryFilter === cat ? "ring-2 ring-primary" : ""}`}
            onClick={() => setCategoryFilter(categoryFilter === cat ? "all" : cat)}
            data-testid={`vault-stat-${cat.toLowerCase().replace(/[^a-z]/g, "-")}`}
          >
            <CardContent className="p-3 flex items-center gap-2">
              {getCategoryIcon(cat)}
              <div>
                <p className="text-xs text-muted-foreground truncate">{cat}</p>
                <p className="text-lg font-bold">{count}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-vault-search"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-vault-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map(opt => (
              <SelectItem key={opt} value={opt}>
                {opt === "all" ? "All Categories" : opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-[150px]"
          placeholder="From"
          data-testid="input-vault-date-from"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-[150px]"
          placeholder="To"
          data-testid="input-vault-date-to"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : filteredDocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Archive className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-1" data-testid="vault-empty-state">No documents found</h3>
            <p className="text-muted-foreground">
              {searchQuery || categoryFilter !== "all" || dateFrom || dateTo
                ? "Try adjusting your filters or search query."
                : "Upload documents in their respective tabs and they will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Card>
              <CardContent className="p-0">
                <Table data-testid="vault-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.size === filteredDocs.length && filteredDocs.length > 0}
                          onCheckedChange={toggleSelectAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort("name")} data-testid="th-name">
                        Name {sortField === "name" && (sortDir === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort("category")} data-testid="th-category">
                        Type {sortField === "category" && (sortDir === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort("uploadDate")} data-testid="th-date">
                        Date {sortField === "uploadDate" && (sortDir === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort("fileSize")} data-testid="th-size">
                        Size {sortField === "fileSize" && (sortDir === "asc" ? "↑" : "↓")}
                      </TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.map(doc => (
                      <TableRow key={doc.id} data-testid={`vault-row-${doc.id}`}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(doc.id)}
                            onCheckedChange={() => toggleSelect(doc.id)}
                            data-testid={`checkbox-${doc.id}`}
                          />
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(doc.category)}
                            <span className="truncate font-medium" data-testid={`vault-name-${doc.id}`}>{doc.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getCategoryColor(doc.category)} data-testid={`vault-category-${doc.id}`}>
                            {doc.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm" data-testid={`vault-source-${doc.id}`}>
                          {doc.sourceTab}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`vault-date-${doc.id}`}>
                          {format(new Date(doc.uploadDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm" data-testid={`vault-uploader-${doc.id}`}>
                          {doc.uploadedBy || "—"}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`vault-size-${doc.id}`}>
                          {formatFileSize(doc.fileSize)}
                        </TableCell>
                        <TableCell>
                          {doc.objectKey && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePreview(doc)}
                                data-testid={`button-preview-${doc.id}`}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDownload(doc)}
                                data-testid={`button-download-${doc.id}`}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="md:hidden space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                checked={selectedIds.size === filteredDocs.length && filteredDocs.length > 0}
                onCheckedChange={toggleSelectAll}
                data-testid="checkbox-select-all-mobile"
              />
              <span className="text-sm text-muted-foreground">Select all ({filteredDocs.length})</span>
            </div>
            {filteredDocs.map(doc => (
              <div
                key={doc.id}
                className="border rounded-md p-3 space-y-2"
                data-testid={`vault-row-mobile-${doc.id}`}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selectedIds.has(doc.id)}
                    onCheckedChange={() => toggleSelect(doc.id)}
                    className="mt-1"
                    data-testid={`checkbox-mobile-${doc.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(doc.category)}
                      <span className="font-medium text-sm truncate" data-testid={`vault-name-mobile-${doc.id}`}>{doc.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className={`text-xs ${getCategoryColor(doc.category)}`}>
                        {doc.category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{doc.sourceTab}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{format(new Date(doc.uploadDate), "MMM d, yyyy")}</span>
                      <span>{formatFileSize(doc.fileSize)}</span>
                    </div>
                  </div>
                  {doc.objectKey && (
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePreview(doc)}
                        data-testid={`button-preview-mobile-${doc.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(doc)}
                        data-testid={`button-download-mobile-${doc.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
