import { useState } from "react";
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
  ChevronRight,
  Play,
  Star,
  CheckCircle2,
  Bell,
  Video,
  UserCheck,
  BriefcaseBusiness,
  ListChecks,
  Award
} from "lucide-react";
import heroImage from "../assets/images/landing/hero-construction.jpg";
import teamImage from "../assets/images/landing/team-planning.jpg";
import technologyImage from "../assets/images/landing/technology.jpg";
import equipmentImage from "../assets/images/landing/equipment.jpg";

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
      { name: "Bid Management", description: "Track opportunities from lead to win", icon: Target },
      { name: "Estimating Engine", description: "Build detailed estimates with production rates", icon: Calculator },
      { name: "Project Dashboard", description: "Real-time status across all projects", icon: Building2 },
      { name: "Change Orders", description: "Document and invoice scope changes", icon: FileText },
      { name: "Schedule of Values", description: "Progress billing made simple", icon: DollarSign },
      { name: "Daily Reports", description: "Field logs with photo documentation", icon: ClipboardList }
    ]
  },
  {
    category: "AI Automation",
    items: [
      { name: "AI Project Manager", description: "Task generation and risk alerts", icon: Brain },
      { name: "AI CFO", description: "Margin tracking and cashflow forecasting", icon: TrendingUp },
      { name: "AI Schedule Generator", description: "Realistic timelines from project data", icon: Calendar },
      { name: "AI Vision Takeoff", description: "Extract quantities from blueprints", icon: Camera, comingSoon: true },
      { name: "AI Email Assistant", description: "Categorize emails, extract tasks", icon: Mail },
      { name: "AI Change Detection", description: "Identify scope changes automatically", icon: Sparkles }
    ]
  },
  {
    category: "Field Operations",
    items: [
      { name: "GPS Time Clock", description: "Accurate time tracking with location", icon: MapPin },
      { name: "T&M Tickets", description: "Digital time & material documentation", icon: FileText },
      { name: "Crew Management", description: "Assign crews to projects and tasks", icon: Users },
      { name: "Production Tracking", description: "Measure actual vs. estimated productivity", icon: BarChart3 },
      { name: "Daily Progress", description: "Track scope completion in real-time", icon: CheckCircle2 },
      { name: "Manager Approvals", description: "Superintendent sign-off workflow", icon: Shield }
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
      { name: "Cost Allocation", description: "Equipment costs by project", icon: DollarSign }
    ]
  },
  {
    category: "CRM & Vendors",
    items: [
      { name: "Contact Management", description: "Customers, subs, and vendors", icon: Users },
      { name: "Vendor Pricing", description: "Track material prices over time", icon: DollarSign },
      { name: "Subcontractor Network", description: "Bid solicitation marketplace", icon: Network },
      { name: "Rental Catalog", description: "Equipment rental tracking", icon: Truck },
      { name: "Subcontract Management", description: "Scope assignment and billing", icon: FileText },
      { name: "Payables Workflow", description: "Approve and track payments", icon: CheckCircle2 }
    ]
  },
  {
    category: "Communication & Docs",
    items: [
      { name: "Team Messaging", description: "Secure internal communication", icon: MessagesSquare },
      { name: "Document Storage", description: "Organized file management", icon: FileText },
      { name: "Company Calendar", description: "Shared scheduling", icon: Calendar },
      { name: "Notifications", description: "Real-time alerts and updates", icon: AlertTriangle },
      { name: "Website Builder", description: "Professional company website", icon: Globe },
      { name: "White-Label Branding", description: "Your brand throughout", icon: Building2 }
    ]
  },
  {
    category: "Hiring & Recruiting",
    items: [
      { name: "AI Job Posting", description: "Auto-generate and post job listings", icon: BriefcaseBusiness },
      { name: "Candidate Pipeline Board", description: "Visual kanban for every applicant", icon: ListChecks },
      { name: "AI Candidate Review", description: "Resume scoring and strengths/concerns", icon: Brain },
      { name: "Interview Scheduling", description: "Automated scheduling with calendar sync", icon: Calendar },
      { name: "Hiring Analytics", description: "Track time-to-hire and pipeline metrics", icon: BarChart3 },
      { name: "Offer Management", description: "Send and track offers digitally", icon: Award }
    ]
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
    title: "AI CFO",
    description: "Financial intelligence at your fingertips. Tracks margins in real-time, forecasts cashflow, and alerts you to profitability issues before they become problems.",
    features: ["Margin Tracking", "Cashflow Forecasting", "Budget Variance Alerts", "Profitability Analysis"],
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
    description: "Analyzes your scope of work, crew availability, and historical production rates to generate realistic construction schedules. No more guessing at timelines.",
    features: ["Automatic Scheduling", "Resource Optimization", "Dependency Mapping", "Timeline Predictions"],
    image: null
  },
  {
    title: "AI Hiring Assistant",
    description: "Automates the entire recruiting workflow. AI writes and posts job listings, scores incoming resumes, highlights candidate strengths and concerns, and triggers stage-change automations so qualified workers move through your pipeline without manual effort.",
    features: ["AI Job Posting", "Resume Scoring", "Strengths & Concerns Flags", "Stage Automation"],
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
      "Vendor invites",
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
      "Website builder (basic)",
      "Unlimited projects",
      "Unlimited users",
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
      "Multiple companies under one account",
      "Cross-org analytics",
      "COO delegation mode",
      "White-glove onboarding",
      "Priority roadmap input",
      "Dedicated success manager"
    ],
    notIncluded: [],
    popular: false,
    cta: "Contact Sales"
  }
];

