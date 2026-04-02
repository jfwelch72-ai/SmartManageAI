import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Fingerprint, Plus, Trash2, Loader2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";

export default function PasskeySection() {
  const { toast } = useToast();
  const [registerLoading, setRegisterLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: passkeys = [], isLoading: loadingPasskeys } = useQuery<{ id: string; deviceName: string | null; createdAt: string }[]>({
    queryKey: ["/api/auth/passkey/credentials"],
  });

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
            {passkeys.length > 0 && (
              <div className="space-y-2">
                {passkeys.map((pk) => (
                  <div key={pk.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`passkey-item-${pk.id}`}>
                    <div className="flex items-center gap-3">
                      <Fingerprint className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium" data-testid={`text-passkey-name-${pk.id}`}>
                          {pk.deviceName || "Passkey"}
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
                ))}
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