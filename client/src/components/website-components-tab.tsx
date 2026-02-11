import { useState, useCallback, useRef } from "react";
import { ImageUploadField } from "@/components/website-body-components";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Monitor,
  Smartphone,
  GripVertical,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Settings,
  Save,
  Loader2,
  RotateCcw,
  Image,
  Navigation,
  MousePointer,
  Search,
  User,
  Share2,
  Megaphone,
  ArrowUp,
  Link,
  Type,
  Copyright,
  Zap,
  Briefcase,
  TrendingUp,
  LayoutDashboard,
  Minus,
  Award,
  Shield,
  Check,
  Menu,
  PanelLeft,
  PanelRight,
  FileText,
} from "lucide-react";

export interface HeaderElement {
  id: string;
  type: "logo" | "navigation" | "cta_button" | "search_icon" | "login_button" | "social_icons" | "announcement_bar";
  label: string;
  enabled: boolean;
  alignment: "left" | "center" | "right";
  visibleDesktop: boolean;
  visibleMobile: boolean;
  content: Record<string, string>;
  order: number;
  section: "top" | "middle" | "bottom";
  column: number;
}

export interface FooterElement {
  id: string;
  type: "footer_logo" | "social_icons" | "copyright" | "link_list" | "footer_title";
  label: string;
  enabled: boolean;
  alignment: "left" | "center" | "right";
  visibleDesktop: boolean;
  visibleMobile: boolean;
  content: Record<string, string>;
  order: number;
  section: "top" | "middle" | "bottom";
  column: number;
}

export interface BackToTopConfig {
  enabled: boolean;
  type: "icon" | "image";
  imageUrl: string;
  size: number;
  padding: number;
  backgroundColor: string;
  borderWidth: number;
  borderRadius: number;
  borderColor: string;
}

export interface HeaderComponentsConfig {
  desktop: {
    sections: {
      top: { columns: number; elements: HeaderElement[] };
      middle: { columns: number; elements: HeaderElement[] };
      bottom: { columns: number; elements: HeaderElement[] };
    };
  };
  mobile: {
    columns: number;
    elements: HeaderElement[];
  };
}

export interface FooterComponentsConfig {
  desktop: {
    sections: {
      top: { columns: number; elements: FooterElement[] };
      middle: { columns: number; elements: FooterElement[] };
      bottom: { columns: number; elements: FooterElement[] };
    };
  };
  mobile: {
    columns: number;
    elements: FooterElement[];
  };
  backToTop?: BackToTopConfig;
}

