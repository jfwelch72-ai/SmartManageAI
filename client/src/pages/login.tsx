import LoginForm from "@/components/LoginForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { isSuperAdmin } from "@/lib/rbac";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FlaskConical, Shield, Users, HardHat, Calculator, Building2, Clock, Truck, Zap, Sparkles, Compass } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DEV_ROLES = [
  { role: "SUPER_ADMIN", label: "Super Admin", icon: Shield, description: "Platform-wide access" },
  { role: "ADMIN", label: "Admin", icon: Users, description: "Organization admin" },
  { role: "HUSTLER", label: "Hustler", icon: Zap, description: "Multi-org access" },
  { role: "MANAGER", label: "Manager", icon: Building2, description: "Project management" },
  { role: "SUPERINTENDENT", label: "Superintendent", icon: HardHat, description: "Field operations" },
  { role: "ESTIMATOR", label: "Estimator", icon: Calculator, description: "Cost estimation" },
  { role: "FIELD_WORKER", label: "Field Worker", icon: Clock, description: "Time tracking" },
  { role: "VENDOR", label: "Vendor", icon: Truck, description: "Supplier access" },
];

export default function LoginPage() {
  const [location, setLocation] = useLocation();
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [loadingFreshAdmin, setLoadingFreshAdmin] = useState(false);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (oauthError) {
      const messages: Record<string, string> = {
        google_failed: "Google sign-in failed. Please try again.",
        google_not_configured: "Google sign-in is not configured yet.",
        google_no_email: "Could not retrieve your email from Google.",
        apple_failed: "Apple sign-in failed. Please try again.",
        apple_not_configured: "Apple sign-in is not configured yet.",
        apple_no_email:
          "Apple did not share an email with us. Please try again and choose to share your email, or sign in with another method.",
        apple_state_mismatch:
          "Your Apple sign-in session expired or was blocked by your browser. Please try again.",
        apple_token_exchange_failed:
          "We couldn't complete sign-in with Apple. This usually means the Apple Sign-In configuration is incorrect.",
        apple_token_invalid:
          "We couldn't verify the response from Apple. Please try again, or sign in with another method.",
        microsoft_failed: "Microsoft sign-in failed. Please try again.",
        microsoft_not_configured: "Microsoft sign-in is not configured yet.",
        microsoft_no_email: "Could not retrieve your email from Microsoft.",
        org_suspended: "Your organization has been suspended. Please contact support.",
      };
      toast({
        title: "Sign-in Error",
        description: messages[oauthError] || "Social sign-in failed. Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/login");
    }
  }, [toast]);

  // Helper to determine where to redirect user after login
  const getRedirectPath = (userData: { organizationId?: string | null; role?: string }) => {
    if (isSuperAdmin(userData.role)) {
      return '/admin';
    }
    // HUSTLER users go to portfolio dashboard
    if (userData.role === 'HUSTLER') {
      return '/hustler';
    }
    if (!userData.organizationId) {
      return '/onboarding';
    }
    return '/dashboard';
  };

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      if (redirect && user.organizationId) {
        setLocation(redirect);
      } else {
        setLocation(getRedirectPath(user));
      }
    }
  }, [user, setLocation]);

  const handleLogin = async (email: string, password: string) => {
    try {
      const loggedInUser = await login(email, password);
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      if (redirect && loggedInUser?.organizationId) {
        setLocation(redirect);
      } else {
        const defaultPath = getRedirectPath(loggedInUser || {});
        if (loggedInUser?.organizationId) {
          try {
            const settingsRes = await fetch('/api/user-settings', { credentials: 'include' });
            if (settingsRes.ok) {
              const settings = await settingsRes.json();
              if (settings.defaultLandingPage) {
                setLocation(settings.defaultLandingPage);
                return;
              }
            }
          } catch (err) { console.warn("[Login] Failed to fetch company settings:", err); }
        }
        setLocation(defaultPath);
      }
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    }
  };

  const handleDevLogin = async (role: string) => {
    setLoadingRole(role);
    try {
      const res = await apiRequest("POST", "/api/dev/test-login", { role });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to create test account");
      }
      
      if (data.user) {
        toast({
          title: "Dev Login Successful",
          description: `Logged in as ${role}`,
        });
        // Force page reload to refresh auth state from the cookie set by the backend
        window.location.href = getRedirectPath(data.user);
      }
    } catch (error: any) {
      toast({
        title: "Dev Login Failed",
        description: error.message || "Could not create test account",
        variant: "destructive",
      });
    } finally {
      setLoadingRole(null);
    }
  };

  const handleFreshAdminLogin = async () => {
    setLoadingFreshAdmin(true);
    try {
      const res = await apiRequest("POST", "/api/dev/fresh-admin-login", {});
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to create fresh admin account");
      }
      
      if (data.user) {
        toast({
          title: "Fresh Admin Created",
          description: "Starting full onboarding experience...",
        });
        // Redirect to onboarding for full setup wizard experience
        window.location.href = data.redirectTo || "/onboarding";
      }
    } catch (error: any) {
      toast({
        title: "Fresh Admin Creation Failed",
        description: error.message || "Could not create fresh admin account",
        variant: "destructive",
      });
    } finally {
      setLoadingFreshAdmin(false);
    }
  };

  const [ssoSlug, setSsoSlug] = useState("");
  const [showSso, setShowSso] = useState(false);

  const handleSsoLogin = () => {
    if (ssoSlug.trim()) {
      window.location.href = `/api/sso/${encodeURIComponent(ssoSlug.trim())}/login`;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-6">
      <LoginForm onLogin={handleLogin} />
      
      <div className="w-full max-w-md text-center">
        {!showSso ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSso(true)}
            className="text-muted-foreground"
            data-testid="button-show-sso"
          >
            <Shield className="w-4 h-4 mr-2" />
            Sign in with SSO
          </Button>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Single Sign-On
              </CardTitle>
              <CardDescription>Enter your organization's identifier to sign in via SSO</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <input
                type="text"
                value={ssoSlug}
                onChange={(e) => setSsoSlug(e.target.value)}
                placeholder="Organization slug"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="input-sso-slug"
                onKeyDown={(e) => e.key === "Enter" && handleSsoLogin()}
              />
              <Button onClick={handleSsoLogin} disabled={!ssoSlug.trim()} data-testid="button-sso-login" size="sm">
                Continue
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {isDev && (
        <Card className="w-full max-w-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-lg">Dev Quick Login</CardTitle>
              <Badge variant="outline" className="ml-auto text-orange-500 border-orange-500">
                DEV ONLY
              </Badge>
            </div>
            <CardDescription>
              Click any role to instantly login with a test account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {DEV_ROLES.map(({ role, label, icon: Icon, description }) => (
                <Button
                  key={role}
                  variant="outline"
                  size="sm"
                  className="h-auto py-2 px-3 flex flex-col items-start gap-0.5"
                  onClick={() => handleDevLogin(role)}
                  disabled={loadingRole !== null || loadingFreshAdmin}
                  data-testid={`button-dev-login-${role.toLowerCase()}`}
                >
                  <div className="flex items-center gap-2 w-full">
                    {loadingRole === role ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                    <span className="font-medium text-sm">{label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground pl-6">{description}</span>
                </Button>
              ))}
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <Button
                variant="default"
                className="w-full h-auto py-3 flex flex-col items-center gap-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                onClick={handleFreshAdminLogin}
                disabled={loadingRole !== null || loadingFreshAdmin}
                data-testid="button-dev-fresh-admin"
              >
                <div className="flex items-center gap-2">
                  {loadingFreshAdmin ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                  <span className="font-semibold">Fresh Admin (Full Onboarding)</span>
                </div>
                <span className="text-xs opacity-90">
                  New org + Setup Wizard + Feature Tour + Walkthrough
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isDev && (
        <Button
          variant="outline"
          className="w-full max-w-md gap-2 text-muted-foreground"
          onClick={() => setLocation("/")}
          data-testid="button-view-landing-page"
        >
          <Compass className="h-4 w-4" />
          Preview Landing Page (Public View)
        </Button>
      )}
    </div>
  );
}
