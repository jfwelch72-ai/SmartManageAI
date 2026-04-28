import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Fingerprint, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";

interface PasskeyCredentialView {
  id: string;
  deviceName: string | null;
  rpId: string | null;
  createdAt: string;
  isCurrentDomain: boolean;
}

interface PasskeyListResponse {
  credentials: PasskeyCredentialView[];
  currentRpId: string | null;
}

export default function PasskeySection() {
  const { toast } = useToast();
  const [registerLoading, setRegisterLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading: loadingPasskeys } = useQuery<PasskeyListResponse>({
    queryKey: ["/api/auth/passkey/credentials"],
  });

  const passkeys = data?.credentials ?? [];
  const currentRpId = data?.currentRpId ?? null;

  const handleRegisterPasskey = async () => {
    if (!window.PublicKeyCredential) {
      toast({ title: "Passkeys not supported", description: "Your browser does not support passkeys.", variant: "destructive" });
      return;
    }

    setRegisterLoading(true);
    try {
      const optionsRes = await apiRequest("POST", "/api/auth/passkey/register-options", {});
      const optionsData = await optionsRes.json();
      const { regSessionId, ...options } = optionsData;

      const regResponse = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          response: regResponse,
          deviceName: `Passkey ${(passkeys?.length || 0) + 1}`,
          regSessionId,
        }),
      });
      const verifyData = await verifyRes.json();

      if (verifyRes.ok && verifyData.verified) {
        toast({ title: "Passkey registered", description: "You can now sign in with this passkey." });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/passkey/credentials"] });
      } else {
        toast({ title: "Registration failed", description: verifyData.error || "Could not register passkey.", variant: "destructive" });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "NotAllowedError") {
        toast({ title: "Registration cancelled", description: "The passkey registration was cancelled.", variant: "destructive" });
        return;
      }
      toast({ title: "Registration failed", description: error instanceof Error ? error.message : "Could not register passkey.", variant: "destructive" });
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setDeletingId(id);
    try {
      await apiRequest("DELETE", `/api/auth/passkey/credentials/${id}`);
      toast({ title: "Passkey removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/passkey/credentials"] });
    } catch (error: unknown) {
      toast({ title: "Failed to remove passkey", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Fingerprint className="h-5 w-5" />
          Passkeys
        </CardTitle>
        <CardDescription>Sign in with your fingerprint, face, or device PIN instead of a password</CardDescription>
      </CardHeader>
      <CardContent>
        {loadingPasskeys ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="space-y-3 max-w-lg">
            <p className="text-xs text-muted-foreground" data-testid="text-passkey-domain-note">
              Passkeys are tied to the domain they were created on. A passkey
              registered on one Replit dev URL won't work on a different one or
              on your published app — you'll need to register a new passkey on
              each domain you sign in from.
              {currentRpId && (
                <> Current domain: <span className="font-medium text-foreground">{currentRpId}</span>.</>
              )}
            </p>

            {passkeys.length > 0 && (
              <div className="space-y-2">
                {passkeys.map((pk) => {
                  const isStale = !pk.isCurrentDomain;
                  const domainLabel = pk.rpId
                    ? `Registered on ${pk.rpId}`
                    : "Registered on unknown domain";
                  return (
                    <div
                      key={pk.id}
                      className="flex items-center justify-between p-3 border rounded-md"
                      data-testid={`passkey-item-${pk.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Fingerprint className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="flex items-center gap-2">
                            <p
                              className="text-sm font-medium"
                              data-testid={`text-passkey-name-${pk.id}`}
                            >
                              {pk.deviceName || "Passkey"}
                            </p>
                            {isStale && (
                              <Badge
                                variant="outline"
                                className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 gap-1"
                                data-testid={`badge-passkey-stale-${pk.id}`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Not usable here
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-xs text-muted-foreground"
                            data-testid={`text-passkey-domain-${pk.id}`}
                          >
                            {domainLabel}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Added {new Date(pk.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePasskey(pk.id)}
                        disabled={deletingId === pk.id}
                        data-testid={`button-delete-passkey-${pk.id}`}
                      >
                        {deletingId === pk.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              variant="outline"
              onClick={handleRegisterPasskey}
              disabled={registerLoading}
              data-testid="button-register-passkey"
            >
              {registerLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add a Passkey
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
