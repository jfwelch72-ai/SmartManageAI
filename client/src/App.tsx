import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { RoutePermissions } from "@/lib/rbac";
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
import AIAssistantWidget from "@/components/AIAssistantWidget";

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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
          <AIAssistantWidget />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
