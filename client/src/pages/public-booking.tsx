import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Calendar } from "lucide-react";

interface BookingLink { id: string; name: string; description?: string; durationMinutes: number; timezone: string; }

export default function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [link, setLink] = useState<BookingLink | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/public/meeting-links/${slug}`).then((r) => r.ok ? r.json() : Promise.reject(new Error("Link not found"))),
      fetch(`/api/public/meeting-links/${slug}/slots`).then((r) => r.ok ? r.json() : { slots: [] }),
    ])
      .then(([linkData, slotsData]) => { setLink(linkData); setSlots(slotsData.slots || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  async function book() {
    if (!selected) return;
    setStatus("submitting");
    try {
      const res = await fetch(`/api/public/meeting-links/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt: selected, inviteeName: name, inviteeEmail: email, inviteePhone: phone, notes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      setStatus("success");
    } catch (e: any) {
      setStatus("error");
      setError(e.message || "Booking failed");
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>;
  if (!link) return <div className="flex items-center justify-center min-h-screen p-6"><Card className="max-w-md w-full"><CardContent className="pt-6 text-center text-muted-foreground">{error || "Booking link not found"}</CardContent></Card></div>;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle data-testid="text-link-name"><Calendar className="inline h-5 w-5 mr-2" />{link.name}</CardTitle>
          <CardDescription>{link.description || `${link.durationMinutes}-minute meeting`}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === "success" ? (
            <div className="text-center py-8">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg" data-testid="text-success">Your meeting is confirmed for {new Date(selected).toLocaleString()}.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>Pick a time</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 max-h-64 overflow-auto">
                  {slots.length === 0 && <p className="text-sm text-muted-foreground col-span-full">No available slots in the next 14 days.</p>}
                  {slots.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant={selected === s ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelected(s)}
                      data-testid={`slot-${s}`}
                    >
                      {new Date(s).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </Button>
                  ))}
                </div>
              </div>
              {selected && (
                <div className="space-y-3 pt-3 border-t">
                  <div><Label>Your name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" required /></div>
                  <div><Label>Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" required /></div>
                  <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" /></div>
                  <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-notes" /></div>
                  {status === "error" && <p className="text-sm text-red-600">{error}</p>}
                  <Button onClick={book} disabled={status === "submitting" || !name || !email} className="w-full" data-testid="button-book">
                    {status === "submitting" ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null} Confirm booking
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
