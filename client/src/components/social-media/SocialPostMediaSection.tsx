import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Loader2, Sparkles, Link2, Upload, Wand2, Trash2
} from "lucide-react";

interface SocialPostMediaSectionProps {
  mediaUrls: string[];
  onMediaUrlsChange: (urls: string[]) => void;
}

export function SocialPostMediaSection({ mediaUrls, onMediaUrlsChange }: SocialPostMediaSectionProps) {
  const { toast } = useToast();
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaMode, setMediaMode] = useState<"none" | "url" | "ai">("none");
  const [aiImagePrompt, setAiImagePrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
        queryClient.invalidateQueries({ queryKey: ["/api/website/media"] });
        toast({ title: "Image generated" });
      }
    },
    onError: (e: Error) => toast({ title: "Image generation failed", description: e.message, variant: "destructive" }),
  });

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file type", description: "Only image files are supported.", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 10MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/social/upload-media", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        toast({ title: "Upload failed", description: err.error, variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (data.url) {
        onMediaUrlsChange([...mediaUrls, data.url]);
        queryClient.invalidateQueries({ queryKey: ["/api/website/media"] });
        toast({ title: "Image uploaded" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
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
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = "";
              }}
              data-testid="input-social-upload-file"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="gap-1.5"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload-media"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </Button>
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
