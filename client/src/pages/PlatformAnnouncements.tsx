import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, Plus, Pencil, Trash2, Megaphone } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Announcement {
  id: string;
  title: string;
  message: string;
  targetOrgIds: string[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface Organization {
  id: string;
  name: string;
}

export default function PlatformAnnouncements() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", message: "", isActive: true, expiresAt: "", targetOrgIds: "" });

  const { data: announcements, isLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/platform/announcements"],
  });

  const { data: orgs } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/platform/announcements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Announcement created" });
    },
    onError: (e: Error) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/platform/announcements/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Announcement updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/platform/announcements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
      toast({ title: "Announcement deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/platform/announcements/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
    },
  });

  const resetForm = () => {
    setForm({ title: "", message: "", isActive: true, expiresAt: "", targetOrgIds: "" });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      message: a.message,
      isActive: a.isActive,
      expiresAt: a.expiresAt ? a.expiresAt.split("T")[0] : "",
      targetOrgIds: a.targetOrgIds?.join(", ") || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const targetOrgIds = form.targetOrgIds.trim()
      ? form.targetOrgIds.split(",").map(s => s.trim()).filter(Boolean)
      : null;
    const payload = {
      title: form.title,
      message: form.message,
      isActive: form.isActive,
      expiresAt: form.expiresAt || null,
      targetOrgIds,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const getOrgName = (id: string) => orgs?.find(o => o.id === id)?.name || id;

  return (
    <div className="min-h-screen bg-background">
      <main className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold" data-testid="text-announcements-title">Platform Announcements</h1>
            <p className="text-muted-foreground">Manage platform-wide announcements shown to all organizations</p>
          </div>
          <Button onClick={openCreate} data-testid="button-create-announcement">
            <Plus className="h-4 w-4 mr-2" />
            New Announcement
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              All Announcements
            </CardTitle>
            <CardDescription>{announcements?.length || 0} total announcements</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : !announcements?.length ? (
              <p className="text-muted-foreground text-center py-8">No announcements yet. Create one to get started.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {announcements.map((a) => (
                    <TableRow key={a.id} data-testid={`row-announcement-${a.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{a.title}</p>
                          <p className="text-sm text-muted-foreground line-clamp-1">{a.message}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={a.isActive}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: a.id, isActive: checked })}
                          data-testid={`switch-announcement-active-${a.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        {a.targetOrgIds?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {a.targetOrgIds.slice(0, 2).map(id => (
                              <Badge key={id} variant="outline" className="text-xs">{getOrgName(id)}</Badge>
                            ))}
                            {a.targetOrgIds.length > 2 && (
                              <Badge variant="outline" className="text-xs">+{a.targetOrgIds.length - 2}</Badge>
                            )}
                          </div>
                        ) : (
                          <Badge variant="secondary">All Orgs</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.expiresAt ? format(new Date(a.expiresAt), "MMM d, yyyy") : "Never"}
                      </TableCell>
                      <TableCell>{format(new Date(a.createdAt), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)} data-testid={`button-edit-announcement-${a.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(a.id)} data-testid={`button-delete-announcement-${a.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Announcement" : "New Announcement"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Announcement title"
                  data-testid="input-announcement-title"
                />
              </div>
              <div>
                <Label>Message</Label>
                <Textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Announcement message..."
                  rows={4}
                  data-testid="input-announcement-message"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={checked => setForm(f => ({ ...f, isActive: checked }))}
                  data-testid="switch-announcement-form-active"
                />
                <Label>Active</Label>
              </div>
              <div>
                <Label>Expires At (optional)</Label>
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                  data-testid="input-announcement-expires"
                />
              </div>
              <div>
                <Label>Target Org IDs (comma-separated, leave empty for all)</Label>
                <Input
                  value={form.targetOrgIds}
                  onChange={e => setForm(f => ({ ...f, targetOrgIds: e.target.value }))}
                  placeholder="Leave empty to target all organizations"
                  data-testid="input-announcement-targets"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={!form.title || !form.message || createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-announcement"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
