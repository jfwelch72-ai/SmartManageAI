import LoginForm from "@/components/LoginForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { isSuperAdmin } from "@/lib/rbac";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FlaskConical, Shield, Users, HardHat, Calculator, Building2, Clock, Wrench, Truck, Zap, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DEV_ROLES = [
  { role: "SUPER_ADMIN", label: "Super Admin", icon: Shield, description: "Platform-wide access" },
  { role: "ADMIN", label: "Admin", icon: Users, description: "Organization admin" },
  { role: "MANAGER", label: "Manager", icon: Building2, description: "Project management" },
  { role: "SUPERINTENDENT", label: "Superintendent", icon: HardHat, description: "Field operations" },
  { role: "ESTIMATOR", label: "Estimator", icon: Calculator, description: "Cost estimation" },
  { role: "OFFICE_MANAGER", label: "Office Manager", icon: Building2, description: "Office operations" },
  { role: "HOURLY_EMPLOYEE", label: "Field Worker", icon: Clock, description: "Time tracking" },
  { role: "MAINTENANCE_MANAGER", label: "Maintenance", icon: Wrench, description: "Equipment management" },
  { role: "VENDOR", label: "Vendor", icon: Truck, description: "Supplier access" },
  { role: "HUSTLER", label: "Hustler", icon: Zap, description: "Multi-org access" },
];

export default function LoginPage() {
  const [location, setLocation] = useLocation();
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [loadingFreshAdmin, setLoadingFreshAdmin] = useState(false);
  const isDev = import.meta.env.DEV;

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
        setLocation(getRedirectPath(loggedInUser || {}));
      }
    } catch (error: any) {
      throw new Error(error.message || "Login failed");
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-6">
      <LoginForm onLogin={handleLogin} />
      
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
    </div>
  );
}
