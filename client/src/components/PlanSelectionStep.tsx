/**
 * Plan Selection Step for Onboarding
 * Allows users to choose their subscription tier during the onboarding process
 * 
 * Updated Pricing (December 2025):
 * - Starter ($89): Under $500k revenue
 * - Growth ($229): $500k-$2M revenue  
 * - Scale ($579): $2M-$10M revenue
 * - Hustler ($1199): Multi-company owners (separate option)
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
  Rocket,
  TrendingUp,
  BarChart3,
  Building2,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Bot,
  Mail,
  Globe,
  Network
} from "lucide-react";
import { 
  PlanTier, 
  AddOnKey, 
  PLAN_INFO, 
  ADDON_INFO,
} from "@shared/billing/plans";

interface PlanSelectionStepProps {
  onComplete: (planTier: PlanTier, addons: AddOnKey[]) => void;
  onBack: () => void;
  isSubmitting: boolean;
  recommendedPlan?: PlanTier;
  crewSize?: number | null;
}

const PLAN_ICONS: Record<PlanTier, React.ElementType> = {
  free: Rocket,
  starter: TrendingUp,
  professional: BarChart3,
  enterprise: Building2,
};

// Only show paid plans in the selection (no free trial in main flow)
const PLANS_ORDER: PlanTier[] = ["starter", "professional", "enterprise"];

// Group add-ons by category
const AI_ADDONS: AddOnKey[] = ["ai_pm", "ai_cfo", "ai_email"];
const GROWTH_ADDONS: AddOnKey[] = ["website_seo", "bid_network"];

// Icon mapping for add-ons
const ADDON_ICONS: Record<AddOnKey, React.ElementType> = {
  ai_pm: Bot,
  ai_cfo: BarChart3,
  ai_email: Mail,
  website_seo: Globe,
  bid_network: Network,
  ai_vision: Sparkles,
  integration_qbo: BarChart3,
  integration_esign: Mail,
  ai_governance_pack: Sparkles,
};

export function PlanSelectionStep({ 
  onComplete, 
  onBack, 
  isSubmitting,
  recommendedPlan,
  crewSize
}: PlanSelectionStepProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>(recommendedPlan || "starter");
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

  const handleContinueFree = () => {
    onComplete("free", []);
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
          No per-user fees. Select the plan that matches your business size.
        </p>
      </div>

      {/* Plan Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS_ORDER.map((tier) => {
          const plan = PLAN_INFO[tier];
          const Icon = PLAN_ICONS[tier];
          const isSelected = selectedPlan === tier;
          const isRecommended = tier === recommendedPlan;

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
                  <CardTitle className="text-lg">{plan.displayName}</CardTitle>
                </div>
                <Badge variant="outline" className="w-fit text-xs">
                  {plan.revenueRange}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-3xl font-bold">
                  ${plan.price}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                <p className="text-xs text-muted-foreground">{plan.bestFor}</p>
                <ul className="space-y-1.5 text-sm">
                  {plan.features.slice(0, 5).map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                      <span className="text-xs">{feature}</span>
                    </li>
                  ))}
                  {plan.features.length > 5 && (
                    <li className="text-xs text-muted-foreground pl-5">
                      +{plan.features.length - 5} more
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
          <h3 className="text-lg font-semibold">Add-On Feature Packs</h3>
          <p className="text-sm text-muted-foreground">
            Available on any plan - power up with AI and growth tools
          </p>
        </div>

        {/* AI & Automation Add-ons */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            AI & Automation
          </h4>
          <div className="grid gap-3 md:grid-cols-3">
            {AI_ADDONS.map((addonKey) => {
              const addon = ADDON_INFO[addonKey];
              const isActive = selectedAddons.includes(addonKey);
              const AddonIcon = ADDON_ICONS[addonKey];

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
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <AddonIcon className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{addon.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{addon.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-semibold text-sm">${addon.price}</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch 
                          checked={isActive}
                          onCheckedChange={() => toggleAddon(addonKey)}
                          data-testid={`switch-addon-${addonKey}`}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Business Growth Add-ons */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Business Growth
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            {GROWTH_ADDONS.map((addonKey) => {
              const addon = ADDON_INFO[addonKey];
              const isActive = selectedAddons.includes(addonKey);
              const AddonIcon = ADDON_ICONS[addonKey];

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
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <AddonIcon className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{addon.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{addon.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-semibold text-sm">${addon.price}</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch 
                          checked={isActive}
                          onCheckedChange={() => toggleAddon(addonKey)}
                          data-testid={`switch-addon-${addonKey}`}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
                  {PLAN_INFO[selectedPlan].displayName} + {selectedAddons.length} add-on{selectedAddons.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="flex gap-3 flex-wrap">
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
                variant="ghost"
                onClick={handleContinueFree}
                disabled={isSubmitting}
                data-testid="button-continue-free"
              >
                Continue Free Trial
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
                Continue with {PLAN_INFO[selectedPlan].displayName}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Start with a free trial, no credit card required. You can upgrade anytime from Settings.
      </p>
    </div>
  );
}

/**
 * Get recommended plan based on organization profile
 */
export function getRecommendedPlan(crewSize?: number | null): PlanTier {
  if (!crewSize) return "starter";
  
  if (crewSize >= 25) return "enterprise"; // Scale
  if (crewSize >= 10) return "professional"; // Growth
  return "starter";
}
