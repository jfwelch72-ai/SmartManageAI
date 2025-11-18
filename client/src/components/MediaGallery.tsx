import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Image as ImageIcon, Video, X } from "lucide-react";

interface MediaItem {
  id: string;
  type: "image" | "video";
  url: string;
  caption?: string;
  uploadedBy: string;
  uploadedAt: string;
}

interface MediaGalleryProps {
  items: MediaItem[];
  onUpload?: (files: File[]) => void;
  onDelete?: (id: string) => void;
}

export default function MediaGallery({ items, onUpload, onDelete }: MediaGalleryProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles(files);
      if (onUpload) {
        onUpload(files);
      }
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Site Photos & Videos</CardTitle>
        <div>
          <input
            type="file"
            id="media-upload"
            className="hidden"
            accept="image/*,video/*"
            multiple
            onChange={handleFileInput}
          />
          <Button
            size="sm"
            onClick={() => document.getElementById('media-upload')?.click()}
            data-testid="button-upload-media"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Media
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-md">
            <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              No photos or videos uploaded yet
            </p>
            <Button
              variant="outline"
              onClick={() => document.getElementById('media-upload')?.click()}
            >
              Upload Your First Photo
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="relative group aspect-square rounded-md overflow-hidden bg-muted"
                data-testid={`media-${item.id}`}
              >
                {item.type === "image" ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-12 h-12 text-muted-foreground" />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Video className="w-12 h-12 text-muted-foreground" />
                  </div>
                )}
                
                {onDelete && (
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onDelete(item.id)}
                    data-testid={`button-delete-${item.id}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
                
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-2">
                  <p className="text-xs truncate">{item.caption || 'Untitled'}</p>
                  <p className="text-xs text-white/70">{item.uploadedAt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
