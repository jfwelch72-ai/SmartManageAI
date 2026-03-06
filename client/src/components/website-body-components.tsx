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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { GOOGLE_FONTS, loadGoogleFont } from "./text-style-editor";
import BrandingColorPicker, { type BrandingColors } from "@/components/branding-color-picker";
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
  Shield,
  Briefcase,
  Truck,
  Users,
  Layers,
  BookOpen,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { BannerEditor, HeroEditor, CtaEditor } from "./website-blocks/HeroBlocks";
import { ContentEditor, FeatureHighlightEditor, StatsEditor, AboutCompanyEditor } from "./website-blocks/ContentBlocks";
import { GridEditor, GalleryEditor, EquipmentEditor } from "./website-blocks/MediaBlocks";
import { TestimonialEditor, TeamEditor, CertificationsEditor, LogoShowcaseEditor } from "./website-blocks/SocialProofBlocks";
import { FormEditor, FaqEditor, SafetyEditor, BlogSectionEditor } from "./website-blocks/InteractionBlocks";

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
  | "faq"
  | "certifications"
  | "about_company"
  | "equipment"
  | "safety"
  | "team"
  | "logo_showcase"
  | "blog_section";

export interface TypographyStyles {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  lineHeight: string;
  fontStyle?: string;
  textAlign?: string;
  textTransform?: string;
  letterSpacing?: string;
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
  style?: Record<string, string>;
}

