import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Search, Pencil, FolderOpen } from "lucide-react";
import { format } from "date-fns";
import type { CostCode } from "@shared/costCodes";
import { CSI_DIVISIONS } from "@shared/costCodes";

interface OrgCostCode {
  id: number;
  organizationId: string;
  code: string;
  description: string;
  division: string;
  isActive: boolean;
  deactivatedById: string | null;
  deactivatedAt: string | null;
  deactivatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function CostCodesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCustomOnly, setShowCustomOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgCostCode | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDivision, setFormDivision] = useState("");
  const [formActive, setFormActive] = useState(true);

  const { data: allCodes = [], isLoading } = useQuery<CostCode[]>({
    queryKey: ["/api/cost-codes"],
  });

  const { data: orgCodes = [] } = useQuery<OrgCostCode[]>({
    queryKey: ["/api/cost-codes/org"],
  });

  const orgCodeMap = useMemo(() => {
    const map = new Map<string, OrgCostCode>();
    orgCodes.forEach(c => map.set(c.code, c));
    return map;
  }, [orgCodes]);

  const filtered = useMemo(() => {
    let list = allCodes;
    if (showCustomOnly) {
      list = list.filter(c => c.isCustom);
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        c => c.code.toLowerCase().includes(s) ||
          c.description.toLowerCase().includes(s) ||
          (c.division || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [allCodes, search, showCustomOnly]);

  const grouped = useMemo(() => {
    const groups: { division: string; items: CostCode[] }[] = [];
    const map = new Map<string, CostCode[]>();
    for (const code of filtered) {
      const div = code.division || "Other";
      if (!map.has(div)) {
        map.set(div, []);
        groups.push({ division: div, items: map.get(div)! });
      }
      map.get(div)!.push(code);
    }
    return groups;
  }, [filtered]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cost-codes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cost-codes/org"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { code: string; description: string; division: string; isActive: boolean }) => {
      const res = await apiRequest("POST", "/api/cost-codes", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Cost code created" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create cost code", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; code?: string; description?: string; division?: string; isActive?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/cost-codes/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Cost code updated" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update cost code", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ code: codeStr, isActive, orgEntry, division, description }: {
      code: string; isActive: boolean; orgEntry?: OrgCostCode; division: string; description: string;
    }) => {
      if (orgEntry) {
        const res = await apiRequest("PATCH", `/api/cost-codes/${orgEntry.id}`, { isActive });
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/cost-codes", {
          code: codeStr,
          description,
          division,
          isActive,
          isCustom: false,
        });
        return res.json();
      }
    },
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to toggle cost code", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditing(null);
    setFormCode("");
    setFormDescription("");
    setFormDivision("");
    setFormActive(true);
    setDialogOpen(true);
  }

  function openEdit(code: CostCode) {
    const org = orgCodeMap.get(code.code);
    if (!org) return;
    setEditing(org);
    setFormCode(org.code);
    setFormDescription(org.description);
    setFormDivision(org.division);
    setFormActive(org.isActive);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  function handleSave() {
    if (!formCode.trim() || !formDescription.trim() || !formDivision.trim()) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, description: formDescription, division: formDivision, isActive: formActive });
    } else {
      createMutation.mutate({ code: formCode, description: formDescription, division: formDivision, isActive: formActive });
    }
  }

  const divisionOptions = Object.entries(CSI_DIVISIONS).map(([, label]) => label);

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Cost Codes</h1>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-page-subtitle">
            Manage your organization's cost codes. Standard codes are provided based on your trade; you can add custom codes or deactivate any code.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-cost-code">
          <Plus className="w-4 h-4 mr-2" />
          Add Custom Code
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search codes, descriptions, or divisions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-cost-codes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="custom-only"
                checked={showCustomOnly}
                onCheckedChange={setShowCustomOnly}
                data-testid="switch-custom-only"
              />
              <Label htmlFor="custom-only" className="text-sm cursor-pointer" data-testid="label-custom-only">Custom only</Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-loading">Loading cost codes...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-empty">
              {search || showCustomOnly ? "No cost codes match your filters." : "No cost codes available."}
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[100px] text-center">Active</TableHead>
                      <TableHead className="w-[80px] text-center">Type</TableHead>
                      <TableHead className="w-[160px]">Deactivated</TableHead>
                      <TableHead className="w-[80px] text-right">Edit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped.map((group) => (
                      <Fragment key={group.division}>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={6} className="py-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                              <FolderOpen className="w-4 h-4" />
                              {group.division}
                              <Badge variant="outline" className="ml-1 text-[10px]">{group.items.length}</Badge>
                            </div>
                          </TableCell>
                        </TableRow>
                        {group.items.map((code) => {
                          const isCustom = !!code.isCustom;
                          const orgEntry = orgCodeMap.get(code.code);
                          const isActive = code.isActive !== false;
                          const deactivatedByName = orgEntry?.deactivatedByName;
                          const deactivatedAt = orgEntry?.deactivatedAt;
                          return (
                            <TableRow key={code.code} className={!isActive ? "opacity-50" : ""} data-testid={`row-cost-code-${code.code}`}>
                              <TableCell>
                                <code className="text-sm font-mono" data-testid={`text-code-${code.code}`}>{code.code}</code>
                              </TableCell>
                              <TableCell data-testid={`text-desc-${code.code}`}>{code.description}</TableCell>
                              <TableCell className="text-center">
                                <Switch
                                  checked={isActive}
                                  onCheckedChange={(checked) => toggleActiveMutation.mutate({
                                    code: code.code,
                                    isActive: checked,
                                    orgEntry: orgEntry || undefined,
                                    division: code.division || "",
                                    description: code.description,
                                  })}
                                  data-testid={`switch-active-${code.code}`}
                                />
                              </TableCell>
                              <TableCell className="text-center">
                                {isCustom ? (
                                  <Badge variant="secondary" className="text-[10px]" data-testid={`badge-custom-${code.code}`}>Custom</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]" data-testid={`badge-standard-${code.code}`}>Standard</Badge>
                                )}
                              </TableCell>
                              <TableCell data-testid={`text-deactivated-${code.code}`}>
                                {!isActive && deactivatedByName ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-xs text-muted-foreground cursor-help">
                                        {deactivatedByName}
                                        {deactivatedAt && (
                                          <>, {format(new Date(deactivatedAt), "MMM d, yyyy")}</>
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Deactivated by {deactivatedByName}</p>
                                      {deactivatedAt && <p>{format(new Date(deactivatedAt), "PPpp")}</p>}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : !isActive ? (
                                  <span className="text-xs text-muted-foreground">-</span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right">
                                {isCustom && orgEntry && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => openEdit(code)}
                                    data-testid={`button-edit-${code.code}`}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">{editing ? "Edit Cost Code" : "Add Custom Cost Code"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cc-code">Code</Label>
              <Input
                id="cc-code"
                placeholder="e.g., 26-250"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                disabled={!!editing}
                data-testid="input-cost-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-desc">Description</Label>
              <Input
                id="cc-desc"
                placeholder="e.g., Custom Wiring Task"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                data-testid="input-cost-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-division">Division</Label>
              <Select value={formDivision} onValueChange={setFormDivision}>
                <SelectTrigger data-testid="select-cost-division">
                  <SelectValue placeholder="Select a division" />
                </SelectTrigger>
                <SelectContent>
                  {divisionOptions.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="cc-active">Active</Label>
              <Switch id="cc-active" checked={formActive} onCheckedChange={setFormActive} data-testid="switch-cost-active" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-cost-code"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
