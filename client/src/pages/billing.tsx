/**
 * Billing Page
 * Manage organization subscription, add-ons, and view usage
 */

import { useEffect } from "react";
import { useEntitlements, usePlans } from "@/hooks/useEntitlements";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Check, 
  AlertCircle,
  Loader2,
  TrendingUp,
  Package,
  BarChart3,
  Zap,
  Sparkles,
  Rocket,
  Monitor,
  Server
} from "lucide-react";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import type { PlanTier, AddOnKey } from "@shared/billing/plans";
import { PLAN_INFO, ADDON_INFO, getPlanDisplayName } from "@shared/billing/plans";

const PLAN_ICONS: Record<PlanTier, React.ElementType> = {
  free: Package,
  starter: TrendingUp,
  professional: BarChart3,
  enterprise: Zap,
};

export default function BillingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { entitlements, isLoading } = useEntitlements();
  const { data: plansData } = usePlans();
  const [, setLocation] = useLocation();

  const isAdmin = user?.role === "ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  useEffect(() => {
    if (isSuperAdmin) {
      setLocation("/admin/subscriptions");
    }
  }, [isSuperAdmin, setLocation]);

  if (isSuperAdmin) {
    return null;
  }

  const toggleModeMutation = useMutation({
    mutationFn: async (mode: "dev" | "production") => {
      const res = await apiRequest("POST", "/api/billing/toggle-mode", { mode });
      if (!res.ok) throw new Error("Failed to toggle mode");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Mode Changed", description: `Switched to ${data.isDevMode ? "Dev" : "Production"} mode.` });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/entitlements"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Task #2482: Stripe Checkout + Customer Portal mutations.
  const checkoutMutation = useMutation({
    mutationFn: async (planTier: PlanTier) => {
      const res = await apiRequest("POST", "/api/billing/checkout", {
        planTier,
        seats: 1,
      });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
    },
    onError: (e: any) => {
      toast({
        title: "Checkout unavailable",
        description: e?.message || "Stripe is not configured for this deployment.",
        variant: "destructive",
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
    },
    onError: (e: any) => {
      toast({
        title: "Portal unavailable",
        description: e?.message || "Stripe Customer Portal could not be opened.",
        variant: "destructive",
      });
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: async (planTier: PlanTier) => {
      const res = await apiRequest("POST", "/api/billing/subscription", { planTier });
      if (!res.ok) throw new Error("Failed to change plan");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Plan Updated", description: "Your subscription has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/entitlements"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleAddonMutation = useMutation({
    mutationFn: async ({ addonKey, enabled }: { addonKey: AddOnKey; enabled: boolean }) => {
      const res = await apiRequest("POST", `/api/billing/addons/${addonKey}/toggle`, { enabled });
      if (!res.ok) throw new Error("Failed to toggle add-on");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Add-on Updated", description: "Your add-ons have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/entitlements"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!entitlements) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Unable to load billing information</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentPlanInfo = PLAN_INFO[entitlements.planTier];
  const PlanIcon = PLAN_ICONS[entitlements.planTier] || Package;
  const displayName = getPlanDisplayName(entitlements.planTier);

  const paidPlans = plansData?.plans.filter(p => p.tier !== "free") || [];
  
  const aiAddons = plansData?.addons.filter(a => ADDON_INFO[a.key]?.category === "ai") || [];
  const growthAddons = plansData?.addons.filter(a => ADDON_INFO[a.key]?.category === "growth") || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Billing & Subscription</h1>
          <p className="text-muted-foreground">
            Manage your plan, add-ons, and usage
          </p>
        </div>
        <ContextualHelpButton />
        {isSuperAdmin ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleModeMutation.mutate(entitlements.isDevMode ? "production" : "dev")}
              disabled={toggleModeMutation.isPending}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer ${
                entitlements.isDevMode
                  ? "text-orange-500 border-orange-500 bg-orange-500/10 hover:bg-orange-500/20"
                  : "text-green-500 border-green-500 bg-green-500/10 hover:bg-green-500/20"
              }`}
              data-testid="button-toggle-billing-mode"
            >
              {toggleModeMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : entitlements.isDevMode ? (
                <Monitor className="w-3.5 h-3.5" />
              ) : (
                <Server className="w-3.5 h-3.5" />
              )}
              {entitlements.isDevMode ? "Dev Mode" : "Production"}
            </button>
          </div>
        ) : entitlements.isDevMode ? (
          <Badge variant="outline" className="text-orange-500 border-orange-500">
            Dev Mode
          </Badge>
        ) : null}
        {/* Task #2482: Admin-only Stripe self-serve actions. */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={portalMutation.isPending}
              onClick={() => portalMutation.mutate()}
              data-testid="button-billing-portal"
            >
              {portalMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : null}
              Manage billing
            </Button>
            {entitlements.planTier === "free" && (
              <Button
                size="sm"
                disabled={checkoutMutation.isPending}
                onClick={() => checkoutMutation.mutate("starter")}
                data-testid="button-billing-checkout"
              >
                {checkoutMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : null}
                Subscribe
              </Button>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <PlanIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {displayName}
                  <Badge variant="secondary">{entitlements.status}</Badge>
                  {currentPlanInfo?.revenueRange && (
                    <Badge variant="outline" className="text-xs">
                      {currentPlanInfo.revenueRange}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {entitlements.organizationName}
                </CardDescription>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">
                ${currentPlanInfo?.price || 0}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
              {entitlements.activeAddons.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  + {entitlements.activeAddons.length} add-on{entitlements.activeAddons.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="plans" className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans" data-testid="tab-plans">Plans</TabsTrigger>
          <TabsTrigger value="addons" data-testid="tab-addons">Add-ons</TabsTrigger>
          <TabsTrigger value="usage" data-testid="tab-usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {paidPlans.map((plan) => {
              const isCurrent = plan.tier === entitlements.planTier;
              const Icon = PLAN_ICONS[plan.tier] || Package;
              const planInfo = PLAN_INFO[plan.tier];
              const planDisplayName = getPlanDisplayName(plan.tier);

              return (
                <Card 
                  key={plan.tier} 
                  className={isCurrent ? "border-primary" : ""}
                  data-testid={`card-plan-${plan.tier}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{planDisplayName}</CardTitle>
                      </div>
                      {planInfo?.revenueRange && (
                        <Badge variant="outline" className="text-xs">
                          {planInfo.revenueRange}
                        </Badge>
                      )}
                    </div>
                    <CardDescription>{planInfo?.description || plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-bold">
                      ${planInfo?.price || plan.price}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {(planInfo?.features || plan.features).slice(0, 5).map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    {isCurrent ? (
                      <Badge className="w-full justify-center" variant="secondary">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button 
                        className="w-full" 
                        variant={(planInfo?.price || plan.price) > (currentPlanInfo?.price || 0) ? "default" : "outline"}
                        disabled={!isAdmin || changePlanMutation.isPending || !entitlements.isDevMode}
                        onClick={() => changePlanMutation.mutate(plan.tier)}
                        data-testid={`button-select-${plan.tier}`}
                      >
                        {changePlanMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (planInfo?.price || plan.price) > (currentPlanInfo?.price || 0) ? (
                          "Upgrade"
                        ) : (
                          "Downgrade"
                        )}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {!isAdmin && (
            <Card className="bg-muted/50">
              <CardContent className="py-4 text-center text-muted-foreground">
                Only organization administrators can change the subscription plan.
              </CardContent>
            </Card>
          )}

          {isAdmin && !entitlements.isDevMode && (
            <Card className="bg-muted/50">
              <CardContent className="py-4 text-center text-muted-foreground">
                Plan changes are managed through Stripe in production mode.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="addons" className="space-y-6">
          {aiAddons.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">AI & Automation</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {aiAddons.map((addon) => {
                  const isActive = entitlements.activeAddons.includes(addon.key);
                  const addonInfo = ADDON_INFO[addon.key];

                  return (
                    <Card 
                      key={addon.key}
                      data-testid={`card-addon-${addon.key}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <CardTitle className="text-lg">{addonInfo?.name || addon.name}</CardTitle>
                          <Badge variant={isActive ? "default" : "secondary"}>
                            {isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <CardDescription>{addonInfo?.description || addon.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex items-center justify-between">
                        <div className="text-xl font-bold">
                          +${addonInfo?.price || addon.price}
                          <span className="text-sm font-normal text-muted-foreground">/mo</span>
                        </div>
                        <Switch
                          checked={isActive}
                          disabled={!isAdmin || toggleAddonMutation.isPending || !entitlements.isDevMode}
                          onCheckedChange={(enabled) => 
                            toggleAddonMutation.mutate({ addonKey: addon.key, enabled })
                          }
                          data-testid={`switch-addon-${addon.key}`}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {growthAddons.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Rocket className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Business Growth</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {growthAddons.map((addon) => {
                  const isActive = entitlements.activeAddons.includes(addon.key);
                  const addonInfo = ADDON_INFO[addon.key];

                  return (
                    <Card 
                      key={addon.key}
                      data-testid={`card-addon-${addon.key}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <CardTitle className="text-lg">{addonInfo?.name || addon.name}</CardTitle>
                          <Badge variant={isActive ? "default" : "secondary"}>
                            {isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <CardDescription>{addonInfo?.description || addon.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex items-center justify-between">
                        <div className="text-xl font-bold">
                          +${addonInfo?.price || addon.price}
                          <span className="text-sm font-normal text-muted-foreground">/mo</span>
                        </div>
                        <Switch
                          checked={isActive}
                          disabled={!isAdmin || toggleAddonMutation.isPending || !entitlements.isDevMode}
                          onCheckedChange={(enabled) => 
                            toggleAddonMutation.mutate({ addonKey: addon.key, enabled })
                          }
                          data-testid={`switch-addon-${addon.key}`}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {isAdmin && !entitlements.isDevMode && (
            <Card className="bg-muted/50">
              <CardContent className="py-4 text-center text-muted-foreground">
                Add-on changes are managed through Stripe in production mode.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Vision Document Processing</CardTitle>
              <CardDescription>
                Documents processed this billing period
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">
                  {entitlements.usage.ai_vision_docs.quantity || 0}
                </span>
                <span className="text-muted-foreground">
                  / {entitlements.isDevMode ? 50 : 100} docs
                </span>
              </div>
              <Progress 
                value={(entitlements.usage.ai_vision_docs.quantity || 0) / (entitlements.isDevMode ? 50 : 100) * 100} 
              />
              {entitlements.usage.ai_vision_docs.periodStart && (
                <p className="text-sm text-muted-foreground">
                  Period: {new Date(entitlements.usage.ai_vision_docs.periodStart).toLocaleDateString()} - {new Date(entitlements.usage.ai_vision_docs.periodEnd!).toLocaleDateString()}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Features</CardTitle>
              <CardDescription>
                Features available with your current plan and add-ons
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {entitlements.features.map((feature) => (
                  <Badge key={feature} variant="outline">
                    <Check className="h-3 w-3 mr-1 text-green-500" />
                    {feature.replace(/_/g, ' ')}
                  </Badge>
                ))}
                {entitlements.features.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    No premium features active. Upgrade your plan to unlock features.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
