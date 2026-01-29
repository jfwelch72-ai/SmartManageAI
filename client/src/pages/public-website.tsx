import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Phone, Mail, MapPin, Facebook, Twitter, Instagram, Linkedin, Youtube, Globe } from "lucide-react";

interface WebsiteData {
  website: {
    id: string;
    subdomain: string;
    siteTitle?: string;
    siteTagline?: string;
    missionStatement?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
    fontFamily?: string;
    logoUrl?: string;
    faviconUrl?: string;
    contactEmail?: string;
    contactPhone?: string;
    contactAddress?: string;
    blogEnabled?: boolean;
    galleryEnabled?: boolean;
    contactFormEnabled?: boolean;
    defaultMetaTitle?: string;
    defaultMetaDescription?: string;
    status: string;
  };
  organization: {
    name: string;
    tradeType?: string;
    region?: string;
    logoUrl?: string;
  } | null;
  pages: Array<{
    id: string;
    pageTitle: string;
    pageSlug: string;
    pageType: string;
    contentHtml?: string;
    showInNavigation?: boolean;
  }>;
  blogPosts: Array<{
    id: string;
    title: string;
    excerpt?: string;
    slug: string;
    cover_image_url?: string;
    published_at?: string;
    author_name?: string;
  }>;
  projects: Array<{
    id: string;
    title: string;
    short_description?: string;
    cover_image_url?: string;
    location?: string;
    completion_date?: string;
  }>;
  socialLinks?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
    website?: string;
  };
}

