import LoginForm from "@/components/LoginForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";

export default function LoginPage() {
  const [location, setLocation] = useLocation();
  const { user, login } = useAuth();

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/dashboard';
      setLocation(redirect);
    }
  }, [user, setLocation]);

  const handleLogin = async (email: string, password: string) => {
    try {
      await login(email, password);
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/dashboard';
      setLocation(redirect);
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
