import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowRight, 
  Check, 
  X,
  DollarSign, 
  Clock, 
  AlertTriangle, 
  BarChart3, 
  Users, 
  Wrench,
  FileText,
  Calendar,
  Brain,
  Target,
  TrendingUp,
  Shield,
  Zap,
  Building2,
  HardHat,
  Truck,
  Calculator,
  MessagesSquare,
  ClipboardList,
  MapPin,
  Camera,
  Mail,
  Globe,
  Network,
  Sparkles,
  Play,
  Star,
  CheckCircle2,
  Bell,
  Video,
  UserCheck,
  BriefcaseBusiness,
  ListChecks,
  Award,
  Layers,
  Lock,
  FileSignature,
  Eye,
  Scan,
  Box,
  Workflow,
  Smartphone,
  ArrowDown,
  PenTool,
  Gauge,
  ShieldCheck,
  Settings,
  Plug,
  CreditCard,
  Handshake,
  LayoutGrid,
  GanttChart,
  Folder,
  StickyNote
} from "lucide-react";
import heroImage from "../assets/images/landing/hero-construction.jpg";
import teamImage from "../assets/images/landing/team-planning.jpg";
import technologyImage from "../assets/images/landing/technology.jpg";
import equipmentImage from "../assets/images/landing/equipment.jpg";

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.unobserve(el); } },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, className: isVisible ? "animate-fadeSlideUp" : "opacity-0 translate-y-8" };
}

function RevealSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reveal = useScrollReveal();
  return (
    <div ref={reveal.ref} className={`transition-all duration-700 ease-out ${reveal.className} ${className}`}>
      {children}
    </div>
  );
}

const painPoints = [
  {
    icon: DollarSign,
    title: "Budget Overruns",
    description: "Projects consistently go over budget with no visibility until it's too late. Material costs spiral, labor hours exceed estimates, and profit margins vanish.",
    stat: "68%",
    statLabel: "of projects exceed budget"
  },
  {
    icon: BarChart3,
    title: "No Production Tracking",
    description: "Without tracking how fast crews complete work, you repeat the same bidding mistakes. You're flying blind on actual vs. estimated productivity.",
    stat: "Zero",
    statLabel: "data on crew productivity"
  },
  {
    icon: AlertTriangle,
    title: "Change Order Chaos",
    description: "Change orders slip through the cracks, go undocumented, or aren't invoiced. Money left on the table adds up to thousands per project.",
    stat: "$12K",
    statLabel: "avg. lost per project"
  },
  {
    icon: Users,
    title: "Unclear Task Ownership",
    description: "Nobody knows who's responsible for what. Tasks fall through the cracks, deadlines slip, and finger-pointing replaces accountability.",
    stat: "40%",
    statLabel: "of tasks have no owner"
  },
  {
    icon: Wrench,
    title: "Reactive Maintenance",
    description: "Equipment breaks down mid-project because maintenance is reactive, not preventive. Downtime costs pile up while you scramble for repairs.",
    stat: "3x",
    statLabel: "higher repair costs"
  },
  {
    icon: Clock,
    title: "Manual Paperwork",
    description: "Hours wasted on spreadsheets, time cards, and manual reports. Your office staff is buried in admin instead of growing the business.",
    stat: "15hrs",
    statLabel: "per week on admin"
  },
  {
    icon: FileText,
    title: "Scattered Communication",
    description: "Critical project info is spread across texts, emails, and paper notes. Important details get lost and mistakes happen.",
    stat: "4+",
    statLabel: "apps to manage projects"
  },
  {
    icon: Target,
    title: "Poor Follow-Through",
    description: "Great intentions but limited execution. Bids are won but not converted efficiently. Opportunities slip away due to slow response times.",
    stat: "35%",
    statLabel: "of leads go cold"
  },
  {
    icon: UserCheck,
    title: "Hard to Find Good Crews",
    description: "Skilled labor shortages leave jobs understaffed and timelines blown. Posting jobs, reviewing resumes, and scheduling interviews drains hours you don't have.",
    stat: "73%",
    statLabel: "of contractors struggle to find skilled workers"
  }
];

const solutions = [
  {
    problem: "Budget Overruns",
    solution: "Real-Time Cost Tracking",
    description: "AI-powered budget monitoring alerts you the moment costs deviate. Track labor, materials, and equipment against estimates in real-time.",
    icon: TrendingUp
  },
  {
    problem: "No Production Tracking",
    solution: "Automated Production Rates",
    description: "Crew productivity is captured automatically when time clock shifts are approved. Build a database of actual production rates for accurate future bids.",
    icon: BarChart3
  },
  {
    problem: "Change Order Chaos",
    solution: "AI Change Order Generator",
    description: "AI identifies scope changes from daily reports and automatically drafts change orders. Never miss billable work again.",
    icon: Sparkles
  },
  {
    problem: "Unclear Task Ownership",
    solution: "AI Task Generation",
    description: "AI PM analyzes project data and assigns tasks to the right people. Clear ownership, automatic reminders, and accountability built in.",
    icon: ClipboardList
  },
  {
    problem: "Reactive Maintenance",
    solution: "Preventive Equipment Management",
    description: "Track equipment hours, schedule maintenance, and get alerts before breakdowns happen. Keep your fleet running smoothly.",
    icon: Wrench
  },
  {
    problem: "Manual Paperwork",
    solution: "One-Click Time & Materials",
    description: "GPS time clock, digital T&M tickets, and automated payroll reports. What took hours now takes minutes.",
    icon: Zap
  },
  {
    problem: "Hard to Find Good Crews",
    solution: "AI-Powered Hiring",
    description: "AI posts jobs, scores resumes, flags top candidates, and schedules interviews automatically. Find skilled workers faster without the manual grind.",
    icon: UserCheck
  }
];

