import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, Lock, ArrowRight } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";

type AcceptState = "loading" | "password-setup" | "success" | "error";

export default function AcceptHustlerInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [state, setState] = useState<AcceptState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [orgName, setOrgName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/hustler/link-requests/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to accept invite");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setOrgName(data.organization?.name || "the organization");
      if (data.requiresPasswordSetup) {
        setState("password-setup");
      } else {
        setState("success");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        toast({ title: `Welcome back! You've joined ${data.organization?.name}` });
        setTimeout(() => setLocation("/hustler"), 2000);
      }
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setState("error");
    },
  });

  const setPasswordMutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const res = await apiRequest("POST", "/api/auth/set-initial-password", { password: newPassword });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Password set successfully!", description: "Welcome to SmartManageAI" });
      setState("success");
      setTimeout(() => setLocation("/hustler"), 2000);
    },
    onError: () => {
      toast({ title: "Failed to set password", description: "Please try again", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (token) {
      acceptMutation.mutate();
    } else {
      setErrorMessage("No invite token found");
      setState("error");
    }
  }, []);

  const handleSetPassword = () => {
    setPasswordError("");
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordMutation.mutate(password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        {state === "loading" && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Accepting Invitation</CardTitle>
              <CardDescription>Please wait while we set up your account...</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary" data-testid="loading-spinner" />
            </CardContent>
          </>
        )}

        {state === "password-setup" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
                <Lock className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Set Your Password</CardTitle>
              <CardDescription>
                You've joined <strong>{orgName}</strong>. Set a password to secure your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
                  data-testid="input-confirm-password"
                />
              </div>
              {passwordError && (
                <p className="text-sm text-destructive" data-testid="text-password-error">{passwordError}</p>
              )}
              <Button
                onClick={handleSetPassword}
                disabled={setPasswordMutation.isPending}
                className="w-full"
                data-testid="button-set-password"
              >
                {setPasswordMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Set Password & Continue
              </Button>
            </CardContent>
          </>
        )}

        {state === "success" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 bg-green-500/10 rounded-full w-fit">
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
              <CardTitle className="text-2xl">You're All Set!</CardTitle>
              <CardDescription>
                You've successfully joined <strong>{orgName}</strong>. Redirecting to your dashboard...
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </>
        )}

        {state === "error" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 bg-destructive/10 rounded-full w-fit">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle className="text-2xl">Invitation Error</CardTitle>
              <CardDescription>{errorMessage}</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => setLocation("/login")} variant="outline" data-testid="button-go-to-login">
                Go to Login
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