export interface FormFieldConfig {
  id: string;
  label: string;
  type: "text" | "email" | "textarea" | "select" | "phone" | "number" | "checkbox" | "radio" | "toggle" | "subject";
  placeholder: string;
  required: boolean;
  options?: string[];
  style?: Record<string, string>;
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

type ComponentConfig =
  | { type: "banner"; config: any }
  | { type: "hero"; config: any }
  | { type: "content"; config: any }
  | { type: "form"; config: any }
  | { type: "grid"; config: any }
  | { type: "cta"; config: any }
  | { type: "testimonial"; config: any }
  | { type: "feature_highlight"; config: any }
  | { type: "gallery"; config: any }
  | { type: "stats"; config: any }
  | { type: "faq"; config: any }
  | { type: "certifications"; config: any }
  | { type: "about_company"; config: any }
  | { type: "equipment"; config: any }
  | { type: "safety"; config: any }
  | { type: "team"; config: any }
  | { type: "logo_showcase"; config: any }
  | { type: "blog_section"; config: any };

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
  certifications: { label: "Certifications", icon: Shield, description: "Accreditations and certifications" },
  about_company: { label: "About Company", icon: Briefcase, description: "Company overview and mission" },
  equipment: { label: "Equipment", icon: Truck, description: "Equipment and machinery showcase" },
  safety: { label: "Safety & Compliance", icon: Shield, description: "Safety policies and compliance" },
  team: { label: "Team Members", icon: Users, description: "Key personnel and team" },
  logo_showcase: { label: "Logo Showcase", icon: Layers, description: "Client or partner logos" },
  blog_section: { label: "Blog Section", icon: BookOpen, description: "Display blog posts with filtering and layout options" },
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
    case "certifications":
      return { ...base, type, config: { title: "Our Certifications", columns: 4, items: [{ id: "c1", logoUrl: "", label: "ISO Certified" }, { id: "c2", logoUrl: "", label: "Licensed Contractor" }] } };
    case "about_company":
      return { ...base, type, config: { title: "About Our Company", overview: "We are a leading construction company with decades of experience.", yearsExperience: "25", mission: "To deliver quality construction projects on time and within budget.", vision: "To be the most trusted name in construction.", teamPhotoUrl: "" } };
    case "equipment":
      return { ...base, type, config: { title: "Our Equipment", columns: 3, items: [{ id: "eq1", imageUrl: "", model: "Excavator CAT 320", description: "Heavy-duty excavator for large projects" }] } };
    case "safety":
      return { ...base, type, config: { title: "Safety & Compliance", safetyPolicy: "Safety is our top priority. We maintain strict protocols to ensure a zero-incident workplace.", stats: [{ id: "ss1", value: "500+", label: "Safe Work Days" }, { id: "ss2", value: "0", label: "Lost Time Incidents" }], badges: [{ id: "sb1", imageUrl: "", label: "OSHA Compliant" }] } };
    case "team":
      return { ...base, type, config: { title: "Our Team", columns: 3, items: [{ id: "tm1", photoUrl: "", name: "John Smith", role: "Project Manager", bio: "20 years of construction management experience." }] } };
    case "logo_showcase":
      return { ...base, type, config: { title: "Our Partners", items: [{ id: "l1", imageUrl: "", altText: "Partner 1" }, { id: "l2", imageUrl: "", altText: "Partner 2" }], desktopColumns: 5, tabletColumns: 3, mobileColumns: 2, continuousSlide: false, slideSpeed: 30 } };
    case "blog_section":
      return { ...base, type, config: { title: "Latest From Our Blog", source: "latest", categoryFilter: "", tagFilter: "", sortOrder: "latest", layoutStyle: "grid", desktopItems: 3, tabletItems: 2, mobileItems: 1, showExcerpt: true, showAuthor: true, showDate: true, showCategory: true, showCoverImage: true, readMoreText: "Read More" } };
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
          onClick={() => setShowSourcePicker(true)}
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
              onClick={() => { setShowSourcePicker(false); setShowMediaLibrary(true); }}
              data-testid="button-source-media-library"
            >
              <HardDrive className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Media Library</span>
              <span className="text-xs text-muted-foreground text-center">Choose from uploaded files</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-md border hover-elevate cursor-pointer"
              onClick={() => { setShowSourcePicker(false); fileRef.current?.click(); }}
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
          onClick={() => setShowSourcePicker(true)}
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
              onClick={() => { setShowSourcePicker(false); setShowMediaLibrary(true); }}
              data-testid="button-video-source-media-library"
            >
              <HardDrive className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Media Library</span>
              <span className="text-xs text-muted-foreground text-center">Choose from uploaded files</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-md border hover-elevate cursor-pointer"
              onClick={() => { setShowSourcePicker(false); fileRef.current?.click(); }}
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

export function StyleEditor({ styles, onChange, brandingColors }: { styles: SharedStyles; onChange: (s: SharedStyles) => void; brandingColors?: BrandingColors }) {
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
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
          <div className="col-span-2 md:col-span-3">
            <Label className="text-xs">Font Family</Label>
            <Popover open={fontFamilyOpen} onOpenChange={setFontFamilyOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between h-9" data-testid="select-font-family">
                  <span style={{ fontFamily: styles.typography.fontFamily !== 'inherit' ? `"${styles.typography.fontFamily}", sans-serif` : undefined }}>
                    {styles.typography.fontFamily === 'inherit' ? 'Inherit' : styles.typography.fontFamily || 'Inherit'}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search fonts..." />
                  <CommandList>
                    <CommandEmpty>No font found.</CommandEmpty>
                    <CommandGroup heading="System">
                      {["inherit", "sans", "serif", "mono"].map(f => (
                        <CommandItem key={f} value={f} onSelect={() => { updateTypography("fontFamily", f); setFontFamilyOpen(false); }}>
                          <Check className={`mr-2 h-3.5 w-3.5 ${styles.typography.fontFamily === f ? 'opacity-100' : 'opacity-0'}`} />
                          {f === 'inherit' ? 'Inherit' : f === 'sans' ? 'Sans-serif' : f === 'serif' ? 'Serif' : 'Monospace'}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <CommandGroup heading="Google Fonts">
                      {GOOGLE_FONTS.map(f => (
                        <CommandItem key={f} value={f} onSelect={() => { updateTypography("fontFamily", f); loadGoogleFont(f); setFontFamilyOpen(false); }}>
                          <Check className={`mr-2 h-3.5 w-3.5 ${styles.typography.fontFamily === f ? 'opacity-100' : 'opacity-0'}`} />
                          <span style={{ fontFamily: `"${f}", sans-serif` }}>{f}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
            <BrandingColorPicker value={styles.typography.color || ""} onChange={(color) => updateTypography("color", color)} brandingColors={brandingColors} placeholder="#000000" data-testid="input-text-color" showHexInput={false} size="sm" />
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
          <div>
            <Label className="text-xs">Font Style</Label>
            <Select value={styles.typography.fontStyle || "normal"} onValueChange={(v) => updateTypography("fontStyle", v)}>
              <SelectTrigger data-testid="select-font-style"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="italic">Italic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Text Align</Label>
            <Select value={styles.typography.textAlign || "center"} onValueChange={(v) => updateTypography("textAlign", v)}>
              <SelectTrigger data-testid="select-text-align"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
                <SelectItem value="justify">Justify</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Text Transform</Label>
            <Select value={styles.typography.textTransform || "none"} onValueChange={(v) => updateTypography("textTransform", v)}>
              <SelectTrigger data-testid="select-text-transform"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="uppercase">UPPERCASE</SelectItem>
                <SelectItem value="lowercase">lowercase</SelectItem>
                <SelectItem value="capitalize">Capitalize</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Letter Spacing</Label>
            <Input type="number" step={0.5} min={-5} max={20} value={styles.typography.letterSpacing || "0"} onChange={(e) => updateTypography("letterSpacing", e.target.value)} data-testid="input-letter-spacing" />
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
              <BrandingColorPicker value={styles.background.color || ""} onChange={(color) => updateBackground("color", color)} brandingColors={brandingColors} placeholder="#ffffff" data-testid="input-bg-color" showHexInput={false} size="sm" />
            </div>
          )}
          {styles.background.type === "gradient" && (
            <>
              <div>
                <Label className="text-xs">From</Label>
                <BrandingColorPicker value={styles.background.gradientFrom || ""} onChange={(color) => updateBackground("gradientFrom", color)} brandingColors={brandingColors} placeholder="#000000" data-testid="input-gradient-from" showHexInput={false} size="sm" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <BrandingColorPicker value={styles.background.gradientTo || ""} onChange={(color) => updateBackground("gradientTo", color)} brandingColors={brandingColors} placeholder="#ffffff" data-testid="input-gradient-to" showHexInput={false} size="sm" />
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
                <BrandingColorPicker
                  value={styles.background.overlay.color || ""}
                  onChange={(color) => {
                    onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, color } } });
                  }}
                  brandingColors={brandingColors}
                  placeholder="#000000"
                  data-testid="input-overlay-color"
                  showHexInput={false}
                  size="sm"
                />
              </div>
            )}
            {styles.background.overlay.type === "gradient" && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <BrandingColorPicker
                    value={styles.background.overlay.gradientFrom || ""}
                    onChange={(color) => {
                      onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, gradientFrom: color } } });
                    }}
                    brandingColors={brandingColors}
                    placeholder="#000000"
                    data-testid="input-overlay-gradient-from"
                    showHexInput={false}
                    size="sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <BrandingColorPicker
                    value={styles.background.overlay.gradientTo || ""}
                    onChange={(color) => {
                      onChange({ ...styles, background: { ...styles.background, overlay: { ...styles.background.overlay!, gradientTo: color } } });
                    }}
                    brandingColors={brandingColors}
                    placeholder="#000000"
                    data-testid="input-overlay-gradient-to"
                    showHexInput={false}
                    size="sm"
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

