import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUploadField } from "@/components/website-body-components";
import type { BodyComponent, GridItem } from "@/components/website-body-components";
import {
  Plus,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Heart,
  Shield,
  Zap,
  Target,
  Award,
  Briefcase,
  Clock,
  Globe,
  Home,
  Key,
  Layers,
  Lock,
  Mail,
  Map as MapIcon,
  Phone,
  Settings,
  ThumbsUp,
  Wrench,
  Truck,
  Users,
  CheckCircle,
  BarChart,
  Hammer,
  Star,
  type LucideIcon,
} from "lucide-react";

interface GalleryConfig {
  layout: "carousel" | "masonry" | "grid";
  columns: number;
  sourceFromGalleryTab: boolean;
  title: string;
}

interface EquipmentItem {
  id: string;
  imageUrl: string;
  model: string;
  description: string;
}

interface EquipmentConfig {
  title: string;
  columns: number;
  items: EquipmentItem[];
}

interface GridConfig {
  columns: number;
  items: GridItem[];
  title: string;
}

const GRID_ICON_OPTIONS = [
  "Star", "Heart", "Shield", "Zap", "Target", "Award", "Briefcase", "Clock",
  "Globe", "Home", "Key", "Layers", "Lock", "Mail", "Map", "Phone",
  "Settings", "ThumbsUp", "Tool", "Truck", "Users", "Wrench", "CheckCircle", "BarChart",
];

const GRID_ICON_MAP: Record<string, LucideIcon> = {
  Star, Heart, Shield, Zap, Target, Award, Briefcase, Clock,
  Globe, Home, Key, Layers, Lock, Mail, Map: MapIcon, Phone,
  Settings, ThumbsUp, Tool: Hammer, Truck, Users, Wrench, CheckCircle, BarChart,
};

function GridItemPreview({ item }: { item: GridItem }) {
  const align = item.alignment || "left";
  const textAlign = align as React.CSSProperties["textAlign"];
  const flexAlign = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  const IconComp = item.mediaType === "icon" && item.iconName ? GRID_ICON_MAP[item.iconName] : null;
  return (
    <div
      className="border rounded-md bg-muted/50 p-3"
      style={{ textAlign }}
      data-testid={`grid-item-preview-${item.id}`}
    >
      {item.mediaType === "icon" && IconComp && (
        <div style={{ display: "flex", justifyContent: flexAlign, marginBottom: "0.5rem" }}>
          <IconComp size={24} className="text-primary" />
        </div>
      )}
      {item.mediaType === "image" && item.imageUrl && (
        <div style={{ marginBottom: "0.5rem", overflow: "hidden", borderRadius: "0.25rem" }}>
          <img src={item.imageUrl} alt={item.title || ""} style={{ width: "100%", height: `${Math.min(item.imageHeight || 160, 100)}px`, objectFit: "cover" }} />
        </div>
      )}
      {item.title && <p className="text-xs font-semibold" style={{ marginBottom: "0.25rem" }}>{item.title}</p>}
      {item.content && <p className="text-[10px] text-muted-foreground leading-snug">{item.content}</p>}
      {item.buttonEnabled && (
        <div style={{ display: "flex", justifyContent: flexAlign, marginTop: "0.5rem" }}>
          <span className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium">
            {item.buttonText || "Learn More"}
          </span>
        </div>
      )}
    </div>
  );
}

