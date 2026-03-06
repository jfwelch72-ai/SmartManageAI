import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Home,
  FileText,
  Layout,
  Plus,
  Edit,
  Trash2,
  Sparkles,
  Check,
  Clock,
  RefreshCw,
  Save,
  Loader2,
  Briefcase,
  Info,
  Phone,
} from "lucide-react";
import type { WebsitePageRaw, WebsitePage } from "./types";
import { mapPageFromApi } from "./types";

interface WebsitePagesTabProps {
  hasWebsite: boolean;
  isAdmin: boolean;
  onEditPageContent: (pageId: string) => void;
}

export default function WebsitePagesTab({ hasWebsite, isAdmin, onEditPageContent }: WebsitePagesTabProps) {
  const { toast } = useToast();

  const [showCreatePageDialog, setShowCreatePageDialog] = useState(false);
  const [showEditPageDialog, setShowEditPageDialog] = useState(false);
  const [selectedPage, setSelectedPage] = useState<any>(null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [deletePageTitle, setDeletePageTitle] = useState("");

  const [pageForm, setPageForm] = useState({
    pageType: "CUSTOM",
    pageTitle: "",
    pageSlug: "",
    navigationLabel: "",
    showInNavigation: true,
    parentPageId: "" as string
  });

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

  const { data: pagesRaw = [], isLoading: loadingPages } = useQuery<WebsitePageRaw[]>({
    queryKey: ["/api/website/pages"],
    enabled: isAdmin && hasWebsite
  });
  const pages: WebsitePage[] = pagesRaw.map(mapPageFromApi);

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

  const editPageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editPageForm }) => {
      const { status, ...rest } = data;
      return await apiRequest("PATCH", `/api/website/pages/${id}`, {
        ...rest,
        isPublished: status === "PUBLISHED",
      });
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

  const togglePageStatusMutation = useMutation({
    mutationFn: async ({ id, isPublished }: { id: string; isPublished: boolean }) => {
      return await apiRequest("PATCH", `/api/website/pages/${id}`, { isPublished });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
      toast({ title: "Page status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    }
  });

  const deletePageMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/website/pages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
      toast({ title: "Page deleted successfully" });
      setDeletePageId(null);
    },
    onError: (error: any) => {
      toast({ title: "Error deleting page", description: error.message, variant: "destructive" });
    }
  });

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

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
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
            {pages.map((page) => {
              const isHomePage = page.pageType === "HOME";
              const isCoreNavPage = ["HOME", "SERVICES", "ABOUT", "CONTACT"].includes(page.pageType);
              const pageIcon = page.pageType === "HOME" ? <Home className="h-5 w-5" />
                : page.pageType === "SERVICES" ? <Briefcase className="h-5 w-5" />
                : page.pageType === "ABOUT" ? <Info className="h-5 w-5" />
                : page.pageType === "CONTACT" ? <Phone className="h-5 w-5" />
                : <FileText className="h-5 w-5" />;
              return (
              <Card key={page.id} className="hover-elevate" data-testid={`card-page-${page.id}`}>
                <CardContent className="p-4 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded bg-muted flex-shrink-0">
                      {pageIcon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium truncate">{page.pageTitle}</h3>
                        {isHomePage && (
                          <Badge variant="outline" data-testid={`badge-front-page-${page.id}`}>
                            Front Page
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">/{page.pageSlug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={page.status === "PUBLISHED" ? "default" : "secondary"}
                      className={togglePageStatusMutation.isPending ? "opacity-50 pointer-events-none" : "cursor-pointer"}
                      onClick={() => togglePageStatusMutation.mutate({ id: page.id, isPublished: !page.isPublished })}
                      data-testid={`badge-page-status-${page.id}`}
                    >
                      {page.status === "PUBLISHED" ? <Check className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                      {page.status}
                    </Badge>
                    {page.aiGenerated && (
                      <Badge variant="outline">
                        <Sparkles className="h-3 w-3 mr-1" />
                        AI
                      </Badge>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onEditPageContent(page.id)} data-testid={`button-edit-content-${page.id}`}>
                      <FileText className="h-4 w-4 mr-1" />
                      Edit Content
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleEditPage(page)} data-testid={`button-edit-page-${page.id}`}>
                      <Edit />
                    </Button>
                    {!isCoreNavPage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setDeletePageId(page.id); setDeletePageTitle(page.pageTitle); }}
                        data-testid={`button-delete-page-${page.id}`}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

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

      <Dialog open={!!deletePageId} onOpenChange={(open) => { if (!open) setDeletePageId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Page</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletePageTitle}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePageId(null)} data-testid="button-cancel-delete-page">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deletePageId && deletePageMutation.mutate(deletePageId)}
              disabled={deletePageMutation.isPending}
              data-testid="button-confirm-delete-page"
            >
              {deletePageMutation.isPending ? <Loader2 className="animate-spin mr-1" /> : <Trash2 className="mr-1" />}
              Delete Page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
