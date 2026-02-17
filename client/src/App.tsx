import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { DashboardCustomizationProvider } from "@/hooks/use-dashboard-customization";
import { RoutePermissions } from "@/lib/rbac";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import TopHeader from "@/components/TopHeader";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import RegisterPage from "@/pages/register";
import ImpersonatePage from "@/pages/impersonate";
import DashboardPage from "@/pages/dashboard";
import ProfilePage from "@/pages/profile";
import UsersPage from "@/pages/users";
import BidsPage from "@/pages/bids";
import BidDetailPage from "@/pages/bid-detail";
import BidEstimate from "@/pages/bid-estimate";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import TimeEntryPage from "@/pages/time-entry";
import TMDailyPage from "@/pages/tm-daily";
import TMBillingPage from "@/pages/tm-billing";
import CalendarPage from "@/pages/calendar";
import TimeClockPage from "@/pages/time-clock";
import TimeClockManagerPage from "@/pages/time-clock-manager";
import AIPMDashboard from "@/pages/ai-pm-dashboard";
import CFODashboard from "@/pages/cfo-dashboard";
import AISettingsPage from "@/pages/ai-settings";
import CrewsPage from "@/pages/crews";
import CostRatesPage from "@/pages/cost-rates";
import SubcontractorPayablesPage from "@/pages/subcontractor-payables";
import CompanyCommunicationsPage from "@/pages/company-communications";
import TasksPage from "@/pages/tasks";
import ProductionRatesPage from "@/pages/production-rates";
import CRMPage from "@/pages/crm";
import ScopeSettingsPage from "@/pages/scope-settings";
import MessagesPage from "@/pages/messages";
import EquipmentPage from "@/pages/equipment";
import EquipmentDetailPage from "@/pages/equipment-detail";
import OnboardingPage from "@/pages/onboarding";
import PlatformAdminDashboard from "@/pages/PlatformAdminDashboard";
import PlatformOrganizations from "@/pages/PlatformOrganizations";
import PlatformOrganizationDetail from "@/pages/PlatformOrganizationDetail";
import PlatformAnalytics from "@/pages/PlatformAnalytics";
import PlatformSupportTools from "@/pages/PlatformSupportTools";
import PlatformAuditDashboard from "@/pages/PlatformAuditDashboard";
import VendorPricingPage from "@/pages/vendor-pricing";
import MobileSyncPage from "@/pages/mobile-sync";
import CompanySettingsPage from "@/pages/company-settings";
import AIAssistantWidget from "@/components/AIAssistantWidget";
import { FirstTimeWelcomeModal } from "@/components/FirstTimeWelcomeModal";
import { TourProvider } from "@/components/TourProvider";
import VendorDashboard from "@/pages/vendor/index";
import VendorPortalPricing from "@/pages/vendor/pricing";
import VendorClients from "@/pages/vendor/clients";
import AIBidAnalysisPage from "@/pages/ai-bid-analysis";
import AIContractAnalysisPage from "@/pages/ai-contract-analysis";
import ScheduleOfValuesPage from "@/pages/schedule-of-values";
import SubcontractsPage from "@/pages/subcontracts";
import RFIsPage from "@/pages/rfis";
import TransmittalsPage from "@/pages/transmittals";
import SubmittalsPage from "@/pages/submittals";
import WebsiteBuilderPage from "@/pages/website-builder";
import BidWizardPage from "@/pages/bid-wizard";
import EmailAssistantPage from "@/pages/email-assistant";
import HustlerDashboard from "@/pages/hustler-dashboard";
import HustlerOrgDetail from "@/pages/hustler-org-detail";
import HustlerUnifiedInbox from "@/pages/hustler-unified-inbox";
import HustlerBenchmarking from "@/pages/hustler-benchmarking";
import BidNetworkPage from "@/pages/bid-network";
import BidNetworkDetailPage from "@/pages/bid-network-detail";
import BidInboxPage from "@/pages/bid-inbox";
import BillingPage from "@/pages/billing";
import DelayClaimsPage from "@/pages/delay-claims";
import DailyReportLocksPage from "@/pages/daily-report-locks";
import PhotoCustodyPage from "@/pages/photo-custody";
import VoiceLogsPage from "@/pages/voice-logs";
import IssueCapturesPage from "@/pages/issue-captures";
import OfflineSyncPage from "@/pages/offline-sync";
import PublicWebsite from "@/pages/public-website";
import SharedPreviewPage from "@/pages/shared-preview";
import VendorScoresPage from "@/pages/vendor-scores";
import MaterialPriceIndexPage from "@/pages/material-price-index";
import CrewMarketplacePage from "@/pages/crew-marketplace";
import PricebookImportPage from "@/pages/pricebook-import";
import ClientPortalPublic from "@/pages/client-portal-public";
import SubPortalPage from "@/pages/sub-portal";
import PortalChatPage from "@/pages/portal-chat";
import CompanyHealthPage from "@/pages/company-health";
import ExecutiveDigestPage from "@/pages/executive-digest";
import WhatIfSimulatorPage from "@/pages/what-if-simulator";
import CalculatorPage from "@/pages/calculator";
import PerformancePage from "@/pages/performance";
import { VendorRoutePermissions } from "@/lib/rbac";

