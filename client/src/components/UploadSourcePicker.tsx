import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  HardDrive,
  Link as LinkIcon,
  ArrowLeft,
  Lock,
  ExternalLink,
  Loader2,
  Folder,
  FileText,
  Search,
  ThumbsUp,
} from "lucide-react";
import { SiDropbox, SiGoogledrive, SiBox } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

function OneDriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M14.22 4.5a7.25 7.25 0 0 0-6.75 4.6A5.75 5.75 0 0 0 1 14.75a5.72 5.72 0 0 0 2.09 4.42l8.18-4.87 4.58 2.73 6.65-3.96A5.5 5.5 0 0 0 17 8a5.47 5.47 0 0 0-2.78.75z" opacity=".5" />
      <path d="M11.27 14.3l-8.18 4.87A5.72 5.72 0 0 0 7.25 20.5h11.5a5.49 5.49 0 0 0 3.75-1.47l-6.65-3.96z" />
      <path d="M14.22 4.5a7.19 7.19 0 0 0-3.58.95l4.94 8.12 6.92-4.12A5.48 5.48 0 0 0 17 8a5.47 5.47 0 0 0-2.78.75z" opacity=".7" />
    </svg>
  );
}

type UploadSource = "local" | "direct-link" | "dropbox" | "gdrive" | "onedrive" | "box";
type Step = "choose-source" | "pick-file" | "metadata";
type DocumentType = "PLANS" | "SPECS" | "TAKEOFF" | "OTHER";

interface UploadSourcePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileType?: "MEDIA" | "DOCUMENT" | "RECEIPT";
  onComplete?: (result: any) => void;
  projectId: number | string;
}

interface CloudConnection {
  id: number;
  provider: string;
  status: string;
  displayName?: string;
}

interface CloudFile {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  modifiedAt: string | null;
  isFolder: boolean;
  path?: string;
}

const SOURCE_OPTIONS = [
  {
    id: "local" as UploadSource,
    label: "Local File",
    description: "Upload from your device",
    icon: HardDrive,
    isCloud: false,
  },
  {
    id: "direct-link" as UploadSource,
    label: "Direct Link",
    description: "Paste a URL to a file",
    icon: LinkIcon,
    isCloud: false,
  },
  {
    id: "dropbox" as UploadSource,
    label: "Dropbox",
    description: "Import from Dropbox",
    iconComponent: SiDropbox,
    isCloud: true,
    provider: "dropbox",
    implemented: true,
  },
  {
    id: "gdrive" as UploadSource,
    label: "Google Drive",
    description: "Import from Google Drive",
    iconComponent: SiGoogledrive,
    isCloud: true,
    provider: "gdrive",
    implemented: true,
  },
  {
    id: "onedrive" as UploadSource,
    label: "OneDrive",
    description: "Import from OneDrive",
    iconComponent: OneDriveIcon,
    isCloud: true,
    provider: "onedrive",
    implemented: true,
  },
  {
    id: "box" as UploadSource,
    label: "Box",
    description: "Import from Box",
    iconComponent: SiBox,
    isCloud: true,
    provider: "box",
    implemented: true,
  },
];

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CloudFileBrowserProps {
  provider: "gdrive" | "dropbox" | "onedrive" | "box";
  onSelect: (file: CloudFile) => void;
}

