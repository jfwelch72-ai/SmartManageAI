import React, { lazy, Suspense, Component, type ErrorInfo, type ReactNode } from "react";
import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { TableDensityProvider } from "@/hooks/use-table-density";
import { DashboardCustomizationProvider, useDashboardCustomization, type FeaturePermissionKey } from "@/hooks/use-dashboard-customization";
import { RoutePermissions } from "@/lib/rbac";
import { useFeatureFlags as useFeatureFlagsHook } from "@/hooks/use-feature-flags";
import type { FeatureFlagKey } from "@shared/schema";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught a rendering error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/dashboard";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="error-boundary-fallback">
          <div className="text-center space-y-6 max-w-md">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-muted-foreground">
              An unexpected error occurred. Please try reloading the page.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                data-testid="button-reload-page"
              >
                Reload Page
              </button>
              <button
                onClick={this.handleGoHome}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90"
                data-testid="button-go-dashboard"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import TopHeader from "@/components/TopHeader";
import { CommandPaletteProvider } from "@/components/CommandPalette";
import { KeyboardShortcutsProvider } from "@/components/KeyboardShortcutsHelp";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";
import PushNotificationBanner from "@/components/PushNotificationBanner";
import OfflineStatusBanner from "@/components/OfflineStatusBanner";
const VoiceDictation = lazy(() => import("@/components/VoiceDictation"));
import NotFound from "@/pages/not-found";
const LandingPage = lazy(() => import("@/pages/landing"));
import LoginPage from "@/pages/login";
import SchedulePrintPage from "@/pages/SchedulePrintPage";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import RegisterPage from "@/pages/register";
const AIAssistantWidget = lazy(() => import("@/components/AIAssistantWidget"));
const MessagingWidget = lazy(() => import("@/components/MessagingWidget"));
import { FirstTimeWelcomeModal } from "@/components/FirstTimeWelcomeModal";
import { GlobalIncomingCallModal } from "@/components/GlobalIncomingCallModal";
import { useGlobalCallEvents } from "@/hooks/use-global-call-events";
import { TourProvider } from "@/components/TourProvider";
import { GlobalVideoCallProvider, useGlobalVideoCall } from "@/contexts/GlobalVideoCallContext";
import { GlobalSSEProvider } from "@/contexts/GlobalSSEContext";
import { VideoCallOverlay } from "@/components/messaging/VideoCallOverlay";
import { VendorRoutePermissions } from "@/lib/rbac";

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" data-testid="lazy-loading-fallback">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

