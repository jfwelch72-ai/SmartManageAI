import { useState, useEffect, useRef } from "react";
import { X, FileText, Save, Loader2, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

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

  useEffect(() => {
    fetch(`/api/calls/${callId}/notes`, { credentials: "include" })
      .then(res => res.json())
      .then((notes: { content: string }[]) => {
        if (notes.length > 0) setContent(notes[0].content);
      })
      .catch(() => {});
    textareaRef.current?.focus();
  }, [callId]);

  const saveNotes = async (text: string) => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/calls/${callId}/notes`, { content: text });
      setLastSaved(new Date());
    } catch (err) {
      console.error("Failed to save notes:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNotes(val), 1500);
  };

  const handleSummarize = async () => {
    if (content.trim()) {
      await saveNotes(content);
    }
    setSummarizing(true);
    try {
      const res = await apiRequest("POST", `/api/calls/${callId}/notes/summarize`);
      const data = await res.json();
      setSummary(data.summary);
      setSummarySaved(false);
    } catch (err) {
      console.error("Failed to summarize notes:", err);
      setSummary("Failed to generate summary. Make sure there are notes to summarize.");
    } finally {
      setSummarizing(false);
    }
  };

  const handleSaveSummary = async () => {
    if (!summary) return;
    const separator = content.trim() ? "\n\n--- AI Summary ---\n" : "--- AI Summary ---\n";
    const updatedContent = content.trim() + separator + summary;
    setContent(updatedContent);
    await saveNotes(updatedContent);
    setSummarySaved(true);
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <div className="w-80 bg-background border-l flex flex-col h-full" data-testid="call-notes-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Call Notes</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-notes">
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 p-3 flex flex-col gap-2 overflow-auto">
        <Textarea
          ref={textareaRef}
          placeholder="Take notes during this call..."
          value={content}
          onChange={handleChange}
          className="flex-1 resize-none text-sm min-h-[200px]"
          data-testid="input-call-notes"
        />
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
              onClick={() => saveNotes(content)}
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