const features = [
  {
    category: "Project Lifecycle",
    items: [
      { name: "Bid Management", description: "Track opportunities from lead to win with 6-step workflow", icon: Target },
      { name: "Estimating Engine", description: "Interactive takeoff, assembly expansion, and production rates", icon: Calculator },
      { name: "Project Dashboard", description: "Real-time status, health scores, and KPIs across all projects", icon: Building2 },
      { name: "Change Orders", description: "AI-suggested PCOs with revision history and multi-level approvals", icon: FileText },
      { name: "Schedule of Values", description: "AIA progress billing and SOV scope alignment", icon: DollarSign },
      { name: "Daily Reports", description: "Field logs with photo documentation and AI analysis", icon: ClipboardList }
    ]
  },
  {
    category: "Financial Management",
    items: [
      { name: "Budget vs. Actual", description: "Live cost tracking against estimates with variance alerts", icon: BarChart3 },
      { name: "CFO Dashboard", description: "Cost forecasting, burn-rate trends, and margin tracking", icon: TrendingUp },
      { name: "AIA Progress Billing", description: "G702/G703-style pay applications with retention tracking", icon: CreditCard },
      { name: "Revenue Recognition", description: "WIP reporting and percentage-of-completion accounting", icon: DollarSign },
      { name: "Cost Overrun Predictions", description: "AI-powered early warnings before budgets blow", icon: Gauge },
      { name: "Profitability Tracking", description: "Real-time profit margins by project and portfolio", icon: TrendingUp }
    ]
  },
  {
    category: "Subcontracts & Procurement",
    items: [
      { name: "Subcontract Management", description: "Full lifecycle with SOV alignment and retention tracking", icon: Handshake },
      { name: "Pay Applications", description: "AIA G702/G703-style sub pay apps with approval workflow", icon: FileSignature },
      { name: "Procurement Module", description: "Procure-to-pay with automated 3-way match", icon: ClipboardList },
      { name: "Purchase Orders", description: "Create, approve, and track POs with RBAC controls", icon: FileText },
      { name: "Vendor Pricing", description: "Track material prices over time across vendors", icon: DollarSign },
      { name: "Sub Recommendations", description: "AI-ranked subcontractors by composite performance score", icon: Star }
    ]
  },
  {
    category: "AI Automation",
    items: [
      { name: "AI Project Manager", description: "Task generation, risk alerts, and daily summaries", icon: Brain },
      { name: "AI CFO", description: "Margin tracking and cashflow forecasting", icon: TrendingUp },
      { name: "AI Schedule Generator", description: "Realistic timelines from project data", icon: Calendar },
      { name: "AI Vision Takeoff", description: "Extract quantities from blueprints", icon: Camera, comingSoon: true },
      { name: "AI Email Assistant", description: "Categorize emails, extract action items", icon: Mail },
      { name: "AI Contract Review", description: "Risk analysis and clause suggestions", icon: Shield }
    ]
  },
  {
    category: "Scheduling & Planning",
    items: [
      { name: "CPM Schedule Engine", description: "Critical path, forward/backward pass, and float calculation", icon: GanttChart },
      { name: "Resource Loading", description: "Assign crews, equipment, and materials to schedule activities", icon: Users },
      { name: "Gantt Charts", description: "Visual project timelines with drag-and-drop", icon: Calendar },
      { name: "Dependency Mapping", description: "Define task relationships and critical path", icon: Network },
      { name: "Milestone Tracking", description: "Track key dates and deliverables across projects", icon: Target },
      { name: "AI Schedule Generation", description: "Generate realistic schedules from scope and crew data", icon: Sparkles }
    ]
  },
  {
    category: "Field Operations",
    items: [
      { name: "GPS Time Clock", description: "Accurate time tracking with geofence verification", icon: MapPin },
      { name: "T&M Tickets", description: "Digital time & material documentation", icon: FileText },
      { name: "Crew Management", description: "Assign crews to projects, tasks, and cost codes", icon: Users },
      { name: "Production Tracking", description: "Measure actual vs. estimated productivity", icon: BarChart3 },
      { name: "Manager Approvals", description: "Superintendent sign-off and overtime rules engine", icon: Shield },
      { name: "Punch List", description: "Track deficiency items during project closeout", icon: ListChecks }
    ]
  },
  {
    category: "Contract Management",
    items: [
      { name: "Contract Lifecycle", description: "Draft, negotiate, execute, and track contracts", icon: FileSignature },
      { name: "E-Signatures", description: "Integrated digital signature workflows", icon: PenTool },
      { name: "AI Risk Analysis", description: "AI-powered contract risk scoring and alerts", icon: Shield },
      { name: "Clause Library", description: "Reusable clauses and template builder", icon: Folder },
      { name: "Addenda Tracking", description: "Track contract modifications and amendments", icon: FileText },
      { name: "Approval Workflows", description: "Multi-level approval chains with audit trail", icon: CheckCircle2 }
    ]
  },
  {
    category: "Risk & Compliance",
    items: [
      { name: "Risk Register", description: "Category, probability, and impact scoring per project", icon: AlertTriangle },
      { name: "Risk Matrix Heat Map", description: "Visual risk assessment across your portfolio", icon: LayoutGrid },
      { name: "Document Control", description: "Versioning, revision tracking, and expiration alerts", icon: Folder },
      { name: "Compliance Tracking", description: "Insurance, licenses, and certification monitoring", icon: ShieldCheck },
      { name: "Audit Logging", description: "Complete activity trail for all platform actions", icon: Eye },
      { name: "Certified Payroll", description: "Generate certified payroll reports for prevailing wage", icon: FileText }
    ]
  },
  {
    category: "Equipment & Resources",
    items: [
      { name: "Fleet Tracking", description: "Monitor equipment across jobsites", icon: Truck },
      { name: "Tool Management", description: "Track tools by project and employee", icon: Wrench },
      { name: "Maintenance Scheduling", description: "Preventive maintenance alerts", icon: Calendar },
      { name: "Hour Logging", description: "Track equipment usage and fuel", icon: Clock },
      { name: "Repair Workflows", description: "Document and track repairs", icon: HardHat },
      { name: "Cost Allocation", description: "Equipment costs by project with depreciation", icon: DollarSign }
    ]
  },
  {
    category: "BIM & Technology",
    items: [
      { name: "3D BIM Viewer", description: "Upload IFC files and view building models in 3D", icon: Box },
      { name: "LiDAR Scanner", description: "View and analyze 3D point cloud scans", icon: Scan },
      { name: "Takeoff Workspace", description: "Multi-page PDF rendering with measurement tools", icon: Layers },
      { name: "Live Collaboration", description: "Real-time multi-user takeoff via WebSockets", icon: Users },
      { name: "BIM Quantity Extraction", description: "Extract element quantities from IFC models", icon: Calculator },
      { name: "Version Comparison", description: "Compare takeoff versions and detect deltas", icon: Eye }
    ]
  },
  {
    category: "CRM & Sales",
    items: [
      { name: "Contact Management", description: "Customers, subs, and vendors in one place", icon: Users },
      { name: "7-Stage Pipeline", description: "Visual sales pipeline from lead to close", icon: Target },
      { name: "Subcontractor Network", description: "Bid solicitation and contractor marketplace", icon: Network },
      { name: "Rental Catalog", description: "Equipment rental tracking and pricing", icon: Truck },
      { name: "Insurance Tracking", description: "COI, W-9, and license compliance monitoring", icon: ShieldCheck },
      { name: "Social Media Manager", description: "AI content, scheduling, and multi-platform posting", icon: Globe }
    ]
  },
  {
    category: "Portals & Collaboration",
    items: [
      { name: "Client Portal", description: "Project visibility and approvals for your clients", icon: Users },
      { name: "Subcontractor Portal", description: "Pay apps, documents, and scheduling for subs", icon: Handshake },
      { name: "Vendor Portal", description: "POs, invoices, compliance, and bid inbox for vendors", icon: Truck },
      { name: "Team Messaging", description: "Secure real-time chat with file sharing", icon: MessagesSquare },
      { name: "Video Calling", description: "Built-in video meetings for remote collaboration", icon: Video },
      { name: "Project Notes", description: "Notion-style block editor with auto-save", icon: StickyNote }
    ]
  },
  {
    category: "Communication & Docs",
    items: [
      { name: "Document Storage", description: "Organized file management with version control", icon: FileText },
      { name: "Company Calendar", description: "Shared scheduling across teams", icon: Calendar },
      { name: "Multi-Channel Notifications", description: "Email, push, SMS, Slack, and Teams alerts", icon: Bell },
      { name: "Website Builder", description: "Professional company website with SEO", icon: Globe },
      { name: "White-Label Branding", description: "Your brand throughout the platform", icon: Building2 },
      { name: "Leave Management", description: "Employee self-service and manager approval", icon: Calendar }
    ]
  },
  {
    category: "Hiring & Recruiting",
    items: [
      { name: "AI Job Posting", description: "Auto-generate and post job listings", icon: BriefcaseBusiness },
      { name: "Candidate Pipeline", description: "Visual kanban for every applicant", icon: ListChecks },
      { name: "AI Candidate Scoring", description: "Resume scoring with strengths and concerns", icon: Brain },
      { name: "Interview Scheduling", description: "Automated scheduling with calendar sync", icon: Calendar },
      { name: "Talent Pool", description: "AI-powered skill matching from talent profiles", icon: UserCheck },
      { name: "Hiring Analytics", description: "Track time-to-hire and pipeline metrics", icon: BarChart3 }
    ]
  },
  {
    category: "Enterprise & Security",
    items: [
      { name: "SSO / SAML 2.0", description: "Single sign-on for enterprise organizations", icon: Lock },
      { name: "8-Role RBAC", description: "Granular permissions with custom role labels", icon: Shield },
      { name: "Feature Permissions", description: "Per-user access control with 30+ built-in presets", icon: Settings },
      { name: "No-Code Workflows", description: "Visual pipeline editor for custom approval chains", icon: Workflow },
      { name: "Data Retention & GDPR", description: "Configurable retention policies and compliance", icon: ShieldCheck },
      { name: "PWA & Offline Sync", description: "Works offline with automatic data sync", icon: Smartphone }
    ]
  }
];

