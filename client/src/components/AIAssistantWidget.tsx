import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Bot, X, Send, Loader2, Minimize2, Maximize2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const STORAGE_KEY = "tfr-ai-assistant-enabled";
const MINIMIZED_KEY = "tfr-ai-assistant-minimized";

export function AIAssistantWidget() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => {
    const stored = localStorage.getItem(MINIMIZED_KEY);
    return stored === "true";
  });
  const [isEnabled, setIsEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== "false"; // Default to enabled
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  // Save preferences
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isEnabled));
  }, [isEnabled]);

  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, String(isMinimized));
  }, [isMinimized]);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", "/api/ai/assistant/chat", {
        message,
        currentPath: location,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      }]);
    },
    onError: (error: any) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      }]);
    },
  });

  const handleSend = () => {
    const message = inputValue.trim();
    if (!message || chatMutation.isPending) return;

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

  const clearChat = () => {
    setMessages([]);
  };

  // Don't render if disabled or not logged in
  if (!isEnabled || !user) return null;

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover-elevate active-elevate-2 transition-all"
          data-testid="button-ai-assistant-open"
        >
          <Bot className="h-6 w-6" />
          <span className="sr-only">Open AI Assistant</span>
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div 
          className={`fixed bottom-6 right-6 z-50 bg-card border rounded-lg shadow-2xl transition-all ${
            isMinimized ? "w-72" : "w-96"
          }`}
          data-testid="ai-assistant-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b bg-muted/50 rounded-t-lg">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <span className="font-medium text-sm">TFR Assistant</span>
              <Badge variant="secondary" className="text-xs">AI</Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                onClick={() => setIsMinimized(!isMinimized)}
                data-testid="button-ai-assistant-minimize"
              >
                {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                onClick={() => setIsOpen(false)}
                data-testid="button-ai-assistant-close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages Area */}
              <ScrollArea className="h-80 p-3" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <Bot className="h-12 w-12 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium mb-1">Hi, I'm TFR Assistant!</p>
                    <p className="text-xs text-muted-foreground">
                      Ask me anything about using the TFR platform. I can help with projects, bids, delays, and more.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-3 justify-center">
                      {["How do I create a delay?", "What is a change order?", "Help with time clock"].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => {
                            setInputValue(suggestion);
                            inputRef.current?.focus();
                          }}
                          className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    ))}
                    {chatMutation.isPending && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-3 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              {/* Input Area */}
              <div className="p-3 border-t">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question..."
                    className="flex-1 text-sm"
                    disabled={chatMutation.isPending}
                    data-testid="input-ai-assistant-message"
                  />
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || chatMutation.isPending}
                    data-testid="button-ai-assistant-send"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                {messages.length > 0 && (
                  <div className="flex items-center justify-between mt-2">
                    <button
                      onClick={clearChat}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="button-ai-assistant-clear"
                    >
                      Clear chat
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Assistant</span>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={setIsEnabled}
                        className="scale-75"
                        data-testid="switch-ai-assistant-toggle"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {isMinimized && (
            <div className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Click to expand</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default AIAssistantWidget;
