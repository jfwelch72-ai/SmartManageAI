/**
 * Billing Page
 * Manage organization subscription, add-ons, and view usage
 */

import { useState } from "react";
import { useEntitlements, usePlans } from "@/hooks/useEntitlements";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Crown, 
  Sparkles, 
  Check, 
  X,
  AlertCircle,
  Loader2,
  TrendingUp,
  Package,
  BarChart3,
  Zap,
  Building2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import type { PlanTier, AddOnKey } from "@shared/billing/plans";

const PLAN_ICONS: Record<PlanTier, React.ElementType> = {
  free: Package,
  starter: TrendingUp,
  professional: BarChart3,
  enterprise: Zap,
};

export default function BillingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { entitlements, isLoading, refetch } = useEntitlements();
  const { data: plansData } = usePlans();

  // Check if user is admin
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  // Plan change mutation
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

  // Add-on toggle mutation
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

  const currentPlanInfo = plansData?.plans.find(p => p.tier === entitlements.planTier);
  const PlanIcon = PLAN_ICONS[entitlements.planTier] || Package;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing & Subscription</h1>
          <p className="text-muted-foreground">
            Manage your plan, add-ons, and usage
          </p>
        </div>
        {entitlements.isDevMode && (
          <Badge variant="outline" className="text-orange-500 border-orange-500">
            Dev Mode
          </Badge>
        )}
      </div>

      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <PlanIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  {entitlements.planInfo?.name || entitlements.planTier}
                  <Badge variant="secondary">{entitlements.status}</Badge>
                </CardTitle>
                <CardDescription>
                  {entitlements.organizationName}
                </CardDescription>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">
                ${entitlements.planInfo?.price || 0}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
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

        {/* Plans Tab */}
        <TabsContent value="plans" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plansData?.plans.map((plan) => {
              const isCurrent = plan.tier === entitlements.planTier;
              const Icon = PLAN_ICONS[plan.tier] || Package;

              return (
                <Card 
                  key={plan.tier} 
                  className={isCurrent ? "border-primary" : ""}
                  data-testid={`card-plan-${plan.tier}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                    </div>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-bold">
                      ${plan.price}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {plan.features.slice(0, 4).map((feature) => (
                        <li key={feature} className="flex items-center gap-2">
                          <Check className="h-3 w-3 text-green-500" />
                          <span>{feature.replace(/_/g, ' ')}</span>
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
                        variant={plan.price > (entitlements.planInfo?.price || 0) ? "default" : "outline"}
                        disabled={!isAdmin || changePlanMutation.isPending || !entitlements.isDevMode}
                        onClick={() => changePlanMutation.mutate(plan.tier)}
                        data-testid={`button-select-${plan.tier}`}
                      >
                        {changePlanMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : plan.price > (entitlements.planInfo?.price || 0) ? (
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

        {/* Add-ons Tab */}
        <TabsContent value="addons" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {plansData?.addons.map((addon) => {
              const isActive = entitlements.activeAddons.includes(addon.key);

              return (
                <Card 
                  key={addon.key}
                  data-testid={`card-addon-${addon.key}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{addon.name}</CardTitle>
                      <Badge variant={isActive ? "default" : "secondary"}>
                        {isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <CardDescription>{addon.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <div className="text-xl font-bold">
                      +${addon.price}
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

          {isAdmin && !entitlements.isDevMode && (
            <Card className="bg-muted/50">
              <CardContent className="py-4 text-center text-muted-foreground">
                Add-on changes are managed through Stripe in production mode.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Usage Tab */}
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