const integrations = [
  {
    name: "QuickBooks Online",
    description: "Sync invoices, payments, and chart of accounts bidirectionally",
    icon: "QB"
  },
  {
    name: "Google Workspace",
    description: "Gmail integration, Google Calendar sync, and Drive storage",
    icon: "G"
  },
  {
    name: "Microsoft 365",
    description: "Outlook email, Teams notifications, and calendar sync",
    icon: "M"
  },
  {
    name: "DocuSign",
    description: "E-signature workflows for contracts and change orders",
    icon: "DS"
  },
  {
    name: "Slack & Teams",
    description: "Multi-channel notifications, alerts, and project updates",
    icon: "ST"
  },
  {
    name: "Integration Hub",
    description: "Provider-agnostic framework for custom connections and webhook automations",
    icon: "HUB"
  }
];

const aiCapabilities = [
  {
    title: "AI Senior Project Manager",
    description: "Like having a seasoned PM working 24/7. Analyzes your project data, generates tasks, identifies risks, and provides daily summaries. Never miss a deadline or overlook a critical issue again.",
    features: ["Task Generation", "Risk Alerts", "Daily Summaries", "Schedule Optimization"],
    image: teamImage
  },
  {
    title: "AI CFO & Cost Predictor",
    description: "Financial intelligence at your fingertips. Tracks margins in real-time, forecasts cashflow, predicts cost overruns before they happen, and alerts you to profitability issues with confidence-scored early warnings.",
    features: ["Margin Tracking", "Cashflow Forecasting", "Cost Overrun Predictions", "Burn-Rate Analysis"],
    image: null
  },
  {
    title: "AI Contract Analyst",
    description: "Scans contracts for risk clauses, suggests protective language, and scores contract risk levels. Paired with a clause library and template builder for rapid contract assembly.",
    features: ["Risk Scoring", "Clause Suggestions", "Template Builder", "Compliance Checks"],
    image: null
  },
  {
    title: "AI Vision Takeoff",
    description: "Upload blueprints and let AI do the measuring. Automatically extracts quantities for concrete, excavation, materials, and more. Faster, more accurate estimates.",
    features: ["Blueprint Analysis", "Quantity Extraction", "Material Calculations", "Estimate Pre-population"],
    image: null,
    comingSoon: true
  },
  {
    title: "AI Schedule Generator",
    description: "Analyzes your scope of work, crew availability, and historical production rates to generate realistic CPM schedules with critical path identification and resource loading.",
    features: ["CPM Scheduling", "Resource Optimization", "Critical Path", "Timeline Predictions"],
    image: null
  },
  {
    title: "AI Hiring Assistant",
    description: "Automates the entire recruiting workflow. AI writes and posts job listings, scores incoming resumes, highlights candidate strengths and concerns, and triggers automations so qualified workers move through your pipeline.",
    features: ["AI Job Posting", "Resume Scoring", "Strengths & Concerns", "Stage Automation"],
    image: null
  },
  {
    title: "AI Subcontractor Engine",
    description: "Ranks subcontractors by a composite score built from performance history, vendor ratings, and contract track record. Get data-driven recommendations for every trade on every project.",
    features: ["Performance Scoring", "Vendor Rankings", "Trade Matching", "History Analysis"],
    image: null
  },
  {
    title: "AI Change Detection",
    description: "Monitors takeoff versions and daily reports to automatically detect scope changes. Generates draft PCOs from quantity deltas so nothing falls through the cracks.",
    features: ["Scope Change Detection", "Auto PCO Drafting", "Delta Analysis", "Version Comparison"],
    image: null
  }
];