function ProtectedRoute({ 
  component: Component,
  permission,
  skipOnboardingCheck = false
}: { 
  component: () => JSX.Element | null;
  permission?: (role?: string) => boolean;
  skipOnboardingCheck?: boolean;
}) {
  const { user, isLoading, organizationOnboardingStatus } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />;
  }

  // Check if user needs onboarding:
  // 1. No organization assigned, OR
  // 2. Organization exists but AI wizard onboarding not completed
  // Skip this check for the onboarding page itself
  if (!skipOnboardingCheck && location !== '/onboarding') {
    // No org - needs onboarding
    if (!user.organizationId) {
      return <Redirect to="/onboarding" />;
    }
    // Has org but AI wizard not completed - needs to finish onboarding first
    if (organizationOnboardingStatus && organizationOnboardingStatus !== 'COMPLETED') {
      return <Redirect to="/onboarding" />;
    }
  }

  // Check role-based permission if provided
  if (permission && !permission(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h2 className="text-2xl font-bold text-destructive">Access Denied</h2>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
          <Link 
            href="/dashboard" 
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            data-testid="link-return-dashboard"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <Component />;
}

function Router() {
  const { user, isLoading } = useAuth();
  
  return (
    <Switch>
      <Route path="/" component={() => {
        if (isLoading) {
          return (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-muted-foreground">Loading...</div>
            </div>
          );
        }
        return user ? <Redirect to="/dashboard" /> : <LandingPage />;
      }} />
      <Route path="/login" component={LoginPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/impersonate" component={ImpersonatePage} />
      <Route path="/site/:subdomain" component={PublicWebsite} />
      <Route path="/shared-preview/:token" component={SharedPreviewPage} />
      <Route path="/portal/:projectId" component={ClientPortalPublic} />
      <Route path="/sub-portal" component={SubPortalPage} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={OnboardingPage} skipOnboardingCheck />} />
      
      {/* Routes accessible to all authenticated users */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:code" component={() => <ProtectedRoute component={ProjectDetailPage} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} />} />
      <Route path="/communications" component={() => <ProtectedRoute component={CompanyCommunicationsPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} />} />
      <Route path="/time-clock" component={() => <ProtectedRoute component={TimeClockPage} />} />
      <Route path="/messages" component={() => <ProtectedRoute component={MessagesPage} />} />
      <Route path="/portal-chat" component={() => <ProtectedRoute component={PortalChatPage} />} />
      
      {/* Admin-only routes */}
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} permission={RoutePermissions.USERS} />} />
      <Route path="/ai-settings" component={() => <ProtectedRoute component={AISettingsPage} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/cost-rates" component={() => <ProtectedRoute component={CostRatesPage} permission={RoutePermissions.COST_RATES} />} />
      <Route path="/crews" component={() => <ProtectedRoute component={CrewsPage} permission={RoutePermissions.CREWS} />} />
      <Route path="/subcontractor-payables" component={() => <ProtectedRoute component={SubcontractorPayablesPage} permission={RoutePermissions.SUBCONTRACTOR_PAYABLES} />} />
      <Route path="/company-settings" component={() => <ProtectedRoute component={CompanySettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      
      {/* Management routes (blocked for hourly employees) */}
      <Route path="/bids/new" component={() => <ProtectedRoute component={BidWizardPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids" component={() => <ProtectedRoute component={BidsPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids/:code/estimate" component={() => <ProtectedRoute component={BidEstimate} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/bids/:code" component={() => <ProtectedRoute component={BidDetailPage} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/time-entry" component={() => <ProtectedRoute component={TimeEntryPage} permission={RoutePermissions.TIME_ENTRY} />} />
      <Route path="/tm-daily" component={() => <ProtectedRoute component={TMDailyPage} permission={RoutePermissions.TM_DAILY} />} />
      <Route path="/tm-billing" component={() => <ProtectedRoute component={TMBillingPage} permission={RoutePermissions.TM_BILLING} />} />
      <Route path="/time-clock-manager" component={() => <ProtectedRoute component={TimeClockManagerPage} permission={RoutePermissions.TIME_CLOCK_MANAGER} />} />
      <Route path="/ai-pm" component={() => <ProtectedRoute component={AIPMDashboard} permission={RoutePermissions.AI_PM} />} />
      <Route path="/cfo" component={() => <ProtectedRoute component={CFODashboard} permission={RoutePermissions.CFO} />} />
      <Route path="/production-rates" component={() => <ProtectedRoute component={ProductionRatesPage} permission={RoutePermissions.PRODUCTION_RATES} />} />
      <Route path="/crm" component={() => <ProtectedRoute component={CRMPage} permission={RoutePermissions.CRM} />} />
      <Route path="/scope-settings" component={() => <ProtectedRoute component={ScopeSettingsPage} permission={RoutePermissions.SCOPE_SETTINGS} />} />
      <Route path="/equipment/:code" component={() => <ProtectedRoute component={EquipmentDetailPage} permission={RoutePermissions.EQUIPMENT} />} />
      <Route path="/equipment" component={() => <ProtectedRoute component={EquipmentPage} permission={RoutePermissions.EQUIPMENT} />} />
      <Route path="/rental-vendors" component={() => <Redirect to="/crm" />} />
      <Route path="/vendor-pricing" component={() => <ProtectedRoute component={VendorPricingPage} permission={RoutePermissions.CRM} />} />
      <Route path="/mobile-sync" component={() => <ProtectedRoute component={MobileSyncPage} />} />
      
      {/* AI Analysis routes */}
      <Route path="/ai-bid-analysis" component={() => <ProtectedRoute component={AIBidAnalysisPage} permission={RoutePermissions.AI_BID_ANALYSIS} />} />
      <Route path="/ai-contract-analysis" component={() => <ProtectedRoute component={AIContractAnalysisPage} permission={RoutePermissions.AI_CONTRACT_ANALYSIS} />} />
      
      {/* Delay Claims routes */}
      <Route path="/delay-claims" component={() => <ProtectedRoute component={DelayClaimsPage} permission={RoutePermissions.DELAY_CLAIMS} />} />
      <Route path="/daily-report-locks" component={() => <ProtectedRoute component={DailyReportLocksPage} permission={RoutePermissions.DAILY_REPORT_LOCKS} />} />
      <Route path="/photo-custody" component={() => <ProtectedRoute component={PhotoCustodyPage} permission={RoutePermissions.PHOTO_CUSTODY} />} />
      
      {/* Field Productivity routes */}
      <Route path="/voice-logs" component={() => <ProtectedRoute component={VoiceLogsPage} />} />
      <Route path="/issue-captures" component={() => <ProtectedRoute component={IssueCapturesPage} />} />
      <Route path="/offline-sync" component={() => <ProtectedRoute component={OfflineSyncPage} />} />
      
      {/* Marketplace routes */}
      <Route path="/vendor-scores" component={() => <ProtectedRoute component={VendorScoresPage} permission={RoutePermissions.CRM} />} />
      <Route path="/material-price-index" component={() => <ProtectedRoute component={MaterialPriceIndexPage} permission={RoutePermissions.CRM} />} />
      <Route path="/crew-marketplace" component={() => <ProtectedRoute component={CrewMarketplacePage} permission={RoutePermissions.CRM} />} />
      <Route path="/pricebook-import" component={() => <ProtectedRoute component={PricebookImportPage} permission={RoutePermissions.CRM} />} />
      
      {/* Executive Intelligence routes */}
      <Route path="/company-health" component={() => <ProtectedRoute component={CompanyHealthPage} permission={RoutePermissions.CFO} />} />
      <Route path="/executive-digest" component={() => <ProtectedRoute component={ExecutiveDigestPage} permission={RoutePermissions.CFO} />} />
      <Route path="/what-if-simulator" component={() => <ProtectedRoute component={WhatIfSimulatorPage} permission={RoutePermissions.CFO} />} />
      
      {/* Bid Network routes */}
      <Route path="/bid-network/:id" component={() => <ProtectedRoute component={BidNetworkDetailPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bid-network" component={() => <ProtectedRoute component={BidNetworkPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bid-inbox/:id" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bid-inbox" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BIDS} />} />
      
      {/* Tools routes */}
      <Route path="/calculator" component={() => <ProtectedRoute component={CalculatorPage} />} />
      <Route path="/performance" component={() => <ProtectedRoute component={PerformancePage} permission={RoutePermissions.PERFORMANCE} />} />
      <Route path="/schedule-of-values" component={() => <ProtectedRoute component={ScheduleOfValuesPage} permission={RoutePermissions.SCHEDULE_OF_VALUES} />} />
      <Route path="/subcontracts" component={() => <ProtectedRoute component={SubcontractsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/rfis" component={() => <ProtectedRoute component={RFIsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/transmittals" component={() => <ProtectedRoute component={TransmittalsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/submittals" component={() => <ProtectedRoute component={SubmittalsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/website-builder" component={() => <ProtectedRoute component={WebsiteBuilderPage} permission={RoutePermissions.WEBSITE_BUILDER} />} />
      <Route path="/email-assistant" component={() => <ProtectedRoute component={EmailAssistantPage} />} />
      <Route path="/billing" component={() => <ProtectedRoute component={BillingPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      
      {/* Vendor Portal routes (VENDOR only) */}
      <Route path="/vendor/pricing" component={() => <ProtectedRoute component={VendorPortalPricing} permission={VendorRoutePermissions.VENDOR_PRICING} skipOnboardingCheck />} />
      <Route path="/vendor/clients" component={() => <ProtectedRoute component={VendorClients} permission={VendorRoutePermissions.VENDOR_CLIENTS} skipOnboardingCheck />} />
      <Route path="/vendor" component={() => <ProtectedRoute component={VendorDashboard} permission={VendorRoutePermissions.VENDOR_DASHBOARD} skipOnboardingCheck />} />
      
      {/* Platform Admin routes (SUPER_ADMIN only) */}
      <Route path="/admin" component={() => <ProtectedRoute component={PlatformAdminDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations/:id" component={() => <ProtectedRoute component={PlatformOrganizationDetail} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations" component={() => <ProtectedRoute component={PlatformOrganizations} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/analytics" component={() => <ProtectedRoute component={PlatformAnalytics} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/support" component={() => <ProtectedRoute component={PlatformSupportTools} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/audit" component={() => <ProtectedRoute component={PlatformAuditDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      
      {/* Hustler Multi-Organization routes (HUSTLER only) */}
      <Route path="/hustler/inbox" component={() => <ProtectedRoute component={HustlerUnifiedInbox} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      <Route path="/hustler/benchmarking" component={() => <ProtectedRoute component={HustlerBenchmarking} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      <Route path="/hustler/org/:orgId" component={() => <ProtectedRoute component={HustlerOrgDetail} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      <Route path="/hustler" component={() => <ProtectedRoute component={HustlerDashboard} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }
  
  if (!user) {
    return <>{children}</>;
  }

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <AppSidebar />
      <SidebarInset className="flex flex-col min-h-screen">
        <TopHeader />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { user, isLoading } = useAuth();
  
  const isPublicRoute = ['/', '/login', '/register', '/forgot-password', '/reset-password'].some(
    route => location === route || (route !== '/' && location.startsWith(route))
  ) || location.startsWith('/site/') || location.startsWith('/sub-portal');
  
  if (isPublicRoute && !user) {
    return <Router />;
  }
  
  return (
    <AuthenticatedLayout>
      <Router />
    </AuthenticatedLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TourProvider>
          <DashboardCustomizationProvider>
            <TooltipProvider>
              <Toaster />
              <AppContent />
              <FirstTimeWelcomeModal />
              <AIAssistantWidget />
            </TooltipProvider>
          </DashboardCustomizationProvider>
        </TourProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
