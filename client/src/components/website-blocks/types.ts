import {
  Image as ImageIcon,
  Sparkles,
  FileText,
  MessageSquare,
  LayoutGrid,
  MousePointer,
  Star,
  BarChart3,
  HelpCircle,
  Columns,
  Shield,
  Briefcase,
  Truck,
  Users,
  Layers,
  BookOpen,
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
