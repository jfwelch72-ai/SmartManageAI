import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Image } from "lucide-react";

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

export function PortalPhotosTab({ photos }: PortalPhotosTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Photos</CardTitle>
        <CardDescription>Recent photos and media from the job site</CardDescription>
      </CardHeader>
      <CardContent>
        {photos && photos.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-muted">
                {photo.fileUrl ? (
                  <img
                    src={photo.fileUrl}
                    alt={photo.description || photo.fileName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Image className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  {photo.description || photo.fileName}
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
  );
}