function CloudFileBrowser({ provider, onSelect }: CloudFileBrowserProps) {
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const currentFolder = folderStack[folderStack.length - 1];
  const folderId = currentFolder?.id || "";

  const queryKey = ["/api/integrations/cloud-browse", provider, folderId, debouncedSearch];

  const { data, isLoading, error, refetch } = useQuery<{ files: CloudFile[] }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ provider });
      if (debouncedSearch) {
        params.set("query", debouncedSearch);
      } else if (folderId) {
        params.set("folderId", folderId);
      }
      const res = await fetch(`/api/integrations/cloud-browse?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to load files");
      }
      return res.json();
    },
    staleTime: 30000,
  });

  const handleFolderOpen = useCallback((file: CloudFile) => {
    setSearchQuery("");
    setDebouncedSearch("");
    const id = file.path || file.id;
    setFolderStack((prev) => [...prev, { id, name: file.name }]);
  }, []);

  const handleBreadcrumb = useCallback((index: number) => {
    setFolderStack((prev) => prev.slice(0, index + 1));
  }, []);

  const handleRootClick = useCallback(() => {
    setFolderStack([]);
  }, []);

  const files = data?.files || [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className="pl-8"
          data-testid="input-cloud-search"
        />
      </div>

      {!debouncedSearch && folderStack.length > 0 && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
          <button
            className="hover:text-foreground hover:underline"
            onClick={handleRootClick}
            data-testid="breadcrumb-root"
          >
            Home
          </button>
          {folderStack.map((f, i) => (
            <span key={i} className="flex items-center gap-1">
              <span>/</span>
              <button
                className="hover:text-foreground hover:underline max-w-[120px] truncate"
                onClick={() => handleBreadcrumb(i)}
                data-testid={`breadcrumb-folder-${i}`}
              >
                {f.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading files...</span>
          </div>
        )}
        {error && (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-destructive">{(error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}
        {!isLoading && !error && files.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {debouncedSearch ? "No files found matching your search." : "This folder is empty."}
          </div>
        )}
        {!isLoading && !error && files.map((file) => (
          <div
            key={file.id}
            className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 text-sm transition-colors cursor-pointer hover:bg-muted"
            onClick={() => file.isFolder ? handleFolderOpen(file) : onSelect(file)}
            data-testid={`cloud-file-${file.isFolder ? "folder" : "file"}`}
          >
            <div className="flex-shrink-0 text-muted-foreground">
              {file.isFolder ? (
                <Folder className="w-4 h-4 text-yellow-500" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{file.name}</p>
              {!file.isFolder && file.size !== null && (
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              )}
            </div>
            {file.isFolder && (
              <span className="text-xs text-muted-foreground">Open</span>
            )}
            {!file.isFolder && (
              <Button
                size="sm"
                variant="outline"
                className="flex-shrink-0 h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); onSelect(file); }}
                data-testid="button-select-cloud-file"
              >
                Select
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function UploadSourcePicker({
  open,
  onOpenChange,
  fileType = "DOCUMENT",
  onComplete,
  projectId,
}: UploadSourcePickerProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("choose-source");
  const [selectedSource, setSelectedSource] = useState<UploadSource | null>(null);
  const [directUrl, setDirectUrl] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("OTHER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressMessage, setProgressMessage] = useState("Downloading file from URL...");
  const [selectedCloudFile, setSelectedCloudFile] = useState<CloudFile | null>(null);

  useEffect(() => {
    if (!isSubmitting) {
      setProgressMessage("Downloading file from URL...");
      return;
    }
    const t1 = setTimeout(() => setProgressMessage("Still downloading... this may take a moment for large files"), 5000);
    const t2 = setTimeout(() => setProgressMessage("Almost there... processing large file"), 15000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isSubmitting]);

  const { data: connections = [] } = useQuery<CloudConnection[]>({
    queryKey: ["/api/integrations/connections"],
    enabled: open,
  });

  const getConnectionStatus = useCallback(
    (provider: string) => {
      const conn = connections.find(
        (c: CloudConnection) => c.provider === provider && (c.status === "active" || c.status === "connected")
      );
      return conn ? "connected" : "not-connected";
    },
    [connections]
  );

  const resetState = useCallback(() => {
    setStep("choose-source");
    setSelectedSource(null);
    setDirectUrl("");
    setDocumentTitle("");
    setDocumentType("OTHER");
    setIsSubmitting(false);
    setSelectedCloudFile(null);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetState();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetState]
  );

  const handleSourceSelect = useCallback(
    (source: UploadSource) => {
      const option = SOURCE_OPTIONS.find((s) => s.id === source);
      if (option?.isCloud) {
        const status = getConnectionStatus(option.provider!);
        if (status !== "connected") {
          return;
        }
      }
      setSelectedSource(source);
      setStep("pick-file");
    },
    [getConnectionStatus]
  );

  const handleBack = useCallback(() => {
    if (step === "metadata") {
      setStep("pick-file");
    } else if (step === "pick-file") {
      setStep("choose-source");
      setSelectedSource(null);
      setDirectUrl("");
      setSelectedCloudFile(null);
    }
  }, [step]);

  const handleDirectLinkNext = useCallback(() => {
    if (!directUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }
    try {
      const url = new URL(directUrl.trim());
      if (url.protocol !== "https:") {
        toast({
          title: "Invalid URL",
          description: "Only HTTPS URLs are allowed",
          variant: "destructive",
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }
    setStep("metadata");
  }, [directUrl, toast]);

  const handleDirectLinkSubmit = useCallback(async () => {
    if (!documentTitle.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a document title",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/documents/from-url", {
        url: directUrl.trim(),
        title: documentTitle.trim(),
        type: documentType,
        projectId,
      });
      const doc = await res.json();
      toast({ title: "Success", description: "Document uploaded from URL" });
      onComplete?.(doc);
      handleOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to upload from URL",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [directUrl, documentTitle, documentType, projectId, onComplete, handleOpenChange, toast]);

  const handleLocalFileComplete = useCallback(
    (result: any) => {
      onComplete?.({ ...result, _uploadMeta: { title: documentTitle, type: documentType } });
      handleOpenChange(false);
    },
    [onComplete, handleOpenChange, documentTitle, documentType]
  );

  const handleCloudFileSelect = useCallback((file: CloudFile) => {
    setSelectedCloudFile(file);
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, "");
    setDocumentTitle(nameWithoutExt);
    setStep("metadata");
  }, []);

  const handleCloudFileSubmit = useCallback(async () => {
    if (!documentTitle.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a document title",
        variant: "destructive",
      });
      return;
    }
    if (!selectedCloudFile || !selectedSource) return;

    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/documents/from-cloud", {
        provider: selectedSource,
        fileId: selectedCloudFile.id,
        fileName: selectedCloudFile.name,
        filePath: selectedCloudFile.path,
        title: documentTitle.trim(),
        type: documentType,
        projectId,
      });
      const doc = await res.json();
      toast({ title: "Success", description: "Document imported from cloud" });
      onComplete?.(doc);
      handleOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to import from cloud",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedCloudFile, selectedSource, documentTitle, documentType, projectId, onComplete, handleOpenChange, toast]);

  const stepTitle = () => {
    if (step === "choose-source") return "Upload Document";
    if (step === "pick-file" && selectedSource === "local") return "Select Local File";
    if (step === "pick-file" && selectedSource === "direct-link") return "Enter File URL";
    if (step === "pick-file") {
      const option = SOURCE_OPTIONS.find((s) => s.id === selectedSource);
      return `Select from ${option?.label || ""}`;
    }
    return "Document Details";
  };

  const stepDescription = () => {
    if (step === "choose-source") return "Choose where to upload your document from";
    if (step === "pick-file" && selectedSource === "direct-link")
      return "Paste a direct HTTPS link to the file you want to upload";
    if (step === "pick-file" && selectedSource === "local")
      return "Select a file from your device to upload";
    if (step === "metadata" && selectedCloudFile)
      return `Importing "${selectedCloudFile.name}" — enter document details`;
    if (step === "metadata") return "Enter a title and type for your document";
    return "Select a file to upload";
  };

  const isCloudSource = selectedSource && !["local", "direct-link"].includes(selectedSource);
  const isImplementedCloud = isCloudSource && SOURCE_OPTIONS.find(s => s.id === selectedSource)?.implemented;
  const isUnimplementedCloud = isCloudSource && !isImplementedCloud;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="dialog-upload-source-picker"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step !== "choose-source" && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleBack}
                data-testid="button-upload-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <div>
              <DialogTitle>{stepTitle()}</DialogTitle>
              <DialogDescription>{stepDescription()}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === "choose-source" && (
          <div
            className="grid grid-cols-2 md:grid-cols-3 gap-3"
            data-testid="upload-source-grid"
          >
            {SOURCE_OPTIONS.map((option) => {
              const isCloud = option.isCloud;
              const connectionStatus = isCloud
                ? getConnectionStatus(option.provider!)
                : null;
              const isConnected = connectionStatus === "connected";
              const isDisabled = isCloud && !isConnected;
              const IconComponent = option.icon;
              const SiIconComponent = option.iconComponent;

              return (
                <Card
                  key={option.id}
                  className={`p-4 cursor-pointer transition-colors ${
                    isDisabled
                      ? "opacity-60 cursor-not-allowed"
                      : "hover-elevate"
                  }`}
                  onClick={() => !isDisabled && handleSourceSelect(option.id)}
                  data-testid={`source-card-${option.id}`}
                >
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-10 h-10 flex items-center justify-center rounded-md bg-muted">
                      {IconComponent && <IconComponent className="w-5 h-5" />}
                      {SiIconComponent && <SiIconComponent className="w-5 h-5" />}
                    </div>
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground leading-tight">
                      {option.description}
                    </span>
                    {isCloud && (
                      <div className="mt-1">
                        {isConnected ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                            data-testid={`badge-connected-${option.id}`}
                          >
                            <Lock className="w-3 h-3 mr-1" />
                            Connected
                          </Badge>
                        ) : (
                          <a
                            href="/integrations"
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:underline"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`link-setup-${option.id}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            Set up in Integration Hub
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {step === "pick-file" && selectedSource === "local" && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="local-doc-title">Title</Label>
                <Input
                  id="local-doc-title"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="Enter document title..."
                  data-testid="input-local-document-title"
                />
              </div>
              <div>
                <Label htmlFor="local-doc-type">Type</Label>
                <Select
                  value={documentType}
                  onValueChange={(value: DocumentType) => setDocumentType(value)}
                >
                  <SelectTrigger
                    id="local-doc-type"
                    data-testid="select-local-document-type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLANS">Plans</SelectItem>
                    <SelectItem value="SPECS">Specifications</SelectItem>
                    <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                data-testid="button-cancel-local"
              >
                Cancel
              </Button>
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={104857600}
                fileType={fileType}
                onComplete={handleLocalFileComplete}
                buttonVariant="default"
                testId="button-select-local-file"
              >
                Select File
              </ObjectUploader>
            </DialogFooter>
          </div>
        )}

        {step === "pick-file" && selectedSource === "direct-link" && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="direct-url">File URL</Label>
              <Input
                id="direct-url"
                value={directUrl}
                onChange={(e) => setDirectUrl(e.target.value)}
                placeholder="https://example.com/document.pdf"
                type="url"
                data-testid="input-direct-url"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                data-testid="button-cancel-direct-link"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDirectLinkNext}
                data-testid="button-direct-link-next"
              >
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "pick-file" && isImplementedCloud && (selectedSource === "gdrive" || selectedSource === "dropbox" || selectedSource === "onedrive" || selectedSource === "box") && (
          <div className="space-y-3">
            <CloudFileBrowser
              provider={selectedSource}
              onSelect={handleCloudFileSelect}
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                data-testid="button-cancel-cloud"
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "pick-file" && isUnimplementedCloud && (
          <div className="py-8 text-center space-y-4" data-testid="cloud-not-available">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <ThumbsUp className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Not yet available — vote to prioritize</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                {SOURCE_OPTIONS.find(s => s.id === selectedSource)?.label} is on our roadmap.
                Vote below to help us prioritize it sooner.
              </p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <a
                href={`mailto:feedback@smartmanageai.com?subject=Feature+Request:+${encodeURIComponent(SOURCE_OPTIONS.find(s => s.id === selectedSource)?.label ?? "")}+Integration&body=I'd+like+to+use+${encodeURIComponent(SOURCE_OPTIONS.find(s => s.id === selectedSource)?.label ?? "")}+to+import+documents.`}
                className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
                data-testid="link-vote-integration"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                Vote for this integration
              </a>
              <a
                href="/integrations"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
                data-testid="link-setup-integration-hub"
              >
                <ExternalLink className="w-3 h-3" />
                Manage integrations in the Integration Hub
              </a>
            </div>
            <Button
              variant="outline"
              onClick={handleBack}
              data-testid="button-cloud-back"
            >
              Go Back
            </Button>
          </div>
        )}

        {step === "metadata" && selectedSource === "direct-link" && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="meta-title">Title</Label>
              <Input
                id="meta-title"
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                placeholder="Enter document title..."
                data-testid="input-meta-title"
              />
            </div>
            <div>
              <Label htmlFor="meta-type">Type</Label>
              <Select
                value={documentType}
                onValueChange={(value: DocumentType) => setDocumentType(value)}
              >
                <SelectTrigger id="meta-type" data-testid="select-meta-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANS">Plans</SelectItem>
                  <SelectItem value="SPECS">Specifications</SelectItem>
                  <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                data-testid="button-cancel-meta"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDirectLinkSubmit}
                disabled={isSubmitting}
                data-testid="button-confirm-upload"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isSubmitting ? progressMessage : "Upload"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "metadata" && isImplementedCloud && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="cloud-meta-title">Title</Label>
              <Input
                id="cloud-meta-title"
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                placeholder="Enter document title..."
                data-testid="input-cloud-meta-title"
              />
            </div>
            <div>
              <Label htmlFor="cloud-meta-type">Type</Label>
              <Select
                value={documentType}
                onValueChange={(value: DocumentType) => setDocumentType(value)}
              >
                <SelectTrigger id="cloud-meta-type" data-testid="select-cloud-meta-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANS">Plans</SelectItem>
                  <SelectItem value="SPECS">Specifications</SelectItem>
                  <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                data-testid="button-cancel-cloud-meta"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCloudFileSubmit}
                disabled={isSubmitting}
                data-testid="button-confirm-cloud-upload"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isSubmitting ? "Importing..." : "Import"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
