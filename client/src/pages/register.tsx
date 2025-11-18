import RegisterForm from "@/components/RegisterForm";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function RegisterPage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [registrationComplete, setRegistrationComplete] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      setLocation('/dashboard');
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
        title: "Registration Successful",
        description: response.message || "Your account is pending admin approval. You will be notified when your account is activated.",
      });

      // Redirect to login after 3 seconds
      setTimeout(() => {
        setLocation('/login');
      }, 3000);
    } catch (error: any) {
      throw new Error(error.message || "Registration failed");
    }
  };

  if (registrationComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold">Registration Complete!</h2>
          <p className="text-muted-foreground">
            Your account is pending admin approval. You will be able to log in once an administrator activates your account.
          </p>
          <p className="text-sm text-muted-foreground">
            Redirecting to login...
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
