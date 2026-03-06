import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextStyleEditor } from "../text-style-editor";
import { ImageUploadField } from "@/components/website-body-components";
import { ButtonListEditor } from "./shared";
import type { BrandingColors } from "@/components/branding-color-picker";
import type { BodyComponent } from "@/components/website-body-components";

interface BannerConfig {
  title: string;
  titleStyle?: Record<string, string>;
  content: string;
  contentStyle?: Record<string, string>;
  buttons: { text: string; url: string; variant: "primary" | "secondary" | "outline"; style?: Record<string, string> }[];
  sideImageEnabled: boolean;
  sideImageUrl: string;
}

interface HeroConfig {
  title: string;
  titleStyle?: Record<string, string>;
  subtitle: string;
  content: string;
  subtitleStyle?: Record<string, string>;
  contentStyle?: Record<string, string>;
  imageEnabled: boolean;
  imageUrl: string;
  imagePosition: "top" | "left" | "bottom" | "right";
  buttons: { text: string; url: string; variant: "primary" | "secondary" | "outline"; style?: Record<string, string> }[];
}

interface CtaConfig {
  title: string;
  titleStyle?: Record<string, string>;
  content: string;
  contentStyle?: Record<string, string>;
  buttons: { text: string; url: string; variant: "primary" | "secondary" | "outline"; style?: Record<string, string> }[];
}

export function BannerEditor({ comp, onChange, brandingColors }: { comp: BodyComponent & { type: "banner" }; onChange: (c: BannerConfig) => void; brandingColors?: BrandingColors }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Banner Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-banner-title" />
        <TextStyleEditor
          content={comp.config.titleStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, titleStyle: { ...(comp.config.titleStyle || {}), ...updates } })}
          elementId={`banner-title-${comp.id}`}
          defaultFontSize="32"
          defaultColor="#1f2937"
          brandingColors={brandingColors}
        />
      </div>
      <div>
        <Label className="text-xs">Banner Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} className="resize-none" data-testid="input-banner-content" />
        <TextStyleEditor
          content={comp.config.contentStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, contentStyle: { ...(comp.config.contentStyle || {}), ...updates } })}
          elementId={`banner-content-${comp.id}`}
          defaultFontSize="16"
          defaultColor="#e5e7eb"
          brandingColors={brandingColors}
        />
      </div>
      <ButtonListEditor buttons={comp.config.buttons} onChange={(buttons) => onChange({ ...comp.config, buttons })} brandingColors={brandingColors} />
      <div className="flex items-center gap-3">
        <Switch checked={comp.config.sideImageEnabled} onCheckedChange={(v) => onChange({ ...comp.config, sideImageEnabled: v })} data-testid="switch-side-image" />
        <Label className="text-xs">Enable Side Image</Label>
      </div>
      {comp.config.sideImageEnabled && (
        <div>
          <ImageUploadField value={comp.config.sideImageUrl} onChange={(url) => onChange({ ...comp.config, sideImageUrl: url })} label="Side Image URL" testId="input-side-image" />
        </div>
      )}
    </div>
  );
}

export function HeroEditor({ comp, onChange, brandingColors }: { comp: BodyComponent & { type: "hero" }; onChange: (c: HeroConfig) => void; brandingColors?: BrandingColors }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Hero Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-hero-title" />
        <TextStyleEditor
          content={comp.config.titleStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, titleStyle: { ...(comp.config.titleStyle || {}), ...updates } })}
          elementId={`hero-title-${comp.id}`}
          defaultFontSize="44"
          defaultColor="#1f2937"
          brandingColors={brandingColors}
        />
      </div>
      <div>
        <Label className="text-xs">Subtitle</Label>
        <Input value={comp.config.subtitle} onChange={(e) => onChange({ ...comp.config, subtitle: e.target.value })} data-testid="input-hero-subtitle" />
        <TextStyleEditor
          content={comp.config.subtitleStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, subtitleStyle: { ...(comp.config.subtitleStyle || {}), ...updates } })}
          elementId={`hero-subtitle-${comp.id}`}
          defaultFontSize="24"
          defaultColor="#4b5563"
          brandingColors={brandingColors}
        />
      </div>
      <div>
        <Label className="text-xs">Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} className="resize-none" data-testid="input-hero-content" />
        <TextStyleEditor
          content={comp.config.contentStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, contentStyle: { ...(comp.config.contentStyle || {}), ...updates } })}
          elementId={`hero-content-${comp.id}`}
          defaultFontSize="18"
          defaultColor="#6b7280"
          brandingColors={brandingColors}
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={comp.config.imageEnabled} onCheckedChange={(v) => onChange({ ...comp.config, imageEnabled: v })} data-testid="switch-hero-image" />
        <Label className="text-xs">Enable Image</Label>
      </div>
      {comp.config.imageEnabled && (
        <>
          <div>
            <ImageUploadField value={comp.config.imageUrl} onChange={(url) => onChange({ ...comp.config, imageUrl: url })} label="Image URL" testId="input-hero-image" />
          </div>
          <div>
            <Label className="text-xs">Image Position</Label>
            <Select value={comp.config.imagePosition} onValueChange={(v) => onChange({ ...comp.config, imagePosition: v as HeroConfig["imagePosition"] })}>
              <SelectTrigger data-testid="select-hero-img-pos"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      <ButtonListEditor buttons={comp.config.buttons} onChange={(buttons) => onChange({ ...comp.config, buttons })} brandingColors={brandingColors} />
    </div>
  );
}

export function CtaEditor({ comp, onChange, brandingColors }: { comp: BodyComponent & { type: "cta" }; onChange: (c: CtaConfig) => void; brandingColors?: BrandingColors }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">CTA Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-cta-title" />
        <TextStyleEditor
          content={comp.config.titleStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, titleStyle: { ...(comp.config.titleStyle || {}), ...updates } })}
          elementId={`cta-title-${comp.id}`}
          defaultFontSize="36"
          defaultColor="#ffffff"
          brandingColors={brandingColors}
        />
      </div>
      <div>
        <Label className="text-xs">CTA Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} className="resize-none" data-testid="input-cta-content" />
        <TextStyleEditor
          content={comp.config.contentStyle || {}}
          onUpdate={(updates) => onChange({ ...comp.config, contentStyle: { ...(comp.config.contentStyle || {}), ...updates } })}
          elementId={`cta-content-${comp.id}`}
          defaultFontSize="18"
          defaultColor="#ffffff"
          brandingColors={brandingColors}
        />
      </div>
      <ButtonListEditor buttons={comp.config.buttons} onChange={(buttons) => onChange({ ...comp.config, buttons })} brandingColors={brandingColors} />
    </div>
  );
}
