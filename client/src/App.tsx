import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { DashboardCustomizationProvider, useDashboardCustomization, type FeaturePermissionKey } from "@/hooks/use-dashboard-customization";
import { RoutePermissions, hasManagementAccess, hasCrmAccess } from "@/lib/rbac";
import { useFeatureFlags as useFeatureFlagsHook } from "@/hooks/use-feature-flags";
import type { FeatureFlagKey } from "@shared/schema";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import TopHeader from "@/components/TopHeader";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PushNotificationBanner from "@/components/PushNotificationBanner";
import OfflineStatusBanner from "@/components/OfflineStatusBanner";
const VoiceDictation = lazy(() => import("@/components/VoiceDictation"));
import NotFound from "@/pages/not-found";
const LandingPage = lazy(() => import("@/pages/landing"));
import LoginPage from "@/pages/login";
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
const AIPMDashboard = lazy(() => import("@/pages/ai-pm-dashboard"));
const CFODashboard = lazy(() => import("@/pages/cfo-dashboard"));
const AISettingsPage = lazy(() => import("@/pages/ai-settings"));
const CrewsPage = lazy(() => import("@/pages/crews"));
const CostRatesPage = lazy(() => import("@/pages/cost-rates"));
const CompanyCommunicationsPage = lazy(() => import("@/pages/company-communications"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const CRMPage = lazy(() => import("@/pages/crm"));
const ScopeSettingsPage = lazy(() => import("@/pages/scope-settings"));
const EquipmentPage = lazy(() => import("@/pages/equipment"));
const EquipmentDetailPage = lazy(() => import("@/pages/equipment-detail"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const PlatformAdminDashboard = lazy(() => import("@/pages/PlatformAdminDashboard"));
const PlatformOrganizations = lazy(() => import("@/pages/PlatformOrganizations"));
const PlatformOrganizationDetail = lazy(() => import("@/pages/PlatformOrganizationDetail"));
const PlatformAnalyticsMonitoring = lazy(() => import("@/pages/PlatformAnalyticsMonitoring"));
const PlatformTools = lazy(() => import("@/pages/PlatformTools"));
const VendorPricingPage = lazy(() => import("@/pages/vendor-pricing"));
const MobileSyncPage = lazy(() => import("@/pages/mobile-sync"));
const CompanySettingsPage = lazy(() => import("@/pages/company-settings"));
const VendorDashboard = lazy(() => import("@/pages/vendor/index"));
const VendorPortalPricing = lazy(() => import("@/pages/vendor/pricing"));
const VendorClients = lazy(() => import("@/pages/vendor/clients"));
const VendorMessages = lazy(() => import("@/pages/vendor/messages"));
const VendorDocuments = lazy(() => import("@/pages/vendor/documents"));
const ViewAsOrganization = lazy(() => import("@/pages/view-as-organization"));
const AIBidAnalysisPage = lazy(() => import("@/pages/ai-bid-analysis"));
const AIContractAnalysisPage = lazy(() => import("@/pages/ai-contract-analysis"));
const AIDocumentAnalysisPage = lazy(() => import("@/pages/ai-document-analysis"));
const SubcontractsPage = lazy(() => import("@/pages/subcontracts"));
const SocialMediaPage = lazy(() => import("@/pages/social-media"));
const BidWizardPage = lazy(() => import("@/pages/bid-wizard"));
const EmailAssistantPage = lazy(() => import("@/pages/email-assistant"));
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
const VoiceLogsPage = lazy(() => import("@/pages/voice-logs"));
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
const ManageWorkersPage = lazy(() => import("@/pages/manage-workers"));
const WorkerDetailPage = lazy(() => import("@/pages/worker-detail"));
const PayrollManagementPage = lazy(() => import("@/pages/payroll-management"));
const OvertimeRulesPage = lazy(() => import("@/pages/overtime-rules"));
const ApprovalsPage = lazy(() => import("@/pages/approvals"));
const AIGovernancePage = lazy(() => import("@/pages/ai-governance"));
const AuditLogsPage = lazy(() => import("@/pages/audit-logs"));
const EnterpriseSettingsPage = lazy(() => import("@/pages/enterprise-settings"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SafetyTrainingPage = lazy(() => import("@/pages/safety-training"));
const ProcurementModulePage = lazy(() => import("@/pages/procurement-module"));
const HiringDashboardPage = lazy(() => import("@/pages/hiring/index"));
const HiringJobsPage = lazy(() => import("@/pages/hiring/jobs"));
const HiringJobDetailPage = lazy(() => import("@/pages/hiring/job-detail"));
const HiringCandidatesPage = lazy(() => import("@/pages/hiring/candidates"));
const HiringCandidateDetailPage = lazy(() => import("@/pages/hiring/candidate-detail"));
const HiringPipelinePage = lazy(() => import("@/pages/hiring/pipeline"));
const HiringInterviewsPage = lazy(() => import("@/pages/hiring/interviews"));
const HiringAnalyticsPage = lazy(() => import("@/pages/hiring/analytics"));
const HiringTasksPage = lazy(() => import("@/pages/hiring/tasks"));
const HiringSettingsPage = lazy(() => import("@/pages/hiring/settings"));
const TalentPoolPage = lazy(() => import("@/pages/talent-pool"));
const ContractsPage = lazy(() => import("@/pages/contracts"));
const ClauseLibraryPage = lazy(() => import("@/pages/clause-library"));
const ProgressBillingPage = lazy(() => import("@/pages/progress-billing"));
const WipReportPage = lazy(() => import("@/pages/wip-report"));
const SettingsPage = lazy(() => import("@/pages/settings"));

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
  permission?: (role?: string) => boolean;
  featurePerm?: FeaturePermissionKey | FeaturePermissionKey[];
  skipOnboardingCheck?: boolean;
}) {
  const { user, isLoading, organizationOnboardingStatus } = useAuth();
  const [location] = useLocation();
  const { permissions, isLoadingPermissions } = useDashboardCustomization();

  if (isLoading || (featurePerm && isLoadingPermissions)) {
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

  const roleAllowed = permission ? permission(user.role) : !featurePerm;
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
      <Route path="/site/:subdomain/staging" component={() => <PublicWebsite isStaging={true} />} />
      <Route path="/site/:subdomain" component={PublicWebsite} />
      <Route path="/shared-preview/:token" component={SharedPreviewPage} />
      <Route path="/portal/:projectId" component={() => {
        const match = (window.location.pathname.match(/\/portal\/(.+)/) || [])[1];
        if (match) {
          const existingSearch = window.location.search;
          const separator = existingSearch ? `${existingSearch}&` : '?';
          window.location.replace(`/portal${separator}projectId=${encodeURIComponent(match)}`);
          return null;
        }
        return <Redirect to="/portal" />;
      }} />
      <Route path="/sub-portal" component={() => {
        const search = window.location.search;
        window.location.replace(`/portal${search}`);
        return null;
      }} />
      <Route path="/portal" component={UnifiedPortal} />
      <Route path="/rfq-response/:token" component={RfqResponsePage} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={OnboardingPage} skipOnboardingCheck />} />
      
      {/* Routes accessible to all authenticated users */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
      <Route path="/settings/:section" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:code" component={() => <ProtectedRoute component={ProjectDetailPage} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} />} />
      <Route path="/leave-management" component={() => <ProtectedRoute component={LeaveManagementPage} featurePerm="canManageLeave" />} />
      <Route path="/communications" component={() => <ProtectedRoute component={CompanyCommunicationsPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} />} />
      <Route path="/time-clock" component={() => <ProtectedRoute component={TimeClockPage} />} />
      <Route path="/messages" component={() => <Redirect to="/dashboard" />} />
      <Route path="/portal-chat" component={() => <Redirect to="/dashboard" />} />
      
      {/* Admin-only routes */}
      <Route path="/users" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=users" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/ai-settings" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=ai-settings" />} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/cost-rates" component={() => <ProtectedRoute component={CostRatesPage} permission={RoutePermissions.COST_RATES} featurePerm="canAccessFinancials" />} />
      <Route path="/crews" component={() => <ProtectedRoute component={CrewsPage} permission={RoutePermissions.CREWS} featurePerm="canManageScheduling" />} />
      <Route path="/subcontractor-payables" component={() => <ProtectedRoute component={() => <Redirect to="/subcontracts" />} permission={RoutePermissions.SUBCONTRACTS} featurePerm="canAccessFinancials" />} />
      <Route path="/company-settings" component={() => <ProtectedRoute component={CompanySettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/integrations" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=integrations" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/approvals" component={() => <ProtectedRoute component={ApprovalsPage} />} />
      <Route path="/ai-governance" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=ai-governance" />} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/audit-logs" component={() => <ProtectedRoute component={AuditLogsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/enterprise-settings" component={() => <ProtectedRoute component={EnterpriseSettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/cost-codes" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=cost-codes" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      
      {/* Management routes (blocked for hourly employees) */}
      <Route path="/bids/new" component={() => <ProtectedRoute component={BidWizardPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids" component={() => <ProtectedRoute component={BidsPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/historical-costs" component={() => <ProtectedRoute component={HistoricalCostsPage} permission={RoutePermissions.BIDS} featurePerm="canAccessFinancials" />} />
      <Route path="/bids/:code/estimate" component={() => <ProtectedRoute component={BidEstimate} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/bids/:code" component={() => <ProtectedRoute component={BidDetailPage} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/time-entry" component={() => <ProtectedRoute component={TimeEntryPage} permission={RoutePermissions.TIME_ENTRY} featurePerm="canManageScheduling" />} />
      <Route path="/tm-daily" component={() => <ProtectedRoute component={TMDailyPage} permission={RoutePermissions.TM_DAILY} featurePerm="canAccessTimeMaterial" />} />
      <Route path="/tm-billing" component={() => <ProtectedRoute component={TMBillingPage} permission={RoutePermissions.TM_BILLING} featurePerm="canAccessFinancials" />} />
      <Route path="/progress-billing" component={() => <ProtectedRoute component={ProgressBillingPage} permission={RoutePermissions.PROGRESS_BILLING} featurePerm="canAccessFinancials" />} />
      <Route path="/wip-report" component={() => <ProtectedRoute component={WipReportPage} permission={RoutePermissions.CFO} />} />
      <Route path="/time-clock-manager" component={() => <ProtectedRoute component={TimeClockManagerPage} permission={RoutePermissions.TIME_CLOCK_MANAGER} featurePerm="canManagePayroll" />} />
      <Route path="/ai-pm" component={() => <ProtectedRoute component={AIPMDashboard} permission={RoutePermissions.AI_PM} featurePerm="canUseAiFeatures" />} />
      <Route path="/cfo" component={() => <ProtectedRoute component={CFODashboard} permission={RoutePermissions.CFO} />} />
      <Route path="/production-rates" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=production-rates" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/crm" component={() => <ProtectedRoute component={CRMPage} permission={RoutePermissions.CRM} />} />
      <Route path="/scope-settings" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=scope-settings" />} permission={RoutePermissions.SCOPE_SETTINGS} />} />
      <Route path="/equipment/:code" component={() => <ProtectedRoute component={EquipmentDetailPage} permission={RoutePermissions.EQUIPMENT} featurePerm="canManageEquipment" />} />
      <Route path="/equipment" component={() => <ProtectedRoute component={EquipmentPage} permission={RoutePermissions.EQUIPMENT} featurePerm="canManageEquipment" />} />
      <Route path="/rental-vendors" component={() => <ProtectedRoute component={() => <Redirect to="/crm" />} permission={RoutePermissions.CRM} />} />
      <Route path="/vendor-pricing" component={() => <ProtectedRoute component={VendorPricingPage} permission={RoutePermissions.CRM} featurePerm="canManageProcurement" />} />
      <Route path="/mobile-sync" component={() => <ProtectedRoute component={MobileSyncPage} />} />
      
      {/* AI Analysis routes */}
      <Route path="/ai-document-analysis" component={() => <ProtectedRoute component={AIDocumentAnalysisPage} permission={(role?: string) => RoutePermissions.AI_BID_ANALYSIS(role) || RoutePermissions.AI_CONTRACT_ANALYSIS(role)} featurePerm="canUseAiFeatures" />} />
      <Route path="/ai-bid-analysis" component={() => <ProtectedRoute component={() => <Redirect to="/ai-document-analysis?mode=bid" />} permission={RoutePermissions.AI_BID_ANALYSIS} featurePerm="canUseAiFeatures" />} />
      <Route path="/ai-contract-analysis" component={() => <ProtectedRoute component={() => <Redirect to="/ai-document-analysis?mode=contract" />} permission={RoutePermissions.AI_CONTRACT_ANALYSIS} featurePerm="canUseAiFeatures" />} />
      
      {/* Delay Claims routes */}
      <Route path="/daily-report-locks" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=report-locks" />} permission={RoutePermissions.DAILY_REPORT_LOCKS} />} />
      
      {/* Field Productivity routes */}
      <Route path="/voice-logs" component={() => <ProtectedRoute component={VoiceLogsPage} />} />
      <Route path="/issue-captures" component={() => <ProtectedRoute component={IssueCapturesPage} />} />
      <Route path="/offline-sync" component={() => <ProtectedRoute component={OfflineSyncPage} />} />
      
      {/* Marketplace routes */}
      <Route path="/marketplace/contractors/:orgId" component={() => <ProtectedRoute component={ContractorProfilePage} />} />
      <Route path="/marketplace" component={() => <ProtectedRoute component={MarketplacePage} permission={(role?: string) => hasCrmAccess(role) || role === "MARKETING"} />} />
      <Route path="/vendor-scores" component={() => <ProtectedRoute component={VendorScoresPage} permission={RoutePermissions.CRM} />} />
      <Route path="/material-price-index" component={() => <ProtectedRoute component={MaterialPriceIndexPage} permission={RoutePermissions.CRM} />} />
      <Route path="/crew-marketplace" component={() => <ProtectedRoute component={() => <Redirect to="/marketplace?tab=crews" />} permission={RoutePermissions.CRM} />} />
      <Route path="/equipment-rental-marketplace" component={() => <ProtectedRoute component={() => <Redirect to="/marketplace?tab=equipment" />} />} />
      <Route path="/pricebook-import" component={() => <ProtectedRoute component={PricebookImportPage} permission={RoutePermissions.CRM} featurePerm="canManageProcurement" />} />
      
      {/* Executive Intelligence routes */}
      <Route path="/company-health" component={() => <ProtectedRoute component={CompanyHealthPage} permission={RoutePermissions.CFO} />} />
      <Route path="/executive-digest" component={() => <ProtectedRoute component={ExecutiveDigestPage} permission={RoutePermissions.CFO} />} />
      <Route path="/what-if-simulator" component={() => <ProtectedRoute component={() => <FeatureFlagGate flag="WHATIF_SIMULATOR"><WhatIfSimulatorPage /></FeatureFlagGate>} permission={RoutePermissions.CFO} />} />

      {/* Bid Network routes */}
      <Route path="/bid-network/:id" component={() => <ProtectedRoute component={BidNetworkDetailPage} permission={RoutePermissions.BIDS} featurePerm="canAccessBidNetwork" />} />
      <Route path="/bid-network" component={() => <ProtectedRoute component={BidNetworkPage} permission={RoutePermissions.BIDS} featurePerm="canAccessBidNetwork" />} />
      <Route path="/bid-inbox/:id" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BIDS} featurePerm="canAccessBidNetwork" />} />
      <Route path="/bid-inbox" component={() => <ProtectedRoute component={() => <Redirect to="/bids?tab=inbox" />} permission={RoutePermissions.BIDS} featurePerm="canAccessBidNetwork" />} />

      {/* Tools routes */}
      <Route path="/calculator" component={() => <ProtectedRoute component={CalculatorPage} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={ReportsPage} permission={RoutePermissions.REPORTS} featurePerm="canAccessReports" />} />
      <Route path="/manage-workers/:id" component={() => <ProtectedRoute component={WorkerDetailPage} permission={RoutePermissions.MANAGE_WORKERS} featurePerm="canManagePayroll" />} />
      <Route path="/manage-workers" component={() => <ProtectedRoute component={ManageWorkersPage} permission={RoutePermissions.MANAGE_WORKERS} featurePerm="canManagePayroll" />} />
      <Route path="/safety-training" component={() => <ProtectedRoute component={SafetyTrainingPage} featurePerm="canManageSafety" />} />
      <Route path="/payroll-management" component={() => <ProtectedRoute component={PayrollManagementPage} permission={RoutePermissions.PAYROLL_MANAGEMENT} featurePerm="canManagePayroll" />} />
      <Route path="/overtime-rules" component={() => <ProtectedRoute component={OvertimeRulesPage} permission={RoutePermissions.PAYROLL_MANAGEMENT} featurePerm="canManagePayroll" />} />
      <Route path="/contracts" component={() => <ProtectedRoute component={ContractsPage} permission={(role?: string) => ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"].includes(role || "")} featurePerm="canManageContracts" />} />
      <Route path="/clause-library" component={() => <ProtectedRoute component={ClauseLibraryPage} permission={(role?: string) => ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role || "")} featurePerm="canManageContracts" />} />
      <Route path="/subcontracts" component={() => <ProtectedRoute component={SubcontractsPage} permission={RoutePermissions.SUBCONTRACTS} featurePerm="canAccessFinancials" />} />
      <Route path="/website-builder" component={() => <ProtectedRoute component={() => <Redirect to="/company-settings?tab=website" />} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/social-media" component={() => <ProtectedRoute component={SocialMediaPage} permission={RoutePermissions.SOCIAL_MEDIA} featurePerm="canPostSocialMedia" />} />
      <Route path="/email-assistant" component={() => <ProtectedRoute component={EmailAssistantPage} permission={(role?: string) => hasManagementAccess(role) || role === "SALES" || role === "MARKETING"} featurePerm="canUseAiFeatures" />} />
      <Route path="/procurement-module" component={() => <ProtectedRoute component={ProcurementModulePage} permission={RoutePermissions.PROCUREMENT} featurePerm="canManageProcurement" />} />
      <Route path="/billing" component={() => <ProtectedRoute component={BillingPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />

      {/* Hiring Module routes */}
      <Route path="/talent-pool/:id" component={() => <ProtectedRoute component={TalentPoolPage} />} />
      <Route path="/talent-pool" component={() => <ProtectedRoute component={() => <Redirect to="/marketplace?tab=talent" />} />} />
      <Route path="/hiring/jobs/:id" component={() => <ProtectedRoute component={HiringJobDetailPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/jobs" component={() => <ProtectedRoute component={HiringJobsPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/candidates/:id" component={() => <ProtectedRoute component={HiringCandidateDetailPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/candidates" component={() => <ProtectedRoute component={HiringCandidatesPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/pipeline" component={() => <ProtectedRoute component={HiringPipelinePage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/interviews" component={() => <ProtectedRoute component={HiringInterviewsPage} permission={RoutePermissions.HIRING_ADVANCED} featurePerm="canManageHiring" />} />
      <Route path="/hiring/tasks" component={() => <ProtectedRoute component={HiringTasksPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />
      <Route path="/hiring/analytics" component={() => <ProtectedRoute component={HiringAnalyticsPage} permission={RoutePermissions.HIRING_ADVANCED} featurePerm="canManageHiring" />} />
      <Route path="/hiring/settings" component={() => <ProtectedRoute component={HiringSettingsPage} permission={RoutePermissions.HIRING_SETTINGS} featurePerm="canManageHiring" />} />
      <Route path="/hiring" component={() => <ProtectedRoute component={HiringDashboardPage} permission={RoutePermissions.HIRING_REVIEW} featurePerm="canManageHiring" />} />

      
      {/* Overhead & Fixed Costs Manager */}
      <Route path="/overhead-costs" component={() => <Redirect to="/company-settings?tab=overhead-costs" />} />
      
      {/* Vendor Portal routes redirect to unified portal */}
      <Route path="/vendor/pricing" component={() => <Redirect to="/portal?tab=pricing" />} />
      <Route path="/vendor/clients" component={() => <Redirect to="/portal?tab=clients" />} />
      <Route path="/vendor/messages" component={() => <Redirect to="/portal?tab=messages" />} />
      <Route path="/vendor/documents" component={() => <Redirect to="/portal?tab=documents" />} />
      <Route path="/vendor" component={() => <Redirect to="/portal" />} />
      
      {/* Platform Admin routes (SUPER_ADMIN only) */}
      <Route path="/admin" component={() => <ProtectedRoute component={PlatformAdminDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations/:id/view" component={() => <ProtectedRoute component={ViewAsOrganization} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations/:id" component={() => <ProtectedRoute component={PlatformOrganizationDetail} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations" component={() => <ProtectedRoute component={PlatformOrganizations} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/analytics" component={() => <ProtectedRoute component={PlatformAnalyticsMonitoring} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/tools" component={() => <ProtectedRoute component={PlatformTools} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
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
      <AppSidebar />
      <SidebarInset className="flex flex-col min-h-screen">
        <ImpersonationBanner />
        <OfflineStatusBanner />
        <TopHeader />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
      <PushNotificationBanner />
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
  
  const isStandaloneRoute = location.startsWith('/site/') || location.startsWith('/sub-portal') || location.startsWith('/rfq-response/') || location === '/portal' || location.startsWith('/portal/');

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
  const isStandaloneRoute = location.startsWith('/site/') || location.startsWith('/sub-portal') || location.startsWith('/rfq-response/') || location === '/portal' || location.startsWith('/portal/');

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
    window.addEventListener("ai-assistant-widget-state", handleAi);
    return () => {
      window.removeEventListener("messaging-widget-state", handleMessaging);
      window.removeEventListener("ai-assistant-widget-state", handleAi);
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GlobalSSEProvider>
          <GlobalVideoCallProvider>
            <TourProvider>
              <DashboardCustomizationProvider>
                <TooltipProvider>
                  <Toaster />
                  <ThemeInitializer />
                  <AppContent />
                  <FirstTimeWelcomeModal />
                  <AuthGatedWidget />
                  <GlobalCallModalWrapper />
                  <GlobalVideoCallOverlay />
                </TooltipProvider>
              </DashboardCustomizationProvider>
            </TourProvider>
          </GlobalVideoCallProvider>
        </GlobalSSEProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