const plans = [
  {
    name: "Starter",
    price: 89,
    revenueRange: "Under $500k Revenue",
    description: "Core features for owner-operators and small crews",
    features: [
      "Project management",
      "GPS time clock",
      "Core estimating",
      "CRM contacts",
      "Documents & messaging",
      "Up to 10 projects",
      "Up to 5 users",
      "Email support"
    ],
    notIncluded: [
      "Production rate tracking",
      "AI automations",
      "Advanced reports"
    ],
    popular: false,
    cta: "Start Free Trial"
  },
  {
    name: "Growth",
    price: 229,
    revenueRange: "$500k - $2M Revenue",
    description: "Advanced features for growing contractors",
    features: [
      "Everything in Starter",
      "Production rate tracking",
      "Budget vs. actuals",
      "Vendor & sub management",
      "Advanced reports",
      "Up to 50 projects",
      "Up to 25 users",
      "Chat support"
    ],
    notIncluded: [
      "Portfolio dashboards",
      "Bid Network access"
    ],
    popular: true,
    cta: "Start Free Trial"
  },
  {
    name: "Scale",
    price: 579,
    revenueRange: "$2M - $10M Revenue",
    description: "Full platform for multi-project operations",
    features: [
      "Everything in Growth",
      "Portfolio dashboards",
      "Bid Network access",
      "Website builder",
      "Client & sub portals",
      "Unlimited projects & users",
      "Priority support",
      "Quarterly success review"
    ],
    notIncluded: [],
    popular: false,
    cta: "Start Free Trial"
  },
  {
    name: "Hustler",
    price: 1199,
    revenueRange: "Multi-Company",
    description: "For owners running multiple businesses",
    features: [
      "Multiple companies",
      "Cross-org analytics",
      "COO delegation mode",
      "SSO / SAML 2.0",
      "White-glove onboarding",
      "Dedicated success manager"
    ],
    notIncluded: [],
    popular: false,
    cta: "Contact Sales"
  }
];

