import { 
  Phone, 
  Mail, 
  MapPin, 
  Menu,
  ChevronRight,
  Star,
  CheckCircle,
  ArrowRight
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok } from "react-icons/si";

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
    navigationLabel: string | null;
    navigationOrder: number;
  }>;
  blogPosts: Array<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    coverImageUrl: string | null;
  }>;
  projects: Array<{
    id: string;
    title: string;
    shortDescription: string | null;
    coverImageUrl: string | null;
    projectType: string | null;
  }>;
  socialLinks: {
    facebookUrl: string | null;
    instagramUrl: string | null;
    linkedinUrl: string | null;
    youtubeUrl: string | null;
    tiktokUrl: string | null;
  } | null;
}

interface WebsitePreviewRendererProps {
  data: PreviewData;
  deviceType: "desktop" | "tablet" | "mobile";
}

export default function WebsitePreviewRenderer({ data, deviceType }: WebsitePreviewRendererProps) {
  const { website, organization, pages, blogPosts, projects, socialLinks } = data;
  
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
      {/* Navigation Header */}
      <header 
        className="sticky top-0 z-50 shadow-sm"
        style={{ backgroundColor: bgColor, borderBottom: `1px solid ${primaryColor}20` }}
      >
        <div className={`mx-auto px-4 ${isMobile ? 'py-3' : 'py-4'}`} style={{ maxWidth: '1200px' }}>
          <div className="flex items-center justify-between">
            {/* Logo / Site Name */}
            <div className="flex items-center gap-3">
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
            </div>

            {/* Navigation */}
            {isMobile ? (
              <button 
                className="p-2 rounded"
                style={{ backgroundColor: `${primaryColor}10` }}
              >
                <Menu className="h-5 w-5" style={{ color: primaryColor }} />
              </button>
            ) : (
              <nav className="flex items-center gap-6">
                <a href="#" className="font-medium hover:opacity-80" style={{ color: primaryColor }}>Home</a>
                {pages.slice(0, 4).map(page => (
                  <a 
                    key={page.id} 
                    href="#" 
                    className="hover:opacity-80"
                    style={{ color: textColor }}
                  >
                    {page.navigationLabel || page.pageTitle}
                  </a>
                ))}
                <button 
                  className="px-4 py-2 rounded font-medium text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  Contact Us
                </button>
              </nav>
            )}
          </div>
        </div>
      </header>

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
              className={`${isMobile ? 'w-full' : ''} px-6 py-3 rounded font-medium text-white flex items-center justify-center gap-2`}
              style={{ backgroundColor: accentColor }}
            >
              Get a Free Quote
              <ArrowRight className="h-4 w-4" />
            </button>
            <button 
              className={`${isMobile ? 'w-full' : ''} px-6 py-3 rounded font-medium border-2 border-white text-white`}
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

      {/* Projects Section */}
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
                <div 
                  key={project.id}
                  className="rounded-lg overflow-hidden shadow-sm"
                  style={{ backgroundColor: bgColor }}
                >
                  <div 
                    className="h-48 bg-gray-200"
                    style={{ 
                      backgroundImage: project.coverImageUrl ? `url(${project.coverImageUrl})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="p-4">
                    <span 
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                    >
                      {project.projectType || "Project"}
                    </span>
                    <h3 className="font-semibold mt-2" style={{ color: textColor }}>{project.title}</h3>
                    <p className="text-sm opacity-70 mt-1 line-clamp-2">{project.shortDescription}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Blog Section */}
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
                <div 
                  key={post.id}
                  className="rounded-lg overflow-hidden"
                  style={{ border: `1px solid ${primaryColor}15` }}
                >
                  <div 
                    className="h-40 bg-gray-200"
                    style={{ 
                      backgroundImage: post.coverImageUrl ? `url(${post.coverImageUrl})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="p-4">
                    <h3 className="font-semibold" style={{ color: textColor }}>{post.title}</h3>
                    <p className="text-sm opacity-70 mt-2 line-clamp-2">{post.excerpt}</p>
                    <a 
                      href="#" 
                      className="text-sm font-medium mt-3 inline-flex items-center gap-1"
                      style={{ color: primaryColor }}
                    >
                      Read More <ChevronRight className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Testimonial Section */}
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

      {/* CTA Section */}
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
            className="px-8 py-3 rounded font-medium"
            style={{ backgroundColor: accentColor, color: 'white' }}
          >
            Get Your Free Quote
          </button>
        </div>
      </section>

      {/* Footer */}
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
                <li><a href="#" className="hover:opacity-100">Home</a></li>
                <li><a href="#" className="hover:opacity-100">About Us</a></li>
                <li><a href="#" className="hover:opacity-100">Services</a></li>
                <li><a href="#" className="hover:opacity-100">Projects</a></li>
                <li><a href="#" className="hover:opacity-100">Contact</a></li>
              </ul>
            </div>

            {/* Contact Info */}
            <div className={isMobile ? 'text-center' : ''}>
              <h4 className="font-semibold mb-4">Contact Us</h4>
              <ul className="space-y-3 text-sm opacity-80">
                {website.contactPhone && (
                  <li className="flex items-center gap-2 justify-center sm:justify-start">
                    <Phone className="h-4 w-4" />
                    {website.contactPhone}
                  </li>
                )}
                {website.contactEmail && (
                  <li className="flex items-center gap-2 justify-center sm:justify-start">
                    <Mail className="h-4 w-4" />
                    {website.contactEmail}
                  </li>
                )}
                {website.contactAddress && (
                  <li className="flex items-center gap-2 justify-center sm:justify-start">
                    <MapPin className="h-4 w-4" />
                    {website.contactAddress}
                  </li>
                )}
              </ul>
            </div>

            {/* Social Links */}
            <div className={isMobile ? 'text-center' : ''}>
              <h4 className="font-semibold mb-4">Follow Us</h4>
              <div className="flex gap-3 justify-center sm:justify-start">
                {socialLinks?.facebookUrl && (
                  <a href="#" className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                    <SiFacebook className="h-4 w-4" />
                  </a>
                )}
                {socialLinks?.instagramUrl && (
                  <a href="#" className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                    <SiInstagram className="h-4 w-4" />
                  </a>
                )}
                {socialLinks?.linkedinUrl && (
                  <a href="#" className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                    <SiLinkedin className="h-4 w-4" />
                  </a>
                )}
                {socialLinks?.youtubeUrl && (
                  <a href="#" className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                    <SiYoutube className="h-4 w-4" />
                  </a>
                )}
                {socialLinks?.tiktokUrl && (
                  <a href="#" className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                    <SiTiktok className="h-4 w-4" />
                  </a>
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
    </div>
  );
}
