import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import WebsitePreviewRenderer from "@/components/website-preview-renderer";

export default function PublicWebsite() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/website/public", subdomain],
    queryFn: async () => {
      const response = await fetch(`/api/website/public/${subdomain}`);
      if (!response.ok) {
        throw new Error("Website not found");
      }
      return response.json();
    },
    enabled: !!subdomain,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" data-testid="loading-public-website">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading website...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" data-testid="error-public-website">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">Website Not Found</h1>
          <p className="text-gray-600">The website you're looking for doesn't exist or hasn't been published yet.</p>
        </div>
      </div>
    );
  }

  const previewData = {
    website: {
      siteTitle: data.website.siteTitle || null,
      siteTagline: data.website.siteTagline || null,
      missionStatement: data.website.missionStatement || null,
      primaryColor: data.website.primaryColor || null,
      secondaryColor: data.website.secondaryColor || null,
      accentColor: data.website.accentColor || null,
      backgroundColor: data.website.backgroundColor || null,
      textColor: data.website.textColor || null,
      fontFamily: data.website.fontFamily || null,
      logoUrl: data.website.logoUrl || null,
      logoHeight: data.website.logoHeight || null,
      contactEmail: data.website.contactEmail || null,
      contactPhone: data.website.contactPhone || null,
      contactAddress: data.website.contactAddress || null,
      blogEnabled: data.website.blogEnabled ?? null,
      galleryEnabled: data.website.galleryEnabled ?? null,
      mobileNavStyle: data.website.mobileNavStyle || null,
    },
    organization: data.organization || null,
    pages: (data.pages || []).map((p: any) => ({
      id: p.id,
      pageTitle: p.pageTitle || p.page_title || "",
      pageSlug: p.pageSlug || p.page_slug || "",
      pageType: p.pageType || p.page_type || "custom",
      navigationLabel: p.navigationLabel || p.navigation_label || p.pageTitle || p.page_title || null,
      navigationOrder: p.navigationOrder ?? p.navigation_order ?? 0,
      metaDescription: p.metaDescription || p.meta_description || null,
      content: p.content || p.contentHtml || p.content_html || null,
      contentJson: p.contentJson || p.content_json || null,
      parentPageId: p.parentPageId || p.parent_page_id || null,
      isPublished: p.isPublished ?? p.is_published ?? true,
      showInNavigation: p.showInNavigation ?? p.show_in_navigation ?? true,
    })),
    blogPosts: (data.blogPosts || []).map((bp: any) => ({
      id: bp.id,
      title: bp.title || "",
      slug: bp.slug || "",
      excerpt: bp.excerpt || null,
      coverImageUrl: bp.coverImageUrl || bp.cover_image_url || null,
      cover_image_url: bp.cover_image_url || bp.coverImageUrl || null,
      authorName: bp.authorName || bp.author_name || null,
      author_name: bp.author_name || bp.authorName || null,
      publishedAt: bp.publishedAt || bp.published_at || null,
      published_at: bp.published_at || bp.publishedAt || null,
      content: bp.content || null,
      content_html: bp.content_html || bp.contentHtml || null,
      category: bp.category || null,
      tags: bp.tags || null,
      featured_post: bp.featured_post || bp.featuredPost || null,
      featuredPost: bp.featuredPost || bp.featured_post || null,
      view_count: bp.view_count || bp.viewCount || null,
      viewCount: bp.viewCount || bp.view_count || null,
    })),
    projects: (data.projects || []).map((pr: any) => ({
      id: pr.id,
      title: pr.title || "",
      shortDescription: pr.shortDescription || pr.short_description || null,
      short_description: pr.short_description || pr.shortDescription || null,
      fullDescription: pr.fullDescription || pr.full_description || null,
      full_description: pr.full_description || pr.fullDescription || null,
      coverImageUrl: pr.coverImageUrl || pr.cover_image_url || null,
      cover_image_url: pr.cover_image_url || pr.coverImageUrl || null,
      projectType: pr.projectType || pr.project_type || null,
      project_type: pr.project_type || pr.projectType || null,
      location: pr.location || null,
      completionDate: pr.completionDate || pr.completion_date || null,
      completion_date: pr.completion_date || pr.completionDate || null,
    })),
    socialLinks: data.socialLinks ? {
      facebookUrl: data.socialLinks.facebookUrl || data.socialLinks.facebook_url || null,
      instagramUrl: data.socialLinks.instagramUrl || data.socialLinks.instagram_url || null,
      linkedinUrl: data.socialLinks.linkedinUrl || data.socialLinks.linkedin_url || null,
      youtubeUrl: data.socialLinks.youtubeUrl || data.socialLinks.youtube_url || null,
      tiktokUrl: data.socialLinks.tiktokUrl || data.socialLinks.tiktok_url || null,
    } : null,
    headerConfig: data.headerConfig || null,
    footerConfig: data.footerConfig || null,
    bodyConfig: data.bodyConfig || null,
    headerLayoutSettings: data.headerLayoutSettings || null,
    footerLayoutSettings: data.footerLayoutSettings || null,
  };

  return (
    <div className="min-h-screen" data-testid="public-website-container">
      <WebsitePreviewRenderer
        data={previewData}
        deviceType="desktop"
        websiteId={data.website.id}
        trackingEnabled={true}
      />
    </div>
  );
}
