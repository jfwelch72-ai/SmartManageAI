import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type: "footer_logo" | "social_icons" | "copyright" | "back_to_top" | "link_list" | "footer_title";
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
  { id: "f-backtotop", type: "back_to_top", label: "Back to Top Button", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: {}, order: 1, section: "bottom", column: 1 },
  { id: "f-links", type: "link_list", label: "Link List", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { orientation: "vertical" }, order: 0, section: "middle", column: 0 },
  { id: "f-title", type: "footer_title", label: "Footer Title", enabled: true, alignment: "left", visibleDesktop: true, visibleMobile: true, content: { text: "Quick Links" }, order: 0, section: "top", column: 1 },
];

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
      { id: "f-backtotop", type: "back_to_top", label: "Back to Top Button", enabled: false, alignment: "right", visibleDesktop: false, visibleMobile: false, content: {}, order: 1, section: "bottom", column: 3 },
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
      { id: "f-backtotop", type: "back_to_top", label: "Back to Top Button", enabled: false, alignment: "right", visibleDesktop: false, visibleMobile: false, content: {}, order: 1, section: "bottom", column: 3 },
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
      { id: "f-backtotop", type: "back_to_top", label: "Back to Top Button", enabled: true, alignment: "right", visibleDesktop: true, visibleMobile: true, content: {}, order: 1, section: "bottom", column: 3 },
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
  back_to_top: ArrowUp,
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
}

export default function WebsiteComponentsTab({
  headerConfig,
  footerConfig,
  onHeaderConfigChange,
  onFooterConfigChange,
  onSave,
  isSaving,
}: WebsiteComponentsTabProps) {
  const [deviceView, setDeviceView] = useState<"desktop" | "mobile">("desktop");
  const [expandedElement, setExpandedElement] = useState<string | null>(null);
  const [activeGlobal, setActiveGlobal] = useState<"header" | "footer">("header");
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
      )}
    </div>
  );
}
