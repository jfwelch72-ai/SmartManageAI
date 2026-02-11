import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MediaLibraryPicker } from "@/components/media-library";
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
  Image as ImageIcon,
  Video,
  Palette,
  Type,
  LayoutGrid,
  MessageSquare,
  Star,
  BarChart3,
  HelpCircle,
  MousePointer,
  FileText,
  Columns,
  Sparkles,
  Copy,
  Upload,
  Loader2,
  FolderOpen,
  HardDrive,
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
  Map,
  Phone,
  Settings,
  ThumbsUp,
  Wrench,
  Truck,
  Users,
  CheckCircle,
  BarChart,
  Hammer,
  type LucideIcon,
} from "lucide-react";

export type BodyComponentType =
  | "banner"
  | "hero"
  | "content"
  | "form"
  | "grid"
  | "cta"
  | "testimonial"
  | "feature_highlight"
  | "gallery"
  | "stats"
  | "faq";

export interface TypographyStyles {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  lineHeight: string;
}

export interface SpacingStyles {
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  marginTop: string;
  marginBottom: string;
}

export interface BackgroundOverlay {
  enabled: boolean;
  type: "color" | "gradient" | "image";
  color: string;
  opacity: number;
  gradientFrom: string;
  gradientTo: string;
  gradientDirection: string;
  imageUrl: string;
}

export interface BackgroundStyles {
  type: "none" | "solid" | "gradient" | "image" | "video";
  color: string;
  gradientFrom: string;
  gradientTo: string;
  gradientDirection: string;
  imageUrl: string;
  videoUrl: string;
  imagePosition: string;
  imageSize: string;
  imageAttachment: string;
  imageRepeat: string;
  overlay?: BackgroundOverlay;
}

export interface SharedStyles {
  typography: TypographyStyles;
  spacing: SpacingStyles;
  background: BackgroundStyles;
  alignment: "left" | "center" | "right";
}

export interface ButtonConfig {
  text: string;
  url: string;
  variant: "primary" | "secondary" | "outline";
}

export interface FormFieldConfig {
  id: string;
  label: string;
  type: "text" | "email" | "textarea" | "select" | "phone" | "number";
  placeholder: string;
  required: boolean;
}

