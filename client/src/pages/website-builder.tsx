import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import WebsitePreviewRenderer from "@/components/website-preview-renderer";
import WebsiteComponentsTab, {
  type HeaderComponentsConfig,
  type FooterComponentsConfig,
  getDefaultHeaderConfig,
  getDefaultFooterConfig,
} from "@/components/website-components-tab";
import WebsiteBodyComponents, {
  type BodyComponentsConfig,
  getDefaultBodyConfig,
} from "@/components/website-body-components";
import PageEditor from "@/components/page-editor";
import WebsiteSetupTab from "@/components/website-builder/WebsiteSetupTab";
import WebsitePagesTab from "@/components/website-builder/WebsitePagesTab";
import WebsiteBlogTab from "@/components/website-builder/WebsiteBlogTab";
import WebsiteGalleryTab from "@/components/website-builder/WebsiteGalleryTab";
import WebsitePublishingTab from "@/components/website-builder/WebsitePublishingTab";
import type { Website, SocialLinks, ContactSubmission, AnalyticsSummary, WebsiteFormState, AIResponse, DeploymentRecord } from "@/components/website-builder/types";
import { WEBSITE_TEMPLATES } from "@/components/website-builder/types";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Globe,
  FileText,
  Layout,
  Settings,
  Eye,
  ExternalLink,
  Edit,
  Image,
  Share2,
  BarChart3,
  Mail,
  Sparkles,
  Send,
  Check,
  Clock,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  BookOpen,
  FolderOpen,
  Users,
  TrendingUp,
  MousePointer,
  Wand2,
  Save,
  Monitor,
  Tablet,
  Upload,
  Loader2,
  Smartphone,
  LayoutTemplate,
  Phone
} from "lucide-react";
import { format } from "date-fns";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { MediaLibraryTab } from "@/components/media-library";


