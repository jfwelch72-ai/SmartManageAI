import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import BrandingColorPicker, { type BrandingColors } from "@/components/branding-color-picker";
import { ImageUploadField } from "@/components/website-body-components";
import type { BodyComponent, FormFieldConfig, FaqItem } from "@/components/website-body-components";
import { Plus, Trash2, Palette, ChevronDown } from "lucide-react";

interface FormConfig {
  title: string;
  submitButtonText: string;
  fields: FormFieldConfig[];
  redirectUrl?: string;
  recipientEmail?: string;
  showLabels?: boolean;
  submitButtonStyle?: Record<string, string>;
  fieldStyle?: Record<string, string>;
}

interface FaqConfig {
  items: FaqItem[];
  title: string;
}

interface SafetyConfig {
  title: string;
  safetyPolicy: string;
  stats: { id: string; value: string; label: string }[];
  badges: { id: string; imageUrl: string; label: string }[];
}

interface BlogSectionConfig {
  title: string;
  source: "latest" | "category" | "tag" | "featured" | "popular";
  categoryFilter: string;
  tagFilter: string;
  sortOrder: "latest" | "popular" | "featured";
  layoutStyle: "grid" | "masonry" | "carousel";
  desktopItems: number;
  tabletItems: number;
  mobileItems: number;
  showExcerpt: boolean;
  showAuthor: boolean;
  showDate: boolean;
  showCategory: boolean;
  showCoverImage: boolean;
  readMoreText: string;
}

