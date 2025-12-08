import RegisterForm from "@/components/RegisterForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FlaskConical, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isSuperAdmin } from "@/lib/rbac";

export default function RegisterPage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [registrationComplete, setRegistrationComplete] = useState(false);

  // Check if SUPER_ADMIN is viewing for troubleshooting
  const isDevPreview = user && isSuperAdmin(user.role);

  // Redirect if already logged in (except SUPER_ADMIN for troubleshooting)
  useEffect(() => {
    if (user && !isSuperAdmin(user.role)) {
      // If user has no organization, redirect to onboarding
      if (!user.organizationId) {
        setLocation('/onboarding');
      } else {
        setLocation('/dashboard');
      }
    }
  }, [user, setLocation]);

  const handleRegister = async (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  }) => {
    try {
      const res = await apiRequest("POST", "/api/auth/register", data);
      const response = await res.json();

      setRegistrationComplete(true);
      
      toast({
        title: "Welcome!",
        description: response.message || "Let's set up your business.",
      });

      // Invalidate auth queries to refresh user state with the new session
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

      // Redirect to onboarding immediately
      setLocation('/onboarding');
    } catch (error: any) {
      throw new Error(error.message || "Registration failed");
    }
  };

  if (registrationComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <h2 className="text-2xl font-bold">Welcome!</h2>
          <p className="text-muted-foreground">
            Setting up your account...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-4">
      {isDevPreview && (
        <div className="w-full max-w-md p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-orange-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
              Dev Preview Mode
            </p>
            <p className="text-xs text-muted-foreground">
              You're viewing as Super Admin for troubleshooting
            </p>
          </div>
          <Badge variant="outline" className="text-orange-500 border-orange-500 shrink-0">
            DEV
          </Badge>
        </div>
      )}
      <RegisterForm onRegister={handleRegister} />
    </div>
  );
}
