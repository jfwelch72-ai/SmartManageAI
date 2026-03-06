import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles } from "lucide-react";

interface AiContentGeneratorProps {
  platform: string;
  tone: string;
  onContentGenerated: (data: { content?: string; hashtags?: string[]; title?: string; bestTimeToPost?: string; engagementTips?: string }) => void;
}

export function SocialAiContentGenerator({ platform, tone, onContentGenerated }: AiContentGeneratorProps) {
  const { toast } = useToast();
  const [aiTopic, setAiTopic] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/social/posts/generate", {
        platform,
        topic: aiTopic,
        tone,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setAiResult(data);
      onContentGenerated(data);
      toast({ title: "AI content generated" });
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">AI Content Generator</span>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Enter a topic for AI to generate content..."
          value={aiTopic}
          onChange={e => setAiTopic(e.target.value)}
          data-testid="input-ai-topic"
        />
        <Button
          variant="outline"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || !aiTopic.trim()}
          data-testid="button-generate-ai"
        >
          {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        </Button>
      </div>
      {aiResult && (
        <div className="space-y-2 text-xs">
          {aiResult.bestTimeToPost && (
            <p><strong>Best time:</strong> {aiResult.bestTimeToPost}</p>
          )}
          {aiResult.engagementTips && (
            <p><strong>Tips:</strong> {aiResult.engagementTips}</p>
          )}
        </div>
      )}
    </div>
  );
}