export function FormEditor({ comp, onChange, brandingColors }: { comp: BodyComponent & { type: "form" }; onChange: (c: FormConfig) => void; brandingColors?: BrandingColors }) {
  const addField = () => {
    const newField: FormFieldConfig = { id: `f-${Date.now()}`, label: "New Field", type: "text", placeholder: "", required: false };
    onChange({ ...comp.config, fields: [...comp.config.fields, newField] });
  };
  const removeField = (i: number) => onChange({ ...comp.config, fields: comp.config.fields.filter((_, idx) => idx !== i) });
  const updateField = (i: number, updates: Partial<FormFieldConfig>) => {
    const fields = [...comp.config.fields];
    fields[i] = { ...fields[i], ...updates };
    onChange({ ...comp.config, fields });
  };
  const updateSubmitStyle = (key: string, value: string) => {
    const current = comp.config.submitButtonStyle || {};
    onChange({ ...comp.config, submitButtonStyle: { ...current, [key]: value } });
  };
  const updateFieldStyle = (key: string, value: string) => {
    const current = comp.config.fieldStyle || {};
    onChange({ ...comp.config, fieldStyle: { ...current, [key]: value } });
  };
  const updateFieldItemStyle = (i: number, key: string, value: string) => {
    const fields = [...comp.config.fields];
    const currentStyle = fields[i].style || {};
    fields[i] = { ...fields[i], style: { ...currentStyle, [key]: value } };
    onChange({ ...comp.config, fields });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Form Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-form-title" />
      </div>
      <div>
        <Label className="text-xs">Submit Button Text</Label>
        <Input value={comp.config.submitButtonText} onChange={(e) => onChange({ ...comp.config, submitButtonText: e.target.value })} data-testid="input-form-submit" />
      </div>
      <div>
        <Label className="text-xs">Thank You Page URL</Label>
        <Input value={comp.config.redirectUrl || ""} onChange={(e) => onChange({ ...comp.config, redirectUrl: e.target.value })} placeholder="https://yoursite.com/thank-you" data-testid="input-form-redirect-url" />
      </div>
      <div>
        <Label className="text-xs">Recipient Email</Label>
        <Input 
          type="email"
          value={comp.config.recipientEmail || ""} 
          onChange={(e) => onChange({ ...comp.config, recipientEmail: e.target.value })} 
          placeholder="recipient@example.com" 
          data-testid="input-form-recipient-email" 
        />
        <p className="text-xs text-muted-foreground mt-1">Form submissions will be emailed to this address</p>
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">Show Field Labels</Label>
        <Switch
          checked={comp.config.showLabels !== false}
          onCheckedChange={(checked) => onChange({ ...comp.config, showLabels: checked })}
          data-testid="switch-form-show-labels"
        />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold w-full py-1" data-testid="trigger-submit-button-style">
          <Palette className="h-3 w-3" /> Submit Button Style <ChevronDown className="h-3 w-3 ml-auto" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div>
            <Label className="text-xs">Background Color</Label>
            <BrandingColorPicker value={comp.config.submitButtonStyle?.backgroundColor || ""} onChange={(v) => updateSubmitStyle("backgroundColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-submit-bg" />
          </div>
          <div>
            <Label className="text-xs">Text Color</Label>
            <BrandingColorPicker value={comp.config.submitButtonStyle?.textColor || ""} onChange={(v) => updateSubmitStyle("textColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-submit-text" />
          </div>
          <div>
            <Label className="text-xs">Border Color</Label>
            <BrandingColorPicker value={comp.config.submitButtonStyle?.borderColor || ""} onChange={(v) => updateSubmitStyle("borderColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-submit-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Border Width (px)</Label>
              <Input type="number" min={0} value={comp.config.submitButtonStyle?.borderWidth || ""} onChange={(e) => updateSubmitStyle("borderWidth", e.target.value)} data-testid="input-submit-border-width" />
            </div>
            <div>
              <Label className="text-xs">Border Radius (px)</Label>
              <Input type="number" min={0} value={comp.config.submitButtonStyle?.borderRadius || ""} onChange={(e) => updateSubmitStyle("borderRadius", e.target.value)} data-testid="input-submit-border-radius" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Font Size (px)</Label>
            <Input type="number" min={8} value={comp.config.submitButtonStyle?.fontSize || ""} onChange={(e) => updateSubmitStyle("fontSize", e.target.value)} data-testid="input-submit-font-size" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Padding X (px)</Label>
              <Input type="number" min={0} value={comp.config.submitButtonStyle?.paddingX || ""} onChange={(e) => updateSubmitStyle("paddingX", e.target.value)} data-testid="input-submit-padding-x" />
            </div>
            <div>
              <Label className="text-xs">Padding Y (px)</Label>
              <Input type="number" min={0} value={comp.config.submitButtonStyle?.paddingY || ""} onChange={(e) => updateSubmitStyle("paddingY", e.target.value)} data-testid="input-submit-padding-y" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Font Weight</Label>
            <Select value={comp.config.submitButtonStyle?.fontWeight || "600"} onValueChange={(v) => updateSubmitStyle("fontWeight", v)}>
              <SelectTrigger data-testid="select-submit-font-weight"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="400">400 (Normal)</SelectItem>
                <SelectItem value="500">500 (Medium)</SelectItem>
                <SelectItem value="600">600 (Semi Bold)</SelectItem>
                <SelectItem value="700">700 (Bold)</SelectItem>
                <SelectItem value="800">800 (Extra Bold)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Width</Label>
            <Select value={comp.config.submitButtonStyle?.width || "auto"} onValueChange={(v) => updateSubmitStyle("width", v)}>
              <SelectTrigger data-testid="select-submit-width"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="full">Full Width</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold w-full py-1" data-testid="trigger-field-style">
          <Palette className="h-3 w-3" /> Default Field Style <ChevronDown className="h-3 w-3 ml-auto" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div>
            <Label className="text-xs">Background Color</Label>
            <BrandingColorPicker value={comp.config.fieldStyle?.backgroundColor || ""} onChange={(v) => updateFieldStyle("backgroundColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-field-bg" />
          </div>
          <div>
            <Label className="text-xs">Text Color</Label>
            <BrandingColorPicker value={comp.config.fieldStyle?.textColor || ""} onChange={(v) => updateFieldStyle("textColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-field-text" />
          </div>
          <div>
            <Label className="text-xs">Border Color</Label>
            <BrandingColorPicker value={comp.config.fieldStyle?.borderColor || ""} onChange={(v) => updateFieldStyle("borderColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-field-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Border Radius (px)</Label>
              <Input type="number" min={0} value={comp.config.fieldStyle?.borderRadius || ""} onChange={(e) => updateFieldStyle("borderRadius", e.target.value)} data-testid="input-field-border-radius" />
            </div>
            <div>
              <Label className="text-xs">Font Size (px)</Label>
              <Input type="number" min={8} value={comp.config.fieldStyle?.fontSize || ""} onChange={(e) => updateFieldStyle("fontSize", e.target.value)} data-testid="input-field-font-size" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Label Color</Label>
            <BrandingColorPicker value={comp.config.fieldStyle?.labelColor || ""} onChange={(v) => updateFieldStyle("labelColor", v)} brandingColors={brandingColors} size="sm" data-testid="color-field-label" />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-2">
        <Label className="text-xs font-semibold">Form Fields</Label>
        {comp.config.fields.map((field, i) => (
          <div key={field.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Input value={field.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Label" className="flex-1 min-w-[100px]" data-testid={`input-field-label-${i}`} />
              <Select value={field.type} onValueChange={(v) => updateField(i, { type: v as FormFieldConfig["type"] })}>
                <SelectTrigger className="w-[120px]" data-testid={`select-field-type-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="subject">Subject</SelectItem>
                  <SelectItem value="textarea">Textarea</SelectItem>
                  <SelectItem value="select">Dropdown</SelectItem>
                  <SelectItem value="checkbox">Checkbox</SelectItem>
                  <SelectItem value="radio">Radio</SelectItem>
                  <SelectItem value="toggle">Toggle</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Switch checked={field.required} onCheckedChange={(v) => updateField(i, { required: v })} data-testid={`switch-field-req-${i}`} />
                <Label className="text-[10px]">Req</Label>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeField(i)} data-testid={`button-remove-field-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {field.type !== "checkbox" && field.type !== "toggle" && (
              <Input value={field.placeholder} onChange={(e) => updateField(i, { placeholder: e.target.value })} placeholder="Placeholder text" className="text-xs" data-testid={`input-field-placeholder-${i}`} />
            )}
            {(field.type === "select" || field.type === "radio") && (
              <div>
                <Label className="text-xs">Options (one per line)</Label>
                <Textarea
                  value={(field.options || []).join("\n")}
                  onChange={(e) => updateField(i, { options: e.target.value.split("\n") })}
                  placeholder={"Option 1\nOption 2\nOption 3"}
                  className="text-xs min-h-[60px]"
                  data-testid={`textarea-field-options-${i}`}
                />
              </div>
            )}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-[10px] font-medium w-full py-0.5 text-muted-foreground" data-testid={`trigger-field-style-override-${i}`}>
                <Palette className="h-3 w-3" /> Field Style Override <ChevronDown className="h-3 w-3 ml-auto" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-1">
                <div>
                  <Label className="text-xs">Background Color</Label>
                  <BrandingColorPicker value={field.style?.backgroundColor || ""} onChange={(v) => updateFieldItemStyle(i, "backgroundColor", v)} brandingColors={brandingColors} size="sm" data-testid={`color-field-item-bg-${i}`} />
                </div>
                <div>
                  <Label className="text-xs">Text Color</Label>
                  <BrandingColorPicker value={field.style?.textColor || ""} onChange={(v) => updateFieldItemStyle(i, "textColor", v)} brandingColors={brandingColors} size="sm" data-testid={`color-field-item-text-${i}`} />
                </div>
                <div>
                  <Label className="text-xs">Border Color</Label>
                  <BrandingColorPicker value={field.style?.borderColor || ""} onChange={(v) => updateFieldItemStyle(i, "borderColor", v)} brandingColors={brandingColors} size="sm" data-testid={`color-field-item-border-${i}`} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Border Radius (px)</Label>
                    <Input type="number" min={0} value={field.style?.borderRadius || ""} onChange={(e) => updateFieldItemStyle(i, "borderRadius", e.target.value)} data-testid={`input-field-item-border-radius-${i}`} />
                  </div>
                  <div>
                    <Label className="text-xs">Font Size (px)</Label>
                    <Input type="number" min={8} value={field.style?.fontSize || ""} onChange={(e) => updateFieldItemStyle(i, "fontSize", e.target.value)} data-testid={`input-field-item-font-size-${i}`} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Label Color</Label>
                  <BrandingColorPicker value={field.style?.labelColor || ""} onChange={(v) => updateFieldItemStyle(i, "labelColor", v)} brandingColors={brandingColors} size="sm" data-testid={`color-field-item-label-${i}`} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
          <Plus className="h-3 w-3 mr-1" /> Add Field
        </Button>
      </div>
    </div>
  );
}

export function FaqEditor({ comp, onChange }: { comp: BodyComponent & { type: "faq" }; onChange: (c: FaqConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `faq-${Date.now()}`, question: "New Question?", answer: "Answer here." }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_, idx) => idx !== i) });
  const updateItem = (i: number, updates: Partial<FaqItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-faq-title" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Questions & Answers</Label>
        {comp.config.items.map((item, i) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input value={item.question} onChange={(e) => updateItem(i, { question: e.target.value })} placeholder="Question" className="flex-1" data-testid={`input-faq-q-${i}`} />
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-faq-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Textarea value={item.answer} onChange={(e) => updateItem(i, { answer: e.target.value })} className="resize-none text-xs" rows={2} placeholder="Answer" data-testid={`input-faq-a-${i}`} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-faq">
          <Plus className="h-3 w-3 mr-1" /> Add Question
        </Button>
      </div>
    </div>
  );
}

export function SafetyEditor({ comp, onChange }: { comp: BodyComponent & { type: "safety" }; onChange: (c: SafetyConfig) => void }) {
  const addStat = () => onChange({ ...comp.config, stats: [...comp.config.stats, { id: `ss-${Date.now()}`, value: "0", label: "New Stat" }] });
  const removeStat = (i: number) => onChange({ ...comp.config, stats: comp.config.stats.filter((_, idx) => idx !== i) });
  const updateStat = (i: number, updates: Partial<SafetyConfig["stats"][0]>) => {
    const stats = [...comp.config.stats];
    stats[i] = { ...stats[i], ...updates };
    onChange({ ...comp.config, stats });
  };
  const addBadge = () => onChange({ ...comp.config, badges: [...comp.config.badges, { id: `sb-${Date.now()}`, imageUrl: "", label: "New Badge" }] });
  const removeBadge = (i: number) => onChange({ ...comp.config, badges: comp.config.badges.filter((_, idx) => idx !== i) });
  const updateBadge = (i: number, updates: Partial<SafetyConfig["badges"][0]>) => {
    const badges = [...comp.config.badges];
    badges[i] = { ...badges[i], ...updates };
    onChange({ ...comp.config, badges });
  };
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-safety-title" /></div>
      <div><Label className="text-xs">Safety Policy</Label><Textarea value={comp.config.safetyPolicy} onChange={(e) => onChange({ ...comp.config, safetyPolicy: e.target.value })} className="resize-none text-xs" rows={4} data-testid="input-safety-policy" /></div>
      <div className="space-y-2 pt-1 border-t">
        <Label className="text-xs font-semibold">Safety Stats</Label>
        {comp.config.stats.map((stat, i) => (
          <div key={stat.id} className="flex items-center gap-2">
            <Input value={stat.value} onChange={(e) => updateStat(i, { value: e.target.value })} placeholder="Value" className="w-20" data-testid={`input-safety-stat-val-${i}`} />
            <Input value={stat.label} onChange={(e) => updateStat(i, { label: e.target.value })} placeholder="Label" className="flex-1" data-testid={`input-safety-stat-label-${i}`} />
            <Button variant="ghost" size="icon" onClick={() => removeStat(i)} data-testid={`button-remove-safety-stat-${i}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addStat} data-testid="button-add-safety-stat"><Plus className="h-3 w-3 mr-1" /> Add Stat</Button>
      </div>
      <div className="space-y-2 pt-1 border-t">
        <Label className="text-xs font-semibold">Compliance Badges</Label>
        {comp.config.badges.map((badge, i) => (
          <div key={badge.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Badge {i + 1}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeBadge(i)} data-testid={`button-remove-safety-badge-${i}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <ImageUploadField value={badge.imageUrl} onChange={(url) => updateBadge(i, { imageUrl: url })} label="Badge Image" placeholder="Upload badge" testId={`input-safety-badge-img-${i}`} />
            <div><Label className="text-xs">Label</Label><Input value={badge.label} onChange={(e) => updateBadge(i, { label: e.target.value })} placeholder="Badge name" data-testid={`input-safety-badge-label-${i}`} /></div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addBadge} data-testid="button-add-safety-badge"><Plus className="h-3 w-3 mr-1" /> Add Badge</Button>
      </div>
    </div>
  );
}

export function BlogSectionEditor({ comp, onChange }: { comp: BodyComponent & { type: "blog_section" }; onChange: (c: BlogSectionConfig) => void }) {
  const cfg = comp.config;
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={cfg.title} onChange={(e) => onChange({ ...cfg, title: e.target.value })} data-testid="input-blog-section-title" /></div>
      <div><Label className="text-xs">Content Source</Label>
        <Select value={cfg.source} onValueChange={(v: BlogSectionConfig["source"]) => onChange({ ...cfg, source: v })}>
          <SelectTrigger data-testid="select-blog-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest Posts</SelectItem>
            <SelectItem value="featured">Featured Posts</SelectItem>
            <SelectItem value="popular">Popular Posts</SelectItem>
            <SelectItem value="category">By Category</SelectItem>
            <SelectItem value="tag">By Tag</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {cfg.source === "category" && (
        <div><Label className="text-xs">Category Filter</Label><Input value={cfg.categoryFilter} onChange={(e) => onChange({ ...cfg, categoryFilter: e.target.value })} placeholder="Enter category name" data-testid="input-blog-category" /></div>
      )}
      {cfg.source === "tag" && (
        <div><Label className="text-xs">Tag Filter</Label><Input value={cfg.tagFilter} onChange={(e) => onChange({ ...cfg, tagFilter: e.target.value })} placeholder="Enter tag name" data-testid="input-blog-tag" /></div>
      )}
      <div><Label className="text-xs">Sort Order</Label>
        <Select value={cfg.sortOrder} onValueChange={(v: BlogSectionConfig["sortOrder"]) => onChange({ ...cfg, sortOrder: v })}>
          <SelectTrigger data-testid="select-blog-sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Newest First</SelectItem>
            <SelectItem value="popular">Most Popular</SelectItem>
            <SelectItem value="featured">Featured First</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">Layout Style</Label>
        <Select value={cfg.layoutStyle} onValueChange={(v: BlogSectionConfig["layoutStyle"]) => onChange({ ...cfg, layoutStyle: v })}>
          <SelectTrigger data-testid="select-blog-layout"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="grid">Grid</SelectItem>
            <SelectItem value="masonry">Masonry</SelectItem>
            <SelectItem value="carousel">Carousel</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Desktop Items</Label><Input type="number" min={1} max={12} value={cfg.desktopItems} onChange={(e) => onChange({ ...cfg, desktopItems: parseInt(e.target.value) || 3 })} data-testid="input-blog-desktop" /></div>
        <div><Label className="text-xs">Tablet Items</Label><Input type="number" min={1} max={6} value={cfg.tabletItems} onChange={(e) => onChange({ ...cfg, tabletItems: parseInt(e.target.value) || 2 })} data-testid="input-blog-tablet" /></div>
        <div><Label className="text-xs">Mobile Items</Label><Input type="number" min={1} max={4} value={cfg.mobileItems} onChange={(e) => onChange({ ...cfg, mobileItems: parseInt(e.target.value) || 1 })} data-testid="input-blog-mobile" /></div>
      </div>
      <div className="space-y-2 pt-1 border-t">
        <Label className="text-xs font-semibold">Display Options</Label>
        <div className="flex items-center gap-2"><Switch checked={cfg.showCoverImage} onCheckedChange={(v) => onChange({ ...cfg, showCoverImage: v })} data-testid="switch-blog-cover" /><Label className="text-xs">Show Cover Image</Label></div>
        <div className="flex items-center gap-2"><Switch checked={cfg.showExcerpt} onCheckedChange={(v) => onChange({ ...cfg, showExcerpt: v })} data-testid="switch-blog-excerpt" /><Label className="text-xs">Show Excerpt</Label></div>
        <div className="flex items-center gap-2"><Switch checked={cfg.showAuthor} onCheckedChange={(v) => onChange({ ...cfg, showAuthor: v })} data-testid="switch-blog-author" /><Label className="text-xs">Show Author</Label></div>
        <div className="flex items-center gap-2"><Switch checked={cfg.showDate} onCheckedChange={(v) => onChange({ ...cfg, showDate: v })} data-testid="switch-blog-date" /><Label className="text-xs">Show Date</Label></div>
        <div className="flex items-center gap-2"><Switch checked={cfg.showCategory} onCheckedChange={(v) => onChange({ ...cfg, showCategory: v })} data-testid="switch-blog-category-toggle" /><Label className="text-xs">Show Category Badge</Label></div>
      </div>
      <div><Label className="text-xs">Read More Button Text</Label><Input value={cfg.readMoreText} onChange={(e) => onChange({ ...cfg, readMoreText: e.target.value })} placeholder="Read More" data-testid="input-blog-readmore" /></div>
    </div>
  );
}
