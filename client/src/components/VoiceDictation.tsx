import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useProject } from "@/hooks/use-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Loader2, Brain, Send, X, FileText, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { queueOfflineRequest } from "@/lib/offlineQueue";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface DailyReportAIResult {
  summary?: string;
  workPerformed?: string;
  crewCount?: string | number;
  weather?: string;
  issues?: string[];
  tags?: string[];
  hoursWorked?: number;
}

interface RfiAIResult {
  summary?: string;
  question?: string;
  context?: string;
  suggestedResponse?: string;
  tags?: string[];
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

type AIParseResult = DailyReportAIResult & RfiAIResult;

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

export default function VoiceDictation() {
  const { toast } = useToast();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [outputType, setOutputType] = useState<"daily_report" | "rfi">("daily_report");
  const [aiResult, setAiResult] = useState<AIParseResult | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  const projectCode = useMemo(() => {
    const match = location.match(/^\/projects\/([^/]+)/);
    return match ? match[1] : undefined;
  }, [location]);

  const { data: project } = useProject(projectCode || "");
  const { data: projectsResponse } = useQuery<{ data: { id: string; name: string; projectNumber?: string }[] }>({ queryKey: ["/api/projects"] });
  const allProjects = projectsResponse?.data || [];

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  useEffect(() => {
    if (project?.id && !selectedProjectId) {
      setSelectedProjectId(project.id);
    }
  }, [project?.id]);

  const projectId = selectedProjectId || project?.id;

  function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
    const win = window as Window & { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance };
    return win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }

  useEffect(() => {
    setIsSupported(!!getSpeechRecognitionConstructor());
  }, []);

