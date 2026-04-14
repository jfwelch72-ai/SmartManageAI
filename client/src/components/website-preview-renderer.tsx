import { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { 
  Phone, 
  Mail, 
  MapPin, 
  Menu,
  ChevronRight,
  ChevronDown,
  Star,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  X,
  Calendar,
  User,
  Send,
  Search,
  ArrowUp,
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
  Map as MapIcon,
  Settings,
  ThumbsUp,
  Wrench,
  BarChart,
  Users,
  Truck,
  Hammer,
  type LucideIcon,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { HeaderComponentsConfig, FooterComponentsConfig, BackToTopConfig, HeaderElement, FooterElement, ColumnSettings } from "@/components/website-components-tab";
import { DEFAULT_COLUMN_SETTINGS } from "@/components/website-components-tab";
import type { BodyComponentsConfig, BodyComponent, SharedStyles, ButtonConfig } from "@/components/website-body-components";
import { loadGoogleFont } from "./text-style-editor";

const GRID_ICON_MAP: Record<string, LucideIcon> = {
  Star, Heart, Shield, Zap, Target, Award, Briefcase, Clock,
  Globe, Home, Key, Layers, Lock, Mail, Map: MapIcon, Phone,
  Settings, ThumbsUp, Tool: Hammer, Wrench, Truck, Users, CheckCircle, BarChart,
};

interface PreviewData {
  website: {
    siteTitle: string | null;
    siteTagline: string | null;
    missionStatement: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    fontFamily: string | null;
    logoUrl: string | null;
    logoHeight: number | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    blogEnabled: boolean | null;
    galleryEnabled: boolean | null;
    mobileNavStyle?: string | null;
  };
  organization: {
    name: string;
    tradeType: string | null;
    region: string | null;
    logoUrl: string | null;
  } | null;
  pages: Array<{
    id: string;
    pageTitle: string;
    pageSlug: string;
    pageType?: string;
    navigationLabel: string | null;
    navigationOrder: number;
    metaDescription?: string | null;
    content?: string | null;
    contentJson?: string | null;
    parentPageId?: string | null;
    isPublished?: boolean;
    is_published?: boolean;
  }>;
  blogPosts: Array<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    coverImageUrl: string | null;
    cover_image_url?: string | null;
    author_name?: string | null;
    authorName?: string | null;
    published_at?: string | null;
    publishedAt?: string | null;
    content?: string | null;
    content_html?: string | null;
    category?: string | null;
    tags?: string[] | null;
    featured_post?: boolean | null;
    featuredPost?: boolean | null;
    view_count?: number | null;
    viewCount?: number | null;
  }>;
  projects: Array<{
    id: string;
    title: string;
    shortDescription: string | null;
    short_description?: string | null;
    fullDescription?: string | null;
    full_description?: string | null;
    coverImageUrl: string | null;
    cover_image_url?: string | null;
    projectType: string | null;
    project_type?: string | null;
    location?: string | null;
    completion_date?: string | null;
    completionDate?: string | null;
  }>;
  socialLinks: {
    facebookUrl: string | null;
    instagramUrl: string | null;
    linkedinUrl: string | null;
    youtubeUrl: string | null;
    tiktokUrl: string | null;
  } | null;
  careersEnabled?: boolean;
  careersIntroText?: string | null;
  subdomain?: string;
  headerConfig?: HeaderComponentsConfig | null;
  footerConfig?: FooterComponentsConfig | null;
  bodyConfig?: BodyComponentsConfig | null;
  footerLayoutSettings?: {
    footerColumns?: number;
    sectionSettings?: {
      top?: { columns?: number; width?: string; sectionPadding?: number; backgroundType?: string; backgroundColor?: string; gradientStart?: string; gradientEnd?: string; gradientDirection?: string; backgroundImageUrl?: string; backgroundSize?: string; backgroundPosition?: string; padding?: number; margin?: number; gap?: number };
      middle?: { columns?: number; width?: string; sectionPadding?: number; backgroundType?: string; backgroundColor?: string; gradientStart?: string; gradientEnd?: string; gradientDirection?: string; backgroundImageUrl?: string; backgroundSize?: string; backgroundPosition?: string; padding?: number; margin?: number; gap?: number };
      bottom?: { columns?: number; width?: string; sectionPadding?: number; backgroundType?: string; backgroundColor?: string; gradientStart?: string; gradientEnd?: string; gradientDirection?: string; backgroundImageUrl?: string; backgroundSize?: string; backgroundPosition?: string; padding?: number; margin?: number; gap?: number };
    } | null;
  } | null;
  headerLayoutSettings?: {
    headerType?: string;
    headerHeight?: number;
    sectionSettings?: {
      top?: { columns?: number; width?: string; sectionPadding?: number; backgroundType?: string; backgroundColor?: string; gradientStart?: string; gradientEnd?: string; gradientDirection?: string; backgroundImageUrl?: string; backgroundSize?: string; backgroundPosition?: string; padding?: number; margin?: number; gap?: number };
      middle?: { columns?: number; width?: string; sectionPadding?: number; backgroundType?: string; backgroundColor?: string; gradientStart?: string; gradientEnd?: string; gradientDirection?: string; backgroundImageUrl?: string; backgroundSize?: string; backgroundPosition?: string; padding?: number; margin?: number; gap?: number };
      bottom?: { columns?: number; width?: string; sectionPadding?: number; backgroundType?: string; backgroundColor?: string; gradientStart?: string; gradientEnd?: string; gradientDirection?: string; backgroundImageUrl?: string; backgroundSize?: string; backgroundPosition?: string; padding?: number; margin?: number; gap?: number };
    } | null;
  } | null;
}

interface CareersJob {
  id: string;
  title: string;
  trade?: string | null;
  location?: string | null;
  employmentType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  description?: string | null;
  requirements?: string | null;
  benefits?: string | null;
  screeningQuestions?: Array<{ question: string; required?: boolean }> | null;
  createdAt?: string | null;
  created_at?: string | null;
}

interface CareersJobDetail extends CareersJob {
  organizationName?: string | null;
}

type PageView = "home" | "about" | "services" | "blog" | "gallery" | "contact" | "blog-post" | "project-detail" | string;

interface WebsitePreviewRendererProps {
  data: PreviewData;
  deviceType: "desktop" | "tablet" | "mobile";
  websiteId?: string;
  trackingEnabled?: boolean;
  onPageChange?: (slug: string) => void;
}

export default function WebsitePreviewRenderer({ data, deviceType, websiteId, trackingEnabled, onPageChange }: WebsitePreviewRendererProps) {
  const { website, organization, socialLinks } = data;
  // Default to empty arrays to prevent crashes when data is undefined
  const pages = data.pages || [];
  const blogPosts = data.blogPosts || [];
  const projects = data.projects || [];
  
  // State for interactive navigation
  const [currentPage, setCurrentPage] = useState<PageView>("home");
  const [selectedBlogPost, setSelectedBlogPost] = useState<typeof blogPosts[0] | null>(null);
  const [selectedProject, setSelectedProject] = useState<typeof projects[0] | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contactFormSubmitted, setContactFormSubmitted] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CareersJob | null>(null);
  const [jobDetailData, setJobDetailData] = useState<CareersJobDetail | null>(null);
  const [careersJobs, setCareersJobs] = useState<CareersJob[]>([]);
  const [careersLoaded, setCareersLoaded] = useState(false);
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [applicationSubmitting, setApplicationSubmitting] = useState(false);
  const [careersFilter, setCareersFilter] = useState({ trade: '', location: '', employmentType: '' });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [expandedMobileMenus, setExpandedMobileMenus] = useState<Set<string>>(new Set());
  const [faqOpenItems, setFaqOpenItems] = useState<Set<string>>(new Set());

  const sessionIdRef = useRef(`session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`);
  const trackedPagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (onPageChange) onPageChange(currentPage);
  }, [currentPage, onPageChange]);

  useEffect(() => {
    const subdomain = data.subdomain || '';
    if (!subdomain || careersLoaded) return;
    setCareersLoaded(true);
    fetch(`/api/website/public/${subdomain}/careers`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setCareersJobs(d.jobs || []))
      .catch(() => setCareersJobs([]));
  }, [data.subdomain, careersLoaded]);

  useEffect(() => {
    if (!trackingEnabled || !websiteId) return;

    const pageKey = `${currentPage}_${selectedBlogPost?.id || ''}_${selectedProject?.id || ''}`;
    if (trackedPagesRef.current.has(pageKey)) return;
    trackedPagesRef.current.add(pageKey);

    let visitorId = localStorage.getItem('sma_visitor_id');
    if (!visitorId) {
      visitorId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem('sma_visitor_id', visitorId);
    }

    const pagePath = currentPage === 'home' ? '/' : `/${currentPage}`;
    const pageTitle = selectedBlogPost?.title || selectedProject?.title || currentPage;

    fetch('/api/website/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteId,
        sessionId: sessionIdRef.current,
        visitorId,
        eventType: 'PAGE_VIEW',
        pagePath,
        pageTitle,
        referrer: document.referrer || '',
      }),
    }).catch(() => {});
  }, [trackingEnabled, websiteId, currentPage, selectedBlogPost?.id, selectedProject?.id]);

  const buildTextStyle = (content: Record<string, string> | undefined, defaults: { fontSize?: string; color?: string; fontWeight?: string } = {}): React.CSSProperties => {
    if (!content) return {};
    const style: React.CSSProperties = {};
    if (content.fontFamily) {
      style.fontFamily = `"${content.fontFamily}", sans-serif`;
      loadGoogleFont(content.fontFamily);
    }
    style.fontSize = content.fontSize ? `${content.fontSize}px` : defaults.fontSize;
    style.color = content.textColor || defaults.color;
    style.textAlign = (content.textAlign as any) || undefined;
    style.textTransform = (content.textTransform as any) || undefined;
    style.letterSpacing = content.letterSpacing ? `${content.letterSpacing}px` : undefined;
    style.lineHeight = content.lineHeight || undefined;
    style.padding = content.padding ? `${content.padding}px` : undefined;
    style.margin = content.margin ? `${content.margin}px` : undefined;
    if (content.fontWeight) {
      style.fontWeight = content.fontWeight;
    } else if (content.fontStyle === 'bold' || content.fontStyle === 'bold-italic') {
      style.fontWeight = '700';
    } else {
      style.fontWeight = defaults.fontWeight;
    }
    if (content.fontStyle === 'italic' || content.fontStyle === 'bold-italic') {
      style.fontStyle = 'italic';
    }
    return style;
  };
  
  const siteName = website.siteTitle || organization?.name || "Your Company";
  const tagline = website.siteTagline || "Building Excellence";
  const primaryColor = website.primaryColor || "#3B82F6";
  const secondaryColor = website.secondaryColor || "#1E40AF";
  const accentColor = website.accentColor || "#F59E0B";
  const bgColor = website.backgroundColor || "#FFFFFF";
  const textColor = website.textColor || "#1F2937";
  const fontFamily = website.fontFamily || "Inter, system-ui, sans-serif";

  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  // Navigation handler
  const navigateTo = (page: PageView) => {
    setCurrentPage(page);
    setSelectedBlogPost(null);
    setSelectedProject(null);
    setSelectedJob(null);
    setJobDetailData(null);
    setMobileMenuOpen(false);
    setContactFormSubmitted(false);
    setApplicationSubmitted(false);
  };

  // Helper to find custom page content
  const findPageContent = (slug: string) => {
    return pages.find(p => 
      p.pageSlug?.toLowerCase() === slug.toLowerCase() ||
      p.pageType?.toLowerCase() === slug.toLowerCase()
    );
  };

  // Get nav items - combine default pages with custom pages from database
  type NavItem = { id: string; label: string; slug: string; isCustom?: boolean; children?: NavItem[] };
  const getNavItems = () => {
    const items: NavItem[] = [
      { id: "home", label: "Home", slug: "home" },
    ];
    
    const publishedPages = pages.filter(p => (p.isPublished ?? p.is_published) !== false);
    const customPages = publishedPages
      .filter(p => p.pageSlug && !["home", "blog", "gallery", "contact"].includes(p.pageSlug.toLowerCase()))
      .sort((a, b) => (a.navigationOrder || 0) - (b.navigationOrder || 0));
    
    items.push({ id: "about", label: "About", slug: "about" });
    items.push({ id: "services", label: "Services", slug: "services" });
    
    // Build a map of parent page IDs to their child pages
    const childPages = new Map<string, typeof customPages>();
    const topLevelCustomPages: typeof customPages = [];
    
    customPages.forEach(page => {
      if (!["about", "services"].includes(page.pageSlug?.toLowerCase() || "")) {
        if (page.parentPageId) {
          const existing = childPages.get(page.parentPageId) || [];
          existing.push(page);
          childPages.set(page.parentPageId, existing);
        } else {
          topLevelCustomPages.push(page);
        }
      }
    });
    
    // Add top-level custom pages with their children
    topLevelCustomPages.forEach(page => {
      const navItem: NavItem = {
        id: page.id,
        label: page.navigationLabel || page.pageTitle,
        slug: `custom-${page.id}`,
        isCustom: true,
      };
      const children = childPages.get(page.id);
      if (children && children.length > 0) {
        navItem.children = children.map(child => ({
          id: child.id,
          label: child.navigationLabel || child.pageTitle,
          slug: `custom-${child.id}`,
          isCustom: true,
        }));
      }
      items.push(navItem);
    });
    
    // Also attach children to built-in pages (about, services) if any page references them
    const builtInPageMap: Record<string, string> = {};
    publishedPages.forEach(p => {
      if (p.pageSlug?.toLowerCase() === "about" || p.pageType?.toLowerCase() === "about") builtInPageMap[p.id] = "about";
      if (p.pageSlug?.toLowerCase() === "services" || p.pageType?.toLowerCase() === "services") builtInPageMap[p.id] = "services";
    });
    for (const [pageId, builtInSlug] of Object.entries(builtInPageMap)) {
      const children = childPages.get(pageId);
      if (children && children.length > 0) {
        const parentItem = items.find(i => i.slug === builtInSlug);
        if (parentItem) {
          parentItem.children = (parentItem.children || []).concat(
            children.map(child => ({
              id: child.id,
              label: child.navigationLabel || child.pageTitle,
              slug: `custom-${child.id}`,
              isCustom: true,
            }))
          );
        }
      }
    }
    
    if (website.galleryEnabled !== false && projects.length > 0) {
      items.push({ id: "gallery", label: "Gallery", slug: "gallery" });
    }
    if (website.blogEnabled !== false && blogPosts.length > 0) {
      items.push({ id: "blog", label: "Blog", slug: "blog" });
    }
    if (data.careersEnabled) {
      items.push({ id: "careers", label: "Careers", slug: "careers" });
    }
    items.push({ id: "contact", label: "Contact", slug: "contact" });
    
    return items;
  };

  const navItems = getNavItems();

  const getBodyComponentStyles = (styles: SharedStyles): React.CSSProperties => {
    const s: React.CSSProperties = {};
    const spacingMap: Record<string, string> = { '0': '0', '1': '0.25rem', '2': '0.5rem', '3': '0.75rem', '4': '1rem', '5': '1.25rem', '6': '1.5rem', '8': '2rem', '10': '2.5rem', '12': '3rem', '16': '4rem', '20': '5rem', '24': '6rem' };
    if (styles.spacing) {
      const resolve = (val: string | undefined) => val && val !== '' ? (spacingMap[val] || `${val}rem`) : undefined;
      s.paddingTop = resolve(styles.spacing.paddingTop);
      s.paddingBottom = resolve(styles.spacing.paddingBottom);
      s.paddingLeft = resolve(styles.spacing.paddingLeft);
      s.paddingRight = resolve(styles.spacing.paddingRight);
    }
    if (styles.background) {
      const bgType = styles.background.type as string;
      if ((bgType === 'color' || bgType === 'solid') && styles.background.color) {
        s.backgroundColor = styles.background.color;
      } else if (styles.background.type === 'gradient') {
        const dirMap: Record<string, string> = { 'to-t': 'to top', 'to-b': 'to bottom', 'to-l': 'to left', 'to-r': 'to right', 'to-tr': 'to top right', 'to-tl': 'to top left', 'to-br': 'to bottom right', 'to-bl': 'to bottom left' };
        const dir = dirMap[styles.background.gradientDirection || 'to-b'] || 'to bottom';
        s.background = `linear-gradient(${dir}, ${styles.background.gradientFrom || primaryColor}, ${styles.background.gradientTo || secondaryColor})`;
      } else if (styles.background.type === 'image' && styles.background.imageUrl) {
        s.backgroundImage = `url(${styles.background.imageUrl})`;
        s.backgroundSize = styles.background.imageSize || 'cover';
        s.backgroundPosition = styles.background.imagePosition || 'center';
        s.backgroundAttachment = (styles.background.imageAttachment || 'scroll') as React.CSSProperties['backgroundAttachment'];
        s.backgroundRepeat = (styles.background.imageRepeat || 'no-repeat') as React.CSSProperties['backgroundRepeat'];
      }
    }
    if (styles.typography) {
      if (styles.typography.color) s.color = styles.typography.color;
      const fwMap: Record<string, number> = { light: 300, normal: 400, medium: 500, semibold: 600, bold: 700 };
      if (styles.typography.fontWeight) s.fontWeight = fwMap[styles.typography.fontWeight] || 400;
      const fsMap: Record<string, string> = { xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem' };
      if (styles.typography.fontSize) s.fontSize = fsMap[styles.typography.fontSize] || styles.typography.fontSize;
      if (styles.typography.fontFamily && styles.typography.fontFamily !== 'inherit') {
        const genericMap: Record<string, string> = { sans: 'system-ui, -apple-system, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", monospace' };
        if (genericMap[styles.typography.fontFamily]) {
          s.fontFamily = genericMap[styles.typography.fontFamily];
        } else {
          s.fontFamily = `"${styles.typography.fontFamily}", sans-serif`;
          loadGoogleFont(styles.typography.fontFamily);
        }
      }
      if (styles.typography.fontStyle) s.fontStyle = styles.typography.fontStyle as React.CSSProperties['fontStyle'];
      if (styles.typography.textTransform) s.textTransform = styles.typography.textTransform as React.CSSProperties['textTransform'];
      if (styles.typography.letterSpacing) s.letterSpacing = `${styles.typography.letterSpacing}px`;
      if (styles.typography.textAlign) s.textAlign = styles.typography.textAlign as React.CSSProperties['textAlign'];
    }
    if (styles.alignment && !styles.typography?.textAlign) s.textAlign = styles.alignment as React.CSSProperties['textAlign'];
    return s;
  };

  const renderVideoBackground = (styles: SharedStyles) => {
    if (styles.background?.type === 'video' && styles.background.videoUrl) {
      return (
        <video
          src={styles.background.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        />
      );
    }
    return null;
  };

  const renderOverlay = (styles: SharedStyles) => {
    const overlay = styles.background?.overlay;
    if (!overlay?.enabled) return null;
    const opacity = (overlay.opacity ?? 50) / 100;
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex: 0,
      pointerEvents: 'none',
    };
    if (overlay.type === 'color') {
      return <div style={{ ...baseStyle, backgroundColor: overlay.color || '#000000', opacity }} />;
    }
    if (overlay.type === 'gradient') {
      const dirMap: Record<string, string> = { 'to-t': 'to top', 'to-b': 'to bottom', 'to-l': 'to left', 'to-r': 'to right', 'to-tr': 'to top right', 'to-tl': 'to top left', 'to-br': 'to bottom right', 'to-bl': 'to bottom left' };
      const dir = dirMap[overlay.gradientDirection || 'to-b'] || 'to bottom';
      return <div style={{ ...baseStyle, background: `linear-gradient(${dir}, ${overlay.gradientFrom || '#000000'}, ${overlay.gradientTo || '#000000'})`, opacity }} />;
    }
    if (overlay.type === 'image' && overlay.imageUrl) {
      return <div style={{ ...baseStyle, backgroundImage: `url(${overlay.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity }} />;
    }
    return null;
  };

  const renderBodyButton = (btn: ButtonConfig, idx: number) => {
    const variant = btn.variant || 'primary';
    const btnStyle: React.CSSProperties = variant === 'primary'
      ? { backgroundColor: primaryColor, color: '#fff', border: 'none' }
      : variant === 'outline' || variant === 'secondary'
      ? { backgroundColor: 'transparent', color: primaryColor, border: `2px solid ${primaryColor}` }
      : { backgroundColor: 'transparent', color: primaryColor, border: 'none', textDecoration: 'underline' };
    const baseStyle: React.CSSProperties = { ...btnStyle, padding: '0.6rem 1.5rem', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' };
    const s = btn.style;
    if (s) {
      if (s.backgroundColor) baseStyle.backgroundColor = s.backgroundColor;
      if (s.textColor) baseStyle.color = s.textColor;
      if (s.borderColor) baseStyle.borderColor = s.borderColor;
      if (s.borderWidth) { baseStyle.borderWidth = `${s.borderWidth}px`; baseStyle.borderStyle = 'solid'; }
      if (s.borderRadius) baseStyle.borderRadius = `${s.borderRadius}px`;
      if (s.paddingX || s.paddingY) baseStyle.padding = `${s.paddingY || '0.6rem'}${s.paddingY ? 'px' : ''} ${s.paddingX || '1.5rem'}${s.paddingX ? 'px' : ''}`;
      if (s.fontFamily) { loadGoogleFont(s.fontFamily); baseStyle.fontFamily = `'${s.fontFamily}', sans-serif`; }
      if (s.fontSize) baseStyle.fontSize = `${s.fontSize}px`;
      if (s.fontWeight) baseStyle.fontWeight = s.fontWeight as any;
    }
    const isSafeUrl = (url: string) => {
      const trimmed = url.trim();
      if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return true;
      try { const u = new URL(trimmed); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
    };
    if (btn.url && isSafeUrl(btn.url)) {
      const isExternal = btn.url.startsWith('http');
      return (
        <a
          key={idx}
          href={btn.url}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          data-testid={`body-button-${idx}`}
          style={{ ...baseStyle, display: 'inline-block', textDecoration: 'none' }}
        >
          {btn.text || 'Click Here'}
        </a>
      );
    }
    return (
      <button
        key={idx}
        data-testid={`body-button-${idx}`}
        style={baseStyle}
      >
        {btn.text || 'Click Here'}
      </button>
    );
  };

  const shouldShowComponent = (comp: BodyComponent): boolean => {
    if (!comp.enabled) return false;
    if (isMobile && !comp.visibleMobile) return false;
    if (!isMobile && !comp.visibleDesktop) return false;
    return true;
  };

  const renderSocialIconsFromData = () => {
    if (!socialLinks) return null;
    const icons = [];
    if (socialLinks.facebookUrl) icons.push(<a key="fb" href="#" style={{ color: 'inherit' }}><SiFacebook size={18} /></a>);
    if (socialLinks.instagramUrl) icons.push(<a key="ig" href="#" style={{ color: 'inherit' }}><SiInstagram size={18} /></a>);
    if (socialLinks.linkedinUrl) icons.push(<a key="li" href="#" style={{ color: 'inherit' }}><SiLinkedin size={18} /></a>);
    if (socialLinks.youtubeUrl) icons.push(<a key="yt" href="#" style={{ color: 'inherit' }}><SiYoutube size={18} /></a>);
    if (socialLinks.tiktokUrl) icons.push(<a key="tt" href="#" style={{ color: 'inherit' }}><SiTiktok size={18} /></a>);
    return icons.length > 0 ? <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>{icons}</div> : null;
  };

  const renderHeaderElement = (el: HeaderElement) => {
    switch (el.type) {
      case 'logo':
        return (
          <button
            key={el.id}
            data-testid="header-config-logo"
            onClick={() => navigateTo("home")}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {website.logoUrl ? (
              <img src={website.logoUrl} alt={siteName} style={{ height: `${website.logoHeight || 55}px`, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontWeight: 700, fontSize: '1.25rem', color: primaryColor }}>{siteName}</span>
            )}
          </button>
        );
      case 'navigation':
        return (
          <nav key={el.id} data-testid="header-config-nav" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {navItems.map(item => (
              item.children && item.children.length > 0 ? (
                <div
                  key={item.id}
                  className="relative"
                  onMouseEnter={() => setOpenDropdown(item.id)}
                  onMouseLeave={() => setOpenDropdown(null)}
                >
                  <button
                    onClick={() => navigateTo(item.slug as PageView)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, color: currentPage === item.slug || item.children.some(c => currentPage === c.slug) ? primaryColor : '#374151', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    data-testid={`preview-nav-${item.slug}`}
                  >
                    {item.label}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {openDropdown === item.id && (
                    <div
                      className="absolute top-full left-0 mt-1 min-w-[180px] rounded-md shadow-lg py-1 z-50"
                      style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb' }}
                    >
                      {item.children.map(child => (
                        <button
                          key={child.id}
                          onClick={() => { navigateTo(child.slug as PageView); setOpenDropdown(null); }}
                          className="w-full text-left px-4 py-2 text-sm hover:opacity-80 transition-opacity"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: currentPage === child.slug ? primaryColor : '#374151',
                            backgroundColor: currentPage === child.slug ? `${primaryColor}10` : 'transparent'
                          }}
                          data-testid={`preview-nav-${child.slug}`}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  key={item.id}
                  onClick={() => navigateTo(item.slug as PageView)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, color: currentPage === item.slug ? primaryColor : '#374151' }}
                  data-testid={`preview-nav-${item.slug}`}
                >
                  {item.label}
                </button>
              )
            ))}
          </nav>
        );
      case 'cta_button':
        return (
          <button
            key={el.id}
            data-testid="header-config-cta"
            style={{ backgroundColor: primaryColor, color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
          >
            {el.content?.text || 'Get Started'}
          </button>
        );
      case 'search_icon':
        return (
          <button key={el.id} data-testid="header-config-search" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>
            <Search size={20} />
          </button>
        );
      case 'login_button':
        return (
          <button
            key={el.id}
            data-testid="header-config-login"
            style={{ backgroundColor: 'transparent', color: primaryColor, border: `1px solid ${primaryColor}`, padding: '0.4rem 0.875rem', borderRadius: '0.375rem', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' }}
          >
            {el.content?.text || 'Login'}
          </button>
        );
      case 'social_icons':
        return <div key={el.id} data-testid="header-config-social">{renderSocialIconsFromData()}</div>;
      case 'announcement_bar': {
        const announceStyle = buildTextStyle(el.content, { fontSize: '0.8125rem', color: '#fff' });
        return (
          <div
            key={el.id}
            data-testid="header-config-announcement"
            style={{ width: '100%', backgroundColor: primaryColor, textAlign: 'center', padding: '0.375rem 1rem', ...announceStyle }}
          >
            {el.content?.text || 'Welcome to our site!'}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const mobileNavStyle = (website.mobileNavStyle as string) || 'dropdown';

  const renderMobileNavContent = (menuBg: string, menuText: string, extraElements?: React.ReactNode) => {
    return (
      <div style={{ padding: '1rem' }}>
        {navItems.map(item => (
          <div key={item.id}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => { navigateTo(item.slug as PageView || item.id); setMobileMenuOpen(false); }}
                style={{ flex: 1, display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.625rem 0', fontSize: '0.9375rem', cursor: 'pointer', color: currentPage === item.slug || currentPage === item.id ? primaryColor : menuText, fontWeight: currentPage === item.slug || currentPage === item.id ? 600 : 400 }}
                data-testid={`preview-nav-mobile-${item.slug || item.id}`}
              >
                {item.label}
              </button>
              {item.children && item.children.length > 0 && (
                <button
                  onClick={() => {
                    setExpandedMobileMenus(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    });
                  }}
                  style={{ background: 'none', border: 'none', padding: '0.625rem 0.25rem', cursor: 'pointer', color: menuText }}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${expandedMobileMenus.has(item.id) ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            {item.children && item.children.length > 0 && expandedMobileMenus.has(item.id) && (
              <div style={{ paddingLeft: '1rem', borderLeft: `2px solid ${primaryColor}30` }}>
                {item.children.map(child => (
                  <button
                    key={child.id}
                    onClick={() => { navigateTo(child.slug as PageView); setMobileMenuOpen(false); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.5rem 0', fontSize: '0.875rem', cursor: 'pointer', color: currentPage === child.slug ? primaryColor : menuText }}
                    data-testid={`preview-nav-mobile-${child.slug}`}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {extraElements && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            {extraElements}
          </div>
        )}
      </div>
    );
  };

  const renderMobileMenu = (menuBg: string, menuText: string, extraElements?: React.ReactNode) => {
    if (!mobileMenuOpen) return null;

    if (mobileNavStyle === 'slide-left' || mobileNavStyle === 'slide-right') {
      const isLeft = mobileNavStyle === 'slide-left';
      return (
        <div
          style={{ position: 'sticky', top: 0, left: 0, width: '100%', height: 0, zIndex: 998, marginTop: 0 }}
        >
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '5000px', backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 998 }}
            data-testid="mobile-nav-overlay"
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              [isLeft ? 'left' : 'right']: 0,
              width: '280px',
              maxWidth: '80%',
              height: '600px',
              backgroundColor: menuBg,
              boxShadow: isLeft ? '4px 0 16px rgba(0,0,0,0.15)' : '-4px 0 16px rgba(0,0,0,0.15)',
              zIndex: 999,
              display: 'flex',
              flexDirection: 'column' as const,
              animation: `slideIn${isLeft ? 'Left' : 'Right'} 0.25s ease-out`,
            }}
            data-testid={`mobile-nav-panel-${isLeft ? 'left' : 'right'}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: `1px solid ${primaryColor}15` }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: primaryColor }}>{siteName}</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: menuText, padding: '0.25rem' }}
                data-testid="mobile-nav-close"
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {renderMobileNavContent(menuBg, menuText, extraElements)}
            </div>
          </div>
          <style>{`
            @keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }
            @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
          `}</style>
        </div>
      );
    }

    if (mobileNavStyle === 'popup') {
      return (
        <div
          style={{ position: 'sticky', top: 0, left: 0, width: '100%', height: 0, zIndex: 998, marginTop: 0 }}
        >
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '5000px', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '2rem' }}
            data-testid="mobile-nav-overlay"
          />
          <div
            style={{
              position: 'absolute',
              top: '1rem',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '90%',
              maxWidth: '360px',
              maxHeight: '500px',
              backgroundColor: menuBg,
              borderRadius: '0.75rem',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              zIndex: 999,
              display: 'flex',
              flexDirection: 'column' as const,
              animation: 'popupFadeIn 0.2s ease-out',
              overflow: 'hidden',
            }}
            data-testid="mobile-nav-popup"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: `1px solid ${primaryColor}15` }}>
              <span style={{ fontWeight: 700, fontSize: '1.125rem', color: primaryColor }}>{siteName}</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: menuText, padding: '0.25rem' }}
                data-testid="mobile-nav-close"
              >
                <X size={22} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.25rem 0.25rem' }}>
              {renderMobileNavContent(menuBg, menuText, extraElements)}
            </div>
          </div>
          <style>{`
            @keyframes popupFadeIn { from { opacity: 0; transform: translateX(-50%) scale(0.95); } to { opacity: 1; transform: translateX(-50%) scale(1); } }
          `}</style>
        </div>
      );
    }

    return (
      <div
        style={{ backgroundColor: menuBg, borderTop: `1px solid ${primaryColor}15`, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
        data-testid="mobile-nav-dropdown"
      >
        {renderMobileNavContent(menuBg, menuText, extraElements)}
      </div>
    );
  };

  const buildColumnStyle = (cs?: ColumnSettings, flexDir: 'row' | 'column' = 'column'): React.CSSProperties => {
    if (!cs) return {};
    const style: React.CSSProperties = {};
    const hMap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end', stretch: 'stretch' };
    const vMap: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end', stretch: 'stretch' };
    const hVal = hMap[cs.alignment] || 'flex-start';
    const vVal = vMap[cs.verticalAlignment || 'top'] || 'flex-start';
    if (flexDir === 'row') {
      style.justifyContent = hVal;
      style.alignItems = vVal;
    } else {
      style.alignItems = hVal;
      style.justifyContent = vVal;
    }
    if (cs.backgroundType === 'solid' && cs.backgroundColor) {
      style.backgroundColor = cs.backgroundColor;
    } else if (cs.backgroundType === 'gradient') {
      style.background = `linear-gradient(${cs.gradientDirection || 'to bottom'}, ${cs.gradientStart || '#ffffff'}, ${cs.gradientEnd || '#f3f4f6'})`;
    }
    if (cs.paddingTop || cs.paddingRight || cs.paddingBottom || cs.paddingLeft) {
      style.padding = `${cs.paddingTop || 0}px ${cs.paddingRight || 0}px ${cs.paddingBottom || 0}px ${cs.paddingLeft || 0}px`;
    }
    if (cs.marginTop || cs.marginRight || cs.marginBottom || cs.marginLeft) {
      style.margin = `${cs.marginTop || 0}px ${cs.marginRight || 0}px ${cs.marginBottom || 0}px ${cs.marginLeft || 0}px`;
    }
    return style;
  };

  const buildSectionBorderStyle = (ss?: { borderWidth?: number; borderColor?: string; borderStyle?: string; borderRadius?: number }): React.CSSProperties => {
    if (!ss) return {};
    const style: React.CSSProperties = {};
    if (ss.borderStyle && ss.borderStyle !== 'none' && (ss.borderWidth ?? 0) > 0) {
      style.borderWidth = `${ss.borderWidth}px`;
      style.borderColor = ss.borderColor || '#e5e7eb';
      style.borderStyle = ss.borderStyle as any;
    }
    if ((ss.borderRadius ?? 0) > 0) {
      style.borderRadius = `${ss.borderRadius}px`;
    }
    return style;
  };

  const mapAlignment = (val?: string): string | undefined => {
    const m: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end', stretch: 'stretch' };
    return val ? m[val] : undefined;
  };

  const renderConfiguredHeader = () => {
    const config = data.headerConfig!;
    if (isMobile) {
      const mobileElements = config.mobile.elements.filter(e => e.enabled && e.visibleMobile).sort((a, b) => a.order - b.order);
      const hasAnnouncement = mobileElements.find(e => e.type === 'announcement_bar');
      const otherElements = mobileElements.filter(e => e.type !== 'announcement_bar' && e.type !== 'navigation');
      const extraButtons = otherElements.filter(e => e.type === 'cta_button' || e.type === 'login_button');
      return (
        <header data-testid="configured-header" style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#fff', position: 'relative' }}>
          {hasAnnouncement && renderHeaderElement(hasAnnouncement)}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {otherElements.filter(e => e.type === 'logo').map(e => renderHeaderElement(e))}
            </div>
            <button
              data-testid="header-mobile-menu-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#374151' }}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
          {renderMobileMenu('#fff', '#374151', extraButtons.length > 0 ? <>{extraButtons.map(e => renderHeaderElement(e))}</> : undefined)}
        </header>
      );
    }

    const sections = ['top', 'middle', 'bottom'] as const;
    const headerSectionStyles = data.headerLayoutSettings?.sectionSettings;

    const getHeaderSectionBackground = (key: typeof sections[number]): React.CSSProperties => {
      const ss = headerSectionStyles?.[key];
      if (!ss) return {};
      const style: React.CSSProperties = {};
      if (ss.backgroundType === 'solid' && ss.backgroundColor) {
        style.backgroundColor = ss.backgroundColor;
      } else if (ss.backgroundType === 'gradient') {
        style.background = `linear-gradient(${ss.gradientDirection || 'to bottom'}, ${ss.gradientStart || '#ffffff'}, ${ss.gradientEnd || '#f3f4f6'})`;
      } else if (ss.backgroundType === 'image' && ss.backgroundImageUrl) {
        style.backgroundImage = `url(${ss.backgroundImageUrl})`;
        style.backgroundSize = ss.backgroundSize || 'cover';
        style.backgroundPosition = ss.backgroundPosition || 'center';
        style.backgroundRepeat = 'no-repeat';
      }
      return style;
    };

    return (
      <header data-testid="configured-header" style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#fff' }}>
        {sections.map(sectionKey => {
          const section = config.desktop.sections[sectionKey];
          const elements = section.elements.filter(e => e.enabled && e.visibleDesktop).sort((a, b) => a.order - b.order);
          if (elements.length === 0) return null;
          const hasAnnouncement = elements.find(e => e.type === 'announcement_bar');
          if (hasAnnouncement && elements.length === 1) {
            return <div key={sectionKey}>{renderHeaderElement(hasAnnouncement)}</div>;
          }
          const leftEls = elements.filter(e => e.alignment === 'left' && e.type !== 'announcement_bar');
          const centerEls = elements.filter(e => e.alignment === 'center' && e.type !== 'announcement_bar');
          const rightEls = elements.filter(e => e.alignment === 'right' && e.type !== 'announcement_bar');
          const hss = headerSectionStyles?.[sectionKey];
          const headerSectionBg = getHeaderSectionBackground(sectionKey);
          const hPadding = hss?.sectionPadding != null ? `${hss.sectionPadding}px` : undefined;
          const hWidth = hss?.width || 'boxed';
          const hBorderStyle = buildSectionBorderStyle(hss);
          const hJustify = hss?.horizontalAlignment && hss.horizontalAlignment !== 'stretch' ? mapAlignment(hss.horizontalAlignment) : 'space-between';
          const hAlignItems = hss?.verticalAlignment ? (mapAlignment(hss.verticalAlignment) || 'center') : 'center';
          return (
            <div key={sectionKey} style={{ ...headerSectionBg, ...hBorderStyle }}>
              {hasAnnouncement && renderHeaderElement(hasAnnouncement)}
              <div style={{
                display: 'flex', alignItems: hAlignItems, justifyContent: hJustify,
                padding: hPadding || (sectionKey === 'top' ? '0.25rem 1.5rem' : '0.5rem 1.5rem'),
                gap: hss?.gap != null ? `${hss.gap}px` : '1rem',
                maxWidth: hWidth === 'boxed' ? '1200px' : '100%',
                margin: hWidth === 'boxed' ? '0 auto' : '0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', ...buildColumnStyle(config.desktop.sections[sectionKey].columnSettings?.[0], 'row') }}>
                  {leftEls.map(e => renderHeaderElement(e))}
                </div>
                {centerEls.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, justifyContent: 'center', ...buildColumnStyle(config.desktop.sections[sectionKey].columnSettings?.[1], 'row') }}>
                    {centerEls.map(e => renderHeaderElement(e))}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', ...buildColumnStyle(config.desktop.sections[sectionKey].columnSettings?.[2], 'row') }}>
                  {rightEls.map(e => renderHeaderElement(e))}
                </div>
              </div>
            </div>
          );
        })}
      </header>
    );
  };

  const renderFooterElement = (el: FooterElement) => {
    switch (el.type) {
      case 'footer_logo': {
        const footerLogoSrc = (el as any).content?.imageUrl || website.logoUrl;
        const footerLogoHeight = (el as any).content?.logoHeight || 28;
        return (
          <div key={el.id} data-testid="footer-config-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {footerLogoSrc ? (
              <img src={footerLogoSrc} alt={siteName} style={{ height: `${footerLogoHeight}px`, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontWeight: 700, fontSize: '1.125rem', color: '#fff' }}>{siteName}</span>
            )}
          </div>
        );
      }
      case 'social_icons':
        return <div key={el.id} data-testid="footer-config-social" style={{ color: '#d1d5db' }}>{renderSocialIconsFromData()}</div>;
      case 'copyright': {
        const copyrightStyle = buildTextStyle(el.content, { fontSize: '0.8125rem', color: '#9ca3af' });
        return (
          <div key={el.id} data-testid="footer-config-copyright" style={copyrightStyle}>
            {el.content?.text || `© ${new Date().getFullYear()} ${siteName}. All rights reserved.`}
          </div>
        );
      }
      case 'link_list': {
        let customLinks: Array<{ title: string; url: string; newTab?: boolean }> = [];
        try { customLinks = el.content?.links ? JSON.parse(el.content.links) : []; } catch { customLinks = []; }
        const hasCustomLinks = customLinks.length > 0;
        const orientation = el.content?.orientation || 'vertical';
        const textSt = buildTextStyle(el.content, { fontSize: '0.8125rem', color: '#d1d5db' });
        const linkStyle: React.CSSProperties = {
          ...textSt,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textDecoration: 'none',
          padding: undefined,
          margin: undefined,
        };
        const containerStyle: React.CSSProperties = {
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          flexDirection: orientation === 'vertical' ? 'column' : 'row',
          padding: el.content?.padding ? `${el.content.padding}px` : '0',
          margin: el.content?.margin ? `${el.content.margin}px` : '0',
        };
        return (
          <div key={el.id} data-testid="footer-config-links" style={containerStyle}>
            {hasCustomLinks ? customLinks.map((link, idx) => (
              <a
                key={idx}
                href={link.url || '#'}
                target={link.newTab ? '_blank' : undefined}
                rel={link.newTab ? 'noopener noreferrer' : undefined}
                style={linkStyle}
              >
                {link.title || 'Untitled'}
              </a>
            )) : navItems.map(item => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                style={linkStyle}
              >
                {item.label}
              </button>
            ))}
          </div>
        );
      }
      case 'footer_title': {
        const titleStyle = buildTextStyle(el.content, { fontSize: '0.9375rem', color: '#fff', fontWeight: '600' });
        return (
          <div key={el.id} data-testid="footer-config-title" style={titleStyle}>
            {el.content?.text || siteName}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const renderConfiguredFooter = () => {
    const config = data.footerConfig!;
    if (isMobile) {
      const mobileElements = config.mobile.elements.filter(e => e.enabled && e.visibleMobile).sort((a, b) => a.order - b.order);
      return (
        <footer data-testid="configured-footer" style={{ backgroundColor: '#1f2937', color: '#fff', padding: '2rem 1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center', textAlign: 'center' }}>
            {mobileElements.map(el => renderFooterElement(el))}
          </div>
        </footer>
      );
    }
    const sections = ['top', 'middle', 'bottom'] as const;
    const sectionStyles = data.footerLayoutSettings?.sectionSettings;
    const globalFooterColumns = data.footerLayoutSettings?.footerColumns || 3;

    const getSectionBackground = (key: typeof sections[number]): React.CSSProperties => {
      const ss = sectionStyles?.[key];
      if (!ss) return {};
      const style: React.CSSProperties = {};
      if (ss.backgroundType === 'solid' && ss.backgroundColor) {
        style.backgroundColor = ss.backgroundColor;
      } else if (ss.backgroundType === 'gradient') {
        style.background = `linear-gradient(${ss.gradientDirection || 'to bottom'}, ${ss.gradientStart || '#1f2937'}, ${ss.gradientEnd || '#111827'})`;
      } else if (ss.backgroundType === 'image' && ss.backgroundImageUrl) {
        style.backgroundImage = `url(${ss.backgroundImageUrl})`;
        style.backgroundSize = ss.backgroundSize || 'cover';
        style.backgroundPosition = ss.backgroundPosition || 'center';
        style.backgroundRepeat = 'no-repeat';
      }
      return style;
    };

    return (
      <footer data-testid="configured-footer" style={{ backgroundColor: '#1f2937', color: '#fff' }}>
        {sections.map(sectionKey => {
          const section = config.desktop.sections[sectionKey];
          const elements = section.elements.filter(e => e.enabled && e.visibleDesktop).sort((a, b) => a.order - b.order);
          if (elements.length === 0) return null;
          const ss = sectionStyles?.[sectionKey];
          const colCount = ss?.columns || section.columns || globalFooterColumns;
          const columnBuckets: Record<number, typeof elements> = {};
          for (let i = 0; i < colCount; i++) columnBuckets[i] = [];
          elements.forEach(el => {
            const col = Math.min(el.column || 0, colCount - 1);
            columnBuckets[col].push(el);
          });
          const footerPadding = ss?.sectionPadding != null ? `${ss.sectionPadding}px` : '40px';
          const sectionPadding = ss?.padding != null ? `${ss.padding}px` : (sectionKey === 'middle' ? '2rem 2rem' : '1rem 2rem');
          const sectionMargin = ss?.margin != null ? `${ss.margin}px` : '0';
          const sectionGap = ss?.gap != null ? `${ss.gap}px` : '1.5rem';
          const sectionWidth = ss?.width || 'boxed';
          const fBorderStyle = buildSectionBorderStyle(ss);
          const fJustifyItems = ss?.horizontalAlignment && ss.horizontalAlignment !== 'stretch' ? mapAlignment(ss.horizontalAlignment) : undefined;
          const fAlignItems = ss?.verticalAlignment ? (mapAlignment(ss.verticalAlignment) || 'start') : 'start';
          return (
            <div
              key={sectionKey}
              style={{
                padding: footerPadding,
                maxWidth: sectionWidth === 'boxed' ? '1200px' : '100%',
                margin: sectionWidth === 'boxed' ? '0 auto' : '0',
                borderBottom: sectionKey !== 'bottom' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                ...getSectionBackground(sectionKey),
                ...fBorderStyle,
              }}
            >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${colCount}, 1fr)`,
                gap: sectionGap,
                padding: sectionPadding,
                margin: sectionMargin,
                alignItems: fAlignItems,
                ...(fJustifyItems ? { justifyItems: fJustifyItems } : {}),
              }}
            >
              {Array.from({ length: colCount }, (_, colIdx) => {
                const colCs = section.columnSettings?.[colIdx];
                const colStyle = buildColumnStyle(colCs);
                return (
                  <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', ...colStyle }}>
                    {(columnBuckets[colIdx] || []).map(el => renderFooterElement(el))}
                  </div>
                );
              })}
            </div>
            </div>
          );
        })}
      </footer>
    );
  };

  const renderBodyComponents = (config: BodyComponentsConfig) => {
    const components = [...config.components].filter(shouldShowComponent).sort((a, b) => a.order - b.order);
    if (components.length === 0) return null;

    const buildBodyTextStyle = (styleRecord?: Record<string, string>, defaults?: React.CSSProperties): React.CSSProperties => {
      const base: React.CSSProperties = { ...defaults };
      if (!styleRecord) return base;
      if (styleRecord.fontFamily && styleRecord.fontFamily !== 'inherit') {
        loadGoogleFont(styleRecord.fontFamily);
        base.fontFamily = `'${styleRecord.fontFamily}', sans-serif`;
      }
      if (styleRecord.fontSize) base.fontSize = `${styleRecord.fontSize}px`;
      if (styleRecord.fontWeight) base.fontWeight = styleRecord.fontWeight as any;
      if (styleRecord.textColor) base.color = styleRecord.textColor;
      if (styleRecord.lineHeight) base.lineHeight = styleRecord.lineHeight;
      if (styleRecord.fontStyle) base.fontStyle = styleRecord.fontStyle as any;
      if (styleRecord.textAlign) base.textAlign = styleRecord.textAlign as any;
      if (styleRecord.textTransform) base.textTransform = styleRecord.textTransform as any;
      if (styleRecord.letterSpacing) base.letterSpacing = `${styleRecord.letterSpacing}px`;
      return base;
    };

    const renderSingleComponent = (comp: BodyComponent) => {
      const containerStyle = getBodyComponentStyles(comp.styles);
      const align = comp.styles.alignment || 'center';
      const cfg = comp.config as any;
      const hasVideoBackground = comp.styles.background?.type === 'video' && comp.styles.background?.videoUrl;
      const hasOverlay = comp.styles.background?.overlay?.enabled;
      const needsPositioning = hasVideoBackground || hasOverlay;
      if (needsPositioning) {
        containerStyle.position = 'relative';
        containerStyle.overflow = 'hidden';
      }
      const contentZStyle: React.CSSProperties = needsPositioning ? { position: 'relative', zIndex: 1 } : {};
      const customClassName = comp.customClass || '';

      switch (comp.type) {
        case 'banner': {
          const { title, content: text, buttons = [], sideImageUrl, titleStyle: bannerTitleStyle, contentStyle: bannerContentStyle } = cfg;
          return (
            <section key={comp.id} data-testid={`body-banner-${comp.id}`} className={customClassName} style={{ ...containerStyle, position: 'relative', overflow: 'hidden' }}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: '2rem' }}>
                <div style={{ flex: 1, textAlign: align as React.CSSProperties['textAlign'] }}>
                  {title && <h2 style={buildBodyTextStyle(bannerTitleStyle, { fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '0.75rem' })}>{title}</h2>}
                  {text && <p style={buildBodyTextStyle(bannerContentStyle, { fontSize: '1rem', opacity: 0.9, marginBottom: '1rem' })}>{text}</p>}
                  {buttons.length > 0 && <div style={{ display: 'flex', gap: '0.75rem', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', flexWrap: 'wrap' }}>{buttons.map((b: ButtonConfig, i: number) => renderBodyButton(b, i))}</div>}
                </div>
                {sideImageUrl && <img src={sideImageUrl} alt="" style={{ maxWidth: isMobile ? '100%' : '40%', borderRadius: '0.5rem', objectFit: 'cover' }} />}
              </div>
            </section>
          );
        }
        case 'hero': {
          const { title, subtitle, content: text, imageUrl, imagePosition = 'right', buttons = [], titleStyle: heroTitleStyle, subtitleStyle: heroSubtitleStyle, contentStyle: heroContentStyle } = cfg;
          const hasImage = !!imageUrl;
          return (
            <section key={comp.id} data-testid={`body-hero-${comp.id}`} className={customClassName} style={{ ...containerStyle, position: 'relative', overflow: 'hidden' }}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{
                ...contentZStyle,
                maxWidth: '72rem',
                margin: '0 auto',
                padding: isMobile ? '3rem 1rem' : '4rem 2rem',
                display: 'flex',
                flexDirection: isMobile
                  ? (imagePosition === 'top' ? 'column-reverse' : imagePosition === 'bottom' ? 'column' : 'column')
                  : imagePosition === 'left' ? 'row-reverse'
                  : imagePosition === 'top' ? 'column-reverse'
                  : imagePosition === 'bottom' ? 'column'
                  : 'row',
                alignItems: (imagePosition === 'top' || imagePosition === 'bottom') ? (align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start') : 'center',
                gap: '2rem'
              }}>
                <div style={{ flex: (imagePosition === 'top' || imagePosition === 'bottom') ? 'none' : 1, width: (imagePosition === 'top' || imagePosition === 'bottom') ? '100%' : undefined, textAlign: align as React.CSSProperties['textAlign'] }}>
                  {subtitle && <p style={buildBodyTextStyle(heroSubtitleStyle, { color: primaryColor, fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' })}>{subtitle}</p>}
                  {title && <h1 style={buildBodyTextStyle(heroTitleStyle, { fontSize: isMobile ? '2rem' : '2.75rem', fontWeight: 800, lineHeight: 1.15, marginBottom: '1rem' })}>{title}</h1>}
                  {text && <p style={buildBodyTextStyle(heroContentStyle, { fontSize: '1.125rem', color: '#6b7280', marginBottom: '1.5rem', lineHeight: 1.6 })}>{text}</p>}
                  {buttons.length > 0 && <div style={{ display: 'flex', gap: '0.75rem', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', flexWrap: 'wrap' }}>{buttons.map((b: ButtonConfig, i: number) => renderBodyButton(b, i))}</div>}
                </div>
                {hasImage && imagePosition !== 'background' && (
                  <div style={{ flex: (imagePosition === 'top' || imagePosition === 'bottom') ? 'none' : 1, width: (imagePosition === 'top' || imagePosition === 'bottom') ? '100%' : undefined }}>
                    <img src={imageUrl} alt="" style={{ width: '100%', borderRadius: '0.75rem', objectFit: 'cover', maxHeight: (imagePosition === 'top' || imagePosition === 'bottom') ? '500px' : '400px' }} />
                  </div>
                )}
              </div>
            </section>
          );
        }
        case 'content': {
          const { title, content: text, titleStyle: contentTitleStyle, contentStyle: contentSectionStyle } = cfg;
          return (
            <section key={comp.id} data-testid={`body-content-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '48rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem', textAlign: align as React.CSSProperties['textAlign'] }}>
                {title && <h2 style={buildBodyTextStyle(contentTitleStyle, { fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1rem' })}>{title}</h2>}
                {text && <div style={buildBodyTextStyle(contentSectionStyle, { whiteSpace: 'pre-wrap' as const, lineHeight: 1.7, color: '#4b5563' })}>{text}</div>}
              </div>
            </section>
          );
        }
        case 'form': {
          const { title, submitButtonText, fields = [], redirectUrl, submitButtonStyle = {}, fieldStyle: globalFieldStyle = {}, recipientEmail, showLabels: showLabelsConfig } = cfg as any;
          const showLabels = showLabelsConfig !== false;
          const inputBaseStyle: React.CSSProperties = {
            width: '100%',
            padding: '0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            ...(globalFieldStyle.backgroundColor ? { backgroundColor: globalFieldStyle.backgroundColor } : {}),
            ...(globalFieldStyle.textColor ? { color: globalFieldStyle.textColor } : {}),
            ...(globalFieldStyle.borderColor ? { borderColor: globalFieldStyle.borderColor } : {}),
            ...(globalFieldStyle.borderRadius ? { borderRadius: `${globalFieldStyle.borderRadius}px` } : {}),
            ...(globalFieldStyle.fontSize ? { fontSize: `${globalFieldStyle.fontSize}px` } : {}),
          };
          const getFieldInputStyle = (field: any): React.CSSProperties => {
            const s = { ...inputBaseStyle };
            if (field.style?.backgroundColor) s.backgroundColor = field.style.backgroundColor;
            if (field.style?.textColor) s.color = field.style.textColor;
            if (field.style?.borderColor) s.borderColor = field.style.borderColor;
            if (field.style?.borderRadius) s.borderRadius = `${field.style.borderRadius}px`;
            if (field.style?.fontSize) s.fontSize = `${field.style.fontSize}px`;
            return s;
          };
          const getLabelStyle = (field: any): React.CSSProperties => ({
            display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem',
            ...(globalFieldStyle.labelColor ? { color: globalFieldStyle.labelColor } : {}),
            ...(field.style?.labelColor ? { color: field.style.labelColor } : {}),
          });
          const getLabelColorStyle = (field: any): React.CSSProperties => ({
            ...(globalFieldStyle.labelColor ? { color: globalFieldStyle.labelColor } : {}),
            ...(field.style?.labelColor ? { color: field.style.labelColor } : {}),
          });
          const submitStyle: React.CSSProperties = {
            backgroundColor: submitButtonStyle.backgroundColor || primaryColor,
            color: submitButtonStyle.textColor || '#fff',
            border: submitButtonStyle.borderWidth ? `${submitButtonStyle.borderWidth}px solid ${submitButtonStyle.borderColor || 'transparent'}` : 'none',
            padding: `${submitButtonStyle.paddingY || '10'}px ${submitButtonStyle.paddingX || '24'}px`,
            borderRadius: submitButtonStyle.borderRadius ? `${submitButtonStyle.borderRadius}px` : '0.375rem',
            fontWeight: submitButtonStyle.fontWeight ? Number(submitButtonStyle.fontWeight) : 600,
            fontSize: submitButtonStyle.fontSize ? `${submitButtonStyle.fontSize}px` : undefined,
            cursor: 'pointer',
            width: submitButtonStyle.width === 'full' ? '100%' : undefined,
            alignSelf: submitButtonStyle.width === 'full' ? undefined : (align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'),
          };
          
          const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const formEl = e.currentTarget;
            const formData = new FormData(formEl);
            
            const honeypot = formData.get('_hp_website_url');
            if (honeypot) return;
            
            const renderTime = formData.get('_form_render_ts');
            if (renderTime && (Date.now() - Number(renderTime)) < 2000) return;
            
            const fieldData: Record<string, string> = {};
            let nameVal = '';
            let emailVal = '';
            let phoneVal = '';
            let messageVal = '';
            let subjectVal = '';
            
            fields.forEach((field: any) => {
              const val = formData.get(field.id);
              if (val !== null) {
                fieldData[field.label] = String(val);
                if (field.type === 'email' || field.label.toLowerCase().includes('email')) emailVal = String(val);
                if (field.label.toLowerCase().includes('name') && !field.label.toLowerCase().includes('company')) nameVal = String(val);
                if (field.type === 'phone' || field.type === 'tel' || field.label.toLowerCase().includes('phone')) phoneVal = String(val);
                if (field.type === 'textarea' || field.label.toLowerCase().includes('message')) messageVal = String(val);
                if (field.type === 'subject' || field.label.toLowerCase().includes('subject')) subjectVal = String(val);
              }
            });
            
            const submitBtn = formEl.querySelector('button[type="submit"]') as HTMLButtonElement;
            const origBtnText = submitBtn?.textContent || submitButtonText || 'Submit';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
            
            const resetBtn = (text?: string) => {
              if (submitBtn) {
                submitBtn.textContent = text || origBtnText;
                submitBtn.disabled = false;
              }
            };
            
            try {
              const formWebsiteId = websiteId || '';
              
              const response = await fetch('/api/website/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  websiteId: formWebsiteId,
                  name: nameVal || 'Website Visitor',
                  email: emailVal || 'noreply@website.com',
                  phone: phoneVal,
                  subject: subjectVal,
                  message: messageVal || JSON.stringify(fieldData),
                  recipientEmail,
                  formFields: fieldData,
                  sourcePage: window.location.pathname,
                  _hp: String(honeypot || ''),
                  _ts: String(renderTime || ''),
                }),
              });
              
              let result: any = {};
              try { result = await response.json(); } catch (err) { console.warn("[WebsitePreview] Failed to parse form response:", err); }
              
              if (response.ok && result.success !== false) {
                formEl.reset();
                if (redirectUrl) {
                  window.location.href = redirectUrl;
                  setTimeout(() => resetBtn(), 5000);
                } else {
                  if (submitBtn) submitBtn.textContent = 'Submitted Successfully!';
                  setTimeout(() => resetBtn(), 4000);
                }
              } else {
                if (submitBtn) submitBtn.textContent = 'Error - Please try again';
                setTimeout(() => resetBtn(), 3000);
              }
            } catch (err) {
              console.error('Form submission error:', err);
              if (submitBtn) submitBtn.textContent = 'Error - Please try again';
              setTimeout(() => resetBtn(), 3000);
            }
          };
          
          return (
            <section key={comp.id} data-testid={`body-form-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '40rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
                    <input type="text" name="_hp_website_url" tabIndex={-1} autoComplete="off" />
                  </div>
                  <input type="hidden" name="_form_render_ts" value={String(Date.now())} />
                  
                  {fields.filter((f: any) => f.enabled !== false).map((field: any) => {
                    const fieldInputStyle = getFieldInputStyle(field);
                    const labelStyle = getLabelStyle(field);
                    const labelColorStyle = getLabelColorStyle(field);
                    if (field.type === 'checkbox') {
                      return (
                        <div key={field.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input type="checkbox" id={field.id} name={field.id} value="yes" style={{ width: '1rem', height: '1rem', accentColor: primaryColor }} />
                          <label htmlFor={field.id} style={{ fontSize: '0.875rem', fontWeight: 500, ...labelColorStyle }}>{field.label}</label>
                        </div>
                      );
                    }
                    if (field.type === 'radio') {
                      return (
                        <div key={field.id}>
                          <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#ef4444' }}> *</span>}</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                            {(field.options || ['Option 1', 'Option 2']).map((opt: string, optIdx: number) => (
                              <div key={optIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="radio" name={field.id} value={opt} style={{ accentColor: primaryColor }} />
                                <label style={{ fontSize: '0.875rem' }}>{opt}</label>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (field.type === 'toggle') {
                      return (
                        <div key={field.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ position: 'relative', width: '2.75rem', height: '1.5rem', backgroundColor: '#d1d5db', borderRadius: '0.75rem', cursor: 'pointer' }}>
                            <div style={{ position: 'absolute', top: '0.125rem', left: '0.125rem', width: '1.25rem', height: '1.25rem', backgroundColor: '#fff', borderRadius: '50%', transition: 'transform 0.2s' }} />
                          </div>
                          <input type="hidden" name={field.id} value="off" />
                          <label style={{ fontSize: '0.875rem', fontWeight: 500, ...labelColorStyle }}>{field.label}</label>
                        </div>
                      );
                    }
                    return (
                      <div key={field.id}>
                        {showLabels && (
                          <label style={labelStyle}>
                            {field.label}{field.required && <span style={{ color: '#ef4444' }}> *</span>}
                          </label>
                        )}
                        {field.type === 'textarea' ? (
                          <textarea name={field.id} placeholder={!showLabels ? (field.required ? `${field.placeholder || field.label} *` : (field.placeholder || field.label)) : (field.placeholder || undefined)} required={field.required} style={{ ...fieldInputStyle, minHeight: '80px' }} />
                        ) : field.type === 'select' ? (
                          <select name={field.id} required={field.required} style={fieldInputStyle}>
                            <option value="">{!showLabels ? (field.required ? `${field.placeholder || field.label} *` : (field.placeholder || field.label)) : (field.placeholder || 'Select...')}</option>
                            {(field.options || []).map((opt: string, i: number) => <option key={i} value={opt}>{opt}</option>)}
                          </select>
                        ) : (
                          <input name={field.id} type={field.type === 'email' ? 'email' : (field.type === 'phone' || field.type === 'tel') ? 'tel' : field.type === 'number' ? 'number' : 'text'} placeholder={!showLabels ? (field.required ? `${field.placeholder || field.label} *` : (field.placeholder || field.label)) : (field.placeholder || undefined)} required={field.required} style={fieldInputStyle} />
                        )}
                      </div>
                    );
                  })}
                  <button type="submit" style={submitStyle} data-testid="preview-contact-submit">
                    {submitButtonText || 'Submit'}
                  </button>
                </form>
              </div>
            </section>
          );
        }
        case 'grid': {
          const { columns = 3, items = [], title } = cfg;
          return (
            <section key={comp.id} data-testid={`body-grid-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 1 : columns}, 1fr)`, gap: '1.25rem' }}>
                  {items.map((item: any, i: number) => {
                    const IconComp = item.mediaType === 'icon' && item.iconName ? GRID_ICON_MAP[item.iconName] : null;
                    const itemAlign = item.alignment || 'left';
                    const itemTextAlign = itemAlign as React.CSSProperties['textAlign'];
                    const itemFlexAlign = itemAlign === 'center' ? 'center' : itemAlign === 'right' ? 'flex-end' : 'flex-start';
                    const gridBtnStyle: React.CSSProperties = item.buttonVariant === 'outline'
                      ? { backgroundColor: 'transparent', color: primaryColor, border: `2px solid ${primaryColor}`, padding: '0.5rem 1.25rem', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', marginTop: '0.75rem', display: 'inline-block', textDecoration: 'none' }
                      : item.buttonVariant === 'secondary'
                        ? { backgroundColor: secondaryColor, color: '#fff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', marginTop: '0.75rem', display: 'inline-block', textDecoration: 'none' }
                        : { backgroundColor: primaryColor, color: '#fff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', marginTop: '0.75rem', display: 'inline-block', textDecoration: 'none' };
                    const cardContent = (
                      <div style={{ textAlign: itemTextAlign }}>
                        {item.mediaType === 'icon' && IconComp && (
                          <div style={{ display: 'flex', justifyContent: itemFlexAlign, marginBottom: '0.75rem' }}>
                            <IconComp size={32} color={primaryColor} />
                          </div>
                        )}
                        {item.mediaType === 'image' && item.imageUrl && (
                          <div style={{ marginBottom: '0.75rem', overflow: 'hidden', borderRadius: '0.375rem' }}>
                            <img src={item.imageUrl} alt={item.title || ''} style={{ width: '100%', height: `${item.imageHeight || 160}px`, objectFit: 'cover' }} />
                          </div>
                        )}
                        {item.title && <h3 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>{item.title}</h3>}
                        {item.content && <p style={{ fontSize: '0.875rem', color: '#6b7280', lineHeight: 1.5 }}>{item.content}</p>}
                        {item.buttonEnabled && (
                          <div style={{ display: 'flex', justifyContent: itemFlexAlign, marginTop: '0.75rem' }}>
                            {item.itemClickable ? (
                              <span style={gridBtnStyle} data-testid={`grid-item-btn-${i}`}>
                                {item.buttonText || 'Learn More'}
                              </span>
                            ) : (
                              <a
                                href={item.buttonUrl || '#'}
                                target={item.buttonOpenNewTab ? '_blank' : undefined}
                                rel={item.buttonOpenNewTab ? 'noopener noreferrer' : undefined}
                                style={gridBtnStyle}
                                data-testid={`grid-item-btn-${i}`}
                              >
                                {item.buttonText || 'Learn More'}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                    const cardStyle: React.CSSProperties = { backgroundColor: '#f9fafb', padding: '1.25rem', borderRadius: '0.5rem', border: '1px solid #e5e7eb', ...(item.itemClickable ? { cursor: 'pointer' } : {}) };
                    if (item.itemClickable && item.itemUrl) {
                      return (
                        <a key={i} href={item.itemUrl} target={item.itemOpenNewTab ? '_blank' : undefined} rel={item.itemOpenNewTab ? 'noopener noreferrer' : undefined} data-testid={`grid-item-${i}`} style={{ ...cardStyle, textDecoration: 'none', color: 'inherit', display: 'block' }}>
                          {cardContent}
                        </a>
                      );
                    }
                    return (
                      <div key={i} data-testid={`grid-item-${i}`} style={cardStyle}>
                        {cardContent}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        }
        case 'cta': {
          const { title, content: text, buttons = [], titleStyle: ctaTitleStyle, contentStyle: ctaContentStyle } = cfg;
          return (
            <section key={comp.id} data-testid={`body-cta-${comp.id}`} className={customClassName} style={{ ...containerStyle, background: containerStyle.background || `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`, color: '#fff', position: 'relative', overflow: 'hidden' }}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '48rem', margin: '0 auto', padding: isMobile ? '3rem 1rem' : '4rem 2rem', textAlign: 'center' }}>
                {title && <h2 style={buildBodyTextStyle(ctaTitleStyle, { fontSize: isMobile ? '1.75rem' : '2.25rem', fontWeight: 800, marginBottom: '0.75rem' })}>{title}</h2>}
                {text && <p style={buildBodyTextStyle(ctaContentStyle, { fontSize: '1.125rem', opacity: 0.9, marginBottom: '1.5rem' })}>{text}</p>}
                {buttons.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {buttons.map((b: ButtonConfig, i: number) => {
                      const ctaBtnBase: React.CSSProperties = { backgroundColor: b.variant === 'secondary' ? 'transparent' : '#fff', color: b.variant === 'secondary' ? '#fff' : primaryColor, border: b.variant === 'secondary' ? '2px solid #fff' : 'none', padding: '0.75rem 2rem', borderRadius: '0.375rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' };
                      const bs = b.style;
                      if (bs) {
                        if (bs.backgroundColor) ctaBtnBase.backgroundColor = bs.backgroundColor;
                        if (bs.textColor) ctaBtnBase.color = bs.textColor;
                        if (bs.borderColor) ctaBtnBase.borderColor = bs.borderColor;
                        if (bs.borderWidth) { ctaBtnBase.borderWidth = `${bs.borderWidth}px`; ctaBtnBase.borderStyle = 'solid'; }
                        if (bs.borderRadius) ctaBtnBase.borderRadius = `${bs.borderRadius}px`;
                        if (bs.paddingX || bs.paddingY) ctaBtnBase.padding = `${bs.paddingY || '12'}px ${bs.paddingX || '32'}px`;
                        if (bs.fontFamily) { loadGoogleFont(bs.fontFamily); ctaBtnBase.fontFamily = `'${bs.fontFamily}', sans-serif`; }
                        if (bs.fontSize) ctaBtnBase.fontSize = `${bs.fontSize}px`;
                        if (bs.fontWeight) ctaBtnBase.fontWeight = bs.fontWeight as any;
                      }
                      return <button key={i} data-testid={`cta-button-${i}`} style={ctaBtnBase}>
                        {b.text || 'Get Started'}
                      </button>;
                    })}
                  </div>
                )}
              </div>
            </section>
          );
        }
        case 'testimonial': {
          const { layout = 'grid', columns = 3, items = [], title } = cfg;
          return (
            <section key={comp.id} data-testid={`body-testimonial-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: layout === 'carousel' ? 'flex' : 'grid', gridTemplateColumns: layout !== 'carousel' ? `repeat(${isMobile ? 1 : columns}, 1fr)` : undefined, gap: '1.25rem', overflowX: layout === 'carousel' ? 'auto' : undefined }}>
                  {items.map((item: any, i: number) => (
                    <div key={i} data-testid={`testimonial-item-${i}`} style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '0.75rem', border: '1px solid #e5e7eb', minWidth: layout === 'carousel' ? '280px' : undefined }}>
                      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }}>
                        {[1,2,3,4,5].map(s => <Star key={s} size={14} style={{ fill: '#fbbf24', color: '#fbbf24' }} />)}
                      </div>
                      {item.quote && <p style={{ fontSize: '0.9375rem', fontStyle: 'italic', color: '#374151', lineHeight: 1.6, marginBottom: '1rem' }}>"{item.quote}"</p>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: primaryColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.875rem' }}>
                            {(item.name || 'A').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          {item.name && <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{item.name}</div>}
                          {item.role && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{item.role}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'feature_highlight': {
          const { columns = 3, items = [], title } = cfg;
          return (
            <section key={comp.id} data-testid={`body-feature-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '0.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 1 : columns}, 1fr)`, gap: '1.5rem', marginTop: '1.5rem' }}>
                  {items.map((item: any, i: number) => (
                    <div key={i} data-testid={`feature-item-${i}`} style={{ textAlign: 'center', padding: '1.5rem' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: `${primaryColor}20`, color: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontWeight: 700, fontSize: '1.25rem' }}>
                        {(item.icon || item.title || 'F').charAt(0).toUpperCase()}
                      </div>
                      {item.title && <h3 style={{ fontWeight: 600, fontSize: '1.0625rem', marginBottom: '0.5rem' }}>{item.title}</h3>}
                      {item.description && <p style={{ fontSize: '0.875rem', color: '#6b7280', lineHeight: 1.5 }}>{item.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'gallery': {
          const { title, columns = 3 } = cfg;
          return (
            <section key={comp.id} data-testid={`body-gallery-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem', textAlign: align as React.CSSProperties['textAlign'] }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1rem' }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 2 : columns}, 1fr)`, gap: '0.75rem' }}>
                  {[0,1,2,3,4,5].map(i => (
                    <div key={i} data-testid={`gallery-item-${i}`} style={{ aspectRatio: '1', backgroundColor: '#f3f4f6', borderRadius: '0.5rem', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Gallery Image</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'stats': {
          const { columns = 4, items = [], title } = cfg;
          return (
            <section key={comp.id} data-testid={`body-stats-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 2 : columns}, 1fr)`, gap: '1.25rem' }}>
                  {items.map((item: any, i: number) => (
                    <div key={i} data-testid={`stat-item-${i}`} style={{ textAlign: 'center', padding: '1.25rem' }}>
                      <div style={{ fontSize: isMobile ? '2rem' : '2.5rem', fontWeight: 800, color: primaryColor, lineHeight: 1 }}>
                        {item.prefix || ''}{item.value || '0'}{item.suffix || ''}
                      </div>
                      {item.label && <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.375rem', fontWeight: 500 }}>{item.label}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'faq': {
          const { items = [], title } = cfg;
          return (
            <section key={comp.id} data-testid={`body-faq-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '48rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {items.map((item: any, i: number) => {
                    const faqKey = `${comp.id}-${i}`;
                    const isOpen = faqOpenItems.has(faqKey);
                    return (
                      <div key={i} data-testid={`faq-item-${i}`} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', overflow: 'hidden' }}>
                        <button
                          onClick={() => {
                            setFaqOpenItems(prev => {
                              const next = new Set(prev);
                              if (next.has(faqKey)) next.delete(faqKey); else next.add(faqKey);
                              return next;
                            });
                          }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.9375rem' }}
                        >
                          {item.question || `Question ${i + 1}`}
                          <ChevronDown size={18} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                        </button>
                        {isOpen && (
                          <div style={{ padding: '0 1rem 0.875rem', fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.6 }}>
                            {item.answer || 'Answer goes here.'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        }
        case 'certifications': {
          const { title, columns = 4, items = [] } = cfg;
          return (
            <section key={comp.id} data-testid={`body-cert-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 2 : columns}, 1fr)`, gap: '1.5rem' }}>
                  {items.map((item: any, i: number) => (
                    <div key={i} data-testid={`cert-item-${i}`} style={{ textAlign: 'center', padding: '1.25rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
                      {item.logoUrl ? (
                        <img src={item.logoUrl} alt={item.label || ''} style={{ width: '64px', height: '64px', objectFit: 'contain', margin: '0 auto 0.75rem' }} />
                      ) : (
                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: `${primaryColor}15`, color: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                          <Shield size={28} />
                        </div>
                      )}
                      {item.label && <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>{item.label}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'about_company': {
          const { title, overview, yearsExperience, mission, vision, teamPhotoUrl } = cfg;
          return (
            <section key={comp.id} data-testid={`body-about-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: teamPhotoUrl ? '1fr 1fr' : '1fr', gap: '2rem', alignItems: 'start' }}>
                  <div>
                    {overview && <p style={{ fontSize: '1rem', color: '#374151', lineHeight: 1.7, marginBottom: '1.5rem' }}>{overview}</p>}
                    {yearsExperience && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', backgroundColor: `${primaryColor}10`, color: primaryColor, padding: '0.5rem 1rem', borderRadius: '0.375rem', fontWeight: 700, fontSize: '1rem', marginBottom: '1.5rem' }}>
                        {yearsExperience}+ Years of Experience
                      </div>
                    )}
                    {mission && (
                      <div style={{ marginBottom: '1rem' }}>
                        <h3 style={{ fontWeight: 600, fontSize: '1.0625rem', marginBottom: '0.375rem', color: primaryColor }}>Our Mission</h3>
                        <p style={{ fontSize: '0.9375rem', color: '#4b5563', lineHeight: 1.6 }}>{mission}</p>
                      </div>
                    )}
                    {vision && (
                      <div>
                        <h3 style={{ fontWeight: 600, fontSize: '1.0625rem', marginBottom: '0.375rem', color: primaryColor }}>Our Vision</h3>
                        <p style={{ fontSize: '0.9375rem', color: '#4b5563', lineHeight: 1.6 }}>{vision}</p>
                      </div>
                    )}
                  </div>
                  {teamPhotoUrl && (
                    <div style={{ borderRadius: '0.5rem', overflow: 'hidden', marginTop: isMobile ? '1.5rem' : 0 }}>
                      <img src={teamPhotoUrl} alt="Our Team" style={{ width: '100%', height: 'auto', objectFit: 'cover', borderRadius: '0.5rem' }} />
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        }
        case 'equipment': {
          const { title, columns = 3, items = [] } = cfg;
          return (
            <section key={comp.id} data-testid={`body-equip-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 1 : columns}, 1fr)`, gap: '1.25rem' }}>
                  {items.map((item: any, i: number) => (
                    <div key={i} data-testid={`equip-item-${i}`} style={{ backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.model || ''} style={{ width: '100%', height: '200px', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '200px', backgroundColor: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                          <Truck size={48} />
                        </div>
                      )}
                      <div style={{ padding: '1rem' }}>
                        {item.model && <h3 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.375rem' }}>{item.model}</h3>}
                        {item.description && <p style={{ fontSize: '0.875rem', color: '#6b7280', lineHeight: 1.5 }}>{item.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'safety': {
          const { title, safetyPolicy, stats = [], badges = [] } = cfg;
          return (
            <section key={comp.id} data-testid={`body-safety-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                {safetyPolicy && <p style={{ fontSize: '1rem', color: '#374151', lineHeight: 1.7, marginBottom: '2rem', maxWidth: '48rem' }}>{safetyPolicy}</p>}
                {stats.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 2 : stats.length}, 1fr)`, gap: '1.25rem', marginBottom: '2rem' }}>
                    {stats.map((stat: any, i: number) => (
                      <div key={i} data-testid={`safety-stat-${i}`} style={{ textAlign: 'center', padding: '1.25rem', backgroundColor: `${primaryColor}08`, borderRadius: '0.5rem', border: `1px solid ${primaryColor}20` }}>
                        <div style={{ fontSize: isMobile ? '1.75rem' : '2.25rem', fontWeight: 800, color: primaryColor, lineHeight: 1 }}>{stat.value}</div>
                        {stat.label && <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.375rem', fontWeight: 500 }}>{stat.label}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {badges.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', justifyContent: 'center' }}>
                    {badges.map((badge: any, i: number) => (
                      <div key={i} data-testid={`safety-badge-${i}`} style={{ textAlign: 'center', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb', minWidth: '120px' }}>
                        {badge.imageUrl ? (
                          <img src={badge.imageUrl} alt={badge.label || ''} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 0.5rem' }} />
                        ) : (
                          <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem' }}>
                            <Shield size={24} />
                          </div>
                        )}
                        {badge.label && <p style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{badge.label}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        }
        case 'team': {
          const { title, columns = 3, items = [] } = cfg;
          return (
            <section key={comp.id} data-testid={`body-team-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 1 : columns}, 1fr)`, gap: '1.25rem' }}>
                  {items.map((item: any, i: number) => (
                    <div key={i} data-testid={`team-item-${i}`} style={{ textAlign: 'center', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                      {item.photoUrl ? (
                        <img src={item.photoUrl} alt={item.name || ''} style={{ width: '100%', height: '220px', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '220px', backgroundColor: `${primaryColor}10`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: primaryColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '2rem' }}>
                            {(item.name || 'T').charAt(0).toUpperCase()}
                          </div>
                        </div>
                      )}
                      <div style={{ padding: '1rem' }}>
                        {item.name && <h3 style={{ fontWeight: 600, fontSize: '1.0625rem', marginBottom: '0.25rem' }}>{item.name}</h3>}
                        {item.role && <p style={{ fontSize: '0.875rem', color: primaryColor, fontWeight: 500, marginBottom: '0.5rem' }}>{item.role}</p>}
                        {item.bio && <p style={{ fontSize: '0.8125rem', color: '#6b7280', lineHeight: 1.5 }}>{item.bio}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        case 'logo_showcase': {
          const { title, items = [], desktopColumns = 5, mobileColumns = 2, continuousSlide = false, slideSpeed = 30 } = cfg;
          const cols = isMobile ? mobileColumns : desktopColumns;
          const logoItems = items.filter((item: any) => item.imageUrl);
          return (
            <section key={comp.id} data-testid={`body-logo-${comp.id}`} className={customClassName} style={containerStyle}>
              {renderVideoBackground(comp.styles)}
              {renderOverlay(comp.styles)}
              <div style={{ ...contentZStyle, maxWidth: '72rem', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>
                {title && <h2 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: align as React.CSSProperties['textAlign'] }}>{title}</h2>}
                {continuousSlide && logoItems.length > 0 ? (
                  <div style={{ overflow: 'hidden', position: 'relative' }}>
                    <style>{`
                      @keyframes logoSlide-${comp.id.replace(/[^a-zA-Z0-9]/g, '')} {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                      }
                    `}</style>
                    <div style={{
                      display: 'flex',
                      animation: `logoSlide-${comp.id.replace(/[^a-zA-Z0-9]/g, '')} ${slideSpeed}s linear infinite`,
                      width: 'max-content',
                    }}>
                      {[...logoItems, ...logoItems].map((item: any, i: number) => (
                        <div key={i} style={{ flex: '0 0 auto', padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <img src={item.imageUrl} alt={item.altText || ''} style={{ maxHeight: '60px', maxWidth: '140px', objectFit: 'contain', opacity: 0.7, filter: 'grayscale(30%)' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '1.5rem', alignItems: 'center', justifyItems: 'center' }}>
                    {items.map((item: any, i: number) => (
                      <div key={i} data-testid={`logo-item-${i}`} style={{ padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.altText || ''} style={{ maxHeight: '60px', maxWidth: '140px', objectFit: 'contain', opacity: 0.8 }} />
                        ) : (
                          <div style={{ width: '100px', height: '50px', backgroundColor: '#f3f4f6', borderRadius: '0.375rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '0.75rem' }}>
                            Logo
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        }
        case 'blog_section': {
          const bsCfg = comp.config as any;
          const bsTitle = bsCfg.title || 'Latest From Our Blog';
          const source = bsCfg.source || 'latest';
          const categoryFilter = (bsCfg.categoryFilter || '').toLowerCase();
          const tagFilter = (bsCfg.tagFilter || '').toLowerCase();
          const sortOrder = bsCfg.sortOrder || 'latest';
          const layoutStyle = bsCfg.layoutStyle || 'grid';
          const desktopItemCount = bsCfg.desktopItems || 3;
          const tabletItemCount = bsCfg.tabletItems || 2;
          const mobileItemCount = bsCfg.mobileItems || 1;
          const itemCount = deviceType === 'mobile' ? mobileItemCount : deviceType === 'tablet' ? tabletItemCount : desktopItemCount;
          const showCoverImage = bsCfg.showCoverImage !== false;
          const showExcerpt = bsCfg.showExcerpt !== false;
          const showAuthor = bsCfg.showAuthor !== false;
          const showDate = bsCfg.showDate !== false;
          const showCategory = bsCfg.showCategory !== false;
          const readMoreText = bsCfg.readMoreText || 'Read More';

          let filteredPosts = [...blogPosts];
          if (source === 'featured') {
            filteredPosts = filteredPosts.filter(p => p.featured_post || p.featuredPost);
          } else if (source === 'popular') {
            filteredPosts = filteredPosts.filter(p => ((p.view_count || p.viewCount || 0) as number) > 0);
          } else if (source === 'category' && categoryFilter) {
            filteredPosts = filteredPosts.filter(p => (p.category || '').toLowerCase().includes(categoryFilter));
          } else if (source === 'tag' && tagFilter) {
            filteredPosts = filteredPosts.filter(p => (p.tags || []).some(t => t.toLowerCase().includes(tagFilter)));
          }

          if (sortOrder === 'popular') {
            filteredPosts.sort((a, b) => ((b.view_count || b.viewCount || 0) as number) - ((a.view_count || a.viewCount || 0) as number));
          } else if (sortOrder === 'featured') {
            filteredPosts.sort((a, b) => ((b.featured_post || b.featuredPost) ? 1 : 0) - ((a.featured_post || a.featuredPost) ? 1 : 0));
          } else {
            filteredPosts.sort((a, b) => {
              const da = new Date(a.published_at || a.publishedAt || 0).getTime();
              const db = new Date(b.published_at || b.publishedAt || 0).getTime();
              return db - da;
            });
          }

          const displayPosts = filteredPosts.slice(0, itemCount);

          const renderPostCard = (post: typeof blogPosts[0], idx: number) => {
            const coverUrl = post.coverImageUrl || post.cover_image_url;
            const author = post.authorName || post.author_name;
            const pubDate = post.published_at || post.publishedAt;
            const cat = post.category;
            return (
              <div key={post.id || idx} data-testid={`blog-card-${idx}`} style={{ backgroundColor: '#fff', borderRadius: '0.5rem', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
                {showCoverImage && coverUrl && (
                  <div style={{ height: '180px', overflow: 'hidden' }}>
                    <img src={coverUrl} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                {showCoverImage && !coverUrl && (
                  <div style={{ height: '180px', backgroundColor: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
                    No Image
                  </div>
                )}
                <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {showCategory && cat && (
                    <span style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: primaryColor, marginBottom: '0.5rem', letterSpacing: '0.05em' }}>{cat}</span>
                  )}
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', lineHeight: 1.3, color: '#111' }}>{post.title}</h3>
                  {showExcerpt && post.excerpt && (
                    <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.75rem', flex: 1, lineHeight: 1.5 }}>{post.excerpt.substring(0, 120)}{post.excerpt.length > 120 ? '...' : ''}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginTop: 'auto', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                      {showAuthor && author && <span>{author}</span>}
                      {showAuthor && author && showDate && pubDate && <span>·</span>}
                      {showDate && pubDate && <span>{new Date(pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                    </div>
                    <span style={{ fontSize: '0.8rem', color: primaryColor, fontWeight: 500, cursor: 'pointer' }}>{readMoreText} →</span>
                  </div>
                </div>
              </div>
            );
          };

          if (displayPosts.length === 0) {
            return (
              <section key={comp.id} data-testid={`body-blog-section-${comp.id}`} style={{ ...containerStyle, textAlign: 'center' as const }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>{bsTitle}</h2>
                <p style={{ color: '#9ca3af' }}>No blog posts found matching your criteria.</p>
              </section>
            );
          }

          return (
            <section key={comp.id} data-testid={`body-blog-section-${comp.id}`} style={containerStyle}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: 'center' as const }}>{bsTitle}</h2>
              {layoutStyle === 'carousel' ? (
                <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem', scrollSnapType: 'x mandatory' }}>
                  {displayPosts.map((post, idx) => (
                    <div key={post.id || idx} style={{ minWidth: `${Math.max(280, Math.floor(100 / itemCount) - 2)}%`, scrollSnapAlign: 'start', flex: '0 0 auto', maxWidth: '320px' }}>
                      {renderPostCard(post, idx)}
                    </div>
                  ))}
                </div>
              ) : layoutStyle === 'masonry' ? (
                <div style={{ columns: itemCount, columnGap: '1rem' }}>
                  {displayPosts.map((post, idx) => (
                    <div key={post.id || idx} style={{ breakInside: 'avoid', marginBottom: '1rem' }}>
                      {renderPostCard(post, idx)}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${itemCount}, 1fr)`, gap: '1.5rem' }}>
                  {displayPosts.map((post, idx) => renderPostCard(post, idx))}
                </div>
              )}
            </section>
          );
        }
        default:
          return null;
      }
    };

    return <div data-testid="body-components-container">{components.map(renderSingleComponent)}</div>;
  };

  // Render navigation header (shared across all pages)
  const renderHeader = () => {
    if (data.headerConfig) return renderConfiguredHeader();
    return (
    <header 
      className="sticky top-0 z-50 shadow-sm"
      style={{ backgroundColor: bgColor, borderBottom: `1px solid ${primaryColor}20` }}
    >
      <div className={`mx-auto px-4 ${isMobile ? 'py-3' : 'py-4'}`} style={{ maxWidth: '1200px' }}>
        <div className="flex items-center justify-between">
          {/* Logo / Site Name */}
          <button 
            onClick={() => navigateTo("home")}
            className="flex items-center gap-3 cursor-pointer"
            data-testid="preview-logo"
          >
            {website.logoUrl || organization?.logoUrl ? (
              <img 
                src={website.logoUrl || organization?.logoUrl || ''} 
                alt={siteName}
                style={{ height: `${website.logoHeight || 55}px`, objectFit: 'contain' }}
              />
            ) : (
              <div 
                className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold`}
                style={{ color: primaryColor }}
              >
                {siteName}
              </div>
            )}
          </button>

          {/* Navigation */}
          {isMobile ? (
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded"
              style={{ backgroundColor: `${primaryColor}10` }}
              data-testid="preview-mobile-menu-toggle"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" style={{ color: primaryColor }} />
              ) : (
                <Menu className="h-5 w-5" style={{ color: primaryColor }} />
              )}
            </button>
          ) : (
            <nav className="flex items-center gap-6">
              {navItems.map(item => (
                item.children && item.children.length > 0 ? (
                  <div 
                    key={item.id} 
                    className="relative"
                    onMouseEnter={() => setOpenDropdown(item.id)}
                    onMouseLeave={() => setOpenDropdown(null)}
                  >
                    <button
                      className="font-medium hover:opacity-80 cursor-pointer transition-opacity flex items-center gap-1"
                      style={{
                        color: currentPage === item.slug || item.children.some(c => currentPage === c.slug) ? primaryColor : textColor,
                        borderBottom: currentPage === item.slug || item.children.some(c => currentPage === c.slug) ? `2px solid ${primaryColor}` : '2px solid transparent'
                      }}
                      onClick={() => navigateTo(item.slug as PageView)}
                      data-testid={`preview-nav-${item.slug}`}
                    >
                      {item.label}
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {openDropdown === item.id && (
                      <div
                        className="absolute top-full left-0 mt-1 min-w-[180px] rounded-md shadow-lg py-1 z-50"
                        style={{ backgroundColor: bgColor, border: `1px solid ${primaryColor}20` }}
                      >
                        {item.children.map(child => (
                          <button
                            key={child.id}
                            onClick={() => { navigateTo(child.slug as PageView); setOpenDropdown(null); }}
                            className="w-full text-left px-4 py-2 text-sm hover:opacity-80 transition-opacity"
                            style={{
                              color: currentPage === child.slug ? primaryColor : textColor,
                              backgroundColor: currentPage === child.slug ? `${primaryColor}10` : 'transparent'
                            }}
                            data-testid={`preview-nav-${child.slug}`}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    key={item.id}
                    onClick={() => navigateTo(item.slug as PageView)}
                    className="font-medium hover:opacity-80 cursor-pointer transition-opacity"
                    style={{ 
                      color: currentPage === item.slug ? primaryColor : textColor,
                      borderBottom: currentPage === item.slug ? `2px solid ${primaryColor}` : '2px solid transparent'
                    }}
                    data-testid={`preview-nav-${item.slug}`}
                  >
                    {item.label}
                  </button>
                )
              ))}
            </nav>
          )}
        </div>
        {isMobile && mobileNavStyle === 'dropdown' && renderMobileMenu(bgColor, textColor)}
      </div>
    </header>
  );
  };

  // Render footer (shared across all pages)
  const renderFooter = () => {
    if (data.footerConfig) return renderConfiguredFooter();
    return (
    <footer 
      className={`${isMobile ? 'py-8' : 'py-16'}`}
      style={{ backgroundColor: secondaryColor, color: 'white' }}
    >
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-8' : 'grid-cols-4 gap-8'}`}>
          {/* Company Info */}
          <div className={isMobile ? 'text-center' : ''}>
            <h3 className="font-bold text-lg mb-4">{siteName}</h3>
            <p className="text-sm opacity-80 mb-4">{tagline}</p>
            {website.missionStatement && (
              <p className="text-sm opacity-70">{website.missionStatement}</p>
            )}
          </div>

          {/* Quick Links */}
          <div className={isMobile ? 'text-center' : ''}>
            <h4 className="font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm opacity-80">
              {navItems.map(item => (
                <li key={item.id}>
                  <button 
                    onClick={() => navigateTo(item.slug as PageView)}
                    className="hover:opacity-100 cursor-pointer"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div className={isMobile ? 'text-center' : ''}>
            <h4 className="font-semibold mb-4">Contact Us</h4>
            <ul className="space-y-3 text-sm opacity-80">
              {website.contactPhone && (
                <li className={`flex items-center gap-2 ${isMobile ? 'justify-center' : ''}`}>
                  <Phone className="h-4 w-4" />
                  {website.contactPhone}
                </li>
              )}
              {website.contactEmail && (
                <li className={`flex items-center gap-2 ${isMobile ? 'justify-center' : ''}`}>
                  <Mail className="h-4 w-4" />
                  {website.contactEmail}
                </li>
              )}
              {website.contactAddress && (
                <li className={`flex items-center gap-2 ${isMobile ? 'justify-center' : ''}`}>
                  <MapPin className="h-4 w-4" />
                  {website.contactAddress}
                </li>
              )}
            </ul>
          </div>

          {/* Social Links */}
          <div className={isMobile ? 'text-center' : ''}>
            <h4 className="font-semibold mb-4">Follow Us</h4>
            <div className={`flex gap-3 ${isMobile ? 'justify-center' : ''}`}>
              {socialLinks?.facebookUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiFacebook className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.instagramUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiInstagram className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.linkedinUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiLinkedin className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.youtubeUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiYoutube className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.tiktokUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiTiktok className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>
        </div>

        <div 
          className="mt-8 pt-8 text-center text-sm opacity-60"
          style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }}
        >
          © {new Date().getFullYear()} {siteName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
  };

  // HOME PAGE
  const renderHomePage = () => {
    const homePage = pages.find(p => (p.pageType || '').toUpperCase() === 'HOME');
    if (homePage?.contentJson) {
      try {
        const parsedConfig = JSON.parse(homePage.contentJson) as BodyComponentsConfig;
        if (parsedConfig.components && parsedConfig.components.filter(c => c.enabled).length > 0) {
          return renderBodyComponents(parsedConfig);
        }
      } catch (err) { console.warn("[WebsitePreview] Failed to parse page contentJson:", err); }
    }
    if (data.bodyConfig && data.bodyConfig.components && data.bodyConfig.components.filter(c => c.enabled).length > 0) {
      return renderBodyComponents(data.bodyConfig);
    }
    return (
    <>
      {/* Hero Section */}
      <section 
        className="relative"
        style={{ 
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
          minHeight: isMobile ? '300px' : '500px',
        }}
      >
        <div 
          className={`mx-auto px-4 ${isMobile ? 'py-12' : 'py-24'} text-center text-white`}
          style={{ maxWidth: '1200px' }}
        >
          <h1 className={`${isMobile ? 'text-2xl' : isTablet ? 'text-3xl' : 'text-5xl'} font-bold mb-4`}>
            {siteName}
          </h1>
          <p className={`${isMobile ? 'text-base' : 'text-xl'} opacity-90 mb-8 max-w-2xl mx-auto`}>
            {tagline}
          </p>
          <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} gap-4 justify-center`}>
            <button 
              onClick={() => navigateTo("contact")}
              className={`${isMobile ? 'w-full' : ''} px-6 py-3 rounded font-medium text-white flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
              style={{ backgroundColor: accentColor }}
              data-testid="preview-cta-quote"
            >
              Get a Free Quote
              <ArrowRight className="h-4 w-4" />
            </button>
            <button 
              onClick={() => navigateTo("gallery")}
              className={`${isMobile ? 'w-full' : ''} px-6 py-3 rounded font-medium border-2 border-white text-white cursor-pointer hover:bg-white/10 transition-colors`}
              data-testid="preview-cta-work"
            >
              View Our Work
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h2 
            className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-center mb-12`}
            style={{ color: textColor }}
          >
            Why Choose Us
          </h2>
          <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-8`}>
            {[
              { title: "Quality Craftsmanship", desc: "We take pride in delivering exceptional work on every project." },
              { title: "On-Time Delivery", desc: "Your project completed on schedule, every time." },
              { title: "Licensed & Insured", desc: "Full protection for your peace of mind." },
            ].map((feature, idx) => (
              <div 
                key={idx}
                className="p-6 rounded-lg text-center"
                style={{ backgroundColor: `${primaryColor}08`, border: `1px solid ${primaryColor}15` }}
              >
                <div 
                  className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <CheckCircle className="h-6 w-6" style={{ color: primaryColor }} />
                </div>
                <h3 className="font-semibold mb-2" style={{ color: textColor }}>{feature.title}</h3>
                <p className="text-sm opacity-70">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Projects Preview */}
      {website.galleryEnabled !== false && projects.length > 0 && (
        <section 
          className={`${isMobile ? 'py-12' : 'py-20'}`}
          style={{ backgroundColor: `${primaryColor}05` }}
        >
          <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
            <h2 
              className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-center mb-12`}
              style={{ color: textColor }}
            >
              Our Recent Projects
            </h2>
            <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
              {projects.slice(0, 3).map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    setSelectedProject(project);
                    setCurrentPage("project-detail");
                  }}
                  className="rounded-lg overflow-hidden shadow-sm text-left cursor-pointer hover:shadow-md transition-shadow"
                  style={{ backgroundColor: bgColor }}
                  data-testid={`preview-project-${project.id}`}
                >
                  <div 
                    className="h-48 bg-gray-200"
                    style={{ 
                      backgroundImage: (project.coverImageUrl || project.cover_image_url) ? `url(${project.coverImageUrl || project.cover_image_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="p-4">
                    <span 
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                    >
                      {project.projectType || project.project_type || "Project"}
                    </span>
                    <h3 className="font-semibold mt-2" style={{ color: textColor }}>{project.title}</h3>
                    <p className="text-sm opacity-70 mt-1 line-clamp-2">{project.shortDescription || project.short_description}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="text-center mt-8">
              <button
                onClick={() => navigateTo("gallery")}
                className="px-6 py-2 rounded font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: primaryColor, color: 'white' }}
                data-testid="preview-view-all-projects"
              >
                View All Projects
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Blog Preview */}
      {website.blogEnabled !== false && blogPosts.length > 0 && (
        <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
          <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
            <h2 
              className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-center mb-12`}
              style={{ color: textColor }}
            >
              Latest from Our Blog
            </h2>
            <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
              {blogPosts.slice(0, 3).map((post) => (
                <button
                  key={post.id}
                  onClick={() => {
                    setSelectedBlogPost(post);
                    setCurrentPage("blog-post");
                  }}
                  className="rounded-lg overflow-hidden text-left cursor-pointer hover:shadow-md transition-shadow"
                  style={{ border: `1px solid ${primaryColor}15` }}
                  data-testid={`preview-blog-${post.id}`}
                >
                  <div 
                    className="h-40 bg-gray-200"
                    style={{ 
                      backgroundImage: (post.coverImageUrl || post.cover_image_url) ? `url(${post.coverImageUrl || post.cover_image_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="p-4">
                    <h3 className="font-semibold" style={{ color: textColor }}>{post.title}</h3>
                    <p className="text-sm opacity-70 mt-2 line-clamp-2">{post.excerpt}</p>
                    <span 
                      className="text-sm font-medium mt-3 inline-flex items-center gap-1"
                      style={{ color: primaryColor }}
                    >
                      Read More <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="text-center mt-8">
              <button
                onClick={() => navigateTo("blog")}
                className="px-6 py-2 rounded font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: primaryColor, color: 'white' }}
                data-testid="preview-view-all-blog"
              >
                View All Posts
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Testimonial */}
      <section 
        className={`${isMobile ? 'py-12' : 'py-20'}`}
        style={{ backgroundColor: `${secondaryColor}10` }}
      >
        <div className="mx-auto px-4 text-center" style={{ maxWidth: '800px' }}>
          <div className="flex justify-center gap-1 mb-4">
            {[1,2,3,4,5].map(i => (
              <Star key={i} className="h-5 w-5 fill-current" style={{ color: accentColor }} />
            ))}
          </div>
          <blockquote className={`${isMobile ? 'text-lg' : 'text-2xl'} italic mb-4`} style={{ color: textColor }}>
            "{siteName} exceeded our expectations. Professional, reliable, and the quality of work was outstanding."
          </blockquote>
          <p className="font-medium" style={{ color: primaryColor }}>— Happy Customer</p>
        </div>
      </section>

      {/* CTA */}
      <section 
        className={`${isMobile ? 'py-12' : 'py-20'}`}
        style={{ 
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
        }}
      >
        <div className="mx-auto px-4 text-center text-white" style={{ maxWidth: '800px' }}>
          <h2 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold mb-4`}>
            Ready to Start Your Project?
          </h2>
          <p className="mb-8 opacity-90">
            Contact us today for a free consultation and estimate.
          </p>
          <button 
            onClick={() => navigateTo("contact")}
            className="px-8 py-3 rounded font-medium cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: accentColor, color: 'white' }}
            data-testid="preview-footer-cta"
          >
            Get Your Free Quote
          </button>
        </div>
      </section>
    </>
  );
  };

  // ABOUT PAGE
  // Render custom page from database content
  const renderCustomPage = (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return renderHomePage();

    if (page.contentJson) {
      try {
        const parsedConfig = JSON.parse(page.contentJson) as BodyComponentsConfig;
        if (parsedConfig.components && parsedConfig.components.filter(c => c.enabled).length > 0) {
          return renderBodyComponents(parsedConfig);
        }
      } catch (err) { console.warn("[WebsitePreview] Failed to parse page contentJson:", err); }
    }
    
    return (
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-8`}
            style={{ color: textColor }}
          >
            {page.pageTitle}
          </h1>
          
          {page.metaDescription && (
            <p className="text-lg mb-6 opacity-80 max-w-3xl">
              {page.metaDescription}
            </p>
          )}
          
          {page.content && (
            <div className="prose max-w-none">
              <p className="leading-relaxed opacity-80 whitespace-pre-wrap">{page.content}</p>
            </div>
          )}
          
          {!page.content && !page.metaDescription && (
            <div 
              className="text-center py-12 rounded-lg"
              style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}
            >
              <p className="opacity-60">Page content will appear here once added.</p>
            </div>
          )}
          
          <div className="mt-12">
            <button
              onClick={() => navigateTo("contact")}
              className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
              style={{ backgroundColor: primaryColor }}
            >
              Contact Us
            </button>
          </div>
        </div>
      </section>
    );
  };

  // ABOUT PAGE
  const renderAboutPage = () => {
    const customAbout = findPageContent("about");
    if (customAbout?.contentJson) {
      try {
        const parsedConfig = JSON.parse(customAbout.contentJson) as BodyComponentsConfig;
        if (parsedConfig.components && parsedConfig.components.filter(c => c.enabled).length > 0) {
          return renderBodyComponents(parsedConfig);
        }
      } catch (err) { console.warn("[WebsitePreview] Failed to parse page contentJson:", err); }
    }
    const aboutContent = customAbout?.content || customAbout?.metaDescription;
    
    return (
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-8`}
            style={{ color: textColor }}
          >
            {customAbout?.pageTitle || `About ${siteName}`}
          </h1>
          
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-12`}>
            <div>
              <p className="text-lg mb-6 opacity-80">
                {aboutContent || website.missionStatement || `${siteName} is a trusted name in the construction industry, committed to delivering exceptional quality and service to our clients.`}
              </p>
              {!aboutContent && (
                <>
                  <p className="mb-6 opacity-70">
                    With years of experience and a dedicated team of professionals, we take pride in every project we undertake. Our commitment to excellence, safety, and customer satisfaction sets us apart.
                  </p>
                  <p className="mb-6 opacity-70">
                    Whether it's a residential renovation or a commercial build, we bring the same level of dedication and expertise to every job.
                  </p>
                </>
              )}
              <button
                onClick={() => navigateTo("contact")}
                className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
                style={{ backgroundColor: primaryColor }}
              >
                Contact Us Today
              </button>
            </div>
            
            <div 
              className="rounded-lg p-8"
              style={{ backgroundColor: `${primaryColor}08`, border: `1px solid ${primaryColor}15` }}
            >
              <h3 className="text-xl font-semibold mb-6" style={{ color: primaryColor }}>Our Values</h3>
              <ul className="space-y-4">
                {["Quality Workmanship", "Integrity & Honesty", "Safety First", "Customer Focus", "Innovation"].map((value, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 flex-shrink-0" style={{ color: accentColor }} />
                    <span>{value}</span>
                  </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
    );
  };

  // SERVICES PAGE
  const renderServicesPage = () => {
    const customServices = findPageContent("services");
    if (customServices?.contentJson) {
      try {
        const parsedConfig = JSON.parse(customServices.contentJson) as BodyComponentsConfig;
        if (parsedConfig.components && parsedConfig.components.filter(c => c.enabled).length > 0) {
          return renderBodyComponents(parsedConfig);
        }
      } catch (err) { console.warn("[WebsitePreview] Failed to parse page contentJson:", err); }
    }
    return (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4 text-center`}
          style={{ color: textColor }}
        >
          Our Services
        </h1>
        <p className="text-center mb-12 opacity-70 max-w-2xl mx-auto">
          We offer a comprehensive range of {organization?.tradeType?.toLowerCase() || 'construction'} services to meet your needs.
        </p>
        
        <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
          {[
            { title: "Residential Projects", desc: "From new builds to renovations, we create beautiful homes." },
            { title: "Commercial Work", desc: "Professional solutions for businesses of all sizes." },
            { title: "Renovations", desc: "Transform your existing space into something special." },
            { title: "Repairs & Maintenance", desc: "Keep your property in top condition." },
            { title: "Consultations", desc: "Expert advice for your next project." },
            { title: "Emergency Services", desc: "Available when you need us most." },
          ].map((service, idx) => (
            <div 
              key={idx}
              className="p-6 rounded-lg"
              style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}
            >
              <h3 className="font-semibold text-lg mb-2" style={{ color: textColor }}>{service.title}</h3>
              <p className="text-sm opacity-70 mb-4">{service.desc}</p>
              <button
                onClick={() => navigateTo("contact")}
                className="text-sm font-medium flex items-center gap-1 cursor-pointer"
                style={{ color: primaryColor }}
              >
                Get a Quote <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
    );
  };

  // BLOG PAGE
  const renderBlogPage = () => (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-8`}
          style={{ color: textColor }}
        >
          Our Blog
        </h1>
        
        {blogPosts.length > 0 ? (
          <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
            {blogPosts.map((post) => (
              <button
                key={post.id}
                onClick={() => {
                  setSelectedBlogPost(post);
                  setCurrentPage("blog-post");
                }}
                className="rounded-lg overflow-hidden text-left cursor-pointer hover:shadow-md transition-shadow"
                style={{ border: `1px solid ${primaryColor}15`, backgroundColor: bgColor }}
                data-testid={`preview-blog-card-${post.id}`}
              >
                <div 
                  className="h-48 bg-gray-200"
                  style={{ 
                    backgroundImage: (post.coverImageUrl || post.cover_image_url) ? `url(${post.coverImageUrl || post.cover_image_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs opacity-60 mb-2">
                    <User className="h-3 w-3" />
                    <span>{post.authorName || post.author_name || "Staff Writer"}</span>
                    {(post.publishedAt || post.published_at) && (
                      <>
                        <span>•</span>
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(post.publishedAt || post.published_at || '').toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: textColor }}>{post.title}</h3>
                  <p className="text-sm opacity-70 line-clamp-3">{post.excerpt}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 opacity-60">
            <p>No blog posts published yet.</p>
          </div>
        )}
      </div>
    </section>
  );

  // SINGLE BLOG POST
  const renderBlogPostDetail = () => {
    if (!selectedBlogPost) return null;
    
    return (
      <section className={`${isMobile ? 'py-8' : 'py-16'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '800px' }}>
          <button
            onClick={() => navigateTo("blog")}
            className="flex items-center gap-2 mb-6 cursor-pointer hover:opacity-80"
            style={{ color: primaryColor }}
            data-testid="preview-back-to-blog"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Blog
          </button>
          
          {(selectedBlogPost.coverImageUrl || selectedBlogPost.cover_image_url) && (
            <div 
              className="h-64 md:h-96 rounded-lg mb-8 bg-gray-200"
              style={{ 
                backgroundImage: `url(${selectedBlogPost.coverImageUrl || selectedBlogPost.cover_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          )}
          
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4`}
            style={{ color: textColor }}
          >
            {selectedBlogPost.title}
          </h1>
          
          <div className="flex items-center gap-4 text-sm opacity-60 mb-8">
            <span className="flex items-center gap-1">
              <User className="h-4 w-4" />
              {selectedBlogPost.authorName || selectedBlogPost.author_name || "Staff Writer"}
            </span>
            {(selectedBlogPost.publishedAt || selectedBlogPost.published_at) && (
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(selectedBlogPost.publishedAt || selectedBlogPost.published_at || '').toLocaleDateString()}
              </span>
            )}
          </div>
          
          <div className="prose max-w-none">
            {selectedBlogPost.content_html ? (
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedBlogPost.content_html) }} />
            ) : (
              <p className="text-lg leading-relaxed opacity-80">
                {selectedBlogPost.excerpt || "Full blog post content will appear here when published."}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  };

  // GALLERY PAGE
  const renderGalleryPage = () => (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4 text-center`}
          style={{ color: textColor }}
        >
          Project Gallery
        </h1>
        <p className="text-center mb-12 opacity-70 max-w-2xl mx-auto">
          Browse our portfolio of completed projects and see the quality of our work.
        </p>
        
        {projects.length > 0 ? (
          <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setSelectedProject(project);
                  setCurrentPage("project-detail");
                }}
                className="rounded-lg overflow-hidden shadow-sm text-left cursor-pointer hover:shadow-md transition-shadow group"
                style={{ backgroundColor: bgColor }}
                data-testid={`preview-gallery-project-${project.id}`}
              >
                <div 
                  className="h-56 bg-gray-200 relative"
                  style={{ 
                    backgroundImage: (project.coverImageUrl || project.cover_image_url) ? `url(${project.coverImageUrl || project.cover_image_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 text-white font-medium transition-opacity">
                      View Project
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <span 
                    className="text-xs font-medium px-2 py-1 rounded"
                    style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                  >
                    {project.projectType || project.project_type || "Project"}
                  </span>
                  <h3 className="font-semibold mt-2" style={{ color: textColor }}>{project.title}</h3>
                  {project.location && (
                    <p className="text-sm opacity-60 mt-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {project.location}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 opacity-60">
            <p>No projects published yet.</p>
          </div>
        )}
      </div>
    </section>
  );

  // PROJECT DETAIL
  const renderProjectDetail = () => {
    if (!selectedProject) return null;
    
    return (
      <section className={`${isMobile ? 'py-8' : 'py-16'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1000px' }}>
          <button
            onClick={() => navigateTo("gallery")}
            className="flex items-center gap-2 mb-6 cursor-pointer hover:opacity-80"
            style={{ color: primaryColor }}
            data-testid="preview-back-to-gallery"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Gallery
          </button>
          
          {(selectedProject.coverImageUrl || selectedProject.cover_image_url) && (
            <div 
              className="h-64 md:h-[500px] rounded-lg mb-8 bg-gray-200"
              style={{ 
                backgroundImage: `url(${selectedProject.coverImageUrl || selectedProject.cover_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          )}
          
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span 
              className="text-sm font-medium px-3 py-1 rounded"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              {selectedProject.projectType || selectedProject.project_type || "Project"}
            </span>
            {selectedProject.location && (
              <span className="text-sm opacity-60 flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {selectedProject.location}
              </span>
            )}
            {(selectedProject.completionDate || selectedProject.completion_date) && (
              <span className="text-sm opacity-60 flex items-center gap-1">
                <Calendar className="h-4 w-4" /> 
                Completed {new Date(selectedProject.completionDate || selectedProject.completion_date || '').toLocaleDateString()}
              </span>
            )}
          </div>
          
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-6`}
            style={{ color: textColor }}
          >
            {selectedProject.title}
          </h1>
          
          <div className="prose max-w-none">
            <p className="text-lg leading-relaxed opacity-80 mb-6">
              {selectedProject.shortDescription || selectedProject.short_description}
            </p>
            {(selectedProject.fullDescription || selectedProject.full_description) && (
              <p className="leading-relaxed opacity-70">
                {selectedProject.fullDescription || selectedProject.full_description}
              </p>
            )}
          </div>
          
          <div className="mt-8 pt-8" style={{ borderTop: `1px solid ${primaryColor}15` }}>
            <h3 className="font-semibold mb-4" style={{ color: textColor }}>Interested in a similar project?</h3>
            <button
              onClick={() => navigateTo("contact")}
              className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
              style={{ backgroundColor: primaryColor }}
            >
              Request a Quote
            </button>
          </div>
        </div>
      </section>
    );
  };

  // CONTACT PAGE
  const renderContactPage = () => {
    const customContact = findPageContent("contact");
    if (customContact?.contentJson) {
      try {
        const parsedConfig = JSON.parse(customContact.contentJson) as BodyComponentsConfig;
        if (parsedConfig.components && parsedConfig.components.filter(c => c.enabled).length > 0) {
          return renderBodyComponents(parsedConfig);
        }
      } catch (err) { console.warn("[WebsitePreview] Failed to parse page contentJson:", err); }
    }
    return (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4 text-center`}
          style={{ color: textColor }}
        >
          Contact Us
        </h1>
        <p className="text-center mb-12 opacity-70 max-w-2xl mx-auto">
          Ready to start your project? Get in touch with us today for a free consultation.
        </p>
        
        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-12`}>
          {/* Contact Form */}
          <div 
            className="p-6 rounded-lg"
            style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}
          >
            {contactFormSubmitted ? (
              <div className="text-center py-8">
                <div 
                  className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                  style={{ backgroundColor: `${accentColor}20` }}
                >
                  <CheckCircle className="h-8 w-8" style={{ color: accentColor }} />
                </div>
                <h3 className="text-xl font-semibold mb-2" style={{ color: textColor }}>Thank You!</h3>
                <p className="opacity-70">Your message has been received. We'll get back to you shortly.</p>
                <button
                  onClick={() => setContactFormSubmitted(false)}
                  className="mt-4 text-sm font-medium cursor-pointer"
                  style={{ color: primaryColor }}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-semibold mb-6" style={{ color: textColor }}>Send us a Message</h3>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    setContactFormSubmitted(true);
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>First Name</label>
                      <Input placeholder="John" data-testid="preview-contact-firstname" />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Last Name</label>
                      <Input placeholder="Doe" data-testid="preview-contact-lastname" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Email</label>
                    <Input type="email" placeholder="john@example.com" data-testid="preview-contact-email" />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Phone</label>
                    <Input type="tel" placeholder="(555) 123-4567" data-testid="preview-contact-phone" />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Message</label>
                    <Textarea 
                      placeholder="Tell us about your project..." 
                      rows={4}
                      data-testid="preview-contact-message"
                    />
                  </div>
                  <Button 
                    type="submit"
                    className="w-full"
                    style={{ backgroundColor: primaryColor }}
                    data-testid="preview-contact-submit"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Message
                  </Button>
                </form>
              </>
            )}
          </div>
          
          {/* Contact Info */}
          <div>
            <h3 className="text-xl font-semibold mb-6" style={{ color: textColor }}>Get in Touch</h3>
            <div className="space-y-6">
              {website.contactPhone && (
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <Phone className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                  <div>
                    <h4 className="font-medium" style={{ color: textColor }}>Phone</h4>
                    <p className="opacity-70">{website.contactPhone}</p>
                  </div>
                </div>
              )}
              {website.contactEmail && (
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <Mail className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                  <div>
                    <h4 className="font-medium" style={{ color: textColor }}>Email</h4>
                    <p className="opacity-70">{website.contactEmail}</p>
                  </div>
                </div>
              )}
              {website.contactAddress && (
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <MapPin className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                  <div>
                    <h4 className="font-medium" style={{ color: textColor }}>Address</h4>
                    <p className="opacity-70">{website.contactAddress}</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Map placeholder */}
            <div 
              className="mt-8 h-48 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${primaryColor}10` }}
            >
              <span className="opacity-50 text-sm">Map will be displayed here</span>
            </div>
          </div>
        </div>
      </div>
    </section>
    );
  };

  // CAREERS PAGE
  const renderCareersPage = () => {
    const subdomain = data.subdomain || '';
    const introText = data.careersIntroText;

    const filteredJobs = careersJobs.filter(job => {
      if (careersFilter.trade && (!job.trade || !job.trade.toLowerCase().includes(careersFilter.trade.toLowerCase()))) return false;
      if (careersFilter.location && (!job.location || !job.location.toLowerCase().includes(careersFilter.location.toLowerCase()))) return false;
      if (careersFilter.employmentType && (!job.employmentType || job.employmentType !== careersFilter.employmentType)) return false;
      return true;
    });

    const trades = [...new Set(careersJobs.map(j => j.trade).filter(Boolean))];
    const locations = [...new Set(careersJobs.map(j => j.location).filter(Boolean))];
    const employmentTypes = [...new Set(careersJobs.map(j => j.employmentType).filter(Boolean))];

    const formatEmploymentType = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const formatCompensation = (job: any) => {
      if (!job.compensationMin && !job.compensationMax) return null;
      const fmt = (v: string) => {
        const n = parseFloat(v);
        return isNaN(n) ? v : `$${n.toLocaleString()}`;
      };
      if (job.compensationMin && job.compensationMax) return `${fmt(job.compensationMin)} - ${fmt(job.compensationMax)}`;
      if (job.compensationMin) return `From ${fmt(job.compensationMin)}`;
      return `Up to ${fmt(job.compensationMax)}`;
    };

    return (
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h1 className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4`} style={{ color: textColor }} data-testid="text-careers-title">
            Careers
          </h1>
          {introText && (
            <p className="text-lg opacity-80 mb-8 max-w-3xl" data-testid="text-careers-intro">{introText}</p>
          )}

          {careersJobs.length > 3 && (
            <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} gap-3 mb-8`} data-testid="careers-filters">
              {trades.length > 1 && (
                <select
                  value={careersFilter.trade}
                  onChange={e => setCareersFilter(p => ({ ...p, trade: e.target.value }))}
                  className="px-3 py-2 rounded border text-sm"
                  style={{ borderColor: `${primaryColor}30` }}
                  data-testid="select-careers-trade"
                >
                  <option value="">All Trades</option>
                  {trades.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              {locations.length > 1 && (
                <select
                  value={careersFilter.location}
                  onChange={e => setCareersFilter(p => ({ ...p, location: e.target.value }))}
                  className="px-3 py-2 rounded border text-sm"
                  style={{ borderColor: `${primaryColor}30` }}
                  data-testid="select-careers-location"
                >
                  <option value="">All Locations</option>
                  {locations.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              )}
              {employmentTypes.length > 1 && (
                <select
                  value={careersFilter.employmentType}
                  onChange={e => setCareersFilter(p => ({ ...p, employmentType: e.target.value }))}
                  className="px-3 py-2 rounded border text-sm"
                  style={{ borderColor: `${primaryColor}30` }}
                  data-testid="select-careers-employment-type"
                >
                  <option value="">All Types</option>
                  {employmentTypes.map(t => <option key={t} value={t}>{formatEmploymentType(t)}</option>)}
                </select>
              )}
            </div>
          )}

          {filteredJobs.length === 0 ? (
            <div className="text-center py-12 rounded-lg" style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }} data-testid="text-careers-empty">
              <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="opacity-60">No open positions at this time. Check back soon!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredJobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => {
                    setSelectedJob(job);
                    setCurrentPage("job-detail");
                    setApplicationSubmitted(false);
                    if (subdomain) {
                      fetch(`/api/website/public/${subdomain}/careers/${job.id}`)
                        .then(r => r.ok ? r.json() : Promise.reject())
                        .then(d => setJobDetailData(d))
                        .catch(() => setJobDetailData(null));
                    }
                  }}
                  className="w-full text-left p-6 rounded-lg border transition-shadow hover:shadow-md"
                  style={{ borderColor: `${primaryColor}20`, backgroundColor: bgColor }}
                  data-testid={`card-job-${job.id}`}
                >
                  <div className={`flex ${isMobile ? 'flex-col gap-2' : 'items-center justify-between'}`}>
                    <div>
                      <h3 className="text-lg font-semibold" style={{ color: textColor }}>{job.title}</h3>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {job.location && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }}>
                            <MapPin className="h-3 w-3" />{job.location}
                          </span>
                        )}
                        {job.employmentType && (
                          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: `${accentColor}15`, color: accentColor }}>
                            {formatEmploymentType(job.employmentType)}
                          </span>
                        )}
                        {job.trade && (
                          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: `${secondaryColor}10`, color: secondaryColor }}>
                            {job.trade}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {formatCompensation(job) && (
                        <span className="text-sm font-medium" style={{ color: primaryColor }}>{formatCompensation(job)}</span>
                      )}
                      <ChevronRight className="h-5 w-5 opacity-40" />
                    </div>
                  </div>
                  {job.description && (
                    <p className="text-sm opacity-70 mt-3 line-clamp-2">{job.description}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  };

  // JOB DETAIL + APPLICATION FORM
  const renderJobDetailPage = () => {
    const job = jobDetailData || selectedJob;
    if (!job) return renderCareersPage();
    const subdomain = data.subdomain || '';

    const formatEmploymentType = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const formatCompensation = (j: any) => {
      if (!j.compensationMin && !j.compensationMax) return null;
      const fmt = (v: string) => { const n = parseFloat(v); return isNaN(n) ? v : `$${n.toLocaleString()}`; };
      if (j.compensationMin && j.compensationMax) return `${fmt(j.compensationMin)} - ${fmt(j.compensationMax)}`;
      if (j.compensationMin) return `From ${fmt(j.compensationMin)}`;
      return `Up to ${fmt(j.compensationMax)}`;
    };

    let screeningQuestions: Array<{ question: string; type?: string }> = [];
    if (job.screeningQuestionsJson) {
      try { screeningQuestions = JSON.parse(job.screeningQuestionsJson); } catch { /* ignore */ }
    }

    const handleApply = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (applicationSubmitting) return;
      setApplicationSubmitting(true);
      const formData = new FormData(e.currentTarget);

      const answers: Record<string, string> = {};
      screeningQuestions.forEach((q, i) => {
        const val = formData.get(`screening_${i}`);
        if (val) answers[q.question] = val.toString();
      });

      const submitData = new FormData();
      submitData.append('firstName', formData.get('firstName') as string);
      submitData.append('lastName', formData.get('lastName') as string);
      submitData.append('email', formData.get('email') as string);
      const phone = formData.get('phone') as string;
      if (phone) submitData.append('phone', phone);
      if (Object.keys(answers).length > 0) submitData.append('screeningAnswers', JSON.stringify(answers));
      const resume = formData.get('resume') as File;
      if (resume && resume.size > 0) submitData.append('resume', resume);

      try {
        const resp = await fetch(`/api/website/public/${subdomain}/careers/${job.id}/apply`, {
          method: 'POST',
          body: submitData,
        });
        if (resp.ok) {
          setApplicationSubmitted(true);
        } else {
          const data = await resp.json().catch(() => ({}));
          alert(data.error || 'Failed to submit application. Please try again.');
        }
      } catch {
        alert('Failed to submit application. Please try again.');
      } finally {
        setApplicationSubmitting(false);
      }
    };

    return (
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '900px' }}>
          <button
            onClick={() => { setSelectedJob(null); setJobDetailData(null); navigateTo("careers"); }}
            className="inline-flex items-center gap-1 text-sm mb-6 cursor-pointer hover:opacity-80"
            style={{ color: primaryColor }}
            data-testid="button-back-to-careers"
          >
            <ArrowLeft className="h-4 w-4" /> Back to all positions
          </button>

          <h1 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold mb-4`} style={{ color: textColor }} data-testid="text-job-title">
            {job.title}
          </h1>

          <div className="flex flex-wrap gap-3 mb-6">
            {job.location && (
              <span className="inline-flex items-center gap-1 text-sm px-3 py-1 rounded-full" style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }}>
                <MapPin className="h-4 w-4" />{job.location}
              </span>
            )}
            {job.employmentType && (
              <span className="text-sm px-3 py-1 rounded-full" style={{ backgroundColor: `${accentColor}15`, color: accentColor }}>
                {formatEmploymentType(job.employmentType)}
              </span>
            )}
            {job.department && (
              <span className="text-sm px-3 py-1 rounded-full" style={{ backgroundColor: `${secondaryColor}10`, color: secondaryColor }}>
                {job.department}
              </span>
            )}
            {formatCompensation(job) && (
              <span className="text-sm px-3 py-1 rounded-full font-medium" style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }}>
                {formatCompensation(job)}
              </span>
            )}
          </div>

          {job.description && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3" style={{ color: textColor }}>Description</h2>
              <p className="opacity-80 whitespace-pre-wrap" data-testid="text-job-description">{job.description}</p>
            </div>
          )}

          {job.requirements && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3" style={{ color: textColor }}>Requirements</h2>
              <p className="opacity-80 whitespace-pre-wrap" data-testid="text-job-requirements">{job.requirements}</p>
            </div>
          )}

          {job.preferredQualifications && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3" style={{ color: textColor }}>Preferred Qualifications</h2>
              <p className="opacity-80 whitespace-pre-wrap">{job.preferredQualifications}</p>
            </div>
          )}

          {job.certificationsRequired && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3" style={{ color: textColor }}>Required Certifications</h2>
              <p className="opacity-80 whitespace-pre-wrap">{job.certificationsRequired}</p>
            </div>
          )}

          <div className="mt-10 p-6 rounded-lg" style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}>
            {applicationSubmitted ? (
              <div className="text-center py-8" data-testid="text-application-success">
                <CheckCircle className="h-12 w-12 mx-auto mb-4" style={{ color: primaryColor }} />
                <h3 className="text-xl font-semibold mb-2" style={{ color: textColor }}>Application Submitted!</h3>
                <p className="opacity-70">Thank you for your interest. We'll review your application and get back to you.</p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-semibold mb-6" style={{ color: textColor }} data-testid="text-apply-heading">Apply for this Position</h2>
                <form onSubmit={handleApply} className="space-y-4">
                  <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: textColor }}>First Name *</label>
                      <input name="firstName" required className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: `${primaryColor}30` }} data-testid="input-apply-first-name" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: textColor }}>Last Name *</label>
                      <input name="lastName" required className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: `${primaryColor}30` }} data-testid="input-apply-last-name" />
                    </div>
                  </div>
                  <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: textColor }}>Email *</label>
                      <input name="email" type="email" required className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: `${primaryColor}30` }} data-testid="input-apply-email" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: textColor }}>Phone</label>
                      <input name="phone" type="tel" className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: `${primaryColor}30` }} data-testid="input-apply-phone" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: textColor }}>Resume (PDF or Word)</label>
                    <input name="resume" type="file" accept=".pdf,.doc,.docx" className="w-full text-sm" data-testid="input-apply-resume" />
                  </div>
                  {screeningQuestions.length > 0 && (
                    <div className="space-y-4 pt-2">
                      <h3 className="font-medium" style={{ color: textColor }}>Screening Questions</h3>
                      {screeningQuestions.map((q, i) => (
                        <div key={i}>
                          <label className="block text-sm font-medium mb-1" style={{ color: textColor }}>{q.question}</label>
                          <textarea name={`screening_${i}`} rows={2} className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: `${primaryColor}30` }} data-testid={`input-screening-${i}`} />
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={applicationSubmitting}
                    className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: primaryColor }}
                    data-testid="button-submit-application"
                  >
                    {applicationSubmitting ? 'Submitting...' : 'Submit Application'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    );
  };

  // Main render based on current page
  const renderCurrentPage = () => {
    // Handle custom pages (those starting with "custom-")
    if (currentPage.startsWith("custom-")) {
      const pageId = currentPage.replace("custom-", "");
      return renderCustomPage(pageId);
    }
    
    switch (currentPage) {
      case "home":
        return renderHomePage();
      case "about":
        return renderAboutPage();
      case "services":
        return renderServicesPage();
      case "blog":
        return renderBlogPage();
      case "blog-post":
        return renderBlogPostDetail();
      case "gallery":
        return renderGalleryPage();
      case "project-detail":
        return renderProjectDetail();
      case "contact":
        return renderContactPage();
      case "careers":
        return renderCareersPage();
      case "job-detail":
        return renderJobDetailPage();
      default:
        return renderHomePage();
    }
  };

  return (
    <div 
      className="min-h-full w-full"
      style={{ 
        fontFamily,
        backgroundColor: bgColor,
        color: textColor,
        position: 'relative',
      }}
      data-testid="preview-container"
    >
      {renderHeader()}
      {isMobile && mobileNavStyle !== 'dropdown' && renderMobileMenu(
        data.headerConfig ? '#fff' : bgColor,
        data.headerConfig ? '#374151' : textColor
      )}
      {renderCurrentPage()}
      {renderFooter()}
      {data.footerConfig?.backToTop?.enabled && (() => {
        const btt = data.footerConfig!.backToTop!;
        const btnSize = btt.size || 40;
        return (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              width: '100%',
              height: 0,
              overflow: 'visible',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            <button
              data-testid="preview-back-to-top"
              onClick={(e) => {
                let el: HTMLElement | null = e.currentTarget as HTMLElement;
                while (el) {
                  const style = window.getComputedStyle(el);
                  if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    el.scrollTo({ top: 0, behavior: 'smooth' });
                    return;
                  }
                  el = el.parentElement;
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              style={{
                position: 'absolute',
                bottom: '20px',
                right: '20px',
                width: `${btnSize}px`,
                height: `${btnSize}px`,
                padding: `${btt.padding || 8}px`,
                backgroundColor: btt.backgroundColor || 'rgba(255,255,255,0.1)',
                border: `${btt.borderWidth || 1}px solid ${btt.borderColor || 'rgba(255,255,255,0.2)'}`,
                borderRadius: `${btt.borderRadius || 6}px`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
              }}
            >
              {btt.type === "image" && btt.imageUrl ? (
                <img
                  src={btt.imageUrl}
                  alt="Back to top"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <ArrowUp size={Math.round(btnSize * 0.5)} color="#fff" />
              )}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
