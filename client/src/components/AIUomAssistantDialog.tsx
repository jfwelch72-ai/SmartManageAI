import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, AlertCircle, CheckCircle, Loader2, ArrowRight, Ruler, Hash, FileText, Copy } from "lucide-react";

interface UomSuggestionResponse {
  success: boolean;
  suggestion: {
    code: string;
    name: string;
    abbreviation: string;
    category: string;
    description: string;
    confidence: number;
    reasoning: string;
  };
  similarUoms: Array<{
    id: string;
    code: string;
    name: string;
    abbreviation: string;
    category: string;
  }>;
  existingCategories: string[];
}

interface AIUomAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUomAdded?: (uom: any) => void;
}

export function AIUomAssistantDialog({
  open,
  onOpenChange,
  onUomAdded,
}: AIUomAssistantDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'input' | 'review' | 'confirm'>('input');
  const [userInput, setUserInput] = useState("");
  const [suggestion, setSuggestion] = useState<UomSuggestionResponse['suggestion'] | null>(null);
  const [similarUoms, setSimilarUoms] = useState<UomSuggestionResponse['similarUoms']>([]);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);

  const [editedUom, setEditedUom] = useState({
    code: "",
    name: "",
    abbreviation: "",
    category: "",
    description: "",
  });

  const suggestMutation = useMutation({
    mutationFn: async (input: string) => {
      const response = await apiRequest("POST", "/api/ai-assistant/uom/suggest", {
        userInput: input,
      });
      return response.json() as Promise<UomSuggestionResponse>;
    },
    onSuccess: (data) => {
      if (!data?.success || !data?.suggestion) {
        toast({
          title: "Invalid Response",
          description: "The AI did not return a valid suggestion. Please try again with more details.",
          variant: "destructive",
        });
        return;
      }

      const { suggestion } = data;
      if (!suggestion.code || !suggestion.name) {
        toast({
          title: "Incomplete Suggestion",
          description: "The AI suggestion is missing required fields. Please try rephrasing your request.",
          variant: "destructive",
        });
        return;
      }

      setSuggestion(suggestion);
      setSimilarUoms(data.similarUoms || []);
      setExistingCategories(data.existingCategories || []);

      setEditedUom({
        code: suggestion.code,
        name: suggestion.name,
        abbreviation: suggestion.abbreviation || "",
        category: suggestion.category || "quantity",
        description: suggestion.description || "",
      });

      setStep('review');
    },
    onError: (error: any) => {
      toast({
        title: "AI Suggestion Failed",
        description: error.message || "Failed to get AI suggestion. Please try again.",
        variant: "destructive",
      });
    },
  });

  const addUomMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-assistant/uom/add", editedUom);
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Unit Added",
        description: `"${editedUom.name}" (${editedUom.code}) has been added`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-assistant/uom/list'] });
      onUomAdded?.(data.uom);
      handleClose();
    },
    onError: (error: any) => {
      if (error.message?.includes("already exists")) {
        toast({
          title: "Duplicate Code",
          description: "A unit with this code already exists. Please use a different code.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to Add Unit",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    },
  });

  const handleClose = () => {
    setStep('input');
    setUserInput("");
    setSuggestion(null);
    setSimilarUoms([]);
    setEditedUom({
      code: "",
      name: "",
      abbreviation: "",
      category: "",
      description: "",
    });
    onOpenChange(false);
  };

  const handleSuggest = () => {
    if (!userInput.trim()) {
      toast({
        title: "Input Required",
        description: "Please describe the unit of measure you want to add",
        variant: "destructive",
      });
      return;
    }
    suggestMutation.mutate(userInput);
  };

  const handleUseSimilar = (uom: UomSuggestionResponse['similarUoms'][0]) => {
    toast({
      title: "Existing Unit Found",
      description: `"${uom.name}" (${uom.code}) already exists. Consider using it instead.`,
    });
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "text-green-600 dark:text-green-400";
    if (confidence >= 50) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-ai-uom-assistant">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI Unit of Measure Assistant
          </DialogTitle>
          <DialogDescription>
            Describe the unit you need and let AI help you format it properly
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="uom-input">Describe the unit of measure</Label>
              <Input
                id="uom-input"
                placeholder="e.g., bundles, sheets, panels, sacks..."
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                data-testid="input-uom-description"
              />
              <p className="text-sm text-muted-foreground">
                The AI will suggest proper code, abbreviation, and category
              </p>
            </div>

            <DialogFooter className="flex-row gap-2 justify-end">
              <Button
                variant="outline"
                onClick={handleClose}
                data-testid="button-cancel-uom"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSuggest}
                disabled={suggestMutation.isPending || !userInput.trim()}
                data-testid="button-get-uom-suggestion"
              >
                {suggestMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Get AI Suggestion
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'review' && suggestion && (
          <div className="space-y-4">
            {similarUoms.length > 0 && (
              <Card className="border-yellow-500/50 bg-yellow-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">Similar units exist</p>
                      <p className="text-sm text-muted-foreground mb-2">
                        Consider using one of these existing units:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {similarUoms.map((uom) => (
                          <Button
                            key={uom.id}
                            variant="outline"
                            size="sm"
                            onClick={() => handleUseSimilar(uom)}
                            data-testid={`button-use-existing-${uom.code}`}
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            {uom.code} ({uom.abbreviation})
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <Badge variant="outline" className="gap-1">
                <CheckCircle className={`w-3 h-3 ${getConfidenceColor(suggestion.confidence)}`} />
                <span className={getConfidenceColor(suggestion.confidence)}>
                  {suggestion.confidence}% confidence
                </span>
              </Badge>
            </div>

            {suggestion.reasoning && (
              <p className="text-sm text-muted-foreground italic">
                {suggestion.reasoning}
              </p>
            )}

            <Separator />

            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="uom-code" className="flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    Code
                  </Label>
                  <Input
                    id="uom-code"
                    value={editedUom.code}
                    onChange={(e) => setEditedUom({ ...editedUom, code: e.target.value.toUpperCase() })}
                    placeholder="SF, LF, EA..."
                    maxLength={10}
                    data-testid="input-uom-code"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="uom-abbreviation">Abbreviation</Label>
                  <Input
                    id="uom-abbreviation"
                    value={editedUom.abbreviation}
                    onChange={(e) => setEditedUom({ ...editedUom, abbreviation: e.target.value.toLowerCase() })}
                    placeholder="sq ft, lin ft..."
                    data-testid="input-uom-abbreviation"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="uom-name" className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Full Name
                </Label>
                <Input
                  id="uom-name"
                  value={editedUom.name}
                  onChange={(e) => setEditedUom({ ...editedUom, name: e.target.value })}
                  placeholder="Square Foot"
                  data-testid="input-uom-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="uom-category" className="flex items-center gap-1">
                  <Ruler className="w-3 h-3" />
                  Category
                </Label>
                <Select
                  value={editedUom.category}
                  onValueChange={(value) => setEditedUom({ ...editedUom, category: value })}
                >
                  <SelectTrigger id="uom-category" data-testid="select-uom-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingCategories.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="uom-description">Description (optional)</Label>
                <Input
                  id="uom-description"
                  value={editedUom.description}
                  onChange={(e) => setEditedUom({ ...editedUom, description: e.target.value })}
                  placeholder="Brief description"
                  data-testid="input-uom-description-field"
                />
              </div>
            </div>

            <DialogFooter className="flex-row gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setStep('input')}
                data-testid="button-back-uom"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={!editedUom.code || !editedUom.name || !editedUom.abbreviation || !editedUom.category}
                data-testid="button-review-add-uom"
              >
                Review & Add
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Code</span>
                  <Badge variant="outline" className="font-mono">{editedUom.code}</Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Full Name</span>
                  <span className="text-sm">{editedUom.name}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Abbreviation</span>
                  <Badge variant="secondary">{editedUom.abbreviation}</Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Category</span>
                  <Badge>{editedUom.category}</Badge>
                </div>
                {editedUom.description && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Description</span>
                      <span className="text-sm text-muted-foreground">{editedUom.description}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              <p className="text-sm">
                This unit will be added to the platform and available for all estimates.
              </p>
            </div>

            <DialogFooter className="flex-row gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setStep('review')}
                data-testid="button-back-confirm-uom"
              >
                Back
              </Button>
              <Button
                onClick={() => addUomMutation.mutate()}
                disabled={addUomMutation.isPending}
                data-testid="button-confirm-add-uom"
              >
                {addUomMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Add Unit
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
