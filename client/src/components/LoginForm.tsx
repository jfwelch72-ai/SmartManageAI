import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { SiGoogle, SiApple } from "react-icons/si";
import { BsMicrosoft } from "react-icons/bs";
import { Fingerprint, Loader2 } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { useToast } from "@/hooks/use-toast";

interface LoginFormProps {
  onLogin: (email: string, password: string) => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email, password);
  };

  const handlePasskeyLogin = async () => {
    if (!window.PublicKeyCredential) {
      toast({
        title: "Passkeys not supported",
        description: "Your browser does not support passkeys. Please use a different sign-in method.",
        variant: "destructive",
      });
      return;
    }

    setPasskeyLoading(true);
    try {
      const optionsRes = await fetch("/api/auth/passkey/auth-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!optionsRes.ok) {
        const errData = await optionsRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start passkey authentication");
      }
      const optionsData = await optionsRes.json();
      const { sessionId, ...options } = optionsData;

      const authResponse = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/passkey/auth-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResponse, sessionId }),
      });
      const verifyData = await verifyRes.json();

      if (verifyRes.ok && verifyData.verified) {
        window.location.href = verifyData.redirectTo || "/dashboard";
      } else {
        toast({
          title: "Passkey Login Failed",
          description: verifyData.error || "Authentication failed. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      if (error.name === "NotAllowedError") {
        toast({
          title: "Passkey Login Cancelled",
          description: "The passkey request was cancelled or no passkey is available for this site. Please register a passkey from your profile first.",
          variant: "destructive",
        });
        return;
      }
      const message = error?.message || "Passkey authentication failed. Please try again.";
      toast({
        title: "Passkey Login Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl font-bold">Welcome to SmartManageAI</CardTitle>
        <CardDescription className="text-base">
          Let's get you started! Sign in to access your construction management platform.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = "/api/auth/google"; }}
            data-testid="button-login-google"
          >
            <SiGoogle className="w-4 h-4 mr-2" />
            Continue with Google
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = "/api/auth/apple"; }}
            data-testid="button-login-apple"
          >
            <SiApple className="w-4 h-4 mr-2" />
            Continue with Apple
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = "/api/auth/microsoft"; }}
            data-testid="button-login-microsoft"
          >
            <BsMicrosoft className="w-4 h-4 mr-2" />
            Continue with Microsoft
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={handlePasskeyLogin}
            disabled={passkeyLoading}
            data-testid="button-login-passkey"
          >
            {passkeyLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Fingerprint className="w-4 h-4 mr-2" />
            )}
            Continue with Passkey
          </Button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              data-testid="input-email"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-sm text-primary hover:underline" data-testid="link-forgot-password">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              data-testid="input-password"
            />
          </div>
          <Button type="submit" className="w-full" data-testid="button-login">
            Sign In
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/register" className="text-primary hover:underline" data-testid="link-register">
              Register
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
