import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Shield, Mail, AlertCircle, Lock } from "lucide-react";

interface PortalLoginFormProps {
  email: string;
  setEmail: (email: string) => void;
  verifying: boolean;
  verifyError: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export function PortalLoginForm({ email, setEmail, verifying, verifyError, onSubmit }: PortalLoginFormProps) {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Client Portal</CardTitle>
          <CardDescription>
            Enter your email address to access project information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="portal-email">Email Address</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="portal-email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-portal-email"
                />
              </div>
            </div>

            {verifyError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{verifyError}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={verifying || !email.trim()}
              data-testid="button-portal-verify"
            >
              {verifying ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Lock className="w-4 h-4 mr-2" />
              )}
              Access Portal
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-4">
            You must have been invited by your project team to access this portal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
