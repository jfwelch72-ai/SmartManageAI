import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, X, Send, Loader2, Minimize, Maximize, Minimize2, Maximize2, Sparkles, ChevronRight, CheckCircle2, SkipForward, RotateCcw, PartyPopper, Trophy, Lightbulb, Target, MapPin, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface WalkthroughStep {
  stepNumber: number;
  title: string;
  description: string;
  action: string;
  targetPage: string;
  tips: string[];
}

interface WalkthroughStatus {
  walkthroughCompleted: boolean;
  walkthroughStep: number;
  walkthroughStartedAt: string | null;
  totalSteps: number;
  role: string;
  firstName?: string;
  walkthrough: {
    roleName: string;
    welcomeMessage: string;
    completionMessage: string;
    currentStep: WalkthroughStep | null;
  } | null;
}

const STORAGE_KEY = "smartmanage-ai-assistant-enabled";
const MINIMIZED_KEY = "smartmanage-ai-assistant-minimized";

export function AIAssistantWidget() {
  const { user, organizationName } = useAuth();
  const assistantName = organizationName ? `${organizationName} AI` : "SmartManageAI";
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => {
    const stored = localStorage.getItem(MINIMIZED_KEY);
    return stored === "true";
  });
  const [isEnabled, setIsEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== "false";
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState("");
  const [showMilestone, setShowMilestone] = useState(false);
  const [milestoneData, setMilestoneData] = useState<{ progress: number; message: string } | null>(null);
  const [navigationHint, setNavigationHint] = useState<string | null>(null);
  const [messagingWidgetOpen, setMessagingWidgetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevLocation = useRef<string | null>(null);
  const celebratedMilestones = useRef<Set<number>>(new Set());

  const { data: walkthroughStatus, isLoading: statusLoading } = useQuery<WalkthroughStatus>({
    queryKey: ["/api/ai/walkthrough/status"],
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const isInWalkthrough = walkthroughStatus && !walkthroughStatus.walkthroughCompleted && walkthroughStatus.walkthroughStep > 0;
  const hasNotStarted = walkthroughStatus && !walkthroughStatus.walkthroughCompleted && walkthroughStatus.walkthroughStep === 0;
  
  // On dashboard, let FirstTimeWelcomeModal handle the "not started" state
  const isOnDashboard = location === '/' || location === '/dashboard';
  const shouldShowWelcomeInWidget = hasNotStarted && !isOnDashboard;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isEnabled));
  }, [isEnabled]);

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      setIsEnabled(stored !== "false");
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    const handleOpenAssistant = () => {
      setIsOpen(true);
      setIsMinimized(false);
    };
    window.addEventListener("open-ai-assistant", handleOpenAssistant);
    return () => window.removeEventListener("open-ai-assistant", handleOpenAssistant);
  }, []);

  useEffect(() => {
    const handleMessagingState = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      setMessagingWidgetOpen(!!detail?.isOpen);
    };
    window.addEventListener("messaging-widget-state", handleMessagingState);
    return () => window.removeEventListener("messaging-widget-state", handleMessagingState);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ai-assistant-widget-state", { detail: { isOpen } }));
    return () => {
      window.dispatchEvent(new CustomEvent("ai-assistant-widget-state", { detail: { isOpen: false } }));
    };
  }, [isOpen]);

  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, String(isMinimized));
  }, [isMinimized]);

  // Auto-open and expand the assistant when walkthrough becomes active
  // This handles both FirstTimeWelcomeModal "Start Tour" and sidebar "Start Tutorial" actions
  const prevWalkthroughStep = useRef<number | undefined>(undefined);
  
  useEffect(() => {
    const currentStep = walkthroughStatus?.walkthroughStep;
    const wasZeroOrUndefined = prevWalkthroughStep.current === 0 || prevWalkthroughStep.current === undefined;
    const isNowInWalkthrough = currentStep !== undefined && currentStep > 0 && !walkthroughStatus?.walkthroughCompleted;
    
    // If walkthrough just started (transitioned from 0 or undefined to step 1+), open and expand
    if (wasZeroOrUndefined && isNowInWalkthrough) {
      setIsOpen(true);
      setIsMinimized(false);
    }
    
    prevWalkthroughStep.current = currentStep;
  }, [walkthroughStatus?.walkthroughStep, walkthroughStatus?.walkthroughCompleted]);

  // Navigation detection - show encouragement when user arrives at correct page
  useEffect(() => {
    if (!isInWalkthrough || !walkthroughStatus?.walkthrough?.currentStep) {
      setNavigationHint(null);
      prevLocation.current = location;
      return;
    }

    const targetPage = walkthroughStatus.walkthrough.currentStep.targetPage;
    const justNavigated = prevLocation.current !== location;
    
    // Check if user arrived at the correct page for current step
    if (justNavigated && location.startsWith(targetPage)) {
      const firstName = walkthroughStatus.firstName || 'there';
      const messages = [
        `Great navigation, ${firstName}! You're in the right place.`,
        `Perfect, ${firstName}! This is exactly where you need to be.`,
        `Nice work finding this page, ${firstName}! Let's continue.`,
        `You've got this, ${firstName}! Ready for the next action?`,
      ];
      setNavigationHint(messages[Math.floor(Math.random() * messages.length)]);
      
      // Clear the hint after 4 seconds
      setTimeout(() => setNavigationHint(null), 4000);
    }
    
    prevLocation.current = location;
  }, [location, isInWalkthrough, walkthroughStatus]);

  // Milestone celebration - celebrate progress at 25%, 50%, 75%
  // Uses step-based thresholds for deterministic triggering
  useEffect(() => {
    if (!isInWalkthrough || !walkthroughStatus || walkthroughStatus.totalSteps === 0) return;
    
    const currentStep = walkthroughStatus.walkthroughStep;
    const totalSteps = walkthroughStatus.totalSteps;
    const firstName = walkthroughStatus.firstName || 'there';
    
    // Calculate step thresholds for deterministic milestone triggering
    const milestones = [
      { threshold: 25, stepThreshold: Math.ceil(totalSteps * 0.25), message: `Quarter of the way there, ${firstName}! You're picking this up quickly.` },
      { threshold: 50, stepThreshold: Math.ceil(totalSteps * 0.50), message: `Halfway done, ${firstName}! You're becoming a pro at this.` },
      { threshold: 75, stepThreshold: Math.ceil(totalSteps * 0.75), message: `Almost there, ${firstName}! Just a few more steps to go.` },
    ];
    
    for (const milestone of milestones) {
      // Trigger when reaching exactly the step threshold
      if (currentStep === milestone.stepThreshold && !celebratedMilestones.current.has(milestone.threshold)) {
        celebratedMilestones.current.add(milestone.threshold);
        setMilestoneData({ progress: milestone.threshold, message: milestone.message });
        setShowMilestone(true);
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => setShowMilestone(false), 3000);
        break;
      }
    }
  }, [isInWalkthrough, walkthroughStatus?.walkthroughStep, walkthroughStatus?.totalSteps, walkthroughStatus?.firstName]);

  // Reset celebrated milestones when walkthrough resets
  useEffect(() => {
    if (!isInWalkthrough && walkthroughStatus?.walkthroughStep === 0) {
      celebratedMilestones.current.clear();
    }
  }, [isInWalkthrough, walkthroughStatus?.walkthroughStep]);

  const startWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/start");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      setMessages([]);
    },
  });

  const nextStepMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/next");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.completed) {
        setCelebrationMessage(data.completionMessage);
        setShowCelebration(true);
        setTimeout(() => {
          setShowCelebration(false);
          queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
        }, 5000);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
        setMessages([]);
      }
    },
  });

  const skipWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/complete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      setMessages([]);
    },
  });

  const resetWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/reset");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      setMessages([]);
    },
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", "/api/ai/assistant/chat", {
        message,
        currentPath: location,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      }]);
    },
    onError: () => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      }]);
    },
  });

  const handleSend = () => {
    const message = inputValue.trim();
    if (!message || chatMutation.isPending) return;

    setMessages(prev => [...prev, {
      role: "user",
      content: message,
      timestamp: new Date(),
    }]);
    setInputValue("");
    chatMutation.mutate(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const navigateToStep = () => {
    const targetPage = walkthroughStatus?.walkthrough?.currentStep?.targetPage;
    if (targetPage) {
      navigate(targetPage);
    }
  };

  // Always show widget if in walkthrough, even if normally disabled
  if (!user) return null;
  if (!isEnabled && !isInWalkthrough) return null;

  const currentStep = walkthroughStatus?.walkthrough?.currentStep;
  const progress = walkthroughStatus ? (walkthroughStatus.walkthroughStep / walkthroughStatus.totalSteps) * 100 : 0;

  return (
    <>
      {showCelebration && (
        <div 
          className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          style={{ zIndex: 10000 }}
        >
          <div className="bg-card border rounded-2xl shadow-2xl p-8 max-w-md text-center animate-in zoom-in-95 duration-300">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <div className="absolute inset-0 animate-ping">
                  <Trophy className="h-16 w-16 text-yellow-500/50" />
                </div>
                <Trophy className="h-16 w-16 text-yellow-500 relative" />
              </div>
            </div>
            <div className="flex justify-center gap-2 mb-4">
              <PartyPopper className="h-8 w-8 text-pink-500 animate-bounce" />
              <PartyPopper className="h-8 w-8 text-blue-500 animate-bounce delay-75" />
              <PartyPopper className="h-8 w-8 text-green-500 animate-bounce delay-150" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Congratulations!</h2>
            <p className="text-muted-foreground mb-6">{celebrationMessage}</p>
            <Button onClick={() => setShowCelebration(false)} className="w-full" data-testid="button-celebration-close">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Get Started
            </Button>
          </div>
        </div>
      )}

      {showMilestone && milestoneData && (
        <div 
          className="fixed right-6 bg-gradient-to-r from-primary/90 to-purple-500/90 text-primary-foreground rounded-lg shadow-lg p-4 max-w-xs animate-in slide-in-from-right duration-300"
          style={{ bottom: '130px', zIndex: 9998 }}
          data-testid="milestone-celebration"
        >
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 p-2 bg-white/20 rounded-full">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-sm">{milestoneData.progress}% Complete!</div>
              <p className="text-xs opacity-90 mt-0.5">{milestoneData.message}</p>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`relative flex items-center justify-center w-12 h-12 rounded-full shadow-lg hover-elevate active-elevate-2 transition-all ${
            hasNotStarted || isInWalkthrough 
              ? "bg-gradient-to-r from-primary to-purple-500 animate-pulse" 
              : "bg-primary"
          } text-primary-foreground`}
          data-testid="button-ai-assistant-open"
        >
          {hasNotStarted || isInWalkthrough ? (
            <Lightbulb className="h-5 w-5" />
          ) : (
            <Bot className="h-5 w-5" />
          )}
          <span className="sr-only">Open AI Assistant</span>
        </button>
      )}

      {isOpen && (
        <div 
          className={`bg-card border shadow-2xl transition-all duration-300 ease-in-out ${
            isFullscreen 
              ? "fixed inset-0 w-full h-full rounded-none flex flex-col" 
              : `rounded-lg ${isMinimized ? "w-64" : "w-80 sm:w-96"}`
          }`}
          style={isFullscreen ? { 
            zIndex: 9999,
          } : { 
            position: 'fixed', 
            bottom: '24px', 
            right: messagingWidgetOpen ? '590px' : '24px', 
            zIndex: 9999,
            maxWidth: messagingWidgetOpen ? 'calc(100vw - 620px)' : 'calc(100vw - 48px)',
            transition: 'right 0.3s ease'
          }}
          data-testid="ai-assistant-panel"
        >
          <div className={`flex items-center justify-between p-3 border-b ${isFullscreen ? "" : "rounded-t-lg"} ${
            isInWalkthrough ? "bg-gradient-to-r from-primary/10 to-purple-500/10" : "bg-muted/50"
          }`}>
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-md ${isInWalkthrough ? "bg-primary/20" : "bg-primary/10"}`}>
                {isInWalkthrough ? (
                  <Target className="h-4 w-4 text-primary" />
                ) : (
                  <Sparkles className="h-4 w-4 text-primary" />
                )}
              </div>
              <span className="font-medium text-sm">
                {isInWalkthrough ? "Getting Started" : assistantName}
              </span>
              {isInWalkthrough && walkthroughStatus && (
                <Badge variant="secondary" className="text-xs">
                  Step {walkthroughStatus.walkthroughStep}/{walkthroughStatus.totalSteps}
                </Badge>
              )}
              {!isInWalkthrough && <Badge variant="secondary" className="text-xs">AI</Badge>}
            </div>
            <div className="flex items-center gap-1">
              {!isFullscreen && (
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-7 w-7"
                  onClick={() => setIsMinimized(!isMinimized)}
                  title={isMinimized ? "Expand" : "Minimize"}
                  data-testid="button-ai-assistant-minimize"
                >
                  {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                onClick={() => {
                  if (!isFullscreen) setIsMinimized(false);
                  setIsFullscreen(!isFullscreen);
                }}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                data-testid="button-ai-assistant-fullscreen"
              >
                {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                onClick={() => {
                  setIsFullscreen(false);
                  setIsOpen(false);
                }}
                title="Close"
                data-testid="button-ai-assistant-close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setIsEnabled(false);
                  setIsFullscreen(false);
                  setIsOpen(false);
                }}
                title="Hide AI Assistant completely (re-enable in Settings)"
                data-testid="button-ai-assistant-hide"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {!isMinimized && (
            <div className={isFullscreen ? "flex flex-col flex-1 min-h-0" : ""}>
              {isInWalkthrough && walkthroughStatus && (
                <div className="px-3 pt-2">
                  <Progress value={progress} className="h-1.5" />
                </div>
              )}

              <ScrollArea className={`${isFullscreen ? "flex-1" : "h-80"} p-3 ${isFullscreen ? "px-6" : ""}`} ref={scrollRef}>
                {shouldShowWelcomeInWidget && walkthroughStatus?.walkthrough ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <div className="p-4 rounded-full bg-gradient-to-r from-primary/20 to-purple-500/20 mb-4">
                      <Lightbulb className="h-10 w-10 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">
                      Welcome, {walkthroughStatus.walkthrough.roleName}!
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {walkthroughStatus.walkthrough.welcomeMessage}
                    </p>
                    <div className="flex flex-col gap-2 w-full">
                      <Button 
                        onClick={() => startWalkthroughMutation.mutate()}
                        disabled={startWalkthroughMutation.isPending}
                        className="w-full"
                        data-testid="button-start-walkthrough"
                      >
                        {startWalkthroughMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-2" />
                        )}
                        Start Quick Tour
                      </Button>
                      <Button 
                        variant="ghost" 
                        onClick={() => skipWalkthroughMutation.mutate()}
                        disabled={skipWalkthroughMutation.isPending}
                        className="text-xs"
                        data-testid="button-skip-walkthrough"
                      >
                        <SkipForward className="h-3 w-3 mr-1" />
                        Skip, I know my way around
                      </Button>
                    </div>
                  </div>
                ) : isInWalkthrough && currentStep ? (
                  <div className="space-y-4">
                    {navigationHint && (
                      <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2 animate-in fade-in duration-300" data-testid="navigation-hint">
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        <span className="text-sm text-green-700 dark:text-green-400">{navigationHint}</span>
                      </div>
                    )}
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">
                          Step {currentStep.stepNumber}
                        </Badge>
                        <span className="font-medium text-sm">{currentStep.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {currentStep.description}
                      </p>
                      <div className="p-2 rounded bg-muted/50 mb-3">
                        <p className="text-sm font-medium flex items-start gap-2">
                          <Target className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                          {currentStep.action}
                        </p>
                      </div>
                      {location !== currentStep.targetPage && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={navigateToStep}
                          className="w-full"
                          data-testid="button-navigate-step"
                        >
                          <MapPin className="h-3 w-3 mr-2" />
                          Go to {currentStep.targetPage.replace(/^\//, '').split('/').map(s => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(' / ')}
                        </Button>
                      )}
                    </div>

                    {currentStep.tips.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tips</p>
                        {currentStep.tips.map((tip, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <Lightbulb className="h-3 w-3 mt-0.5 text-yellow-500 shrink-0" />
                            <span>{tip}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {messages.length > 0 && (
                      <div className="border-t pt-3 space-y-3">
                        {messages.map((msg, idx) => (
                          <div
                            key={idx}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted"
                              }`}
                            >
                              <div className="whitespace-pre-wrap">{msg.content}</div>
                            </div>
                          </div>
                        ))}
                        {chatMutation.isPending && (
                          <div className="flex justify-start">
                            <div className="bg-muted rounded-lg px-3 py-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <Bot className="h-12 w-12 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium mb-1">Hi, I'm {assistantName}!</p>
                    <p className="text-xs text-muted-foreground">
                      Ask me anything about using the platform. I can help with projects, bids, delays, and more.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-3 justify-center">
                      {["How do I create a delay?", "What is a change order?", "Help with time clock"].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => {
                            setInputValue(suggestion);
                            inputRef.current?.focus();
                          }}
                          className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                    {walkthroughStatus?.walkthroughCompleted && (
                      <button
                        onClick={() => resetWalkthroughMutation.mutate()}
                        disabled={resetWalkthroughMutation.isPending}
                        className="flex items-center gap-1 mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-retake-walkthrough"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retake the quick tour
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    ))}
                    {chatMutation.isPending && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-3 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className={`p-3 border-t ${isFullscreen ? "px-6" : ""}`}>
                {isInWalkthrough ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        ref={inputRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about this step..."
                        className="flex-1 text-sm"
                        disabled={chatMutation.isPending}
                        data-testid="input-walkthrough-message"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={handleSend}
                        disabled={!inputValue.trim() || chatMutation.isPending}
                        data-testid="button-walkthrough-send"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        className="flex-1"
                        onClick={() => nextStepMutation.mutate()}
                        disabled={nextStepMutation.isPending}
                        data-testid="button-next-step"
                      >
                        {nextStepMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : walkthroughStatus && walkthroughStatus.walkthroughStep === walkthroughStatus.totalSteps ? (
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-2" />
                        )}
                        {walkthroughStatus && walkthroughStatus.walkthroughStep === walkthroughStatus.totalSteps 
                          ? "Complete Tour" 
                          : "Next Step"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => skipWalkthroughMutation.mutate()}
                        disabled={skipWalkthroughMutation.isPending}
                        title="Skip walkthrough"
                        data-testid="button-skip-step"
                      >
                        <SkipForward className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        ref={inputRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask a question..."
                        className="flex-1 text-sm"
                        disabled={chatMutation.isPending}
                        data-testid="input-ai-assistant-message"
                      />
                      <Button
                        size="icon"
                        onClick={handleSend}
                        disabled={!inputValue.trim() || chatMutation.isPending}
                        data-testid="button-ai-assistant-send"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                    {messages.length > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <button
                          onClick={clearChat}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          data-testid="button-ai-assistant-clear"
                        >
                          Clear chat
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Assistant</span>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={setIsEnabled}
                            className="scale-75"
                            data-testid="switch-ai-assistant-toggle"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {isMinimized && (
            <div className="p-3 text-center" onClick={() => setIsMinimized(false)}>
              <p className="text-xs text-muted-foreground cursor-pointer">Click to expand</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default AIAssistantWidget;
