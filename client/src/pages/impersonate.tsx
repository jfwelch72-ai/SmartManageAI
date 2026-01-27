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
    const token = urlParams.get("token");

    if (!token) {
      setStatus("error");
      setMessage("No authentication token provided");
      return;
    }

    // Set the token as a cookie and redirect to dashboard
    document.cookie = `token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Strict`;
    
    setStatus("success");
    setMessage("Logged in successfully. Redirecting...");
    
    // Clear the URL and redirect to dashboard after a short delay
    setTimeout(() => {
      window.history.replaceState({}, document.title, "/");
      setLocation("/dashboard");
    }, 1000);
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle className="text-center">
            {status === "loading" && "Logging In..."}
            {status === "success" && "Login Successful"}
            {status === "error" && "Login Failed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          )}
          <p className="text-muted-foreground text-center">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