const addons = [
  { name: "AI PM Pack", price: 39, description: "Task generation, risk alerts, daily summaries" },
  { name: "AI CFO Pack", price: 59, description: "Margin tracking, cashflow forecasting, financial alerts" },
  { name: "AI Email Pack", price: 29, description: "Email categorization, task extraction, follow-ups" },
  { name: "AI Vision Pack", price: 79, description: "AI-powered plan takeoff and material estimation", comingSoon: true },
  { name: "Website + SEO Pack", price: 39, description: "Website builder, SEO optimization, blog & gallery" },
  { name: "Bid Network Pack", price: 49, description: "Competitive vendor bidding marketplace" },
  { name: "AI Hiring Pack", price: 49, description: "AI job posting, resume scoring, and candidate pipeline automation" }
];

const tradeTypes = [
  "Concrete", "Excavation", "Electrical", "Plumbing", "HVAC", "Roofing", 
  "Masonry", "Carpentry", "Painting", "Flooring", "Landscaping", "Fencing",
  "General Contractor", "Drywall", "Insulation", "Siding", "Windows & Doors",
  "Steel", "Demolition", "Paving", "Utilities", "Fire Protection", "Elevator"
];

export default function LandingPage() {
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleNotifySubmit = async () => {
    if (!notifyEmail.trim()) {
      toast({ title: "Please enter your email", variant: "destructive" });
      return;
    }
    
    setIsSubmitting(true);
    // Simulate submission - in production this would call an API
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    
    toast({ 
      title: "You're on the list!", 
      description: "We'll notify you when the demo video is ready." 
    });
    setNotifyEmail("");
    setShowDemoModal(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
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
              <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-ai">AI Automation</a>
              <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-pricing">Pricing</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" size="sm" data-testid="button-nav-login">
                  Log In
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" data-testid="button-nav-register">
                  Start Free Trial
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
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
              AI-Powered Construction Management
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
              Stop Losing Money on Every Project
            </h1>
            <p className="text-xl md:text-2xl text-gray-300 mb-8 leading-relaxed">
              SmartManageAI replaces spreadsheets, sticky notes, and scattered tools with one AI-powered platform. Track production rates, automate change orders, and finally know where your money goes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto" data-testid="button-hero-trial">
                  Start Free 14-Day Trial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Button 
                size="lg" 
                variant="secondary" 
                className="w-full sm:w-auto bg-white/10 border-white/30 text-white" 
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
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By / Trade Types */}
      <section className="py-12 bg-muted/30 border-y">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-muted-foreground mb-6">
            PURPOSE-BUILT FOR 23 CONSTRUCTION TRADES
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {tradeTypes.slice(0, 12).map((trade) => (
              <Badge key={trade} variant="outline" className="px-3 py-1">
                {trade}
              </Badge>
            ))}
            <Badge variant="secondary" className="px-3 py-1">
              +11 more
            </Badge>
          </div>
        </div>
      </section>

      {/* Pain Points Section */}
      <section className="py-20 md:py-28" id="problems">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge variant="destructive" className="mb-4">Sound Familiar?</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              The Hidden Costs Killing Your Profits
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Construction companies lose an average of 5-10% of revenue to inefficiencies. Here's where the money goes.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {painPoints.map((point, index) => (
              <Card key={index} className="border-destructive/20 bg-destructive/5">
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
            ))}
          </div>
        </div>
      </section>

      {/* Solution Section */}
      <section className="py-20 md:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge variant="default" className="mb-4">The SmartManageAI Solution</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              AI Automation That Actually Works
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every pain point has a solution. Here's how SmartManageAI transforms your operations.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {solutions.map((solution, index) => (
              <Card key={index} className="relative overflow-hidden">
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
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 md:py-28" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4">Complete Platform</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Everything You Need to Run Your Business
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Replace 6+ apps with one integrated platform. From bids to billing, crews to change orders.
            </p>
          </div>
          <div className="space-y-12">
            {features.map((category, catIndex) => (
              <div key={catIndex}>
                <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  {category.category}
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {category.items.map((feature, featIndex) => (
                    <div key={featIndex} className="flex items-start gap-3 p-4 rounded-lg border bg-card hover-elevate">
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
            ))}
          </div>
        </div>
      </section>

      {/* AI Deep Dive */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-primary/5 to-background" id="ai">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-primary/20">
              <Sparkles className="w-3 h-3 mr-1" />
              Powered by AI
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Your AI Construction Team
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Like having a senior PM, CFO, and estimator working around the clock. AI that understands construction.
            </p>
          </div>
          <div className="space-y-12">
            {aiCapabilities.map((capability, index) => (
              <div key={index} className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-8 items-center`}>
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
                    <div className="aspect-video rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <Brain className="w-16 h-16 text-primary/40" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technology Section */}
      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                    <h3 className="font-semibold mb-1">GPS Time Clock</h3>
                    <p className="text-muted-foreground">Crews clock in from the jobsite. No more buddy punching or timesheet disputes.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Camera className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Photo Documentation</h3>
                    <p className="text-muted-foreground">Capture progress photos linked to daily reports. Build an automatic project record.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Offline Mode</h3>
                    <p className="text-muted-foreground">Keep working without internet. Data syncs automatically when you're back online.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 md:py-28 bg-muted/30" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4">Simple Pricing</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Plans That Grow With You
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Start with what you need. Add AI capabilities as you grow. No long-term contracts.
            </p>
          </div>
          
          {/* Pricing Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {plans.map((plan, index) => (
              <Card key={index} className={`relative ${plan.popular ? 'border-primary shadow-lg scale-105' : ''}`}>
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
                  <Link href="/register" className="w-full">
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
            ))}
          </div>

          {/* Add-ons */}
          <div className="mt-16">
            <h3 className="text-2xl font-bold text-center mb-8">Power Up With AI Add-Ons</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
              {addons.map((addon, index) => (
                <div key={index} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{addon.name}</h4>
                      {(addon as any).comingSoon && (
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{addon.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <span className="text-lg font-bold">+${addon.price}</span>
                    <span className="text-sm text-muted-foreground">/mo</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
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
          <p className="text-xl text-gray-300 mb-8">
            Join contractors who've stopped guessing and started knowing. 14-day free trial, no credit card required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" data-testid="button-cta-trial">
                Start Your Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button size="lg" variant="secondary" className="bg-white/10 border-white/30 text-white" data-testid="button-cta-demo">
              Schedule a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
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
              <p className="text-sm text-muted-foreground">
                AI-powered construction management for contractors who want to build profitably.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">Features</a></li>
                <li><a href="#ai" className="hover:text-foreground">AI Automation</a></li>
                <li><a href="#pricing" className="hover:text-foreground">Pricing</a></li>
                <li><a href="#" className="hover:text-foreground">Integrations</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Trades</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Concrete</a></li>
                <li><a href="#" className="hover:text-foreground">General Contractor</a></li>
                <li><a href="#" className="hover:text-foreground">Electrical</a></li>
                <li><a href="#" className="hover:text-foreground">All 23 Trades</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">About</a></li>
                <li><a href="#" className="hover:text-foreground">Contact</a></li>
                <li><a href="#" className="hover:text-foreground">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-foreground">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} SmartManageAI. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Demo Coming Soon Modal */}
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