export function ComponentConfigEditor({ comp, onConfigChange, brandingColors }: { comp: BodyComponent; onConfigChange: (config: any) => void; brandingColors?: BrandingColors }) {
  switch (comp.type) {
    case "banner": return <BannerEditor comp={comp as BodyComponent & { type: "banner" }} onChange={onConfigChange} brandingColors={brandingColors} />;
    case "hero": return <HeroEditor comp={comp as BodyComponent & { type: "hero" }} onChange={onConfigChange} brandingColors={brandingColors} />;
    case "content": return <ContentEditor comp={comp as BodyComponent & { type: "content" }} onChange={onConfigChange} brandingColors={brandingColors} />;
    case "form": return <FormEditor comp={comp as BodyComponent & { type: "form" }} onChange={onConfigChange} brandingColors={brandingColors} />;
    case "grid": return <GridEditor comp={comp as BodyComponent & { type: "grid" }} onChange={onConfigChange} />;
    case "cta": return <CtaEditor comp={comp as BodyComponent & { type: "cta" }} onChange={onConfigChange} brandingColors={brandingColors} />;
    case "testimonial": return <TestimonialEditor comp={comp as BodyComponent & { type: "testimonial" }} onChange={onConfigChange} />;
    case "feature_highlight": return <FeatureHighlightEditor comp={comp as BodyComponent & { type: "feature_highlight" }} onChange={onConfigChange} />;
    case "gallery": return <GalleryEditor comp={comp as BodyComponent & { type: "gallery" }} onChange={onConfigChange} />;
    case "stats": return <StatsEditor comp={comp as BodyComponent & { type: "stats" }} onChange={onConfigChange} />;
    case "faq": return <FaqEditor comp={comp as BodyComponent & { type: "faq" }} onChange={onConfigChange} />;
    case "certifications": return <CertificationsEditor comp={comp as BodyComponent & { type: "certifications" }} onChange={onConfigChange} />;
    case "about_company": return <AboutCompanyEditor comp={comp as BodyComponent & { type: "about_company" }} onChange={onConfigChange} />;
    case "equipment": return <EquipmentEditor comp={comp as BodyComponent & { type: "equipment" }} onChange={onConfigChange} />;
    case "safety": return <SafetyEditor comp={comp as BodyComponent & { type: "safety" }} onChange={onConfigChange} />;
    case "team": return <TeamEditor comp={comp as BodyComponent & { type: "team" }} onChange={onConfigChange} />;
    case "logo_showcase": return <LogoShowcaseEditor comp={comp as BodyComponent & { type: "logo_showcase" }} onChange={onConfigChange} />;
    case "blog_section": return <BlogSectionEditor comp={comp as BodyComponent & { type: "blog_section" }} onChange={onConfigChange} />;
    default: return null;
  }
}

interface WebsiteBodyComponentsProps {
  config: BodyComponentsConfig;
  onChange: (config: BodyComponentsConfig) => void;
  title?: string;
  description?: string;
  brandingColors?: BrandingColors;
}

export default function WebsiteBodyComponents({ config, onChange, title, description, brandingColors }: WebsiteBodyComponentsProps) {
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
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{title || "Body Components"}</CardTitle>
          <CardDescription>{description || "Add and configure page sections. Drag to reorder. All components support responsive desktop/mobile views."}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
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

                      <ComponentConfigEditor comp={comp} onConfigChange={(c) => updateComponentConfig(comp.id, c)} brandingColors={brandingColors} />

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
                        <StyleEditor styles={comp.styles} onChange={(s) => updateComponentStyles(comp.id, s)} brandingColors={brandingColors} />
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
