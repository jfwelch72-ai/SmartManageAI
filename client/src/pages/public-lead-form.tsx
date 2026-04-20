import { useState } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function PublicLeadFormPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const isEmbed = new URLSearchParams(window.location.search).get("embed") === "1";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [projectType, setProjectType] = useState("");
  const [location, setLocation] = useState("");
  const [budget, setBudget] = useState("");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/public/leads/${orgSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email, phone: phone || null, companyName: company || null,
          projectType: projectType || null, projectLocation: location || null,
          estimatedBudget: budget ? Number(budget) : null,
          message: message || null,
          website: hp,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Submission failed (${res.status})`;
        try { const j = JSON.parse(text); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      setStatus("success");
    } catch (err: any) {
      setErrorMessage(err.message || "Something went wrong");
      setStatus("error");
    }
  }

  const Wrapper = ({ children }: { children: React.ReactNode }) => isEmbed
    ? <div className="p-4 bg-background min-h-screen">{children}</div>
    : <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">{children}</div>;

  if (status === "success") {
    return (
      <Wrapper>
        <Card className="w-full max-w-md" data-testid="card-lead-success">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
            <h2 className="text-xl font-semibold">Thanks — we got your message!</h2>
            <p className="text-sm text-muted-foreground">We'll be in touch shortly.</p>
          </CardContent>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Card className="w-full max-w-md" data-testid="card-public-lead-form">
        <CardHeader>
          <CardTitle>Get a Quote</CardTitle>
          <CardDescription>Tell us about your project and we'll be in touch.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            {/* Honeypot - hidden from users */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }}
              aria-hidden
            />
            <div>
              <Label htmlFor="lead-name">Name *</Label>
              <Input id="lead-name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="input-lead-name" />
            </div>
            <div>
              <Label htmlFor="lead-email">Email *</Label>
              <Input id="lead-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-lead-email" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lead-phone">Phone</Label>
                <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-lead-phone" />
              </div>
              <div>
                <Label htmlFor="lead-company">Company</Label>
                <Input id="lead-company" value={company} onChange={(e) => setCompany(e.target.value)} data-testid="input-lead-company" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lead-type">Project Type</Label>
                <Input id="lead-type" placeholder="Residential, Commercial..." value={projectType} onChange={(e) => setProjectType(e.target.value)} data-testid="input-lead-projecttype" />
              </div>
              <div>
                <Label htmlFor="lead-budget">Estimated Budget ($)</Label>
                <Input id="lead-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="input-lead-budget" />
              </div>
            </div>
            <div>
              <Label htmlFor="lead-location">Location</Label>
              <Input id="lead-location" placeholder="City, State" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="input-lead-location" />
            </div>
            <div>
              <Label htmlFor="lead-message">Tell us about your project</Label>
              <Textarea id="lead-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="input-lead-message" />
            </div>
            {status === "error" && (
              <div className="flex items-start gap-2 text-sm text-destructive p-2 rounded border border-destructive/30 bg-destructive/5" data-testid="text-lead-error">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={status === "submitting" || !name || !email} data-testid="button-submit-lead">
              {status === "submitting" ? "Sending..." : "Submit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Wrapper>
  );
}
