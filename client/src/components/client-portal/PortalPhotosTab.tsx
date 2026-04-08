import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image, X, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

interface PhotoItem {
  id: string;
  fileName: string;
  fileUrl: string | null;
  fileType: string | null;
  description: string | null;
  createdAt: string;
}

interface PortalPhotosTabProps {
  photos: PhotoItem[] | undefined;
}

function PhotoLightbox({
  photos,
  currentIndex,
  onClose,
  onNavigate,
}: {
  photos: PhotoItem[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const photo = photos[currentIndex];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
    },
    [currentIndex, photos.length, onClose, onNavigate]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
      data-testid="photo-lightbox"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/20 z-10"
        onClick={onClose}
        data-testid="button-lightbox-close"
      >
        <X className="w-6 h-6" />
      </Button>

      {currentIndex > 0 && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 z-10"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex - 1);
          }}
          data-testid="button-lightbox-prev"
        >
          <ChevronLeft className="w-8 h-8" />
        </Button>
      )}

      {currentIndex < photos.length - 1 && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 z-10"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex + 1);
          }}
          data-testid="button-lightbox-next"
        >
          <ChevronRight className="w-8 h-8" />
        </Button>
      )}

      <div
        className="max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {photo.fileUrl && (
          <img
            src={photo.fileUrl}
            alt={photo.description || photo.fileName}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
            data-testid="img-lightbox-photo"
          />
        )}
        <div className="mt-3 text-center text-white">
          <p className="text-sm font-medium" data-testid="text-lightbox-description">
            {photo.description || photo.fileName}
          </p>
          <p className="text-xs text-white/60 mt-1">
            {format(new Date(photo.createdAt), "MMM d, yyyy")} · {currentIndex + 1} of {photos.length}
          </p>
        </div>
      </div>
    </div>
  );
}

export function PortalPhotosTab({ photos }: PortalPhotosTabProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const viewablePhotos = photos?.filter((p) => p.fileUrl) || [];

  const openLightbox = (photo: PhotoItem) => {
    const viewableIdx = viewablePhotos.findIndex((p) => p.id === photo.id);
    if (viewableIdx >= 0) setLightboxIndex(viewableIdx);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Project Photos</CardTitle>
          <CardDescription>Recent photos and media from the job site</CardDescription>
        </CardHeader>
        <CardContent>
          {photos && photos.length > 0 ? (
            <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3" data-testid="photos-masonry-grid">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="break-inside-avoid group relative rounded-lg overflow-hidden bg-muted cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                  onClick={() => photo.fileUrl && openLightbox(photo)}
                  data-testid={`photo-card-${photo.id}`}
                >
                  {photo.fileUrl ? (
                    <img
                      src={photo.fileUrl}
                      alt={photo.description || photo.fileName}
                      className="w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-40">
                      <Image className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs font-medium truncate">
                      {photo.description || photo.fileName}
                    </p>
                    <p className="text-white/60 text-[10px] mt-0.5">
                      {format(new Date(photo.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No photos available yet.
            </p>
          )}
        </CardContent>
      </Card>

      {lightboxIndex !== null && viewablePhotos.length > 0 && (
        <PhotoLightbox
          photos={viewablePhotos}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
