import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "wouter";
import { useState, useEffect, useCallback } from "react";
import WebsitePreviewRenderer from "@/components/website-preview-renderer";
import { Eye } from "lucide-react";

function useDocumentHead(data: any, activePage: string | null, isStaging: boolean) {
  useEffect(() => {
    if (!data || isStaging) return;

    const website = data.website;
    const pages = data.pages || [];
    const subdomain = website?.subdomain;
    const baseUrl = subdomain ? `https://${subdomain}.smartmanageai-sites.com` : "";

    const currentSlug = activePage || "home";
    const currentPage = pages.find((p: any) => (p.pageSlug || p.page_slug) === currentSlug);

    const siteTitle = website?.siteTitle || website?.defaultMetaTitle || data.organization?.name || "";
    const pageTitle = currentPage?.metaTitle || currentPage?.meta_title || currentPage?.pageTitle || currentPage?.page_title || "";
    const fullTitle = pageTitle ? `${pageTitle} | ${siteTitle}` : siteTitle;

    const description = currentPage?.metaDescription || currentPage?.meta_description || website?.defaultMetaDescription || "";
    const ogImage = currentPage?.ogImageUrl || currentPage?.og_image_url || website?.ogImageUrl || website?.og_image_url || website?.logoUrl || "";
    const canonicalUrl = currentPage?.canonicalUrl || currentPage?.canonical_url || "";
    const noIndex = currentPage?.noIndex ?? currentPage?.no_index ?? false;

    const pageUrl = baseUrl ? `${baseUrl}/${currentSlug === "home" ? "" : currentSlug}` : "";

    document.title = fullTitle;

    const setMeta = (attr: string, key: string, content: string) => {
      if (!content) return;
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    if (description) setMeta("name", "description", description);

    setMeta("property", "og:title", fullTitle);
    if (description) setMeta("property", "og:description", description);
    setMeta("property", "og:type", "website");
    if (pageUrl) setMeta("property", "og:url", pageUrl);
    if (ogImage) setMeta("property", "og:image", ogImage);

    setMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", fullTitle);
    if (description) setMeta("name", "twitter:description", description);
    if (ogImage) setMeta("name", "twitter:image", ogImage);

    if (noIndex) {
      setMeta("name", "robots", "noindex, nofollow");
    } else {
      const robotsEl = document.querySelector('meta[name="robots"]');
      if (robotsEl) robotsEl.remove();
    }

    let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonicalUrl) {
      if (!canonicalEl) {
        canonicalEl = document.createElement("link");
        canonicalEl.setAttribute("rel", "canonical");
        document.head.appendChild(canonicalEl);
      }
      canonicalEl.setAttribute("href", canonicalUrl);
    } else if (pageUrl) {
      if (!canonicalEl) {
        canonicalEl = document.createElement("link");
        canonicalEl.setAttribute("rel", "canonical");
        document.head.appendChild(canonicalEl);
      }
      canonicalEl.setAttribute("href", pageUrl);
    }

    return () => {
      document.title = "SmartManageAI";
      const tagsToClean = [
        'meta[property="og:title"]', 'meta[property="og:description"]',
        'meta[property="og:type"]', 'meta[property="og:url"]', 'meta[property="og:image"]',
        'meta[name="twitter:card"]', 'meta[name="twitter:title"]',
        'meta[name="twitter:description"]', 'meta[name="twitter:image"]',
        'meta[name="robots"]', 'link[rel="canonical"]',
      ];
      tagsToClean.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.remove();
      });
    };
  }, [data, activePage, isStaging]);
}

export default function PublicWebsite({ isStaging = false }: { isStaging?: boolean }) {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const token = searchParams.get("token");
  const [activePage, setActivePage] = useState<string | null>(null);

  const apiUrl = isStaging
    ? `/api/website/staging/${subdomain}?token=${encodeURIComponent(token || "")}`
    : `/api/website/public/${subdomain}`;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: isStaging ? ["/api/website/staging", subdomain, token] : ["/api/website/public", subdomain],
    queryFn: async () => {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Website not found");
      }
      return response.json();
    },
    enabled: !!subdomain && (!isStaging || !!token),
  });

  useDocumentHead(data, activePage, isStaging);

  const handlePageChange = useCallback((slug: string) => {
    setActivePage(slug);
  }, []);

  if (isStaging && !token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" data-testid="error-staging-no-token">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Invalid Staging Link</h1>
          <p className="text-gray-600">This staging preview link is missing the access token.</p>
        </div>
      </div>
    );
  }

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
          <p className="text-gray-600">
            {isStaging
              ? "This staging link is invalid or has expired. Please request a new link from your administrator."
              : "The website you're looking for doesn't exist or hasn't been published yet."}
          </p>
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
      metaTitle: p.metaTitle || p.meta_title || null,
      canonicalUrl: p.canonicalUrl || p.canonical_url || null,
      noIndex: p.noIndex ?? p.no_index ?? false,
      ogImageUrl: p.ogImageUrl || p.og_image_url || null,
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
      {isStaging && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white text-center py-1.5 px-4 text-sm font-medium shadow-md flex items-center justify-center gap-2" data-testid="staging-banner">
          <Eye className="h-4 w-4" />
          <span>Staging Preview — This is a draft version and may not reflect the published site</span>
        </div>
      )}
      <div style={isStaging ? { paddingTop: '36px' } : undefined}>
        <WebsitePreviewRenderer
          data={previewData}
          deviceType="desktop"
          websiteId={data.website.id}
          trackingEnabled={!isStaging}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  );
}
