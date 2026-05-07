import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextStyleEditor } from "../text-style-editor";
import { ImageUploadField } from "@/components/website-body-components";
import type { BrandingColors } from "@/components/branding-color-picker";
import type { BodyComponent, FeatureItem, StatItem } from "@/components/website-body-components";
import { Plus, Trash2 } from "lucide-react";

interface ContentConfig {
  content: string;
  contentStyle?: Record<string, string>;
  title: string;
  titleStyle?: Record<string, string>;
}

interface FeatureHighlightConfig {
  columns: number;
  items: FeatureItem[];
  title: string;
}

interface StatsConfig {
  columns: number;
  items: StatItem[];
  title: string;
}

interface AboutCompanyConfig {
  title: string;
  overview: string;
  yearsExperience: string;
  mission: string;
  vision: string;
  teamPhotoUrl: string;
}

export function ContentEditor({ comp, onChange, brandingColors }: { comp: BodyComponent & { type: "content" }; onChange: (c: ContentConfig) => void; brandingColors?: BrandingColors }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-content-title" />
        <TextStyleEditor
          content={comp.config.titleStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, titleStyle: { ...(comp.config.titleStyle || {}), ...updates } })}
          elementId={`content-title-${comp.id}`}
          defaultFontSize="32"
          defaultColor="#1f2937"
          brandingColors={brandingColors}
        />
      </div>
      <div>
        <Label className="text-xs">Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} rows={5} className="resize-none" data-testid="input-content-body" />
        <TextStyleEditor
          content={comp.config.contentStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, contentStyle: { ...(comp.config.contentStyle || {}), ...updates } })}
          elementId={`content-body-${comp.id}`}
          defaultFontSize="16"
          defaultColor="#4b5563"
          brandingColors={brandingColors}
        />
      </div>
    </div>
  );
}

export function FeatureHighlightEditor({ comp, onChange }: { comp: BodyComponent & { type: "feature_highlight" }; onChange: (c: FeatureHighlightConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `fh-${Date.now()}`, title: "Feature", description: "Description", icon: "star" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_: FeatureItem, idx: number) => idx !== i) });
  const updateItem = (i: number, updates: Partial<FeatureItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-feature-title" />
      </div>
      <div>
        <Label className="text-xs">Columns</Label>
        <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
          <SelectTrigger data-testid="select-feature-cols"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Features</Label>
        {comp.config.items.map((item: FeatureItem, i: number) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Input value={item.title} onChange={(e) => updateItem(i, { title: e.target.value })} placeholder="Title" className="flex-1 min-w-[100px]" data-testid={`input-feature-item-title-${i}`} />
              <Select value={item.icon} onValueChange={(v) => updateItem(i, { icon: v })}>
                <SelectTrigger className="w-[100px]" data-testid={`select-feature-icon-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["star", "zap", "shield", "heart", "check", "settings", "globe", "award", "headphones", "clock", "target", "layers"].map(ic => (
                    <SelectItem key={ic} value={ic}>{ic}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-feature-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Textarea value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} className="resize-none text-xs" rows={2} data-testid={`input-feature-desc-${i}`} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-feature">
          <Plus className="h-3 w-3 mr-1" /> Add Feature
        </Button>
      </div>
    </div>
  );
}

export function StatsEditor({ comp, onChange }: { comp: BodyComponent & { type: "stats" }; onChange: (c: StatsConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `s-${Date.now()}`, value: "0", label: "Metric", prefix: "", suffix: "" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_: StatItem, idx: number) => idx !== i) });
  const updateItem = (i: number, updates: Partial<StatItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-stats-title" />
      </div>
      <div>
        <Label className="text-xs">Columns</Label>
        <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
          <SelectTrigger data-testid="select-stats-cols"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Stats</Label>
        {comp.config.items.map((item: StatItem, i: number) => (
          <div key={item.id} className="border rounded-md p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Input value={item.prefix} onChange={(e) => updateItem(i, { prefix: e.target.value })} placeholder="Prefix" className="w-16" data-testid={`input-stat-prefix-${i}`} />
              <Input value={item.value} onChange={(e) => updateItem(i, { value: e.target.value })} placeholder="Value" className="w-20" data-testid={`input-stat-value-${i}`} />
              <Input value={item.suffix} onChange={(e) => updateItem(i, { suffix: e.target.value })} placeholder="Suffix" className="w-16" data-testid={`input-stat-suffix-${i}`} />
              <Input value={item.label} onChange={(e) => updateItem(i, { label: e.target.value })} placeholder="Label" className="flex-1 min-w-[80px]" data-testid={`input-stat-label-${i}`} />
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-stat-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-stat">
          <Plus className="h-3 w-3 mr-1" /> Add Stat
        </Button>
      </div>
    </div>
  );
}

export function AboutCompanyEditor({ comp, onChange }: { comp: BodyComponent & { type: "about_company" }; onChange: (c: AboutCompanyConfig) => void }) {
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-about-title" /></div>
      <div><Label className="text-xs">Company Overview</Label><Textarea value={comp.config.overview} onChange={(e) => onChange({ ...comp.config, overview: e.target.value })} className="resize-none text-xs" rows={4} data-testid="input-about-overview" /></div>
      <div><Label className="text-xs">Years of Experience</Label><Input value={comp.config.yearsExperience} onChange={(e) => onChange({ ...comp.config, yearsExperience: e.target.value })} placeholder="e.g. 25" data-testid="input-about-years" /></div>
      <div><Label className="text-xs">Mission Statement</Label><Textarea value={comp.config.mission} onChange={(e) => onChange({ ...comp.config, mission: e.target.value })} className="resize-none text-xs" rows={3} data-testid="input-about-mission" /></div>
      <div><Label className="text-xs">Vision Statement</Label><Textarea value={comp.config.vision} onChange={(e) => onChange({ ...comp.config, vision: e.target.value })} className="resize-none text-xs" rows={3} data-testid="input-about-vision" /></div>
      <ImageUploadField value={comp.config.teamPhotoUrl} onChange={(url) => onChange({ ...comp.config, teamPhotoUrl: url })} label="Team Photo" placeholder="Upload team photo" testId="input-about-photo" />
    </div>
  );
}
