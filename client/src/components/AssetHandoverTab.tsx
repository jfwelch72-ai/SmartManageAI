import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Plus, CheckCircle2, Circle, MinusCircle, Loader2, Trash2, FileText,
  ClipboardCheck, Upload, PenLine, KeyRound, BookOpen, Award, Settings, Lock, Download,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";

interface HandoverItem {
  id: string;
  projectId: string;
  category: string;
  title: string;
  description?: string | null;
  status: "PENDING" | "COMPLETE" | "NOT_APPLICABLE";
  documentUrl?: string | null;
  documentFilename?: string | null;
  completedAt?: string | null;
  sortOrder: number;
  createdAt: string;
}

interface HandoverSignoff {
  id: string;
  projectId: string;
  role: "CONTRACTOR" | "OWNER";
  signedByName: string;
  signedAt: string;
  notes?: string | null;
}

interface AssetHandoverTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const MANAGEMENT_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"];
function canManage(role: string) { return MANAGEMENT_ROLES.includes(role); }

const DEFAULT_CATEGORIES = [
  { category: "Keys & Access", items: ["Building Keys", "Access Codes / FOBs", "Gate Keys"] },
  { category: "Documentation", items: ["O&M Manuals", "As-Built Drawings", "Certificates of Occupancy", "Equipment Lists"] },
  { category: "Certificates", items: ["Final Inspection Certificate", "Fire Safety Certificate", "Electrical Compliance Certificate"] },
  { category: "Equipment", items: ["HVAC Equipment Handover", "Plumbing System Handover", "Elevator Handover"] },
];

const CATEGORY_ICONS: Record<string, typeof KeyRound> = {
  "Keys & Access": KeyRound,
  "Documentation": BookOpen,
  "Certificates": Award,
  "Equipment": Settings,
};

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  PENDING: { icon: Circle, color: "text-muted-foreground" },
  COMPLETE: { icon: CheckCircle2, color: "text-green-600 dark:text-green-400" },
  NOT_APPLICABLE: { icon: MinusCircle, color: "text-gray-400" },
};

function fmtDate(d?: string | null) { if (!d) return "—"; return format(new Date(d), "MMM d, yyyy"); }

