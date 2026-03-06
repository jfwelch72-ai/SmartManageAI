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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Edit,
  Image,
  X,
  Upload,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import type { GalleryProject } from "./types";

interface WebsiteGalleryTabProps {
  hasWebsite: boolean;
  canEdit: boolean;
}

export default function WebsiteGalleryTab({ hasWebsite, canEdit }: WebsiteGalleryTabProps) {
  const { toast } = useToast();

  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
  const [showEditProjectDialog, setShowEditProjectDialog] = useState(false);
  const [selectedProject, setSelectedProject] = useState<GalleryProject | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

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

  const { data: projects = [], isLoading: loadingProjects } = useQuery<GalleryProject[]>({
    queryKey: ["/api/website/projects"],
    enabled: canEdit && hasWebsite
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "Invalid file type", description: "Please select an image file", variant: "destructive" });
      return;
    }

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

  return (
    <>
      <div className="space-y-4">
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
      </div>

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
    </>
  );
}
