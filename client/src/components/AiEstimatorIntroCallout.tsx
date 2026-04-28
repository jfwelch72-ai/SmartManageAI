import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

type CalloutSurface = "bid-estimate" | "ai-takeoff";

interface Props {
  surface: CalloutSurface;
  className?: string;
}

const STORAGE_PREFIX = "smartmanage-ai-estimator-intro-dismissed-";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isDismissed(userId: string | undefined): boolean {
  if (!userId) return true;
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return true;
  }
}

const COPY: Record<CalloutSurface, { title: string; body: string }> = {
  "bid-estimate": {
    title: "New: Ask the AI Estimator",
    body:
      "Chat with the AI Estimator below to ask grounded questions about this bid, your prior work, and learned cost rates.",
  },
  "ai-takeoff": {
    title: "New: AI Estimator on this bid",
    body:
      "Use Draft full takeoff to let the AI Estimator scope this project, or open the bid estimate to chat with it about your numbers.",
  },
};

export function AiEstimatorIntroCallout({ surface, className }: Props) {
  const { user } = useAuth();
  const canUseAiEstimator = useFeaturePermission("canUseAiEstimator");
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    setDismissed(isDismissed(user?.id));
  }, [user?.id]);

  if (!user?.id) return null;
  if (!canUseAiEstimator) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(storageKey(user.id), "1");
    } catch {
      /* swallow — best-effort persistence */
    }
    setDismissed(true);
  };

  const copy = COPY[surface];

  return (
    <div
      role="status"
      className={
        "relative flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm " +
        (className ?? "")
      }
      data-testid={`callout-ai-estimator-${surface}`}
    >
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-tight" data-testid={`text-ai-estimator-callout-title-${surface}`}>
          {copy.title}
        </div>
        <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-ai-estimator-callout-body-${surface}`}>
          {copy.body}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
        onClick={handleDismiss}
        aria-label="Dismiss AI Estimator introduction"
        data-testid={`button-dismiss-ai-estimator-callout-${surface}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default AiEstimatorIntroCallout;
