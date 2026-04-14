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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Edit,
  BookOpen,
  Sparkles,
  RefreshCw,
  Save,
  Wand2,
  Loader2,
} from "lucide-react";
import { ImageUploadField } from "@/components/website-body-components";
import { format } from "date-fns";
import type { BlogPost } from "./types";

interface WebsiteBlogTabProps {
  hasWebsite: boolean;
  canEdit: boolean;
  isMobile: boolean;
}

export default function WebsiteBlogTab({ hasWebsite, canEdit, isMobile }: WebsiteBlogTabProps) {
  const { toast } = useToast();

  const [showCreateBlogDialog, setShowCreateBlogDialog] = useState(false);
  const [showEditBlogDialog, setShowEditBlogDialog] = useState(false);
  const [showGenerateBlogDialog, setShowGenerateBlogDialog] = useState(false);
  const [selectedBlogPost, setSelectedBlogPost] = useState<BlogPost | null>(null);
  const [generatedBlogContent, setGeneratedBlogContent] = useState<any>(null);
  const [generatingBlogImage, setGeneratingBlogImage] = useState(false);

  const [blogForm, setBlogForm] = useState({
    title: "",
    excerpt: "",
    content: "",
    category: "",
    coverImageUrl: "",
    status: "DRAFT"
  });

  const [editBlogForm, setEditBlogForm] = useState({
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

  const { data: blogPosts = [], isLoading: loadingBlog } = useQuery<BlogPost[]>({
    queryKey: ["/api/website/blog/posts"],
    enabled: canEdit && hasWebsite
  });

  const createBlogMutation = useMutation({
    mutationFn: async (data: typeof blogForm) => {
      return await apiRequest("POST", "/api/website/blog/posts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/blog/posts"] });
      toast({ title: "Blog post created successfully" });
      setShowCreateBlogDialog(false);
      setBlogForm({ title: "", excerpt: "", content: "", category: "", coverImageUrl: "", status: "DRAFT" });
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

  const handleUseGeneratedBlog = () => {
    if (generatedBlogContent) {
      setBlogForm({
        title: generatedBlogContent.title || "",
        excerpt: generatedBlogContent.excerpt || "",
        content: generatedBlogContent.content || "",
        category: generatedBlogContent.suggestedCategory || "",
        coverImageUrl: generatedBlogContent.coverImageUrl || "",
        status: "DRAFT"
      });
      setShowGenerateBlogDialog(false);
      setShowCreateBlogDialog(true);
    }
  };

  return (
    <>
      <div className="space-y-4">
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
        ) : isMobile ? (
          <div className="space-y-3">
            {blogPosts.map((post) => {
              const p = post as any;
              const createdAt = post.createdAt || p.created_at;
              const viewCount = post.viewCount ?? p.view_count ?? 0;
              const aiGenerated = post.aiGenerated || p.ai_generated;
              return (
                <Card key={post.id} data-testid={`card-blog-${post.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="font-medium text-sm">{post.title}</span>
                        {aiGenerated && (
                          <Badge variant="outline" className="text-xs">
                            <Sparkles className="h-3 w-3 mr-1" />
                            AI
                          </Badge>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleEditBlog(post)} data-testid={`button-edit-blog-${post.id}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={post.status === "PUBLISHED" ? "default" : post.status === "ARCHIVED" ? "secondary" : "outline"}>
                        {post.status}
                      </Badge>
                      {post.category && (
                        <span className="text-xs text-muted-foreground">{post.category}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{viewCount} views</span>
                      <span>{createdAt ? format(new Date(createdAt), "MMM d, yyyy") : "-"}</span>
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
      </div>

      <Dialog open={showCreateBlogDialog} onOpenChange={setShowCreateBlogDialog}>
        <DialogContent className="sm:max-w-2xl">
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
              <Label>Featured Image</Label>
              <ImageUploadField
                value={blogForm.coverImageUrl}
                onChange={(url) => setBlogForm(prev => ({ ...prev, coverImageUrl: url }))}
                label=""
                placeholder="Image URL or upload..."
                testId="input-blog-cover-image"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!blogForm.title) {
                    toast({ title: "Enter a title first", description: "The AI needs a title to generate a relevant image.", variant: "destructive" });
                    return;
                  }
                  setGeneratingBlogImage(true);
                  try {
                    const res = await apiRequest("POST", "/api/website/blog/generate-image", { title: blogForm.title, category: blogForm.category });
                    const data = await res.json();
                    if (data.imageUrl) {
                      setBlogForm(prev => ({ ...prev, coverImageUrl: data.imageUrl }));
                      toast({ title: "Image generated successfully" });
                    }
                  } catch (err: any) {
                    toast({ title: "Failed to generate image", description: err.message, variant: "destructive" });
                  } finally {
                    setGeneratingBlogImage(false);
                  }
                }}
                disabled={generatingBlogImage || !blogForm.title}
                data-testid="button-ai-generate-blog-image"
              >
                {generatingBlogImage ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wand2 className="h-4 w-4 mr-1" />}
                {generatingBlogImage ? "Generating..." : "AI Generate Image"}
              </Button>
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
    </>
  );
}
