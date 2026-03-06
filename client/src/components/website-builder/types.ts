import type {
  HeaderComponentsConfig,
  FooterComponentsConfig,
} from "@/components/website-components-tab";
import type { BodyComponentsConfig } from "@/components/website-body-components";

export interface Website {
  id: string;
  organizationId: string;
  subdomain: string;
  customDomain: string | null;
  domainVerified: boolean;
  status: "DRAFT" | "PUBLISHED" | "MAINTENANCE";
  siteTitle: string | null;
  siteTagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  logoHeight: number | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  templateId: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  showBlog: boolean;
  showProjects: boolean;
  showTestimonials: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  contentWidth: string | null;
  maxWidth: number | null;
  sectionPadding: number | null;
  breakpointDesktop: number | null;
  breakpointTablet: number | null;
  breakpointMobile: number | null;
  headerType: string | null;
  headerHeight: number | null;
  logoPosition: string | null;
  navigationLayout: string | null;
  mobileNavStyle: string | null;
  showOnScroll: boolean | null;
  pageLayout: string | null;
  sidebarWidth: number | null;
  pagePadding: number | null;
  showBreadcrumb: boolean | null;
  footerVisibility: boolean | null;
  footerColumns: number | null;
  footerWidth: string | null;
  footerPadding: number | null;
  footerSectionSettings: Record<string, any> | null;
  headerSectionSettings: Record<string, any> | null;
  headerComponentsConfig: HeaderComponentsConfig | null;
  footerComponentsConfig: FooterComponentsConfig | null;
  bodyComponentsConfig: BodyComponentsConfig | null;
  globalComponentsConfig: BodyComponentsConfig | null;
  lastPublishedAt: string | null;
  defaultMetaTitle: string | null;
  defaultMetaDescription: string | null;
  googleAnalyticsId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface WebsitePageRaw {
  id: string;
  websiteId: string;
  pageType: string;
  pageSlug: string;
  pageTitle: string;
  page_slug?: string;
  page_title?: string;
  navigationLabel: string | null;
  navigation_label?: string | null;
  navigationOrder: number;
  navigation_order?: number;
  showInNavigation: boolean;
  show_in_navigation?: boolean;
  isPublished: boolean;
  is_published?: boolean;
  aiGenerated: boolean;
  ai_generated?: boolean;
  parentPageId: string | null;
  parent_page_id?: string | null;
}

export interface WebsitePage {
  id: string;
  websiteId: string;
  pageType: string;
  pageSlug: string;
  pageTitle: string;
  navigationLabel: string | null;
  navigationOrder: number;
  showInNavigation: boolean;
  status: "DRAFT" | "PUBLISHED";
  isPublished: boolean;
  aiGenerated: boolean;
  parentPageId: string | null;
}

export function mapPageFromApi(raw: WebsitePageRaw): WebsitePage {
  const isPublished = raw.isPublished ?? raw.is_published ?? false;
  return {
    id: raw.id,
    websiteId: raw.websiteId,
    pageType: raw.pageType,
    pageSlug: raw.pageSlug || raw.page_slug || "",
    pageTitle: raw.pageTitle || raw.page_title || "",
    navigationLabel: raw.navigationLabel ?? raw.navigation_label ?? null,
    navigationOrder: raw.navigationOrder ?? raw.navigation_order ?? 0,
    showInNavigation: raw.showInNavigation ?? raw.show_in_navigation ?? true,
    status: isPublished ? "PUBLISHED" : "DRAFT",
    isPublished,
    aiGenerated: raw.aiGenerated ?? raw.ai_generated ?? false,
    parentPageId: raw.parentPageId ?? raw.parent_page_id ?? null,
  };
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  category: string | null;
  authorName: string | null;
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
  aiGenerated: boolean;
}

export interface GalleryProject {
  id: string;
  title: string;
  slug: string;
  short_description?: string | null;
  shortDescription?: string | null;
  project_type?: string | null;
  projectType?: string | null;
  service_type?: string | null;
  serviceType?: string | null;
  client_name?: string | null;
  clientName?: string | null;
  location_city?: string | null;
  locationCity?: string | null;
  location_state?: string | null;
  locationState?: string | null;
  featured: boolean;
  cover_image_url?: string | null;
  coverImageUrl?: string | null;
  completion_date?: string | null;
  completionDate?: string | null;
  status: string;
  view_count?: number;
  viewCount?: number;
}

export interface SocialLinks {
  id?: string;
  facebookUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
}

export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  subject: string | null;
  message: string;
  read: boolean;
  responded: boolean;
  convertedToCrm: boolean;
  createdAt: string;
}

