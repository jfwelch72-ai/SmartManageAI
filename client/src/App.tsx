import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { RoutePermissions } from "@/lib/rbac";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import TopHeader from "@/components/TopHeader";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import UsersPage from "@/pages/users";
import BidsPage from "@/pages/bids";
import BidDetailPage from "@/pages/bid-detail";
import BidEstimate from "@/pages/bid-estimate";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import TimeEntryPage from "@/pages/time-entry";
import TMDailyPage from "@/pages/tm-daily";
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
import VendorPricingPage from "@/pages/vendor-pricing";
import MobileSyncPage from "@/pages/mobile-sync";
import CompanySettingsPage from "@/pages/company-settings";
import AIAssistantWidget from "@/components/AIAssistantWidget";
import VendorDashboard from "@/pages/vendor/index";
import VendorPortalPricing from "@/pages/vendor/pricing";
import VendorClients from "@/pages/vendor/clients";
import AIBidAnalysisPage from "@/pages/ai-bid-analysis";
import AIContractAnalysisPage from "@/pages/ai-contract-analysis";
import ScheduleOfValuesPage from "@/pages/schedule-of-values";
import SubcontractsPage from "@/pages/subcontracts";
import WebsiteBuilderPage from "@/pages/website-builder";
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
  const { user, isLoading } = useAuth();
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

  // Check if user needs onboarding (no organization assigned)
  // Skip this check for the onboarding page itself
  if (!skipOnboardingCheck && !user.organizationId && location !== '/onboarding') {
    return <Redirect to="/onboarding" />;
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
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/login" component={LoginPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={OnboardingPage} skipOnboardingCheck />} />
      
      {/* Routes accessible to all authenticated users */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:code" component={() => <ProtectedRoute component={ProjectDetailPage} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} />} />
      <Route path="/communications" component={() => <ProtectedRoute component={CompanyCommunicationsPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} />} />
      <Route path="/time-clock" component={() => <ProtectedRoute component={TimeClockPage} />} />
      <Route path="/messages" component={() => <ProtectedRoute component={MessagesPage} />} />
      
      {/* Admin-only routes */}
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} permission={RoutePermissions.USERS} />} />
      <Route path="/ai-settings" component={() => <ProtectedRoute component={AISettingsPage} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/cost-rates" component={() => <ProtectedRoute component={CostRatesPage} permission={RoutePermissions.COST_RATES} />} />
      <Route path="/crews" component={() => <ProtectedRoute component={CrewsPage} permission={RoutePermissions.CREWS} />} />
      <Route path="/subcontractor-payables" component={() => <ProtectedRoute component={SubcontractorPayablesPage} permission={RoutePermissions.SUBCONTRACTOR_PAYABLES} />} />
      <Route path="/company-settings" component={() => <ProtectedRoute component={CompanySettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      
      {/* Management routes (blocked for hourly employees) */}
      <Route path="/bids" component={() => <ProtectedRoute component={BidsPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids/:code/estimate" component={() => <ProtectedRoute component={BidEstimate} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/bids/:code" component={() => <ProtectedRoute component={BidDetailPage} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/time-entry" component={() => <ProtectedRoute component={TimeEntryPage} permission={RoutePermissions.TIME_ENTRY} />} />
      <Route path="/tm-daily" component={() => <ProtectedRoute component={TMDailyPage} permission={RoutePermissions.TM_DAILY} />} />
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
      
      {/* Tools routes */}
      <Route path="/schedule-of-values" component={() => <ProtectedRoute component={ScheduleOfValuesPage} permission={RoutePermissions.SCHEDULE_OF_VALUES} />} />
      <Route path="/subcontracts" component={() => <ProtectedRoute component={SubcontractsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/website-builder" component={() => <ProtectedRoute component={WebsiteBuilderPage} permission={RoutePermissions.WEBSITE_BUILDER} />} />
      
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
  const isPublicRoute = ['/login', '/register', '/forgot-password', '/reset-password'].some(
    route => location.startsWith(route)
  );
  
  if (isPublicRoute) {
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
        <TooltipProvider>
          <Toaster />
          <AppContent />
          <AIAssistantWidget />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
