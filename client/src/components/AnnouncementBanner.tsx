import { useQuery, useMutation } from "@tanstack/react-query";
import { X, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Announcement {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

export function AnnouncementBanner() {
  const { data: announcements } = useQuery<Announcement[]>({
    queryKey: ["/api/platform/announcements/active"],
    refetchInterval: 60000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/platform/announcements/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements/active"] });
    },
  });

  if (!announcements?.length) return null;

  return (
    <div className="space-y-2 mb-4" data-testid="announcement-banner-container">
      {announcements.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
          data-testid={`announcement-banner-${a.id}`}
        >
          <Megaphone className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{a.title}</p>
            <p className="text-sm text-muted-foreground">{a.message}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => dismissMutation.mutate(a.id)}
            data-testid={`button-dismiss-announcement-${a.id}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
