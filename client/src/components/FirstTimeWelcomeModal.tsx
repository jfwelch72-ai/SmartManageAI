import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Sparkles, 
  ChevronRight, 
  SkipForward, 
  Rocket, 
  Users, 
  Calculator, 
  ClipboardList,
  Target,
  Clock,
  Shield,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WalkthroughStatus {
  walkthroughCompleted: boolean;
  walkthroughStep: number;
  walkthroughStartedAt: string | null;
  totalSteps: number;
  role: string;
  walkthrough: {
    roleName: string;
    welcomeMessage: string;
    completionMessage: string;
    currentStep: any | null;
  } | null;
}

const DISMISSED_KEY = "smartmanage-welcome-dismissed";

const roleFeatures: Record<string, { icon: any; features: string[] }> = {
  ADMIN: {
    icon: Shield,
    features: [
      "Set up your team with custom roles and permissions",
      "Manage vendors, suppliers, and subcontractors",
      "Create detailed bids and estimates",
      "Track projects from start to finish",
    ],
  },
  MANAGER: {
    icon: Users,
    features: [
      "Review and approve bids from your team",
      "Monitor active projects and progress",
      "Handle change orders efficiently",
      "Coordinate with superintendents and estimators",
    ],
  },
  ESTIMATOR: {
    icon: Calculator,
    features: [
      "Create accurate bids with our estimating tools",
      "Use AI-powered document analysis",
      "Access vendor pricing catalogs",
      "Generate professional quotes",
    ],
  },
  SUPERINTENDENT: {
    icon: ClipboardList,
    features: [
      "Track daily field progress",
      "Manage crew timesheets",
      "Document delays and issues",
      "Monitor T&M work",
    ],
  },
  OFFICE_MANAGER: {
    icon: Target,
    features: [
      "Manage billing and invoices",
      "Track vendor relationships",
      "Handle supply ordering",
      "Coordinate with field teams",
    ],
  },
  HOURLY_EMPLOYEE: {
    icon: Clock,
    features: [
      "Clock in/out with GPS tracking",
      "View your work schedule",
      "Stay connected with your team",
      "Access project details",
    ],
  },
  SUPER_ADMIN: {
    icon: Shield,
    features: [
      "Monitor all platform organizations",
      "View analytics and usage metrics",
      "Assist with user issues",
      "Manage platform configuration",
    ],
  },
};

export function FirstTimeWelcomeModal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [hasError, setHasError] = useState(false);

  const { data: walkthroughStatus, isLoading } = useQuery<WalkthroughStatus>({
    queryKey: ["/api/ai/walkthrough/status"],
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const hasNotStarted = walkthroughStatus && 
    !walkthroughStatus.walkthroughCompleted && 
    walkthroughStatus.walkthroughStep === 0;

  useEffect(() => {
    if (hasNotStarted && user) {
      const dismissed = sessionStorage.getItem(DISMISSED_KEY);
      if (!dismissed) {
        const timer = setTimeout(() => setShowModal(true), 500);
        return () => clearTimeout(timer);
      }
    }
  }, [hasNotStarted, user]);

  const startWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/start");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      // Only dismiss after successful start
      sessionStorage.setItem(DISMISSED_KEY, "true");
      handleClose();
    },
    onError: () => {
      setHasError(true);
      toast({
        title: "Couldn't start the tour",
        description: "Please try again or use the Start Tutorial button in the sidebar.",
        variant: "destructive",
      });
    },
  });

  const skipWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/complete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      sessionStorage.setItem(DISMISSED_KEY, "true");
      handleCloseWithoutDismiss();
    },
    onError: () => {
      // If skip fails, just close the modal locally
      // User can restart from sidebar if needed
      sessionStorage.setItem(DISMISSED_KEY, "true");
      handleCloseWithoutDismiss();
    },
  });

  const handleCloseWithoutDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      setShowModal(false);
      setIsExiting(false);
    }, 300);
  };

  const handleClose = () => {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    handleCloseWithoutDismiss();
  };

  const handleSkip = () => {
    // Call the mutation to mark walkthrough as complete on server
    skipWalkthroughMutation.mutate();
  };

  const handleStartTour = () => {
    setHasError(false);
    startWalkthroughMutation.mutate();
    // Don't set DISMISSED_KEY here - only set it on success
  };

  if (!showModal || !user || isLoading) return null;

  const roleConfig = roleFeatures[user.role] || roleFeatures.ADMIN;
  const RoleIcon = roleConfig.icon;
  const roleName = walkthroughStatus?.walkthrough?.roleName || user.role;
  const totalSteps = walkthroughStatus?.totalSteps || 0;

  return (
    <div 
      className={`fixed inset-0 flex items-center justify-center p-4 transition-all duration-300 ${
        isExiting ? "opacity-0" : "opacity-100"
      }`}
      style={{ zIndex: 99999, backgroundColor: "rgba(0, 0, 0, 0.85)" }}
      data-testid="first-time-welcome-modal"
    >
      <div 
        className={`relative w-full max-w-2xl bg-card border-2 border-primary/30 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
          isExiting ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5 pointer-events-none" />
        
        <div className="relative p-8">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-primary/30 rounded-full" />
              <div className="relative p-5 rounded-full bg-gradient-to-br from-primary to-purple-600 shadow-lg">
                <Rocket className="h-10 w-10 text-white" />
              </div>
            </div>
          </div>

          <div className="text-center mb-8">
            <Badge variant="secondary" className="mb-4 px-4 py-1 text-sm">
              <RoleIcon className="h-3.5 w-3.5 mr-1.5" />
              {roleName}
            </Badge>
            <h1 className="text-3xl font-bold mb-3">
              Welcome to SmartManageAI!
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              Let's get you up to speed quickly. Our guided tour will show you everything you need to know.
            </p>
          </div>

          <div className="bg-muted/50 rounded-xl p-5 mb-8">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              What you'll learn in {totalSteps} quick steps:
            </h3>
            <ul className="space-y-2.5">
              {roleConfig.features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm">
                  <div className="mt-1 h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-primary">{idx + 1}</span>
                  </div>
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            {hasError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Something went wrong. Please try again.</span>
              </div>
            )}
            
            <Button 
              size="lg"
              className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-lg"
              onClick={handleStartTour}
              disabled={startWalkthroughMutation.isPending}
              data-testid="button-start-tour-modal"
            >
              {startWalkthroughMutation.isPending ? (
                <>
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-3" />
                  Starting...
                </>
              ) : hasError ? (
                <>
                  <Rocket className="h-5 w-5 mr-3" />
                  Try Again
                  <ChevronRight className="h-5 w-5 ml-2" />
                </>
              ) : (
                <>
                  <Rocket className="h-5 w-5 mr-3" />
                  Start Guided Tour
                  <ChevronRight className="h-5 w-5 ml-2" />
                </>
              )}
            </Button>
            
            <Button 
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
              onClick={handleSkip}
              disabled={skipWalkthroughMutation.isPending}
              data-testid="button-skip-tour-modal"
            >
              <SkipForward className="h-4 w-4 mr-2" />
              Skip for now (you can start the tour anytime from the sidebar)
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            The tour takes about 5 minutes and can be paused at any step
          </p>
        </div>
      </div>
    </div>
  );
}
