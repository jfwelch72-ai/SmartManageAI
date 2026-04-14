import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VoiceLog } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Play, Pause, Trash2, Clock, CheckCircle, XCircle, AlertTriangle, FileText, Tag, Brain, ChevronRight, Loader2, Send } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface VoiceAIResult {
  summary?: string;
  tags?: string[];
  category?: string;
  priority?: number;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export default function VoiceLogsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedLog, setSelectedLog] = useState<VoiceLog | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: logs, isLoading } = useQuery<VoiceLog[]>({
    queryKey: ["/api/field-productivity/voice-logs", statusFilter !== "ALL" ? statusFilter : undefined],
    queryFn: () => {
      const params = statusFilter !== "ALL" ? `?status=${statusFilter}` : "";
      return fetch(`/api/field-productivity/voice-logs${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/field-productivity/voice-logs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/voice-logs"] });
      toast({ title: "Voice log deleted" });
      setSelectedLog(null);
    },
    onError: () => {
      toast({ title: "Failed to delete voice log", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "TRANSCRIBED":
        return <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" /> Transcribed</Badge>;
      case "FAILED":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-voice-logs">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Voice Logs</h1>
          <p className="text-muted-foreground">Manage voice memos and transcriptions from the field</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="TRANSCRIBED">Transcribed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-voice-log">
            <Mic className="h-4 w-4 mr-2" />
            New Voice Log
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : logs && logs.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {logs.map((log) => (
            <Card 
              key={log.id} 
              className="cursor-pointer hover-elevate transition-all"
              onClick={() => setSelectedLog(log)}
              data-testid={`card-voice-log-${log.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">
                      {log.transcription ? log.transcription.slice(0, 50) + "..." : "Voice Memo"}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                    </CardDescription>
                  </div>
                  {getStatusBadge(log.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {log.duration && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{Math.floor(log.duration / 60)}:{(log.duration % 60).toString().padStart(2, "0")}</span>
                  </div>
                )}
                {log.aiTags && log.aiTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {log.aiTags.slice(0, 3).map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        <Tag className="h-3 w-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                    {log.aiTags.length > 3 && (
                      <Badge variant="outline" className="text-xs">+{log.aiTags.length - 3}</Badge>
                    )}
                  </div>
                )}
                {log.aiSummary && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {log.aiSummary}
                  </p>
                )}
                <div className="flex items-center justify-end text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <MicOff className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Voice Logs Yet</h3>
          <p className="text-muted-foreground mb-4">
            Record voice memos to capture field observations and notes hands-free.
          </p>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-voice-log">
            <Mic className="h-4 w-4 mr-2" />
            Create First Voice Log
          </Button>
        </Card>
      )}

      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Voice Log Details
            </DialogTitle>
            <DialogDescription>
              Recorded {selectedLog && format(new Date(selectedLog.createdAt), "MMMM d, yyyy 'at' h:mm a")}
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                <div className="flex items-center justify-between">
                  {getStatusBadge(selectedLog.status)}
                  {selectedLog.duration && (
                    <span className="text-sm text-muted-foreground">
                      Duration: {Math.floor(selectedLog.duration / 60)}:{(selectedLog.duration % 60).toString().padStart(2, "0")}
                    </span>
                  )}
                </div>

                {selectedLog.audioUrl && selectedLog.audioUrl !== "speech-recognition://local" && (
                  <div className="p-4 bg-muted rounded-lg">
                    <audio controls className="w-full" data-testid="audio-player">
                      <source src={selectedLog.audioUrl} type="audio/mpeg" />
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}

                {selectedLog.transcription && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Transcription</Label>
                    <div className="p-4 bg-muted rounded-lg text-sm whitespace-pre-wrap" data-testid="text-transcription">
                      {selectedLog.transcription}
                    </div>
                  </div>
                )}

                {selectedLog.aiSummary && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      AI Summary
                    </Label>
                    <div className="p-4 bg-primary/5 rounded-lg text-sm border border-primary/10" data-testid="text-ai-summary">
                      {selectedLog.aiSummary}
                    </div>
                  </div>
                )}

                {selectedLog.aiTags && selectedLog.aiTags.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">AI Tags</Label>
                    <div className="flex flex-wrap gap-2">
                      {selectedLog.aiTags.map((tag, i) => (
                        <Badge key={i} variant="secondary">
                          <Tag className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {selectedLog.aiSentiment && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Sentiment</Label>
                    <Badge variant="outline">{selectedLog.aiSentiment}</Badge>
                  </div>
                )}

                {selectedLog.errorMessage && (
                  <div className="p-4 bg-destructive/10 rounded-lg text-sm text-destructive" data-testid="text-error">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    {selectedLog.errorMessage}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => selectedLog && deleteMutation.mutate(selectedLog.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-voice-log"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button variant="outline" onClick={() => setSelectedLog(null)} data-testid="button-close-dialog">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateVoiceLogDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </div>
  );
}

function CreateVoiceLogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [transcription, setTranscription] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [aiResult, setAiResult] = useState<VoiceAIResult | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const SpeechRecognition = getSpeechRecognitionCtor();

  const startRecording = useCallback(() => {
    if (!SpeechRecognition) {
      toast({ title: "Speech recognition not available", description: "Use Chrome or Edge", variant: "destructive" });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript + " ";
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      if (finalText) setTranscription(prev => prev + finalText);
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: Event & { error?: string }) => {
      if (event.error !== "no-speech") {
        toast({ title: "Recognition error", description: event.error || "Unknown error", variant: "destructive" });
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimTranscript("");
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [SpeechRecognition, toast]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setInterimTranscript("");
  }, []);

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/field-productivity/voice-logs/parse", {
        transcription: text,
        outputType: "daily_report",
      });
      return response.json();
    },
    onSuccess: (data) => setAiResult(data),
    onError: () => toast({ title: "Failed to analyze", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: { transcription?: string; audioUrl?: string; status: string; aiSummary?: string; aiTags?: string[] }) =>
      apiRequest("POST", "/api/field-productivity/voice-logs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/voice-logs"] });
      toast({ title: "Voice log created" });
      handleClose();
    },
    onError: () => {
      toast({ title: "Failed to create voice log", variant: "destructive" });
    },
  });

  const handleClose = () => {
    stopRecording();
    onOpenChange(false);
    setTranscription("");
    setInterimTranscript("");
    setAiResult(null);
  };

  const handleSubmit = () => {
    createMutation.mutate({
      transcription: transcription || undefined,
      audioUrl: "speech-recognition://local",
      status: transcription ? "TRANSCRIBED" : "PENDING",
      aiSummary: aiResult?.summary,
      aiTags: aiResult?.tags,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Voice Log</DialogTitle>
          <DialogDescription>
            {SpeechRecognition
              ? "Tap the microphone to start dictating, or type your notes directly."
              : "Type your field notes below."
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SpeechRecognition && (
            <div className="flex justify-center">
              <Button
                onClick={isRecording ? stopRecording : startRecording}
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                className={cn("h-16 w-16 rounded-full", isRecording && "animate-pulse")}
                data-testid="button-record-voice"
              >
                {isRecording ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </Button>
            </div>
          )}
          {isRecording && (
            <div className="text-center">
              <Badge variant="destructive" className="animate-pulse">Recording...</Badge>
            </div>
          )}
          <div className="space-y-2">
            <Label>Transcription</Label>
            <Textarea
              value={transcription + interimTranscript}
              onChange={(e) => { setTranscription(e.target.value); setInterimTranscript(""); }}
              placeholder={SpeechRecognition ? "Start speaking or type here..." : "Enter your notes..."}
              rows={5}
              data-testid="input-transcription"
            />
          </div>

          {aiResult && (
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/10 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">AI Analysis</span>
              </div>
              {aiResult.summary && <p className="text-sm">{aiResult.summary}</p>}
              {aiResult.tags && aiResult.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {aiResult.tags.map((tag: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
            Cancel
          </Button>
          {transcription.trim() && !aiResult && (
            <Button
              variant="secondary"
              onClick={() => parseMutation.mutate(transcription.trim())}
              disabled={parseMutation.isPending}
              data-testid="button-analyze"
            >
              {parseMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Brain className="h-4 w-4 mr-2" />}
              Analyze
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !transcription.trim()}
            data-testid="button-submit-voice-log"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Save Voice Log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