export interface AnalyticsSummary {
  hasData: boolean;
  period: { days: number; startDate: string };
  totals: {
    pageViews: number;
    uniqueVisitors: number;
    sessions: number;
    contactFormSubmissions: number;
  };
  dailyStats: Array<{
    date: string;
    pageViews: number;
    uniqueVisitors: number;
  }>;
  topPages: Array<{ path: string; count: number }>;
  referrers: Array<{ referrer: string; count: number }>;
}

export interface AIResponse {
  response: string;
}

export interface DeploymentRecord {
  id: string;
  action: string;
  performedByName: string | null;
  note: string | null;
  createdAt: string;
  metadata: Record<string, any> | null;
}

export const WEBSITE_TEMPLATES = [
  {
    id: "modern-professional",
    name: "Modern Professional",
    description: "Clean, minimal layout with bold hero and neutral tones",
    primaryColor: "#2563EB",
    secondaryColor: "#1E3A5F",
    accentColor: "#06B6D4",
    fontFamily: "Inter, sans-serif",
    previewColors: ["#2563EB", "#1E3A5F", "#06B6D4", "#F8FAFC", "#0F172A"],
    layoutHint: "Spacious sections, centered content, modern typography",
  },
  {
    id: "bold-industrial",
    name: "Bold & Industrial",
    description: "Dark, high-contrast design suited for heavy construction",
    primaryColor: "#DC2626",
    secondaryColor: "#1C1917",
    accentColor: "#F59E0B",
    fontFamily: "Roboto, sans-serif",
    previewColors: ["#DC2626", "#1C1917", "#F59E0B", "#292524", "#FAFAF9"],
    layoutHint: "Strong headers, angular elements, impactful imagery",
  },
  {
    id: "classic-corporate",
    name: "Classic Corporate",
    description: "Traditional business layout with structured sections",
    primaryColor: "#1D4ED8",
    secondaryColor: "#1E3A8A",
    accentColor: "#059669",
    fontFamily: "Georgia, serif",
    previewColors: ["#1D4ED8", "#1E3A8A", "#059669", "#F0F9FF", "#0C2461"],
    layoutHint: "Formal grid layout, trust badges, professional tone",
  },
  {
    id: "fresh-creative",
    name: "Fresh & Creative",
    description: "Light, airy design with vibrant accents for specialty trades",
    primaryColor: "#7C3AED",
    secondaryColor: "#4338CA",
    accentColor: "#F97316",
    fontFamily: "Poppins, sans-serif",
    previewColors: ["#7C3AED", "#4338CA", "#F97316", "#FEFCE8", "#1E1B4B"],
    layoutHint: "Rounded corners, gradient accents, playful spacing",
  },
];

export interface WebsiteFormState {
  siteTitle: string;
  siteTagline: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  templateId: string;
  metaTitle: string;
  metaDescription: string;
  contactEmail: string;
  contactPhone: string;
  showBlog: boolean;
  showProjects: boolean;
  showTestimonials: boolean;
  contentWidth: string;
  maxWidth: number;
  sectionPadding: number;
  breakpointDesktop: number;
  breakpointTablet: number;
  breakpointMobile: number;
  headerType: string;
  headerHeight: number;
  logoPosition: string;
  navigationLayout: string;
  mobileNavStyle: string;
  logoUrl: string;
  faviconUrl: string;
  logoHeight: number;
  showOnScroll: boolean;
  pageLayout: string;
  sidebarWidth: number;
  pagePadding: number;
  showBreadcrumb: boolean;
  footerVisibility: boolean;
  footerColumns: number;
  footerWidth: string;
  footerPadding: number;
  footerSectionSettings: Record<string, any> | null;
  headerSectionSettings: Record<string, any> | null;
}
