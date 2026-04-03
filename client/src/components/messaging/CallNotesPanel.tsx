import { useState, useEffect, useRef, useCallback } from "react";
import { X, FileText, Save, Loader2, Sparkles, Check, Mic, MicOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

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

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  const win = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

interface CallNotesPanelProps {
  callId: string;
  onClose: () => void;
}

export function CallNotesPanel({ callId, onClose }: CallNotesPanelProps) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isTranscribingRef = useRef(false);
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognitionConstructor());
  }, []);

  useEffect(() => {
    fetch(`/api/calls/${callId}/notes`, { credentials: "include" })
      .then(res => res.json())
      .then((notes: { content: string }[]) => {
        if (notes.length > 0) setContent(notes[0].content);
      })
      .catch(() => {});
    textareaRef.current?.focus();
  }, [callId]);

  const saveNotes = useCallback(async (text: string) => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/calls/${callId}/notes`, { content: text });
      setLastSaved(new Date());
    } catch (err) {
      console.error("Failed to save notes:", err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [callId]);

  const scheduleSave = useCallback((text: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNotes(text).catch(() => {}), 1500);
  }, [saveNotes]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    scheduleSave(val);
  };

  const appendTranscriptLine = useCallback((text: string) => {
    setContent(prev => {
      const marker = "\n--- Live Transcription ---\n";
      const hasMarker = prev.includes("--- Live Transcription ---");
      let updated: string;
      if (!hasMarker) {
        updated = prev.trim() ? prev.trimEnd() + marker + text : marker.trimStart() + text;
      } else {
        updated = prev.trimEnd() + "\n" + text;
      }
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  const startTranscription = useCallback(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      if (finalText.trim()) {
        appendTranscriptLine(finalText.trim());
      }
      setInterimText(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Speech recognition error:", event.error);
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
        setInterimText("");
        if (recognitionRef.current) {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
      }
    };

    recognition.onend = () => {
      if (isTranscribingRef.current) {
        try {
          recognition.start();
        } catch {
          isTranscribingRef.current = false;
          setIsTranscribing(false);
          setInterimText("");
        }
      } else {
        setInterimText("");
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    isTranscribingRef.current = true;
    setIsTranscribing(true);
  }, [appendTranscriptLine]);

  const stopTranscription = useCallback(() => {
    isTranscribingRef.current = false;
    setIsTranscribing(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setInterimText("");
    saveNotes(contentRef.current).catch(() => {});
  }, [saveNotes]);

  const toggleTranscription = useCallback(() => {
    if (isTranscribing) {
      stopTranscription();
    } else {
      startTranscription();
    }
  }, [isTranscribing, stopTranscription, startTranscription]);

  useEffect(() => {
    return () => {
      isTranscribingRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      {
        const callIdForSave = callId;
        fetch(`/api/calls/${callIdForSave}/notes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: contentRef.current }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [callId]);

  const handleSummarize = async () => {
    if (content.trim()) {
      try {
        await saveNotes(content);
      } catch (err) {
        console.error("Failed to save notes before summarizing:", err);
        setSummary("Failed to save notes before summarizing. Please try again.");
        return;
      }
    }
    setSummarizing(true);
    try {
      const res = await apiRequest("POST", `/api/calls/${callId}/notes/summarize`);
      const data = await res.json();
      setSummary(data.summary);
      setSummarySaved(false);
    } catch (err: unknown) {
      console.error("Failed to summarize notes:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("no notes")) {
        setSummary("No notes to summarize. Please add some notes first.");
      } else if (message.toLowerCase().includes("ai service") || message.toLowerCase().includes("openai") || message.toLowerCase().includes("unavailable")) {
        setSummary("AI summary service is temporarily unavailable. Please try again later.");
      } else if (message.toLowerCase().includes("not found")) {
        setSummary("Call not found. It may have been deleted.");
      } else if (message.toLowerCase().includes("not a participant")) {
        setSummary("You don't have access to summarize notes for this call.");
      } else {
        setSummary("Failed to generate summary. Please try again later.");
      }
    } finally {
      setSummarizing(false);
    }
  };

  const handleSaveSummary = async () => {
    if (!summary) return;
    const separator = content.trim() ? "\n\n--- AI Summary ---\n" : "--- AI Summary ---\n";
    const updatedContent = content.trim() + separator + summary;
    setContent(updatedContent);
    try {
      await saveNotes(updatedContent);
      setSummarySaved(true);
    } catch (err) {
      console.error("Failed to save summary to notes:", err);
    }
  };


  return (
    <div className="w-80 bg-background border-l flex flex-col h-full" data-testid="call-notes-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Call Notes</span>
          {isTranscribing && (
            <Badge variant="destructive" className="animate-pulse text-[10px] px-1.5 py-0" data-testid="badge-transcribing">
              <Mic className="w-2.5 h-2.5 mr-0.5" />
              LIVE
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {speechSupported === true ? (
            <Button
              variant={isTranscribing ? "destructive" : "ghost"}
              size="icon"
              className={cn("h-7 w-7", isTranscribing && "animate-pulse")}
              onClick={toggleTranscription}
              data-testid="button-toggle-transcription"
              title={isTranscribing ? "Stop live transcription" : "Start live transcription"}
            >
              {isTranscribing ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-notes">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {speechSupported === false && (
        <div className="mx-3 mt-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-2" data-testid="text-speech-unsupported">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-yellow-700 dark:text-yellow-400 leading-tight">
            Live transcription is not supported in this browser. Use Chrome or Edge for AI transcription, or type your notes manually.
          </p>
        </div>
      )}

      <div className="flex-1 p-3 flex flex-col gap-2 overflow-auto">
        <Textarea
          ref={textareaRef}
          placeholder="Take notes during this call..."
          value={content}
          onChange={handleChange}
          className={cn(
            "flex-1 resize-none text-sm min-h-[200px]",
            isTranscribing && "border-red-400/50"
          )}
          data-testid="input-call-notes"
        />
        {interimText && (
          <div className="px-2 py-1.5 rounded bg-muted/50 border border-dashed border-muted-foreground/30" data-testid="text-interim-transcript">
            <p className="text-[11px] text-muted-foreground italic animate-pulse">
              {interimText}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {saving ? (
              <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving...</span>
            ) : lastSaved ? (
              `Saved ${lastSaved.toLocaleTimeString()}`
            ) : (
              "Auto-saves as you type"
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={handleSummarize}
              disabled={summarizing}
              data-testid="button-summarize-notes"
            >
              {summarizing ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3 mr-1" />
              )}
              AI Summarize
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => saveNotes(content).catch(() => {})}
              disabled={saving}
              data-testid="button-save-notes"
            >
              <Save className="w-3 h-3 mr-1" />
              Save
            </Button>
          </div>
        </div>
        {summary && (
          <div className="mt-2 p-3 rounded-md bg-muted border text-sm" data-testid="text-ai-summary">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Sparkles className="w-3.5 h-3.5" />
                AI Summary
              </div>
              {summarySaved ? (
                <span className="flex items-center gap-1 text-xs text-green-600" data-testid="text-summary-saved">
                  <Check className="w-3 h-3" />
                  Saved
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-xs px-2"
                  onClick={handleSaveSummary}
                  disabled={saving}
                  data-testid="button-save-summary"
                >
                  <Save className="w-3 h-3 mr-1" />
                  Save to Notes
                </Button>
              )}
            </div>
            <div className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
              {summary}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
