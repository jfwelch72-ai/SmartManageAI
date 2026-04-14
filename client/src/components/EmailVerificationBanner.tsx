import { useState } from "react";
import { Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function EmailVerificationBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user || user.emailVerified || dismissed) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification");
      toast({ title: "Verification email sent", description: "Please check your inbox and spam folder." });
    } catch {
      toast({ title: "Failed to send", description: "Please try again later.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center justify-between gap-3 text-sm"
      data-testid="banner-email-verification"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Mail className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-amber-800 dark:text-amber-200 truncate">
          Your email is not verified. Please check your inbox or resend the verification email.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleResend}
          disabled={sending}
          className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900"
          data-testid="button-resend-verification"
        >
          {sending ? "Sending..." : "Resend verification email"}
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-600 dark:text-amber-400"
          aria-label="Dismiss"
          data-testid="button-dismiss-verification-banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