const DEFAULT_HEADER_ELEMENTS: HeaderElement[] = [
  { id: "h-logo", type: "logo", label: "Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "middle", column: 0 },
  { id: "h-nav", type: "navigation", label: "Main Navigation", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: false, content: {}, order: 1, section: "middle", column: 1 },
  { id: "h-cta", type: "cta_button", label: "Primary CTA Button", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: { text: "Get Started", url: "#" }, order: 2, section: "middle", column: 2 },
  { id: "h-search", type: "search_icon", label: "Search Icon", enabled: false, alignment: "right", visibleDesktop: true, visibleMobile: false, content: {}, order: 3, section: "middle", column: 2 },
  { id: "h-login", type: "login_button", label: "Login / Account", enabled: false, alignment: "right", visibleDesktop: true, visibleMobile: true, content: { text: "Login" }, order: 4, section: "middle", column: 2 },
  { id: "h-social", type: "social_icons", label: "Social Icons", enabled: false, alignment: "center", visibleDesktop: true, visibleMobile: false, content: {}, order: 0, section: "top", column: 1 },
  { id: "h-announce", type: "announcement_bar", label: "Announcement Bar", enabled: false, alignment: "center", visibleDesktop: true, visibleMobile: true, content: { text: "Welcome to our site!" }, order: 0, section: "top", column: 0 },
];

const DEFAULT_FOOTER_ELEMENTS: FooterElement[] = [
  { id: "f-logo", type: "footer_logo", label: "Footer Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "top", column: 0 },
  { id: "f-social", type: "social_icons", label: "Social Media Icons", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: {}, order: 1, section: "middle", column: 1 },
  { id: "f-copyright", type: "copyright", label: "Copyright Notice", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: { text: "© 2026 All rights reserved." }, order: 0, section: "bottom", column: 0 },
  { id: "f-links", type: "link_list", label: "Link List", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { orientation: "vertical" }, order: 0, section: "middle", column: 0 },
  { id: "f-title", type: "footer_title", label: "Footer Title", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { text: "Quick Links" }, order: 0, section: "top", column: 1 },
];

const DEFAULT_BACK_TO_TOP: BackToTopConfig = {
  enabled: true,
  type: "icon",
  imageUrl: "",
  size: 40,
  padding: 8,
  backgroundColor: "rgba(255,255,255,0.1)",
  borderWidth: 1,
  borderRadius: 6,
  borderColor: "rgba(255,255,255,0.2)",
};

export function getDefaultHeaderConfig(): HeaderComponentsConfig {
  return {
    desktop: {
      sections: {
        top: { columns: 3, elements: DEFAULT_HEADER_ELEMENTS.filter(e => e.section === "top") },
        middle: { columns: 3, elements: DEFAULT_HEADER_ELEMENTS.filter(e => e.section === "middle") },
        bottom: { columns: 3, elements: DEFAULT_HEADER_ELEMENTS.filter(e => e.section === "bottom") },
      },
    },
    mobile: {
      columns: 2,
      elements: DEFAULT_HEADER_ELEMENTS.map(e => ({ ...e, visibleMobile: e.visibleMobile })),
    },
  };
}

export function getDefaultFooterConfig(): FooterComponentsConfig {
  return {
    desktop: {
      sections: {
        top: { columns: 4, elements: DEFAULT_FOOTER_ELEMENTS.filter(e => e.section === "top") },
        middle: { columns: 4, elements: DEFAULT_FOOTER_ELEMENTS.filter(e => e.section === "middle") },
        bottom: { columns: 4, elements: DEFAULT_FOOTER_ELEMENTS.filter(e => e.section === "bottom") },
      },
    },
    mobile: {
      columns: 2,
      elements: DEFAULT_FOOTER_ELEMENTS.map(e => ({ ...e })),
    },
    backToTop: { ...DEFAULT_BACK_TO_TOP },
  };
}

interface HeaderPreset {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  elements: HeaderElement[];
}

interface FooterPreset {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  elements: FooterElement[];
}

const HEADER_PRESETS: HeaderPreset[] = [
  {
    id: "simple-business",
    name: "Simple Business Header",
    description: "Logo (left), Navigation (center), CTA (right)",
    bestFor: "Best for service businesses",
    elements: [
      { id: "h-logo", type: "logo", label: "Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "middle", column: 0 },
      { id: "h-nav", type: "navigation", label: "Main Navigation", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: false, content: {}, order: 1, section: "middle", column: 1 },
      { id: "h-cta", type: "cta_button", label: "Primary CTA Button", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: { text: "Get Started", url: "#" }, order: 2, section: "middle", column: 2 },
      { id: "h-search", type: "search_icon", label: "Search Icon", enabled: false, alignment: "right", visibleDesktop: false, visibleMobile: false, content: {}, order: 3, section: "middle", column: 2 },
      { id: "h-login", type: "login_button", label: "Login / Account", enabled: false, alignment: "right", visibleDesktop: false, visibleMobile: false, content: { text: "Login" }, order: 4, section: "middle", column: 2 },
      { id: "h-social", type: "social_icons", label: "Social Icons", enabled: false, alignment: "center", visibleDesktop: false, visibleMobile: false, content: {}, order: 0, section: "top", column: 1 },
      { id: "h-announce", type: "announcement_bar", label: "Announcement Bar", enabled: false, alignment: "center", visibleDesktop: false, visibleMobile: false, content: { text: "Welcome to our site!" }, order: 0, section: "top", column: 0 },
    ],
  },
  {
    id: "marketing",
    name: "Marketing Header",
    description: "Top: Announcement bar. Middle: Logo, Nav, CTA. Bottom: Search",
    bestFor: "Conversion-focused",
    elements: [
      { id: "h-announce", type: "announcement_bar", label: "Announcement Bar", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: { text: "Limited time offer - 20% off!" }, order: 0, section: "top", column: 0 },
      { id: "h-logo", type: "logo", label: "Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "middle", column: 0 },
      { id: "h-nav", type: "navigation", label: "Main Navigation", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: false, content: {}, order: 1, section: "middle", column: 1 },
      { id: "h-cta", type: "cta_button", label: "Primary CTA Button", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: { text: "Get Started", url: "#" }, order: 2, section: "middle", column: 2 },
      { id: "h-search", type: "search_icon", label: "Search Icon", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "bottom", column: 1 },
      { id: "h-login", type: "login_button", label: "Login / Account", enabled: false, alignment: "right", visibleDesktop: false, visibleMobile: false, content: { text: "Login" }, order: 4, section: "middle", column: 2 },
      { id: "h-social", type: "social_icons", label: "Social Icons", enabled: false, alignment: "center", visibleDesktop: false, visibleMobile: false, content: {}, order: 1, section: "top", column: 1 },
    ],
  },
  {
    id: "app-portal",
    name: "App / Portal Header",
    description: "Logo, Nav, Search, Login / Account",
    bestFor: "Perfect for dashboards",
    elements: [
      { id: "h-logo", type: "logo", label: "Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "middle", column: 0 },
      { id: "h-nav", type: "navigation", label: "Main Navigation", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: false, content: {}, order: 1, section: "middle", column: 1 },
      { id: "h-search", type: "search_icon", label: "Search Icon", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: {}, order: 2, section: "middle", column: 2 },
      { id: "h-login", type: "login_button", label: "Login / Account", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: { text: "Login" }, order: 3, section: "middle", column: 2 },
      { id: "h-cta", type: "cta_button", label: "Primary CTA Button", enabled: false, alignment: "right", visibleDesktop: false, visibleMobile: false, content: { text: "Get Started", url: "#" }, order: 4, section: "middle", column: 2 },
      { id: "h-social", type: "social_icons", label: "Social Icons", enabled: false, alignment: "center", visibleDesktop: false, visibleMobile: false, content: {}, order: 0, section: "top", column: 1 },
      { id: "h-announce", type: "announcement_bar", label: "Announcement Bar", enabled: false, alignment: "center", visibleDesktop: false, visibleMobile: false, content: { text: "Welcome to our site!" }, order: 0, section: "top", column: 0 },
    ],
  },
];

const FOOTER_PRESETS: FooterPreset[] = [
  {
    id: "simple",
    name: "Simple Footer",
    description: "Logo and Copyright",
    bestFor: "Clean. Minimal. Polite.",
    elements: [
      { id: "f-logo", type: "footer_logo", label: "Footer Logo", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "top", column: 1 },
      { id: "f-copyright", type: "copyright", label: "Copyright Notice", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: { text: "\u00a9 2026 All rights reserved." }, order: 0, section: "bottom", column: 1 },
      { id: "f-social", type: "social_icons", label: "Social Media Icons", enabled: false, alignment: "center", visibleDesktop: false, visibleMobile: false, content: {}, order: 1, section: "middle", column: 1 },
      { id: "f-links", type: "link_list", label: "Link List", enabled: false, alignment: "left", visibleDesktop: false, visibleMobile: false, content: { orientation: "vertical" }, order: 0, section: "middle", column: 0 },
      { id: "f-title", type: "footer_title", label: "Footer Title", enabled: false, alignment: "left", visibleDesktop: false, visibleMobile: false, content: { text: "Quick Links" }, order: 0, section: "top", column: 0 },
    ],
  },
  {
    id: "standard",
    name: "Standard Footer",
    description: "Col 1: Logo + description. Col 2: Links. Col 3: Links. Col 4: Social",
    bestFor: "The crowd favorite",
    elements: [
      { id: "f-logo", type: "footer_logo", label: "Footer Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "top", column: 0 },
      { id: "f-title", type: "footer_title", label: "Company Description", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { text: "Building better projects, together." }, order: 1, section: "top", column: 0 },
      { id: "f-links", type: "link_list", label: "Quick Links", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { orientation: "vertical" }, order: 0, section: "top", column: 1 },
      { id: "f-social", type: "social_icons", label: "Social Media Icons", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "top", column: 3 },
      { id: "f-copyright", type: "copyright", label: "Copyright Notice", enabled: true, alignment: "center", visibleDesktop: true, visibleMobile: true, content: { text: "\u00a9 2026 All rights reserved." }, order: 0, section: "bottom", column: 0 },
    ],
  },
  {
    id: "compliance-corporate",
    name: "Compliance / Corporate Footer",
    description: "Policies, compliance docs, contact info, back-to-top",
    bestFor: "Very enterprise. Very serious.",
    elements: [
      { id: "f-title", type: "footer_title", label: "Legal & Compliance", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { text: "Legal & Compliance" }, order: 0, section: "top", column: 0 },
      { id: "f-links", type: "link_list", label: "Policy Links", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { orientation: "vertical" }, order: 0, section: "top", column: 1 },
      { id: "f-logo", type: "footer_logo", label: "Company Logo", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "top", column: 2 },
      { id: "f-social", type: "social_icons", label: "Contact & Social", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: {}, order: 0, section: "top", column: 3 },
      { id: "f-copyright", type: "copyright", label: "Copyright Notice", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { text: "\u00a9 2026 All rights reserved. All trademarks are property of their respective owners." }, order: 0, section: "bottom", column: 0 },
    ],
  },
];

function buildConfigFromPresetElements(elements: HeaderElement[]): HeaderComponentsConfig {
  return {
    desktop: {
      sections: {
        top: { columns: 3, elements: elements.filter(e => e.section === "top") },
        middle: { columns: 3, elements: elements.filter(e => e.section === "middle") },
        bottom: { columns: 3, elements: elements.filter(e => e.section === "bottom") },
      },
    },
    mobile: {
      columns: 2,
      elements: elements.map(e => ({ ...e })),
    },
  };
}

function buildFooterConfigFromPresetElements(elements: FooterElement[]): FooterComponentsConfig {
  return {
    desktop: {
      sections: {
        top: { columns: 4, elements: elements.filter(e => e.section === "top") },
        middle: { columns: 4, elements: elements.filter(e => e.section === "middle") },
        bottom: { columns: 4, elements: elements.filter(e => e.section === "bottom") },
      },
    },
    mobile: {
      columns: 2,
      elements: elements.map(e => ({ ...e })),
    },
  };
}

const ELEMENT_ICONS: Record<string, typeof Image> = {
  logo: Image,
  navigation: Navigation,
  cta_button: MousePointer,
  search_icon: Search,
  login_button: User,
  social_icons: Share2,
  announcement_bar: Megaphone,
  footer_logo: Image,
  copyright: Copyright,
  link_list: Link,
  footer_title: Type,
};

interface WebsiteComponentsTabProps {
  headerConfig: HeaderComponentsConfig;
  footerConfig: FooterComponentsConfig;
  onHeaderConfigChange: (config: HeaderComponentsConfig) => void;
  onFooterConfigChange: (config: FooterComponentsConfig) => void;
  onSave: () => void;
  isSaving: boolean;
  headerLayoutSettings?: {
    headerType: string;
    headerHeight: number;
    logoPosition: string;
    navigationLayout: string;
    mobileNavStyle: string;
    showOnScroll: boolean;
  };
  onHeaderLayoutChange?: (updates: Partial<NonNullable<WebsiteComponentsTabProps['headerLayoutSettings']>>) => void;
  footerLayoutSettings?: {
    footerVisibility: boolean;
    footerColumns: number;
    footerWidth: string;
    footerPadding: number;
  };
  onFooterLayoutChange?: (updates: Partial<NonNullable<WebsiteComponentsTabProps['footerLayoutSettings']>>) => void;
  innerPageSettings?: {
    pageLayout: string;
    sidebarWidth: number;
    pagePadding: number;
    showBreadcrumb: boolean;
  };
  onInnerPageChange?: (updates: Partial<NonNullable<WebsiteComponentsTabProps['innerPageSettings']>>) => void;
}

const DEFAULT_HEADER_LAYOUT = {
  headerType: "static",
  headerHeight: 80,
  logoPosition: "left",
  navigationLayout: "horizontal",
  mobileNavStyle: "dropdown",
  showOnScroll: true,
};

const DEFAULT_FOOTER_LAYOUT = {
  footerVisibility: true,
  footerColumns: 3,
  footerWidth: "boxed",
  footerPadding: 40,
};

const DEFAULT_INNER_PAGE = {
  pageLayout: "boxed",
  sidebarWidth: 300,
  pagePadding: 32,
  showBreadcrumb: true,
};

const noop = () => {};

export default function WebsiteComponentsTab({
  headerConfig,
  footerConfig,
  onHeaderConfigChange,
  onFooterConfigChange,
  onSave,
  isSaving,
  headerLayoutSettings = DEFAULT_HEADER_LAYOUT,
  onHeaderLayoutChange = noop,
  footerLayoutSettings = DEFAULT_FOOTER_LAYOUT,
  onFooterLayoutChange = noop,
  innerPageSettings = DEFAULT_INNER_PAGE,
  onInnerPageChange = noop,
}: WebsiteComponentsTabProps) {
  const [deviceView, setDeviceView] = useState<"desktop" | "mobile">("desktop");
  const [expandedElement, setExpandedElement] = useState<string | null>(null);
  const [activeGlobal, setActiveGlobal] = useState<"header" | "footer" | "innerpage">("header");
  const [showPresets, setShowPresets] = useState(false);
  const [activeHeaderPreset, setActiveHeaderPreset] = useState<string | null>(null);
  const [activeFooterPreset, setActiveFooterPreset] = useState<string | null>(null);

  const dragItem = useRef<{ id: string; sourceSection: string; sourceColumn: number } | null>(null);
  const dragOverItem = useRef<{ id: string; targetSection: string; targetColumn: number } | null>(null);

  const handleResetComponents = () => {
    onHeaderConfigChange(getDefaultHeaderConfig());
    onFooterConfigChange(getDefaultFooterConfig());
    setActiveHeaderPreset(null);
    setActiveFooterPreset(null);
  };

  const applyHeaderPreset = useCallback((preset: HeaderPreset) => {
    const config = buildConfigFromPresetElements(preset.elements.map(e => ({ ...e })));
    onHeaderConfigChange(config);
    setActiveHeaderPreset(preset.id);
  }, [onHeaderConfigChange]);

  const applyFooterPreset = useCallback((preset: FooterPreset) => {
    const config = buildFooterConfigFromPresetElements(preset.elements.map(e => ({ ...e })));
    onFooterConfigChange(config);
    setActiveFooterPreset(preset.id);
  }, [onFooterConfigChange]);

  const updateHeaderElement = useCallback((elementId: string, updates: Partial<HeaderElement>) => {
    const newConfig = JSON.parse(JSON.stringify(headerConfig)) as HeaderComponentsConfig;
    const deviceOnlyKeys = new Set(["visibleDesktop", "visibleMobile"]);
    const globalUpdates: Partial<HeaderElement> = {};
    const localUpdates: Partial<HeaderElement> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (deviceOnlyKeys.has(k)) {
        localUpdates[k as keyof HeaderElement] = v as any;
      } else {
        globalUpdates[k as keyof HeaderElement] = v as any;
      }
    }

    for (const sectionKey of ["top", "middle", "bottom"] as const) {
      const section = newConfig.desktop.sections[sectionKey];
      const idx = section.elements.findIndex(e => e.id === elementId);
      if (idx !== -1) {
        section.elements[idx] = { ...section.elements[idx], ...globalUpdates, ...(deviceView === "desktop" ? localUpdates : {}) };
      }
    }
    const mIdx = newConfig.mobile.elements.findIndex(e => e.id === elementId);
    if (mIdx !== -1) {
      newConfig.mobile.elements[mIdx] = { ...newConfig.mobile.elements[mIdx], ...globalUpdates, ...(deviceView === "mobile" ? localUpdates : {}) };
    }

    onHeaderConfigChange(newConfig);
  }, [headerConfig, deviceView, onHeaderConfigChange]);

  const updateFooterElement = useCallback((elementId: string, updates: Partial<FooterElement>) => {
    const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
    const deviceOnlyKeys = new Set(["visibleDesktop", "visibleMobile"]);
    const globalUpdates: Partial<FooterElement> = {};
    const localUpdates: Partial<FooterElement> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (deviceOnlyKeys.has(k)) {
        localUpdates[k as keyof FooterElement] = v as any;
      } else {
        globalUpdates[k as keyof FooterElement] = v as any;
      }
    }

    for (const sectionKey of ["top", "middle", "bottom"] as const) {
      const section = newConfig.desktop.sections[sectionKey];
      const idx = section.elements.findIndex(e => e.id === elementId);
      if (idx !== -1) {
        section.elements[idx] = { ...section.elements[idx], ...globalUpdates, ...(deviceView === "desktop" ? localUpdates : {}) };
      }
    }
    const mIdx = newConfig.mobile.elements.findIndex(e => e.id === elementId);
    if (mIdx !== -1) {
      newConfig.mobile.elements[mIdx] = { ...newConfig.mobile.elements[mIdx], ...globalUpdates, ...(deviceView === "mobile" ? localUpdates : {}) };
    }

    onFooterConfigChange(newConfig);
  }, [footerConfig, deviceView, onFooterConfigChange]);

  const moveHeaderElement = useCallback((elementId: string, targetSection: "top" | "middle" | "bottom", targetColumn: number) => {
    const newConfig = JSON.parse(JSON.stringify(headerConfig)) as HeaderComponentsConfig;
    let element: HeaderElement | null = null;
    for (const sectionKey of ["top", "middle", "bottom"] as const) {
      const section = newConfig.desktop.sections[sectionKey];
      const idx = section.elements.findIndex(e => e.id === elementId);
      if (idx !== -1) {
        element = section.elements.splice(idx, 1)[0];
        break;
      }
    }
    if (element) {
      element.section = targetSection;
      element.column = targetColumn;
      element.order = newConfig.desktop.sections[targetSection].elements.length;
      newConfig.desktop.sections[targetSection].elements.push(element);
    }
    onHeaderConfigChange(newConfig);
  }, [headerConfig, onHeaderConfigChange]);

  const moveFooterElement = useCallback((elementId: string, targetSection: "top" | "middle" | "bottom", targetColumn: number) => {
    const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
    let element: FooterElement | null = null;
    for (const sectionKey of ["top", "middle", "bottom"] as const) {
      const section = newConfig.desktop.sections[sectionKey];
      const idx = section.elements.findIndex(e => e.id === elementId);
      if (idx !== -1) {
        element = section.elements.splice(idx, 1)[0];
        break;
      }
    }
    if (element) {
      element.section = targetSection;
      element.column = targetColumn;
      element.order = newConfig.desktop.sections[targetSection].elements.length;
      newConfig.desktop.sections[targetSection].elements.push(element);
    }
    onFooterConfigChange(newConfig);
  }, [footerConfig, onFooterConfigChange]);

  const reorderElements = useCallback((
    componentType: "header" | "footer",
    sectionKey: "top" | "middle" | "bottom",
    dragIdx: number,
    dropIdx: number
  ) => {
    if (componentType === "header") {
      const newConfig = JSON.parse(JSON.stringify(headerConfig)) as HeaderComponentsConfig;
      const elements = newConfig.desktop.sections[sectionKey].elements;
      const [moved] = elements.splice(dragIdx, 1);
      elements.splice(dropIdx, 0, moved);
      elements.forEach((el, i) => { el.order = i; });
      onHeaderConfigChange(newConfig);
    } else {
      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
      const elements = newConfig.desktop.sections[sectionKey].elements;
      const [moved] = elements.splice(dragIdx, 1);
      elements.splice(dropIdx, 0, moved);
      elements.forEach((el, i) => { el.order = i; });
      onFooterConfigChange(newConfig);
    }
  }, [headerConfig, footerConfig, onHeaderConfigChange, onFooterConfigChange]);

  const reorderMobileElements = useCallback((
    componentType: "header" | "footer",
    dragIdx: number,
    dropIdx: number
  ) => {
    if (componentType === "header") {
      const newConfig = JSON.parse(JSON.stringify(headerConfig)) as HeaderComponentsConfig;
      const elements = newConfig.mobile.elements;
      const [moved] = elements.splice(dragIdx, 1);
      elements.splice(dropIdx, 0, moved);
      elements.forEach((el, i) => { el.order = i; });
      onHeaderConfigChange(newConfig);
    } else {
      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
      const elements = newConfig.mobile.elements;
      const [moved] = elements.splice(dragIdx, 1);
      elements.splice(dropIdx, 0, moved);
      elements.forEach((el, i) => { el.order = i; });
      onFooterConfigChange(newConfig);
    }
  }, [headerConfig, footerConfig, onHeaderConfigChange, onFooterConfigChange]);

  const renderElementCard = (
    element: HeaderElement | FooterElement,
    componentType: "header" | "footer",
    index: number,
    sectionKey: "top" | "middle" | "bottom" | "mobile",
    totalInSection: number
  ) => {
    const IconComp = ELEMENT_ICONS[element.type] || Settings;
    const isExpanded = expandedElement === element.id;
    const updateFn = componentType === "header" ? updateHeaderElement : updateFooterElement;
    const maxColumns = componentType === "header" ? 3 : 4;

    return (
      <div
        key={element.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          dragItem.current = { id: element.id, sourceSection: sectionKey, sourceColumn: element.column };
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          dragOverItem.current = { id: element.id, targetSection: sectionKey, targetColumn: element.column };
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragItem.current && dragOverItem.current && dragItem.current.id !== dragOverItem.current.id) {
            if (sectionKey === "mobile") {
              const elements = componentType === "header" ? headerConfig.mobile.elements : footerConfig.mobile.elements;
              const dragIndex = elements.findIndex(el => el.id === dragItem.current!.id);
              const dropIndex = elements.findIndex(el => el.id === dragOverItem.current!.id);
              if (dragIndex !== -1 && dropIndex !== -1) {
                reorderMobileElements(componentType, dragIndex, dropIndex);
              }
            } else {
              const section = componentType === "header"
                ? headerConfig.desktop.sections[sectionKey as "top" | "middle" | "bottom"]
                : footerConfig.desktop.sections[sectionKey as "top" | "middle" | "bottom"];
              const dragIndex = section.elements.findIndex(el => el.id === dragItem.current!.id);
              const dropIndex = section.elements.findIndex(el => el.id === dragOverItem.current!.id);
              if (dragIndex !== -1 && dropIndex !== -1) {
                reorderElements(componentType, sectionKey as "top" | "middle" | "bottom", dragIndex, dropIndex);
              }
            }
          }
          dragItem.current = null;
          dragOverItem.current = null;
        }}
        className={`border rounded-md transition-colors ${element.enabled ? "bg-card" : "opacity-50"}`}
        data-testid={`element-card-${element.id}`}
      >
        <div className="flex items-center gap-2 p-3">
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
          <IconComp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium flex-1 truncate">{element.label}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Badge variant={element.visibleDesktop ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
              <Monitor className="h-3 w-3" />
            </Badge>
            <Badge variant={element.visibleMobile ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
              <Smartphone className="h-3 w-3" />
            </Badge>
          </div>
          <Switch
            checked={element.enabled}
            onCheckedChange={(checked) => updateFn(element.id, { enabled: checked })}
            data-testid={`switch-enable-${element.id}`}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setExpandedElement(isExpanded ? null : element.id)}
            data-testid={`button-expand-${element.id}`}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {isExpanded && (
          <div className="px-3 pb-3 space-y-3 border-t pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Alignment</Label>
                <Select
                  value={element.alignment}
                  onValueChange={(val) => updateFn(element.id, { alignment: val as "left" | "center" | "right" })}
                >
                  <SelectTrigger className="h-8" data-testid={`select-alignment-${element.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sectionKey !== "mobile" && (
                <div className="space-y-1">
                  <Label className="text-xs">Column</Label>
                  <Select
                    value={String(element.column)}
                    onValueChange={(val) => {
                      const newCol = parseInt(val);
                      const sec = sectionKey as "top" | "middle" | "bottom";
                      if (componentType === "header") {
                        moveHeaderElement(element.id, sec, newCol);
                      } else {
                        moveFooterElement(element.id, sec, newCol);
                      }
                    }}
                  >
                    <SelectTrigger className="h-8" data-testid={`select-column-${element.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: maxColumns }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>Column {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {sectionKey !== "mobile" && (
                <div className="space-y-1">
                  <Label className="text-xs">Section</Label>
                  <Select
                    value={element.section}
                    onValueChange={(val) => {
                      if (componentType === "header") {
                        moveHeaderElement(element.id, val as "top" | "middle" | "bottom", element.column);
                      } else {
                        moveFooterElement(element.id, val as "top" | "middle" | "bottom", element.column);
                      }
                    }}
                  >
                    <SelectTrigger className="h-8" data-testid={`select-section-${element.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Top</SelectItem>
                      <SelectItem value="middle">Middle</SelectItem>
                      <SelectItem value="bottom">Bottom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Desktop</Label>
                <Switch
                  checked={element.visibleDesktop}
                  onCheckedChange={(checked) => updateFn(element.id, { visibleDesktop: checked })}
                  data-testid={`switch-desktop-${element.id}`}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Mobile</Label>
                <Switch
                  checked={element.visibleMobile}
                  onCheckedChange={(checked) => updateFn(element.id, { visibleMobile: checked })}
                  data-testid={`switch-mobile-${element.id}`}
                />
              </div>
            </div>

            {(element.type === "cta_button" || element.type === "login_button") && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">Button Text</Label>
                  <Input
                    className="h-8"
                    value={element.content.text || ""}
                    onChange={(e) => updateFn(element.id, { content: { ...element.content, text: e.target.value } })}
                    data-testid={`input-text-${element.id}`}
                  />
                </div>
                {element.type === "cta_button" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Button URL</Label>
                    <Input
                      className="h-8"
                      value={element.content.url || ""}
                      onChange={(e) => updateFn(element.id, { content: { ...element.content, url: e.target.value } })}
                      data-testid={`input-url-${element.id}`}
                    />
                  </div>
                )}
              </div>
            )}

            {element.type === "announcement_bar" && (
              <div className="space-y-1">
                <Label className="text-xs">Announcement Text</Label>
                <Input
                  className="h-8"
                  value={element.content.text || ""}
                  onChange={(e) => updateFn(element.id, { content: { ...element.content, text: e.target.value } })}
                  data-testid={`input-text-${element.id}`}
                />
              </div>
            )}

            {element.type === "copyright" && (
              <div className="space-y-1">
                <Label className="text-xs">Copyright Text</Label>
                <Input
                  className="h-8"
                  value={element.content.text || ""}
                  onChange={(e) => updateFn(element.id, { content: { ...element.content, text: e.target.value } })}
                  data-testid={`input-text-${element.id}`}
                />
              </div>
            )}

            {element.type === "footer_title" && (
              <div className="space-y-1">
                <Label className="text-xs">Title Text</Label>
                <Input
                  className="h-8"
                  value={element.content.text || ""}
                  onChange={(e) => updateFn(element.id, { content: { ...element.content, text: e.target.value } })}
                  data-testid={`input-text-${element.id}`}
                />
              </div>
            )}

            {element.type === "link_list" && (
              <div className="space-y-1">
                <Label className="text-xs">Link Orientation</Label>
                <Select
                  value={element.content.orientation || "vertical"}
                  onValueChange={(val) => updateFn(element.id, { content: { ...element.content, orientation: val } })}
                >
                  <SelectTrigger className="h-8" data-testid={`select-orientation-${element.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="horizontal">Horizontal</SelectItem>
                    <SelectItem value="vertical">Vertical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {element.type === "footer_logo" && (
              <div className="space-y-2">
                <ImageUploadField
                  value={element.content.imageUrl || ""}
                  onChange={(url) => updateFn(element.id, { content: { ...element.content, imageUrl: url } })}
                  label="Footer Logo Image"
                  placeholder="Upload or select a logo"
                  testId={`input-footer-logo-${element.id}`}
                />
                <div className="space-y-1">
                  <Label className="text-xs">Logo Height (px)</Label>
                  <Input
                    type="number"
                    min={16}
                    max={200}
                    value={element.content.logoHeight || 28}
                    onChange={(e) => updateFn(element.id, { content: { ...element.content, logoHeight: parseInt(e.target.value) || 28 } })}
                    data-testid={`input-footer-logo-height-${element.id}`}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDesktopSection = (
    sectionKey: "top" | "middle" | "bottom",
    sectionLabel: string,
    componentType: "header" | "footer"
  ) => {
    const config = componentType === "header" ? headerConfig : footerConfig;
    const section = config.desktop.sections[sectionKey];
    const maxColumns = componentType === "header" ? 3 : 4;
    const elements = section.elements.sort((a, b) => a.order - b.order);

    const columnElements: (HeaderElement | FooterElement)[][] = Array.from(
      { length: maxColumns },
      (_, colIdx) => elements.filter(e => e.column === colIdx)
    );

    return (
      <div key={sectionKey} className="space-y-2" data-testid={`section-${componentType}-${sectionKey}`}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium capitalize">{sectionLabel}</h4>
          <Badge variant="secondary" className="text-[10px]">
            {elements.length} element{elements.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div
          className={`grid gap-3 ${maxColumns === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-4"}`}
        >
          {columnElements.map((colElems, colIdx) => (
            <div
              key={colIdx}
              className="space-y-2 p-2 border border-dashed rounded-md min-h-[60px]"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragItem.current) {
                  if (componentType === "header") {
                    moveHeaderElement(dragItem.current.id, sectionKey, colIdx);
                  } else {
                    moveFooterElement(dragItem.current.id, sectionKey, colIdx);
                  }
                  dragItem.current = null;
                  dragOverItem.current = null;
                }
              }}
              data-testid={`dropzone-${componentType}-${sectionKey}-col${colIdx}`}
            >
              <p className="text-[10px] text-muted-foreground font-medium text-center">Col {colIdx + 1}</p>
              {colElems.map((el, idx) =>
                renderElementCard(el, componentType, idx, sectionKey, colElems.length)
              )}
              {colElems.length === 0 && (
                <p className="text-[10px] text-muted-foreground text-center py-3">Drop here</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMobileView = (componentType: "header" | "footer") => {
    const config = componentType === "header" ? headerConfig : footerConfig;
    const elements = config.mobile.elements.sort((a, b) => a.order - b.order);
    const maxColumns = componentType === "header" ? 2 : 2;

    const col1 = elements.filter((_, i) => i % 2 === 0);
    const col2 = elements.filter((_, i) => i % 2 === 1);

    return (
      <div className="space-y-2" data-testid={`mobile-view-${componentType}`}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Mobile Layout</h4>
          <Badge variant="secondary" className="text-[10px]">
            {elements.filter(e => e.visibleMobile).length} visible
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Drag elements to reorder. Elements stack into {maxColumns} columns on mobile devices.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2 p-2 border border-dashed rounded-md min-h-[60px]">
            <p className="text-[10px] text-muted-foreground font-medium text-center">Col 1</p>
            {col1.map((el, idx) =>
              renderElementCard(el, componentType, idx * 2, "mobile", col1.length)
            )}
          </div>
          <div className="space-y-2 p-2 border border-dashed rounded-md min-h-[60px]">
            <p className="text-[10px] text-muted-foreground font-medium text-center">Col 2</p>
            {col2.map((el, idx) =>
              renderElementCard(el, componentType, idx * 2 + 1, "mobile", col2.length)
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Components</h2>
          <p className="text-sm text-muted-foreground">Configure global header and footer components with drag-and-drop element ordering</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleResetComponents}
            data-testid="button-reset-components"
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset to Defaults
          </Button>
          <Button
            onClick={onSave}
            disabled={isSaving}
            data-testid="button-save-components"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Components
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 border rounded-md">
          <Button
            size="sm"
            variant={deviceView === "desktop" ? "default" : "ghost"}
            onClick={() => setDeviceView("desktop")}
            data-testid="button-device-desktop"
          >
            <Monitor className="h-4 w-4 mr-1" />
            Desktop
          </Button>
          <Button
            size="sm"
            variant={deviceView === "mobile" ? "default" : "ghost"}
            onClick={() => setDeviceView("mobile")}
            data-testid="button-device-mobile"
          >
            <Smartphone className="h-4 w-4 mr-1" />
            Mobile
          </Button>
        </div>

        <div className="flex items-center gap-1 p-1 border rounded-md">
          <Button
            size="sm"
            variant={activeGlobal === "header" ? "default" : "ghost"}
            onClick={() => setActiveGlobal("header")}
            data-testid="button-global-header"
          >
            Header
          </Button>
          <Button
            size="sm"
            variant={activeGlobal === "footer" ? "default" : "ghost"}
            onClick={() => setActiveGlobal("footer")}
            data-testid="button-global-footer"
          >
            Footer
          </Button>
          <Button
            size="sm"
            variant={activeGlobal === "innerpage" ? "default" : "ghost"}
            onClick={() => setActiveGlobal("innerpage")}
            data-testid="button-global-innerpage"
          >
            Inner Page
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Preset Templates
            </CardTitle>
            <CardDescription>Apply a pre-built layout to get started fast. Fully editable after insertion.</CardDescription>
          </div>
          <Button
            variant={showPresets ? "default" : "outline"}
            size="sm"
            onClick={() => setShowPresets(!showPresets)}
            data-testid="button-toggle-presets"
          >
            {showPresets ? "Hide Presets" : "Show Presets"}
          </Button>
        </CardHeader>
        {showPresets && (
          <CardContent className="space-y-6 pt-0">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Navigation className="h-4 w-4" />
                Header Presets
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {HEADER_PRESETS.map((preset) => {
                  const isActive = activeHeaderPreset === preset.id;
                  const PresetIcon = preset.id === "simple-business" ? Briefcase
                    : preset.id === "marketing" ? TrendingUp
                    : LayoutDashboard;
                  return (
                    <div
                      key={preset.id}
                      className={`border rounded-md p-4 space-y-2 transition-colors ${isActive ? "border-primary bg-primary/5" : ""}`}
                      data-testid={`preset-header-${preset.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <PresetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <h5 className="text-sm font-medium leading-tight">{preset.name}</h5>
                        </div>
                        {isActive && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{preset.description}</p>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-muted-foreground italic">{preset.bestFor}</span>
                        <Button
                          size="sm"
                          variant={isActive ? "secondary" : "outline"}
                          onClick={() => applyHeaderPreset(preset)}
                          data-testid={`button-apply-header-${preset.id}`}
                        >
                          {isActive ? "Applied" : "Apply"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Minus className="h-4 w-4" />
                Footer Presets
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {FOOTER_PRESETS.map((preset) => {
                  const isActive = activeFooterPreset === preset.id;
                  const PresetIcon = preset.id === "simple" ? Minus
                    : preset.id === "standard" ? Award
                    : Shield;
                  return (
                    <div
                      key={preset.id}
                      className={`border rounded-md p-4 space-y-2 transition-colors ${isActive ? "border-primary bg-primary/5" : ""}`}
                      data-testid={`preset-footer-${preset.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <PresetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <h5 className="text-sm font-medium leading-tight">{preset.name}</h5>
                        </div>
                        {isActive && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{preset.description}</p>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-muted-foreground italic">{preset.bestFor}</span>
                        <Button
                          size="sm"
                          variant={isActive ? "secondary" : "outline"}
                          onClick={() => applyFooterPreset(preset)}
                          data-testid={`button-apply-footer-${preset.id}`}
                        >
                          {isActive ? "Applied" : "Apply"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {activeGlobal === "header" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Header Component</CardTitle>
            <CardDescription>
              {deviceView === "desktop"
                ? "Configure up to 3 sections (Top, Middle, Bottom) with 3 columns each. Drag elements between sections and columns."
                : "Configure mobile layout with 2-column responsive stacking. Drag to reorder elements."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Settings className="h-4 w-4" />
                    Layout Settings
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label data-testid="label-header-type">Header Type</Label>
                    <Select
                      value={headerLayoutSettings.headerType}
                      onValueChange={(val) => onHeaderLayoutChange({ headerType: val })}
                    >
                      <SelectTrigger data-testid="select-header-type">
                        <SelectValue placeholder="Select header type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="static">Static</SelectItem>
                        <SelectItem value="sticky">Sticky</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {headerLayoutSettings.headerType === "static" && "Header scrolls with the page content"}
                      {headerLayoutSettings.headerType === "sticky" && "Header stays at the top when scrolling down"}
                      {headerLayoutSettings.headerType === "fixed" && "Header is always fixed at the top of the viewport"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label data-testid="label-header-height">Header Height (px)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={headerLayoutSettings.headerHeight}
                        onChange={(e) => onHeaderLayoutChange({ headerHeight: parseInt(e.target.value) || 80 })}
                        min={40}
                        max={200}
                        data-testid="input-header-height"
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">px</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Height of the header bar (40 - 200px)</p>
                  </div>

                  <div className="space-y-2">
                    <Label data-testid="label-logo-position">Logo Position</Label>
                    <Select
                      value={headerLayoutSettings.logoPosition}
                      onValueChange={(val) => onHeaderLayoutChange({ logoPosition: val })}
                    >
                      <SelectTrigger data-testid="select-logo-position">
                        <SelectValue placeholder="Select logo position" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label data-testid="label-navigation-layout">Navigation Layout</Label>
                    <Select
                      value={headerLayoutSettings.navigationLayout}
                      onValueChange={(val) => onHeaderLayoutChange({ navigationLayout: val })}
                    >
                      <SelectTrigger data-testid="select-navigation-layout">
                        <SelectValue placeholder="Select navigation layout" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="horizontal">Horizontal</SelectItem>
                        <SelectItem value="hamburger">Hamburger Menu</SelectItem>
                        <SelectItem value="split">Split (Logo center, nav sides)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {headerLayoutSettings.navigationLayout === "horizontal" && "Navigation links displayed in a horizontal row"}
                      {headerLayoutSettings.navigationLayout === "hamburger" && "Navigation hidden behind a hamburger menu icon"}
                      {headerLayoutSettings.navigationLayout === "split" && "Logo centered with navigation links on both sides"}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label data-testid="label-mobile-nav-style" className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    Mobile Navigation Style
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Choose how the mobile menu appears when visitors tap the burger menu icon
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => onHeaderLayoutChange({ mobileNavStyle: "dropdown" })}
                      className={`relative flex flex-col items-center gap-2 rounded-md border-2 p-4 transition-colors ${headerLayoutSettings.mobileNavStyle === "dropdown" ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
                      data-testid="button-mobile-nav-dropdown"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-12 h-8 rounded border border-border flex flex-col items-center justify-center">
                          <Menu className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="w-12 flex flex-col gap-0.5">
                          <div className="w-full h-1 rounded bg-muted-foreground/30" />
                          <div className="w-full h-1 rounded bg-muted-foreground/30" />
                          <div className="w-full h-1 rounded bg-muted-foreground/30" />
                        </div>
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <span className="text-xs font-medium">Dropdown</span>
                      <p className="text-[10px] text-muted-foreground text-center leading-tight">Menu drops down below the header</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => onHeaderLayoutChange({ mobileNavStyle: "slide-left" })}
                      className={`relative flex flex-col items-center gap-2 rounded-md border-2 p-4 transition-colors ${headerLayoutSettings.mobileNavStyle === "slide-left" ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
                      data-testid="button-mobile-nav-slide-left"
                    >
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-10 rounded border-2 border-primary/50 bg-primary/10" />
                        <PanelLeft className="h-4 w-4 text-muted-foreground" />
                        <div className="w-8 h-10 rounded border border-border opacity-50" />
                      </div>
                      <span className="text-xs font-medium">Left Panel</span>
                      <p className="text-[10px] text-muted-foreground text-center leading-tight">Slides in from the left side</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => onHeaderLayoutChange({ mobileNavStyle: "slide-right" })}
                      className={`relative flex flex-col items-center gap-2 rounded-md border-2 p-4 transition-colors ${headerLayoutSettings.mobileNavStyle === "slide-right" ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
                      data-testid="button-mobile-nav-slide-right"
                    >
                      <div className="flex items-center gap-1">
                        <div className="w-8 h-10 rounded border border-border opacity-50" />
                        <PanelRight className="h-4 w-4 text-muted-foreground" />
                        <div className="w-5 h-10 rounded border-2 border-primary/50 bg-primary/10" />
                      </div>
                      <span className="text-xs font-medium">Right Panel</span>
                      <p className="text-[10px] text-muted-foreground text-center leading-tight">Slides in from the right side</p>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="show-on-scroll-comp" data-testid="label-show-on-scroll">Show on Scroll</Label>
                    <p className="text-xs text-muted-foreground">Reveal the header when user scrolls up</p>
                  </div>
                  <Switch
                    id="show-on-scroll-comp"
                    checked={headerLayoutSettings.showOnScroll}
                    onCheckedChange={(checked) => onHeaderLayoutChange({ showOnScroll: checked })}
                    data-testid="switch-show-on-scroll"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {deviceView === "desktop" ? (
              <>
                {renderDesktopSection("top", "Top Header", "header")}
                {renderDesktopSection("middle", "Middle Header", "header")}
                {renderDesktopSection("bottom", "Bottom Header", "header")}
              </>
            ) : (
              renderMobileView("header")
            )}
          </CardContent>
        </Card>
      )}

      {activeGlobal === "footer" && (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Footer Component</CardTitle>
            <CardDescription>
              {deviceView === "desktop"
                ? "Configure up to 3 sections (Top, Middle, Bottom) with 4 columns each. Drag elements between sections and columns."
                : "Configure mobile layout with 2-column responsive stacking. Drag to reorder elements."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Settings className="h-4 w-4" />
                    Layout Settings
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="footer-visibility-comp" data-testid="label-footer-visibility">Footer Visibility</Label>
                    <p className="text-xs text-muted-foreground">Show or hide the footer across your website</p>
                  </div>
                  <Switch
                    id="footer-visibility-comp"
                    checked={footerLayoutSettings.footerVisibility}
                    onCheckedChange={(checked) => onFooterLayoutChange({ footerVisibility: checked })}
                    data-testid="switch-footer-visibility"
                  />
                </div>

                {footerLayoutSettings.footerVisibility && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label data-testid="label-footer-columns">Footer Columns</Label>
                      <Select
                        value={String(footerLayoutSettings.footerColumns)}
                        onValueChange={(val) => onFooterLayoutChange({ footerColumns: parseInt(val) })}
                      >
                        <SelectTrigger data-testid="select-footer-columns">
                          <SelectValue placeholder="Select columns" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 Column</SelectItem>
                          <SelectItem value="2">2 Columns</SelectItem>
                          <SelectItem value="3">3 Columns</SelectItem>
                          <SelectItem value="4">4 Columns</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Number of content columns in the footer</p>
                    </div>

                    <div className="space-y-2">
                      <Label data-testid="label-footer-width">Footer Width</Label>
                      <Select
                        value={footerLayoutSettings.footerWidth}
                        onValueChange={(val) => onFooterLayoutChange({ footerWidth: val })}
                      >
                        <SelectTrigger data-testid="select-footer-width">
                          <SelectValue placeholder="Select width" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="boxed">Boxed</SelectItem>
                          <SelectItem value="full-width">Full Width</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {footerLayoutSettings.footerWidth === "boxed" ? "Footer content stays within the max width" : "Footer spans the full browser width"}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label data-testid="label-footer-padding">Footer Padding (px)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={footerLayoutSettings.footerPadding}
                          onChange={(e) => onFooterLayoutChange({ footerPadding: parseInt(e.target.value) || 40 })}
                          min={0}
                          max={120}
                          data-testid="input-footer-padding"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">px</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Internal spacing within the footer area</p>
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {deviceView === "desktop" ? (
              <>
                {renderDesktopSection("top", "Top Footer", "footer")}
                {renderDesktopSection("middle", "Middle Footer", "footer")}
                {renderDesktopSection("bottom", "Bottom Footer", "footer")}
              </>
            ) : (
              renderMobileView("footer")
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowUp className="h-4 w-4" />
                Back to Top Button
              </CardTitle>
              <CardDescription>Fixed button that scrolls visitors back to the top of the page</CardDescription>
            </div>
            <Switch
              checked={footerConfig.backToTop?.enabled ?? DEFAULT_BACK_TO_TOP.enabled}
              onCheckedChange={(checked) => {
                const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                newConfig.backToTop.enabled = checked;
                onFooterConfigChange(newConfig);
              }}
              data-testid="switch-back-to-top"
            />
          </CardHeader>
          {(footerConfig.backToTop?.enabled ?? DEFAULT_BACK_TO_TOP.enabled) && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Button Content</Label>
                <div className="flex items-center gap-1 p-1 border rounded-md w-fit">
                  <Button
                    size="sm"
                    variant={(footerConfig.backToTop?.type ?? "icon") === "icon" ? "default" : "ghost"}
                    onClick={() => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.type = "icon";
                      onFooterConfigChange(newConfig);
                    }}
                    data-testid="button-btt-type-icon"
                  >
                    Icon
                  </Button>
                  <Button
                    size="sm"
                    variant={(footerConfig.backToTop?.type ?? "icon") === "image" ? "default" : "ghost"}
                    onClick={() => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.type = "image";
                      onFooterConfigChange(newConfig);
                    }}
                    data-testid="button-btt-type-image"
                  >
                    Image
                  </Button>
                </div>
              </div>

              {(footerConfig.backToTop?.type ?? "icon") === "image" && (
                <div className="space-y-2">
                  <Label>Image URL</Label>
                  <Input
                    value={footerConfig.backToTop?.imageUrl ?? ""}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.imageUrl = e.target.value;
                      onFooterConfigChange(newConfig);
                    }}
                    placeholder="https://example.com/icon.png"
                    data-testid="input-btt-image-url"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Size (px)</Label>
                  <Input
                    type="number"
                    value={footerConfig.backToTop?.size ?? DEFAULT_BACK_TO_TOP.size}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.size = parseInt(e.target.value) || 40;
                      onFooterConfigChange(newConfig);
                    }}
                    min={20}
                    max={80}
                    data-testid="input-btt-size"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Padding (px)</Label>
                  <Input
                    type="number"
                    value={footerConfig.backToTop?.padding ?? DEFAULT_BACK_TO_TOP.padding}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.padding = parseInt(e.target.value) || 8;
                      onFooterConfigChange(newConfig);
                    }}
                    min={0}
                    max={40}
                    data-testid="input-btt-padding"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Background Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={footerConfig.backToTop?.backgroundColor ?? "#1a1a1a"}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.backgroundColor = e.target.value;
                      onFooterConfigChange(newConfig);
                    }}
                    className="w-9 h-9 rounded-md border cursor-pointer"
                    data-testid="input-btt-bg-color"
                  />
                  <Input
                    value={footerConfig.backToTop?.backgroundColor ?? DEFAULT_BACK_TO_TOP.backgroundColor}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.backgroundColor = e.target.value;
                      onFooterConfigChange(newConfig);
                    }}
                    placeholder="rgba(255,255,255,0.1)"
                    data-testid="input-btt-bg-color-text"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Border Width</Label>
                  <Input
                    type="number"
                    value={footerConfig.backToTop?.borderWidth ?? DEFAULT_BACK_TO_TOP.borderWidth}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.borderWidth = parseInt(e.target.value) || 0;
                      onFooterConfigChange(newConfig);
                    }}
                    min={0}
                    max={10}
                    data-testid="input-btt-border-width"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Border Radius</Label>
                  <Input
                    type="number"
                    value={footerConfig.backToTop?.borderRadius ?? DEFAULT_BACK_TO_TOP.borderRadius}
                    onChange={(e) => {
                      const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                      if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                      newConfig.backToTop.borderRadius = parseInt(e.target.value) || 0;
                      onFooterConfigChange(newConfig);
                    }}
                    min={0}
                    max={50}
                    data-testid="input-btt-border-radius"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Border Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={footerConfig.backToTop?.borderColor ?? "#333333"}
                      onChange={(e) => {
                        const newConfig = JSON.parse(JSON.stringify(footerConfig)) as FooterComponentsConfig;
                        if (!newConfig.backToTop) newConfig.backToTop = { ...DEFAULT_BACK_TO_TOP };
                        newConfig.backToTop.borderColor = e.target.value;
                        onFooterConfigChange(newConfig);
                      }}
                      className="w-9 h-9 rounded-md border cursor-pointer"
                      data-testid="input-btt-border-color"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
        </>
      )}

      {activeGlobal === "innerpage" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Inner Page Settings
            </CardTitle>
            <CardDescription>Define default layout behavior for inner pages</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label data-testid="label-page-layout">Page Layout</Label>
                <Select
                  value={innerPageSettings.pageLayout}
                  onValueChange={(val) => onInnerPageChange({ pageLayout: val })}
                >
                  <SelectTrigger data-testid="select-page-layout">
                    <SelectValue placeholder="Select page layout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full-width">Full Width</SelectItem>
                    <SelectItem value="boxed">Boxed</SelectItem>
                    <SelectItem value="sidebar-left">Sidebar Left</SelectItem>
                    <SelectItem value="sidebar-right">Sidebar Right</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {innerPageSettings.pageLayout === "full-width" && "Content spans the full page width"}
                  {innerPageSettings.pageLayout === "boxed" && "Content is centered in a contained box"}
                  {innerPageSettings.pageLayout === "sidebar-left" && "Main content with a sidebar on the left"}
                  {innerPageSettings.pageLayout === "sidebar-right" && "Main content with a sidebar on the right"}
                </p>
              </div>

              {(innerPageSettings.pageLayout === "sidebar-left" || innerPageSettings.pageLayout === "sidebar-right") && (
                <div className="space-y-2">
                  <Label data-testid="label-sidebar-width">Sidebar Width (px)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={innerPageSettings.sidebarWidth}
                      onChange={(e) => onInnerPageChange({ sidebarWidth: parseInt(e.target.value) || 300 })}
                      min={200}
                      max={500}
                      data-testid="input-sidebar-width"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">px</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Width of the sidebar (200 - 500px)</p>
                </div>
              )}

              <div className="space-y-2">
                <Label data-testid="label-page-padding">Page Padding (px)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={innerPageSettings.pagePadding}
                    onChange={(e) => onInnerPageChange({ pagePadding: parseInt(e.target.value) || 32 })}
                    min={0}
                    max={120}
                    data-testid="input-page-padding"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">px</span>
                </div>
                <p className="text-xs text-muted-foreground">Internal padding around the page content area</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="show-breadcrumb-comp" data-testid="label-breadcrumb">Breadcrumb Navigation</Label>
                <p className="text-xs text-muted-foreground">Show breadcrumb trail on inner pages for easier navigation</p>
              </div>
              <Switch
                id="show-breadcrumb-comp"
                checked={innerPageSettings.showBreadcrumb}
                onCheckedChange={(checked) => onInnerPageChange({ showBreadcrumb: checked })}
                data-testid="switch-breadcrumb"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
