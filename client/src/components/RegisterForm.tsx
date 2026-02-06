import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
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
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={isSubmitting}
              data-testid="input-password"
            />
            <p className="text-xs text-muted-foreground" data-testid="text-password-hint">Must be at least 8 characters</p>
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
