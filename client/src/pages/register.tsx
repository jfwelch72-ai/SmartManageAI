import RegisterForm from "@/components/RegisterForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function RegisterPage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [registrationComplete, setRegistrationComplete] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <RegisterForm onRegister={handleRegister} />
    </div>
  );
}
