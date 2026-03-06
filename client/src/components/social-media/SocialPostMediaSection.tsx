import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Loader2, Sparkles, Link2, Upload, Wand2, Trash2
} from "lucide-react";
import { ObjectUploader } from "@/components/ObjectUploader";

interface SocialPostMediaSectionProps {
  mediaUrls: string[];
  onMediaUrlsChange: (urls: string[]) => void;
}

export function SocialPostMediaSection({ mediaUrls, onMediaUrlsChange }: SocialPostMediaSectionProps) {
  const { toast } = useToast();
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaMode, setMediaMode] = useState<"none" | "url" | "ai">("none");
  const [aiImagePrompt, setAiImagePrompt] = useState("");

  const generateImageMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", "/api/social/posts/generate-image", { prompt });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.imageUrl) {
        onMediaUrlsChange([...mediaUrls, data.imageUrl]);
        setAiImagePrompt("");
        setMediaMode("none");
        toast({ title: "Image generated" });
      }
    },
    onError: (e: Error) => toast({ title: "Image generation failed", description: e.message, variant: "destructive" }),
  });

  const onGetUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/objects/upload");
    const data = await response.json();
    return { method: "PUT" as const, url: data.uploadURL };
  };

  const handleUploadComplete = (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Upload failed", variant: "destructive" });
      return;
    }
    const fileUrl = result.successful[0].uploadURL;
    if (fileUrl) {
      onMediaUrlsChange([...mediaUrls, fileUrl]);
      toast({ title: "Image uploaded" });
    }
  };

  return (
    <div>
      <Label>Media ({mediaUrls.length}/4)</Label>
      {mediaUrls.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {mediaUrls.map((url, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg border overflow-hidden group">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button
                className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                onClick={() => onMediaUrlsChange(mediaUrls.filter((_, j) => j !== i))}
                data-testid={`remove-media-${i}`}
              >
                <Trash2 className="h-4 w-4 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
      {mediaUrls.length < 4 && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <ObjectUploader
              maxNumberOfFiles={1}
              maxFileSize={10485760}
              allowedFileTypes={["image/*"]}
              onGetUploadParameters={onGetUploadParameters}
              onComplete={handleUploadComplete}
              testId="button-upload-media"
            >
              <Button variant="outline" size="sm" type="button" className="gap-1.5" data-testid="button-upload-media">
                <Upload className="h-3.5 w-3.5" />
                Upload
              </Button>
            </ObjectUploader>
            <Button
              variant={mediaMode === "url" ? "secondary" : "outline"}
              size="sm"
              type="button"
              className="gap-1.5"
              onClick={() => setMediaMode(mediaMode === "url" ? "none" : "url")}
              data-testid="button-media-url-toggle"
            >
              <Link2 className="h-3.5 w-3.5" />
              URL
            </Button>
            <Button
              variant={mediaMode === "ai" ? "secondary" : "outline"}
              size="sm"
              type="button"
              className="gap-1.5"
              onClick={() => setMediaMode(mediaMode === "ai" ? "none" : "ai")}
              data-testid="button-media-ai-toggle"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Generate
            </Button>
          </div>
          {mediaMode === "url" && (
            <div className="flex gap-2">
              <Input
                placeholder="Paste an image URL..."
                value={mediaUrlInput}
                onChange={e => setMediaUrlInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (mediaUrlInput.trim()) {
                      onMediaUrlsChange([...mediaUrls, mediaUrlInput.trim()]);
                      setMediaUrlInput("");
                    }
                  }
                }}
                data-testid="input-media-url"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (mediaUrlInput.trim()) {
                    onMediaUrlsChange([...mediaUrls, mediaUrlInput.trim()]);
                    setMediaUrlInput("");
                  }
                }}
                disabled={!mediaUrlInput.trim()}
                data-testid="button-add-media-url"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
          {mediaMode === "ai" && (
            <div className="flex gap-2">
              <Input
                placeholder="Describe the image you want..."
                value={aiImagePrompt}
                onChange={e => setAiImagePrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (aiImagePrompt.trim().length >= 3) generateImageMutation.mutate(aiImagePrompt.trim());
                  }
                }}
                data-testid="input-ai-image-prompt"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateImageMutation.mutate(aiImagePrompt.trim())}
                disabled={generateImageMutation.isPending || aiImagePrompt.trim().length < 3}
                data-testid="button-generate-image"
              >
                {generateImageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