const addons = [
  { name: "AI PM Pack", price: 39, description: "Task generation, risk alerts, daily summaries" },
  { name: "AI CFO Pack", price: 59, description: "Margin tracking, cashflow forecasting, cost overrun predictions" },
  { name: "AI Email Pack", price: 29, description: "Email categorization, task extraction, follow-ups" },
  { name: "AI Vision Pack", price: 79, description: "AI-powered plan takeoff and material estimation", comingSoon: true },
  { name: "AI Contract Pack", price: 49, description: "Contract risk analysis, clause suggestions, template builder" },
  { name: "Website + SEO Pack", price: 39, description: "Website builder, SEO optimization, blog & gallery" },
  { name: "Bid Network Pack", price: 49, description: "Competitive vendor bidding marketplace" },
  { name: "AI Hiring Pack", price: 49, description: "AI job posting, resume scoring, candidate pipeline automation" }
];

const tradeTypes = [
  "Concrete", "Excavation", "Electrical", "Plumbing", "HVAC", "Roofing", 
  "Masonry", "Carpentry", "Painting", "Flooring", "Landscaping", "Fencing",
  "General Contractor", "Drywall", "Insulation", "Siding", "Windows & Doors",
  "Steel", "Demolition", "Paving", "Utilities", "Fire Protection", "Elevator"
];

const platformStats = [
  { value: "500+", label: "Platform Features" },
  { value: "23", label: "Trades Supported" },
  { value: "8", label: "AI Assistants" },
  { value: "99.9%", label: "Uptime SLA" }
];

const howItWorks = [
  {
    step: 1,
    title: "Sign Up in Minutes",
    description: "Create your account and select your trade. Our AI-driven onboarding customizes the platform for your specific business type.",
    icon: UserCheck
  },
  {
    step: 2,
    title: "Configure Your Workspace",
    description: "Import contacts, set up your crew, and configure cost codes. The platform adapts its navigation, dashboards, and features to your trade.",
    icon: Settings
  },
  {
    step: 3,
    title: "Start Managing Profitably",
    description: "Track projects, automate change orders, monitor costs in real-time, and let AI handle the busywork. See results from day one.",
    icon: TrendingUp
  }
];

