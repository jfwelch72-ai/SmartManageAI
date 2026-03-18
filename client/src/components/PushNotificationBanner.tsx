import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "push_banner_dismissed_v1";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export default function PushNotificationBanner() {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return;
    }
    if (Notification.permission !== "default") return;
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) return;
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!vapidPublicKey) return;
    setVisible(true);
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  async function enable() {
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!vapidPublicKey) return dismiss();

    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        dismiss();
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      await apiRequest("POST", "/api/notifications/push-subscribe", {
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent,
      });
      await apiRequest("PUT", "/api/notifications/preferences", {
        channel: { pushEnabled: true },
        typeOverrides: {},
      });
      toast({ title: "Push notifications enabled", description: "You'll receive browser alerts for important events." });
      dismiss();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" || name === "NotSupportedError") {
        // Push service temporarily unavailable (common in proxied/iframe environments).
        // Don't permanently dismiss — just hide for now so the user can retry.
        setVisible(false);
        toast({
          title: "Push notifications unavailable",
          description: "Your browser's push service could not be reached. Try again later or use a different browser.",
        });
      } else if (name === "NotAllowedError") {
        // Permission was denied — permanently dismiss.
        dismiss();
      } else {
        // Unknown error — hide but don't permanently dismiss.
        setVisible(false);
        toast({
          title: "Could not enable push notifications",
          description: "Please try again from your notification settings.",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md mx-auto px-4" data-testid="banner-push-notification">
      <div className="flex items-center gap-3 bg-primary text-primary-foreground rounded-lg px-4 py-3 shadow-lg">
        <Bell className="h-5 w-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Enable push notifications?</p>
          <p className="text-xs opacity-80">Get instant browser alerts for approvals and updates.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={enable}
            disabled={loading}
            className="text-xs h-7"
            data-testid="button-banner-enable-push"
          >
            {loading ? "Enabling…" : "Enable"}
          </Button>
          <button
            onClick={dismiss}
            className="opacity-70 hover:opacity-100 transition-opacity"
            data-testid="button-banner-dismiss-push"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
