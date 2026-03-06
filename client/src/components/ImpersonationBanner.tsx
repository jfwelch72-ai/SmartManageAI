import { useState, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

async function endImpersonation() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {}
  document.cookie = "impersonation_info=; path=/; max-age=0";
  window.location.href = "/login";
}

export default function ImpersonationBanner() {
  const [info, setInfo] = useState<{ adminEmail: string; targetEmail: string } | null>(null);

  useEffect(() => {
    const raw = getCookie("impersonation_info");
    if (raw) {
      try {
        setInfo(JSON.parse(raw));
      } catch {}
    }
  }, []);

  if (!info) return null;

  return (
    <div
      className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between text-sm font-medium z-50"
      data-testid="banner-impersonation"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span>
          Viewing as <strong data-testid="text-impersonated-user">{info.targetEmail}</strong>
          {" "}(admin: {info.adminEmail})
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-amber-950 hover:text-amber-950 hover:bg-amber-400"
        onClick={endImpersonation}
        data-testid="button-end-impersonation"
      >
        <X className="h-4 w-4 mr-1" />
        End Session
      </Button>
    </div>
  );
}
