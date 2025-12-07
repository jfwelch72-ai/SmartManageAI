import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Send, Bot, User, Loader2, CheckCircle2, Building2, Wrench, Users, MapPin, Package, ClipboardList, Globe, Calculator, ArrowLeft, Eye, Edit2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SuggestedCalculator {
  name: string;
  description?: string;
}

interface ExtractedData {
  tradeType: string | null;
  tradeName: string | null;
  crewSize: number | null;
  region: string | null;
  materials: string[] | null;
  workTypes: string[] | null;
  websiteUrl: string | null;
  suggestedCalculators: SuggestedCalculator[] | null;
}

interface Suggestions {
  workTypes: string[] | null;
  materials: string[] | null;
}

interface TradeResearchResult {
  tradeName: string;
  tradeDescription?: string;
  scopeOfWorkItems?: { name: string; description?: string; unit?: string; category?: string }[];
  commonMaterials?: { name: string; description?: string; unit?: string; category?: string }[];
  workTypes?: { name: string; unit?: string; typicalProductionRate?: string; description?: string }[];
  calculators?: { name: string; description?: string; outputUnit?: string; inputs?: { name: string; unit?: string }[] }[];
  vendorCategories?: string[];
  industryNotes?: string;
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData>({
    tradeType: null,
    tradeName: null,
    crewSize: null,
    region: null,
    materials: null,
    workTypes: null,
    websiteUrl: null,
    suggestedCalculators: null,
  });
  const [suggestions, setSuggestions] = useState<Suggestions>({
    workTypes: null,
    materials: null,
  });
  const [isComplete, setIsComplete] = useState(false);
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [showCompanyInput, setShowCompanyInput] = useState(false);
  const [showReviewStep, setShowReviewStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tradeResearch, setTradeResearch] = useState<TradeResearchResult | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const researchTrade = async (tradeName: string): Promise<TradeResearchResult | null> => {
    try {
      setIsResearching(true);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `One moment while I research "${tradeName}" to provide you with industry-specific suggestions...` 
      }]);
      
      const res = await apiRequest("POST", "/api/ai/onboarding/research-trade", {
        tradeName,
      });
      const data = await res.json();
      
      if (data.success && data.research) {
        setTradeResearch(data.research);
        return data.research;
      }
      return null;
    } catch (error) {
      console.error("Trade research error:", error);
      return null;
    } finally {
      setIsResearching(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setLocation('/login');
    }
  }, [user, setLocation]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    startConversation();
  }, []);

  const startConversation = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/ai/onboarding/chat", {
        message: "Hello, I'm ready to set up my construction management platform.",
        conversationHistory: [],
      });
      const data = await res.json();
      
      setMessages([{ role: 'assistant', content: data.message }]);
      if (data.extractedData) setExtractedData(prev => ({ ...prev, ...data.extractedData }));
      if (data.step) setStep(data.step);
    } catch (error) {
      console.error("Failed to start conversation:", error);
      setMessages([{ 
        role: 'assistant', 
        content: "Welcome! I'm here to help you set up your construction management platform. What type of contracting work does your company specialize in?" 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading || isResearching) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await apiRequest("POST", "/api/ai/onboarding/chat", {
        message: userMessage,
        conversationHistory,
        tradeResearch: tradeResearch,
      });
      const data = await res.json();
      
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      
      let newTradeType: string | null = null;
      let newTradeName: string | null = null;
      
      if (data.extractedData) {
        setExtractedData(prev => {
          const updated = { ...prev };
          if (data.extractedData.tradeType) {
            updated.tradeType = data.extractedData.tradeType;
            newTradeType = data.extractedData.tradeType;
          }
          if (data.extractedData.tradeName) {
            updated.tradeName = data.extractedData.tradeName;
            newTradeName = data.extractedData.tradeName;
          }
          if (data.extractedData.crewSize) updated.crewSize = data.extractedData.crewSize;
          if (data.extractedData.region) updated.region = data.extractedData.region;
          if (data.extractedData.materials) updated.materials = data.extractedData.materials;
          if (data.extractedData.workTypes) updated.workTypes = data.extractedData.workTypes;
          if (data.extractedData.websiteUrl) updated.websiteUrl = data.extractedData.websiteUrl;
          if (data.extractedData.suggestedCalculators) updated.suggestedCalculators = data.extractedData.suggestedCalculators;
          return updated;
        });
        
        // If we just identified a custom trade (OTHER) with a trade name, trigger research
        if (newTradeType === 'OTHER' && newTradeName && !tradeResearch) {
          setIsLoading(false);
          const research = await researchTrade(newTradeName);
          if (research) {
            // Send a follow-up message with the research context
            const followUpRes = await apiRequest("POST", "/api/ai/onboarding/chat", {
              message: "I've provided my trade type. Please continue with the setup using the industry research you've gathered.",
              conversationHistory: [...conversationHistory, 
                { role: 'user', content: userMessage },
                { role: 'assistant', content: data.message },
                { role: 'assistant', content: `One moment while I research "${newTradeName}" to provide you with industry-specific suggestions...` }
              ],
              tradeResearch: research,
            });
            const followUpData = await followUpRes.json();
            setMessages(prev => [...prev, { role: 'assistant', content: followUpData.message }]);
            if (followUpData.step) setStep(followUpData.step);
            if (followUpData.isComplete) {
              setIsComplete(true);
              setShowReviewStep(true);
            }
          }
          return;
        }
      }
      
      if (data.suggestions) {
        setSuggestions(prev => ({
          ...prev,
          ...data.suggestions,
        }));
      }
      
      if (data.step) setStep(data.step);
      if (data.isComplete) {
        setIsComplete(true);
        setShowReviewStep(true);
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const completeOnboarding = async () => {
    if (!companyName.trim()) {
      toast({
        title: "Company name required",
        description: "Please enter your company name to complete setup.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/ai/onboarding/complete", {
        companyName: companyName.trim(),
        tradeType: extractedData.tradeType || 'GENERAL_CONTRACTOR',
        tradeName: extractedData.tradeName,
        crewSize: extractedData.crewSize,
        region: extractedData.region,
        materials: extractedData.materials,
        workTypes: extractedData.workTypes,
        websiteUrl: websiteInput.trim() || extractedData.websiteUrl,
        suggestedCalculators: extractedData.suggestedCalculators,
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast({
          title: "Setup Complete!",
          description: "Your platform has been configured. Redirecting to dashboard...",
        });
        
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        
        setTimeout(() => {
          setLocation('/dashboard');
        }, 1500);
      }
    } catch (error: any) {
      console.error("Onboarding complete error:", error);
      toast({
        title: "Setup Failed",
        description: error.message || "Failed to complete setup. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const progressPercentage = Math.min((step / 7) * 100, 100);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold" data-testid="text-onboarding-title">Set Up Your Platform</h1>
          <p className="text-muted-foreground mt-2">
            Chat with our AI to configure your construction management platform
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Setup Assistant</CardTitle>
              </div>
              <Progress value={progressPercentage} className="h-2" />
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px] px-6" ref={scrollRef}>
                <div className="space-y-4 pb-4">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      data-testid={`message-${msg.role}-${idx}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div
                        className={`rounded-lg px-4 py-2 max-w-[80%] ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.role === 'user' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
                          <User className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                  {(isLoading || isResearching) && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="rounded-lg px-4 py-2 bg-muted flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {isResearching && <span className="text-sm text-muted-foreground">Researching industry data...</span>}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
            <CardFooter className="pt-4">
              {showReviewStep && !showCompanyInput ? (
                <div className="w-full space-y-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Eye className="h-5 w-5" />
                    <span className="font-semibold">Review Your Configuration</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Please review the information below before proceeding. You can go back to make changes or continue to finalize your setup.
                  </p>
                  
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Trade Type</p>
                        <p className="text-sm font-medium" data-testid="review-trade-type">
                          {extractedData.tradeName || extractedData.tradeType || 'Not specified'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Crew Size</p>
                        <p className="text-sm font-medium" data-testid="review-crew-size">
                          {extractedData.crewSize ? `${extractedData.crewSize} workers` : 'Not specified'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Region</p>
                        <p className="text-sm font-medium" data-testid="review-region">
                          {extractedData.region || 'Not specified'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Materials</p>
                        <p className="text-sm font-medium" data-testid="review-materials">
                          {extractedData.materials?.length ? `${extractedData.materials.length} items` : 'None specified'}
                        </p>
                      </div>
                    </div>
                    {extractedData.workTypes && extractedData.workTypes.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Work Types</p>
                        <div className="flex flex-wrap gap-1">
                          {extractedData.workTypes.slice(0, 5).map((type, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {type}
                            </Badge>
                          ))}
                          {extractedData.workTypes.length > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{extractedData.workTypes.length - 5} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => {
                        setShowReviewStep(false);
                        setIsComplete(false);
                      }}
                      className="flex-1"
                      data-testid="button-go-back"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Go Back
                    </Button>
                    <Button 
                      onClick={() => {
                        setShowReviewStep(false);
                        setShowCompanyInput(true);
                      }}
                      className="flex-1"
                      data-testid="button-confirm-continue"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Confirm & Continue
                    </Button>
                  </div>
                </div>
              ) : showCompanyInput ? (
                <div className="w-full space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Enter your company name"
                      data-testid="input-company-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="websiteUrl">Website (optional)</Label>
                    <Input
                      id="websiteUrl"
                      type="url"
                      value={websiteInput}
                      onChange={(e) => setWebsiteInput(e.target.value)}
                      placeholder="https://yourcompany.com"
                      data-testid="input-website-url"
                    />
                    <p className="text-xs text-muted-foreground">
                      We'll match your platform colors to your brand
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => {
                        setShowCompanyInput(false);
                        setShowReviewStep(true);
                      }}
                      data-testid="button-back-to-review"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button 
                      onClick={completeOnboarding} 
                      className="flex-1"
                      disabled={isSubmitting || !companyName.trim()}
                      data-testid="button-complete-setup"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Complete Setup
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 w-full">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your response..."
                    disabled={isLoading || isResearching}
                    data-testid="input-onboarding-message"
                  />
                  <Button 
                    onClick={sendMessage} 
                    disabled={isLoading || isResearching || !input.trim()}
                    data-testid="button-send-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Configuration
              </CardTitle>
              <CardDescription>
                Information collected so far
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Building2 className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Trade Type</p>
                    {extractedData.tradeType ? (
                      <Badge variant="secondary" data-testid="badge-trade-type">
                        {extractedData.tradeName || extractedData.tradeType}
                      </Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not yet specified</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Users className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Crew Size</p>
                    {extractedData.crewSize ? (
                      <Badge variant="secondary" data-testid="badge-crew-size">
                        {extractedData.crewSize} workers
                      </Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not yet specified</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Region</p>
                    {extractedData.region ? (
                      <Badge variant="secondary" data-testid="badge-region">
                        {extractedData.region}
                      </Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not yet specified</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Package className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Materials</p>
                    {extractedData.materials && extractedData.materials.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {extractedData.materials.slice(0, 4).map((mat, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs" data-testid={`badge-material-${idx}`}>
                            {mat}
                          </Badge>
                        ))}
                        {extractedData.materials.length > 4 && (
                          <Badge variant="outline" className="text-xs">
                            +{extractedData.materials.length - 4} more
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not yet specified</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <ClipboardList className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Work Types</p>
                    {extractedData.workTypes && extractedData.workTypes.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {extractedData.workTypes.slice(0, 3).map((wt, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs" data-testid={`badge-work-type-${idx}`}>
                            {wt}
                          </Badge>
                        ))}
                        {extractedData.workTypes.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{extractedData.workTypes.length - 3} more
                          </Badge>
                        )}
                      </div>
                    ) : suggestions.workTypes && suggestions.workTypes.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {suggestions.workTypes.length} suggestions available
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not yet specified</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Globe className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Website</p>
                    {extractedData.websiteUrl ? (
                      <Badge variant="secondary" className="text-xs" data-testid="badge-website">
                        {extractedData.websiteUrl.replace(/^https?:\/\//, '').slice(0, 25)}...
                      </Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground">Optional - for brand colors</p>
                    )}
                  </div>
                </div>

                {extractedData.suggestedCalculators && extractedData.suggestedCalculators.length > 0 && (
                  <div className="flex items-start gap-3">
                    <Calculator className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Calculators</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {extractedData.suggestedCalculators.slice(0, 2).map((calc, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs" data-testid={`badge-calculator-${idx}`}>
                            {calc.name}
                          </Badge>
                        ))}
                        {extractedData.suggestedCalculators.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{extractedData.suggestedCalculators.length - 2} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {isComplete && (
                <div className="pt-4 border-t">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Ready to complete!</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