export interface TestimonialItem {
  id: string;
  name: string;
  role: string;
  quote: string;
  imageEnabled: boolean;
  imageUrl: string;
}

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface StatItem {
  id: string;
  value: string;
  label: string;
  prefix: string;
  suffix: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface GridItem {
  id: string;
  title: string;
  content: string;
  alignment?: "left" | "center" | "right";
  mediaType?: "none" | "icon" | "image";
  iconName?: string;
  imageUrl?: string;
  imageHeight?: number;
  buttonEnabled?: boolean;
  buttonText?: string;
  buttonUrl?: string;
  buttonVariant?: "primary" | "secondary" | "outline";
  buttonOpenNewTab?: boolean;
  itemClickable?: boolean;
  itemUrl?: string;
  itemOpenNewTab?: boolean;
}

interface BannerConfig {
  title: string;
  content: string;
  buttons: ButtonConfig[];
  sideImageEnabled: boolean;
  sideImageUrl: string;
}

interface HeroConfig {
  title: string;
  subtitle: string;
  content: string;
  imageEnabled: boolean;
  imageUrl: string;
  imagePosition: "top" | "left" | "bottom" | "right";
  buttons: ButtonConfig[];
}

interface ContentConfig {
  content: string;
  title: string;
}

interface FormConfig {
  title: string;
  submitButtonText: string;
  fields: FormFieldConfig[];
}

interface GridConfig {
  columns: number;
  items: GridItem[];
  title: string;
}

interface CtaConfig {
  title: string;
  content: string;
  buttons: ButtonConfig[];
}

interface TestimonialConfig {
  layout: "carousel" | "grid";
  columns: number;
  items: TestimonialItem[];
  title: string;
}

interface FeatureHighlightConfig {
  columns: number;
  items: FeatureItem[];
  title: string;
}

interface GalleryConfig {
  layout: "carousel" | "masonry" | "grid";
  columns: number;
  sourceFromGalleryTab: boolean;
  title: string;
}

interface StatsConfig {
  columns: number;
  items: StatItem[];
  title: string;
}

interface FaqConfig {
  items: FaqItem[];
  title: string;
}

type ComponentConfig =
  | { type: "banner"; config: BannerConfig }
  | { type: "hero"; config: HeroConfig }
  | { type: "content"; config: ContentConfig }
  | { type: "form"; config: FormConfig }
  | { type: "grid"; config: GridConfig }
  | { type: "cta"; config: CtaConfig }
  | { type: "testimonial"; config: TestimonialConfig }
  | { type: "feature_highlight"; config: FeatureHighlightConfig }
  | { type: "gallery"; config: GalleryConfig }
  | { type: "stats"; config: StatsConfig }
  | { type: "faq"; config: FaqConfig };

export type BodyComponent = {
  id: string;
  label: string;
  enabled: boolean;
  visibleDesktop: boolean;
  visibleMobile: boolean;
  order: number;
  styles: SharedStyles;
  customClass?: string;
} & ComponentConfig;

export interface BodyComponentsConfig {
  components: BodyComponent[];
}

const DEFAULT_TYPOGRAPHY: TypographyStyles = {
  fontFamily: "inherit",
  fontSize: "base",
  fontWeight: "normal",
  color: "",
  lineHeight: "normal",
};

const DEFAULT_SPACING: SpacingStyles = {
  paddingTop: "8",
  paddingBottom: "8",
  paddingLeft: "4",
  paddingRight: "4",
  marginTop: "0",
  marginBottom: "0",
};

const DEFAULT_BACKGROUND: BackgroundStyles = {
  type: "none",
  color: "",
  gradientFrom: "",
  gradientTo: "",
  gradientDirection: "to-b",
  imageUrl: "",
  videoUrl: "",
  imagePosition: "center",
  imageSize: "cover",
  imageAttachment: "scroll",
  imageRepeat: "no-repeat",
};

const DEFAULT_STYLES: SharedStyles = {
  typography: { ...DEFAULT_TYPOGRAPHY },
  spacing: { ...DEFAULT_SPACING },
  background: { ...DEFAULT_BACKGROUND },
  alignment: "center",
};

export const COMPONENT_TYPE_META: Record<BodyComponentType, { label: string; icon: typeof ImageIcon; description: string }> = {
  banner: { label: "Banner Section", icon: ImageIcon, description: "Full-width banner with background options" },
  hero: { label: "Hero Section", icon: Sparkles, description: "Hero area with image positioning" },
  content: { label: "Content Section", icon: FileText, description: "Rich text content area" },
  form: { label: "Form", icon: MessageSquare, description: "Contact or custom form" },
  grid: { label: "Grid & Layout", icon: LayoutGrid, description: "Configurable column grid" },
  cta: { label: "Call to Action", icon: MousePointer, description: "CTA with buttons and background" },
  testimonial: { label: "Testimonials", icon: Star, description: "Customer testimonials carousel or grid" },
  feature_highlight: { label: "Feature Highlights", icon: Columns, description: "Highlighted features with icons" },
  gallery: { label: "Gallery", icon: ImageIcon, description: "Image gallery from Galleries tab" },
  stats: { label: "Stats / KPIs", icon: BarChart3, description: "Numeric stats and metrics" },
  faq: { label: "FAQ Section", icon: HelpCircle, description: "Accordion Q&A section" },
};

export function createDefaultComponent(type: BodyComponentType, order: number): BodyComponent {
  const id = `body-${type}-${Date.now()}`;
  const meta = COMPONENT_TYPE_META[type];
  const base = {
    id,
    label: meta.label,
    enabled: true,
    visibleDesktop: true,
    visibleMobile: true,
    order,
    styles: JSON.parse(JSON.stringify(DEFAULT_STYLES)) as SharedStyles,
  };

  switch (type) {
    case "banner":
      return { ...base, type, config: { title: "Welcome to Our Site", content: "Your success starts here.", buttons: [{ text: "Learn More", url: "#", variant: "primary" }], sideImageEnabled: false, sideImageUrl: "" } };
    case "hero":
      return { ...base, type, config: { title: "Hero Title", subtitle: "Subtitle text", content: "Hero description content.", imageEnabled: true, imageUrl: "", imagePosition: "right", buttons: [{ text: "Get Started", url: "#", variant: "primary" }] } };
    case "content":
      return { ...base, type, config: { title: "Section Title", content: "Add your content here. This section supports rich text editing." } };
    case "form":
      return { ...base, type, config: { title: "Contact Us", submitButtonText: "Submit", fields: [{ id: "f1", label: "Name", type: "text", placeholder: "Your name", required: true }, { id: "f2", label: "Email", type: "email", placeholder: "your@email.com", required: true }, { id: "f3", label: "Message", type: "textarea", placeholder: "Your message...", required: false }] } };
    case "grid":
      return { ...base, type, config: { columns: 3, title: "Our Services", items: [{ id: "g1", title: "Service 1", content: "Description" }, { id: "g2", title: "Service 2", content: "Description" }, { id: "g3", title: "Service 3", content: "Description" }] } };
    case "cta":
      return { ...base, type, config: { title: "Ready to Get Started?", content: "Join thousands of satisfied customers.", buttons: [{ text: "Start Now", url: "#", variant: "primary" }, { text: "Learn More", url: "#", variant: "outline" }] } };
    case "testimonial":
      return { ...base, type, config: { layout: "grid", columns: 3, title: "What Our Clients Say", items: [{ id: "t1", name: "John D.", role: "CEO", quote: "Excellent service!", imageEnabled: false, imageUrl: "" }] } };
    case "feature_highlight":
      return { ...base, type, config: { columns: 3, title: "Why Choose Us", items: [{ id: "fh1", title: "Quality", description: "Built to last", icon: "star" }, { id: "fh2", title: "Speed", description: "Fast delivery", icon: "zap" }, { id: "fh3", title: "Support", description: "24/7 assistance", icon: "headphones" }] } };
    case "gallery":
      return { ...base, type, config: { layout: "grid", columns: 3, sourceFromGalleryTab: true, title: "Our Work" } };
    case "stats":
      return { ...base, type, config: { columns: 4, title: "By the Numbers", items: [{ id: "s1", value: "500", label: "Projects", prefix: "", suffix: "+" }, { id: "s2", value: "98", label: "Satisfaction", prefix: "", suffix: "%" }, { id: "s3", value: "50", label: "Team Members", prefix: "", suffix: "" }, { id: "s4", value: "10", label: "Years", prefix: "", suffix: "+" }] } };
    case "faq":
      return { ...base, type, config: { title: "Frequently Asked Questions", items: [{ id: "faq1", question: "What services do you offer?", answer: "We offer a wide range of construction services." }, { id: "faq2", question: "How can I get a quote?", answer: "Contact us through our form or call us directly." }] } };
  }
}

export function getDefaultBodyConfig(): BodyComponentsConfig {
  return { components: [] };
}

export function ImageUploadField({ value, onChange, label, placeholder, testId }: { value: string; onChange: (url: string) => void; label?: string; placeholder?: string; testId?: string }) {
  const [uploading, setUploading] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 10MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/website/upload-image", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      onChange(data.url);
      toast({ title: "Image uploaded", description: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [onChange, toast]);

  const handleUploadClick = () => {
    setShowSourcePicker(true);
  };

  const handleChooseLocal = () => {
    setShowSourcePicker(false);
    fileRef.current?.click();
  };

  const handleChooseMediaLibrary = () => {
    setShowSourcePicker(false);
    setShowMediaLibrary(true);
  };

  return (
    <div>
      {label && <Label className="text-xs">{label}</Label>}
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "https://..."}
          data-testid={testId}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) { handleUpload(e.target.files[0]); e.target.value = ""; } }}
          data-testid={testId ? `${testId}-file` : undefined}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleUploadClick}
          disabled={uploading}
          data-testid={testId ? `${testId}-upload` : undefined}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        </Button>
      </div>
      {value && (
        <div className="mt-1.5 rounded-md border overflow-hidden">
          <img src={value} alt="Preview" className="w-full h-20 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}

      <Dialog open={showSourcePicker} onOpenChange={setShowSourcePicker}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose Image Source</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-md border hover-elevate cursor-pointer"
              onClick={handleChooseMediaLibrary}
              data-testid="button-source-media-library"
            >
              <HardDrive className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Media Library</span>
              <span className="text-xs text-muted-foreground text-center">Choose from uploaded files</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-md border hover-elevate cursor-pointer"
              onClick={handleChooseLocal}
              data-testid="button-source-local-file"
            >
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Local File</span>
              <span className="text-xs text-muted-foreground text-center">Upload from your device</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showMediaLibrary} onOpenChange={setShowMediaLibrary}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select from Media Library</DialogTitle>
          </DialogHeader>
          <MediaLibraryPicker
            onSelect={(url) => { onChange(url); }}
            onClose={() => setShowMediaLibrary(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function VideoUploadField({ value, onChange, label, placeholder, testId }: { value: string; onChange: (url: string) => void; label?: string; placeholder?: string; testId?: string }) {
  const [uploading, setUploading] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast({ title: "Invalid file", description: "Please select a video file.", variant: "destructive" });
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 100MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/website/upload-image", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      onChange(data.url);
      toast({ title: "Video uploaded", description: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [onChange, toast]);

  const handleUploadClick = () => {
    setShowSourcePicker(true);
  };

  const handleChooseLocal = () => {
    setShowSourcePicker(false);
    fileRef.current?.click();
  };

  const handleChooseMediaLibrary = () => {
    setShowSourcePicker(false);
    setShowMediaLibrary(true);
  };

  return (
    <div>
      {label && <Label className="text-xs">{label}</Label>}
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "https://..."}
          data-testid={testId}
        />
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) { handleUpload(e.target.files[0]); e.target.value = ""; } }}
          data-testid={testId ? `${testId}-file` : undefined}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleUploadClick}
          disabled={uploading}
          data-testid={testId ? `${testId}-upload` : undefined}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        </Button>
      </div>
      {value && (
        <div className="mt-1.5 rounded-md border overflow-hidden">
          <video src={value} className="w-full h-20 object-cover" muted onError={(e) => { (e.target as HTMLVideoElement).style.display = "none"; }} />
        </div>
      )}

      <Dialog open={showSourcePicker} onOpenChange={setShowSourcePicker}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose Video Source</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-md border hover-elevate cursor-pointer"
              onClick={handleChooseMediaLibrary}
              data-testid="button-video-source-media-library"
            >
              <HardDrive className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Media Library</span>
              <span className="text-xs text-muted-foreground text-center">Choose from uploaded files</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-md border hover-elevate cursor-pointer"
              onClick={handleChooseLocal}
              data-testid="button-video-source-local-file"
            >
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Local File</span>
              <span className="text-xs text-muted-foreground text-center">Upload from your device</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showMediaLibrary} onOpenChange={setShowMediaLibrary}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select from Media Library</DialogTitle>
          </DialogHeader>
          <MediaLibraryPicker
            onSelect={(url) => { onChange(url); }}
            onClose={() => setShowMediaLibrary(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StyleEditor({ styles, onChange }: { styles: SharedStyles; onChange: (s: SharedStyles) => void }) {
  const updateTypography = (key: keyof TypographyStyles, value: string) => {
    onChange({ ...styles, typography: { ...styles.typography, [key]: value } });
  };
  const updateSpacing = (key: keyof SpacingStyles, value: string) => {
    onChange({ ...styles, spacing: { ...styles.spacing, [key]: value } });
  };
  const updateBackground = (key: keyof BackgroundStyles, value: string) => {
    onChange({ ...styles, background: { ...styles.background, [key]: value } });
  };

  return (
    <div className="space-y-4 border-t pt-3 mt-3">
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Typography</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Font Family</Label>
            <Select value={styles.typography.fontFamily} onValueChange={(v) => updateTypography("fontFamily", v)}>
              <SelectTrigger data-testid="select-font-family"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit</SelectItem>
                <SelectItem value="sans">Sans-serif</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="mono">Monospace</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Font Size</Label>
            <Select value={styles.typography.fontSize} onValueChange={(v) => updateTypography("fontSize", v)}>
              <SelectTrigger data-testid="select-font-size"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="xs">XS</SelectItem>
                <SelectItem value="sm">SM</SelectItem>
                <SelectItem value="base">Base</SelectItem>
                <SelectItem value="lg">LG</SelectItem>
                <SelectItem value="xl">XL</SelectItem>
                <SelectItem value="2xl">2XL</SelectItem>
                <SelectItem value="3xl">3XL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Font Weight</Label>
            <Select value={styles.typography.fontWeight} onValueChange={(v) => updateTypography("fontWeight", v)}>
              <SelectTrigger data-testid="select-font-weight"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="semibold">Semibold</SelectItem>
                <SelectItem value="bold">Bold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Text Color</Label>
            <Input type="color" value={styles.typography.color || "#000000"} onChange={(e) => updateTypography("color", e.target.value)} data-testid="input-text-color" />
          </div>
          <div>
            <Label className="text-xs">Line Height</Label>
            <Select value={styles.typography.lineHeight} onValueChange={(v) => updateTypography("lineHeight", v)}>
              <SelectTrigger data-testid="select-line-height"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tight">Tight</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="relaxed">Relaxed</SelectItem>
                <SelectItem value="loose">Loose</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Spacing</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] as const).map((key) => (
            <div key={key}>
              <Label className="text-xs">{key.replace("padding", "Pad ").replace("margin", "Margin ")}</Label>
              <Select value={styles.spacing[key]} onValueChange={(v) => updateSpacing(key, v)}>
                <SelectTrigger data-testid={`select-${key}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["0", "1", "2", "4", "6", "8", "12", "16", "20", "24"].map(v => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {(["marginTop", "marginBottom"] as const).map((key) => (
            <div key={key}>
              <Label className="text-xs">{key.replace("margin", "Margin ")}</Label>
              <Select value={styles.spacing[key]} onValueChange={(v) => updateSpacing(key, v)}>
                <SelectTrigger data-testid={`select-${key}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["0", "1", "2", "4", "6", "8", "12", "16", "20", "24"].map(v => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Background</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={styles.background.type} onValueChange={(v) => updateBackground("type", v)}>
              <SelectTrigger data-testid="select-bg-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="solid">Solid Color</SelectItem>
                <SelectItem value="gradient">Gradient</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="video">Video</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {styles.background.type === "solid" && (
            <div>
              <Label className="text-xs">Color</Label>
              <Input type="color" value={styles.background.color || "#ffffff"} onChange={(e) => updateBackground("color", e.target.value)} data-testid="input-bg-color" />
            </div>
          )}
          {styles.background.type === "gradient" && (
            <>
              <div>
                <Label className="text-xs">From</Label>
                <Input type="color" value={styles.background.gradientFrom || "#000000"} onChange={(e) => updateBackground("gradientFrom", e.target.value)} data-testid="input-gradient-from" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="color" value={styles.background.gradientTo || "#ffffff"} onChange={(e) => updateBackground("gradientTo", e.target.value)} data-testid="input-gradient-to" />
              </div>
              <div>
                <Label className="text-xs">Direction</Label>
                <Select value={styles.background.gradientDirection} onValueChange={(v) => updateBackground("gradientDirection", v)}>
                  <SelectTrigger data-testid="select-gradient-dir"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to-t">Top</SelectItem>
                    <SelectItem value="to-b">Bottom</SelectItem>
                    <SelectItem value="to-l">Left</SelectItem>
                    <SelectItem value="to-r">Right</SelectItem>
                    <SelectItem value="to-tr">Top Right</SelectItem>
                    <SelectItem value="to-bl">Bottom Left</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {styles.background.type === "image" && (
            <>
              <div className="col-span-full">
                <ImageUploadField value={styles.background.imageUrl} onChange={(url) => updateBackground("imageUrl", url)} label="Image URL" testId="input-bg-image" />
              </div>
              <div>
                <Label className="text-xs">Position</Label>
                <Select value={styles.background.imagePosition || "center"} onValueChange={(v) => updateBackground("imagePosition", v)}>
                  <SelectTrigger data-testid="select-bg-img-position"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="top">Top</SelectItem>
                    <SelectItem value="bottom">Bottom</SelectItem>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="top left">Top Left</SelectItem>
                    <SelectItem value="top right">Top Right</SelectItem>
                    <SelectItem value="bottom left">Bottom Left</SelectItem>
                    <SelectItem value="bottom right">Bottom Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Size</Label>
                <Select value={styles.background.imageSize || "cover"} onValueChange={(v) => updateBackground("imageSize", v)}>
                  <SelectTrigger data-testid="select-bg-img-size"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="100% 100%">Stretch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Attachment</Label>
                <Select value={styles.background.imageAttachment || "scroll"} onValueChange={(v) => updateBackground("imageAttachment", v)}>
                  <SelectTrigger data-testid="select-bg-img-attachment"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scroll">Scroll</SelectItem>
                    <SelectItem value="fixed">Fixed (Parallax)</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Repeat</Label>
                <Select value={styles.background.imageRepeat || "no-repeat"} onValueChange={(v) => updateBackground("imageRepeat", v)}>
                  <SelectTrigger data-testid="select-bg-img-repeat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-repeat">No Repeat</SelectItem>
                    <SelectItem value="repeat">Repeat</SelectItem>
                    <SelectItem value="repeat-x">Repeat X</SelectItem>
                    <SelectItem value="repeat-y">Repeat Y</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {styles.background.type === "video" && (
            <div className="col-span-full">
              <VideoUploadField value={styles.background.videoUrl} onChange={(url) => updateBackground("videoUrl", url)} label="Video URL" testId="input-bg-video" />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Background Overlay</Label>
        <div className="flex items-center gap-2 mb-2">
          <Switch
            checked={styles.background.overlay?.enabled || false}
            onCheckedChange={(checked) => {
              const currentOverlay = styles.background.overlay || { enabled: false, type: "color" as const, color: "#000000", opacity: 50, gradientFrom: "#000000", gradientTo: "#000000", gradientDirection: "to-b", imageUrl: "" };
              onChange({ ...styles, background: { ...styles.background, overlay: { ...currentOverlay, enabled: checked } } });
            }}
            data-testid="switch-bg-overlay"
          />
          <Label className="text-xs">Enable Overlay</Label>
        </div>
        {styles.background.overlay?.enabled && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Overlay Type</Label>
              <Select
                value={styles.background.overlay.type || "color"}
                onValueChange={(v) => {
                  onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, type: v as "color" | "gradient" | "image" } } });
                }}
              >
                <SelectTrigger data-testid="select-overlay-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="color">Color</SelectItem>
                  <SelectItem value="gradient">Gradient</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Opacity ({styles.background.overlay.opacity ?? 50}%)</Label>
              <Input
                type="range"
                min="0"
                max="100"
                value={styles.background.overlay.opacity ?? 50}
                onChange={(e) => {
                  onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, opacity: parseInt(e.target.value) } } });
                }}
                data-testid="input-overlay-opacity"
              />
            </div>
            {styles.background.overlay.type === "color" && (
              <div>
                <Label className="text-xs">Overlay Color</Label>
                <Input
                  type="color"
                  value={styles.background.overlay.color || "#000000"}
                  onChange={(e) => {
                    onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, color: e.target.value } } });
                  }}
                  data-testid="input-overlay-color"
                />
              </div>
            )}
            {styles.background.overlay.type === "gradient" && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input
                    type="color"
                    value={styles.background.overlay.gradientFrom || "#000000"}
                    onChange={(e) => {
                      onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, gradientFrom: e.target.value } } });
                    }}
                    data-testid="input-overlay-gradient-from"
                  />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input
                    type="color"
                    value={styles.background.overlay.gradientTo || "#000000"}
                    onChange={(e) => {
                      onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, gradientTo: e.target.value } } });
                    }}
                    data-testid="input-overlay-gradient-to"
                  />
                </div>
                <div>
                  <Label className="text-xs">Direction</Label>
                  <Select
                    value={styles.background.overlay.gradientDirection || "to-b"}
                    onValueChange={(v) => {
                      onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, gradientDirection: v } } });
                    }}
                  >
                    <SelectTrigger data-testid="select-overlay-gradient-dir"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="to-t">Top</SelectItem>
                      <SelectItem value="to-b">Bottom</SelectItem>
                      <SelectItem value="to-l">Left</SelectItem>
                      <SelectItem value="to-r">Right</SelectItem>
                      <SelectItem value="to-tr">Top Right</SelectItem>
                      <SelectItem value="to-bl">Bottom Left</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {styles.background.overlay.type === "image" && (
              <div className="col-span-full">
                <ImageUploadField
                  value={styles.background.overlay.imageUrl || ""}
                  onChange={(url) => {
                    onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, imageUrl: url } } });
                  }}
                  label="Overlay Image"
                  testId="input-overlay-image"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Content Alignment</Label>
        <Select value={styles.alignment} onValueChange={(v) => onChange({ ...styles, alignment: v as SharedStyles["alignment"] })}>
          <SelectTrigger data-testid="select-alignment"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ButtonListEditor({ buttons, onChange }: { buttons: ButtonConfig[]; onChange: (b: ButtonConfig[]) => void }) {
  const addButton = () => onChange([...buttons, { text: "Button", url: "#", variant: "primary" }]);
  const removeButton = (i: number) => onChange(buttons.filter((_, idx) => idx !== i));
  const updateButton = (i: number, updates: Partial<ButtonConfig>) => {
    const newBtns = [...buttons];
    newBtns[i] = { ...newBtns[i], ...updates };
    onChange(newBtns);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">Buttons</Label>
      {buttons.map((btn, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <Input value={btn.text} onChange={(e) => updateButton(i, { text: e.target.value })} placeholder="Text" className="flex-1 min-w-[100px]" data-testid={`input-btn-text-${i}`} />
          <Input value={btn.url} onChange={(e) => updateButton(i, { url: e.target.value })} placeholder="URL" className="flex-1 min-w-[100px]" data-testid={`input-btn-url-${i}`} />
          <Select value={btn.variant} onValueChange={(v) => updateButton(i, { variant: v as ButtonConfig["variant"] })}>
            <SelectTrigger className="w-[110px]" data-testid={`select-btn-variant-${i}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Primary</SelectItem>
              <SelectItem value="secondary">Secondary</SelectItem>
              <SelectItem value="outline">Outline</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => removeButton(i)} data-testid={`button-remove-btn-${i}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addButton} data-testid="button-add-btn">
        <Plus className="h-3 w-3 mr-1" /> Add Button
      </Button>
    </div>
  );
}

function BannerEditor({ comp, onChange }: { comp: BodyComponent & { type: "banner" }; onChange: (c: BannerConfig) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Banner Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-banner-title" />
      </div>
      <div>
        <Label className="text-xs">Banner Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} className="resize-none" data-testid="input-banner-content" />
      </div>
      <ButtonListEditor buttons={comp.config.buttons} onChange={(buttons) => onChange({ ...comp.config, buttons })} />
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

function HeroEditor({ comp, onChange }: { comp: BodyComponent & { type: "hero" }; onChange: (c: HeroConfig) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Hero Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-hero-title" />
      </div>
      <div>
        <Label className="text-xs">Subtitle</Label>
        <Input value={comp.config.subtitle} onChange={(e) => onChange({ ...comp.config, subtitle: e.target.value })} data-testid="input-hero-subtitle" />
      </div>
      <div>
        <Label className="text-xs">Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} className="resize-none" data-testid="input-hero-content" />
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
      <ButtonListEditor buttons={comp.config.buttons} onChange={(buttons) => onChange({ ...comp.config, buttons })} />
    </div>
  );
}

function ContentEditor({ comp, onChange }: { comp: BodyComponent & { type: "content" }; onChange: (c: ContentConfig) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-content-title" />
      </div>
      <div>
        <Label className="text-xs">Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} rows={5} className="resize-none" data-testid="input-content-body" />
      </div>
    </div>
  );
}

function FormEditor({ comp, onChange }: { comp: BodyComponent & { type: "form" }; onChange: (c: FormConfig) => void }) {
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
                  <SelectItem value="textarea">Textarea</SelectItem>
                  <SelectItem value="select">Dropdown</SelectItem>
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
            <Input value={field.placeholder} onChange={(e) => updateField(i, { placeholder: e.target.value })} placeholder="Placeholder text" className="text-xs" data-testid={`input-field-placeholder-${i}`} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
          <Plus className="h-3 w-3 mr-1" /> Add Field
        </Button>
      </div>
    </div>
  );
}

const GRID_ICON_OPTIONS = [
  "Star", "Heart", "Shield", "Zap", "Target", "Award", "Briefcase", "Clock",
  "Globe", "Home", "Key", "Layers", "Lock", "Mail", "Map", "Phone",
  "Settings", "ThumbsUp", "Tool", "Truck", "Users", "Wrench", "CheckCircle", "BarChart",
];

const GRID_ICON_MAP: Record<string, LucideIcon> = {
  Star, Heart, Shield, Zap, Target, Award, Briefcase, Clock,
  Globe, Home, Key, Layers, Lock, Mail, Map, Phone,
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
      data-testid="grid-item-preview"
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

function GridEditor({ comp, onChange }: { comp: BodyComponent & { type: "grid" }; onChange: (c: GridConfig) => void }) {
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
                <Select value={item.iconName || "Star"} onValueChange={(v) => updateItem(i, { iconName: v })}>
                  <SelectTrigger data-testid={`select-grid-icon-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GRID_ICON_OPTIONS.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {item.mediaType === "image" && (
              <>
                <ImageUploadField
                  value={item.imageUrl || ""}
                  onChange={(url) => updateItem(i, { imageUrl: url })}
                  label="Image"
                  placeholder="Upload or select an image"
                  testId={`input-grid-image-${i}`}
                />
                <div className="space-y-1">
                  <Label className="text-xs">Image Height (px)</Label>
                  <Input
                    type="number"
                    min={30}
                    max={600}
                    value={item.imageHeight || 160}
                    onChange={(e) => updateItem(i, { imageHeight: parseInt(e.target.value) || 160 })}
                    data-testid={`input-grid-img-height-${i}`}
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={item.title} onChange={(e) => updateItem(i, { title: e.target.value })} placeholder="Title" data-testid={`input-grid-item-title-${i}`} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea value={item.content} onChange={(e) => updateItem(i, { content: e.target.value })} className="resize-none text-xs" rows={2} data-testid={`input-grid-item-content-${i}`} />
            </div>

            <div className="space-y-2 pt-1 border-t">
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!item.buttonEnabled}
                  onCheckedChange={(v) => updateItem(i, { buttonEnabled: v })}
                  data-testid={`switch-grid-button-${i}`}
                />
                <Label className="text-xs">Show Button</Label>
              </div>
              {item.buttonEnabled && (
                <div className="space-y-2 pl-2">
                  <Input
                    value={item.buttonText || "Learn More"}
                    onChange={(e) => updateItem(i, { buttonText: e.target.value })}
                    placeholder="Button text"
                    data-testid={`input-grid-btn-text-${i}`}
                  />
                  <Input
                    value={item.buttonUrl || "#"}
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
            </div>

            <div className="space-y-2 pt-1 border-t">
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!item.itemClickable}
                  onCheckedChange={(v) => updateItem(i, { itemClickable: v })}
                  data-testid={`switch-grid-clickable-${i}`}
                />
                <Label className="text-xs">Entire card clickable</Label>
              </div>
              {item.itemClickable && (
                <div className="space-y-2 pl-2">
                  <Input
                    value={item.itemUrl || "#"}
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
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-grid-item">
          <Plus className="h-3 w-3 mr-1" /> Add Item
        </Button>
      </div>
    </div>
  );
}

function CtaEditor({ comp, onChange }: { comp: BodyComponent & { type: "cta" }; onChange: (c: CtaConfig) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">CTA Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-cta-title" />
      </div>
      <div>
        <Label className="text-xs">CTA Content</Label>
        <Textarea value={comp.config.content} onChange={(e) => onChange({ ...comp.config, content: e.target.value })} className="resize-none" data-testid="input-cta-content" />
      </div>
      <ButtonListEditor buttons={comp.config.buttons} onChange={(buttons) => onChange({ ...comp.config, buttons })} />
    </div>
  );
}

function TestimonialEditor({ comp, onChange }: { comp: BodyComponent & { type: "testimonial" }; onChange: (c: TestimonialConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `t-${Date.now()}`, name: "Name", role: "Role", quote: "Quote text", imageEnabled: false, imageUrl: "" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_, idx) => idx !== i) });
  const updateItem = (i: number, updates: Partial<TestimonialItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-testimonial-title" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Layout</Label>
          <Select value={comp.config.layout} onValueChange={(v) => onChange({ ...comp.config, layout: v as TestimonialConfig["layout"] })}>
            <SelectTrigger data-testid="select-testimonial-layout"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="carousel">Carousel</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Columns</Label>
          <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
            <SelectTrigger data-testid="select-testimonial-cols"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Testimonials</Label>
        {comp.config.items.map((item, i) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder="Name" className="flex-1 min-w-[80px]" data-testid={`input-testimonial-name-${i}`} />
              <Input value={item.role} onChange={(e) => updateItem(i, { role: e.target.value })} placeholder="Role" className="flex-1 min-w-[80px]" data-testid={`input-testimonial-role-${i}`} />
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-testimonial-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Textarea value={item.quote} onChange={(e) => updateItem(i, { quote: e.target.value })} className="resize-none text-xs" rows={2} placeholder="Quote" data-testid={`input-testimonial-quote-${i}`} />
            <div className="flex items-center gap-3">
              <Switch checked={item.imageEnabled} onCheckedChange={(v) => updateItem(i, { imageEnabled: v })} data-testid={`switch-testimonial-img-${i}`} />
              <Label className="text-[10px]">Profile Image</Label>
            </div>
            {item.imageEnabled && (
              <ImageUploadField value={item.imageUrl} onChange={(url) => updateItem(i, { imageUrl: url })} label="Profile Image" testId={`input-testimonial-img-${i}`} />
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-testimonial">
          <Plus className="h-3 w-3 mr-1" /> Add Testimonial
        </Button>
      </div>
    </div>
  );
}

function FeatureHighlightEditor({ comp, onChange }: { comp: BodyComponent & { type: "feature_highlight" }; onChange: (c: FeatureHighlightConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `fh-${Date.now()}`, title: "Feature", description: "Description", icon: "star" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_, idx) => idx !== i) });
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
        {comp.config.items.map((item, i) => (
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

function GalleryEditor({ comp, onChange }: { comp: BodyComponent & { type: "gallery" }; onChange: (c: GalleryConfig) => void }) {
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

function StatsEditor({ comp, onChange }: { comp: BodyComponent & { type: "stats" }; onChange: (c: StatsConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `s-${Date.now()}`, value: "0", label: "Metric", prefix: "", suffix: "" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_, idx) => idx !== i) });
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
        {comp.config.items.map((item, i) => (
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

function FaqEditor({ comp, onChange }: { comp: BodyComponent & { type: "faq" }; onChange: (c: FaqConfig) => void }) {
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

export function ComponentConfigEditor({ comp, onConfigChange }: { comp: BodyComponent; onConfigChange: (config: any) => void }) {
  switch (comp.type) {
    case "banner": return <BannerEditor comp={comp as BodyComponent & { type: "banner" }} onChange={onConfigChange} />;
    case "hero": return <HeroEditor comp={comp as BodyComponent & { type: "hero" }} onChange={onConfigChange} />;
    case "content": return <ContentEditor comp={comp as BodyComponent & { type: "content" }} onChange={onConfigChange} />;
    case "form": return <FormEditor comp={comp as BodyComponent & { type: "form" }} onChange={onConfigChange} />;
    case "grid": return <GridEditor comp={comp as BodyComponent & { type: "grid" }} onChange={onConfigChange} />;
    case "cta": return <CtaEditor comp={comp as BodyComponent & { type: "cta" }} onChange={onConfigChange} />;
    case "testimonial": return <TestimonialEditor comp={comp as BodyComponent & { type: "testimonial" }} onChange={onConfigChange} />;
    case "feature_highlight": return <FeatureHighlightEditor comp={comp as BodyComponent & { type: "feature_highlight" }} onChange={onConfigChange} />;
    case "gallery": return <GalleryEditor comp={comp as BodyComponent & { type: "gallery" }} onChange={onConfigChange} />;
    case "stats": return <StatsEditor comp={comp as BodyComponent & { type: "stats" }} onChange={onConfigChange} />;
    case "faq": return <FaqEditor comp={comp as BodyComponent & { type: "faq" }} onChange={onConfigChange} />;
    default: return null;
  }
}

interface WebsiteBodyComponentsProps {
  config: BodyComponentsConfig;
  onChange: (config: BodyComponentsConfig) => void;
  title?: string;
  description?: string;
}

export default function WebsiteBodyComponents({ config, onChange, title, description }: WebsiteBodyComponentsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showStylesFor, setShowStylesFor] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [deviceView, setDeviceView] = useState<"desktop" | "mobile">("desktop");
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const components = [...config.components].sort((a, b) => a.order - b.order);

  const updateComponent = useCallback((id: string, updates: Partial<BodyComponent>) => {
    const newComponents = config.components.map(c =>
      c.id === id ? { ...c, ...updates } as BodyComponent : c
    );
    onChange({ components: newComponents });
  }, [config, onChange]);

  const updateComponentConfig = useCallback((id: string, newConfig: any) => {
    const newComponents = config.components.map(c =>
      c.id === id ? { ...c, config: newConfig } as BodyComponent : c
    );
    onChange({ components: newComponents });
  }, [config, onChange]);

  const updateComponentStyles = useCallback((id: string, styles: SharedStyles) => {
    const newComponents = config.components.map(c =>
      c.id === id ? { ...c, styles } as BodyComponent : c
    );
    onChange({ components: newComponents });
  }, [config, onChange]);

  const addComponent = useCallback((type: BodyComponentType) => {
    const newComp = createDefaultComponent(type, config.components.length);
    onChange({ components: [...config.components, newComp] });
    setShowAddPicker(false);
    setExpandedId(newComp.id);
  }, [config, onChange]);

  const removeComponent = useCallback((id: string) => {
    const newComponents = config.components.filter(c => c.id !== id);
    newComponents.forEach((c, i) => { c.order = i; });
    onChange({ components: newComponents });
    if (expandedId === id) setExpandedId(null);
  }, [config, onChange, expandedId]);

  const duplicateComponent = useCallback((id: string) => {
    const comp = config.components.find(c => c.id === id);
    if (!comp) return;
    const newComp = JSON.parse(JSON.stringify(comp)) as BodyComponent;
    newComp.id = `body-${comp.type}-${Date.now()}`;
    newComp.label = `${comp.label} (Copy)`;
    newComp.order = config.components.length;
    onChange({ components: [...config.components, newComp] });
  }, [config, onChange]);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;
    const sorted = [...config.components].sort((a, b) => a.order - b.order);
    const [moved] = sorted.splice(dragItem.current, 1);
    sorted.splice(dragOverItem.current, 0, moved);
    sorted.forEach((c, i) => { c.order = i; });
    onChange({ components: sorted });
    dragItem.current = null;
    dragOverItem.current = null;
  }, [config, onChange]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{title || "Body Components"}</CardTitle>
          <CardDescription>{description || "Add and configure page sections. Drag to reorder. All components support responsive desktop/mobile views."}</CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1 p-1 border rounded-md">
            <Button
              size="sm"
              variant={deviceView === "desktop" ? "default" : "ghost"}
              onClick={() => setDeviceView("desktop")}
              data-testid="button-body-desktop"
            >
              <Monitor className="h-4 w-4 mr-1" />
              Desktop
            </Button>
            <Button
              size="sm"
              variant={deviceView === "mobile" ? "default" : "ghost"}
              onClick={() => setDeviceView("mobile")}
              data-testid="button-body-mobile"
            >
              <Smartphone className="h-4 w-4 mr-1" />
              Mobile
            </Button>
          </div>
          <Button size="sm" onClick={() => setShowAddPicker(!showAddPicker)} data-testid="button-add-body-component">
            <Plus className="h-4 w-4 mr-1" />
            Add Component
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAddPicker && (
          <div className="border rounded-md p-4 space-y-3">
            <h4 className="text-sm font-semibold">Choose a component to add</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {(Object.entries(COMPONENT_TYPE_META) as [BodyComponentType, typeof COMPONENT_TYPE_META["banner"]][]).map(([type, meta]) => {
                const Icon = meta.icon;
                return (
                  <Button
                    key={type}
                    variant="outline"
                    className="h-auto flex-col items-start p-3 text-left"
                    onClick={() => addComponent(type)}
                    data-testid={`button-add-${type}`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="text-xs font-medium">{meta.label}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-1">{meta.description}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {components.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <LayoutGrid className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No body components yet. Click "Add Component" to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {components.map((comp, idx) => {
              const meta = COMPONENT_TYPE_META[comp.type];
              const Icon = meta.icon;
              const isExpanded = expandedId === comp.id;
              const isStylesOpen = showStylesFor === comp.id;
              const visKey = deviceView === "desktop" ? "visibleDesktop" : "visibleMobile";
              const isVisible = comp[visKey];

              return (
                <div
                  key={comp.id}
                  draggable
                  onDragStart={() => { dragItem.current = idx; }}
                  onDragOver={(e) => { e.preventDefault(); dragOverItem.current = idx; }}
                  onDrop={(e) => { e.preventDefault(); handleDragEnd(); }}
                  className={`border rounded-md transition-colors ${comp.enabled ? "" : "opacity-50"}`}
                  data-testid={`body-component-${comp.id}`}
                >
                  <div className="flex items-center gap-2 p-3">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium flex-1 truncate">{comp.label}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">{meta.label}</Badge>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Badge variant={comp.visibleDesktop ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                        <Monitor className="h-3 w-3" />
                      </Badge>
                      <Badge variant={comp.visibleMobile ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                        <Smartphone className="h-3 w-3" />
                      </Badge>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => updateComponent(comp.id, { [visKey]: !isVisible } as any)} data-testid={`button-toggle-vis-${comp.id}`}>
                      {isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => duplicateComponent(comp.id)} data-testid={`button-duplicate-${comp.id}`}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeComponent(comp.id)} data-testid={`button-remove-${comp.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setExpandedId(isExpanded ? null : comp.id)} data-testid={`button-expand-${comp.id}`}>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-3 border-t pt-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-[150px]">
                          <Label className="text-xs">Label</Label>
                          <Input value={comp.label} onChange={(e) => updateComponent(comp.id, { label: e.target.value })} data-testid={`input-label-${comp.id}`} />
                        </div>
                        <div className="flex items-center gap-2 pt-4">
                          <Switch checked={comp.enabled} onCheckedChange={(v) => updateComponent(comp.id, { enabled: v })} data-testid={`switch-enabled-${comp.id}`} />
                          <Label className="text-xs">Enabled</Label>
                        </div>
                      </div>

                      <ComponentConfigEditor comp={comp} onConfigChange={(c) => updateComponentConfig(comp.id, c)} />

                      <div className="pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowStylesFor(isStylesOpen ? null : comp.id)}
                          data-testid={`button-styles-${comp.id}`}
                        >
                          <Palette className="h-3 w-3 mr-1" />
                          {isStylesOpen ? "Hide Style Controls" : "Show Style Controls"}
                        </Button>
                      </div>

                      {isStylesOpen && (
                        <StyleEditor styles={comp.styles} onChange={(s) => updateComponentStyles(comp.id, s)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
