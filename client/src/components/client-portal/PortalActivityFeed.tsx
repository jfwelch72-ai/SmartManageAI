import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Image, ClipboardList, FileText, MessageSquare, Receipt, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface ActivityItem {
  type: "photo" | "progress" | "document" | "message" | "payment";
  description: string;
  timestamp: string;
}

interface PortalActivityFeedProps {
  progress?: Array<{ description: string; status: string; updatedAt: string | null }>;
  photos?: Array<{ fileName: string; description: string | null; createdAt: string }>;
  documents?: Array<{ title: string; uploadedAt: string }>;
  payments?: Array<{ invoiceNumber: string; status: string; sentAt: string | null; paidAt: string | null }>;
  chatThreads?: Array<{ subject: string; lastMessageAt: string | null; lastMessagePreview: string | null }>;
}

const ICON_MAP = {
  photo: Image,
  progress: ClipboardList,
  document: FileText,
  message: MessageSquare,
  payment: Receipt,
};

const COLOR_MAP = {
  photo: "bg-blue-500/10 text-blue-500",
  progress: "bg-green-500/10 text-green-500",
  document: "bg-purple-500/10 text-purple-500",
  message: "bg-yellow-500/10 text-yellow-500",
  payment: "bg-orange-500/10 text-orange-500",
};

export function PortalActivityFeed({ progress, photos, documents, payments, chatThreads }: PortalActivityFeedProps) {
  const activities: ActivityItem[] = [];

  chatThreads?.forEach((thread) => {
    if (thread.lastMessageAt) {
      activities.push({
        type: "message",
        description: `New message in "${thread.subject}"${thread.lastMessagePreview ? `: ${thread.lastMessagePreview}` : ""}`,
        timestamp: thread.lastMessageAt,
      });
    }
  });

  progress?.forEach((item) => {
    if (item.updatedAt) {
      activities.push({
        type: "progress",
        description: `"${item.description}" updated to ${item.status.replace(/_/g, " ")}`,
        timestamp: item.updatedAt,
      });
    }
  });

  photos?.forEach((photo) => {
    activities.push({
      type: "photo",
      description: `New photo uploaded: ${photo.description || photo.fileName}`,
      timestamp: photo.createdAt,
    });
  });

  documents?.forEach((doc) => {
    activities.push({
      type: "document",
      description: `Document added: ${doc.title}`,
      timestamp: doc.uploadedAt,
    });
  });

  payments?.forEach((inv) => {
    const ts = inv.paidAt || inv.sentAt;
    if (ts) {
      activities.push({
        type: "payment",
        description: inv.paidAt
          ? `Invoice ${inv.invoiceNumber} marked as paid`
          : `Invoice ${inv.invoiceNumber} sent`,
        timestamp: ts,
      });
    }
  });

  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentActivities = activities.slice(0, 10);

  if (recentActivities.length === 0) return null;

  return (
    <Card data-testid="activity-feed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentActivities.map((activity, idx) => {
            const Icon = ICON_MAP[activity.type];
            const colorClass = COLOR_MAP[activity.type];
            return (
              <div
                key={idx}
                className="flex items-start gap-3"
                data-testid={`activity-item-${idx}`}
              >
                <div className="relative flex flex-col items-center">
                  <div className={`p-1.5 rounded-full ${colorClass}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  {idx < recentActivities.length - 1 && (
                    <div className="w-px h-full bg-border absolute top-8 left-1/2 -translate-x-1/2" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-3">
                  <p className="text-sm leading-snug" data-testid={`text-activity-${idx}`}>
                    {activity.description}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(() => {
                      try {
                        return formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true });
                      } catch {
                        return format(new Date(activity.timestamp), "MMM d, yyyy");
                      }
                    })()}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