const ImpersonatePage = lazy(() => import("@/pages/impersonate"));
const AcceptHustlerInvitePage = lazy(() => import("@/pages/accept-hustler-invite"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const BidsPage = lazy(() => import("@/pages/bids"));
const BidDetailPage = lazy(() => import("@/pages/bid-detail"));
const BidEstimate = lazy(() => import("@/pages/bid-estimate"));
const HistoricalCostsPage = lazy(() => import("@/pages/historical-costs"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail"));
const TimeEntryPage = lazy(() => import("@/pages/time-entry"));
const TMDailyPage = lazy(() => import("@/pages/tm-daily"));
const TMBillingPage = lazy(() => import("@/pages/tm-billing"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const LeaveManagementPage = lazy(() => import("@/pages/leave-management"));
const TimeClockPage = lazy(() => import("@/pages/time-clock"));
const TimeClockManagerPage = lazy(() => import("@/pages/time-clock-manager"));
const AISettingsPage = lazy(() => import("@/pages/ai-settings"));
const CrewsPage = lazy(() => import("@/pages/crews"));
const DispatchBoardPage = lazy(() => import("@/pages/dispatch-board"));
const CostRatesPage = lazy(() => import("@/pages/cost-rates"));
const CompanyCommunicationsPage = lazy(() => import("@/pages/company-communications"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const DailyReportsPage = lazy(() => import("@/pages/daily-reports"));
const CRMPage = lazy(() => import("@/pages/crm"));
const CrmSettingsPage = lazy(() => import("@/pages/crm-settings"));
const CrmDealDetailPage = lazy(() => import("@/pages/crm-deal-detail"));
const SequencesPage = lazy(() => import("@/pages/sequences"));
const SequenceDetailPage = lazy(() => import("@/pages/sequence-detail"));
const PublicLeadFormPage = lazy(() => import("@/pages/public-lead-form"));
const PublicFormPage = lazy(() => import("@/pages/public-form"));
const PublicBookingPage = lazy(() => import("@/pages/public-booking"));
const CrmUpgradesPage = lazy(() => import("@/pages/crm-upgrades"));
const FieldSalesPage = lazy(() => import("@/pages/field-sales"));
const PublicQuoteAcceptPage = lazy(() => import("@/pages/public-quote-accept"));
const ScopeSettingsPage = lazy(() => import("@/pages/scope-settings"));
const EquipmentPage = lazy(() => import("@/pages/equipment"));
const EquipmentDetailPage = lazy(() => import("@/pages/equipment-detail"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const PlatformAdminDashboard = lazy(() => import("@/pages/PlatformAdminDashboard"));
const DotLibraryPage = lazy(() => import("@/pages/DotLibraryPage"));
const HaulTicketsPage = lazy(() => import("@/pages/haul-tickets"));
const DailyInspectorReportsPage = lazy(() => import("@/pages/daily-inspector-reports"));
const SwpppInspectionsPage = lazy(() => import("@/pages/swppp-inspections"));
const SuretyBondsPage = lazy(() => import("@/pages/surety-bonds"));
const DbeGoalsPage = lazy(() => import("@/pages/dbe-goals"));
const MaterialCertificationsPage = lazy(() => import("@/pages/material-certifications"));
const PlatformOrganizations = lazy(() => import("@/pages/PlatformOrganizations"));
const PlatformOrganizationDetail = lazy(() => import("@/pages/PlatformOrganizationDetail"));
const PlatformAnalyticsMonitoring = lazy(() => import("@/pages/PlatformAnalyticsMonitoring"));
const PlatformTools = lazy(() => import("@/pages/PlatformTools"));
const GanttPdfHealth = lazy(() => import("@/pages/GanttPdfHealth"));
const JobMetricsHealth = lazy(() => import("@/pages/JobMetricsHealth"));
const JobMetricsDashboard = lazy(() => import("@/pages/JobMetricsDashboard"));
const VendorPricingPage = lazy(() => import("@/pages/vendor-pricing"));
const MobileSyncPage = lazy(() => import("@/pages/mobile-sync"));
const CompanySettingsPage = lazy(() => import("@/pages/company-settings"));
const VendorAnalytics = lazy(() => import("@/pages/vendor/index"));
const VendorPortalPricing = lazy(() => import("@/pages/vendor/pricing"));
const VendorClients = lazy(() => import("@/pages/vendor/clients"));
const VendorMessages = lazy(() => import("@/pages/vendor/messages"));
const VendorDocuments = lazy(() => import("@/pages/vendor/documents"));
const VendorCompliance = lazy(() => import("@/pages/vendor/compliance"));
const VendorPurchaseOrders = lazy(() => import("@/pages/vendor/purchase-orders"));
const VendorSchedule = lazy(() => import("@/pages/vendor/schedule"));
const ViewAsOrganization = lazy(() => import("@/pages/view-as-organization"));
const SubcontractsPage = lazy(() => import("@/pages/subcontracts"));
const SocialMediaPage = lazy(() => import("@/pages/social-media"));
const BidWizardPage = lazy(() => import("@/pages/bid-wizard"));
const EmailAssistantPage = lazy(() => import("@/pages/email-assistant"));
const EmailCampaignsPage = lazy(() => import("@/pages/email-campaigns"));
const HustlerDashboard = lazy(() => import("@/pages/hustler-dashboard"));
const HustlerOrgDetail = lazy(() => import("@/pages/hustler-org-detail"));
const HustlerUnifiedInbox = lazy(() => import("@/pages/hustler-unified-inbox"));
const HustlerBenchmarking = lazy(() => import("@/pages/hustler-benchmarking"));
const BidNetworkPage = lazy(() => import("@/pages/bid-network"));
const BidNetworkDetailPage = lazy(() => import("@/pages/bid-network-detail"));
const BidInboxPage = lazy(() => import("@/pages/bid-inbox"));
const MarketplacePage = lazy(() => import("@/pages/marketplace").then(m => ({ default: m.default })));
const ContractorProfilePage = lazy(() => import("@/pages/marketplace").then(m => ({ default: m.ContractorProfilePage })));
const BillingPage = lazy(() => import("@/pages/billing"));
const DailyReportLocksPage = lazy(() => import("@/pages/daily-report-locks"));
const IssueCapturesPage = lazy(() => import("@/pages/issue-captures"));
const OfflineSyncPage = lazy(() => import("@/pages/offline-sync"));
const PublicWebsite = lazy(() => import("@/pages/public-website"));
const SharedPreviewPage = lazy(() => import("@/pages/shared-preview"));
const VendorScoresPage = lazy(() => import("@/pages/vendor-scores"));
const MaterialPriceIndexPage = lazy(() => import("@/pages/material-price-index"));
const CrewMarketplacePage = lazy(() => import("@/pages/crew-marketplace"));
const EquipmentRentalMarketplacePage = lazy(() => import("@/pages/equipment-rental-marketplace"));
const PricebookImportPage = lazy(() => import("@/pages/pricebook-import"));
const ClientPortalPublic = lazy(() => import("@/pages/client-portal-public"));
const SubPortalPage = lazy(() => import("@/pages/sub-portal"));
const UnifiedPortal = lazy(() => import("@/pages/unified-portal"));
const RfqResponsePage = lazy(() => import("@/pages/rfq-response"));
const CompanyHealthPage = lazy(() => import("@/pages/company-health"));
const ExecutiveDigestPage = lazy(() => import("@/pages/executive-digest"));
const WhatIfSimulatorPage = lazy(() => import("@/pages/what-if-simulator"));
const CalculatorPage = lazy(() => import("@/pages/calculator"));
const LidarScansPage = lazy(() => import("@/pages/lidar-scans"));
const PermitsPage = lazy(() => import("@/pages/permits"));
const CompliancePage = lazy(() => import("@/pages/CompliancePage"));
const ManageWorkersPage = lazy(() => import("@/pages/manage-workers"));
const WorkerDetailPage = lazy(() => import("@/pages/worker-detail"));
const PayrollManagementPage = lazy(() => import("@/pages/payroll-management"));
const OvertimeRulesPage = lazy(() => import("@/pages/overtime-rules"));
const ApprovalsPage = lazy(() => import("@/pages/approvals"));
const AIGovernancePage = lazy(() => import("@/pages/ai-governance"));
const AuditLogsPage = lazy(() => import("@/pages/audit-logs"));
const DeveloperPortalPage = lazy(() => import("@/pages/developer-portal"));
const AdminEmailOutboxPage = lazy(() => import("@/pages/admin-email-outbox"));
const AdminStatusPage = lazy(() => import("@/pages/admin-status"));
const EnterpriseSettingsPage = lazy(() => import("@/pages/enterprise-settings"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SafetyTrainingPage = lazy(() => import("@/pages/safety-training"));
const SafetyHubPage = lazy(() => import("@/pages/SafetyHubPage"));
const ProcurementModulePage = lazy(() => import("@/pages/procurement-module"));
const HiringPage = lazy(() => import("@/pages/hiring/index"));
const HiringJobDetailPage = lazy(() => import("@/pages/hiring/job-detail"));
const HiringCandidateDetailPage = lazy(() => import("@/pages/hiring/candidate-detail"));
const TalentPoolPage = lazy(() => import("@/pages/talent-pool"));
const ContractsPage = lazy(() => import("@/pages/contracts"));
const ClauseLibraryPage = lazy(() => import("@/pages/clause-library"));
const ProgressBillingPage = lazy(() => import("@/pages/progress-billing"));
const WipReportPage = lazy(() => import("@/pages/wip-report"));
const CFODashboardPage = lazy(() => import("@/pages/cfo-dashboard"));
const UnifiedMessagesPage = lazy(() => import("@/pages/unified-messages"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const MyDayPage = lazy(() => import("@/pages/my-day"));
const PlanPinsHarnessPage = lazy(() => import("@/pages/test/plan-pins-harness"));
const TrustPage = lazy(() => import("@/pages/trust").then(m => ({ default: m.TrustPage })));
const SubProcessorsPage = lazy(() => import("@/pages/trust").then(m => ({ default: m.SubProcessorsPage })));
const StatusPage = lazy(() => import("@/pages/trust").then(m => ({ default: m.StatusPage })));

function FeatureFlagGate({ flag, children }: { flag: FeatureFlagKey; children: React.ReactNode }) {
  const { isEnabled } = useFeatureFlagsHook();
  if (!isEnabled(flag)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h2 className="text-2xl font-bold text-muted-foreground">Feature Not Available</h2>
          <p className="text-muted-foreground">This feature is currently disabled.</p>
          <Link href="/dashboard" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90" data-testid="link-return-dashboard-flag">Return to Dashboard</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function ProtectedRoute({ 
  component: Component,
  permission,
  featurePerm,
  skipOnboardingCheck = false
}: { 
  component: React.ComponentType;
  permission?: (role?: string, perms?: Record<string, boolean>) => boolean;
  featurePerm?: FeaturePermissionKey | FeaturePermissionKey[];
  skipOnboardingCheck?: boolean;
}) {
  const { user, isLoading, organizationOnboardingStatus } = useAuth();
  const [location] = useLocation();
  const { permissions, isLoadingPermissions } = useDashboardCustomization();

  if (isLoading || (featurePerm && isLoadingPermissions) || (permission && isLoadingPermissions)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />;
  }

  if (!skipOnboardingCheck && location !== '/onboarding') {
    if (!user.organizationId) {
      return <Redirect to="/onboarding" />;
    }
    if (organizationOnboardingStatus && organizationOnboardingStatus !== 'COMPLETED') {
      return <Redirect to="/onboarding" />;
    }
  }

  const roleAllowed = permission ? permission(user.role, permissions as Record<string, boolean>) : !featurePerm;
  const permKeys = featurePerm ? (Array.isArray(featurePerm) ? featurePerm : [featurePerm]) : [];
  const featureAllowed = permKeys.length > 0 ? permKeys.some(k => permissions[k]) : false;
  if ((permission || featurePerm) && !roleAllowed && !featureAllowed) {
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
      <Route path="/trust" component={TrustPage} />
      <Route path="/sub-processors" component={SubProcessorsPage} />
      <Route path="/status" component={StatusPage} />
      <Route path="/site/:subdomain/staging" component={() => <PublicWebsite isStaging={true} />} />
      <Route path="/site/:subdomain" component={PublicWebsite} />
      <Route path="/shared-preview/:token" component={SharedPreviewPage} />
      <Route path="/portal/:projectId">{(params) => {
        const projectId = params.projectId;
        if (projectId) {
          const existingSearch = window.location.search;
          const separator = existingSearch ? `${existingSearch}&` : '?';
          return <Redirect to={`/portal${separator}projectId=${encodeURIComponent(projectId)}`} />;
        }
        return <Redirect to="/portal" />;
      }}</Route>
      <Route path="/sub-portal">{() => {
        const search = window.location.search;
        return <Redirect to={`/portal${search}`} />;
      }}</Route>
      <Route path="/portal" component={UnifiedPortal} />
      <Route path="/rfq-response/:token" component={RfqResponsePage} />
      <Route path="/print/projects/:code/schedule" component={() => <ProtectedRoute component={SchedulePrintPage} skipOnboardingCheck />} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={OnboardingPage} skipOnboardingCheck />} />
      
      {/* Routes accessible to all authenticated users */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
      <Route path="/settings/:section" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} permission={RoutePermissions.PROJECTS} />} />
      <Route path="/projects/:code" component={() => <ProtectedRoute component={ProjectDetailPage} permission={RoutePermissions.PROJECT_DETAIL} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} permission={RoutePermissions.CALENDAR} />} />
      <Route path="/leave-management" component={() => <ProtectedRoute component={LeaveManagementPage} permission={RoutePermissions.LEAVE_MANAGEMENT} />} />
      <Route path="/communications" component={() => <ProtectedRoute component={CompanyCommunicationsPage} permission={RoutePermissions.BULLETINS} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} permission={RoutePermissions.TASKS} />} />
      <Route path="/daily-reports" component={() => <ProtectedRoute component={DailyReportsPage} permission={RoutePermissions.PROJECTS} />} />
      <Route path="/my-day" component={() => <ProtectedRoute component={MyDayPage} />} />
      <Route path="/time-clock" component={() => <ProtectedRoute component={TimeClockPage} permission={RoutePermissions.TIME_CLOCK} />} />
      <Route path="/messages" component={() => <ProtectedRoute component={UnifiedMessagesPage} permission={RoutePermissions.MESSAGES} />} />
      <Route path="/portal-chat" component={() => <ProtectedRoute component={UnifiedMessagesPage} permission={RoutePermissions.MESSAGES} />} />
      
      {/* Admin-only routes */}
      <Route path="/users" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=users" />} permission={RoutePermissions.USERS} />} />
      <Route path="/ai-settings" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=ai-settings" />} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/cost-rates" component={() => <ProtectedRoute component={CostRatesPage} permission={RoutePermissions.COST_RATES} featurePerm="canViewFinancials" />} />
      <Route path="/crews" component={() => <ProtectedRoute component={CrewsPage} permission={RoutePermissions.CREWS} featurePerm="canManageScheduling" />} />
      <Route path="/dispatch-board" component={() => <ProtectedRoute component={DispatchBoardPage} permission={RoutePermissions.DISPATCH_BOARD} featurePerm="canManageScheduling" />} />
      <Route path="/subcontractor-payables" component={() => <ProtectedRoute component={() => <Redirect to="/subcontracts" />} permission={RoutePermissions.SUBCONTRACTS} featurePerm="canViewFinancials" />} />
      <Route path="/company-settings" component={() => <ProtectedRoute component={CompanySettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} featurePerm={["canAccessCompanySettings", "canAccessScopeSettings", "canAccessProductionRates", "canLockDailyReports", "canManageWebsite"]} />} />
      <Route path="/integrations" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=integrations" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/developer-portal" component={() => <ProtectedRoute component={DeveloperPortalPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/approvals" component={() => <ProtectedRoute component={ApprovalsPage} />} />
      <Route path="/ai-governance" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=ai-governance" />} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/audit-logs" component={() => <ProtectedRoute component={AuditLogsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/admin/email-outbox" component={() => <ProtectedRoute component={AdminEmailOutboxPage} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/status" component={() => <ProtectedRoute component={AdminStatusPage} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/enterprise-settings" component={() => <ProtectedRoute component={EnterpriseSettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/cost-codes" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=cost-codes" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      
      {/* Management routes (blocked for hourly employees) */}
      <Route path="/bids/new" component={() => <ProtectedRoute component={BidWizardPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids" component={() => <ProtectedRoute component={BidsPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/historical-costs" component={() => <ProtectedRoute component={HistoricalCostsPage} permission={RoutePermissions.HISTORICAL_COSTS} />} />
      <Route path="/bids/:code/estimate" component={() => <ProtectedRoute component={BidEstimate} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/bids/:code" component={() => <ProtectedRoute component={BidDetailPage} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/time-entry" component={() => <ProtectedRoute component={TimeEntryPage} permission={RoutePermissions.TIME_ENTRY} featurePerm="canManageScheduling" />} />
      <Route path="/tm-daily" component={() => <ProtectedRoute component={TMDailyPage} permission={RoutePermissions.TM_DAILY} featurePerm="canAccessTimeMaterial" />} />
      <Route path="/tm-billing" component={() => <ProtectedRoute component={TMBillingPage} permission={RoutePermissions.TM_BILLING} featurePerm="canViewFinancials" />} />
      <Route path="/progress-billing" component={() => <ProtectedRoute component={ProgressBillingPage} permission={RoutePermissions.PROGRESS_BILLING} featurePerm="canViewFinancials" />} />
      <Route path="/wip-report" component={() => <ProtectedRoute component={WipReportPage} permission={RoutePermissions.CFO} />} />
      <Route path="/time-clock-manager" component={() => <ProtectedRoute component={TimeClockManagerPage} permission={RoutePermissions.TIME_CLOCK_MANAGER} featurePerm="canManagePayroll" />} />
      <Route path="/ai-pm" component={() => <ProtectedRoute component={() => <Redirect to="/dashboard" />} permission={RoutePermissions.AI_PM} featurePerm="canUseAiFeatures" />} />
      <Route path="/cfo-dashboard" component={() => <ProtectedRoute component={CFODashboardPage} permission={RoutePermissions.CFO} />} />
      <Route path="/cfo" component={() => <ProtectedRoute component={() => <Redirect to="/cfo-dashboard" />} permission={RoutePermissions.CFO} />} />
      <Route path="/production-rates" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=production-rates" />} permission={RoutePermissions.PRODUCTION_RATES} />} />
      <Route path="/crm" component={() => <ProtectedRoute component={CRMPage} permission={RoutePermissions.CRM} />} />
      <Route path="/crm/deals/:id" component={() => <ProtectedRoute component={CrmDealDetailPage} permission={RoutePermissions.CRM} />} />
      <Route path="/sequences" component={() => <ProtectedRoute component={SequencesPage} permission={RoutePermissions.CRM} />} />
      <Route path="/sequences/:id" component={() => <ProtectedRoute component={SequenceDetailPage} permission={RoutePermissions.CRM} />} />
      <Route path="/crm-settings" component={() => <ProtectedRoute component={CrmSettingsPage} permission={RoutePermissions.CRM} />} />
      <Route path="/leads/:orgSlug" component={PublicLeadFormPage} />
      <Route path="/forms/:slug" component={PublicFormPage} />
      <Route path="/book/:slug" component={PublicBookingPage} />
      <Route path="/crm-upgrades" component={() => <ProtectedRoute component={CrmUpgradesPage} permission={RoutePermissions.CRM} />} />
      <Route path="/field-sales" component={() => <ProtectedRoute component={FieldSalesPage} permission={RoutePermissions.CRM} />} />
      <Route path="/quotes/accept/:token" component={PublicQuoteAcceptPage} />
      <Route path="/scope-settings" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=scope-settings" />} permission={RoutePermissions.SCOPE_SETTINGS} />} />
      <Route path="/equipment/:code" component={() => <ProtectedRoute component={EquipmentDetailPage} permission={RoutePermissions.EQUIPMENT} featurePerm="canManageEquipment" />} />
      <Route path="/equipment" component={() => <ProtectedRoute component={EquipmentPage} permission={RoutePermissions.EQUIPMENT} featurePerm="canManageEquipment" />} />
      <Route path="/lidar-scans" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="LIDAR_SCANNER"><LidarScansPage /></FeatureFlagGate>} permission={RoutePermissions.LIDAR_SCANS} />} />
      <Route path="/permits" component={() => <ProtectedRoute component={PermitsPage} permission={RoutePermissions.PERMITS} />} />
      <Route path="/compliance" component={() => <ProtectedRoute component={CompliancePage} permission={RoutePermissions.COMPLIANCE} />} />
      <Route path="/rental-vendors" component={() => <ProtectedRoute component={() => <Redirect to="/crm" />} permission={RoutePermissions.CRM} />} />
      <Route path="/vendor-pricing" component={() => <ProtectedRoute component={VendorPricingPage} permission={RoutePermissions.CRM} featurePerm="canManageProcurement" />} />
      <Route path="/mobile-sync" component={() => <ProtectedRoute component={MobileSyncPage} />} />
      
      {/* AI Analysis routes - consolidated into parent pages */}
      <Route path="/ai-document-analysis" component={() => <ProtectedRoute component={() => {
        const params = new URLSearchParams(window.location.search);
        return <Redirect to={params.get("mode") === "contract" ? "/contracts" : "/bids"} />;
      }} permission={(role?: string) => RoutePermissions.AI_BID_ANALYSIS(role) || RoutePermissions.AI_CONTRACT_ANALYSIS(role)} featurePerm="canUseAiFeatures" />} />
      <Route path="/ai-bid-analysis" component={() => <ProtectedRoute component={() => <Redirect to="/bids" />} permission={RoutePermissions.AI_BID_ANALYSIS} featurePerm="canUseAiFeatures" />} />
      <Route path="/ai-contract-analysis" component={() => <ProtectedRoute component={() => <Redirect to="/contracts" />} permission={RoutePermissions.AI_CONTRACT_ANALYSIS} featurePerm="canUseAiFeatures" />} />
      
      {/* Delay Claims routes */}
      <Route path="/daily-report-locks" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=report-locks" />} permission={RoutePermissions.DAILY_REPORT_LOCKS} />} />
      
      {/* Field Productivity routes - voice logs consolidated into daily logs */}
      <Route path="/voice-logs" component={() => <ProtectedRoute component={() => <Redirect to="/dashboard" />} />} />
      <Route path="/issue-captures" component={() => <ProtectedRoute component={IssueCapturesPage} />} />
      <Route path="/offline-sync" component={() => <ProtectedRoute component={OfflineSyncPage} />} />
      
      {/* Marketplace routes */}
      <Route path="/marketplace/contractors/:orgId" component={() => <ProtectedRoute component={ContractorProfilePage} />} />
      <Route path="/marketplace" component={() => <ProtectedRoute component={MarketplacePage} permission={RoutePermissions.MARKETPLACE} />} />
      <Route path="/vendor-scores" component={() => <ProtectedRoute component={VendorScoresPage} permission={RoutePermissions.CRM} />} />
      <Route path="/material-price-index" component={() => <ProtectedRoute component={MaterialPriceIndexPage} permission={RoutePermissions.CRM} />} />
      <Route path="/crew-marketplace" component={() => <ProtectedRoute component={() => <Redirect to="/marketplace?tab=crews" />} permission={RoutePermissions.CRM} />} />
      <Route path="/equipment-rental-marketplace" component={() => <ProtectedRoute component={() => <Redirect to="/marketplace?tab=equipment" />} />} />
      <Route path="/pricebook-import" component={() => <ProtectedRoute component={PricebookImportPage} permission={RoutePermissions.CRM} featurePerm="canManageProcurement" />} />
      
      {/* Executive Intelligence routes */}
      <Route path="/company-health" component={() => <ProtectedRoute component={CompanyHealthPage} permission={RoutePermissions.CFO} />} />
      <Route path="/executive-digest" component={() => <ProtectedRoute component={ExecutiveDigestPage} permission={RoutePermissions.EXECUTIVE_DIGEST} />} />
      <Route path="/what-if-simulator" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="WHATIF_SIMULATOR"><WhatIfSimulatorPage /></FeatureFlagGate>} permission={RoutePermissions.CFO} />} />

      {/* Bid Network routes */}
      <Route path="/bid-network/:id" component={() => <ProtectedRoute component={BidNetworkDetailPage} permission={RoutePermissions.BID_NETWORK_GC} />} />
      <Route path="/bid-network" component={() => <ProtectedRoute component={BidNetworkPage} permission={RoutePermissions.BID_NETWORK_GC} />} />
      <Route path="/bid-inbox/:id" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BID_NETWORK_INBOX} />} />
      <Route path="/bid-inbox" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BID_NETWORK_INBOX} />} />

      {/* Tools routes */}
      <Route path="/calculator" component={() => <ProtectedRoute component={CalculatorPage} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={ReportsPage} permission={RoutePermissions.REPORTS} featurePerm="canAccessReports" />} />
      <Route path="/manage-workers/:id" component={() => <ProtectedRoute component={WorkerDetailPage} permission={RoutePermissions.MANAGE_WORKERS} featurePerm="canManagePayroll" />} />
      <Route path="/manage-workers" component={() => <ProtectedRoute component={ManageWorkersPage} permission={RoutePermissions.MANAGE_WORKERS} featurePerm="canManagePayroll" />} />
      <Route path="/safety-training" component={() => <ProtectedRoute component={SafetyTrainingPage} permission={RoutePermissions.SAFETY_TRAINING} />} />
      <Route path="/safety" component={() => <ProtectedRoute component={SafetyHubPage} permission={RoutePermissions.SAFETY_TRAINING} />} />
      <Route path="/payroll-management" component={() => <ProtectedRoute component={PayrollManagementPage} permission={RoutePermissions.PAYROLL_MANAGEMENT} featurePerm="canManagePayroll" />} />
      <Route path="/overtime-rules" component={() => <ProtectedRoute component={OvertimeRulesPage} permission={RoutePermissions.PAYROLL_MANAGEMENT} featurePerm="canManagePayroll" />} />
      <Route path="/contracts" component={() => <ProtectedRoute component={ContractsPage} permission={(role?: string) => ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role || "")} featurePerm="canManageContracts" />} />
      <Route path="/clause-library" component={() => <ProtectedRoute component={ClauseLibraryPage} permission={(role?: string) => ["ADMIN", "MANAGER"].includes(role || "")} featurePerm="canManageContracts" />} />
      <Route path="/subcontracts" component={() => <ProtectedRoute component={SubcontractsPage} permission={RoutePermissions.SUBCONTRACTS} featurePerm="canViewFinancials" />} />
      <Route path="/website-builder" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=website" />} permission={RoutePermissions.WEBSITE_BUILDER} />} />
      <Route path="/social-media" component={() => <ProtectedRoute component={SocialMediaPage} permission={RoutePermissions.SOCIAL_MEDIA} featurePerm="canPostSocialMedia" />} />
      <Route path="/email-assistant" component={() => <ProtectedRoute component={EmailAssistantPage} permission={RoutePermissions.EMAIL_ASSISTANT} />} />
      <Route path="/email-campaigns" component={() => <ProtectedRoute component={EmailCampaignsPage} permission={RoutePermissions.EMAIL_ASSISTANT} />} />
      <Route path="/procurement-module" component={() => <ProtectedRoute component={ProcurementModulePage} permission={RoutePermissions.PROCUREMENT} featurePerm="canManageProcurement" />} />
      <Route path="/billing" component={() => <ProtectedRoute component={BillingPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />

      {/* Hiring Module routes */}
      <Route path="/talent-pool/:id" component={() => <ProtectedRoute component={TalentPoolPage} />} />
      <Route path="/talent-pool" component={() => <ProtectedRoute component={() => <Redirect to="/marketplace?tab=talent" />} />} />
      <Route path="/hiring/jobs/:id" component={() => <ProtectedRoute component={HiringJobDetailPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/candidates/:id" component={() => <ProtectedRoute component={HiringCandidateDetailPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/jobs" component={() => <Redirect to="/hiring?tab=jobs" />} />
      <Route path="/hiring/candidates" component={() => <Redirect to="/hiring?tab=candidates" />} />
      <Route path="/hiring/pipeline" component={() => <Redirect to="/hiring?tab=pipeline" />} />
      <Route path="/hiring/interviews" component={() => <Redirect to="/hiring?tab=interviews" />} />
      <Route path="/hiring/tasks" component={() => <Redirect to="/hiring?tab=tasks" />} />
      <Route path="/hiring/analytics" component={() => <Redirect to="/hiring?tab=analytics" />} />
      <Route path="/hiring/settings" component={() => <Redirect to="/hiring?tab=settings" />} />
      <Route path="/hiring" component={() => <ProtectedRoute component={HiringPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />

      
      {/* Overhead & Fixed Costs Manager */}
      <Route path="/overhead-costs" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=overhead-costs" />} permission={RoutePermissions.OVERHEAD_COSTS} />} />
      
      {/* Vendor internal routes */}
      <Route path="/vendor/pricing" component={() => <ProtectedRoute component={VendorPortalPricing} permission={VendorRoutePermissions.VENDOR_PRICING} />} />
      <Route path="/vendor/clients" component={() => <ProtectedRoute component={VendorClients} permission={VendorRoutePermissions.VENDOR_CLIENTS} />} />
      <Route path="/vendor/messages" component={() => <ProtectedRoute component={VendorMessages} permission={VendorRoutePermissions.VENDOR_MESSAGES} />} />
      <Route path="/vendor/documents" component={() => <ProtectedRoute component={VendorDocuments} permission={VendorRoutePermissions.VENDOR_DOCUMENTS} />} />
      <Route path="/vendor/compliance" component={() => <ProtectedRoute component={VendorCompliance} permission={VendorRoutePermissions.VENDOR_COMPLIANCE} />} />
      <Route path="/vendor/purchase-orders" component={() => <ProtectedRoute component={VendorPurchaseOrders} permission={VendorRoutePermissions.VENDOR_PURCHASE_ORDERS} />} />
      <Route path="/vendor/schedule" component={() => <ProtectedRoute component={VendorSchedule} permission={VendorRoutePermissions.VENDOR_SCHEDULE} />} />
      <Route path="/vendor/analytics" component={() => <ProtectedRoute component={VendorAnalytics} permission={VendorRoutePermissions.VENDOR_ANALYTICS} />} />
      <Route path="/vendor" component={() => <Redirect to="/vendor/analytics" />} />
      
      {/* Platform Admin routes (SUPER_ADMIN only) */}
      <Route path="/admin" component={() => <ProtectedRoute component={PlatformAdminDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/dot-library" component={() => <ProtectedRoute component={DotLibraryPage} />} />
      <Route path="/haul-tickets" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="HAUL_TICKETS"><HaulTicketsPage /></FeatureFlagGate>} />} />
      <Route path="/daily-inspector-reports" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="DAILY_INSPECTOR_REPORTS"><DailyInspectorReportsPage /></FeatureFlagGate>} />} />
      <Route path="/swppp-inspections" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="SWPPP_INSPECTIONS"><SwpppInspectionsPage /></FeatureFlagGate>} />} />
      <Route path="/surety-bonds" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="SURETY_BONDS"><SuretyBondsPage /></FeatureFlagGate>} />} />
      <Route path="/dbe-goals" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="DBE_TRACKING"><DbeGoalsPage /></FeatureFlagGate>} />} />
      <Route path="/material-certifications" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="BUY_AMERICA"><MaterialCertificationsPage /></FeatureFlagGate>} />} />
      <Route path="/admin/organizations/:id/view" component={() => <ProtectedRoute component={ViewAsOrganization} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations/:id" component={() => <ProtectedRoute component={PlatformOrganizationDetail} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations" component={() => <ProtectedRoute component={PlatformOrganizations} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/analytics" component={() => <ProtectedRoute component={PlatformAnalyticsMonitoring} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/tools" component={() => <ProtectedRoute component={PlatformTools} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/gantt-pdf" component={() => <ProtectedRoute component={GanttPdfHealth} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/job-metrics" component={() => <ProtectedRoute component={JobMetricsHealth} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/jobs/metrics" component={() => <ProtectedRoute component={JobMetricsDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/subscriptions" component={() => <ProtectedRoute component={() => <Redirect to="/admin/tools" />} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/support" component={() => <ProtectedRoute component={() => <Redirect to="/admin/tools" />} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/audit" component={() => <ProtectedRoute component={() => <Redirect to="/admin/tools" />} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/monitoring" component={() => <ProtectedRoute component={() => <Redirect to="/admin/analytics" />} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/announcements" component={() => <ProtectedRoute component={() => <Redirect to="/admin/tools" />} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      
      {/* Hustler invite acceptance (public) */}
      <Route path="/hustler/accept-invite/:token" component={AcceptHustlerInvitePage} />
      
      {/* Hustler Multi-Organization routes (HUSTLER only) */}
      <Route path="/hustler/inbox" component={() => <ProtectedRoute component={HustlerUnifiedInbox} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      <Route path="/hustler/benchmarking" component={() => <ProtectedRoute component={HustlerBenchmarking} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      <Route path="/hustler/org/:orgId" component={() => <ProtectedRoute component={HustlerOrgDetail} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      <Route path="/hustler" component={() => <ProtectedRoute component={HustlerDashboard} permission={(role) => role === 'HUSTLER'} skipOnboardingCheck />} />
      
      {import.meta.env.DEV && (
        <Route path="/test/plan-pins-harness" component={PlanPinsHarnessPage} />
      )}
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
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <CommandPaletteProvider>
        <KeyboardShortcutsProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col min-h-screen">
          <ImpersonationBanner />
          <EmailVerificationBanner />
          <OfflineStatusBanner />
          <TopHeader />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </SidebarInset>
        <PushNotificationBanner />
        </KeyboardShortcutsProvider>
      </CommandPaletteProvider>
    </SidebarProvider>
  );
}

function ThemeInitializer() {
  useTheme();
  return null;
}

function AppContent() {
  const [location] = useLocation();
  const { user, isLoading } = useAuth();
  
  const isStandaloneRoute = location.startsWith('/site/') || location.startsWith('/sub-portal') || location.startsWith('/rfq-response/') || location === '/portal' || location.startsWith('/portal/') || location.startsWith('/print/') || location === '/trust' || location === '/sub-processors' || location === '/status';

  const isPublicRoute = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/hustler/accept-invite'].some(
    route => location === route || (route !== '/' && location.startsWith(route))
  ) || isStandaloneRoute;

  if (isStandaloneRoute) {
    return <Suspense fallback={<LoadingSpinner />}><Router /></Suspense>;
  }
  
  if (isPublicRoute && !user) {
    return <Suspense fallback={<LoadingSpinner />}><Router /></Suspense>;
  }
  
  return (
    <AuthenticatedLayout>
      <Suspense fallback={<LoadingSpinner />}>
        <Router />
      </Suspense>
    </AuthenticatedLayout>
  );
}

function AuthGatedWidget() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [messagingOpen, setMessagingOpen] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const isStandaloneRoute = location.startsWith('/site/') || location.startsWith('/sub-portal') || location.startsWith('/rfq-response/') || location === '/portal' || location.startsWith('/portal/') || location.startsWith('/print/') || location === '/trust' || location === '/sub-processors' || location === '/status';

  React.useEffect(() => {
    const handleMessaging = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      setMessagingOpen(!!detail?.isOpen);
    };
    const handleAi = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      setAiOpen(!!detail?.isOpen);
    };
    window.addEventListener("messaging-widget-state", handleMessaging);
    window.addEventListener("ask-ai-widget-state", handleAi);
    return () => {
      window.removeEventListener("messaging-widget-state", handleMessaging);
      window.removeEventListener("ask-ai-widget-state", handleAi);
    };
  }, []);

  if (!user || isStandaloneRoute) return null;

  let containerRight = '24px';
  if (messagingOpen && aiOpen) {
    containerRight = '990px';
  } else if (messagingOpen) {
    containerRight = '590px';
  } else if (aiOpen) {
    containerRight = '420px';
  }

  return (
    <Suspense fallback={null}>
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: containerRight,
          zIndex: 9998,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '12px',
          alignItems: 'flex-end',
          transition: 'right 0.3s ease',
        }}
        data-testid="widget-group-container"
      >
        <VoiceDictation />
        <MessagingWidget />
        <AIAssistantWidget />
      </div>
    </Suspense>
  );
}

function GlobalVideoCallOverlay() {
  const { user } = useAuth();
  const { activeCall, activeCallConversation, endGlobalCall, leaveGlobalCall, updateActiveCall } = useGlobalVideoCall();

  if (!activeCall || !activeCallConversation || !user) return null;

  return (
    <VideoCallOverlay
      call={activeCall}
      conversation={activeCallConversation}
      currentUserId={user.id}
      onEndCall={endGlobalCall}
      onLeaveCall={leaveGlobalCall}
      onUpdateCall={updateActiveCall}
    />
  );
}

function GlobalCallModalWrapper() {
  const { incomingCall, conversationName, acceptCall, declineCall } = useGlobalCallEvents();
  if (!incomingCall) return null;
  return (
    <GlobalIncomingCallModal
      call={incomingCall}
      conversationName={conversationName}
      onAccept={acceptCall}
      onDecline={declineCall}
    />
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GlobalSSEProvider>
            <GlobalVideoCallProvider>
              <TourProvider>
                <DashboardCustomizationProvider>
                  <TableDensityProvider>
                  <TooltipProvider>
                    <Toaster />
                    <ThemeInitializer />
                    <AppContent />
                    <FirstTimeWelcomeModal />
                    <AuthGatedWidget />
                    <GlobalCallModalWrapper />
                    <GlobalVideoCallOverlay />
                  </TooltipProvider>
                  </TableDensityProvider>
                </DashboardCustomizationProvider>
              </TourProvider>
            </GlobalVideoCallProvider>
          </GlobalSSEProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
