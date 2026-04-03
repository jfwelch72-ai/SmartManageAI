import { lazy, Suspense, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";

const AIPMDashboard = lazy(() => import("@/pages/ai-pm-dashboard"));
const CFODashboard = lazy(() => import("@/pages/cfo-dashboard"));
const AIDocumentAnalysisPage = lazy(() => import("@/pages/ai-document-analysis"));
const VoiceLogsPage = lazy(() => import("@/pages/voice-logs"));

type AIFeatureType = "ai-pm" | "cfo" | "document-analysis" | "voice-logs";

interface AIFeatureDialogProps {
  feature: AIFeatureType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const featureTitles: Record<AIFeatureType, string> = {
  "ai-pm": "AI Project Manager",
  "cfo": "CFO Financial Analytics",
  "document-analysis": "AI Document Analysis",
  "voice-logs": "Voice Logs",
};

function AIFeatureContent({ feature }: { feature: AIFeatureType }) {
  switch (feature) {
    case "ai-pm":
      return <AIPMDashboard />;
    case "cfo":
      return <CFODashboard />;
    case "document-analysis":
      return <AIDocumentAnalysisPage />;
    case "voice-logs":
      return <VoiceLogsPage />;
    default:
      return null;
  }
}

export function AIFeatureDialog({ feature, open, onOpenChange }: AIFeatureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto" data-testid={`dialog-${feature}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {featureTitles[feature]}
          </DialogTitle>
        </DialogHeader>
        <Suspense fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }>
          <div className="[&>div]:min-h-0 [&>div]:!p-0 [&>div>main]:!p-0 [&>div>main]:!px-0 [&>div>main]:!py-0 [&>div]:!min-h-0">
            <AIFeatureContent feature={feature} />
          </div>
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

interface AIFeatureTriggerProps {
  feature: AIFeatureType;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  label?: string;
  "data-testid"?: string;
}

export function AIFeatureTrigger({
  feature,
  variant = "outline",
  size = "sm",
  className = "",
  label,
  "data-testid": testId,
}: AIFeatureTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        data-testid={testId || `button-open-${feature}`}
      >
        <Sparkles className="h-4 w-4 mr-2" />
        {label || featureTitles[feature]}
      </Button>
      <AIFeatureDialog feature={feature} open={open} onOpenChange={setOpen} />
    </>
  );
}
