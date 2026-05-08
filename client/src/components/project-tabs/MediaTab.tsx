import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";
import { Upload, Tag, Search, Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectMedia } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Project, Media } from "@shared/schema";

interface MediaTabProps {
  projectCode: string;
  project: Project;
}

export default function MediaTab({ projectCode, project }: MediaTabProps) {
  const { toast } = useToast();
  const { data: mediaItems = [], isLoading: mediaLoading } = useProjectMedia(projectCode);

  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [mediaCaption, setMediaCaption] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");

  const autoTagMutation = useMutation({
    mutationFn: async ({ mediaId, imageUrl }: { mediaId: string; imageUrl: string }) => {
      const response = await apiRequest("POST", "/api/field-productivity/photo-auto-tag", {
        mediaId,
        imageUrl,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
      toast({ title: "Photo tagged", description: "AI tags have been generated" });
    },
    onError: () => {
      toast({ title: "Auto-tag failed", variant: "destructive" });
    },
  });

  const handleMediaUploadComplete = async (result: { successful?: Array<{ uploadURL: string; name: string; size: number; type: string }> }) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingMedia(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/media`, {
        type: mediaType,
        caption: mediaCaption,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      const newMedia = await response.json();

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
      toast({ title: "Success", description: "Media uploaded successfully" });
      setShowMediaDialog(false);
      setMediaCaption("");
      setMediaType("IMAGE");

      if (mediaType === "IMAGE" && fileUrl) {
        try {
          await apiRequest("POST", "/api/field-productivity/photo-auto-tag", {
            mediaId: newMedia.id,
            imageUrl: fileUrl,
          });
          await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
          toast({ title: "AI Auto-Tagged", description: "Photo has been automatically tagged" });
        } catch {
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save media", variant: "destructive" });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const allTags = Array.from(
    new Set(
      mediaItems
        .flatMap((item: Media) => item.aiTags || [])
        .filter(Boolean)
    )
  ).sort();

  const filteredItems = mediaItems.filter((item: Media) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesCaption = item.caption?.toLowerCase().includes(query);
      const matchesDescription = item.aiDescription?.toLowerCase().includes(query);
      const matchesTags = item.aiTags?.some((tag: string) => tag.toLowerCase().includes(query));
      const matchesFileName = item.fileName?.toLowerCase().includes(query);
      if (!matchesCaption && !matchesDescription && !matchesTags && !matchesFileName) return false;
    }
    if (tagFilter && tagFilter !== "all") {
      if (!item.aiTags || !item.aiTags.includes(tagFilter)) return false;
    }
    return true;
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Photos & Videos</CardTitle>
          <Dialog open={showMediaDialog} onOpenChange={setShowMediaDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-upload-media">
                <Upload className="w-4 h-4 mr-2" />
                Upload Media
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-upload-media">
              <DialogHeader>
                <DialogTitle>Upload Media</DialogTitle>
                <DialogDescription>
                  Fill in the details below and then select a file to upload. Images will be automatically tagged by AI.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="media-type">Type</Label>
                  <Select
                    value={mediaType}
                    onValueChange={(value: "IMAGE" | "VIDEO") => setMediaType(value)}
                  >
                    <SelectTrigger id="media-type" data-testid="select-media-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IMAGE">Image</SelectItem>
                      <SelectItem value="VIDEO">Video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="media-caption">Caption (Optional)</Label>
                  <Input
                    id="media-caption"
                    value={mediaCaption}
                    onChange={(e) => setMediaCaption(e.target.value)}
                    placeholder="Enter a caption..."
                    data-testid="input-media-caption"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowMediaDialog(false);
                    setMediaCaption("");
                    setMediaType("IMAGE");
                  }}
                  data-testid="button-cancel-media"
                >
                  Cancel
                </Button>
                <ObjectUploader
                  maxNumberOfFiles={1}
                  maxFileSize={MAX_STORAGE_FILE_SIZE}
                  allowedFileTypes={mediaType === "IMAGE" ? ["image/*"] : ["video/*"]}
                  fileType="MEDIA"
                  onComplete={((result: Parameters<typeof handleMediaUploadComplete>[0]) => {
                    setIsUploadingMedia(true);
                    handleMediaUploadComplete(result);
                  }) as React.ComponentProps<typeof ObjectUploader>["onComplete"]}
                  buttonVariant="default"
                  testId="button-select-media-file"
                >
                  {isUploadingMedia ? "Uploading..." : "Select File"}
                </ObjectUploader>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {mediaItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by tags, description, or caption..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-media"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                  onClick={() => setSearchQuery("")}
                  data-testid="button-clear-search"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            {allTags.length > 0 && (
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-tag-filter">
                  <SelectValue placeholder="Filter by tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tags</SelectItem>
                  {allTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {mediaLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading media...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {mediaItems.length === 0 ? "No media uploaded yet" : "No media matches your search"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item: Media) => (
              <Card key={item.id} data-testid={`media-${item.id}`}>
                <CardContent className="p-4 space-y-2">
                  {item.type === "IMAGE" && item.fileUrl && (
                    <div className="aspect-video rounded-md overflow-hidden bg-muted mb-2">
                      <img
                        src={item.fileUrl}
                        alt={item.caption || item.fileName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.type}</Badge>
                    {item.aiAnalyzedAt && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Sparkles className="h-3 w-3" />
                        AI Tagged
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{item.caption || "Untitled"}</p>
                  {item.aiDescription && (
                    <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`text-ai-description-${item.id}`}>
                      {item.aiDescription}
                    </p>
                  )}
                  {item.aiTags && item.aiTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.aiTags.slice(0, 5).map((tag: string, i: number) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-xs cursor-pointer hover:bg-primary/10"
                          onClick={() => setTagFilter(tag)}
                          data-testid={`badge-tag-${tag}`}
                        >
                          <Tag className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                      {item.aiTags.length > 5 && (
                        <Badge variant="outline" className="text-xs">+{item.aiTags.length - 5}</Badge>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(item.uploadedAt), "MMM d, yyyy")}
                    </p>
                    {item.type === "IMAGE" && !item.aiAnalyzedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => autoTagMutation.mutate({ mediaId: item.id, imageUrl: item.fileUrl })}
                        disabled={autoTagMutation.isPending}
                        data-testid={`button-auto-tag-${item.id}`}
                      >
                        {autoTagMutation.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        Auto-Tag
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