export function GridEditor({ comp, onChange }: { comp: BodyComponent & { type: "grid" }; onChange: (c: GridConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `g-${Date.now()}`, title: "New Item", content: "Description", mediaType: "none", alignment: "left" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_, idx) => idx !== i) });
  const updateItem = (i: number, updates: Partial<GridItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-grid-title" />
      </div>
      <div>
        <Label className="text-xs">Columns</Label>
        <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
          <SelectTrigger data-testid="select-grid-cols"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Grid Items</Label>
        {comp.config.items.map((item, i) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Item {i + 1}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-grid-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <GridItemPreview item={item} />

            <div className="space-y-1">
              <Label className="text-xs">Content Alignment</Label>
              <div className="flex gap-1">
                {([
                  { value: "left" as const, icon: AlignLeft, label: "Left" },
                  { value: "center" as const, icon: AlignCenter, label: "Center" },
                  { value: "right" as const, icon: AlignRight, label: "Right" },
                ]).map(({ value, icon: Icon, label }) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={(item.alignment || "left") === value ? "default" : "outline"}
                    onClick={() => updateItem(i, { alignment: value })}
                    data-testid={`button-grid-align-${value}-${i}`}
                  >
                    <Icon className="h-3.5 w-3.5 mr-1" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Media</Label>
              <Select value={item.mediaType || "none"} onValueChange={(v) => updateItem(i, { mediaType: v as GridItem["mediaType"] })}>
                <SelectTrigger data-testid={`select-grid-media-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="icon">Icon</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {item.mediaType === "icon" && (
              <div className="space-y-1">
                <Label className="text-xs">Icon</Label>
                <Select value={item.iconName || ""} onValueChange={(v) => updateItem(i, { iconName: v })}>
                  <SelectTrigger data-testid={`select-grid-icon-${i}`}><SelectValue placeholder="Choose icon" /></SelectTrigger>
                  <SelectContent>
                    {GRID_ICON_OPTIONS.map(ic => (
                      <SelectItem key={ic} value={ic}>{ic}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {item.mediaType === "image" && (
              <div className="space-y-1">
                <ImageUploadField value={item.imageUrl || ""} onChange={(url) => updateItem(i, { imageUrl: url })} label="Image" testId={`input-grid-image-${i}`} />
                <div>
                  <Label className="text-xs">Image Height (px)</Label>
                  <Input type="number" min={40} max={600} value={item.imageHeight || 160} onChange={(e) => updateItem(i, { imageHeight: parseInt(e.target.value) || 160 })} data-testid={`input-grid-img-height-${i}`} />
                </div>
              </div>
            )}
            <Input value={item.title} onChange={(e) => updateItem(i, { title: e.target.value })} placeholder="Title" data-testid={`input-grid-item-title-${i}`} />
            <Textarea value={item.content} onChange={(e) => updateItem(i, { content: e.target.value })} placeholder="Content" className="resize-none text-xs" rows={2} data-testid={`input-grid-item-content-${i}`} />
            <div className="flex items-center gap-2">
              <Switch
                checked={!!item.buttonEnabled}
                onCheckedChange={(v) => updateItem(i, { buttonEnabled: v })}
                data-testid={`switch-grid-btn-${i}`}
              />
              <Label className="text-xs">Show Button</Label>
            </div>
            {item.buttonEnabled && (
              <div className="space-y-1 pl-2">
                <Input
                  value={item.buttonText || ""}
                  onChange={(e) => updateItem(i, { buttonText: e.target.value })}
                  placeholder="Button text"
                  data-testid={`input-grid-btn-text-${i}`}
                />
                <Input
                  value={item.buttonUrl || ""}
                  onChange={(e) => updateItem(i, { buttonUrl: e.target.value })}
                  placeholder="Button URL"
                  data-testid={`input-grid-btn-url-${i}`}
                />
                <Select value={item.buttonVariant || "primary"} onValueChange={(v) => updateItem(i, { buttonVariant: v as GridItem["buttonVariant"] })}>
                  <SelectTrigger data-testid={`select-grid-btn-variant-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary</SelectItem>
                    <SelectItem value="secondary">Secondary</SelectItem>
                    <SelectItem value="outline">Outline</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!item.buttonOpenNewTab}
                    onCheckedChange={(v) => updateItem(i, { buttonOpenNewTab: v })}
                    data-testid={`switch-grid-btn-newtab-${i}`}
                  />
                  <Label className="text-xs">Open in new tab</Label>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={!!item.itemClickable}
                onCheckedChange={(v) => updateItem(i, { itemClickable: v })}
                data-testid={`switch-grid-clickable-${i}`}
              />
              <Label className="text-xs">Make entire card clickable</Label>
            </div>
            {item.itemClickable && (
              <div className="space-y-1 pl-2">
                <Input
                  value={item.itemUrl || ""}
                  onChange={(e) => updateItem(i, { itemUrl: e.target.value })}
                  placeholder="Card link URL"
                  data-testid={`input-grid-item-url-${i}`}
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!item.itemOpenNewTab}
                    onCheckedChange={(v) => updateItem(i, { itemOpenNewTab: v })}
                    data-testid={`switch-grid-item-newtab-${i}`}
                  />
                  <Label className="text-xs">Open in new tab</Label>
                </div>
              </div>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-grid-item">
          <Plus className="h-3 w-3 mr-1" /> Add Item
        </Button>
      </div>
    </div>
  );
}

export function GalleryEditor({ comp, onChange }: { comp: BodyComponent & { type: "gallery" }; onChange: (c: GalleryConfig) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-gallery-title" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Layout</Label>
          <Select value={comp.config.layout} onValueChange={(v) => onChange({ ...comp.config, layout: v as GalleryConfig["layout"] })}>
            <SelectTrigger data-testid="select-gallery-layout"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="grid">Grid</SelectItem>
              <SelectItem value="masonry">Masonry</SelectItem>
              <SelectItem value="carousel">Carousel</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Columns</Label>
          <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
            <SelectTrigger data-testid="select-gallery-cols"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={comp.config.sourceFromGalleryTab} onCheckedChange={(v) => onChange({ ...comp.config, sourceFromGalleryTab: v })} data-testid="switch-gallery-source" />
        <Label className="text-xs">Fetch images from Galleries tab</Label>
      </div>
    </div>
  );
}

export function EquipmentEditor({ comp, onChange }: { comp: BodyComponent & { type: "equipment" }; onChange: (c: EquipmentConfig) => void }) {
  const addItem = () => onChange({ ...comp.config, items: [...comp.config.items, { id: `eq-${Date.now()}`, imageUrl: "", model: "New Equipment", description: "" }] });
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_, idx) => idx !== i) });
  const updateItem = (i: number, updates: Partial<EquipmentItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-equip-title" /></div>
      <div><Label className="text-xs">Columns</Label>
        <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
          <SelectTrigger data-testid="select-equip-cols"><SelectValue /></SelectTrigger>
          <SelectContent>{[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Equipment Items</Label>
        {comp.config.items.map((item, i) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Equipment {i + 1}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-equip-${i}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <ImageUploadField value={item.imageUrl} onChange={(url) => updateItem(i, { imageUrl: url })} label="Equipment Image" placeholder="Upload equipment photo" testId={`input-equip-image-${i}`} />
            <div><Label className="text-xs">Model / Name</Label><Input value={item.model} onChange={(e) => updateItem(i, { model: e.target.value })} placeholder="Equipment model" data-testid={`input-equip-model-${i}`} /></div>
            <div><Label className="text-xs">Description</Label><Textarea value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} className="resize-none text-xs" rows={2} data-testid={`input-equip-desc-${i}`} /></div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-equip"><Plus className="h-3 w-3 mr-1" /> Add Equipment</Button>
      </div>
    </div>
  );
}
