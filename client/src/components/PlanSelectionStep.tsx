/**
 * Plan Selection Step for Onboarding
 * Allows users to choose their subscription tier during the onboarding process
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  Check, 
  Crown,
  Sparkles,
  Package,
  TrendingUp,
  BarChart3,
  Zap,
  ArrowLeft,
  ArrowRight,
  Loader2
} from "lucide-react";
import { 
  PlanTier, 
  AddOnKey, 
  PLAN_INFO, 
  PLAN_DEFAULT_FEATURES, 
  ADDON_INFO,
  FEATURE_INFO
} from "@shared/billing/plans";

interface PlanSelectionStepProps {
  onComplete: (planTier: PlanTier, addons: AddOnKey[]) => void;
  onBack: () => void;
  isSubmitting: boolean;
  recommendedPlan?: PlanTier;
  crewSize?: number | null;
}

const PLAN_ICONS: Record<PlanTier, React.ElementType> = {
  free: Package,
  starter: TrendingUp,
  professional: BarChart3,
  enterprise: Zap,
};

const PLANS_ORDER: PlanTier[] = ["free", "starter", "professional", "enterprise"];
const ADDONS_ORDER: AddOnKey[] = ["ai_pm", "ai_cfo", "ai_email", "website_seo", "bid_network", "ai_vision"];

export function PlanSelectionStep({ 
  onComplete, 
  onBack, 
  isSubmitting,
  recommendedPlan,
  crewSize
}: PlanSelectionStepProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>(recommendedPlan || "free");
  const [selectedAddons, setSelectedAddons] = useState<AddOnKey[]>([]);

  const toggleAddon = (addon: AddOnKey) => {
    setSelectedAddons(prev => 
      prev.includes(addon) 
        ? prev.filter(a => a !== addon)
        : [...prev, addon]
    );
  };

  const calculateTotal = () => {
    const planPrice = PLAN_INFO[selectedPlan].price;
    const addonsPrice = selectedAddons.reduce((sum, addon) => sum + ADDON_INFO[addon].price, 0);
    return planPrice + addonsPrice;
  };

  const handleContinue = () => {
    onComplete(selectedPlan, selectedAddons);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="p-3 rounded-full bg-primary/10">
            <Crown className="h-8 w-8 text-primary" />
          </div>
        </div>
        <h2 className="text-2xl font-bold">Choose Your Plan</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Start free and upgrade anytime as your business grows. 
          All plans include core project management features.
        </p>
      </div>

      {/* Plan Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS_ORDER.map((tier) => {
          const plan = PLAN_INFO[tier];
          const Icon = PLAN_ICONS[tier];
          const isSelected = selectedPlan === tier;
          const isRecommended = tier === recommendedPlan;
          const features = PLAN_DEFAULT_FEATURES[tier];

          return (
            <Card 
              key={tier}
              className={`cursor-pointer transition-all relative ${
                isSelected ? "border-primary ring-2 ring-primary/20" : "hover-elevate"
              }`}
              onClick={() => setSelectedPlan(tier)}
              data-testid={`card-select-plan-${tier}`}
            >
              {isRecommended && (
                <Badge 
                  className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary"
                  data-testid="badge-recommended"
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  Recommended
                </Badge>
              )}
              <CardHeader className="pb-3 pt-6">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                </div>
                <CardDescription className="text-xs">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-3xl font-bold">
                  ${plan.price}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                <ul className="space-y-1 text-sm min-h-[80px]">
                  {features.length > 0 ? (
                    features.slice(0, 3).map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-green-500 shrink-0" />
                        <span className="text-xs">{FEATURE_INFO[feature]?.name || feature}</span>
                      </li>
                    ))
                  ) : (
                    <li className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-green-500 shrink-0" />
                      <span className="text-xs">Core features included</span>
                    </li>
                  )}
                  {features.length > 3 && (
                    <li className="text-xs text-muted-foreground">
                      +{features.length - 3} more features
                    </li>
                  )}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  variant={isSelected ? "default" : "outline"} 
                  className="w-full"
                  size="sm"
                >
                  {isSelected ? "Selected" : "Select"}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Add-ons Section */}
      <div className="space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-semibold">Enhance with Add-ons</h3>
          <p className="text-sm text-muted-foreground">
            Power up your platform with AI and specialized tools
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ADDONS_ORDER.map((addonKey) => {
            const addon = ADDON_INFO[addonKey];
            const isActive = selectedAddons.includes(addonKey);

            return (
              <Card 
                key={addonKey}
                className={`cursor-pointer transition-all ${
                  isActive ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => toggleAddon(addonKey)}
                data-testid={`card-addon-toggle-${addonKey}`}
              >
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{addon.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{addon.description}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-semibold text-sm">+${addon.price}</span>
                    <Switch 
                      checked={isActive}
                      onCheckedChange={() => toggleAddon(addonKey)}
                      data-testid={`switch-addon-${addonKey}`}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Summary and Actions */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Monthly Total</p>
              <p className="text-3xl font-bold">
                ${calculateTotal()}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              {selectedAddons.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {PLAN_INFO[selectedPlan].name} plan + {selectedAddons.length} add-on{selectedAddons.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={onBack}
                disabled={isSubmitting}
                data-testid="button-back-from-plan"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button 
                onClick={handleContinue}
                disabled={isSubmitting}
                data-testid="button-continue-with-plan"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                {selectedPlan === "free" ? "Continue with Free" : "Continue"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        You can change your plan anytime from Settings. No credit card required for Free plan.
      </p>
    </div>
  );
}

/**
 * Get recommended plan based on organization profile
 */
export function getRecommendedPlan(crewSize?: number | null): PlanTier {
  if (!crewSize) return "free";
  
  if (crewSize >= 25) return "enterprise";
  if (crewSize >= 10) return "professional";
  if (crewSize >= 5) return "starter";
  return "free";
}
