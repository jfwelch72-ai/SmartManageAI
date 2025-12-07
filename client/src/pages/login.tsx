import LoginForm from "@/components/LoginForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { isSuperAdmin } from "@/lib/rbac";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FlaskConical, Shield, Users, HardHat, Calculator, Building2, Clock, Wrench, Truck, Zap } from "lucide-react";
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
  const isDev = import.meta.env.DEV;

  // Helper to determine where to redirect user after login
  const getRedirectPath = (userData: { organizationId?: string | null; role?: string }) => {
    if (isSuperAdmin(userData.role)) {
      return '/admin';
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
                  disabled={loadingRole !== null}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
