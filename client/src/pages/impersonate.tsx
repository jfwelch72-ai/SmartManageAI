import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function ImpersonatePage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Setting up session...");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (!code) {
      setStatus("error");
      setMessage("No authentication code provided");
      return;
    }

    window.history.replaceState({}, document.title, "/impersonate");

    fetch("/api/platform/impersonate/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Code expired or invalid");
        return res.json();
      })
      .then(() => {
        setStatus("success");
        setMessage("Logged in successfully. Redirecting...");
        setTimeout(() => {
          setLocation("/dashboard");
        }, 1000);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message || "Failed to authenticate");
      });
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background" data-testid="impersonate-page">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle className="text-center" data-testid="text-impersonate-status">
            {status === "loading" && "Logging In..."}
            {status === "success" && "Login Successful"}
            {status === "error" && "Login Failed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          )}
          <p className="text-muted-foreground text-center" data-testid="text-impersonate-message">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
