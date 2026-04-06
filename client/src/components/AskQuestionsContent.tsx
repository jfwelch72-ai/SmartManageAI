import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Loader2, Database, HelpCircle, User, Bot, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";

interface QAMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const EXAMPLE_QUESTIONS = [
  "How many active projects do we have?",
  "What's the total value of open bids?",
  "Show me overdue tasks",
  "How many employees are on staff?",
  "What is our total contract value?",
];

interface SpeechRecognitionEvent {
  results: { readonly length: number; [index: number]: { isFinal: boolean; readonly length: number; 0: { transcript: string } } };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionAPI(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

const SpeechRecognitionAPI = getSpeechRecognitionAPI();

export function AskQuestionsContent({ compact }: { compact?: boolean }) {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      setInputValue(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      recognitionRef.current = null;
      if (event.error === "not-allowed") {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Microphone access was denied. Please allow microphone permissions in your browser settings to use voice input.",
          timestamp: new Date(),
        }]);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, stopListening, startListening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest("POST", "/api/ai/ask-database", {
        question,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.answer,
        timestamp: new Date(),
      }]);
    },
    onError: (error: any) => {
      const msg = error?.message || "";
      const statusMatch = msg.match(/^(\d{3}):/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      let errorMessage: string;
      if (status === 429) {
        errorMessage = "AI usage limit reached. Please try again later.";
      } else if (status === 503) {
        errorMessage = "The AI service is temporarily unavailable. Please try again in a moment.";
      } else if (status === 502) {
        errorMessage = "The AI returned an unexpected response. Please try rephrasing your question.";
      } else if (status === 400) {
        errorMessage = "There was an issue with your question. Please try rephrasing it.";
      } else {
        errorMessage = "Something went wrong processing your question. Please try again.";
      }
      setMessages(prev => [...prev, {
        role: "assistant",
        content: errorMessage,
        timestamp: new Date(),
      }]);
    },
  });

  const handleSend = () => {
    const question = inputValue.trim();
    if (!question || askMutation.isPending) return;

    if (isListening) {
      stopListening();
    }

    setMessages(prev => [...prev, {
      role: "user",
      content: question,
      timestamp: new Date(),
    }]);
    setInputValue("");
    askMutation.mutate(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExampleClick = (question: string) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full" data-testid="ask-questions-content">
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-3">
            {messages.length === 0 ? (
              <div className="text-center py-6 space-y-4">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Database className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-sm" data-testid="text-ask-questions-title">Ask Questions About Your Data</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ask natural language questions about your projects, bids, employees, and more.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground font-medium">Try asking:</p>
                  {EXAMPLE_QUESTIONS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleExampleClick(q)}
                      className="block w-full text-left text-xs px-3 py-2 rounded-md border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                      data-testid={`button-example-question-${i}`}
                    >
                      <HelpCircle className="h-3 w-3 inline mr-1.5 opacity-50" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${msg.role}-${i}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    <span className="text-[10px] opacity-60 mt-1 block">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {msg.role === "user" && (
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                        <User className="h-3.5 w-3.5 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            {askMutation.isPending && (
              <div className="flex gap-2 justify-start" data-testid="loading-indicator">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
                <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Analyzing your data...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>
        </ScrollArea>
      </div>

      <div className="border-t p-2 shrink-0">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data..."
            className="text-sm h-9"
            disabled={askMutation.isPending}
            maxLength={500}
            data-testid="input-ask-question"
          />
          {SpeechRecognitionAPI && (
            <Button
              size="sm"
              variant={isListening ? "default" : "outline"}
              className={`h-9 px-3 transition-colors ${isListening ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : ""}`}
              onClick={toggleVoiceInput}
              disabled={askMutation.isPending}
              data-testid="button-voice-input"
              title={isListening ? "Stop listening" : "Voice input"}
            >
              {isListening ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            size="sm"
            className="h-9 px-3"
            onClick={handleSend}
            disabled={!inputValue.trim() || askMutation.isPending}
            data-testid="button-send-question"
          >
            {askMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
