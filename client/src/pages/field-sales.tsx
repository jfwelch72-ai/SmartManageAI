import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Phone, Mail, MapPin, Mic, MicOff, FileText, Loader2, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Org {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  type?: string;
}

export default function FieldSalesPage() {
  const { toast } = useToast();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [voiceText, setVoiceText] = useState("");
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setGeoError(err.message),
      { timeout: 10000 }
    );
  }, []);

  const { data: orgs = [], isLoading } = useQuery<Org[]>({ queryKey: ["/api/crm/organisations"] });

  const logActivity = useMutation({
    mutationFn: async ({ orgId, type, description }: any) => {
      // Create as a CRM task / note against the organisation. Use opportunities endpoint by finding first opp for org.
      // Fallback: just create a contact note (not ideal). For v1 we POST a generic activity to a magic CRM activity endpoint.
      return apiRequest("POST", "/api/crm/tasks", {
        title: `[Field] ${type}`,
        description,
        dueDate: new Date().toISOString(),
        crmOrganisationId: orgId,
        status: "COMPLETED",
        priority: "NORMAL",
      });
    },
    onSuccess: () => { toast({ title: "Activity logged" }); queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] }); },
    onError: (e: any) => toast({ title: "Failed to log", description: e?.message, variant: "destructive" }),
  });

  function startVoice(orgId: string) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast({ title: "Voice not supported in this browser", variant: "destructive" }); return; }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
      setVoiceText(text.trim());
    };
    r.onend = () => setRecording(false);
    r.start();
    setRecognition(r);
    setRecording(true);
    setActiveOrgId(orgId);
  }
  function stopVoice() {
    if (recognition) recognition.stop();
    setRecording(false);
  }
  function saveVoiceNote() {
    if (!activeOrgId || !voiceText.trim()) return;
    logActivity.mutate({ orgId: activeOrgId, type: "Voice note", description: voiceText });
    setVoiceText("");
    setActiveOrgId(null);
  }

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Field Sales</span>
            <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] })} data-testid="button-refresh"><RefreshCw className="h-4 w-4" /></Button>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {coords ? <><MapPin className="inline h-3 w-3 mr-1" />Lat {coords.lat.toFixed(3)}, Lng {coords.lng.toFixed(3)}</> : geoError || "Locating..."}
          </p>
        </CardHeader>
      </Card>

      {voiceText && activeOrgId && (
        <Card className="border-blue-500" data-testid="voice-note-card">
          <CardHeader><CardTitle>Voice note draft</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea value={voiceText} onChange={(e) => setVoiceText(e.target.value)} rows={4} data-testid="textarea-voice" />
            <div className="flex gap-2">
              <Button onClick={saveVoiceNote} data-testid="button-save-voice">Save note</Button>
              <Button variant="outline" onClick={() => { setVoiceText(""); setActiveOrgId(null); }}>Discard</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? <Loader2 className="animate-spin mx-auto" /> : (
        <div className="space-y-3">
          {orgs.map((o) => (
            <Card key={o.id} data-testid={`card-org-${o.id}`}>
              <CardHeader>
                <CardTitle className="text-base">{o.name} {o.type && <Badge variant="outline" className="ml-2 text-xs">{o.type}</Badge>}</CardTitle>
                {o.address && <p className="text-sm text-muted-foreground"><MapPin className="inline h-3 w-3 mr-1" />{o.address}</p>}
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" disabled={!o.phone} onClick={() => { window.location.href = `tel:${o.phone}`; logActivity.mutate({ orgId: o.id, type: "Call", description: `Called ${o.phone}` }); }} data-testid={`button-call-${o.id}`}>
                  <Phone className="h-4 w-4 mr-1" />Call
                </Button>
                <Button variant="outline" size="sm" disabled={!o.email} onClick={() => { window.location.href = `mailto:${o.email}`; logActivity.mutate({ orgId: o.id, type: "Email", description: `Emailed ${o.email}` }); }} data-testid={`button-email-${o.id}`}>
                  <Mail className="h-4 w-4 mr-1" />Email
                </Button>
                <Button variant="outline" size="sm" onClick={() => logActivity.mutate({ orgId: o.id, type: "Visit", description: `Logged on-site visit at ${new Date().toLocaleString()}` })} data-testid={`button-log-${o.id}`}>
                  <FileText className="h-4 w-4 mr-1" />Log visit
                </Button>
                {recording && activeOrgId === o.id ? (
                  <Button variant="destructive" size="sm" onClick={stopVoice} data-testid={`button-voice-stop-${o.id}`}>
                    <MicOff className="h-4 w-4 mr-1" />Stop
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => startVoice(o.id)} data-testid={`button-voice-${o.id}`}>
                    <Mic className="h-4 w-4 mr-1" />Voice note
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {orgs.length === 0 && <p className="text-sm text-muted-foreground text-center">No CRM organisations yet.</p>}
        </div>
      )}
    </div>
  );
}
