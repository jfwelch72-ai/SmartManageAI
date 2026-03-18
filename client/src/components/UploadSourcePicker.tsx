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
} from "lucide-react";
import { SiDropbox, SiGoogledrive, SiBox } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  },
  {
    id: "gdrive" as UploadSource,
    label: "Google Drive",
    description: "Import from Google Drive",
    iconComponent: SiGoogledrive,
    isCloud: true,
    provider: "gdrive",
  },
  {
    id: "onedrive" as UploadSource,
    label: "OneDrive",
    description: "Import from OneDrive",
    iconComponent: OneDriveIcon,
    isCloud: true,
    provider: "onedrive",
  },
  {
    id: "box" as UploadSource,
    label: "Box",
    description: "Import from Box",
    iconComponent: SiBox,
    isCloud: true,
    provider: "box",
  },
];

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
      if (source === "local") {
        setStep("pick-file");
      } else if (source === "direct-link") {
        setStep("pick-file");
      } else {
        setStep("pick-file");
      }
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
    if (step === "metadata") return "Enter a title and type for your document";
    return "Select a file to upload";
  };

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

        {step === "pick-file" && selectedSource && !["local", "direct-link"].includes(selectedSource) && (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Cloud file picker for{" "}
              {SOURCE_OPTIONS.find((s) => s.id === selectedSource)?.label} is
              coming soon.
            </p>
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
      </DialogContent>
    </Dialog>
  );
}
