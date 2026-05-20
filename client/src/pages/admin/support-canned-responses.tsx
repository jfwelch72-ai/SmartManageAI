import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ChevronLeft,
  Plus,
  Pencil,
  Search,
  Trash2,
  MessageSquareText,
  Loader2,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SupportCannedResponse } from "@shared/schema";

interface CannedResponseForm {
  title: string;
  body: string;
}

function CannedResponseEditor({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: CannedResponseForm;
  onSave: (data: CannedResponseForm) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4" data-testid="canned-response-editor">
      <div className="space-y-1">
        <Label htmlFor="cr-title" className="text-xs font-medium">Title</Label>
        <Input
          id="cr-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Thanks for reaching out"
          maxLength={200}
          data-testid="input-canned-response-title"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cr-body" className="text-xs font-medium">Response body</Label>
        <Textarea
          id="cr-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type the canned response text here…"
          rows={6}
          maxLength={20_000}
          data-testid="input-canned-response-body"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending} data-testid="button-canned-response-cancel">
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
        <Button
          size="sm"
          disabled={!title.trim() || !body.trim() || isPending}
          onClick={() => onSave({ title: title.trim(), body: body.trim() })}
          data-testid="button-canned-response-save"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export default function AdminCannedResponsesPage() {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ cannedResponses: SupportCannedResponse[] }>({
    queryKey: ["/api/support/canned-responses"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/support/canned-responses");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (form: CannedResponseForm) => {
      const res = await apiRequest("POST", "/api/support/canned-responses", form);
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/canned-responses"] });
      setShowCreateForm(false);
      toast({ title: "Canned response created" });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: CannedResponseForm }) => {
      const res = await apiRequest("PATCH", `/api/support/canned-responses/${id}`, form);
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/canned-responses"] });
      setEditingId(null);
      toast({ title: "Canned response updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/support/canned-responses/${id}`);
      if (!res.ok && res.status !== 204) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/canned-responses"] });
      setDeletingId(null);
      toast({ title: "Canned response deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const responses = data?.cannedResponses ?? [];
  const deletingResponse = responses.find((r) => r.id === deletingId);
  const searchLower = search.toLowerCase();
  const filteredResponses = search.trim()
    ? responses.filter(
        (r) =>
          r.title.toLowerCase().includes(searchLower) ||
          r.body.toLowerCase().includes(searchLower)
      )
    : responses;

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Link href="/admin/support-tickets">
            <Button variant="ghost" size="sm" className="gap-1" data-testid="link-back-support">
              <ChevronLeft className="h-4 w-4" />
              Support Tickets
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="heading-canned-responses">
              <MessageSquareText className="h-6 w-6" />
              Canned Responses
            </h1>
            <p className="text-muted-foreground text-sm">Reusable reply templates for the support team</p>
          </div>
          <Button
            size="sm"
            onClick={() => { setShowCreateForm(true); setEditingId(null); }}
            disabled={showCreateForm}
            data-testid="button-new-canned-response"
          >
            <Plus className="h-4 w-4 mr-1" /> New Template
          </Button>
        </div>

        {showCreateForm && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">New canned response</CardTitle>
            </CardHeader>
            <CardContent>
              <CannedResponseEditor
                onSave={(form) => createMutation.mutate(form)}
                onCancel={() => setShowCreateForm(false)}
                isPending={createMutation.isPending}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Templates ({responses.length})</CardTitle>
            <CardDescription>
              Select a template in the reply composer to pre-fill the reply body. Templates are editable before sending.
            </CardDescription>
            {responses.length > 0 && (
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search by title or body…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  data-testid="input-canned-response-filter"
                />
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : responses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground" data-testid="empty-state-canned-responses">
                <MessageSquareText className="h-10 w-10" />
                <p className="text-sm font-medium">No templates yet</p>
                <p className="text-xs">Click "New Template" to create your first canned response.</p>
              </div>
            ) : filteredResponses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground" data-testid="empty-state-canned-responses-filtered">
                <Search className="h-8 w-8" />
                <p className="text-sm font-medium">No templates match "{search}"</p>
                <p className="text-xs">Try a different keyword.</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredResponses.map((r) => (
                  <div key={r.id} className="p-4 space-y-2" data-testid={`canned-response-${r.id}`}>
                    {editingId === r.id ? (
                      <CannedResponseEditor
                        initial={{ title: r.title, body: r.body }}
                        onSave={(form) => updateMutation.mutate({ id: r.id, form })}
                        onCancel={() => setEditingId(null)}
                        isPending={updateMutation.isPending}
                      />
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm" data-testid={`canned-response-title-${r.id}`}>{r.title}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => { setEditingId(r.id); setShowCreateForm(false); }}
                              data-testid={`button-edit-canned-response-${r.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              onClick={() => setDeletingId(r.id)}
                              data-testid={`button-delete-canned-response-${r.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap" data-testid={`canned-response-body-preview-${r.id}`}>
                          {r.body}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!deletingId} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete canned response?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deletingResponse?.title}" will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
