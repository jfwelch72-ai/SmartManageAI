import LoginForm from "@/components/LoginForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { isSuperAdmin } from "@/lib/rbac";

export default function LoginPage() {
  const [location, setLocation] = useLocation();
  const { user, login } = useAuth();

  // Helper to determine where to redirect user after login
  const getRedirectPath = (user: { organizationId?: string | null; role?: string }) => {
    // Super admins go to admin dashboard
    if (isSuperAdmin(user.role)) {
      return '/admin';
    }
    // Users without an organization need onboarding
    if (!user.organizationId) {
      return '/onboarding';
    }
    // Regular users with organization go to dashboard
    return '/dashboard';
  };

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      // Only use redirect param if user has an organization (is fully set up)
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
      // Only use redirect param if user has an organization (is fully set up)
      if (redirect && loggedInUser?.organizationId) {
        setLocation(redirect);
      } else {
        setLocation(getRedirectPath(loggedInUser || {}));
      }
    } catch (error: any) {
      throw new Error(error.message || "Login failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <LoginForm onLogin={handleLogin} />
    </div>
  );
}
