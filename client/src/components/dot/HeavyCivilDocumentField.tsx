import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_BATCH_UPLOAD_FILES } from "@/lib/uploadLimits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileText, History, Download, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UploadResultFile {
  uploadURL?: string;
  data?: { name?: string; size?: number; type?: string } | File;
  name?: string;
  size?: number;
  type?: string;
}

interface UploadCompleteResult {
  successful?: UploadResultFile[];
}

interface CreatedDoc {
  id: string;
  title: string;
  fileName: string;
  fileUrl: string;
}

interface DocumentRevision {
  id: string;
  revisionNumber: number;
  status: string;
  storageKey: string | null;
  createdAt: string;
  createdByUserId?: string | null;
  metadata?: { fileName?: string; fileSize?: number; mimeType?: string } | null;
}

function formatBytes(n?: number) {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

interface UserLite { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }

function RevisionHistoryList({ revisions, testId }: { revisions: DocumentRevision[]; testId: string }) {
  const { data: users = [] } = useQuery<UserLite[]>({
    queryKey: ["/api/users"],
    enabled: revisions.length > 0,
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const uploaderName = (id: string | null | undefined) => {
    if (!id) return "Unknown";
    const u = userById.get(id);
    if (!u) return id.slice(0, 8);
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return name || u.email || id.slice(0, 8);
  };
  if (revisions.length === 0) return null;
  const sorted = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  return (
    <details className="mt-2 text-xs" data-testid={`history-${testId}`}>
      <summary className="cursor-pointer text-muted-foreground hover-elevate inline-block px-1 rounded">
        <History className="h-3 w-3 inline mr-1" />
        Revision history ({revisions.length})
      </summary>
      <ul className="mt-1 space-y-1 border-l-2 border-muted pl-3">
        {sorted.map((rev) => {
          const meta = rev.metadata ?? {};
          return (
            <li key={rev.id} className="flex items-center justify-between gap-2" data-testid={`history-row-${testId}-${rev.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={rev.status === "active" ? "default" : "outline"} className="text-[10px]">
                    Rev {rev.revisionNumber}
                  </Badge>
                  {rev.status !== "active" && (
                    <span className="text-[10px] text-muted-foreground">{rev.status}</span>
                  )}
                  <span className="text-muted-foreground">
                    {new Date(rev.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  by {uploaderName(rev.createdByUserId)}
                  {meta.fileName ? ` · ${meta.fileName}` : ""}
                  {meta.fileSize ? ` · ${formatBytes(meta.fileSize)}` : ""}
                </div>
              </div>
              {rev.storageKey && (
                <a
                  className="text-xs underline shrink-0"
                  href={`/api/documents/revisions/${rev.id}/preview-url`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`history-download-${testId}-${rev.id}`}
                >
                  <Download className="h-3 w-3 inline" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

async function createDocumentAndInitialRevision(opts: {
  projectId?: string | null;
  scope?: "PROJECT" | "ORG";
  title: string;
  type: string;
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
}): Promise<CreatedDoc> {
  const isOrgScoped = opts.scope === "ORG";
  const docRes = await apiRequest("POST", "/api/documents", {
    scope: isOrgScoped ? "ORG" : "PROJECT",
    projectId: isOrgScoped ? null : opts.projectId,
    title: opts.title,
    type: opts.type,
    fileUrl: opts.fileUrl,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
    mimeType: opts.mimeType,
    objectKey: opts.fileUrl,
  });
  const doc = (await docRes.json()) as CreatedDoc;
  await apiRequest("POST", `/api/documents/${doc.id}/revisions`, {
    sourceType: "upload",
    storageKey: opts.fileUrl,
    metadata: {
      fileName: opts.fileName,
      fileSize: opts.fileSize,
      mimeType: opts.mimeType,
    },
  });
  return doc;
}

async function uploadAndCreateRevision(opts: {
  documentId: string;
  fileUrl: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}): Promise<DocumentRevision> {
  const r = await apiRequest("POST", `/api/documents/${opts.documentId}/revisions`, {
    sourceType: "upload",
    storageKey: opts.fileUrl,
    metadata: {
      fileName: opts.fileName,
      fileSize: opts.fileSize,
      mimeType: opts.mimeType,
    },
  });
  return (await r.json()) as DocumentRevision;
}

interface SingleProps {
  documentId: string | null | undefined;
  // `projectId` is required for project-scoped uploads. Pass `scope="ORG"`
  // (and omit/null `projectId`) for org-scoped uploads such as CRM
  // organisation certifications introduced in Task #491.
  projectId?: string | null;
  scope?: "PROJECT" | "ORG";
  title: string;
  docType?: string;
  label?: string;
  testId: string;
  onChange: (documentId: string) => void;
  disabled?: boolean;
}

export function HeavyCivilDocumentField({
  documentId,
  projectId,
  scope = "PROJECT",
  title,
  docType = "OTHER",
  label = "Attachment",
  testId,
  onChange,
  disabled,
}: SingleProps) {
  const isOrgScoped = scope === "ORG";
  const canUpload = isOrgScoped || !!projectId;
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data: revisions = [], isLoading: revsLoading } = useQuery<DocumentRevision[]>({
    queryKey: ["/api/documents", documentId, "revisions"],
    enabled: !!documentId,
  });

  const handleComplete = async (result: UploadCompleteResult) => {
    const f = result.successful?.[0];
    if (!f?.uploadURL) {
      toast({ title: "Upload incomplete", variant: "destructive" });
      return;
    }
    const data = (f.data ?? {}) as { name?: string; size?: number; type?: string };
    const fileName = data.name ?? f.name ?? "upload";
    const fileSize = data.size ?? f.size;
    const mimeType = data.type ?? f.type;

    setBusy(true);
    try {
      if (documentId) {
        await uploadAndCreateRevision({ documentId, fileUrl: f.uploadURL, fileName, fileSize, mimeType });
        await queryClient.invalidateQueries({ queryKey: ["/api/documents", documentId, "revisions"] });
        toast({ title: "New revision uploaded" });
      } else {
        if (!isOrgScoped && !projectId) {
          toast({ title: "Select a project first", variant: "destructive" });
          return;
        }
        const doc = await createDocumentAndInitialRevision({
          projectId: isOrgScoped ? null : projectId,
          scope: isOrgScoped ? "ORG" : "PROJECT",
          title,
          type: docType,
          fileUrl: f.uploadURL,
          fileName,
          fileSize,
          mimeType,
        });
        onChange(doc.id);
        toast({ title: "Document attached" });
      }
    } catch (err) {
      toast({
        title: "Failed to attach document",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const activeRevision = revisions.find((r) => r.status === "active") ?? revisions[0];

  return (
    <div className="space-y-2" data-testid={`field-${testId}`}>
      {documentId ? (
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{label}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  {revsLoading ? (
                    <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Loading…</span>
                  ) : activeRevision ? (
                    <>
                      <Badge variant="outline" className="text-xs">Rev {activeRevision.revisionNumber}</Badge>
                      <span>{revisions.length} revision{revisions.length === 1 ? "" : "s"}</span>
                    </>
                  ) : (
                    <span>No active revision</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {activeRevision && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  asChild
                  data-testid={`button-${testId}-download`}
                >
                  <a href={`/api/documents/revisions/${activeRevision.id}/preview-url`} target="_blank" rel="noreferrer">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange("")}
                data-testid={`button-${testId}-detach`}
                disabled={disabled || busy}
                aria-label="Detach"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ObjectUploader
              maxNumberOfFiles={1}
              fileType="DOCUMENT"
              onComplete={handleComplete}
              testId={`uploader-${testId}-replace`}
            >
              <Button type="button" size="sm" variant="outline" disabled={disabled || busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-2" />}
                Replace (new revision)
              </Button>
            </ObjectUploader>
          </div>
          <RevisionHistoryList revisions={revisions} testId={testId} />
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-3 flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">{label}: none attached</div>
          <ObjectUploader
            maxNumberOfFiles={1}
            fileType="DOCUMENT"
            onComplete={handleComplete}
            testId={`uploader-${testId}`}
          >
            <Button type="button" size="sm" variant="outline" disabled={disabled || busy || !canUpload}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-2" />}
              Upload
            </Button>
          </ObjectUploader>
        </div>
      )}
      {!canUpload && !documentId && (
        <p className="text-xs text-muted-foreground">Select a project before uploading.</p>
      )}
    </div>
  );
}

interface MultiProps {
  documentIds: string[];
  projectId: string;
  titleBase: string;
  docType?: string;
  label?: string;
  testId: string;
  onChange: (documentIds: string[]) => void;
  disabled?: boolean;
}

export function HeavyCivilDocumentList({
  documentIds,
  projectId,
  titleBase,
  docType = "OTHER",
  label = "Attachments",
  testId,
  onChange,
  disabled,
}: MultiProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleComplete = async (result: UploadCompleteResult) => {
    if (!projectId) {
      toast({ title: "Select a project first", variant: "destructive" });
      return;
    }
    const files = result.successful ?? [];
    if (files.length === 0) return;
    setBusy(true);
    const newIds: string[] = [];
    try {
      for (const f of files) {
        if (!f.uploadURL) continue;
        const data = (f.data ?? {}) as { name?: string; size?: number; type?: string };
        const fileName = data.name ?? f.name ?? "upload";
        const doc = await createDocumentAndInitialRevision({
          projectId,
          title: `${titleBase} — ${fileName}`,
          type: docType,
          fileUrl: f.uploadURL,
          fileName,
          fileSize: data.size ?? f.size,
          mimeType: data.type ?? f.type,
        });
        newIds.push(doc.id);
      }
      if (newIds.length > 0) {
        onChange([...documentIds, ...newIds]);
        toast({ title: `${newIds.length} document${newIds.length === 1 ? "" : "s"} attached` });
      }
    } catch (err) {
      toast({
        title: "Failed to attach document(s)",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid={`field-${testId}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{label}</div>
        <ObjectUploader
          maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES}
          fileType="DOCUMENT"
          onComplete={handleComplete}
          testId={`uploader-${testId}`}
        >
          <Button type="button" size="sm" variant="outline" disabled={disabled || busy || !projectId}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-2" />}
            Add file(s)
          </Button>
        </ObjectUploader>
      </div>
      {documentIds.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
          No files attached.
        </div>
      ) : (
        <ul className="space-y-1">
          {documentIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm" data-testid={`row-${testId}-${id}`}>
              <DocumentSummary documentId={id} testId={`${testId}-${id}`} />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(documentIds.filter((d) => d !== id))}
                data-testid={`button-${testId}-remove-${id}`}
                aria-label="Remove"
                disabled={disabled || busy}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!projectId && (
        <p className="text-xs text-muted-foreground">Select a project before uploading.</p>
      )}
    </div>
  );
}

function DocumentSummary({ documentId, testId }: { documentId: string; testId: string }) {
  const { data, isLoading } = useQuery<{ id: string; title: string; fileName: string }>({
    queryKey: ["/api/documents", documentId],
  });
  const { data: revs = [] } = useQuery<DocumentRevision[]>({
    queryKey: ["/api/documents", documentId, "revisions"],
  });
  const active = revs.find((r) => r.status === "active") ?? revs[0];
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1" data-testid={`text-${testId}`}>
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate">
            {isLoading ? "Loading…" : data?.title ?? data?.fileName ?? documentId}
          </div>
          {active && <div className="text-xs text-muted-foreground">Rev {active.revisionNumber} · {revs.length} total</div>}
        </div>
        {active && (
          <Button type="button" size="sm" variant="ghost" asChild aria-label="Download">
            <a href={`/api/documents/revisions/${active.id}/preview-url`} target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
      <RevisionHistoryList revisions={revs} testId={testId} />
    </div>
  );
}
