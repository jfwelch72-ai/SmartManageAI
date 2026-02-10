import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import WebsitePreviewRenderer from "@/components/website-preview-renderer";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Globe,
  FileText,
  Layout,
  Palette,
  Settings,
  Eye,
  ExternalLink,
  Plus,
  Edit,
  Trash2,
  Image,
  FileEdit,
  MessageSquare,
  Share2,
  BarChart3,
  Mail,
  Sparkles,
  Send,
  Check,
  Clock,
  AlertCircle,
  RefreshCw,
  Search,
  BookOpen,
  FolderOpen,
  Users,
  TrendingUp,
  MousePointer,
  ArrowUpRight,
  Target,
  Copy,
  Wand2,
  Save,
  Monitor,
  Tablet,
  Upload,
  X,
  Loader2,
  Smartphone,
  LayoutTemplate
} from "lucide-react";
import { format } from "date-fns";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok, SiPinterest } from "react-icons/si";

interface Website {
  id: string;
  organizationId: string;
  subdomain: string;
  customDomain: string | null;
  domainVerified: boolean;
  status: "DRAFT" | "PUBLISHED" | "MAINTENANCE";
  siteTitle: string | null;
  siteTagline: string | null;
  logoUrl: string | null;
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
  lastPublishedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface WebsitePage {
  id: string;
  websiteId: string;
  pageType: string;
  pageSlug: string;
  pageTitle: string;
  navigationLabel: string | null;
  navigationOrder: number;
  showInNavigation: boolean;
  isHomepage: boolean;
  status: string;
  publishedAt: string | null;
  aiGenerated: boolean;
  parentPageId: string | null;
}

interface BlogPost {
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

interface GalleryProject {
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

interface SocialLinks {
  id?: string;
  facebookUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
}

interface ContactSubmission {
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

interface AnalyticsSummary {
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
}

interface AIResponse {
  response: string;
}

const WEBSITE_TEMPLATES = [
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

export default function WebsiteBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("setup");
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiConversation, setAiConversation] = useState<Array<{role: string; content: string}>>([]);
  const [showCreatePageDialog, setShowCreatePageDialog] = useState(false);
  const [showCreateBlogDialog, setShowCreateBlogDialog] = useState(false);
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
  const [showGenerateBlogDialog, setShowGenerateBlogDialog] = useState(false);
  const [generatedBlogContent, setGeneratedBlogContent] = useState<any>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  
  // Edit states
  const [showEditBlogDialog, setShowEditBlogDialog] = useState(false);
  const [selectedBlogPost, setSelectedBlogPost] = useState<BlogPost | null>(null);
  const [editBlogForm, setEditBlogForm] = useState({
    title: "",
    excerpt: "",
    content: "",
    category: "",
    status: "DRAFT"
  });
  
  const [showEditProjectDialog, setShowEditProjectDialog] = useState(false);
  const [selectedProject, setSelectedProject] = useState<GalleryProject | null>(null);
  const [editProjectForm, setEditProjectForm] = useState({
    title: "",
    shortDescription: "",
    projectType: "",
    serviceType: "",
    clientName: "",
    locationCity: "",
    locationState: "",
    coverImageUrl: ""
  });
  
  const [showEditPageDialog, setShowEditPageDialog] = useState(false);
  const [selectedPage, setSelectedPage] = useState<any>(null);
  const [editPageForm, setEditPageForm] = useState({
    pageType: "CUSTOM",
    pageTitle: "",
    pageSlug: "",
    navigationLabel: "",
    showInNavigation: true,
    status: "DRAFT",
    metaTitle: "",
    metaDescription: ""
  });

  const isAdmin = !!user && ["ADMIN", "SUPER_ADMIN"].includes(user.role);
  const canEdit = !!user && ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(user.role);

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
    showTestimonials: true
  });

  const [pageForm, setPageForm] = useState({
    pageType: "CUSTOM",
    pageTitle: "",
    pageSlug: "",
    navigationLabel: "",
    showInNavigation: true,
    parentPageId: "" as string
  });

  const [blogForm, setBlogForm] = useState({
    title: "",
    excerpt: "",
    content: "",
    category: "",
    status: "DRAFT"
  });

  const [generateBlogForm, setGenerateBlogForm] = useState({
    topic: "",
    tone: "professional",
    length: "medium"
  });

  const [projectForm, setProjectForm] = useState({
    title: "",
    shortDescription: "",
    projectType: "",
    serviceType: "",
    clientName: "",
    locationCity: "",
    locationState: "",
    coverImageUrl: ""
  });

  const [uploadingImage, setUploadingImage] = useState(false);

  const [socialForm, setSocialForm] = useState<SocialLinks>({
    facebookUrl: null,
    instagramUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    youtubeUrl: null,
    tiktokUrl: null
  });

  // AI Social Post Generator state
  const [socialPostForm, setSocialPostForm] = useState({
    platform: "FACEBOOK",
    topic: "",
    tone: "professional"
  });
  const [generatedSocialPost, setGeneratedSocialPost] = useState<{
    content: string;
    hashtags: string[];
    suggestedImagePrompt: string;
    bestTimeToPost: string;
    engagementTips: string;
  } | null>(null);

  const { data: websiteData, isLoading: loadingWebsite } = useQuery<{ hasWebsite: boolean; website: Website | null }>({
    queryKey: ["/api/website"],
    enabled: !!user && isAdmin
  });

  const { data: pages = [], isLoading: loadingPages } = useQuery<WebsitePage[]>({
    queryKey: ["/api/website/pages"],
    enabled: !!user && isAdmin && !!websiteData?.hasWebsite
  });

  const { data: blogPosts = [], isLoading: loadingBlog } = useQuery<BlogPost[]>({
    queryKey: ["/api/website/blog/posts"],
    enabled: !!user && canEdit && !!websiteData?.hasWebsite
  });

  const { data: projects = [], isLoading: loadingProjects } = useQuery<GalleryProject[]>({
    queryKey: ["/api/website/projects"],
    enabled: !!user && canEdit && !!websiteData?.hasWebsite
  });

  const { data: socialLinks } = useQuery<SocialLinks>({
    queryKey: ["/api/website/social"],
    enabled: !!user && isAdmin && !!websiteData?.hasWebsite,
    refetchOnMount: true
  });

