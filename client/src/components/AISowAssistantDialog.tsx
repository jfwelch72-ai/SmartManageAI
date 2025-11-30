import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
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
import { Switch } from "@/components/ui/switch";
import { Sparkles, AlertCircle, CheckCircle, Loader2, ArrowRight, Tag, Hash, FileText, Ruler, Copy } from "lucide-react";

interface SuggestionResponse {
  success: boolean;
  suggestion: {
    categoryName: string;
    name: string;
    code: string;
    description: string;
    suggestedUom: string;
    requiresDimensions: boolean;
    dimensionLabel: string | null;
    confidence: number;
    reasoning: string;
  };
  similarItems: Array<{
    id: string;
    name: string;
    code: string;
    categoryName: string;
    unit?: string;
    similarity: number;
  }>;
  availableUoms: Array<{
    code: string;
    name: string;
    abbreviation: string;
  }>;
  existingCategories: string[];
}

interface AISowAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tradeType?: string;
  organizationId?: string;
  onItemAdded?: (item: any) => void;
}

export function AISowAssistantDialog({
  open,
  onOpenChange,
  tradeType,
  organizationId,
  onItemAdded,
}: AISowAssistantDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'input' | 'review' | 'confirm'>('input');
  const [userInput, setUserInput] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestionResponse['suggestion'] | null>(null);
  const [similarItems, setSimilarItems] = useState<SuggestionResponse['similarItems']>([]);
  const [availableUoms, setAvailableUoms] = useState<SuggestionResponse['availableUoms']>([]);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);

  const [editedItem, setEditedItem] = useState({
    categoryName: "",
    name: "",
    code: "",
    description: "",
    unit: "",
    requiresDimensions: false,
    dimensionLabel: "",
  });

  const suggestMutation = useMutation({
    mutationFn: async (input: string) => {
      const response = await apiRequest("POST", "/api/ai-assistant/sow/suggest", {
        userInput: input,
        tradeType,
        organizationId,
      });
      return response.json() as Promise<SuggestionResponse>;
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
      if (!suggestion.name || !suggestion.code) {
        toast({
          title: "Incomplete Suggestion",
          description: "The AI suggestion is missing required fields. Please try rephrasing your request.",
          variant: "destructive",
        });
        return;
      }

      setSuggestion(suggestion);
      setSimilarItems(data.similarItems || []);
      setAvailableUoms(data.availableUoms || []);
      setExistingCategories(data.existingCategories || []);

      setEditedItem({
        categoryName: suggestion.categoryName || "General",
        name: suggestion.name,
        code: suggestion.code,
        description: suggestion.description || "",
        unit: suggestion.suggestedUom || "",
        requiresDimensions: suggestion.requiresDimensions || false,
        dimensionLabel: suggestion.dimensionLabel || "",
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

  const addItemMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-assistant/sow/add", editedItem);
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Item Added",
        description: `"${editedItem.name}" has been added to your SOW items`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/organization-sow-items'] });
      onItemAdded?.(data.item);
      handleClose();
    },
    onError: (error: any) => {
      if (error.message?.includes("already exists")) {
        toast({
          title: "Duplicate Code",
          description: "An item with this code already exists. Please use a different code.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to Add Item",
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
    setSimilarItems([]);
    setEditedItem({
      categoryName: "",
      name: "",
      code: "",
      description: "",
      unit: "",
      requiresDimensions: false,
      dimensionLabel: "",
    });
    onOpenChange(false);
  };

  const handleSuggest = () => {
    if (!userInput.trim()) {
      toast({
        title: "Input Required",
        description: "Please describe the work item you want to add",
        variant: "destructive",
      });
      return;
    }
    suggestMutation.mutate(userInput);
  };

  const handleUseSimilar = (item: SuggestionResponse['similarItems'][0]) => {
    setEditedItem({
      categoryName: item.categoryName,
      name: item.name,
      code: item.code,
      description: "",
      unit: item.unit || "",
      requiresDimensions: false,
      dimensionLabel: "",
    });
    toast({
      title: "Existing Item Selected",
      description: "You can use this existing item or modify it as needed",
    });
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "text-green-600 dark:text-green-400";
    if (confidence >= 50) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-ai-sow-assistant">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI SOW Item Assistant
          </DialogTitle>
          <DialogDescription>
            Describe the work item in plain language and let AI help you format it properly
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-input">Describe the work item</Label>
              <Textarea
                id="user-input"
                placeholder="e.g., Install 4-inch PVC drain line under the slab, or Remove existing drywall from ceiling..."
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                className="min-h-[100px]"
                data-testid="input-sow-description"
              />
              <p className="text-sm text-muted-foreground">
                The AI will analyze your description and suggest proper formatting, category, code, and unit of measure
              </p>
            </div>

            <DialogFooter className="flex-row gap-2 justify-end">
              <Button
                variant="outline"
                onClick={handleClose}
                data-testid="button-cancel-sow"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSuggest}
                disabled={suggestMutation.isPending || !userInput.trim()}
                data-testid="button-get-suggestion"
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
            {similarItems.length > 0 && (
              <Card className="border-yellow-500/50 bg-yellow-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">Similar items found</p>
                      <p className="text-sm text-muted-foreground mb-2">
                        These existing items might match what you're looking for:
                      </p>
                      <div className="space-y-2">
                        {similarItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-2 rounded border bg-background"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{item.name}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="text-xs">{item.code}</Badge>
                                <span>{item.categoryName}</span>
                                {item.unit && <span>• {item.unit}</span>}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUseSimilar(item)}
                              data-testid={`button-use-similar-${item.id}`}
                            >
                              <Copy className="w-4 h-4 mr-1" />
                              Use
                            </Button>
                          </div>
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
              {suggestion.reasoning && (
                <p className="text-xs text-muted-foreground max-w-[300px] truncate" title={suggestion.reasoning}>
                  {suggestion.reasoning}
                </p>
              )}
            </div>

            <Separator />

            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category" className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    Category
                  </Label>
                  <Select
                    value={editedItem.categoryName}
                    onValueChange={(value) => setEditedItem({ ...editedItem, categoryName: value })}
                  >
                    <SelectTrigger id="category" data-testid="select-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {existingCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      <SelectItem value={editedItem.categoryName}>
                        {editedItem.categoryName} (new)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="code" className="flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    Code
                  </Label>
                  <Input
                    id="code"
                    value={editedItem.code}
                    onChange={(e) => setEditedItem({ ...editedItem, code: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                    placeholder="WORK_ITEM_CODE"
                    data-testid="input-code"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Name
                </Label>
                <Input
                  id="name"
                  value={editedItem.name}
                  onChange={(e) => setEditedItem({ ...editedItem, name: e.target.value })}
                  placeholder="Work item name"
                  data-testid="input-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={editedItem.description}
                  onChange={(e) => setEditedItem({ ...editedItem, description: e.target.value })}
                  placeholder="Brief description of the work"
                  rows={2}
                  data-testid="input-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unit" className="flex items-center gap-1">
                    <Ruler className="w-3 h-3" />
                    Unit of Measure
                  </Label>
                  <Select
                    value={editedItem.unit}
                    onValueChange={(value) => setEditedItem({ ...editedItem, unit: value })}
                  >
                    <SelectTrigger id="unit" data-testid="select-unit">
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableUoms.map((uom) => (
                        <SelectItem key={uom.code} value={uom.code}>
                          {uom.code} - {uom.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Switch
                      checked={editedItem.requiresDimensions}
                      onCheckedChange={(checked) => setEditedItem({ ...editedItem, requiresDimensions: checked })}
                      data-testid="switch-requires-dimensions"
                    />
                    Requires Dimensions
                  </Label>
                  {editedItem.requiresDimensions && (
                    <Input
                      value={editedItem.dimensionLabel}
                      onChange={(e) => setEditedItem({ ...editedItem, dimensionLabel: e.target.value })}
                      placeholder='e.g., "Area (SF)"'
                      data-testid="input-dimension-label"
                    />
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="flex-row gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setStep('input')}
                data-testid="button-back"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={!editedItem.name || !editedItem.code || !editedItem.categoryName}
                data-testid="button-review-add"
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
                  <span className="text-sm font-medium">Category</span>
                  <Badge variant="secondary">{editedItem.categoryName}</Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Code</span>
                  <Badge variant="outline" className="font-mono">{editedItem.code}</Badge>
                </div>
                <Separator />
                <div className="space-y-1">
                  <span className="text-sm font-medium">Name</span>
                  <p className="text-sm">{editedItem.name}</p>
                </div>
                {editedItem.description && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <span className="text-sm font-medium">Description</span>
                      <p className="text-sm text-muted-foreground">{editedItem.description}</p>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Unit of Measure</span>
                  <Badge>{editedItem.unit || "None"}</Badge>
                </div>
                {editedItem.requiresDimensions && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Dimension Label</span>
                      <span className="text-sm">{editedItem.dimensionLabel}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              <p className="text-sm">
                This item will be added to your organization's SOW library and can be used in future estimates.
              </p>
            </div>

            <DialogFooter className="flex-row gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setStep('review')}
                data-testid="button-back-confirm"
              >
                Back
              </Button>
              <Button
                onClick={() => addItemMutation.mutate()}
                disabled={addItemMutation.isPending}
                data-testid="button-confirm-add"
              >
                {addItemMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Add Item
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