export default function PublicWebsite() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const { data, isLoading, error } = useQuery<WebsiteData>({
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading website...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">Website Not Found</h1>
          <p className="text-gray-600">The website you're looking for doesn't exist or hasn't been published yet.</p>
        </div>
      </div>
    );
  }

  const { website, organization, pages, blogPosts, projects, socialLinks } = data;
  const siteTitle = website.siteTitle || organization?.name || "Website";
  const primaryColor = website.primaryColor || "#f97316";
  const secondaryColor = website.secondaryColor || "#1e293b";
  const fontFamily = website.fontFamily || "Inter, sans-serif";
  const logoUrl = website.logoUrl || organization?.logoUrl;

  return (
    <div className="min-h-screen" style={{ fontFamily }}>
      <header 
        className="sticky top-0 z-50 shadow-sm"
        style={{ backgroundColor: secondaryColor }}
      >
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl && (
              <img 
                src={logoUrl} 
                alt={siteTitle} 
                className="h-10 w-auto"
              />
            )}
            <div>
              <h1 className="text-xl font-bold text-white">{siteTitle}</h1>
              {website.siteTagline && (
                <p className="text-sm text-gray-300">{website.siteTagline}</p>
              )}
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#home" className="text-gray-300 hover:text-white transition-colors">Home</a>
            {pages.filter(p => p.showInNavigation).map((page) => (
              <a 
                key={page.id}
                href={`#${page.pageSlug}`}
                className="text-gray-300 hover:text-white transition-colors"
              >
                {page.pageTitle}
              </a>
            ))}
            {website.blogEnabled && blogPosts.length > 0 && (
              <a href="#blog" className="text-gray-300 hover:text-white transition-colors">Blog</a>
            )}
            {website.galleryEnabled && projects.length > 0 && (
              <a href="#projects" className="text-gray-300 hover:text-white transition-colors">Projects</a>
            )}
            {website.contactFormEnabled && (
              <a href="#contact" className="text-gray-300 hover:text-white transition-colors">Contact</a>
            )}
          </nav>
        </div>
      </header>

      <section 
        id="home"
        className="py-20 bg-gradient-to-br from-gray-900 to-gray-800"
      >
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            {siteTitle}
          </h2>
          {website.siteTagline && (
            <p className="text-xl text-gray-300 mb-6">
              {website.siteTagline}
            </p>
          )}
          {website.missionStatement && (
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              {website.missionStatement}
            </p>
          )}
          {website.contactFormEnabled && (
            <a 
              href="#contact"
              className="inline-block mt-8 px-8 py-3 rounded-md text-white font-semibold transition-transform hover:scale-105"
              style={{ backgroundColor: primaryColor }}
            >
              Get in Touch
            </a>
          )}
        </div>
      </section>

      {pages.map((page) => (
        page.contentHtml && (
          <section key={page.id} id={page.pageSlug} className="py-16 bg-white even:bg-gray-50">
            <div className="max-w-4xl mx-auto px-4">
              <h2 
                className="text-3xl font-bold mb-8 text-center"
                style={{ color: secondaryColor }}
              >
                {page.pageTitle}
              </h2>
              <div 
                className="prose prose-lg max-w-none text-gray-600"
                dangerouslySetInnerHTML={{ __html: page.contentHtml }}
              />
            </div>
          </section>
        )
      ))}

      {website.galleryEnabled && projects.length > 0 && (
        <section id="projects" className="py-16 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4">
            <h2 
              className="text-3xl font-bold mb-8 text-center"
              style={{ color: secondaryColor }}
            >
              Our Projects
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <div key={project.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                  {project.cover_image_url && (
                    <img 
                      src={project.cover_image_url} 
                      alt={project.title}
                      className="w-full h-48 object-cover"
                    />
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold text-lg mb-2">{project.title}</h3>
                    {project.short_description && (
                      <p className="text-gray-600 text-sm mb-2">{project.short_description}</p>
                    )}
                    {project.location && (
                      <p className="text-gray-500 text-xs flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {project.location}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {website.blogEnabled && blogPosts.length > 0 && (
        <section id="blog" className="py-16 bg-white">
          <div className="max-w-6xl mx-auto px-4">
            <h2 
              className="text-3xl font-bold mb-8 text-center"
              style={{ color: secondaryColor }}
            >
              Latest Blog Posts
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {blogPosts.map((post) => (
                <div key={post.id} className="bg-gray-50 rounded-lg shadow-md overflow-hidden">
                  {post.cover_image_url && (
                    <img 
                      src={post.cover_image_url} 
                      alt={post.title}
                      className="w-full h-48 object-cover"
                    />
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold text-lg mb-2">{post.title}</h3>
                    {post.excerpt && (
                      <p className="text-gray-600 text-sm mb-2 line-clamp-3">{post.excerpt}</p>
                    )}
                    {post.author_name && (
                      <p className="text-gray-500 text-xs">By {post.author_name}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {website.contactFormEnabled && (
        <section id="contact" className="py-16" style={{ backgroundColor: secondaryColor }}>
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-8 text-white">Contact Us</h2>
            <div className="flex flex-wrap justify-center gap-8 text-gray-300">
              {website.contactPhone && (
                <a href={`tel:${website.contactPhone}`} className="flex items-center gap-2 hover:text-white">
                  <Phone className="w-5 h-5" /> {website.contactPhone}
                </a>
              )}
              {website.contactEmail && (
                <a href={`mailto:${website.contactEmail}`} className="flex items-center gap-2 hover:text-white">
                  <Mail className="w-5 h-5" /> {website.contactEmail}
                </a>
              )}
              {website.contactAddress && (
                <span className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" /> {website.contactAddress}
                </span>
              )}
            </div>
            {socialLinks && (
              <div className="flex justify-center gap-4 mt-8">
                {socialLinks.facebook && (
                  <a href={socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                    <Facebook className="w-6 h-6" />
                  </a>
                )}
                {socialLinks.twitter && (
                  <a href={socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                    <Twitter className="w-6 h-6" />
                  </a>
                )}
                {socialLinks.instagram && (
                  <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                    <Instagram className="w-6 h-6" />
                  </a>
                )}
                {socialLinks.linkedin && (
                  <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                    <Linkedin className="w-6 h-6" />
                  </a>
                )}
                {socialLinks.youtube && (
                  <a href={socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                    <Youtube className="w-6 h-6" />
                  </a>
                )}
                {socialLinks.website && (
                  <a href={socialLinks.website} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                    <Globe className="w-6 h-6" />
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="py-6 bg-gray-900 text-center">
        <p className="text-gray-400 text-sm">
          {new Date().getFullYear()} {siteTitle}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