  const startRecording = useCallback(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      toast({ title: "Speech recognition not supported", description: "Use Chrome or Edge for voice dictation", variant: "destructive" });
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
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + " ";
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText) {
        setTranscript(prev => prev + finalText);
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech") {
        // Silently ignore — user just didn't speak
      } else if (event.error === "network") {
        toast({
          title: "Speech Recognition Unavailable",
          description: "Voice recognition requires a direct browser connection. You can type your notes manually in the text box below.",
        });
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast({
          title: "Microphone Access Denied",
          description: "Please allow microphone access in your browser settings to use voice dictation.",
          variant: "destructive",
        });
      } else if (event.error === "aborted") {
        // Silently ignore — user or system stopped recording
      } else {
        toast({ title: "Recognition error", description: event.error, variant: "destructive" });
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
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setInterimTranscript("");
  }, []);

  const parseTranscriptMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/field-productivity/voice-logs/parse", {
        transcription: text,
        outputType,
        projectId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setAiResult(data);
    },
    onError: () => {
      toast({ title: "Failed to parse transcript", variant: "destructive" });
    },
  });

  const saveVoiceLogMutation = useMutation({
    mutationFn: async () => {
      const voiceLogPayload = {
        audioUrl: "speech-recognition://local",
        transcription: transcript,
        status: "TRANSCRIBED",
        projectId,
        aiSummary: aiResult?.summary,
        aiTags: aiResult?.tags,
      };

      if (!navigator.onLine) {
        await queueOfflineRequest(
          "/api/field-productivity/voice-logs",
          "POST",
          voiceLogPayload,
          "VOICE_LOG"
        );
        if (projectId && outputType === "daily_report") {
          const noteText = buildDailyReportText(transcript, aiResult);
          await queueOfflineRequest(
            `/api/projects/${projectId}/notes`,
            "POST",
            { text: noteText, noteType: "FIELD_NOTE" },
            "DAILY_REPORT"
          );
        }
        if (projectId && outputType === "rfi") {
          const rfiPayload = buildRfiPayload(transcript, aiResult, projectId);
          await queueOfflineRequest("/api/rfi", "POST", rfiPayload, "RFI");
        }
        return { offline: true, outputType };
      }

      const response = await apiRequest("POST", "/api/field-productivity/voice-logs", voiceLogPayload);
      const voiceLog = await response.json();

      if (projectId && outputType === "daily_report") {
        const noteText = buildDailyReportText(transcript, aiResult);
        await apiRequest("POST", `/api/projects/${projectId}/notes`, {
          text: noteText,
          noteType: "FIELD_NOTE",
        });
      }

      if (projectId && outputType === "rfi") {
        const rfiPayload = buildRfiPayload(transcript, aiResult, projectId);
        await apiRequest("POST", "/api/rfi", rfiPayload);
      }

      return { ...voiceLog, outputType };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/voice-logs"] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/notes`] });
        queryClient.invalidateQueries({ queryKey: ["/api/rfi"] });
      }
      const isDaily = data?.outputType === "daily_report";
      toast({
        title: data?.offline
          ? "Saved offline"
          : isDaily ? "Daily report created" : "RFI draft created",
        description: data?.offline
          ? "Will sync when back online"
          : isDaily
            ? "Voice log saved and daily report entry created"
            : "Voice log saved and RFI draft created",
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message || "Please try again", variant: "destructive" });
    },
  });

  const handleClose = () => {
    stopRecording();
    setIsOpen(false);
    setTranscript("");
    setInterimTranscript("");
    setAiResult(null);
  };

  const handleParseAndSave = () => {
    if (transcript.trim()) {
      parseTranscriptMutation.mutate(transcript.trim());
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative flex items-center justify-center w-12 h-12 rounded-full shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-all hover:scale-105"
        data-testid="button-floating-mic"
      >
        <Mic className="h-5 w-5" />
        <span className="sr-only">Voice Dictation</span>
      </button>

      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Voice Dictation
            </DialogTitle>
            <DialogDescription>
              {isSupported
                ? "Tap the mic to start dictating. Your speech will be transcribed in real-time."
                : "Type your notes below. Speech recognition is not available in this browser."
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Select value={outputType} onValueChange={(v: "daily_report" | "rfi") => setOutputType(v)}>
                <SelectTrigger className="w-[150px]" data-testid="select-output-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily_report">Daily Report</SelectItem>
                  <SelectItem value="rfi">RFI Draft</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedProjectId || "__NONE__"} onValueChange={(v) => setSelectedProjectId(v === "__NONE__" ? "" : v)}>
                <SelectTrigger className="flex-1" data-testid="select-voice-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">No project</SelectItem>
                  {allProjects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.projectNumber ? `${p.projectNumber} - ` : ""}{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center">
              {isSupported && (
                <Button
                  onClick={isRecording ? stopRecording : startRecording}
                  size="lg"
                  variant={isRecording ? "destructive" : "default"}
                  className={cn(
                    "h-16 w-16 rounded-full",
                    isRecording && "animate-pulse"
                  )}
                  data-testid="button-record"
                >
                  {isRecording ? (
                    <MicOff className="h-6 w-6" />
                  ) : (
                    <Mic className="h-6 w-6" />
                  )}
                </Button>
              )}
            </div>

            {isRecording && (
              <div className="text-center">
                <Badge variant="destructive" className="animate-pulse" data-testid="badge-recording">
                  Recording...
                </Badge>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">Transcription</Label>
              <Textarea
                value={transcript + interimTranscript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  setInterimTranscript("");
                }}
                placeholder={isSupported ? "Start speaking or type your notes here..." : "Type your field notes here..."}
                rows={6}
                className="resize-none"
                data-testid="textarea-transcript"
              />
              {interimTranscript && (
                <p className="text-xs text-muted-foreground italic">Listening...</p>
              )}
            </div>

            {aiResult && (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-3 p-3 bg-primary/5 rounded-lg border border-primary/10">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-medium">AI Analysis</Label>
                  </div>
                  {aiResult.summary && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Summary</p>
                      <p className="text-sm" data-testid="text-ai-summary">{aiResult.summary}</p>
                    </div>
                  )}
                  {aiResult.workPerformed && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Work Performed</p>
                      <p className="text-sm">{aiResult.workPerformed}</p>
                    </div>
                  )}
                  {aiResult.crewCount && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Crew Count</p>
                      <p className="text-sm">{aiResult.crewCount}</p>
                    </div>
                  )}
                  {aiResult.weather && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Weather</p>
                      <p className="text-sm">{aiResult.weather}</p>
                    </div>
                  )}
                  {aiResult.issues && aiResult.issues.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Issues Noted</p>
                      <ul className="text-sm list-disc list-inside">
                        {aiResult.issues.map((issue: string, i: number) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiResult.tags && aiResult.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {aiResult.tags.map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-dictation">
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            {transcript.trim() && !aiResult && (
              <Button
                onClick={handleParseAndSave}
                disabled={parseTranscriptMutation.isPending}
                variant="secondary"
                data-testid="button-parse-transcript"
              >
                {parseTranscriptMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4 mr-2" />
                )}
                Analyze with AI
              </Button>
            )}
            {transcript.trim() && (
              <Button
                onClick={() => saveVoiceLogMutation.mutate()}
                disabled={saveVoiceLogMutation.isPending || (!projectId && outputType !== "daily_report")}
                data-testid="button-save-voice-log"
              >
                {saveVoiceLogMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Save {outputType === "daily_report" ? "Daily Report" : "RFI Draft"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function buildDailyReportText(transcript: string, aiResult: AIParseResult | null): string {
  const parts: string[] = [];
  parts.push("[Voice Dictation - Daily Report]");
  if (aiResult?.summary) parts.push(`Summary: ${aiResult.summary}`);
  if (aiResult?.workPerformed) parts.push(`Work Performed: ${aiResult.workPerformed}`);
  if (aiResult?.crewCount) parts.push(`Crew: ${aiResult.crewCount}`);
  if (aiResult?.weather) parts.push(`Weather: ${aiResult.weather}`);
  if (aiResult?.issues?.length) parts.push(`Issues: ${aiResult.issues.join("; ")}`);
  parts.push(`\nRaw Transcription:\n${transcript}`);
  return parts.join("\n");
}

function buildRfiPayload(transcript: string, aiResult: AIParseResult | null, projectId: string) {
  return {
    projectId,
    subject: aiResult?.summary || transcript.slice(0, 100),
    question: aiResult?.question || transcript,
    context: aiResult?.context || undefined,
    suggestedResponse: aiResult?.suggestedResponse || undefined,
    priority: aiResult?.priority || "MEDIUM",
    status: "DRAFT",
  };
}