export default function WebsiteBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("setup");
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiConversation, setAiConversation] = useState<Array<{role: string; content: string}>>([]);
  const isAdmin = !!user && ["ADMIN", "SUPER_ADMIN"].includes(user.role);
  const canEdit = !!user && ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(user.role);

  const [analyticsPeriod, setAnalyticsPeriod] = useState(30);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [websiteForm, setWebsiteForm] = useState({
    siteTitle: "",
    siteTagline: "",
    primaryColor: "#3B82F6",
    secondaryColor: "#1E40AF",
    accentColor: "#F59E0B",
    fontFamily: "",
    templateId: "",
    metaTitle: "",
    metaDescription: "",
    contactEmail: "",
    contactPhone: "",
    showBlog: true,
    showProjects: true,
    showTestimonials: true,
    contentWidth: "full-width",
    maxWidth: 1200,
    sectionPadding: 24,
    breakpointDesktop: 1280,
    breakpointTablet: 768,
    breakpointMobile: 480,
    headerType: "static",
    headerHeight: 80,
    logoPosition: "left",
    navigationLayout: "horizontal",
    mobileNavStyle: "dropdown",
    logoUrl: "",
    faviconUrl: "",
    logoHeight: 55,
    showOnScroll: true,
    pageLayout: "boxed",
    sidebarWidth: 300,
    pagePadding: 32,
    showBreadcrumb: true,
    footerVisibility: true,
    footerColumns: 3,
    footerWidth: "boxed",
    footerPadding: 40,
    footerSectionSettings: null,
    headerSectionSettings: null as Record<string, any> | null,
  });

  const [headerComponentsConfig, setHeaderComponentsConfig] = useState<HeaderComponentsConfig>(getDefaultHeaderConfig());
  const [footerComponentsConfig, setFooterComponentsConfig] = useState<FooterComponentsConfig>(getDefaultFooterConfig());
  const [bodyComponentsConfig, setBodyComponentsConfig] = useState<BodyComponentsConfig>(getDefaultBodyConfig());
  const [globalComponentsConfig, setGlobalComponentsConfig] = useState<BodyComponentsConfig>({ components: [] });
  const [editingPageId, setEditingPageId] = useState<string | null>(null);

  const [socialForm, setSocialForm] = useState<SocialLinks>({
    facebookUrl: null,
    instagramUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    youtubeUrl: null,
    tiktokUrl: null
  });

  const { data: websiteData, isLoading: loadingWebsite } = useQuery<{ hasWebsite: boolean; website: Website | null }>({
    queryKey: ["/api/website"],
    enabled: !!user && isAdmin
  });

  const { data: socialLinks } = useQuery<SocialLinks>({
    queryKey: ["/api/website/social"],
    enabled: !!user && isAdmin && !!websiteData?.hasWebsite,
    refetchOnMount: true
  });

  const { data: analyticsData } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/website/analytics/summary", analyticsPeriod],
    queryFn: () => fetch(`/api/website/analytics/summary?days=${analyticsPeriod}`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!user && canEdit && !!websiteData?.hasWebsite
  });

  const { data: contactSubmissions = [] } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/website/contact/submissions"],
    enabled: !!user && canEdit && !!websiteData?.hasWebsite
  });

  const { data: previewData, isLoading: loadingPreview, refetch: refetchPreview } = useQuery<any>({
    queryKey: ["/api/website/preview"],
    enabled: !!user && isAdmin && !!websiteData?.hasWebsite && activeTab === "preview",
    refetchOnMount: true,
    staleTime: 0,
  });

  const saveWebsiteMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      return await apiRequest("POST", "/api/website", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      toast({ title: "Website settings saved successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error saving website", description: error.message, variant: "destructive" });
    }
  });

  const publishWebsiteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/website/publish", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      toast({ 
        title: "Website published!", 
        description: `Your site is now live at ${data.siteUrl}`
      });
    },
    onError: (error: any) => {
      toast({ title: "Error publishing website", description: error.message, variant: "destructive" });
    }
  });

  // Edit handlers
  const aiAssistantMutation = useMutation({
    mutationFn: async (message: string): Promise<AIResponse> => {
      const response = await apiRequest("POST", "/api/website/assistant/ask", { message });
      return response.json();
    },
    onSuccess: (data: AIResponse) => {
      setAiConversation(prev => [...prev, { role: "assistant", content: data.response }]);
    },
    onError: (error: any) => {
      toast({ title: "AI Assistant error", description: error.message, variant: "destructive" });
    }
  });

  const handleAISubmit = () => {
    if (!aiPrompt.trim()) return;
    setAiConversation(prev => [...prev, { role: "user", content: aiPrompt }]);
    aiAssistantMutation.mutate(aiPrompt);
    setAiPrompt("");
  };

  const handleSaveWebsite = () => {
    saveWebsiteMutation.mutate({
      ...websiteForm,
      headerComponentsConfig,
      footerComponentsConfig,
      bodyComponentsConfig,
      globalComponentsConfig,
    });
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = WEBSITE_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    setSelectedTemplateId(templateId);
    setWebsiteForm(prev => ({
      ...prev,
      primaryColor: template.primaryColor,
      secondaryColor: template.secondaryColor,
      accentColor: template.accentColor,
      fontFamily: template.fontFamily,
      templateId: template.id,
    }));
    toast({ title: `"${template.name}" template applied`, description: "Colors and font updated. Click Save to keep changes." });
  };

  const handlePublish = () => {
    publishWebsiteMutation.mutate();
  };

  const websiteRef = websiteData?.website;
  useEffect(() => {
    if (websiteRef) {
      if (websiteRef.templateId && !selectedTemplateId) {
        setSelectedTemplateId(websiteRef.templateId);
      }
      setWebsiteForm(prev => ({
        ...prev,
        siteTitle: websiteRef.siteTitle || prev.siteTitle,
        siteTagline: websiteRef.siteTagline || prev.siteTagline,
        primaryColor: websiteRef.primaryColor || prev.primaryColor,
        secondaryColor: websiteRef.secondaryColor || prev.secondaryColor,
        accentColor: websiteRef.accentColor || prev.accentColor,
        fontFamily: websiteRef.fontFamily || prev.fontFamily,
        templateId: websiteRef.templateId || prev.templateId,
        metaTitle: websiteRef.metaTitle || prev.metaTitle,
        metaDescription: websiteRef.metaDescription || prev.metaDescription,
        contactEmail: websiteRef.contactEmail || prev.contactEmail,
        contactPhone: websiteRef.contactPhone || prev.contactPhone,
        contentWidth: websiteRef.contentWidth || prev.contentWidth,
        maxWidth: websiteRef.maxWidth ?? prev.maxWidth,
        sectionPadding: websiteRef.sectionPadding ?? prev.sectionPadding,
        breakpointDesktop: websiteRef.breakpointDesktop ?? prev.breakpointDesktop,
        breakpointTablet: websiteRef.breakpointTablet ?? prev.breakpointTablet,
        breakpointMobile: websiteRef.breakpointMobile ?? prev.breakpointMobile,
        headerType: websiteRef.headerType || prev.headerType,
        headerHeight: websiteRef.headerHeight ?? prev.headerHeight,
        logoPosition: websiteRef.logoPosition || prev.logoPosition,
        navigationLayout: websiteRef.navigationLayout || prev.navigationLayout,
        mobileNavStyle: websiteRef.mobileNavStyle || prev.mobileNavStyle,
        logoUrl: websiteRef.logoUrl || prev.logoUrl,
        faviconUrl: websiteRef.faviconUrl || prev.faviconUrl,
        logoHeight: websiteRef.logoHeight ?? prev.logoHeight,
        showOnScroll: websiteRef.showOnScroll ?? prev.showOnScroll,
        pageLayout: websiteRef.pageLayout || prev.pageLayout,
        sidebarWidth: websiteRef.sidebarWidth ?? prev.sidebarWidth,
        pagePadding: websiteRef.pagePadding ?? prev.pagePadding,
        showBreadcrumb: websiteRef.showBreadcrumb ?? prev.showBreadcrumb,
        footerVisibility: websiteRef.footerVisibility ?? prev.footerVisibility,
        footerColumns: websiteRef.footerColumns ?? prev.footerColumns,
        footerWidth: websiteRef.footerWidth || prev.footerWidth,
        footerPadding: websiteRef.footerPadding ?? prev.footerPadding,
        footerSectionSettings: (websiteRef as any).footerSectionSettings ?? prev.footerSectionSettings,
        headerSectionSettings: (websiteRef as any).headerSectionSettings ?? prev.headerSectionSettings,
      }));
      if (websiteRef.headerComponentsConfig) {
        setHeaderComponentsConfig(websiteRef.headerComponentsConfig as HeaderComponentsConfig);
      }
      if (websiteRef.footerComponentsConfig) {
        setFooterComponentsConfig(websiteRef.footerComponentsConfig as FooterComponentsConfig);
      }
      if (websiteRef.bodyComponentsConfig) {
        setBodyComponentsConfig(websiteRef.bodyComponentsConfig as BodyComponentsConfig);
      }
      if (websiteRef.globalComponentsConfig) {
        setGlobalComponentsConfig(websiteRef.globalComponentsConfig as BodyComponentsConfig);
      }
    }
  }, [websiteRef]);

  if (!isAdmin && !canEdit) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You don't have permission to access the Website Builder. Please contact your administrator.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loadingWebsite) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const website = websiteData?.website;
  const hasWebsite = websiteData?.hasWebsite;

  if (editingPageId) {
    return (
      <div className="h-[calc(100vh-64px)]" data-testid="page-editor-container">
        <PageEditor
          pageId={editingPageId}
          onBack={() => {
            setEditingPageId(null);
            setActiveTab("pages");
          }}
        />
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6" data-testid="page-website-builder">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Globe className="h-6 w-6 text-primary" />
            Website Builder
          </h1>
          <p className="text-muted-foreground">
            Create and manage your organization's professional website
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasWebsite && (
            <>
              <Badge variant={website?.status === "PUBLISHED" ? "default" : "secondary"} data-testid="badge-website-status">
                {website?.status || "DRAFT"}
              </Badge>
              {website?.subdomain && website?.status === "PUBLISHED" && (
                <Button variant="outline" size="sm" asChild data-testid="button-view-site">
                  <a href={`/site/${website.subdomain}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    View Site
                  </a>
                </Button>
              )}
              <Button 
                onClick={handlePublish}
                disabled={publishWebsiteMutation.isPending}
                data-testid="button-publish"
              >
                {publishWebsiteMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Publish
              </Button>
            </>
          )}
          <Button 
            variant="default"
            onClick={() => { setShowAIWizard(true); setWizardStep(0); setWizardResult(null); setWizardError(""); }}
            data-testid="button-ai-wizard"
          >
            <Wand2 className="h-4 w-4 mr-1" />
            AI Website Wizard
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setShowAIAssistant(true)}
            data-testid="button-ai-assistant"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            AI Assistant
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        {isMobile ? (
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="mb-2" data-testid="select-website-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="setup">Setup</SelectItem>
              <SelectItem value="layout">Layout</SelectItem>
              <SelectItem value="pages">Pages</SelectItem>
              <SelectItem value="blog">Blog</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="gallery">Gallery</SelectItem>
              <SelectItem value="social">Social</SelectItem>
              <SelectItem value="analytics">Analytics</SelectItem>
              <SelectItem value="leads">Leads</SelectItem>
              <SelectItem value="preview">Preview</SelectItem>
              <SelectItem value="publishing">Publishing</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <TabsList className="flex overflow-x-auto gap-1 w-full h-auto" data-testid="tabs-website-sections">
            <TabsTrigger value="setup" className="flex items-center gap-1" data-testid="tab-setup">
              <Settings className="h-4 w-4" />
              Setup
            </TabsTrigger>
            <TabsTrigger value="layout" className="flex items-center gap-1" data-testid="tab-layout">
              <LayoutTemplate className="h-4 w-4" />
              Layout
            </TabsTrigger>
            <TabsTrigger value="pages" className="flex items-center gap-1" data-testid="tab-pages">
              <Layout className="h-4 w-4" />
              Pages
            </TabsTrigger>
            <TabsTrigger value="blog" className="flex items-center gap-1" data-testid="tab-blog">
              <BookOpen className="h-4 w-4" />
              Blog
            </TabsTrigger>
            <TabsTrigger value="media" className="flex items-center gap-1" data-testid="tab-media">
              <Image className="h-4 w-4" />
              Media
            </TabsTrigger>
            <TabsTrigger value="gallery" className="flex items-center gap-1" data-testid="tab-gallery">
              <FolderOpen className="h-4 w-4" />
              Gallery
            </TabsTrigger>
            <TabsTrigger value="social" className="flex items-center gap-1" data-testid="tab-social">
              <Share2 className="h-4 w-4" />
              Social
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1" data-testid="tab-analytics">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="leads" className="flex items-center gap-1" data-testid="tab-leads">
              <Mail className="h-4 w-4" />
              Leads
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center gap-1" data-testid="tab-preview">
              <Eye className="h-4 w-4" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="publishing" className="flex items-center gap-1" data-testid="tab-publishing">
              <Upload className="h-4 w-4" />
              Publishing
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="setup" className="space-y-4">
          <WebsiteSetupTab
            website={website}
            websiteForm={websiteForm}
            setWebsiteForm={setWebsiteForm}
            selectedTemplateId={selectedTemplateId}
            onTemplateSelect={handleTemplateSelect}
            onSave={handleSaveWebsite}
            saveIsPending={saveWebsiteMutation.isPending}
            socialForm={socialForm}
            setSocialForm={setSocialForm}
            socialLinks={socialLinks}
          />
        </TabsContent>

        <TabsContent value="layout" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Site Layout</h2>
              <p className="text-sm text-muted-foreground">Configure site-wide layout rules, header behavior, and inner page defaults</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setWebsiteForm(prev => ({
                    ...prev,
                    contentWidth: "full-width",
                    maxWidth: 1200,
                    sectionPadding: 24,
                    breakpointDesktop: 1280,
                    breakpointTablet: 768,
                    breakpointMobile: 480,
                    headerType: "static",
                    headerHeight: 80,
                    logoPosition: "left",
                    navigationLayout: "horizontal",
                    mobileNavStyle: "dropdown",
                    showOnScroll: true,
                    pageLayout: "boxed",
                    sidebarWidth: 300,
                    pagePadding: 32,
                    showBreadcrumb: true,
                    footerVisibility: true,
                    footerColumns: 3,
                    footerWidth: "boxed",
                    footerPadding: 40,
                    headerSectionSettings: null,
                  }));
                }}
                data-testid="button-reset-layout"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset to Defaults
              </Button>
              <Button
                onClick={handleSaveWebsite}
                disabled={saveWebsiteMutation.isPending}
                data-testid="button-save-layout"
              >
                {saveWebsiteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save Layout
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Global Layout Setup
              </CardTitle>
              <CardDescription>Configure site-wide layout rules such as width, spacing, and breakpoints</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label data-testid="label-content-width">Content Width</Label>
                  <Select
                    value={websiteForm.contentWidth}
                    onValueChange={(val) => setWebsiteForm(prev => ({ ...prev, contentWidth: val }))}
                  >
                    <SelectTrigger data-testid="select-content-width">
                      <SelectValue placeholder="Select content width" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="boxed">Boxed</SelectItem>
                      <SelectItem value="full-width">Full Width</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {websiteForm.contentWidth === "boxed" ? "Content is centered within a maximum width container" : "Content spans the full browser width"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label data-testid="label-max-width">Max Width (px)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={websiteForm.maxWidth}
                      onChange={(e) => setWebsiteForm(prev => ({ ...prev, maxWidth: parseInt(e.target.value) || 1200 }))}
                      min={800}
                      max={2400}
                      data-testid="input-max-width"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">px</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Maximum container width (800 - 2400px)</p>
                </div>

                <div className="space-y-2">
                  <Label data-testid="label-section-padding">Section Padding (px)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={websiteForm.sectionPadding}
                      onChange={(e) => setWebsiteForm(prev => ({ ...prev, sectionPadding: parseInt(e.target.value) || 24 }))}
                      min={0}
                      max={120}
                      data-testid="input-section-padding"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">px</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Vertical spacing between page sections</p>
                </div>
              </div>

              <div className="space-y-3">
                <Label data-testid="label-breakpoints">Responsive Breakpoints</Label>
                <p className="text-xs text-muted-foreground">Define the screen widths where layout adapts for different devices</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 rounded-md border">
                    <Monitor className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Desktop</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={websiteForm.breakpointDesktop}
                          onChange={(e) => setWebsiteForm(prev => ({ ...prev, breakpointDesktop: parseInt(e.target.value) || 1280 }))}
                          min={1024}
                          max={2560}
                          className="h-8"
                          data-testid="input-breakpoint-desktop"
                        />
                        <span className="text-xs text-muted-foreground">px</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-md border">
                    <Tablet className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Tablet</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={websiteForm.breakpointTablet}
                          onChange={(e) => setWebsiteForm(prev => ({ ...prev, breakpointTablet: parseInt(e.target.value) || 768 }))}
                          min={600}
                          max={1200}
                          className="h-8"
                          data-testid="input-breakpoint-tablet"
                        />
                        <span className="text-xs text-muted-foreground">px</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-md border">
                    <Smartphone className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Mobile</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={websiteForm.breakpointMobile}
                          onChange={(e) => setWebsiteForm(prev => ({ ...prev, breakpointMobile: parseInt(e.target.value) || 480 }))}
                          min={320}
                          max={768}
                          className="h-8"
                          data-testid="input-breakpoint-mobile"
                        />
                        <span className="text-xs text-muted-foreground">px</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <WebsiteComponentsTab
            headerConfig={headerComponentsConfig}
            footerConfig={footerComponentsConfig}
            onHeaderConfigChange={setHeaderComponentsConfig}
            onFooterConfigChange={setFooterComponentsConfig}
            onSave={handleSaveWebsite}
            isSaving={saveWebsiteMutation.isPending}
            brandingColors={{ primaryColor: websiteForm.primaryColor || "#3B82F6", secondaryColor: websiteForm.secondaryColor || "#1E40AF", accentColor: websiteForm.accentColor || "#F59E0B" }}
            headerLayoutSettings={{
              headerType: websiteForm.headerType,
              headerHeight: websiteForm.headerHeight,
              logoPosition: websiteForm.logoPosition,
              navigationLayout: websiteForm.navigationLayout,
              mobileNavStyle: websiteForm.mobileNavStyle,
              showOnScroll: websiteForm.showOnScroll,
              sectionSettings: websiteForm.headerSectionSettings as any,
            }}
            onHeaderLayoutChange={(updates) => {
              if (updates.sectionSettings) {
                setWebsiteForm(prev => ({ ...prev, headerSectionSettings: updates.sectionSettings as any }));
              } else {
                setWebsiteForm(prev => ({ ...prev, ...updates }));
              }
            }}
            footerLayoutSettings={{
              footerVisibility: websiteForm.footerVisibility,
              footerColumns: websiteForm.footerColumns,
              footerWidth: websiteForm.footerWidth,
              footerPadding: websiteForm.footerPadding,
              sectionSettings: websiteForm.footerSectionSettings as any,
            }}
            onFooterLayoutChange={(updates) => {
              if (updates.sectionSettings) {
                setWebsiteForm(prev => ({ ...prev, footerSectionSettings: updates.sectionSettings as any }));
              } else {
                setWebsiteForm(prev => ({ ...prev, ...updates }));
              }
            }}
            innerPageSettings={{
              pageLayout: websiteForm.pageLayout,
              sidebarWidth: websiteForm.sidebarWidth,
              pagePadding: websiteForm.pagePadding,
              showBreadcrumb: websiteForm.showBreadcrumb,
            }}
            onInnerPageChange={(updates) => setWebsiteForm(prev => ({ ...prev, ...updates }))}
          />

          <WebsiteBodyComponents
            config={globalComponentsConfig}
            onChange={setGlobalComponentsConfig}
            title="Global Components"
            description="Create reusable components that can be shared across all pages of your website."
            brandingColors={{ primaryColor: websiteForm.primaryColor || "#3B82F6", secondaryColor: websiteForm.secondaryColor || "#1E40AF", accentColor: websiteForm.accentColor || "#F59E0B" }}
          />
        </TabsContent>


        <TabsContent value="pages" className="space-y-4">
          <WebsitePagesTab hasWebsite={!!hasWebsite} isAdmin={isAdmin} onEditPageContent={(pageId) => setEditingPageId(pageId)} />
        </TabsContent>

        <TabsContent value="blog" className="space-y-4">
          <WebsiteBlogTab hasWebsite={!!hasWebsite} canEdit={canEdit} isMobile={isMobile} />
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-lg font-semibold">Media Library</h2>
              <p className="text-sm text-muted-foreground">Manage all uploaded images and files</p>
            </div>
          </div>
          <MediaLibraryTab />
        </TabsContent>


        <TabsContent value="gallery" className="space-y-4">
          <WebsiteGalleryTab hasWebsite={!!hasWebsite} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="social" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                Social Media Manager
              </CardTitle>
              <CardDescription>
                Create, schedule, and manage your social media content across all platforms
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  <Clock className="h-5 w-5 text-purple-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Scheduling</p>
                    <p className="text-xs text-muted-foreground">Schedule posts across platforms with recurring options</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  <Sparkles className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">AI Generation</p>
                    <p className="text-xs text-muted-foreground">Generate engaging content with AI for any platform</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  <BarChart3 className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Dashboard</p>
                    <p className="text-xs text-muted-foreground">Track posts, campaigns, and connected accounts</p>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Manage your social media presence with a full content calendar, AI-powered post generation, multi-platform scheduling, and campaign tracking. Social media profile links for your website can be configured in the Setup tab.
              </p>
              <Button
                onClick={() => navigate("/social-media")}
                data-testid="button-open-social-media"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Social Media Manager
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Website Analytics</h2>
            <div className="flex items-center gap-2">
              {[7, 30, 90].map((d) => (
                <Button
                  key={d}
                  variant={analyticsPeriod === d ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAnalyticsPeriod(d)}
                  data-testid={`button-period-${d}`}
                >
                  {d} days
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MousePointer className="h-4 w-4" />
                  <span className="text-sm">Page Views</span>
                </div>
                <p className="text-2xl font-bold" data-testid="text-total-pageviews">
                  {analyticsData?.totals.pageViews.toLocaleString() || "0"}
                </p>
                <p className="text-xs text-muted-foreground">Last {analyticsPeriod} days</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-sm">Unique Visitors</span>
                </div>
                <p className="text-2xl font-bold" data-testid="text-unique-visitors">
                  {analyticsData?.totals.uniqueVisitors.toLocaleString() || "0"}
                </p>
                <p className="text-xs text-muted-foreground">Last {analyticsPeriod} days</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-sm">Sessions</span>
                </div>
                <p className="text-2xl font-bold" data-testid="text-total-sessions">
                  {analyticsData?.totals.sessions.toLocaleString() || "0"}
                </p>
                <p className="text-xs text-muted-foreground">Last {analyticsPeriod} days</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Mail className="h-4 w-4" />
                  <span className="text-sm">Contact Forms</span>
                </div>
                <p className="text-2xl font-bold" data-testid="text-contact-forms">
                  {analyticsData?.totals.contactFormSubmissions?.toLocaleString() || "0"}
                </p>
                <p className="text-xs text-muted-foreground">Last {analyticsPeriod} days</p>
              </CardContent>
            </Card>
          </div>

          {analyticsData?.hasData && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Traffic Overview</CardTitle>
                  <CardDescription>Page views and unique visitors over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div style={{ width: "100%", height: 300 }} data-testid="chart-traffic-overview">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analyticsData.dailyStats}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(val: string) => {
                            const d = new Date(val);
                            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                          }}
                          fontSize={12}
                        />
                        <YAxis fontSize={12} />
                        <RechartsTooltip
                          labelFormatter={(val: string) => {
                            const d = new Date(val);
                            return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="pageViews"
                          name="Page Views"
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--primary))"
                          fillOpacity={0.15}
                        />
                        <Area
                          type="monotone"
                          dataKey="uniqueVisitors"
                          name="Unique Visitors"
                          stroke="hsl(var(--muted-foreground))"
                          fill="hsl(var(--muted-foreground))"
                          fillOpacity={0.1}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top Pages</CardTitle>
                    <CardDescription>Most visited pages</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analyticsData.topPages && analyticsData.topPages.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Page</TableHead>
                            <TableHead className="text-right">Views</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {analyticsData.topPages.map((page, i) => (
                            <TableRow key={i} data-testid={`row-top-page-${i}`}>
                              <TableCell className="font-mono text-sm">{page.path}</TableCell>
                              <TableCell className="text-right">{page.count.toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">No page data available</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top Referrers</CardTitle>
                    <CardDescription>Where your traffic comes from</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analyticsData.referrers && analyticsData.referrers.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Source</TableHead>
                            <TableHead className="text-right">Visits</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {analyticsData.referrers.map((ref, i) => (
                            <TableRow key={i} data-testid={`row-referrer-${i}`}>
                              <TableCell className="text-sm truncate max-w-[200px]">{ref.referrer}</TableCell>
                              <TableCell className="text-right">{ref.count.toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">No referrer data available</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {!analyticsData?.hasData && (
            <Card className="py-12">
              <CardContent className="text-center">
                <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No analytics data yet</h3>
                <p className="text-muted-foreground mb-2">
                  Analytics will appear here once your website starts receiving traffic.
                </p>
                <p className="text-sm text-muted-foreground">
                  Preview your website or publish it to start collecting visitor data.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="leads" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Contact Submissions</h2>
              <p className="text-sm text-muted-foreground">Manage leads from your website contact form</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" data-testid="badge-unread-count">
                {contactSubmissions.filter(s => !s.read).length} unread
              </Badge>
            </div>
          </div>

          {contactSubmissions.length === 0 ? (
            <Card className="py-12">
              <CardContent className="text-center">
                <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No contact submissions yet</h3>
                <p className="text-muted-foreground">
                  Submissions from your website contact form will appear here
                </p>
              </CardContent>
            </Card>
          ) : isMobile ? (
            <div className="space-y-3">
              {contactSubmissions.map((submission) => {
                const s = submission as any;
                const createdAt = submission.createdAt || s.created_at;
                const responded = submission.responded ?? false;
                const convertedToCrm = submission.convertedToCrm || s.converted_to_crm;
                return (
                  <Card key={submission.id} className={!submission.read ? "border-primary/30" : ""} data-testid={`card-submission-${submission.id}`}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{submission.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{submission.email}</p>
                        </div>
                        <Button variant="ghost" size="icon" data-testid={`button-view-submission-${submission.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                      {submission.subject && (
                        <p className="text-sm text-muted-foreground">{submission.subject}</p>
                      )}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1 flex-wrap">
                          {!submission.read && (
                            <Badge variant="secondary">Unread</Badge>
                          )}
                          {responded && (
                            <Badge variant="outline">Responded</Badge>
                          )}
                          {convertedToCrm && (
                            <Badge>CRM</Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {createdAt ? format(new Date(createdAt), "MMM d, yyyy") : "-"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contactSubmissions.map((submission) => {
                  const s = submission as any;
                  const createdAt = submission.createdAt || s.created_at;
                  const responded = submission.responded ?? false;
                  const convertedToCrm = submission.convertedToCrm || s.converted_to_crm;
                  return (
                    <TableRow key={submission.id} className={!submission.read ? "bg-muted/50" : ""} data-testid={`row-submission-${submission.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{submission.name}</p>
                          <p className="text-sm text-muted-foreground">{submission.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>{submission.subject || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!submission.read && (
                            <Badge variant="secondary">Unread</Badge>
                          )}
                          {responded && (
                            <Badge variant="outline">Responded</Badge>
                          )}
                          {convertedToCrm && (
                            <Badge>CRM</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{createdAt ? format(new Date(createdAt), "MMM d, yyyy") : "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" data-testid={`button-view-submission-${submission.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Website Preview
                  </CardTitle>
                  <CardDescription>See how your website will look to visitors</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center border rounded-lg p-1 gap-1">
                    <Button
                      variant={previewDevice === "desktop" ? "secondary" : "ghost"}
                      size="icon"
                      onClick={() => setPreviewDevice("desktop")}
                      data-testid="button-preview-desktop"
                    >
                      <Monitor className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={previewDevice === "tablet" ? "secondary" : "ghost"}
                      size="icon"
                      onClick={() => setPreviewDevice("tablet")}
                      data-testid="button-preview-tablet"
                    >
                      <Tablet className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={previewDevice === "mobile" ? "secondary" : "ghost"}
                      size="icon"
                      onClick={() => setPreviewDevice("mobile")}
                      data-testid="button-preview-mobile"
                    >
                      <Smartphone className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchPreview()}
                    disabled={loadingPreview}
                    data-testid="button-refresh-preview"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${loadingPreview ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingPreview ? (
                <div className="flex items-center justify-center h-[600px]">
                  <div className="text-center space-y-3">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">Loading preview...</p>
                  </div>
                </div>
              ) : !previewData ? (
                <div className="flex items-center justify-center h-[600px]">
                  <div className="text-center space-y-3">
                    <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">No website data available</p>
                    <p className="text-sm text-muted-foreground">Configure your website in the Setup tab first</p>
                  </div>
                </div>
              ) : (
                <div 
                  className="mx-auto border rounded-lg overflow-hidden bg-white shadow-sm transition-all duration-300"
                  style={{
                    width: previewDevice === "desktop" ? "100%" : previewDevice === "tablet" ? "768px" : "375px",
                    maxWidth: "100%",
                  }}
                >
                  <div 
                    className="overflow-y-auto"
                    style={{ height: "600px" }}
                  >
                    <WebsitePreviewRenderer 
                      data={{
                        ...previewData,
                        website: {
                          ...previewData.website,
                          siteTitle: websiteForm.siteTitle || previewData.website?.siteTitle,
                          siteTagline: websiteForm.siteTagline || previewData.website?.siteTagline,
                          primaryColor: websiteForm.primaryColor || previewData.website?.primaryColor,
                          secondaryColor: websiteForm.secondaryColor || previewData.website?.secondaryColor,
                          accentColor: websiteForm.accentColor || previewData.website?.accentColor,
                          fontFamily: websiteForm.fontFamily || previewData.website?.fontFamily,
                          contactEmail: websiteForm.contactEmail || previewData.website?.contactEmail,
                          contactPhone: websiteForm.contactPhone || previewData.website?.contactPhone,
                          logoUrl: websiteForm.logoUrl || previewData.website?.logoUrl,
                          logoHeight: websiteForm.logoHeight ?? previewData.website?.logoHeight,
                        },
                        headerConfig: headerComponentsConfig,
                        footerConfig: footerComponentsConfig,
                        bodyConfig: bodyComponentsConfig,
                        footerLayoutSettings: {
                          footerColumns: websiteForm.footerColumns,
                          sectionSettings: websiteForm.footerSectionSettings as any,
                        },
                        headerLayoutSettings: {
                          headerType: websiteForm.headerType,
                          headerHeight: websiteForm.headerHeight,
                          sectionSettings: websiteForm.headerSectionSettings as any,
                        },
                      }} 
                      deviceType={previewDevice}
                      websiteId={websiteData?.website?.id}
                      trackingEnabled={true}
                    />
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span>
                  Preview shows how your website will appear. Changes won't be visible until you publish.
                </span>
              </div>
            </CardFooter>
          </Card>
        </TabsContent>


        <TabsContent value="publishing" className="space-y-4">
          <WebsitePublishingTab website={website ?? null} onPublish={handlePublish} publishPending={publishWebsiteMutation.isPending} />
        </TabsContent>
      </Tabs>

      <Dialog open={showAIAssistant} onOpenChange={setShowAIAssistant}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Website Design Assistant
            </DialogTitle>
            <DialogDescription>
              Ask questions about website design, content, or get suggestions for improvements
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 min-h-[300px] p-4 bg-muted/50 rounded-lg">
            {aiConversation.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Wand2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Start a conversation with the AI assistant</p>
                <p className="text-sm mt-2">Try asking about color schemes, page layouts, or content ideas</p>
              </div>
            ) : (
              aiConversation.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-background border"}`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))
            )}
            {aiAssistantMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-background border p-3 rounded-lg">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-4">
            <Input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Ask about design, content, or get suggestions..."
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAISubmit()}
              data-testid="input-ai-prompt"
            />
            <Button onClick={handleAISubmit} disabled={aiAssistantMutation.isPending} data-testid="button-send-ai">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAIWizard} onOpenChange={(open) => { if (!open && !wizardGenerating) setShowAIWizard(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              AI Website Wizard
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 0 && "Tell us about your company and we'll generate a professional website for you."}
              {wizardStep === 1 && "Set your goals and style preferences."}
              {wizardStep === 2 && "Add your contact information."}
              {wizardStep === 3 && wizardGenerating && "Generating your website..."}
              {wizardStep === 3 && !wizardGenerating && wizardResult && "Your website has been generated!"}
              {wizardStep === 3 && !wizardGenerating && wizardError && "Something went wrong."}
            </DialogDescription>
          </DialogHeader>

          {wizardStep === 0 && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Company Name *</Label>
                <Input
                  value={wizardForm.companyName}
                  onChange={(e) => setWizardForm(p => ({ ...p, companyName: e.target.value }))}
                  placeholder="e.g., Summit Construction LLC"
                  data-testid="input-wizard-company-name"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Industry / Trade *</Label>
                <Select value={wizardForm.industry} onValueChange={(v) => setWizardForm(p => ({ ...p, industry: v }))}>
                  <SelectTrigger data-testid="select-wizard-industry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general_contractor">General Contractor</SelectItem>
                    <SelectItem value="concrete">Concrete</SelectItem>
                    <SelectItem value="electrical">Electrical</SelectItem>
                    <SelectItem value="plumbing">Plumbing</SelectItem>
                    <SelectItem value="hvac">HVAC</SelectItem>
                    <SelectItem value="roofing">Roofing</SelectItem>
                    <SelectItem value="painting">Painting</SelectItem>
                    <SelectItem value="landscaping">Landscaping</SelectItem>
                    <SelectItem value="demolition">Demolition</SelectItem>
                    <SelectItem value="flooring">Flooring</SelectItem>
                    <SelectItem value="masonry">Masonry</SelectItem>
                    <SelectItem value="steel_erection">Steel / Structural</SelectItem>
                    <SelectItem value="excavation">Excavation / Sitework</SelectItem>
                    <SelectItem value="drywall">Drywall</SelectItem>
                    <SelectItem value="carpentry">Carpentry</SelectItem>
                    <SelectItem value="fire_protection">Fire Protection</SelectItem>
                    <SelectItem value="insulation">Insulation</SelectItem>
                    <SelectItem value="other_construction">Other Construction Trade</SelectItem>
                    <SelectItem value="non_construction">Non-Construction Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Company Description *</Label>
                <Textarea
                  value={wizardForm.companyDescription}
                  onChange={(e) => setWizardForm(p => ({ ...p, companyDescription: e.target.value }))}
                  placeholder="Briefly describe what your company does, your specialties, and what makes you stand out..."
                  rows={3}
                  data-testid="input-wizard-description"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Services Offered *</Label>
                <Textarea
                  value={wizardForm.services}
                  onChange={(e) => setWizardForm(p => ({ ...p, services: e.target.value }))}
                  placeholder="e.g., Residential Construction, Commercial Renovations, Kitchen Remodeling, Bathroom Remodeling"
                  rows={2}
                  data-testid="input-wizard-services"
                />
                <p className="text-xs text-muted-foreground mt-1">Separate each service with a comma</p>
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Primary Goal</Label>
                <Select value={wizardForm.goals} onValueChange={(v) => setWizardForm(p => ({ ...p, goals: v }))}>
                  <SelectTrigger data-testid="select-wizard-goals">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead_generation">Generate Leads / Get More Clients</SelectItem>
                    <SelectItem value="portfolio_showcase">Showcase Projects & Portfolio</SelectItem>
                    <SelectItem value="brand_awareness">Build Brand Awareness</SelectItem>
                    <SelectItem value="recruitment">Recruit New Team Members</SelectItem>
                    <SelectItem value="information">Provide Company Information</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Style Preference</Label>
                <Select value={wizardForm.stylePreference} onValueChange={(v) => setWizardForm(p => ({ ...p, stylePreference: v }))}>
                  <SelectTrigger data-testid="select-wizard-style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modern">Modern & Clean</SelectItem>
                    <SelectItem value="classic">Classic & Professional</SelectItem>
                    <SelectItem value="bold">Bold & Impactful</SelectItem>
                    <SelectItem value="minimal">Minimal & Simple</SelectItem>
                    <SelectItem value="industrial">Industrial & Rugged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Color Preference</Label>
                <Select value={wizardForm.colorPreference} onValueChange={(v) => setWizardForm(p => ({ ...p, colorPreference: v }))}>
                  <SelectTrigger data-testid="select-wizard-color">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Blue (Trust & Reliability)</SelectItem>
                    <SelectItem value="orange">Orange (Energy & Enthusiasm)</SelectItem>
                    <SelectItem value="green">Green (Growth & Sustainability)</SelectItem>
                    <SelectItem value="red">Red (Bold & Powerful)</SelectItem>
                    <SelectItem value="dark">Dark / Charcoal (Premium & Sleek)</SelectItem>
                    <SelectItem value="earth_tones">Earth Tones (Natural & Grounded)</SelectItem>
                    <SelectItem value="navy_gold">Navy & Gold (Luxury & Trust)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Optional - this info will be used in your Contact page and footer.</p>
              <div>
                <Label className="text-sm font-medium">Contact Email</Label>
                <Input
                  value={wizardForm.contactEmail}
                  onChange={(e) => setWizardForm(p => ({ ...p, contactEmail: e.target.value }))}
                  placeholder="info@yourcompany.com"
                  data-testid="input-wizard-email"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Phone Number</Label>
                <Input
                  value={wizardForm.contactPhone}
                  onChange={(e) => setWizardForm(p => ({ ...p, contactPhone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  data-testid="input-wizard-phone"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Business Address</Label>
                <Input
                  value={wizardForm.contactAddress}
                  onChange={(e) => setWizardForm(p => ({ ...p, contactAddress: e.target.value }))}
                  placeholder="123 Main St, City, State 12345"
                  data-testid="input-wizard-address"
                />
              </div>
            </div>
          )}

          {wizardStep === 3 && wizardGenerating && (
            <div className="py-8 space-y-6">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                  <Wand2 className="h-6 w-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-medium">Building your website...</p>
                  <p className="text-sm text-muted-foreground">
                    {wizardProgress < 30 && "Analyzing your business profile..."}
                    {wizardProgress >= 30 && wizardProgress < 60 && "Designing page layouts and components..."}
                    {wizardProgress >= 60 && wizardProgress < 85 && "Writing professional content..."}
                    {wizardProgress >= 85 && "Finalizing and saving pages..."}
                  </p>
                </div>
              </div>
              <Progress value={wizardProgress} className="w-full" />
            </div>
          )}

          {wizardStep === 3 && !wizardGenerating && wizardResult && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-md">
                <Check className="h-6 w-6 text-green-600 flex-shrink-0" />
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">Website Generated Successfully</p>
                  <p className="text-sm text-muted-foreground">
                    Created {wizardResult.pages?.length || 0} pages with professional content tailored to your business.
                  </p>
                </div>
              </div>
              {wizardResult.pages && wizardResult.pages.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Pages Created:</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {wizardResult.pages.map((page: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 p-2 border rounded-md text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{page.pageTitle || page.navigationLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {wizardResult.siteSettings && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Site Settings Updated:</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {wizardResult.siteSettings.primaryColor && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: wizardResult.siteSettings.primaryColor }} />
                        <span>Primary</span>
                      </div>
                    )}
                    {wizardResult.siteSettings.secondaryColor && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: wizardResult.siteSettings.secondaryColor }} />
                        <span>Secondary</span>
                      </div>
                    )}
                    {wizardResult.siteSettings.accentColor && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: wizardResult.siteSettings.accentColor }} />
                        <span>Accent</span>
                      </div>
                    )}
                    {wizardResult.siteSettings.fontFamily && (
                      <Badge variant="secondary" className="text-xs">{wizardResult.siteSettings.fontFamily}</Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {wizardStep === 3 && !wizardGenerating && wizardError && (
            <div className="py-4">
              <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                <AlertCircle className="h-6 w-6 text-destructive flex-shrink-0" />
                <div>
                  <p className="font-medium text-destructive">Generation Failed</p>
                  <p className="text-sm text-muted-foreground">{wizardError}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between gap-2">
            {wizardStep < 3 && (
              <>
                {wizardStep > 0 && (
                  <Button variant="outline" onClick={() => setWizardStep(s => s - 1)} data-testid="button-wizard-back">
                    Back
                  </Button>
                )}
                <div className="flex items-center gap-1.5 mx-auto">
                  {[0, 1, 2].map(i => (
                    <div key={i} className={`h-2 w-2 rounded-full transition-colors ${i === wizardStep ? "bg-primary" : "bg-muted-foreground/30"}`} />
                  ))}
                </div>
                {wizardStep < 2 ? (
                  <Button
                    onClick={() => setWizardStep(s => s + 1)}
                    disabled={wizardStep === 0 && (!wizardForm.companyName.trim() || !wizardForm.services.trim() || !wizardForm.companyDescription.trim())}
                    data-testid="button-wizard-next"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    onClick={async () => {
                      setWizardStep(3);
                      setWizardGenerating(true);
                      setWizardProgress(0);
                      setWizardError("");
                      setWizardResult(null);
                      const progressInterval = setInterval(() => {
                        setWizardProgress(p => {
                          if (p >= 90) { clearInterval(progressInterval); return 90; }
                          return p + Math.random() * 8 + 2;
                        });
                      }, 800);
                      try {
                        const res = await apiRequest("POST", "/api/website/ai-wizard", wizardForm);
                        const data = await res.json();
                        clearInterval(progressInterval);
                        setWizardProgress(100);
                        if (data.success) {
                          setWizardResult(data);
                          queryClient.invalidateQueries({ queryKey: ["/api/website"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/website/preview"] });
                          toast({ title: "Website generated!", description: `Created ${data.pages?.length || 0} pages with AI content.` });
                        } else {
                          setWizardError(data.error || "Failed to generate website.");
                        }
                      } catch (err: any) {
                        clearInterval(progressInterval);
                        setWizardProgress(0);
                        const rawMsg = err.message || "An unexpected error occurred.";
                        const cleanMsg = rawMsg.includes("<!DOCTYPE") || rawMsg.includes("<html") || rawMsg.length > 300
                          ? "The server was temporarily unavailable. Please try again."
                          : rawMsg;
                        setWizardError(cleanMsg);
                      } finally {
                        setWizardGenerating(false);
                      }
                    }}
                    data-testid="button-wizard-generate"
                  >
                    <Wand2 className="h-4 w-4 mr-1" />
                    Generate Website
                  </Button>
                )}
              </>
            )}
            {wizardStep === 3 && !wizardGenerating && (
              <>
                {wizardError && (
                  <Button variant="outline" onClick={() => { setWizardStep(0); setWizardError(""); }} data-testid="button-wizard-retry">
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Try Again
                  </Button>
                )}
                {wizardResult && (
                  <>
                    <Button variant="outline" onClick={() => { setWizardStep(0); setWizardResult(null); }} data-testid="button-wizard-regenerate">
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Regenerate
                    </Button>
                    <Button onClick={() => { setShowAIWizard(false); setActiveTab("pages"); }} data-testid="button-wizard-edit-site">
                      <Edit className="h-4 w-4 mr-1" />
                      Edit This Site
                    </Button>
                  </>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}