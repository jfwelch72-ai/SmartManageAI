import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { RoutePermissions } from "@/lib/rbac";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
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

function ProtectedRoute({ 
  component: Component,
  permission
}: { 
  component: () => JSX.Element | null;
  permission?: (role?: string) => boolean;
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
      <Route path="/register" component={RegisterPage} />
      
      {/* Routes accessible to all authenticated users */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:code" component={() => <ProtectedRoute component={ProjectDetailPage} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} />} />
      <Route path="/communications" component={() => <ProtectedRoute component={CompanyCommunicationsPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} />} />
      <Route path="/time-clock" component={() => <ProtectedRoute component={TimeClockPage} />} />
      
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
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
