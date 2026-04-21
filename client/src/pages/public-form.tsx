import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface FormField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface PublicForm {
  id: string;
  name: string;
  slug: string;
  fields: FormField[];
  successMessage: string;
}

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, any>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    fetch(`/api/public/lead-forms/${slug}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Form not found")))
      .then(setForm)
      .catch((e) => setErrorMessage(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/public/lead-forms/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Submission failed");
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>;
  if (!form) return <div className="flex items-center justify-center min-h-screen p-6"><Card className="max-w-md w-full"><CardContent className="pt-6 text-center text-muted-foreground">{errorMessage || "Form not found"}</CardContent></Card></div>;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="max-w-xl w-full">
        <CardHeader>
          <CardTitle data-testid="text-form-title">{form.name}</CardTitle>
          <CardDescription>Fill out the form below and we'll be in touch.</CardDescription>
        </CardHeader>
        <CardContent>
          {status === "success" ? (
            <div className="text-center py-8">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg" data-testid="text-success">{form.successMessage}</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" data-testid="form-public-lead">
              {form.fields.map((f) => (
                <div key={f.key} className="space-y-2">
                  <Label>{f.label}{f.required && <span className="text-red-500">*</span>}</Label>
                  {f.type === "TEXTAREA" ? (
                    <Textarea
                      data-testid={`input-${f.key}`}
                      value={values[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      required={f.required}
                    />
                  ) : f.type === "SELECT" ? (
                    <Select value={values[f.key] ?? ""} onValueChange={(v) => setValues({ ...values, [f.key]: v })}>
                      <SelectTrigger data-testid={`input-${f.key}`}><SelectValue placeholder={f.placeholder || "Select..."} /></SelectTrigger>
                      <SelectContent>
                        {(f.options || []).map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  ) : f.type === "CHECKBOX" ? (
                    <div className="flex items-center gap-2">
                      <Checkbox checked={!!values[f.key]} onCheckedChange={(v) => setValues({ ...values, [f.key]: !!v })} data-testid={`input-${f.key}`} />
                      <span className="text-sm text-muted-foreground">{f.placeholder}</span>
                    </div>
                  ) : (
                    <Input
                      data-testid={`input-${f.key}`}
                      type={f.type === "EMAIL" ? "email" : f.type === "PHONE" ? "tel" : f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : "text"}
                      value={values[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      required={f.required}
                    />
                  )}
                </div>
              ))}
              {status === "error" && (
                <div className="flex items-center gap-2 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{errorMessage}</div>
              )}
              <Button type="submit" disabled={status === "submitting"} className="w-full" data-testid="button-submit">
                {status === "submitting" ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null} Submit
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
