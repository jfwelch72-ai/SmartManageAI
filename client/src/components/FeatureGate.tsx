/**
 * Feature Gate Component
 * Conditionally renders content based on feature access
 */

import { useEntitlements } from "@/hooks/useEntitlements";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles } from "lucide-react";
import { Link } from "wouter";
import type { FeatureKey } from "@shared/billing/plans";
import { FEATURE_INFO } from "@shared/billing/plans";

interface FeatureGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showUpgrade?: boolean;
}

/**
 * Renders children only if user has access to the feature
 * Otherwise shows a locked state with upgrade CTA
 */
export function FeatureGate({ 
  feature, 
  children, 
  fallback,
  showUpgrade = true 
}: FeatureGateProps) {
  const { can, isLoading, error } = useEntitlements();

  if (isLoading) {
    return null; // Or a loading skeleton
  }

  if (error) {
    // On error, allow access (fail open in dev, fail closed in prod would be safer)
    console.error("Failed to load entitlements:", error);
    return <>{children}</>;
  }

  if (can(feature)) {
    return <>{children}</>;
  }

  // Feature not available
  if (fallback) {
    return <>{fallback}</>;
  }

  if (!showUpgrade) {
    return null;
  }

  const featureInfo = FEATURE_INFO[feature];

  return (
    <LockedFeatureCard 
      featureName={featureInfo?.name || feature}
      featureDescription={featureInfo?.description}
    />
  );
}

interface LockedFeatureCardProps {
  featureName: string;
  featureDescription?: string;
}

/**
 * Card displayed when a feature is locked
 */
export function LockedFeatureCard({ 
  featureName, 
  featureDescription 
}: LockedFeatureCardProps) {
  return (
    <Card className="border-dashed border-2 bg-muted/30">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-2 p-3 rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-lg">{featureName}</CardTitle>
        {featureDescription && (
          <CardDescription>{featureDescription}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="text-center pb-6">
        <p className="text-sm text-muted-foreground mb-4">
          This feature is not included in your current plan.
        </p>
        <Link href="/billing">
          <Button data-testid="button-upgrade-plan">
            <Sparkles className="h-4 w-4 mr-2" />
            Upgrade Plan
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Hook for programmatic feature checking
 * Returns whether the user can access a feature
 */
export function useFeatureAccess(feature: FeatureKey): {
  hasAccess: boolean;
  isLoading: boolean;
} {
  const { can, isLoading } = useEntitlements();
  
  return {
    hasAccess: can(feature),
    isLoading,
  };
}

/**
 * HOC to wrap a component with feature gating
 */
export function withFeatureGate<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  feature: FeatureKey
) {
  return function FeatureGatedComponent(props: P) {
    return (
      <FeatureGate feature={feature}>
        <WrappedComponent {...props} />
      </FeatureGate>
    );
  };
}
