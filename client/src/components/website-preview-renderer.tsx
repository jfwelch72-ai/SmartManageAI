import { useState } from "react";
import { 
  Phone, 
  Mail, 
  MapPin, 
  Menu,
  ChevronRight,
  Star,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  X,
  Calendar,
  User,
  Send
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface PreviewData {
  website: {
    siteTitle: string | null;
    siteTagline: string | null;
    missionStatement: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    fontFamily: string | null;
    logoUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    blogEnabled: boolean | null;
    galleryEnabled: boolean | null;
  };
  organization: {
    name: string;
    tradeType: string | null;
    region: string | null;
    logoUrl: string | null;
  } | null;
  pages: Array<{
    id: string;
    pageTitle: string;
    pageSlug: string;
    pageType?: string;
    navigationLabel: string | null;
    navigationOrder: number;
    metaDescription?: string | null;
    content?: string | null;
  }>;
  blogPosts: Array<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    coverImageUrl: string | null;
    cover_image_url?: string | null;
    author_name?: string | null;
    authorName?: string | null;
    published_at?: string | null;
    publishedAt?: string | null;
    content?: string | null;
    content_html?: string | null;
  }>;
  projects: Array<{
    id: string;
    title: string;
    shortDescription: string | null;
    short_description?: string | null;
    fullDescription?: string | null;
    full_description?: string | null;
    coverImageUrl: string | null;
    cover_image_url?: string | null;
    projectType: string | null;
    project_type?: string | null;
    location?: string | null;
    completion_date?: string | null;
    completionDate?: string | null;
  }>;
  socialLinks: {
    facebookUrl: string | null;
    instagramUrl: string | null;
    linkedinUrl: string | null;
    youtubeUrl: string | null;
    tiktokUrl: string | null;
  } | null;
}

type PageView = "home" | "about" | "services" | "blog" | "gallery" | "contact" | "blog-post" | "project-detail" | string;

interface WebsitePreviewRendererProps {
  data: PreviewData;
  deviceType: "desktop" | "tablet" | "mobile";
}

