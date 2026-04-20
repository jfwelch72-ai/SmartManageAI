import { useCallback, useState } from "react";
import { Mail, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  SavedDistributionLists,
  SaveDistributionListDialog,
  type DistributionList,
} from "@/components/email/DistributionListPicker";

interface RecipientListFieldProps {
  projectId: string;
  emails: string[];
  onChange: (emails: string[]) => void;
  label?: string;
  helpText?: string;
  emptyHint?: string;
  testIdPrefix?: string;
  allowOrgScope?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dedupe(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const k = e.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e.trim());
  }
  return out;
}

export function RecipientListField({
  projectId,
  emails,
  onChange,
  label = "Recipient emails",
  helpText = "Add recipients to notify, or load a saved distribution list.",
  emptyHint = "No saved lists yet. Add recipients and click Save as list to create one.",
  testIdPrefix = "recipient-list",
  allowOrgScope = false,
}: RecipientListFieldProps) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);

  const addFromInput = useCallback(() => {
    const candidates = input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (candidates.length === 0) return;
    const invalid: string[] = [];
    const valid: string[] = [];
    for (const c of candidates) {
      if (EMAIL_RE.test(c)) valid.push(c);
      else invalid.push(c);
    }
    if (invalid.length > 0) {
      toast({
        title: "Invalid email",
        description: `Could not parse: ${invalid.join(", ")}`,
        variant: "destructive",
      });
    }
    if (valid.length > 0) {
      onChange(dedupe([...emails, ...valid]));
      setInput("");
    }
  }, [input, emails, onChange, toast]);

  const removeAt = useCallback(
    (idx: number) => {
      onChange(emails.filter((_, i) => i !== idx));
    },
    [emails, onChange],
  );

  const handleLoad = useCallback(
    (list: DistributionList) => {
      const merged = dedupe([...emails, ...list.contactEmails, ...list.extraEmails]);
      onChange(merged);
      toast({
        title: "List loaded",
        description: `Added recipients from "${list.name}".`,
      });
    },
    [emails, onChange, toast],
  );

  const collect = useCallback(() => {
    if (emails.length === 0) return null;
    return { contactEmails: [], extraEmails: emails };
  }, [emails]);

  return (
    <div className="space-y-2" data-testid={`section-${testIdPrefix}`}>
      <Label className="flex items-center gap-2">
        <Mail className="h-4 w-4" />
        {label}
      </Label>
      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}

      <SavedDistributionLists
        projectId={projectId}
        onLoad={handleLoad}
        emptyHint={emptyHint}
        testIdPrefix={testIdPrefix}
      />

      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="email@example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addFromInput();
            }
          }}
          data-testid={`input-${testIdPrefix}-email`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addFromInput}
          data-testid={`button-${testIdPrefix}-add`}
        >
          Add
        </Button>
      </div>

      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {emails.map((email, i) => (
            <Badge
              key={`${email}-${i}`}
              variant="secondary"
              className="gap-1"
              data-testid={`badge-${testIdPrefix}-${i}`}
            >
              {email}
              <button
                type="button"
                className="ml-1 hover:text-destructive"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${email}`}
                data-testid={`button-remove-${testIdPrefix}-${i}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {emails.length > 0 && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSaveOpen(true)}
            data-testid={`button-${testIdPrefix}-save`}
          >
            <Save className="h-4 w-4 mr-2" />
            Save as list
          </Button>
        </div>
      )}

      <SaveDistributionListDialog
        projectId={projectId}
        open={saveOpen}
        onOpenChange={setSaveOpen}
        collect={collect}
        allowOrgScope={allowOrgScope}
      />
    </div>
  );
}
