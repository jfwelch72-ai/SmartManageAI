import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Fingerprint, Loader2, Check, X } from "lucide-react";
import { SiGoogle, SiApple } from "react-icons/si";
import { startAuthentication } from "@simplewebauthn/browser";
import { useToast } from "@/hooks/use-toast";
import { getPasswordChecks, isPasswordValid } from "@shared/utils/passwordPolicy";

interface RegisterFormProps {
  onRegister: (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  }) => Promise<void>;
}

export default function RegisterForm({ onRegister }: RegisterFormProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const { toast } = useToast();

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!isPasswordValid(password)) {
      setError("Password does not meet all requirements");
      return;
    }

    setIsSubmitting(true);
    try {
      await onRegister({
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        password,
      });
    } catch (err: any) {
      const message = parseErrorMessage(err.message);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl font-bold" data-testid="text-register-title">Join SmartManageAI</CardTitle>
        <CardDescription className="text-base" data-testid="text-register-description">
          Great to have you here! Let's set up your account in just a few steps.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = "/api/auth/google"; }}
            disabled={isSubmitting}
            data-testid="button-register-google"
          >
            <SiGoogle className="w-4 h-4 mr-2" />
            Continue with Google
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = "/api/auth/apple"; }}
            disabled={isSubmitting}
            data-testid="button-register-apple"
          >
            <SiApple className="w-4 h-4 mr-2" />
            Continue with Apple
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={handlePasskeyLogin}
            disabled={passkeyLoading || isSubmitting}
            data-testid="button-register-passkey"
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
            <span className="bg-card px-2 text-muted-foreground">or register with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                type="text"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                disabled={isSubmitting}
                data-testid="input-firstName"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                type="text"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                disabled={isSubmitting}
                data-testid="input-lastName"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Company Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isSubmitting}
              data-testid="input-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone (Optional)</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isSubmitting}
              data-testid="input-phone"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting}
              data-testid="input-password"
            />
            {password.length > 0 && (
              <ul className="space-y-1 mt-1" data-testid="password-requirements">
                {getPasswordChecks(password).map((check, i) => (
                  <li key={i} className={`flex items-center gap-1.5 text-xs ${check.met ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                    {check.met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {check.label}
                  </li>
                ))}
              </ul>
            )}
            {password.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="text-password-hint">Must include uppercase, lowercase, number, and special character</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isSubmitting}
              data-testid="input-confirmPassword"
            />
          </div>
          {error && (
            <div className="text-sm text-destructive" data-testid="text-error">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-register">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account...
              </>
            ) : (
              "Create Account"
            )}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline" data-testid="link-login">
              Sign in
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function parseErrorMessage(raw: string): string {
  if (!raw) return "Registration failed. Please try again.";

  if (raw.includes("Too many")) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }

  if (raw.includes("already exists")) {
    return "An account with this email already exists. Try signing in instead.";
  }

  try {
    const jsonMatch = raw.match(/\d+:\s*(.*)/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.error) return parsed.error;
      if (parsed.details && Array.isArray(parsed.details)) {
        const messages = parsed.details.map((d: any) => d.message).filter(Boolean);
        if (messages.length > 0) return messages.join(". ");
      }
    }
  } catch {
    // Fall through
  }

  if (raw.includes("Invalid input")) return "Please check your information and try again.";
  if (raw.includes("500")) return "Something went wrong on our end. Please try again in a moment.";
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError")) return "Connection issue. Please check your internet and try again.";

  return "Registration failed. Please try again.";
}
