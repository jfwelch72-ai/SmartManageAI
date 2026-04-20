import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Pencil, Trash2, Users, Loader2, Mail } from "lucide-react";

interface OrgDistributionList {
  id: string;
  name: string;
  contactEmails: string[];
  extraEmails: string[];
  projectId: string | null;
  updatedAt: string;
}

const QUERY_KEY = ["/api/distribution-lists"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmails(input: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/[\s,;]+/)) {
    const e = raw.trim();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      bad.push(e);
      continue;
    }
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    ok.push(e);
  }
  return { ok, bad };
}

function ListEditor({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: OrgDistributionList | null;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [emailsText, setEmailsText] = useState(
    initial ? [...initial.contactEmails, ...initial.extraEmails].join(", ") : "",
  );

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setEmailsText(initial ? [...initial.contactEmails, ...initial.extraEmails].join(", ") : "");
    }
  }, [open, initial]);

  const saveMutation = useMutation({
    mutationFn: async (vars: { name: string; extraEmails: string[] }) => {
      if (initial) {
        const res = await apiRequest("PATCH", `/api/distribution-lists/${initial.id}`, {
          name: vars.name,
          contactEmails: [],
          extraEmails: vars.extraEmails,
        });
        return res.json();
      }
      const res = await apiRequest("POST", "/api/distribution-lists", {
        name: vars.name,
        contactEmails: [],
        extraEmails: vars.extraEmails,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: initial ? "List updated" : "List created" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save list",
        description: err.message || "Unable to save distribution list",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const { ok, bad } = parseEmails(emailsText);
    if (bad.length > 0) {
      toast({
        title: "Invalid email address",
        description: `Could not parse: ${bad.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    if (ok.length === 0) {
      toast({ title: "Add at least one email", variant: "destructive" });
      return;
    }
    saveMutation.mutate({ name: trimmed, extraEmails: ok });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saveMutation.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit organization list" : "New organization list"}</DialogTitle>
          <DialogDescription>
            Organization-wide lists are available in the Send Gantt dialog on every project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="org-list-name">List name</Label>
            <Input
              id="org-list-name"
              placeholder="e.g. Owner weekly update"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-org-list-name"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-list-emails">Recipients</Label>
            <Textarea
              id="org-list-emails"
              rows={5}
              placeholder="alice@example.com, bob@example.com"
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              data-testid="textarea-org-list-emails"
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple addresses with commas, semicolons, spaces, or new lines.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
            data-testid="button-cancel-org-list"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save-org-list"
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initial ? "Save changes" : "Create list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrgDistributionListsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<OrgDistributionList | null>(null);

  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data, isLoading } = useQuery<{ lists: OrgDistributionList[] }>({
    queryKey: QUERY_KEY,
  });
  const lists = useMemo(() => data?.lists ?? [], [data]);

  const deleteMutation = useMutation({
    mutationFn: async (listId: string) => {
      const res = await apiRequest("DELETE", `/api/distribution-lists/${listId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "List deleted" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to delete list",
        description: err.message || "Unable to delete list",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Organization distribution lists
          </CardTitle>
          <CardDescription>
            Reusable email recipient groups available in the Send Gantt dialog on every project.
          </CardDescription>
        </div>
        {canManage && (
          <Button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            data-testid="button-new-org-list"
          >
            <Plus className="w-4 h-4 mr-2" />
            New list
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground" data-testid="text-org-lists-loading">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading lists…
          </div>
        ) : lists.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8" data-testid="text-org-lists-empty">
            No organization-wide lists yet. {canManage ? "Click \"New list\" to create one." : "Ask an admin to create one."}
          </div>
        ) : (
          <div className="space-y-2">
            {lists.map((list) => {
              const total = list.contactEmails.length + list.extraEmails.length;
              const allEmails = [...list.contactEmails, ...list.extraEmails];
              return (
                <div
                  key={list.id}
                  className="flex items-start justify-between gap-3 p-3 rounded border hover-elevate"
                  data-testid={`row-org-list-${list.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate" data-testid={`text-org-list-name-${list.id}`}>
                        {list.name}
                      </span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {total} recipient{total === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1" data-testid={`text-org-list-emails-${list.id}`}>
                      {allEmails.slice(0, 5).join(", ")}{allEmails.length > 5 ? `, +${allEmails.length - 5} more` : ""}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => { setEditing(list); setEditorOpen(true); }}
                        data-testid={`button-edit-org-list-${list.id}`}
                        aria-label={`Edit ${list.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => deleteMutation.mutate(list.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-org-list-${list.id}`}
                        aria-label={`Delete ${list.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {canManage && (
        <ListEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          initial={editing}
        />
      )}
    </Card>
  );
}

export default OrgDistributionListsTab;
