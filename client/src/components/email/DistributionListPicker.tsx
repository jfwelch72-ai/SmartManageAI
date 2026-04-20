import { useCallback, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Save, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DistributionList {
  id: string;
  name: string;
  contactEmails: string[];
  extraEmails: string[];
  /** null when the list is shared across the entire organization. */
  projectId: string | null;
  updatedAt: string;
}

export type DistributionListScope = "PROJECT" | "ORGANIZATION";

export function projectDistributionListsQueryKey(projectId: string) {
  return ["/api/projects", projectId, "distribution-lists"] as const;
}

export function useProjectDistributionLists(projectId: string, enabled = true) {
  return useQuery<{ lists: DistributionList[] }>({
    queryKey: projectDistributionListsQueryKey(projectId),
    enabled: enabled && !!projectId,
  });
}

export function useDeleteProjectDistributionList(projectId: string) {
  return useMutation({
    mutationFn: async (listId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/projects/${projectId}/distribution-lists/${listId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectDistributionListsQueryKey(projectId),
      });
    },
  });
}

export function useSaveProjectDistributionList(projectId: string) {
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      contactEmails: string[];
      extraEmails: string[];
      scope?: DistributionListScope;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/distribution-lists`,
        vars,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectDistributionListsQueryKey(projectId),
      });
    },
  });
}

interface SavedDistributionListsProps {
  projectId: string;
  enabled?: boolean;
  loading?: boolean;
  loadingHint?: string;
  onLoad: (list: DistributionList) => void;
  label?: string;
  emptyHint?: string;
  testIdPrefix?: string;
}

export function SavedDistributionLists({
  projectId,
  enabled = true,
  loading = false,
  loadingHint,
  onLoad,
  label = "Saved distribution lists",
  emptyHint,
  testIdPrefix = "distribution-list",
}: SavedDistributionListsProps) {
  const { toast } = useToast();
  const { data } = useProjectDistributionLists(projectId, enabled);
  const lists = data?.lists || [];
  const deleteMutation = useDeleteProjectDistributionList(projectId);

  if (lists.length === 0) {
    if (!emptyHint) return null;
    return (
      <div>
        <Label className="mb-2 block">{label}</Label>
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <div className="space-y-1 rounded border p-2">
        {lists.map((list) => {
          const total = list.contactEmails.length + list.extraEmails.length;
          const isOrg = list.projectId === null;
          return (
            <div
              key={list.id}
              className="flex items-center justify-between gap-2 p-1.5 rounded hover-elevate"
              data-testid={`row-${testIdPrefix}-${list.id}`}
            >
              <button
                type="button"
                className="flex-1 min-w-0 text-left disabled:opacity-50"
                onClick={() => onLoad(list)}
                disabled={loading}
                title={loading ? loadingHint : undefined}
                data-testid={`button-load-${testIdPrefix}-${list.id}`}
              >
                <div
                  className="text-sm font-medium truncate flex items-center gap-2"
                  data-testid={`text-${testIdPrefix}-name-${list.id}`}
                >
                  <span className="truncate">{list.name}</span>
                  {isOrg && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] shrink-0"
                      data-testid={`badge-${testIdPrefix}-scope-${list.id}`}
                    >
                      Organization
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {total} recipient{total === 1 ? "" : "s"}
                </div>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  deleteMutation.mutate(list.id, {
                    onSuccess: () =>
                      toast({ title: "Distribution list deleted" }),
                    onError: (err: Error) =>
                      toast({
                        title: "Failed to delete list",
                        description:
                          err.message || "Unable to delete distribution list",
                        variant: "destructive",
                      }),
                  });
                }}
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-${testIdPrefix}-${list.id}`}
                aria-label={`Delete ${list.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SaveDistributionListDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collect: () => { contactEmails: string[]; extraEmails: string[] } | null;
  onSaved?: (list: DistributionList) => void;
  /** When true, shows a checkbox to share the saved list across the whole organization. */
  allowOrgScope?: boolean;
}

export function SaveDistributionListDialog({
  projectId,
  open,
  onOpenChange,
  collect,
  onSaved,
  allowOrgScope = false,
}: SaveDistributionListDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [orgScope, setOrgScope] = useState(false);
  const saveMutation = useSaveProjectDistributionList(projectId);

  const reset = useCallback(() => {
    setName("");
    setOrgScope(false);
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({
        title: "Name required",
        description: "Give the list a name before saving.",
        variant: "destructive",
      });
      return;
    }
    const collected = collect();
    if (!collected) return;
    const { contactEmails, extraEmails } = collected;
    if (contactEmails.length === 0 && extraEmails.length === 0) {
      toast({
        title: "List is empty",
        description: "Add at least one recipient before saving.",
        variant: "destructive",
      });
      return;
    }
    const scope: DistributionListScope =
      allowOrgScope && orgScope ? "ORGANIZATION" : "PROJECT";
    saveMutation.mutate(
      { name: trimmed, contactEmails, extraEmails, scope },
      {
        onSuccess: (data: { list: DistributionList }) => {
          const isOrg = data.list.projectId === null;
          toast({
            title: isOrg ? "Organization list saved" : "Distribution list saved",
            description: isOrg
              ? `"${data.list.name}" is now available across every project.`
              : `"${data.list.name}" can be reused for future sends.`,
          });
          reset();
          onOpenChange(false);
          onSaved?.(data.list);
        },
        onError: (err: Error) => {
          toast({
            title: "Failed to save list",
            description: err.message || "Unable to save distribution list",
            variant: "destructive",
          });
        },
      },
    );
  }, [
    allowOrgScope,
    collect,
    name,
    onOpenChange,
    onSaved,
    orgScope,
    reset,
    saveMutation,
    toast,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saveMutation.isPending) onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save distribution list</DialogTitle>
          <DialogDescription>
            Save the current recipients as a reusable list for this project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="distribution-list-name">List name</Label>
            <Input
              id="distribution-list-name"
              placeholder="e.g. Weekly progress meeting"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-distribution-list-name"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saving with an existing name will overwrite that list.
            </p>
          </div>
          {allowOrgScope && (
            <label
              className="flex items-start gap-2 p-2 rounded border cursor-pointer hover-elevate"
              data-testid="row-distribution-list-scope"
            >
              <Checkbox
                checked={orgScope}
                onCheckedChange={(v) => setOrgScope(v === true)}
                data-testid="checkbox-distribution-list-org-scope"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  Share with the whole organization
                </div>
                <div className="text-xs text-muted-foreground">
                  Available on every project, not just this one.
                </div>
              </div>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
            data-testid="button-cancel-save-list"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-confirm-save-list"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