export default function WebsitePreviewRenderer({ data, deviceType }: WebsitePreviewRendererProps) {
  const { website, organization, socialLinks } = data;
  // Default to empty arrays to prevent crashes when data is undefined
  const pages = data.pages || [];
  const blogPosts = data.blogPosts || [];
  const projects = data.projects || [];
  
  // State for interactive navigation
  const [currentPage, setCurrentPage] = useState<PageView>("home");
  const [selectedBlogPost, setSelectedBlogPost] = useState<typeof blogPosts[0] | null>(null);
  const [selectedProject, setSelectedProject] = useState<typeof projects[0] | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contactFormSubmitted, setContactFormSubmitted] = useState(false);
  
  const siteName = website.siteTitle || organization?.name || "Your Company";
  const tagline = website.siteTagline || "Building Excellence";
  const primaryColor = website.primaryColor || "#3B82F6";
  const secondaryColor = website.secondaryColor || "#1E40AF";
  const accentColor = website.accentColor || "#F59E0B";
  const bgColor = website.backgroundColor || "#FFFFFF";
  const textColor = website.textColor || "#1F2937";
  const fontFamily = website.fontFamily || "Inter, system-ui, sans-serif";

  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  // Navigation handler
  const navigateTo = (page: PageView) => {
    setCurrentPage(page);
    setSelectedBlogPost(null);
    setSelectedProject(null);
    setMobileMenuOpen(false);
    setContactFormSubmitted(false);
  };

  // Helper to find custom page content
  const findPageContent = (slug: string) => {
    return pages.find(p => 
      p.pageSlug?.toLowerCase() === slug.toLowerCase() ||
      p.pageType?.toLowerCase() === slug.toLowerCase()
    );
  };

  // Get nav items - combine default pages with custom pages from database
  const getNavItems = () => {
    const items: { id: string; label: string; slug: string; isCustom?: boolean }[] = [
      { id: "home", label: "Home", slug: "home" },
    ];
    
    // Add custom pages from database in their navigation order
    const customPages = pages
      .filter(p => p.pageSlug && !["home", "blog", "gallery", "contact"].includes(p.pageSlug.toLowerCase()))
      .sort((a, b) => (a.navigationOrder || 0) - (b.navigationOrder || 0));
    
    // Add About and Services if they exist in pages, otherwise use defaults
    const hasAbout = pages.some(p => p.pageSlug?.toLowerCase() === "about" || p.pageType?.toLowerCase() === "about");
    const hasServices = pages.some(p => p.pageSlug?.toLowerCase() === "services" || p.pageType?.toLowerCase() === "services");
    
    items.push({ id: "about", label: "About", slug: "about" });
    items.push({ id: "services", label: "Services", slug: "services" });
    
    // Add other custom pages
    customPages.forEach(page => {
      if (!["about", "services"].includes(page.pageSlug?.toLowerCase() || "")) {
        items.push({
          id: page.id,
          label: page.navigationLabel || page.pageTitle,
          slug: `custom-${page.id}`,
          isCustom: true
        });
      }
    });
    
    if (website.galleryEnabled !== false && projects.length > 0) {
      items.push({ id: "gallery", label: "Gallery", slug: "gallery" });
    }
    if (website.blogEnabled !== false && blogPosts.length > 0) {
      items.push({ id: "blog", label: "Blog", slug: "blog" });
    }
    items.push({ id: "contact", label: "Contact", slug: "contact" });
    
    return items;
  };

  const navItems = getNavItems();

  // Render navigation header (shared across all pages)
  const renderHeader = () => (
    <header 
      className="sticky top-0 z-50 shadow-sm"
      style={{ backgroundColor: bgColor, borderBottom: `1px solid ${primaryColor}20` }}
    >
      <div className={`mx-auto px-4 ${isMobile ? 'py-3' : 'py-4'}`} style={{ maxWidth: '1200px' }}>
        <div className="flex items-center justify-between">
          {/* Logo / Site Name */}
          <button 
            onClick={() => navigateTo("home")}
            className="flex items-center gap-3 cursor-pointer"
            data-testid="preview-logo"
          >
            {website.logoUrl || organization?.logoUrl ? (
              <img 
                src={website.logoUrl || organization?.logoUrl || ''} 
                alt={siteName}
                className={`${isMobile ? 'h-8' : 'h-10'} object-contain`}
              />
            ) : (
              <div 
                className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold`}
                style={{ color: primaryColor }}
              >
                {siteName}
              </div>
            )}
          </button>

          {/* Navigation */}
          {isMobile ? (
            <>
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded"
                style={{ backgroundColor: `${primaryColor}10` }}
                data-testid="preview-mobile-menu-toggle"
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" style={{ color: primaryColor }} />
                ) : (
                  <Menu className="h-5 w-5" style={{ color: primaryColor }} />
                )}
              </button>
              
              {/* Mobile menu dropdown */}
              {mobileMenuOpen && (
                <div 
                  className="absolute top-full left-0 right-0 shadow-lg py-2 z-50"
                  style={{ backgroundColor: bgColor }}
                >
                  {navItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => navigateTo(item.slug as PageView)}
                      className="w-full text-left px-4 py-3 hover:opacity-80"
                      style={{ 
                        color: currentPage === item.slug ? primaryColor : textColor,
                        backgroundColor: currentPage === item.slug ? `${primaryColor}10` : 'transparent'
                      }}
                      data-testid={`preview-nav-mobile-${item.slug}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <nav className="flex items-center gap-6">
              {navItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => navigateTo(item.slug as PageView)}
                  className="font-medium hover:opacity-80 cursor-pointer transition-opacity"
                  style={{ 
                    color: currentPage === item.slug ? primaryColor : textColor,
                    borderBottom: currentPage === item.slug ? `2px solid ${primaryColor}` : '2px solid transparent'
                  }}
                  data-testid={`preview-nav-${item.slug}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>
    </header>
  );

  // Render footer (shared across all pages)
  const renderFooter = () => (
    <footer 
      className={`${isMobile ? 'py-8' : 'py-16'}`}
      style={{ backgroundColor: secondaryColor, color: 'white' }}
    >
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-8' : 'grid-cols-4 gap-8'}`}>
          {/* Company Info */}
          <div className={isMobile ? 'text-center' : ''}>
            <h3 className="font-bold text-lg mb-4">{siteName}</h3>
            <p className="text-sm opacity-80 mb-4">{tagline}</p>
            {website.missionStatement && (
              <p className="text-sm opacity-70">{website.missionStatement}</p>
            )}
          </div>

          {/* Quick Links */}
          <div className={isMobile ? 'text-center' : ''}>
            <h4 className="font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm opacity-80">
              {navItems.map(item => (
                <li key={item.id}>
                  <button 
                    onClick={() => navigateTo(item.slug as PageView)}
                    className="hover:opacity-100 cursor-pointer"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div className={isMobile ? 'text-center' : ''}>
            <h4 className="font-semibold mb-4">Contact Us</h4>
            <ul className="space-y-3 text-sm opacity-80">
              {website.contactPhone && (
                <li className={`flex items-center gap-2 ${isMobile ? 'justify-center' : ''}`}>
                  <Phone className="h-4 w-4" />
                  {website.contactPhone}
                </li>
              )}
              {website.contactEmail && (
                <li className={`flex items-center gap-2 ${isMobile ? 'justify-center' : ''}`}>
                  <Mail className="h-4 w-4" />
                  {website.contactEmail}
                </li>
              )}
              {website.contactAddress && (
                <li className={`flex items-center gap-2 ${isMobile ? 'justify-center' : ''}`}>
                  <MapPin className="h-4 w-4" />
                  {website.contactAddress}
                </li>
              )}
            </ul>
          </div>

          {/* Social Links */}
          <div className={isMobile ? 'text-center' : ''}>
            <h4 className="font-semibold mb-4">Follow Us</h4>
            <div className={`flex gap-3 ${isMobile ? 'justify-center' : ''}`}>
              {socialLinks?.facebookUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiFacebook className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.instagramUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiInstagram className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.linkedinUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiLinkedin className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.youtubeUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiYoutube className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.tiktokUrl && (
                <span className="p-2 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
                  <SiTiktok className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>
        </div>

        <div 
          className="mt-8 pt-8 text-center text-sm opacity-60"
          style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }}
        >
          © {new Date().getFullYear()} {siteName}. All rights reserved.
        </div>
      </div>
    </footer>
  );

  // HOME PAGE
  const renderHomePage = () => (
    <>
      {/* Hero Section */}
      <section 
        className="relative"
        style={{ 
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
          minHeight: isMobile ? '300px' : '500px',
        }}
      >
        <div 
          className={`mx-auto px-4 ${isMobile ? 'py-12' : 'py-24'} text-center text-white`}
          style={{ maxWidth: '1200px' }}
        >
          <h1 className={`${isMobile ? 'text-2xl' : isTablet ? 'text-3xl' : 'text-5xl'} font-bold mb-4`}>
            {siteName}
          </h1>
          <p className={`${isMobile ? 'text-base' : 'text-xl'} opacity-90 mb-8 max-w-2xl mx-auto`}>
            {tagline}
          </p>
          <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} gap-4 justify-center`}>
            <button 
              onClick={() => navigateTo("contact")}
              className={`${isMobile ? 'w-full' : ''} px-6 py-3 rounded font-medium text-white flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
              style={{ backgroundColor: accentColor }}
              data-testid="preview-cta-quote"
            >
              Get a Free Quote
              <ArrowRight className="h-4 w-4" />
            </button>
            <button 
              onClick={() => navigateTo("gallery")}
              className={`${isMobile ? 'w-full' : ''} px-6 py-3 rounded font-medium border-2 border-white text-white cursor-pointer hover:bg-white/10 transition-colors`}
              data-testid="preview-cta-work"
            >
              View Our Work
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h2 
            className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-center mb-12`}
            style={{ color: textColor }}
          >
            Why Choose Us
          </h2>
          <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-8`}>
            {[
              { title: "Quality Craftsmanship", desc: "We take pride in delivering exceptional work on every project." },
              { title: "On-Time Delivery", desc: "Your project completed on schedule, every time." },
              { title: "Licensed & Insured", desc: "Full protection for your peace of mind." },
            ].map((feature, idx) => (
              <div 
                key={idx}
                className="p-6 rounded-lg text-center"
                style={{ backgroundColor: `${primaryColor}08`, border: `1px solid ${primaryColor}15` }}
              >
                <div 
                  className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <CheckCircle className="h-6 w-6" style={{ color: primaryColor }} />
                </div>
                <h3 className="font-semibold mb-2" style={{ color: textColor }}>{feature.title}</h3>
                <p className="text-sm opacity-70">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Projects Preview */}
      {website.galleryEnabled !== false && projects.length > 0 && (
        <section 
          className={`${isMobile ? 'py-12' : 'py-20'}`}
          style={{ backgroundColor: `${primaryColor}05` }}
        >
          <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
            <h2 
              className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-center mb-12`}
              style={{ color: textColor }}
            >
              Our Recent Projects
            </h2>
            <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
              {projects.slice(0, 3).map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    setSelectedProject(project);
                    setCurrentPage("project-detail");
                  }}
                  className="rounded-lg overflow-hidden shadow-sm text-left cursor-pointer hover:shadow-md transition-shadow"
                  style={{ backgroundColor: bgColor }}
                  data-testid={`preview-project-${project.id}`}
                >
                  <div 
                    className="h-48 bg-gray-200"
                    style={{ 
                      backgroundImage: (project.coverImageUrl || project.cover_image_url) ? `url(${project.coverImageUrl || project.cover_image_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="p-4">
                    <span 
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                    >
                      {project.projectType || project.project_type || "Project"}
                    </span>
                    <h3 className="font-semibold mt-2" style={{ color: textColor }}>{project.title}</h3>
                    <p className="text-sm opacity-70 mt-1 line-clamp-2">{project.shortDescription || project.short_description}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="text-center mt-8">
              <button
                onClick={() => navigateTo("gallery")}
                className="px-6 py-2 rounded font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: primaryColor, color: 'white' }}
                data-testid="preview-view-all-projects"
              >
                View All Projects
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Blog Preview */}
      {website.blogEnabled !== false && blogPosts.length > 0 && (
        <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
          <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
            <h2 
              className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-center mb-12`}
              style={{ color: textColor }}
            >
              Latest from Our Blog
            </h2>
            <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
              {blogPosts.slice(0, 3).map((post) => (
                <button
                  key={post.id}
                  onClick={() => {
                    setSelectedBlogPost(post);
                    setCurrentPage("blog-post");
                  }}
                  className="rounded-lg overflow-hidden text-left cursor-pointer hover:shadow-md transition-shadow"
                  style={{ border: `1px solid ${primaryColor}15` }}
                  data-testid={`preview-blog-${post.id}`}
                >
                  <div 
                    className="h-40 bg-gray-200"
                    style={{ 
                      backgroundImage: (post.coverImageUrl || post.cover_image_url) ? `url(${post.coverImageUrl || post.cover_image_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="p-4">
                    <h3 className="font-semibold" style={{ color: textColor }}>{post.title}</h3>
                    <p className="text-sm opacity-70 mt-2 line-clamp-2">{post.excerpt}</p>
                    <span 
                      className="text-sm font-medium mt-3 inline-flex items-center gap-1"
                      style={{ color: primaryColor }}
                    >
                      Read More <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="text-center mt-8">
              <button
                onClick={() => navigateTo("blog")}
                className="px-6 py-2 rounded font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: primaryColor, color: 'white' }}
                data-testid="preview-view-all-blog"
              >
                View All Posts
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Testimonial */}
      <section 
        className={`${isMobile ? 'py-12' : 'py-20'}`}
        style={{ backgroundColor: `${secondaryColor}10` }}
      >
        <div className="mx-auto px-4 text-center" style={{ maxWidth: '800px' }}>
          <div className="flex justify-center gap-1 mb-4">
            {[1,2,3,4,5].map(i => (
              <Star key={i} className="h-5 w-5 fill-current" style={{ color: accentColor }} />
            ))}
          </div>
          <blockquote className={`${isMobile ? 'text-lg' : 'text-2xl'} italic mb-4`} style={{ color: textColor }}>
            "{siteName} exceeded our expectations. Professional, reliable, and the quality of work was outstanding."
          </blockquote>
          <p className="font-medium" style={{ color: primaryColor }}>— Happy Customer</p>
        </div>
      </section>

      {/* CTA */}
      <section 
        className={`${isMobile ? 'py-12' : 'py-20'}`}
        style={{ 
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
        }}
      >
        <div className="mx-auto px-4 text-center text-white" style={{ maxWidth: '800px' }}>
          <h2 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold mb-4`}>
            Ready to Start Your Project?
          </h2>
          <p className="mb-8 opacity-90">
            Contact us today for a free consultation and estimate.
          </p>
          <button 
            onClick={() => navigateTo("contact")}
            className="px-8 py-3 rounded font-medium cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: accentColor, color: 'white' }}
            data-testid="preview-footer-cta"
          >
            Get Your Free Quote
          </button>
        </div>
      </section>
    </>
  );

  // ABOUT PAGE
  // Render custom page from database content
  const renderCustomPage = (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return renderHomePage();
    
    return (
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-8`}
            style={{ color: textColor }}
          >
            {page.pageTitle}
          </h1>
          
          {page.metaDescription && (
            <p className="text-lg mb-6 opacity-80 max-w-3xl">
              {page.metaDescription}
            </p>
          )}
          
          {page.content && (
            <div className="prose max-w-none">
              <p className="leading-relaxed opacity-80 whitespace-pre-wrap">{page.content}</p>
            </div>
          )}
          
          {!page.content && !page.metaDescription && (
            <div 
              className="text-center py-12 rounded-lg"
              style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}
            >
              <p className="opacity-60">Page content will appear here once added.</p>
            </div>
          )}
          
          <div className="mt-12">
            <button
              onClick={() => navigateTo("contact")}
              className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
              style={{ backgroundColor: primaryColor }}
            >
              Contact Us
            </button>
          </div>
        </div>
      </section>
    );
  };

  // ABOUT PAGE
  const renderAboutPage = () => {
    // Check if there's custom about page content
    const customAbout = findPageContent("about");
    const aboutContent = customAbout?.content || customAbout?.metaDescription;
    
    return (
      <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-8`}
            style={{ color: textColor }}
          >
            {customAbout?.pageTitle || `About ${siteName}`}
          </h1>
          
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-12`}>
            <div>
              <p className="text-lg mb-6 opacity-80">
                {aboutContent || website.missionStatement || `${siteName} is a trusted name in the construction industry, committed to delivering exceptional quality and service to our clients.`}
              </p>
              {!aboutContent && (
                <>
                  <p className="mb-6 opacity-70">
                    With years of experience and a dedicated team of professionals, we take pride in every project we undertake. Our commitment to excellence, safety, and customer satisfaction sets us apart.
                  </p>
                  <p className="mb-6 opacity-70">
                    Whether it's a residential renovation or a commercial build, we bring the same level of dedication and expertise to every job.
                  </p>
                </>
              )}
              <button
                onClick={() => navigateTo("contact")}
                className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
                style={{ backgroundColor: primaryColor }}
              >
                Contact Us Today
              </button>
            </div>
            
            <div 
              className="rounded-lg p-8"
              style={{ backgroundColor: `${primaryColor}08`, border: `1px solid ${primaryColor}15` }}
            >
              <h3 className="text-xl font-semibold mb-6" style={{ color: primaryColor }}>Our Values</h3>
              <ul className="space-y-4">
                {["Quality Workmanship", "Integrity & Honesty", "Safety First", "Customer Focus", "Innovation"].map((value, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 flex-shrink-0" style={{ color: accentColor }} />
                    <span>{value}</span>
                  </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
    );
  };

  // SERVICES PAGE
  const renderServicesPage = () => (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4 text-center`}
          style={{ color: textColor }}
        >
          Our Services
        </h1>
        <p className="text-center mb-12 opacity-70 max-w-2xl mx-auto">
          We offer a comprehensive range of {organization?.tradeType?.toLowerCase() || 'construction'} services to meet your needs.
        </p>
        
        <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
          {[
            { title: "Residential Projects", desc: "From new builds to renovations, we create beautiful homes." },
            { title: "Commercial Work", desc: "Professional solutions for businesses of all sizes." },
            { title: "Renovations", desc: "Transform your existing space into something special." },
            { title: "Repairs & Maintenance", desc: "Keep your property in top condition." },
            { title: "Consultations", desc: "Expert advice for your next project." },
            { title: "Emergency Services", desc: "Available when you need us most." },
          ].map((service, idx) => (
            <div 
              key={idx}
              className="p-6 rounded-lg"
              style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}
            >
              <h3 className="font-semibold text-lg mb-2" style={{ color: textColor }}>{service.title}</h3>
              <p className="text-sm opacity-70 mb-4">{service.desc}</p>
              <button
                onClick={() => navigateTo("contact")}
                className="text-sm font-medium flex items-center gap-1 cursor-pointer"
                style={{ color: primaryColor }}
              >
                Get a Quote <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // BLOG PAGE
  const renderBlogPage = () => (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-8`}
          style={{ color: textColor }}
        >
          Our Blog
        </h1>
        
        {blogPosts.length > 0 ? (
          <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
            {blogPosts.map((post) => (
              <button
                key={post.id}
                onClick={() => {
                  setSelectedBlogPost(post);
                  setCurrentPage("blog-post");
                }}
                className="rounded-lg overflow-hidden text-left cursor-pointer hover:shadow-md transition-shadow"
                style={{ border: `1px solid ${primaryColor}15`, backgroundColor: bgColor }}
                data-testid={`preview-blog-card-${post.id}`}
              >
                <div 
                  className="h-48 bg-gray-200"
                  style={{ 
                    backgroundImage: (post.coverImageUrl || post.cover_image_url) ? `url(${post.coverImageUrl || post.cover_image_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs opacity-60 mb-2">
                    <User className="h-3 w-3" />
                    <span>{post.authorName || post.author_name || "Staff Writer"}</span>
                    {(post.publishedAt || post.published_at) && (
                      <>
                        <span>•</span>
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(post.publishedAt || post.published_at || '').toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: textColor }}>{post.title}</h3>
                  <p className="text-sm opacity-70 line-clamp-3">{post.excerpt}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 opacity-60">
            <p>No blog posts published yet.</p>
          </div>
        )}
      </div>
    </section>
  );

  // SINGLE BLOG POST
  const renderBlogPostDetail = () => {
    if (!selectedBlogPost) return null;
    
    return (
      <section className={`${isMobile ? 'py-8' : 'py-16'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '800px' }}>
          <button
            onClick={() => navigateTo("blog")}
            className="flex items-center gap-2 mb-6 cursor-pointer hover:opacity-80"
            style={{ color: primaryColor }}
            data-testid="preview-back-to-blog"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Blog
          </button>
          
          {(selectedBlogPost.coverImageUrl || selectedBlogPost.cover_image_url) && (
            <div 
              className="h-64 md:h-96 rounded-lg mb-8 bg-gray-200"
              style={{ 
                backgroundImage: `url(${selectedBlogPost.coverImageUrl || selectedBlogPost.cover_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          )}
          
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4`}
            style={{ color: textColor }}
          >
            {selectedBlogPost.title}
          </h1>
          
          <div className="flex items-center gap-4 text-sm opacity-60 mb-8">
            <span className="flex items-center gap-1">
              <User className="h-4 w-4" />
              {selectedBlogPost.authorName || selectedBlogPost.author_name || "Staff Writer"}
            </span>
            {(selectedBlogPost.publishedAt || selectedBlogPost.published_at) && (
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(selectedBlogPost.publishedAt || selectedBlogPost.published_at || '').toLocaleDateString()}
              </span>
            )}
          </div>
          
          <div className="prose max-w-none">
            {selectedBlogPost.content_html ? (
              <div dangerouslySetInnerHTML={{ __html: selectedBlogPost.content_html }} />
            ) : (
              <p className="text-lg leading-relaxed opacity-80">
                {selectedBlogPost.excerpt || "Full blog post content will appear here when published."}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  };

  // GALLERY PAGE
  const renderGalleryPage = () => (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4 text-center`}
          style={{ color: textColor }}
        >
          Project Gallery
        </h1>
        <p className="text-center mb-12 opacity-70 max-w-2xl mx-auto">
          Browse our portfolio of completed projects and see the quality of our work.
        </p>
        
        {projects.length > 0 ? (
          <div className={`grid ${isMobile ? 'grid-cols-1' : isTablet ? 'grid-cols-2' : 'grid-cols-3'} gap-6`}>
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setSelectedProject(project);
                  setCurrentPage("project-detail");
                }}
                className="rounded-lg overflow-hidden shadow-sm text-left cursor-pointer hover:shadow-md transition-shadow group"
                style={{ backgroundColor: bgColor }}
                data-testid={`preview-gallery-project-${project.id}`}
              >
                <div 
                  className="h-56 bg-gray-200 relative"
                  style={{ 
                    backgroundImage: (project.coverImageUrl || project.cover_image_url) ? `url(${project.coverImageUrl || project.cover_image_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 text-white font-medium transition-opacity">
                      View Project
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <span 
                    className="text-xs font-medium px-2 py-1 rounded"
                    style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                  >
                    {project.projectType || project.project_type || "Project"}
                  </span>
                  <h3 className="font-semibold mt-2" style={{ color: textColor }}>{project.title}</h3>
                  {project.location && (
                    <p className="text-sm opacity-60 mt-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {project.location}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 opacity-60">
            <p>No projects published yet.</p>
          </div>
        )}
      </div>
    </section>
  );

  // PROJECT DETAIL
  const renderProjectDetail = () => {
    if (!selectedProject) return null;
    
    return (
      <section className={`${isMobile ? 'py-8' : 'py-16'}`} style={{ backgroundColor: bgColor }}>
        <div className="mx-auto px-4" style={{ maxWidth: '1000px' }}>
          <button
            onClick={() => navigateTo("gallery")}
            className="flex items-center gap-2 mb-6 cursor-pointer hover:opacity-80"
            style={{ color: primaryColor }}
            data-testid="preview-back-to-gallery"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Gallery
          </button>
          
          {(selectedProject.coverImageUrl || selectedProject.cover_image_url) && (
            <div 
              className="h-64 md:h-[500px] rounded-lg mb-8 bg-gray-200"
              style={{ 
                backgroundImage: `url(${selectedProject.coverImageUrl || selectedProject.cover_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          )}
          
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span 
              className="text-sm font-medium px-3 py-1 rounded"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              {selectedProject.projectType || selectedProject.project_type || "Project"}
            </span>
            {selectedProject.location && (
              <span className="text-sm opacity-60 flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {selectedProject.location}
              </span>
            )}
            {(selectedProject.completionDate || selectedProject.completion_date) && (
              <span className="text-sm opacity-60 flex items-center gap-1">
                <Calendar className="h-4 w-4" /> 
                Completed {new Date(selectedProject.completionDate || selectedProject.completion_date || '').toLocaleDateString()}
              </span>
            )}
          </div>
          
          <h1 
            className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-6`}
            style={{ color: textColor }}
          >
            {selectedProject.title}
          </h1>
          
          <div className="prose max-w-none">
            <p className="text-lg leading-relaxed opacity-80 mb-6">
              {selectedProject.shortDescription || selectedProject.short_description}
            </p>
            {(selectedProject.fullDescription || selectedProject.full_description) && (
              <p className="leading-relaxed opacity-70">
                {selectedProject.fullDescription || selectedProject.full_description}
              </p>
            )}
          </div>
          
          <div className="mt-8 pt-8" style={{ borderTop: `1px solid ${primaryColor}15` }}>
            <h3 className="font-semibold mb-4" style={{ color: textColor }}>Interested in a similar project?</h3>
            <button
              onClick={() => navigateTo("contact")}
              className="px-6 py-3 rounded font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
              style={{ backgroundColor: primaryColor }}
            >
              Request a Quote
            </button>
          </div>
        </div>
      </section>
    );
  };

  // CONTACT PAGE
  const renderContactPage = () => (
    <section className={`${isMobile ? 'py-12' : 'py-20'}`} style={{ backgroundColor: bgColor }}>
      <div className="mx-auto px-4" style={{ maxWidth: '1200px' }}>
        <h1 
          className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-bold mb-4 text-center`}
          style={{ color: textColor }}
        >
          Contact Us
        </h1>
        <p className="text-center mb-12 opacity-70 max-w-2xl mx-auto">
          Ready to start your project? Get in touch with us today for a free consultation.
        </p>
        
        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-12`}>
          {/* Contact Form */}
          <div 
            className="p-6 rounded-lg"
            style={{ backgroundColor: `${primaryColor}05`, border: `1px solid ${primaryColor}15` }}
          >
            {contactFormSubmitted ? (
              <div className="text-center py-8">
                <div 
                  className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                  style={{ backgroundColor: `${accentColor}20` }}
                >
                  <CheckCircle className="h-8 w-8" style={{ color: accentColor }} />
                </div>
                <h3 className="text-xl font-semibold mb-2" style={{ color: textColor }}>Thank You!</h3>
                <p className="opacity-70">Your message has been received. We'll get back to you shortly.</p>
                <button
                  onClick={() => setContactFormSubmitted(false)}
                  className="mt-4 text-sm font-medium cursor-pointer"
                  style={{ color: primaryColor }}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-semibold mb-6" style={{ color: textColor }}>Send us a Message</h3>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    setContactFormSubmitted(true);
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>First Name</label>
                      <Input placeholder="John" data-testid="preview-contact-firstname" />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Last Name</label>
                      <Input placeholder="Doe" data-testid="preview-contact-lastname" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Email</label>
                    <Input type="email" placeholder="john@example.com" data-testid="preview-contact-email" />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Phone</label>
                    <Input type="tel" placeholder="(555) 123-4567" data-testid="preview-contact-phone" />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1" style={{ color: textColor }}>Message</label>
                    <Textarea 
                      placeholder="Tell us about your project..." 
                      rows={4}
                      data-testid="preview-contact-message"
                    />
                  </div>
                  <Button 
                    type="submit"
                    className="w-full"
                    style={{ backgroundColor: primaryColor }}
                    data-testid="preview-contact-submit"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Message
                  </Button>
                </form>
              </>
            )}
          </div>
          
          {/* Contact Info */}
          <div>
            <h3 className="text-xl font-semibold mb-6" style={{ color: textColor }}>Get in Touch</h3>
            <div className="space-y-6">
              {website.contactPhone && (
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <Phone className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                  <div>
                    <h4 className="font-medium" style={{ color: textColor }}>Phone</h4>
                    <p className="opacity-70">{website.contactPhone}</p>
                  </div>
                </div>
              )}
              {website.contactEmail && (
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <Mail className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                  <div>
                    <h4 className="font-medium" style={{ color: textColor }}>Email</h4>
                    <p className="opacity-70">{website.contactEmail}</p>
                  </div>
                </div>
              )}
              {website.contactAddress && (
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <MapPin className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                  <div>
                    <h4 className="font-medium" style={{ color: textColor }}>Address</h4>
                    <p className="opacity-70">{website.contactAddress}</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Map placeholder */}
            <div 
              className="mt-8 h-48 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${primaryColor}10` }}
            >
              <span className="opacity-50 text-sm">Map will be displayed here</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  // Main render based on current page
  const renderCurrentPage = () => {
    // Handle custom pages (those starting with "custom-")
    if (currentPage.startsWith("custom-")) {
      const pageId = currentPage.replace("custom-", "");
      return renderCustomPage(pageId);
    }
    
    switch (currentPage) {
      case "home":
        return renderHomePage();
      case "about":
        return renderAboutPage();
      case "services":
        return renderServicesPage();
      case "blog":
        return renderBlogPage();
      case "blog-post":
        return renderBlogPostDetail();
      case "gallery":
        return renderGalleryPage();
      case "project-detail":
        return renderProjectDetail();
      case "contact":
        return renderContactPage();
      default:
        return renderHomePage();
    }
  };

  return (
    <div 
      className="min-h-full w-full"
      style={{ 
        fontFamily,
        backgroundColor: bgColor,
        color: textColor,
      }}
      data-testid="preview-container"
    >
      {renderHeader()}
      {renderCurrentPage()}
      {renderFooter()}
    </div>
  );
}