export default function LandingPage() {
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    document.title = "SmartManageAI - AI-Powered Construction Management Software | 500+ Features for 23 Trades";
    const setMeta = (name: string, content: string, property?: boolean) => {
      const attr = property ? "property" : "name";
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta("description", "Stop losing money on every project. SmartManageAI is the complete AI-powered construction management platform with 500+ features for 23 trades. GPS time clock, estimating, change orders, subcontract management, BIM viewer, CPM scheduling, and 8 AI assistants — all in one platform.");
    setMeta("og:title", "SmartManageAI - The Complete AI-Powered Construction Management Platform", true);
    setMeta("og:description", "Replace 6+ scattered tools with one platform. 500+ features, 8 AI assistants, 23 trades supported. GPS time tracking, estimating, financial management, subcontracts, BIM, and more.", true);
    setMeta("og:type", "website", true);
    setMeta("og:url", "https://smartmanageai.com", true);
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", "SmartManageAI - AI-Powered Construction Management");
    setMeta("twitter:description", "The only platform built to run your entire construction business. 500+ features, 8 AI assistants, 23 trades.");
    setMeta("keywords", "construction management software, AI construction, project management, GPS time clock, estimating software, change orders, subcontract management, BIM viewer, CPM scheduling, contractor software");
    return () => { document.title = "SmartManageAI"; };
  }, []);

  const handleNotifySubmit = async () => {
    if (!notifyEmail.trim()) {
      toast({ title: "Please enter your email", variant: "destructive" });
      return;
    }
    
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    
    toast({ 
      title: "You're on the list!", 
      description: "We'll notify you when the demo video is ready." 
    });
    setNotifyEmail("");
    setShowDemoModal(false);
  };

  const visibleFeatures = showAllFeatures ? features : features.slice(0, 8);

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-xl">SmartManageAI</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-features">Features</a>
              <a href="#integrations" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-integrations">Integrations</a>
              <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-ai">AI Automation</a>
              <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-pricing">Pricing</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login" data-testid="link-nav-login">
                <Button variant="ghost" size="sm" data-testid="button-nav-login">
                  Log In
                </Button>
              </Link>
              <Link href="/register" data-testid="link-nav-register">
                <Button size="sm" data-testid="button-nav-register">
                  Start Free Trial
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <section className="relative pt-16 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={heroImage} 
            alt="Construction site" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/75 to-black/60" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 lg:py-40">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-6 bg-primary/20 text-primary-foreground border-primary/30">
              <Sparkles className="w-3 h-3 mr-1" />
              AI-Powered Construction Management
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
              The Only Platform Built to Run Your Entire Construction Business
            </h1>
            <p className="text-xl md:text-2xl text-gray-300 mb-8 leading-relaxed">
              From bids to billing, crews to contracts, takeoffs to time clocks — SmartManageAI replaces 6+ scattered tools with one AI-powered platform. 500+ features purpose-built for 23 construction trades.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <Link href="/register" data-testid="link-hero-register">
                <Button size="lg" className="w-full sm:w-auto text-base px-8 py-6" data-testid="button-hero-trial">
                  Start Free 14-Day Trial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Button 
                size="lg" 
                variant="secondary" 
                className="w-full sm:w-auto bg-white/10 border-white/30 text-white text-base px-8 py-6" 
                onClick={() => setShowDemoModal(true)}
                data-testid="button-hero-demo"
              >
                <Play className="mr-2 h-5 w-5" />
                Watch Demo
              </Button>
            </div>
            <div className="flex flex-wrap gap-6 text-gray-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span>Setup in 15 minutes</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span>Cancel anytime</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span>Works offline</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-muted/30 border-y">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {platformStats.map((stat) => (
              <div key={stat.label} className="text-center" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                <div className="text-3xl md:text-4xl font-bold text-primary mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mb-6 uppercase tracking-wider font-medium">
            Purpose-Built for 23 Construction Trades
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {tradeTypes.map((trade) => (
              <Badge key={trade} variant="outline" className="px-3 py-1 text-xs" data-testid={`badge-trade-${trade.toLowerCase().replace(/\s+/g, '-')}`}>
                {trade}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28" data-testid="section-how-it-works">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge variant="secondary" className="mb-4">Getting Started</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Up and Running in Three Steps
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                No complicated setup. No month-long implementation. Start managing your projects profitably today.
              </p>
            </div>
          </RevealSection>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {howItWorks.map((step, index) => (
              <RevealSection key={step.step}>
                <div className="text-center relative">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6 relative">
                    <step.icon className="w-8 h-8 text-primary" />
                    <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                      {step.step}
                    </div>
                  </div>
                  {index < howItWorks.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[calc(50%+40px)] w-[calc(100%-80px)] h-[2px] bg-gradient-to-r from-primary/30 to-primary/10" />
                  )}
                  <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-muted/30" id="problems">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge variant="destructive" className="mb-4">Sound Familiar?</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                The Hidden Costs Killing Your Profits
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Construction companies lose an average of 5-10% of revenue to inefficiencies. Here's where the money goes.
              </p>
            </div>
          </RevealSection>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {painPoints.map((point, index) => (
              <RevealSection key={index}>
                <Card className="border-destructive/20 bg-destructive/5 h-full" data-testid={`card-pain-${index}`}>
                  <CardHeader className="pb-2">
                    <div className="w-12 h-12 rounded-lg bg-destructive/10 flex items-center justify-center mb-3">
                      <point.icon className="w-6 h-6 text-destructive" />
                    </div>
                    <CardTitle className="text-lg">{point.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">{point.description}</p>
                    <div className="pt-4 border-t">
                      <span className="text-2xl font-bold text-destructive">{point.stat}</span>
                      <span className="text-sm text-muted-foreground ml-2">{point.statLabel}</span>
                    </div>
                  </CardContent>
                </Card>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge variant="default" className="mb-4">The SmartManageAI Solution</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Every Problem Has a Solution Built In
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                We didn't just build features — we built answers to the real problems contractors face every day.
              </p>
            </div>
          </RevealSection>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {solutions.map((solution, index) => (
              <RevealSection key={index}>
                <Card className="relative overflow-hidden h-full" data-testid={`card-solution-${index}`}>
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                  <CardHeader>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <solution.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground line-through">{solution.problem}</p>
                        <CardTitle className="text-lg">{solution.solution}</CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{solution.description}</p>
                  </CardContent>
                </Card>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-muted/30" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge variant="secondary" className="mb-4">Complete Platform</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Everything You Need — Nothing You Don't
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {features.length} feature categories. 500+ individual capabilities. One platform that replaces your entire tool stack.
              </p>
            </div>
          </RevealSection>
          <div className="space-y-12">
            {visibleFeatures.map((category, catIndex) => (
              <RevealSection key={catIndex}>
                <div>
                  <h3 className="text-xl font-semibold mb-6 flex items-center gap-2" data-testid={`heading-feature-${category.category.toLowerCase().replace(/\s+/g, '-')}`}>
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    {category.category}
                  </h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {category.items.map((feature, featIndex) => (
                      <div key={featIndex} className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:shadow-md hover:border-primary/20 transition-all duration-200" data-testid={`feature-${feature.name.toLowerCase().replace(/\s+/g, '-')}`}>
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <feature.icon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium">{feature.name}</h4>
                            {(feature as any).comingSoon && (
                              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                                Coming Soon
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{feature.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>
          {!showAllFeatures && (
            <div className="text-center mt-12">
              <Button 
                variant="outline" 
                size="lg" 
                onClick={() => setShowAllFeatures(true)}
                data-testid="button-show-all-features"
              >
                Show All {features.length} Categories
                <ArrowDown className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className="py-20 md:py-28" id="integrations">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge variant="secondary" className="mb-4">
                <Plug className="w-3 h-3 mr-1" />
                Integrations
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Connects With the Tools You Already Use
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Seamless integrations with your accounting, email, calendar, and document systems. Plus an open Integration Hub for custom connections.
              </p>
            </div>
          </RevealSection>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {integrations.map((integration, index) => (
              <RevealSection key={index}>
                <Card className="text-center h-full hover:shadow-md hover:border-primary/20 transition-all duration-200" data-testid={`card-integration-${integration.name.toLowerCase().replace(/\s+/g, '-')}`}>
                  <CardContent className="pt-6">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-4">
                      <span className="text-lg font-bold text-primary">{integration.icon}</span>
                    </div>
                    <h3 className="font-semibold mb-2">{integration.name}</h3>
                    <p className="text-sm text-muted-foreground">{integration.description}</p>
                  </CardContent>
                </Card>
              </RevealSection>
            ))}
          </div>
          <RevealSection>
            <div className="text-center mt-10">
              <p className="text-sm text-muted-foreground">
                Plus dozens of additional connections available through our open <span className="font-semibold text-foreground">Integration Hub</span> API.
              </p>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-gradient-to-b from-primary/5 to-background" id="ai">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge className="mb-4 bg-primary/20">
                <Sparkles className="w-3 h-3 mr-1" />
                Powered by AI
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Your AI Construction Team — 8 Assistants Working 24/7
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Like having a senior PM, CFO, estimator, contract analyst, and hiring manager working around the clock. AI that understands construction.
              </p>
            </div>
          </RevealSection>
          <div className="space-y-12">
            {aiCapabilities.map((capability, index) => (
              <RevealSection key={index}>
                <div className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-8 items-center`} data-testid={`ai-capability-${index}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="text-2xl font-bold">{capability.title}</h3>
                      {(capability as any).comingSoon && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                    <p className="text-lg text-muted-foreground mb-6">{capability.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {capability.features.map((feature, featIndex) => (
                        <Badge key={featIndex} variant="secondary" className="px-3 py-1">
                          <Check className="w-3 h-3 mr-1" />
                          {feature}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 max-w-md">
                    {capability.image ? (
                      <img 
                        src={capability.image} 
                        alt={capability.title}
                        className="rounded-lg shadow-xl"
                      />
                    ) : (
                      <div className="aspect-video rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
                        <Brain className="w-16 h-16 text-primary/40" />
                      </div>
                    )}
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <img 
                  src={technologyImage} 
                  alt="Construction technology"
                  className="rounded-lg shadow-xl"
                />
              </div>
              <div>
                <Badge variant="secondary" className="mb-4">Built for the Field</Badge>
                <h2 className="text-3xl md:text-4xl font-bold mb-6">
                  Technology That Works Where You Work
                </h2>
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">GPS Time Clock & Geofencing</h3>
                      <p className="text-muted-foreground">Crews clock in from the jobsite with location verification. No more buddy punching or timesheet disputes.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Users className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Live Collaboration</h3>
                      <p className="text-muted-foreground">Real-time multi-user collaboration on takeoffs, documents, and project data via WebSockets. Everyone stays in sync.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Video className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Built-In Video Calling</h3>
                      <p className="text-muted-foreground">Host video meetings directly in the platform. No need for separate Zoom or Teams accounts for project coordination.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bell className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Multi-Channel Notifications</h3>
                      <p className="text-muted-foreground">Get alerts via email, web push, SMS, Slack, or Microsoft Teams. Configure per-user preferences so nothing gets missed.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Smartphone className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">PWA & Offline Mode</h3>
                      <p className="text-muted-foreground">Install as a native app on any device. Keep working without internet — data syncs automatically when you're back online.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Camera className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Photo Documentation</h3>
                      <p className="text-muted-foreground">Capture progress photos linked to daily reports. Build an automatic visual project record for clients and compliance.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-gradient-to-br from-primary/5 via-background to-primary/5" data-testid="section-replaces">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-12">
              <Badge variant="secondary" className="mb-4">Why Switch?</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Replace 6+ Tools With One Platform
              </h2>
            </div>
            <div className="grid md:grid-cols-2 gap-8">
              <Card className="border-destructive/20 bg-destructive/5">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <X className="w-5 h-5 text-destructive" />
                    Without SmartManageAI
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    "Spreadsheets for estimating",
                    "Separate time tracking app",
                    "Paper or PDF change orders",
                    "QuickBooks only for accounting",
                    "Email chains for approvals",
                    "WhatsApp for field communication",
                    "Indeed for hiring",
                    "Dropbox for documents"
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <X className="w-4 h-4 text-destructive/60 flex-shrink-0" />
                      {item}
                    </div>
                  ))}
                  <div className="pt-4 border-t mt-4">
                    <div className="text-sm text-destructive font-semibold">$500-1,200+/mo across 6-8 apps</div>
                    <div className="text-xs text-muted-foreground">Plus hours of manual data transfer between tools</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    With SmartManageAI
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    "AI-powered estimating with takeoff workspace",
                    "GPS time clock with production tracking",
                    "Automated change order detection & billing",
                    "QuickBooks, Google, Microsoft integrations",
                    "Built-in approval workflows & e-signatures",
                    "Real-time team messaging & video calls",
                    "AI hiring assistant with candidate scoring",
                    "Document control with versioning & compliance"
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                      {item}
                    </div>
                  ))}
                  <div className="pt-4 border-t mt-4">
                    <div className="text-sm text-primary font-semibold">Starting at $89/mo — everything in one place</div>
                    <div className="text-xs text-muted-foreground">All data connected. Zero manual transfer. AI does the rest.</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-muted/30" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <Badge variant="secondary" className="mb-4">Simple Pricing</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Plans That Grow With You
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Start with what you need. Add AI capabilities as you grow. No long-term contracts.
              </p>
            </div>
          </RevealSection>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {plans.map((plan, index) => (
              <RevealSection key={index}>
                <Card className={`relative h-full ${plan.popular ? 'border-primary shadow-lg ring-2 ring-primary/20' : ''}`}>
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary">Most Popular</Badge>
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    <CardDescription>{plan.revenueRange}</CardDescription>
                    <div className="pt-4">
                      <span className="text-4xl font-bold">${plan.price}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                    <div className="space-y-2">
                      {plan.features.map((feature, featIndex) => (
                        <div key={featIndex} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>{feature}</span>
                        </div>
                      ))}
                      {plan.notIncluded.map((feature, featIndex) => (
                        <div key={featIndex} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <X className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Link href="/register" className="w-full" data-testid={`link-pricing-${plan.name.toLowerCase()}`}>
                      <Button 
                        className="w-full" 
                        variant={plan.popular ? "default" : "outline"}
                        data-testid={`button-pricing-${plan.name.toLowerCase()}`}
                      >
                        {plan.cta}
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              </RevealSection>
            ))}
          </div>

          <RevealSection>
            <div className="mt-16">
              <h3 className="text-2xl font-bold text-center mb-8">Power Up With AI Add-Ons</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
                {addons.map((addon, index) => (
                  <div key={index} className="flex flex-col p-4 rounded-lg border bg-card hover:shadow-md hover:border-primary/20 transition-all duration-200" data-testid={`addon-${addon.name.toLowerCase().replace(/\s+/g, '-')}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">{addon.name}</h4>
                        {(addon as any).comingSoon && (
                          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">Soon</Badge>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-lg font-bold">+${addon.price}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{addon.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-20 md:py-28 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={equipmentImage} 
            alt="Construction equipment" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 to-black/70" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6">
            Ready to Take Control of Your Projects?
          </h2>
          <p className="text-xl text-gray-300 mb-4">
            Join contractors who've stopped guessing and started knowing.
          </p>
          <p className="text-lg text-gray-400 mb-8">
            14-day free trial. No credit card required. Cancel anytime.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" data-testid="link-cta-register">
              <Button size="lg" className="text-base px-8 py-6" data-testid="button-cta-trial">
                Start Your Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="secondary" 
              className="bg-white/10 border-white/30 text-white text-base px-8 py-6" 
              onClick={() => setShowDemoModal(true)}
              data-testid="button-cta-demo"
            >
              Schedule a Demo
            </Button>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="font-bold text-xl">SmartManageAI</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                AI-powered construction management for contractors who want to build profitably.
              </p>
              <div className="flex gap-3 text-muted-foreground">
                <Badge variant="outline" className="text-xs">SOC 2</Badge>
                <Badge variant="outline" className="text-xs">GDPR</Badge>
                <Badge variant="outline" className="text-xs">99.9% SLA</Badge>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors" data-testid="link-footer-features">Features</a></li>
                <li><a href="#integrations" className="hover:text-foreground transition-colors" data-testid="link-footer-integrations">Integrations</a></li>
                <li><a href="#ai" className="hover:text-foreground transition-colors" data-testid="link-footer-ai">AI Automation</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors" data-testid="link-footer-pricing">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Trades</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-concrete">Concrete</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-gc">General Contractor</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-electrical">Electrical</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-all-trades">All 23 Trades</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-about">About</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-contact">Contact</a></li>
                <li><Link href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms of Service</Link></li>
                <li><Link href="/dpa" className="hover:text-foreground transition-colors" data-testid="link-footer-dpa">Data Processing Addendum</Link></li>
                <li><Link href="/sub-processors" className="hover:text-foreground transition-colors" data-testid="link-footer-subprocessors">Sub-processors</Link></li>
                <li><Link href="/trust" className="hover:text-foreground transition-colors" data-testid="link-footer-trust">Trust &amp; Security</Link></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} SmartManageAI. All rights reserved.</p>
          </div>
        </div>
      </footer>

      <Dialog open={showDemoModal} onOpenChange={setShowDemoModal}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-demo-coming-soon">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Video className="w-8 h-8 text-primary" />
            </div>
            <DialogTitle className="text-center text-2xl" data-testid="text-demo-modal-title">Demo Coming Soon!</DialogTitle>
            <DialogDescription className="text-center" data-testid="text-demo-modal-description">
              We're putting the finishing touches on our product demo video. 
              Leave your email below and we'll notify you the moment it's ready.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="notify-email">Email Address</Label>
              <Input
                id="notify-email"
                type="email"
                placeholder="your@email.com"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNotifySubmit()}
                data-testid="input-notify-email"
              />
            </div>
            <Button 
              onClick={handleNotifySubmit} 
              className="w-full"
              disabled={isSubmitting}
              data-testid="button-notify-submit"
            >
              <Bell className="mr-2 h-4 w-4" />
              {isSubmitting ? "Submitting..." : "Notify Me When Ready"}
            </Button>
            <p className="text-xs text-muted-foreground text-center" data-testid="text-demo-modal-privacy">
              We respect your privacy. No spam, just one notification when the demo is live.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