  const { data: analyticsData } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/website/analytics/summary"],
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
    mutationFn: async (data: typeof websiteForm) => {
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

  const createPageMutation = useMutation({
    mutationFn: async (data: typeof pageForm) => {
      return await apiRequest("POST", "/api/website/pages", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
      toast({ title: "Page created successfully" });
      setShowCreatePageDialog(false);
      setPageForm({ pageType: "CUSTOM", pageTitle: "", pageSlug: "", navigationLabel: "", showInNavigation: true, parentPageId: "" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating page", description: error.message, variant: "destructive" });
    }
  });

  const createBlogMutation = useMutation({
    mutationFn: async (data: typeof blogForm) => {
      return await apiRequest("POST", "/api/website/blog/posts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/blog/posts"] });
      toast({ title: "Blog post created successfully" });
      setShowCreateBlogDialog(false);
      setBlogForm({ title: "", excerpt: "", content: "", category: "", status: "DRAFT" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating blog post", description: error.message, variant: "destructive" });
    }
  });

  const generateBlogMutation = useMutation({
    mutationFn: async (data: typeof generateBlogForm) => {
      const response = await apiRequest("POST", "/api/website/blog/posts/generate", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setGeneratedBlogContent(data);
      toast({ title: "Blog post generated!" });
    },
    onError: (error: any) => {
      toast({ title: "Error generating blog post", description: error.message, variant: "destructive" });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data: typeof projectForm) => {
      return await apiRequest("POST", "/api/website/projects", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/projects"] });
      toast({ title: "Project created successfully" });
      setShowCreateProjectDialog(false);
      setProjectForm({ title: "", shortDescription: "", projectType: "", serviceType: "", clientName: "", locationCity: "", locationState: "", coverImageUrl: "" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating project", description: error.message, variant: "destructive" });
    }
  });

  // Edit mutations
  const editBlogMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editBlogForm }) => {
      return await apiRequest("PATCH", `/api/website/blog/posts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/blog/posts"] });
      toast({ title: "Blog post updated successfully" });
      setShowEditBlogDialog(false);
      setSelectedBlogPost(null);
    },
    onError: (error: any) => {
      toast({ title: "Error updating blog post", description: error.message, variant: "destructive" });
    }
  });

  const editProjectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editProjectForm }) => {
      return await apiRequest("PATCH", `/api/website/projects/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/projects"] });
      toast({ title: "Project updated successfully" });
      setShowEditProjectDialog(false);
      setSelectedProject(null);
    },
    onError: (error: any) => {
      toast({ title: "Error updating project", description: error.message, variant: "destructive" });
    }
  });

  const editPageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editPageForm }) => {
      return await apiRequest("PATCH", `/api/website/pages/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
      toast({ title: "Page updated successfully" });
      setShowEditPageDialog(false);
      setSelectedPage(null);
    },
    onError: (error: any) => {
      toast({ title: "Error updating page", description: error.message, variant: "destructive" });
    }
  });

  // Edit handlers
  const handleEditBlog = (post: BlogPost) => {
    const p = post as any;
    setSelectedBlogPost(post);
    setEditBlogForm({
      title: post.title || "",
      excerpt: post.excerpt || "",
      content: p.content || p.content_html || "",
      category: post.category || "",
      status: post.status || "DRAFT"
    });
    setShowEditBlogDialog(true);
  };

  const handleEditProject = (project: GalleryProject) => {
    const pr = project as any;
    setSelectedProject(project);
    setEditProjectForm({
      title: project.title || "",
      shortDescription: project.shortDescription || pr.short_description || "",
      projectType: project.projectType || pr.project_type || "",
      serviceType: project.serviceType || pr.service_type || "",
      clientName: project.clientName || pr.client_name || "",
      locationCity: project.locationCity || pr.location_city || "",
      locationState: project.locationState || pr.location_state || "",
      coverImageUrl: project.coverImageUrl || pr.cover_image_url || ""
    });
    setShowEditProjectDialog(true);
  };

  const handleEditPage = (page: any) => {
    setSelectedPage(page);
    setEditPageForm({
      pageType: page.pageType || page.page_type || "CUSTOM",
      pageTitle: page.pageTitle || page.page_title || "",
      pageSlug: page.pageSlug || page.page_slug || "",
      navigationLabel: page.navigationLabel || page.navigation_label || "",
      showInNavigation: page.showInNavigation ?? page.show_in_navigation ?? true,
      status: page.status || "DRAFT",
      metaTitle: page.metaTitle || page.meta_title || "",
      metaDescription: page.metaDescription || page.meta_description || ""
    });
    setShowEditPageDialog(true);
  };

  const saveSocialMutation = useMutation({
    mutationFn: async (data: SocialLinks) => {
      return await apiRequest("POST", "/api/website/social", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/social"] });
      toast({ title: "Social links saved successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error saving social links", description: error.message, variant: "destructive" });
    }
  });

  const generateSocialPostMutation = useMutation({
    mutationFn: async (data: typeof socialPostForm) => {
      const response = await apiRequest("POST", "/api/website/social/generate-post", data);
      return response.json() as Promise<{
        content: string;
        hashtags: string[];
        suggestedImagePrompt: string;
        bestTimeToPost: string;
        engagementTips: string;
      }>;
    },
    onSuccess: (data) => {
      setGeneratedSocialPost(data);
      queryClient.invalidateQueries({ queryKey: ["/api/website/social/history"] });
      toast({ title: "Social post generated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error generating post", description: error.message, variant: "destructive" });
    }
  });

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
    saveWebsiteMutation.mutate(websiteForm);
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

  const handleUseGeneratedBlog = () => {
    if (generatedBlogContent) {
      setBlogForm({
        title: generatedBlogContent.title || "",
        excerpt: generatedBlogContent.excerpt || "",
        content: generatedBlogContent.content || "",
        category: generatedBlogContent.suggestedCategory || "",
        status: "DRAFT"
      });
      setShowGenerateBlogDialog(false);
      setShowCreateBlogDialog(true);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({ title: "Invalid file type", description: "Please select an image file", variant: "destructive" });
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 10MB", variant: "destructive" });
      return;
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/website/upload-image', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();
      setProjectForm(prev => ({ ...prev, coverImageUrl: data.url }));
      toast({ title: "Image uploaded successfully" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploadingImage(false);
    }
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
      }));
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

  return (
    <div className="p-6 space-y-6" data-testid="page-website-builder">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Globe className="h-6 w-6 text-primary" />
            Website Builder
          </h1>
          <p className="text-muted-foreground">
            Create and manage your organization's professional website
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        <TabsList className="grid grid-cols-8 w-full max-w-5xl" data-testid="tabs-website-sections">
          <TabsTrigger value="setup" className="flex items-center gap-1" data-testid="tab-setup">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Setup</span>
          </TabsTrigger>
          <TabsTrigger value="pages" className="flex items-center gap-1" data-testid="tab-pages">
            <Layout className="h-4 w-4" />
            <span className="hidden sm:inline">Pages</span>
          </TabsTrigger>
          <TabsTrigger value="blog" className="flex items-center gap-1" data-testid="tab-blog">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Blog</span>
          </TabsTrigger>
          <TabsTrigger value="gallery" className="flex items-center gap-1" data-testid="tab-gallery">
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Gallery</span>
          </TabsTrigger>
          <TabsTrigger value="social" className="flex items-center gap-1" data-testid="tab-social">
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Social</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-1" data-testid="tab-analytics">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-1" data-testid="tab-leads">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Leads</span>
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-1" data-testid="tab-preview">
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline">Preview</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Basic Settings
                </CardTitle>
                <CardDescription>Configure your website's basic information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="siteTitle">Site Title</Label>
                  <Input
                    id="siteTitle"
                    value={websiteForm.siteTitle || website?.siteTitle || ""}
                    onChange={(e) => setWebsiteForm(prev => ({ ...prev, siteTitle: e.target.value }))}
                    placeholder="Your Company Name"
                    data-testid="input-site-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siteTagline">Tagline</Label>
                  <Input
                    id="siteTagline"
                    value={websiteForm.siteTagline || website?.siteTagline || ""}
                    onChange={(e) => setWebsiteForm(prev => ({ ...prev, siteTagline: e.target.value }))}
                    placeholder="Building Excellence Since 1990"
                    data-testid="input-site-tagline"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={websiteForm.contactEmail || website?.contactEmail || ""}
                    onChange={(e) => setWebsiteForm(prev => ({ ...prev, contactEmail: e.target.value }))}
                    placeholder="info@yourcompany.com"
                    data-testid="input-contact-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Contact Phone</Label>
                  <Input
                    id="contactPhone"
                    value={websiteForm.contactPhone || website?.contactPhone || ""}
                    onChange={(e) => setWebsiteForm(prev => ({ ...prev, contactPhone: e.target.value }))}
                    placeholder="(555) 123-4567"
                    data-testid="input-contact-phone"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Branding & Colors
                </CardTitle>
                <CardDescription>Customize your website's look and feel</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                    <h4 className="font-medium text-sm">Choose Template</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {WEBSITE_TEMPLATES.map((template) => {
                      const isSelected = selectedTemplateId === template.id;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => handleTemplateSelect(template.id)}
                          className={`relative text-left rounded-md border-2 p-3 transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
                          data-testid={`template-${template.id}`}
                        >
                          {isSelected && (
                            <div className="absolute top-2 right-2">
                              <Check className="h-4 w-4 text-primary" />
                            </div>
                          )}
                          <div className="mb-2 h-16 rounded-sm overflow-hidden relative" style={{ background: template.previewColors[3] }}>
                            <div className="absolute top-0 left-0 right-0 h-4 flex items-center px-2 gap-1" style={{ background: template.previewColors[1] }}>
                              <div className="w-1 h-1 rounded-full" style={{ background: template.previewColors[4] }} />
                              <div className="w-1 h-1 rounded-full" style={{ background: template.previewColors[4] }} />
                              <div className="w-1 h-1 rounded-full" style={{ background: template.previewColors[4] }} />
                            </div>
                            <div className="absolute top-5 left-2 right-2 h-5 rounded-sm" style={{ background: template.previewColors[0], opacity: 0.9 }} />
                            <div className="absolute bottom-1 left-2 flex gap-1">
                              <div className="w-6 h-2 rounded-sm" style={{ background: template.previewColors[2] }} />
                              <div className="w-4 h-2 rounded-sm" style={{ background: template.previewColors[1], opacity: 0.5 }} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{template.name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-snug">{template.description}</p>
                          <div className="flex gap-1 mt-2">
                            {template.previewColors.slice(0, 3).map((color, i) => (
                              <div key={i} className="w-4 h-4 rounded-full border border-border/50" style={{ background: color }} />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t">
                  <h4 className="font-medium text-sm mb-3">Custom Colors</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="primaryColor">Primary</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          id="primaryColor"
                          value={websiteForm.primaryColor || website?.primaryColor || "#3B82F6"}
                          onChange={(e) => { setWebsiteForm(prev => ({ ...prev, primaryColor: e.target.value, templateId: "" })); setSelectedTemplateId(null); }}
                          className="w-10 h-10 rounded border cursor-pointer"
                          data-testid="input-primary-color"
                        />
                        <Input 
                          value={websiteForm.primaryColor || website?.primaryColor || "#3B82F6"} 
                          onChange={(e) => { setWebsiteForm(prev => ({ ...prev, primaryColor: e.target.value, templateId: "" })); setSelectedTemplateId(null); }}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="secondaryColor">Secondary</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          id="secondaryColor"
                          value={websiteForm.secondaryColor || website?.secondaryColor || "#1E40AF"}
                          onChange={(e) => { setWebsiteForm(prev => ({ ...prev, secondaryColor: e.target.value, templateId: "" })); setSelectedTemplateId(null); }}
                          className="w-10 h-10 rounded border cursor-pointer"
                          data-testid="input-secondary-color"
                        />
                        <Input 
                          value={websiteForm.secondaryColor || website?.secondaryColor || "#1E40AF"} 
                          onChange={(e) => { setWebsiteForm(prev => ({ ...prev, secondaryColor: e.target.value, templateId: "" })); setSelectedTemplateId(null); }}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accentColor">Accent</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          id="accentColor"
                          value={websiteForm.accentColor || website?.accentColor || "#F59E0B"}
                          onChange={(e) => { setWebsiteForm(prev => ({ ...prev, accentColor: e.target.value, templateId: "" })); setSelectedTemplateId(null); }}
                          className="w-10 h-10 rounded border cursor-pointer"
                          data-testid="input-accent-color"
                        />
                        <Input 
                          value={websiteForm.accentColor || website?.accentColor || "#F59E0B"} 
                          onChange={(e) => { setWebsiteForm(prev => ({ ...prev, accentColor: e.target.value, templateId: "" })); setSelectedTemplateId(null); }}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 space-y-3 border-t">
                  <h4 className="font-medium">Sections</h4>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showBlog">Show Blog</Label>
                    <Switch
                      id="showBlog"
                      checked={websiteForm.showBlog}
                      onCheckedChange={(checked) => setWebsiteForm(prev => ({ ...prev, showBlog: checked }))}
                      data-testid="switch-show-blog"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showProjects">Show Projects Gallery</Label>
                    <Switch
                      id="showProjects"
                      checked={websiteForm.showProjects}
                      onCheckedChange={(checked) => setWebsiteForm(prev => ({ ...prev, showProjects: checked }))}
                      data-testid="switch-show-projects"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showTestimonials">Show Testimonials</Label>
                    <Switch
                      id="showTestimonials"
                      checked={websiteForm.showTestimonials}
                      onCheckedChange={(checked) => setWebsiteForm(prev => ({ ...prev, showTestimonials: checked }))}
                      data-testid="switch-show-testimonials"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  SEO Settings
                </CardTitle>
                <CardDescription>Optimize your website for search engines</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="metaTitle">Meta Title (60 characters max)</Label>
                    <Input
                      id="metaTitle"
                      value={websiteForm.metaTitle || website?.metaTitle || ""}
                      onChange={(e) => setWebsiteForm(prev => ({ ...prev, metaTitle: e.target.value }))}
                      maxLength={60}
                      placeholder="Your Company | Quality Construction Services"
                      data-testid="input-meta-title"
                    />
                    <p className="text-xs text-muted-foreground">
                      {(websiteForm.metaTitle || website?.metaTitle || "").length}/60 characters
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="metaDescription">Meta Description (160 characters max)</Label>
                    <Textarea
                      id="metaDescription"
                      value={websiteForm.metaDescription || website?.metaDescription || ""}
                      onChange={(e) => setWebsiteForm(prev => ({ ...prev, metaDescription: e.target.value }))}
                      maxLength={160}
                      placeholder="We provide top-quality construction services in the greater metro area. Contact us for a free estimate."
                      data-testid="input-meta-description"
                    />
                    <p className="text-xs text-muted-foreground">
                      {(websiteForm.metaDescription || website?.metaDescription || "").length}/160 characters
                    </p>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button 
                  onClick={handleSaveWebsite}
                  disabled={saveWebsiteMutation.isPending}
                  data-testid="button-save-settings"
                >
                  {saveWebsiteMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  Save Settings
                </Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pages" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Website Pages</h2>
              <p className="text-sm text-muted-foreground">Manage your website's pages and navigation</p>
            </div>
            <Button onClick={() => setShowCreatePageDialog(true)} data-testid="button-create-page">
              <Plus className="h-4 w-4 mr-1" />
              Add Page
            </Button>
          </div>

          {loadingPages ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : pages.length === 0 ? (
            <Card className="py-12">
              <CardContent className="text-center">
                <Layout className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No pages yet</h3>
                <p className="text-muted-foreground mb-4">Get started by creating your first page</p>
                <Button onClick={() => setShowCreatePageDialog(true)} data-testid="button-create-first-page">
                  <Plus className="h-4 w-4 mr-1" />
                  Create Page
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {pages.map((page) => (
                <Card key={page.id} className="hover-elevate" data-testid={`card-page-${page.id}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded bg-muted">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-medium">{page.pageTitle}</h3>
                        <p className="text-sm text-muted-foreground">/{page.pageSlug}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={page.status === "PUBLISHED" ? "default" : "secondary"}>
                        {page.status}
                      </Badge>
                      {page.aiGenerated && (
                        <Badge variant="outline">
                          <Sparkles className="h-3 w-3 mr-1" />
                          AI
                        </Badge>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleEditPage(page)} data-testid={`button-edit-page-${page.id}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="blog" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Blog Posts</h2>
              <p className="text-sm text-muted-foreground">Manage your blog content</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowGenerateBlogDialog(true)} data-testid="button-generate-blog">
                <Wand2 className="h-4 w-4 mr-1" />
                AI Generate
              </Button>
              <Button onClick={() => setShowCreateBlogDialog(true)} data-testid="button-create-blog">
                <Plus className="h-4 w-4 mr-1" />
                New Post
              </Button>
            </div>
          </div>

          {loadingBlog ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : blogPosts.length === 0 ? (
            <Card className="py-12">
              <CardContent className="text-center">
                <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No blog posts yet</h3>
                <p className="text-muted-foreground mb-4">Start creating content to engage your audience</p>
                <div className="flex justify-center gap-2">
                  <Button variant="outline" onClick={() => setShowGenerateBlogDialog(true)} data-testid="button-generate-first-blog">
                    <Wand2 className="h-4 w-4 mr-1" />
                    AI Generate
                  </Button>
                  <Button onClick={() => setShowCreateBlogDialog(true)} data-testid="button-create-first-blog">
                    <Plus className="h-4 w-4 mr-1" />
                    Write Post
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Views</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blogPosts.map((post) => {
                  const p = post as any;
                  const createdAt = post.createdAt || p.created_at;
                  const viewCount = post.viewCount ?? p.view_count ?? 0;
                  const aiGenerated = post.aiGenerated || p.ai_generated;
                  return (
                    <TableRow key={post.id} data-testid={`row-blog-${post.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{post.title}</span>
                          {aiGenerated && (
                            <Badge variant="outline" className="text-xs">
                              <Sparkles className="h-3 w-3 mr-1" />
                              AI
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{post.category || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={post.status === "PUBLISHED" ? "default" : post.status === "ARCHIVED" ? "secondary" : "outline"}>
                          {post.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{viewCount}</TableCell>
                      <TableCell>{createdAt ? format(new Date(createdAt), "MMM d, yyyy") : "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleEditBlog(post)} data-testid={`button-edit-blog-${post.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="gallery" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Project Gallery</h2>
              <p className="text-sm text-muted-foreground">Showcase your completed projects</p>
            </div>
            <Button onClick={() => setShowCreateProjectDialog(true)} data-testid="button-create-project">
              <Plus className="h-4 w-4 mr-1" />
              Add Project
            </Button>
          </div>

          {loadingProjects ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : projects.length === 0 ? (
            <Card className="py-12">
              <CardContent className="text-center">
                <Image className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No projects yet</h3>
                <p className="text-muted-foreground mb-4">Add your completed projects to showcase your work</p>
                <Button onClick={() => setShowCreateProjectDialog(true)} data-testid="button-create-first-project">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Project
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Card key={project.id} className="hover-elevate overflow-hidden" data-testid={`card-project-${project.id}`}>
                  <div className="aspect-video bg-muted relative">
                    {(project.coverImageUrl || project.cover_image_url) ? (
                      <img src={project.coverImageUrl || project.cover_image_url || ''} alt={project.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <Image className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    {project.featured && (
                      <Badge className="absolute top-2 left-2" variant="default">Featured</Badge>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium mb-1">{project.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                          {project.shortDescription || project.short_description || "No description"}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleEditProject(project)} data-testid={`button-edit-project-${project.id}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{project.locationCity || project.location_city}{(project.locationCity || project.location_city) && (project.locationState || project.location_state) ? ', ' : ''}{project.locationState || project.location_state}</span>
                      <span>{project.viewCount ?? project.view_count ?? 0} views</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="social" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="h-5 w-5" />
                  Social Media Links
                </CardTitle>
                <CardDescription>Connect your social media profiles</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <SiFacebook className="h-4 w-4 text-blue-600" />
                    Facebook
                  </Label>
                  <Input
                    value={socialForm.facebookUrl || socialLinks?.facebookUrl || ""}
                    onChange={(e) => setSocialForm(prev => ({ ...prev, facebookUrl: e.target.value }))}
                    placeholder="https://facebook.com/yourcompany"
                    data-testid="input-facebook-url"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <SiInstagram className="h-4 w-4 text-pink-600" />
                    Instagram
                  </Label>
                  <Input
                    value={socialForm.instagramUrl || socialLinks?.instagramUrl || ""}
                    onChange={(e) => setSocialForm(prev => ({ ...prev, instagramUrl: e.target.value }))}
                    placeholder="https://instagram.com/yourcompany"
                    data-testid="input-instagram-url"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <SiLinkedin className="h-4 w-4 text-blue-700" />
                    LinkedIn
                  </Label>
                  <Input
                    value={socialForm.linkedinUrl || socialLinks?.linkedinUrl || ""}
                    onChange={(e) => setSocialForm(prev => ({ ...prev, linkedinUrl: e.target.value }))}
                    placeholder="https://linkedin.com/company/yourcompany"
                    data-testid="input-linkedin-url"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <SiYoutube className="h-4 w-4 text-red-600" />
                    YouTube
                  </Label>
                  <Input
                    value={socialForm.youtubeUrl || socialLinks?.youtubeUrl || ""}
                    onChange={(e) => setSocialForm(prev => ({ ...prev, youtubeUrl: e.target.value }))}
                    placeholder="https://youtube.com/@yourcompany"
                    data-testid="input-youtube-url"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <SiTiktok className="h-4 w-4" />
                    TikTok
                  </Label>
                  <Input
                    value={socialForm.tiktokUrl || socialLinks?.tiktokUrl || ""}
                    onChange={(e) => setSocialForm(prev => ({ ...prev, tiktokUrl: e.target.value }))}
                    placeholder="https://tiktok.com/@yourcompany"
                    data-testid="input-tiktok-url"
                  />
                </div>
                <Button 
                  className="w-full mt-4"
                  onClick={() => saveSocialMutation.mutate(socialForm)}
                  disabled={saveSocialMutation.isPending}
                  data-testid="button-save-social"
                >
                  {saveSocialMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  Save Social Links
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="h-5 w-5" />
                  AI Social Post Generator
                </CardTitle>
                <CardDescription>Generate engaging social media content</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={socialPostForm.platform} onValueChange={(v) => setSocialPostForm(prev => ({ ...prev, platform: v }))}>
                    <SelectTrigger data-testid="select-social-platform">
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FACEBOOK">Facebook</SelectItem>
                      <SelectItem value="INSTAGRAM">Instagram</SelectItem>
                      <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
                      <SelectItem value="TWITTER">X (Twitter)</SelectItem>
                      <SelectItem value="TIKTOK">TikTok</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <Select value={socialPostForm.tone} onValueChange={(v) => setSocialPostForm(prev => ({ ...prev, tone: v }))}>
                    <SelectTrigger data-testid="select-social-tone">
                      <SelectValue placeholder="Select tone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="friendly">Friendly</SelectItem>
                      <SelectItem value="informative">Informative</SelectItem>
                      <SelectItem value="promotional">Promotional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Topic / Theme</Label>
                  <Textarea
                    value={socialPostForm.topic}
                    onChange={(e) => setSocialPostForm(prev => ({ ...prev, topic: e.target.value }))}
                    placeholder="Describe what you want to post about... (e.g., Showcase a recent project completion, Share safety tips for summer construction)"
                    rows={3}
                    data-testid="input-social-topic"
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={() => generateSocialPostMutation.mutate(socialPostForm)}
                  disabled={generateSocialPostMutation.isPending || !socialPostForm.topic.trim()}
                  data-testid="button-generate-social"
                >
                  {generateSocialPostMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  Generate Post
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Generated Post Display */}
          {generatedSocialPost && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Generated Post
                </CardTitle>
                <CardDescription>Review and copy your AI-generated content</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Post Content</Label>
                  <div className="relative">
                    <div className="p-4 bg-muted rounded-lg whitespace-pre-wrap" data-testid="text-generated-post">
                      {generatedSocialPost.content}
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedSocialPost.content + (generatedSocialPost.hashtags?.length ? '\n\n' + generatedSocialPost.hashtags.map(h => '#' + h).join(' ') : ''));
                        toast({ title: "Copied to clipboard" });
                      }}
                      data-testid="button-copy-post"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </Button>
                  </div>
                </div>
                {generatedSocialPost.hashtags && generatedSocialPost.hashtags.length > 0 && (
                  <div className="space-y-2">
                    <Label>Suggested Hashtags</Label>
                    <div className="flex flex-wrap gap-2">
                      {generatedSocialPost.hashtags.map((tag, i) => (
                        <Badge key={i} variant="secondary" data-testid={`badge-hashtag-${i}`}>#{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {generatedSocialPost.bestTimeToPost && (
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">Best Time to Post</Label>
                      <p className="text-sm font-medium" data-testid="text-best-time">{generatedSocialPost.bestTimeToPost}</p>
                    </div>
                  )}
                  {generatedSocialPost.engagementTips && (
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">Engagement Tips</Label>
                      <p className="text-sm" data-testid="text-engagement-tips">{generatedSocialPost.engagementTips}</p>
                    </div>
                  )}
                </div>
                {generatedSocialPost.suggestedImagePrompt && (
                  <div className="space-y-2">
                    <Label>Suggested Image Prompt</Label>
                    <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg" data-testid="text-image-prompt">
                      {generatedSocialPost.suggestedImagePrompt}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
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
                <p className="text-xs text-muted-foreground">Last 30 days</p>
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
                <p className="text-xs text-muted-foreground">Last 30 days</p>
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
                <p className="text-xs text-muted-foreground">Last 30 days</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Mail className="h-4 w-4" />
                  <span className="text-sm">Contact Forms</span>
                </div>
                <p className="text-2xl font-bold" data-testid="text-contact-forms">
                  {analyticsData?.totals.contactFormSubmissions || "0"}
                </p>
                <p className="text-xs text-muted-foreground">Last 30 days</p>
              </CardContent>
            </Card>
          </div>

          {!analyticsData?.hasData && (
            <Card className="py-12">
              <CardContent className="text-center">
                <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No analytics data yet</h3>
                <p className="text-muted-foreground">
                  Analytics will appear here once your website starts receiving traffic
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
                      data={previewData} 
                      deviceType={previewDevice}
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

      <Dialog open={showCreatePageDialog} onOpenChange={setShowCreatePageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Page</DialogTitle>
            <DialogDescription>Add a new page to your website</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Page Type</Label>
              <Select value={pageForm.pageType} onValueChange={(v) => setPageForm(prev => ({ ...prev, pageType: v }))}>
                <SelectTrigger data-testid="select-page-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOME">Home</SelectItem>
                  <SelectItem value="ABOUT">About</SelectItem>
                  <SelectItem value="SERVICES">Services</SelectItem>
                  <SelectItem value="PROJECTS">Projects</SelectItem>
                  <SelectItem value="BLOG">Blog</SelectItem>
                  <SelectItem value="CONTACT">Contact</SelectItem>
                  <SelectItem value="SAFETY">Safety</SelectItem>
                  <SelectItem value="CAREERS">Careers</SelectItem>
                  <SelectItem value="TEAM">Team</SelectItem>
                  <SelectItem value="FAQ">FAQ</SelectItem>
                  <SelectItem value="CUSTOM">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Page Title</Label>
              <Input
                value={pageForm.pageTitle}
                onChange={(e) => {
                  const title = e.target.value;
                  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                  setPageForm(prev => ({ ...prev, pageTitle: title, pageSlug: slug }));
                }}
                placeholder="About Us"
                data-testid="input-page-title"
              />
            </div>
            <div className="space-y-2">
              <Label>URL Slug</Label>
              <Input
                value={pageForm.pageSlug}
                onChange={(e) => setPageForm(prev => ({ ...prev, pageSlug: e.target.value }))}
                placeholder="about-us"
                data-testid="input-page-slug"
              />
            </div>
            <div className="space-y-2">
              <Label>Navigation Label</Label>
              <Input
                value={pageForm.navigationLabel}
                onChange={(e) => setPageForm(prev => ({ ...prev, navigationLabel: e.target.value }))}
                placeholder="About"
                data-testid="input-nav-label"
              />
            </div>
            <div className="space-y-2">
              <Label>Parent Menu</Label>
              <Select
                value={pageForm.parentPageId || "_none"}
                onValueChange={(v) => setPageForm(prev => ({ ...prev, parentPageId: v === "_none" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-parent-page">
                  <SelectValue placeholder="None (Top Level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None (Top Level)</SelectItem>
                  {pages
                    .filter(p => !p.parentPageId)
                    .sort((a, b) => (a.navigationOrder || 0) - (b.navigationOrder || 0))
                    .map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.navigationLabel || p.pageTitle}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Show in Navigation</Label>
              <Switch
                checked={pageForm.showInNavigation}
                onCheckedChange={(checked) => setPageForm(prev => ({ ...prev, showInNavigation: checked }))}
                data-testid="switch-show-in-nav"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePageDialog(false)}>Cancel</Button>
            <Button onClick={() => createPageMutation.mutate(pageForm)} disabled={createPageMutation.isPending} data-testid="button-submit-page">
              {createPageMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
              Create Page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateBlogDialog} onOpenChange={setShowCreateBlogDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Blog Post</DialogTitle>
            <DialogDescription>Write a new blog post for your website</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={blogForm.title}
                onChange={(e) => setBlogForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter blog post title"
                data-testid="input-blog-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Excerpt (Preview text)</Label>
              <Textarea
                value={blogForm.excerpt}
                onChange={(e) => setBlogForm(prev => ({ ...prev, excerpt: e.target.value }))}
                placeholder="A brief summary of the post..."
                rows={2}
                data-testid="input-blog-excerpt"
              />
            </div>
            <div className="space-y-2">
              <Label>Content (HTML)</Label>
              <Textarea
                value={blogForm.content}
                onChange={(e) => setBlogForm(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Write your blog post content..."
                rows={8}
                data-testid="input-blog-content"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Input
                value={blogForm.category}
                onChange={(e) => setBlogForm(prev => ({ ...prev, category: e.target.value }))}
                placeholder="Industry News"
                data-testid="input-blog-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateBlogDialog(false)}>Cancel</Button>
            <Button onClick={() => createBlogMutation.mutate(blogForm)} disabled={createBlogMutation.isPending} data-testid="button-submit-blog">
              {createBlogMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
              Create Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showGenerateBlogDialog} onOpenChange={setShowGenerateBlogDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              AI Blog Post Generator
            </DialogTitle>
            <DialogDescription>Let AI write a professional blog post for you</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Topic</Label>
              <Input
                value={generateBlogForm.topic}
                onChange={(e) => setGenerateBlogForm(prev => ({ ...prev, topic: e.target.value }))}
                placeholder="e.g., Safety tips for commercial roofing projects"
                data-testid="input-generate-topic"
              />
            </div>
            <div className="space-y-2">
              <Label>Tone</Label>
              <Select value={generateBlogForm.tone} onValueChange={(v) => setGenerateBlogForm(prev => ({ ...prev, tone: v }))}>
                <SelectTrigger data-testid="select-generate-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="casual">Casual & Friendly</SelectItem>
                  <SelectItem value="technical">Technical & Detailed</SelectItem>
                  <SelectItem value="educational">Educational</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Length</Label>
              <Select value={generateBlogForm.length} onValueChange={(v) => setGenerateBlogForm(prev => ({ ...prev, length: v }))}>
                <SelectTrigger data-testid="select-generate-length">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Short (~300 words)</SelectItem>
                  <SelectItem value="medium">Medium (~600 words)</SelectItem>
                  <SelectItem value="long">Long (~1000+ words)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {generatedBlogContent && (
              <Card className="bg-muted/50">
                <CardContent className="p-4">
                  <h4 className="font-medium mb-2">{generatedBlogContent.title}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{generatedBlogContent.excerpt}</p>
                  <Button size="sm" onClick={handleUseGeneratedBlog} data-testid="button-use-generated">
                    <Check className="h-4 w-4 mr-1" />
                    Use This Content
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateBlogDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => generateBlogMutation.mutate(generateBlogForm)} 
              disabled={generateBlogMutation.isPending || !generateBlogForm.topic}
              data-testid="button-generate-blog-submit"
            >
              {generateBlogMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateProjectDialog} onOpenChange={setShowCreateProjectDialog}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Portfolio Project</DialogTitle>
            <DialogDescription>Showcase a completed project in your gallery</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project Title</Label>
              <Input
                value={projectForm.title}
                onChange={(e) => setProjectForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Downtown Office Building Renovation"
                data-testid="input-project-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Short Description</Label>
              <Textarea
                value={projectForm.shortDescription}
                onChange={(e) => setProjectForm(prev => ({ ...prev, shortDescription: e.target.value }))}
                placeholder="A brief overview of the project..."
                rows={2}
                data-testid="input-project-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Project Type</Label>
                <Select value={projectForm.projectType} onValueChange={(v) => setProjectForm(prev => ({ ...prev, projectType: v }))}>
                  <SelectTrigger data-testid="select-project-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="institutional">Institutional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Service Type</Label>
                <Input
                  value={projectForm.serviceType}
                  onChange={(e) => setProjectForm(prev => ({ ...prev, serviceType: e.target.value }))}
                  placeholder="Renovation"
                  data-testid="input-service-type"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Client Name (optional)</Label>
              <Input
                value={projectForm.clientName}
                onChange={(e) => setProjectForm(prev => ({ ...prev, clientName: e.target.value }))}
                placeholder="ABC Corporation"
                data-testid="input-client-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={projectForm.locationCity}
                  onChange={(e) => setProjectForm(prev => ({ ...prev, locationCity: e.target.value }))}
                  placeholder="Dallas"
                  data-testid="input-location-city"
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  value={projectForm.locationState}
                  onChange={(e) => setProjectForm(prev => ({ ...prev, locationState: e.target.value }))}
                  placeholder="TX"
                  data-testid="input-location-state"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cover Image</Label>
              {projectForm.coverImageUrl ? (
                <div className="relative">
                  <img 
                    src={projectForm.coverImageUrl} 
                    alt="Cover preview" 
                    className="w-full h-40 object-cover rounded-lg border"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="absolute top-2 right-2"
                    onClick={() => setProjectForm(prev => ({ ...prev, coverImageUrl: "" }))}
                    data-testid="button-remove-image"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="project-image-upload"
                    data-testid="input-image-upload"
                    disabled={uploadingImage}
                  />
                  <label 
                    htmlFor="project-image-upload" 
                    className="cursor-pointer flex flex-col items-center gap-2"
                  >
                    {uploadingImage ? (
                      <>
                        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                        <span className="text-sm text-muted-foreground">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Click to upload project image</span>
                        <span className="text-xs text-muted-foreground">PNG, JPG up to 10MB</span>
                      </>
                    )}
                  </label>
                </div>
              )}
            </div>
          </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateProjectDialog(false)}>Cancel</Button>
            <Button onClick={() => createProjectMutation.mutate(projectForm)} disabled={createProjectMutation.isPending || uploadingImage} data-testid="button-submit-project">
              {createProjectMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
              Add Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Blog Post Dialog */}
      <Dialog open={showEditBlogDialog} onOpenChange={setShowEditBlogDialog}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Blog Post</DialogTitle>
            <DialogDescription>Update your blog post content</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={editBlogForm.title}
                  onChange={(e) => setEditBlogForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Blog post title"
                  data-testid="input-edit-blog-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Excerpt</Label>
                <Textarea
                  value={editBlogForm.excerpt}
                  onChange={(e) => setEditBlogForm(prev => ({ ...prev, excerpt: e.target.value }))}
                  placeholder="Brief summary of the post..."
                  rows={2}
                  data-testid="input-edit-blog-excerpt"
                />
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <Textarea
                  value={editBlogForm.content}
                  onChange={(e) => setEditBlogForm(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="Write your blog post content..."
                  rows={8}
                  data-testid="input-edit-blog-content"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input
                    value={editBlogForm.category}
                    onChange={(e) => setEditBlogForm(prev => ({ ...prev, category: e.target.value }))}
                    placeholder="e.g., Construction Tips"
                    data-testid="input-edit-blog-category"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editBlogForm.status} onValueChange={(v) => setEditBlogForm(prev => ({ ...prev, status: v }))}>
                    <SelectTrigger data-testid="select-edit-blog-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="PUBLISHED">Published</SelectItem>
                      <SelectItem value="ARCHIVED">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditBlogDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => selectedBlogPost && editBlogMutation.mutate({ id: selectedBlogPost.id, data: editBlogForm })} 
              disabled={editBlogMutation.isPending}
              data-testid="button-save-blog"
            >
              {editBlogMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={showEditProjectDialog} onOpenChange={setShowEditProjectDialog}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update your portfolio project</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Project Title</Label>
                <Input
                  value={editProjectForm.title}
                  onChange={(e) => setEditProjectForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Downtown Office Building Renovation"
                  data-testid="input-edit-project-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Short Description</Label>
                <Textarea
                  value={editProjectForm.shortDescription}
                  onChange={(e) => setEditProjectForm(prev => ({ ...prev, shortDescription: e.target.value }))}
                  placeholder="A brief overview of the project..."
                  rows={2}
                  data-testid="input-edit-project-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Project Type</Label>
                  <Select value={editProjectForm.projectType} onValueChange={(v) => setEditProjectForm(prev => ({ ...prev, projectType: v }))}>
                    <SelectTrigger data-testid="select-edit-project-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="residential">Residential</SelectItem>
                      <SelectItem value="industrial">Industrial</SelectItem>
                      <SelectItem value="institutional">Institutional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Service Type</Label>
                  <Input
                    value={editProjectForm.serviceType}
                    onChange={(e) => setEditProjectForm(prev => ({ ...prev, serviceType: e.target.value }))}
                    placeholder="Renovation"
                    data-testid="input-edit-service-type"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Client Name (optional)</Label>
                <Input
                  value={editProjectForm.clientName}
                  onChange={(e) => setEditProjectForm(prev => ({ ...prev, clientName: e.target.value }))}
                  placeholder="ABC Corporation"
                  data-testid="input-edit-client-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input
                    value={editProjectForm.locationCity}
                    onChange={(e) => setEditProjectForm(prev => ({ ...prev, locationCity: e.target.value }))}
                    placeholder="Dallas"
                    data-testid="input-edit-location-city"
                  />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input
                    value={editProjectForm.locationState}
                    onChange={(e) => setEditProjectForm(prev => ({ ...prev, locationState: e.target.value }))}
                    placeholder="TX"
                    data-testid="input-edit-location-state"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cover Image URL</Label>
                <Input
                  value={editProjectForm.coverImageUrl}
                  onChange={(e) => setEditProjectForm(prev => ({ ...prev, coverImageUrl: e.target.value }))}
                  placeholder="https://..."
                  data-testid="input-edit-cover-image"
                />
                {editProjectForm.coverImageUrl && (
                  <img 
                    src={editProjectForm.coverImageUrl} 
                    alt="Cover preview" 
                    className="w-full h-40 object-cover rounded-lg border mt-2"
                  />
                )}
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditProjectDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => selectedProject && editProjectMutation.mutate({ id: selectedProject.id, data: editProjectForm })} 
              disabled={editProjectMutation.isPending}
              data-testid="button-save-project"
            >
              {editProjectMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Page Dialog */}
      <Dialog open={showEditPageDialog} onOpenChange={setShowEditPageDialog}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Page</DialogTitle>
            <DialogDescription>Update your website page settings</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Page Type</Label>
                <Select value={editPageForm.pageType} onValueChange={(v) => setEditPageForm(prev => ({ ...prev, pageType: v }))}>
                  <SelectTrigger data-testid="select-edit-page-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOME">Home</SelectItem>
                    <SelectItem value="ABOUT">About</SelectItem>
                    <SelectItem value="SERVICES">Services</SelectItem>
                    <SelectItem value="PROJECTS">Projects</SelectItem>
                    <SelectItem value="BLOG">Blog</SelectItem>
                    <SelectItem value="CONTACT">Contact</SelectItem>
                    <SelectItem value="SAFETY">Safety</SelectItem>
                    <SelectItem value="CAREERS">Careers</SelectItem>
                    <SelectItem value="TEAM">Team</SelectItem>
                    <SelectItem value="FAQ">FAQ</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Page Title</Label>
                <Input
                  value={editPageForm.pageTitle}
                  onChange={(e) => {
                    const title = e.target.value;
                    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    setEditPageForm(prev => ({ ...prev, pageTitle: title, pageSlug: slug }));
                  }}
                  placeholder="About Us"
                  data-testid="input-edit-page-title"
                />
              </div>
              <div className="space-y-2">
                <Label>URL Slug</Label>
                <Input
                  value={editPageForm.pageSlug}
                  onChange={(e) => setEditPageForm(prev => ({ ...prev, pageSlug: e.target.value }))}
                  placeholder="about-us"
                  data-testid="input-edit-page-slug"
                />
              </div>
              <div className="space-y-2">
                <Label>Navigation Label</Label>
                <Input
                  value={editPageForm.navigationLabel}
                  onChange={(e) => setEditPageForm(prev => ({ ...prev, navigationLabel: e.target.value }))}
                  placeholder="About"
                  data-testid="input-edit-page-nav-label"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editPageForm.status} onValueChange={(v) => setEditPageForm(prev => ({ ...prev, status: v }))}>
                  <SelectTrigger data-testid="select-edit-page-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="PUBLISHED">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch 
                  checked={editPageForm.showInNavigation} 
                  onCheckedChange={(checked) => setEditPageForm(prev => ({ ...prev, showInNavigation: checked }))}
                  data-testid="switch-edit-page-navigation"
                />
                <Label>Show in Navigation</Label>
              </div>
              <div className="space-y-2">
                <Label>Meta Title (SEO)</Label>
                <Input
                  value={editPageForm.metaTitle}
                  onChange={(e) => setEditPageForm(prev => ({ ...prev, metaTitle: e.target.value }))}
                  placeholder="Page Title | Company Name"
                  data-testid="input-edit-page-meta-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Meta Description (SEO)</Label>
                <Textarea
                  value={editPageForm.metaDescription}
                  onChange={(e) => setEditPageForm(prev => ({ ...prev, metaDescription: e.target.value }))}
                  placeholder="A brief description for search engines..."
                  rows={2}
                  data-testid="input-edit-page-meta-description"
                />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditPageDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => selectedPage && editPageMutation.mutate({ id: selectedPage.id, data: editPageForm })} 
              disabled={editPageMutation.isPending}
              data-testid="button-save-page"
            >
              {editPageMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}