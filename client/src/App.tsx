import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import BidsPage from "@/pages/bids";
import BidDetailPage from "@/pages/bid-detail";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import TimeEntryPage from "@/pages/time-entry";
import TMDailyPage from "@/pages/tm-daily";

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/login" />} />
      <Route path="/login" component={LoginPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/bids" component={BidsPage} />
      <Route path="/bids/:code" component={BidDetailPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/:code" component={ProjectDetailPage} />
      <Route path="/time-entry" component={TimeEntryPage} />
      <Route path="/tm-daily" component={TMDailyPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
