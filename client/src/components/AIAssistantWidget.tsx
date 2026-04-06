import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, X, Send, Loader2, Minimize, Maximize, Minimize2, Maximize2, Sparkles, EyeOff, Database, HelpCircle, Mic, MicOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  responseType?: "assistant" | "data";
}

const STORAGE_KEY = "smartmanage-ask-ai-enabled";
const MINIMIZED_KEY = "smartmanage-ask-ai-minimized";

const EXAMPLE_DATA_QUESTIONS = [
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

export function AIAssistantWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => {
    const stored = localStorage.getItem(MINIMIZED_KEY);
    return stored === "true";
  });
  const [isEnabled, setIsEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== "false";
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [messagingWidgetOpen, setMessagingWidgetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isEnabled));
  }, [isEnabled]);

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      setIsEnabled(stored !== "false");
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    const handleOpenAskAi = () => {
      setIsOpen(true);
      setIsMinimized(false);
    };
    window.addEventListener("open-ask-ai", handleOpenAskAi);
    return () => window.removeEventListener("open-ask-ai", handleOpenAskAi);
  }, []);

  useEffect(() => {
    const handleMessagingState = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      setMessagingWidgetOpen(!!detail?.isOpen);
    };
    window.addEventListener("messaging-widget-state", handleMessagingState);
    return () => window.removeEventListener("messaging-widget-state", handleMessagingState);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ask-ai-widget-state", { detail: { isOpen } }));
    return () => {
      window.dispatchEvent(new CustomEvent("ask-ai-widget-state", { detail: { isOpen: false } }));
    };
  }, [isOpen]);

  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, String(isMinimized));
  }, [isMinimized]);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", "/api/ai/ask-database", {
        question: message,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.answer || "I found some results but had trouble formatting the response.",
        timestamp: new Date(),
        responseType: "data",
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
    const message = inputValue.trim();
    if (!message || chatMutation.isPending) return;

    if (isListening) {
      stopListening();
    }

    setMessages(prev => [...prev, {
      role: "user",
      content: message,
      timestamp: new Date(),
    }]);
    setInputValue("");
    chatMutation.mutate(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!user) return null;
  if (!isEnabled) return null;

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="relative flex items-center justify-center w-12 h-12 rounded-full shadow-lg hover-elevate active-elevate-2 transition-all bg-primary text-primary-foreground"
          data-testid="button-ask-ai-open"
        >
          <Database className="h-5 w-5" />
          <span className="sr-only">Open Ask AI</span>
        </button>
      )}

      {isOpen && (
        <div 
          className={`bg-card border shadow-2xl transition-all duration-300 ease-in-out ${
            isFullscreen 
              ? "fixed inset-0 w-full h-full rounded-none flex flex-col" 
              : `rounded-lg ${isMinimized ? "w-64" : "w-80 sm:w-96"}`
          }`}
          style={isFullscreen ? { 
            zIndex: 9999,
          } : { 
            position: 'fixed', 
            bottom: '24px', 
            right: messagingWidgetOpen ? '590px' : '24px', 
            zIndex: 9999,
            maxWidth: messagingWidgetOpen ? 'calc(100vw - 620px)' : 'calc(100vw - 48px)',
            transition: 'right 0.3s ease'
          }}
          data-testid="ask-ai-panel"
        >
          <div className={`flex items-center justify-between p-3 border-b ${isFullscreen ? "" : "rounded-t-lg"} bg-muted/50`}>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10">
                <Database className="h-4 w-4 text-primary" />
              </div>
              <span className="font-medium text-sm">Ask AI</span>
              <Badge variant="secondary" className="text-xs">Data</Badge>
            </div>
            <div className="flex items-center gap-1">
              {!isFullscreen && (
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-7 w-7"
                  onClick={() => setIsMinimized(!isMinimized)}
                  title={isMinimized ? "Expand" : "Minimize"}
                  data-testid="button-ask-ai-minimize"
                >
                  {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                onClick={() => {
                  if (!isFullscreen) setIsMinimized(false);
                  setIsFullscreen(!isFullscreen);
                }}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                data-testid="button-ask-ai-fullscreen"
              >
                {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                onClick={() => {
                  setIsFullscreen(false);
                  setIsOpen(false);
                }}
                title="Close"
                data-testid="button-ask-ai-close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setIsEnabled(false);
                  setIsFullscreen(false);
                  setIsOpen(false);
                }}
                title="Hide Ask AI (re-enable in Settings)"
                data-testid="button-ask-ai-hide"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {!isMinimized && (
            <div className={isFullscreen ? "flex flex-col flex-1 min-h-0" : "flex flex-col"}>
              <div className="flex flex-col flex-1 overflow-hidden" data-testid="ask-ai-chat-content">
                <ScrollArea className={`${isFullscreen ? "flex-1" : "h-80"} p-3 ${isFullscreen ? "px-6" : ""}`} ref={scrollRef}>
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                      <Database className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium mb-1" data-testid="text-ask-ai-welcome">Ask me about your data</p>
                      <p className="text-xs text-muted-foreground">
                        Query your projects, bids, tasks, and more using natural language.
                      </p>
                      <div className="w-full mt-4 space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Example questions
                          </p>
                          <div className="space-y-1">
                            {EXAMPLE_DATA_QUESTIONS.map((q, i) => (
                              <button
                                key={i}
                                onClick={() => {
                                  setInputValue(q);
                                  inputRef.current?.focus();
                                }}
                                className="block w-full text-left text-xs px-3 py-1.5 rounded-md border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                                data-testid={`button-data-suggestion-${i}`}
                              >
                                <HelpCircle className="h-3 w-3 inline mr-1.5 opacity-50" />
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          data-testid={`message-${msg.role}-${idx}`}
                        >
                          {msg.role === "assistant" && (
                            <div className="flex-shrink-0 mt-0.5">
                              <div className={`h-6 w-6 rounded-full flex items-center justify-center ${msg.responseType === "data" ? "bg-blue-500/10" : "bg-primary/10"}`}>
                                {msg.responseType === "data" ? (
                                  <Database className="h-3.5 w-3.5 text-blue-500" />
                                ) : (
                                  <Bot className="h-3.5 w-3.5 text-primary" />
                                )}
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
                      ))}
                      {chatMutation.isPending && (
                        <div className="flex gap-2 justify-start" data-testid="loading-indicator">
                          <div className="flex-shrink-0 mt-0.5">
                            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                              <Database className="h-3.5 w-3.5 text-primary" />
                            </div>
                          </div>
                          <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Thinking...</span>
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={scrollEndRef} />
                    </div>
                  )}
                </ScrollArea>

                <div className={`p-3 border-t ${isFullscreen ? "px-6" : ""}`}>
                  <div className="flex gap-2">
                    <Input
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask about your data..."
                      className="flex-1 text-sm"
                      disabled={chatMutation.isPending}
                      maxLength={500}
                      data-testid="input-ask-ai-message"
                    />
                    {SpeechRecognitionAPI && (
                      <Button
                        size="sm"
                        variant={isListening ? "default" : "outline"}
                        onClick={toggleVoiceInput}
                        className={`px-2 ${isListening ? "bg-red-500 hover:bg-red-600 animate-pulse" : ""}`}
                        title={isListening ? "Stop listening" : "Voice input"}
                        data-testid="button-ask-ai-voice"
                      >
                        {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={handleSend}
                      disabled={!inputValue.trim() || chatMutation.isPending}
                      data-testid="button-ask-ai-send"
                    >
                      {chatMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default AIAssistantWidget;