export default function AssetHandoverTab({ projectId, projectCode, userRole }: AssetHandoverTabProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSignoffDialog, setShowSignoffDialog] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [signoffRole, setSignoffRole] = useState<"CONTRACTOR" | "OWNER">("CONTRACTOR");
  const [signoffNotes, setSignoffNotes] = useState("");
  const [newItem, setNewItem] = useState({ title: "", category: "Documentation", description: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const itemsKey = ["/api/projects", projectCode, "handover", "items"];
  const signoffsKey = ["/api/projects", projectCode, "handover", "signoffs"];

  const { data: items = [], isLoading: itemsLoading } = useQuery<HandoverItem[]>({
    queryKey: itemsKey,
    queryFn: () => apiRequest("GET", `/api/projects/${projectCode}/handover/items`).then(r => r.json()),
  });

  const { data: signoffs = [], isLoading: signoffsLoading } = useQuery<HandoverSignoff[]>({
    queryKey: signoffsKey,
    queryFn: () => apiRequest("GET", `/api/projects/${projectCode}/handover/signoffs`).then(r => r.json()),
  });

  const createItemMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", `/api/projects/${projectCode}/handover/items`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: itemsKey }); setShowAddDialog(false); setNewItem({ title: "", category: "Documentation", description: "" }); },
    onError: () => toast({ title: "Error", description: "Failed to create item.", variant: "destructive" }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => apiRequest("PATCH", `/api/projects/${projectCode}/handover/items/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemsKey }),
    onError: () => toast({ title: "Error", description: "Failed to update item.", variant: "destructive" }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectCode}/handover/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemsKey }),
    onError: () => toast({ title: "Error", description: "Failed to delete item.", variant: "destructive" }),
  });

  const signoffMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", `/api/projects/${projectCode}/handover/signoffs`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: signoffsKey });
      setShowSignoffDialog(false);
      setSignoffNotes("");
      toast({ title: "Signed off", description: "Handover signoff recorded." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err?.message || "Failed to sign off.", variant: "destructive" }),
  });

  const seedDefaultsMutation = useMutation({
    mutationFn: async () => {
      for (const cat of DEFAULT_CATEGORIES) {
        for (let i = 0; i < cat.items.length; i++) {
          await apiRequest("POST", `/api/projects/${projectCode}/handover/items`, {
            title: cat.items[i],
            category: cat.category,
            sortOrder: i,
          });
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: itemsKey }); toast({ title: "Checklist created", description: "Default handover items added." }); },
    onError: () => toast({ title: "Error", description: "Failed to create default items.", variant: "destructive" }),
  });

  const isMgr = canManage(userRole);
  const totalItems = items.filter(i => i.status !== "NOT_APPLICABLE").length;
  const completedItems = items.filter(i => i.status === "COMPLETE").length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const contractorSignoff = signoffs.find(s => s.role === "CONTRACTOR");
  const ownerSignoff = signoffs.find(s => s.role === "OWNER");

  const categories = [...new Set(items.map(i => i.category))];

  const cycleStatus = (item: HandoverItem) => {
    const order: HandoverItem["status"][] = ["PENDING", "COMPLETE", "NOT_APPLICABLE"];
    const next = order[(order.indexOf(item.status) + 1) % order.length];
    updateItemMutation.mutate({ id: item.id, data: { status: next } });
  };

  if (itemsLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ClipboardCheck className="w-12 h-12 text-muted-foreground mb-4 opacity-40" />
        <h3 className="text-lg font-semibold mb-1">No Handover Checklist Yet</h3>
        <p className="text-muted-foreground text-sm mb-6 max-w-sm">
          Create a handover checklist to track keys, manuals, certificates, and equipment transfers.
        </p>
        {isMgr && (
          <div className="flex gap-2">
            <Button onClick={() => seedDefaultsMutation.mutate()} disabled={seedDefaultsMutation.isPending} data-testid="button-seed-handover">
              {seedDefaultsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
              Use Default Checklist
            </Button>
            <Button variant="outline" onClick={() => setShowAddDialog(true)} data-testid="button-add-handover-item">
              <Plus className="w-4 h-4 mr-2" /> Add Custom Item
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Asset Handover Checklist</h2>
          <p className="text-sm text-muted-foreground">{completedItems} of {totalItems} items complete ({progressPct}%)</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open(`/api/projects/${projectCode}/handover/export`, "_blank")} data-testid="button-export-handover">
            <Download className="w-4 h-4 mr-2" /> Export Summary
          </Button>
          {isMgr && (
            <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)} data-testid="button-add-handover-item">
              <Plus className="w-4 h-4 mr-2" /> Add Item
            </Button>
          )}
        </div>
      </div>

      <Progress value={progressPct} className="h-2" data-testid="progress-handover" />

      {categories.map(cat => {
        const CatIcon = CATEGORY_ICONS[cat] || FileText;
        const catItems = items.filter(i => i.category === cat);
        return (
          <Card key={cat} data-testid={`card-handover-category-${cat}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CatIcon className="w-4 h-4 text-muted-foreground" />
                {cat}
                <span className="text-xs text-muted-foreground ml-auto">
                  {catItems.filter(i => i.status === "COMPLETE").length}/{catItems.filter(i => i.status !== "NOT_APPLICABLE").length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {catItems.map(item => {
                const st = STATUS_STYLES[item.status];
                const StIcon = st.icon;
                return (
                  <div key={item.id} className="flex items-center gap-3 py-2 border-b last:border-0" data-testid={`row-handover-item-${item.id}`}>
                    <button
                      type="button"
                      className={`shrink-0 ${st.color}`}
                      onClick={() => isMgr && cycleStatus(item)}
                      disabled={!isMgr}
                      data-testid={`button-toggle-handover-${item.id}`}
                    >
                      <StIcon className="w-5 h-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${item.status === "NOT_APPLICABLE" ? "line-through text-muted-foreground" : ""}`}>
                        {item.title}
                      </span>
                      {item.description && (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      )}
                    </div>
                    {item.documentUrl ? (
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        data-testid={`link-document-${item.id}`}
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/projects/${projectCode}/handover/items/${item.id}/signed-url`, { credentials: "include" });
                            if (!res.ok) {
                              toast({ title: "Error", description: "Could not access this file.", variant: "destructive" });
                              return;
                            }
                            const data = await res.json();
                            if (data.url) {
                              window.open(data.url, "_blank");
                            }
                          } catch {
                            toast({ title: "Error", description: "Failed to open file.", variant: "destructive" });
                          }
                        }}
                      >
                        <Download className="w-3 h-3" /> {item.documentFilename || "Document"}
                      </button>
                    ) : isMgr && (
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={MAX_STORAGE_FILE_SIZE}
                        fileType="DOCUMENT"
                        onComplete={(result) => {
                          const f = result.successful?.[0];
                          if (f) {
                            const url = f.uploadURL ?? "";
                            const filename = f.name ?? "document";
                            updateItemMutation.mutate({ id: item.id, data: { documentUrl: url, documentFilename: filename } });
                          }
                        }}
                        buttonVariant="ghost"
                        buttonClassName="h-6 px-2"
                        testId={`button-upload-document-${item.id}`}
                      >
                        <Upload className="w-3 h-3 mr-1" />
                        <span className="text-xs">Attach</span>
                      </ObjectUploader>
                    )}
                    {item.completedAt && (
                      <span className="text-xs text-muted-foreground">{fmtDate(item.completedAt)}</span>
                    )}
                    {isMgr && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" data-testid={`button-delete-handover-${item.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Item</AlertDialogTitle>
                            <AlertDialogDescription>Delete "{item.title}" from the handover checklist?</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteItemMutation.mutate(item.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      <Card data-testid="card-handover-signoffs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PenLine className="w-4 h-4 text-muted-foreground" />
            Handover Signoff
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`p-4 rounded-lg border ${contractorSignoff ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-dashed"}`}>
              <div className="flex items-center gap-2 mb-1">
                {contractorSignoff ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                <span className="text-sm font-semibold">Contractor</span>
              </div>
              {contractorSignoff ? (
                <div className="text-xs text-muted-foreground">
                  <p>Signed by {contractorSignoff.signedByName}</p>
                  <p>{fmtDate(contractorSignoff.signedAt)}</p>
                  {contractorSignoff.notes && <p className="mt-1 italic">"{contractorSignoff.notes}"</p>}
                </div>
              ) : (
                isMgr && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => { setSignoffRole("CONTRACTOR"); setShowSignoffDialog(true); }} data-testid="button-signoff-contractor">
                    Sign Off as Contractor
                  </Button>
                )
              )}
            </div>
            <div className={`p-4 rounded-lg border ${ownerSignoff ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-dashed"}`}>
              <div className="flex items-center gap-2 mb-1">
                {ownerSignoff ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                <span className="text-sm font-semibold">Owner / Client</span>
              </div>
              {ownerSignoff ? (
                <div className="text-xs text-muted-foreground">
                  <p>Signed by {ownerSignoff.signedByName}</p>
                  <p>{fmtDate(ownerSignoff.signedAt)}</p>
                  {ownerSignoff.notes && <p className="mt-1 italic">"{ownerSignoff.notes}"</p>}
                </div>
              ) : (
                isMgr && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => { setSignoffRole("OWNER"); setShowSignoffDialog(true); }} data-testid="button-signoff-owner">
                    Sign Off as Owner
                  </Button>
                )
              )}
            </div>
          </div>
          {contractorSignoff && ownerSignoff && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-green-800 dark:text-green-300">Handover Complete — Both parties have signed off.</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Handover Item</DialogTitle>
            <DialogDescription>Add a new item to the handover checklist.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select value={newItem.category} onValueChange={v => setNewItem(p => ({ ...p, category: v }))}>
                <SelectTrigger data-testid="select-handover-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Keys & Access", "Documentation", "Certificates", "Equipment", "Other"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={newItem.title} onChange={e => setNewItem(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Building Keys" data-testid="input-handover-title" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))} rows={2} data-testid="input-handover-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createItemMutation.mutate({ title: newItem.title, category: newItem.category, description: newItem.description || null })}
              disabled={!newItem.title.trim() || createItemMutation.isPending}
              data-testid="button-submit-handover-item"
            >
              {createItemMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSignoffDialog} onOpenChange={setShowSignoffDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Handover Signoff — {signoffRole === "CONTRACTOR" ? "Contractor" : "Owner / Client"}</DialogTitle>
            <DialogDescription>Acknowledge receipt and sign off on the handover.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={signoffNotes} onChange={e => setSignoffNotes(e.target.value)} rows={3} placeholder="Any notes or conditions..." data-testid="input-signoff-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSignoffDialog(false)}>Cancel</Button>
            <Button
              onClick={() => signoffMutation.mutate({ role: signoffRole, notes: signoffNotes || null })}
              disabled={signoffMutation.isPending}
              data-testid="button-confirm-signoff"
            >
              {signoffMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenLine className="w-4 h-4 mr-2" />}
              Sign Off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
