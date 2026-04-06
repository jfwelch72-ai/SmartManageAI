import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Loader2, Database, HelpCircle, User, Bot } from "lucide-react";
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

export function AskQuestionsContent({ compact }: { compact?: boolean }) {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
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
      const errorMessage = error?.message?.includes("429")
        ? "AI usage limit reached for today. Please try again tomorrow."
        : "Sorry, I had trouble processing that question. Please try again.";
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
