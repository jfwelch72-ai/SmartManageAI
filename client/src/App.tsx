import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import UsersPage from "@/pages/users";
import BidsPage from "@/pages/bids";
import BidDetailPage from "@/pages/bid-detail";
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

function ProtectedRoute({ component: Component }: { component: () => JSX.Element | null }) {
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

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />
      <Route path="/bids" component={() => <ProtectedRoute component={BidsPage} />} />
      <Route path="/bids/:code" component={() => <ProtectedRoute component={BidDetailPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:code" component={() => <ProtectedRoute component={ProjectDetailPage} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} />} />
      <Route path="/time-entry" component={() => <ProtectedRoute component={TimeEntryPage} />} />
      <Route path="/tm-daily" component={() => <ProtectedRoute component={TMDailyPage} />} />
      <Route path="/time-clock" component={() => <ProtectedRoute component={TimeClockPage} />} />
      <Route path="/time-clock-manager" component={() => <ProtectedRoute component={TimeClockManagerPage} />} />
      <Route path="/ai-pm" component={() => <ProtectedRoute component={AIPMDashboard} />} />
      <Route path="/cfo" component={() => <ProtectedRoute component={CFODashboard} />} />
      <Route path="/ai-settings" component={() => <ProtectedRoute component={AISettingsPage} />} />
      <Route path="/crews" component={() => <ProtectedRoute component={CrewsPage} />} />
      <Route path="/cost-rates" component={() => <ProtectedRoute component={CostRatesPage} />} />
      <Route path="/subcontractor-payables" component={() => <ProtectedRoute component={SubcontractorPayablesPage} />} />
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
