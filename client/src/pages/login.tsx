import LoginForm from "@/components/LoginForm";
import { useLocation } from "wouter";

export default function LoginPage() {
  const [, setLocation] = useLocation();

  const handleLogin = (email: string, password: string) => {
    console.log('Login attempt:', { email, password });
    // TODO: Implement actual authentication
    // For prototype, simulate successful login
    setLocation('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <LoginForm onLogin={handleLogin} />
    </div>
  );
}
