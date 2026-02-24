import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectMedia } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Project } from "@shared/schema";

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

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleMediaUploadComplete = async (result: any) => {
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
      await apiRequest("POST", `/api/projects/${projectCode}/media`, {
        type: mediaType,
        caption: mediaCaption,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
      toast({ title: "Success", description: "Media uploaded successfully" });
      setShowMediaDialog(false);
      setMediaCaption("");
      setMediaType("IMAGE");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save media", variant: "destructive" });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
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
                Fill in the details below and then select a file to upload.
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
                maxFileSize={104857600}
                allowedFileTypes={mediaType === "IMAGE" ? ["image/*"] : ["video/*"]}
                onGetUploadParameters={onGetUploadParameters}
                onComplete={(result) => {
                  setIsUploadingMedia(true);
                  handleMediaUploadComplete(result);
                }}
                buttonVariant="default"
                testId="button-select-media-file"
              >
                {isUploadingMedia ? "Uploading..." : "Select File"}
              </ObjectUploader>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {mediaLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading media...</div>
        ) : mediaItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No media uploaded yet</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mediaItems.map((item) => (
              <Card key={item.id} data-testid={`media-${item.id}`}>
                <CardContent className="p-4">
                  <Badge variant="outline" className="mb-2">{item.type}</Badge>
                  <p className="text-sm font-medium mb-1">{item.caption || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(item.uploadedAt), "MMM d, yyyy")}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
