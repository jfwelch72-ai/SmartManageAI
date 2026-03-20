import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { DashboardCustomizationProvider, useDashboardCustomization, type FeaturePermissionKey } from "@/hooks/use-dashboard-customization";
import { RoutePermissions } from "@/lib/rbac";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import TopHeader from "@/components/TopHeader";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PushNotificationBanner from "@/components/PushNotificationBanner";
import NotFound from "@/pages/not-found";
const LandingPage = lazy(() => import("@/pages/landing"));
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import RegisterPage from "@/pages/register";
const AIAssistantWidget = lazy(() => import("@/components/AIAssistantWidget"));
import { FirstTimeWelcomeModal } from "@/components/FirstTimeWelcomeModal";
import { TourProvider } from "@/components/TourProvider";
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
const UsersPage = lazy(() => import("@/pages/users"));
const BidsPage = lazy(() => import("@/pages/bids"));
const BidDetailPage = lazy(() => import("@/pages/bid-detail"));
const BidEstimate = lazy(() => import("@/pages/bid-estimate"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail"));
const TimeEntryPage = lazy(() => import("@/pages/time-entry"));
const TMDailyPage = lazy(() => import("@/pages/tm-daily"));
const TMBillingPage = lazy(() => import("@/pages/tm-billing"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const TimeClockPage = lazy(() => import("@/pages/time-clock"));
const TimeClockManagerPage = lazy(() => import("@/pages/time-clock-manager"));
const AIPMDashboard = lazy(() => import("@/pages/ai-pm-dashboard"));
const CFODashboard = lazy(() => import("@/pages/cfo-dashboard"));
const AISettingsPage = lazy(() => import("@/pages/ai-settings"));
const CrewsPage = lazy(() => import("@/pages/crews"));
const CostRatesPage = lazy(() => import("@/pages/cost-rates"));
const CompanyCommunicationsPage = lazy(() => import("@/pages/company-communications"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const ProductionRatesPage = lazy(() => import("@/pages/production-rates"));
const CRMPage = lazy(() => import("@/pages/crm"));
const ScopeSettingsPage = lazy(() => import("@/pages/scope-settings"));
const ScopeLibraryPage = lazy(() => import("@/pages/scope-library"));
const UnifiedMessagesPage = lazy(() => import("@/pages/unified-messages"));
const EquipmentPage = lazy(() => import("@/pages/equipment"));
const EquipmentDetailPage = lazy(() => import("@/pages/equipment-detail"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const PlatformAdminDashboard = lazy(() => import("@/pages/PlatformAdminDashboard"));
const PlatformOrganizations = lazy(() => import("@/pages/PlatformOrganizations"));
const PlatformOrganizationDetail = lazy(() => import("@/pages/PlatformOrganizationDetail"));
const PlatformAnalytics = lazy(() => import("@/pages/PlatformAnalytics"));
const PlatformSupportTools = lazy(() => import("@/pages/PlatformSupportTools"));
const PlatformAuditDashboard = lazy(() => import("@/pages/PlatformAuditDashboard"));
const PlatformSubscriptions = lazy(() => import("@/pages/PlatformSubscriptions"));
const VendorPricingPage = lazy(() => import("@/pages/vendor-pricing"));
const MobileSyncPage = lazy(() => import("@/pages/mobile-sync"));
const CompanySettingsPage = lazy(() => import("@/pages/company-settings"));
const VendorDashboard = lazy(() => import("@/pages/vendor/index"));
const VendorPortalPricing = lazy(() => import("@/pages/vendor/pricing"));
const VendorClients = lazy(() => import("@/pages/vendor/clients"));
const AIBidAnalysisPage = lazy(() => import("@/pages/ai-bid-analysis"));
const AIContractAnalysisPage = lazy(() => import("@/pages/ai-contract-analysis"));
const ScheduleOfValuesPage = lazy(() => import("@/pages/schedule-of-values"));
const SubcontractsPage = lazy(() => import("@/pages/subcontracts"));
const RFIsPage = lazy(() => import("@/pages/rfis"));
const TransmittalsPage = lazy(() => import("@/pages/transmittals"));
const SubmittalsPage = lazy(() => import("@/pages/submittals"));
const WebsiteBuilderPage = lazy(() => import("@/pages/website-builder"));
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
const DelayClaimsPage = lazy(() => import("@/pages/delay-claims"));
const DailyReportLocksPage = lazy(() => import("@/pages/daily-report-locks"));
const PhotoCustodyPage = lazy(() => import("@/pages/photo-custody"));
const VoiceLogsPage = lazy(() => import("@/pages/voice-logs"));
const IssueCapturesPage = lazy(() => import("@/pages/issue-captures"));
const OfflineSyncPage = lazy(() => import("@/pages/offline-sync"));
const PublicWebsite = lazy(() => import("@/pages/public-website"));
const SharedPreviewPage = lazy(() => import("@/pages/shared-preview"));
const VendorScoresPage = lazy(() => import("@/pages/vendor-scores"));
const MaterialPriceIndexPage = lazy(() => import("@/pages/material-price-index"));
const CrewMarketplacePage = lazy(() => import("@/pages/crew-marketplace"));
const EquipmentRentalMarketplacePage = lazy(() => import("@/pages/equipment-rental-marketplace"));
const MarketplacePage = lazy(() => import("@/pages/marketplace"));
const PricebookImportPage = lazy(() => import("@/pages/pricebook-import"));
const ClientPortalPublic = lazy(() => import("@/pages/client-portal-public"));
const SubPortalPage = lazy(() => import("@/pages/sub-portal"));
const CompanyHealthPage = lazy(() => import("@/pages/company-health"));
const ExecutiveDigestPage = lazy(() => import("@/pages/executive-digest"));
const WhatIfSimulatorPage = lazy(() => import("@/pages/what-if-simulator"));
const CalculatorPage = lazy(() => import("@/pages/calculator"));
const ManageWorkersPage = lazy(() => import("@/pages/manage-workers"));
const WorkerDetailPage = lazy(() => import("@/pages/worker-detail"));
const PayrollManagementPage = lazy(() => import("@/pages/payroll-management"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const ApprovalsPage = lazy(() => import("@/pages/approvals"));
const AIGovernancePage = lazy(() => import("@/pages/ai-governance"));
const AuditLogsPage = lazy(() => import("@/pages/audit-logs"));
const EnterpriseSettingsPage = lazy(() => import("@/pages/enterprise-settings"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SafetyTrainingPage = lazy(() => import("@/pages/safety-training"));
const ProcurementModulePage = lazy(() => import("@/pages/procurement-module"));
const CostCodesPage = lazy(() => import("@/pages/cost-codes"));
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
      <Route path="/messages" component={() => <ProtectedRoute component={UnifiedMessagesPage} />} />
      <Route path="/portal-chat" component={() => <ProtectedRoute component={UnifiedMessagesPage} />} />
      
      {/* Admin-only routes */}
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} permission={RoutePermissions.USERS} />} />
      <Route path="/ai-settings" component={() => <ProtectedRoute component={AISettingsPage} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/cost-rates" component={() => <ProtectedRoute component={CostRatesPage} permission={RoutePermissions.COST_RATES} featurePerm="canAccessFinancials" />} />
      <Route path="/crews" component={() => <ProtectedRoute component={CrewsPage} permission={RoutePermissions.CREWS} />} />
      <Route path="/subcontractor-payables" component={() => <Redirect to="/subcontracts" />} />
      <Route path="/company-settings" component={() => <ProtectedRoute component={CompanySettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/integrations" component={() => <ProtectedRoute component={IntegrationsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/approvals" component={() => <ProtectedRoute component={ApprovalsPage} />} />
      <Route path="/ai-governance" component={() => <ProtectedRoute component={AIGovernancePage} permission={RoutePermissions.AI_SETTINGS} />} />
      <Route path="/audit-logs" component={() => <ProtectedRoute component={AuditLogsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/enterprise-settings" component={() => <ProtectedRoute component={EnterpriseSettingsPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      <Route path="/cost-codes" component={() => <ProtectedRoute component={CostCodesPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />
      
      {/* Management routes (blocked for hourly employees) */}
      <Route path="/bids/new" component={() => <ProtectedRoute component={BidWizardPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids" component={() => <ProtectedRoute component={BidsPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bids/:code/estimate" component={() => <ProtectedRoute component={BidEstimate} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/bids/:code" component={() => <ProtectedRoute component={BidDetailPage} permission={RoutePermissions.BID_DETAIL} />} />
      <Route path="/time-entry" component={() => <ProtectedRoute component={TimeEntryPage} permission={RoutePermissions.TIME_ENTRY} />} />
      <Route path="/tm-daily" component={() => <ProtectedRoute component={TMDailyPage} permission={RoutePermissions.TM_DAILY} />} />
      <Route path="/tm-billing" component={() => <ProtectedRoute component={TMBillingPage} permission={RoutePermissions.TM_BILLING} featurePerm="canAccessFinancials" />} />
      <Route path="/time-clock-manager" component={() => <ProtectedRoute component={TimeClockManagerPage} permission={RoutePermissions.TIME_CLOCK_MANAGER} featurePerm="canManagePayroll" />} />
      <Route path="/ai-pm" component={() => <ProtectedRoute component={AIPMDashboard} permission={RoutePermissions.AI_PM} featurePerm="canUseAiFeatures" />} />
      <Route path="/cfo" component={() => <ProtectedRoute component={CFODashboard} permission={RoutePermissions.CFO} featurePerm={["canAccessFinancials", "canUseAiFeatures"]} />} />
      <Route path="/production-rates" component={() => <ProtectedRoute component={ProductionRatesPage} permission={RoutePermissions.PRODUCTION_RATES} />} />
      <Route path="/crm" component={() => <ProtectedRoute component={CRMPage} permission={RoutePermissions.CRM} />} />
      <Route path="/scope-library" component={() => <ProtectedRoute component={ScopeLibraryPage} permission={RoutePermissions.SCOPE_LIBRARY} />} />
      <Route path="/scope-settings" component={() => <ProtectedRoute component={ScopeSettingsPage} permission={RoutePermissions.SCOPE_SETTINGS} />} />
      <Route path="/equipment/:code" component={() => <ProtectedRoute component={EquipmentDetailPage} permission={RoutePermissions.EQUIPMENT} featurePerm="canManageEquipment" />} />
      <Route path="/equipment" component={() => <ProtectedRoute component={EquipmentPage} permission={RoutePermissions.EQUIPMENT} featurePerm="canManageEquipment" />} />
      <Route path="/rental-vendors" component={() => <Redirect to="/crm" />} />
      <Route path="/vendor-pricing" component={() => <ProtectedRoute component={VendorPricingPage} permission={RoutePermissions.CRM} featurePerm="canManageProcurement" />} />
      <Route path="/mobile-sync" component={() => <ProtectedRoute component={MobileSyncPage} />} />
      
      {/* AI Analysis routes */}
      <Route path="/ai-bid-analysis" component={() => <ProtectedRoute component={AIBidAnalysisPage} permission={RoutePermissions.AI_BID_ANALYSIS} featurePerm="canUseAiFeatures" />} />
      <Route path="/ai-contract-analysis" component={() => <ProtectedRoute component={AIContractAnalysisPage} permission={RoutePermissions.AI_CONTRACT_ANALYSIS} featurePerm="canUseAiFeatures" />} />
      
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
      <Route path="/equipment-rental-marketplace" component={() => <ProtectedRoute component={EquipmentRentalMarketplacePage} />} />
      <Route path="/marketplace" component={() => <ProtectedRoute component={MarketplacePage} />} />
      <Route path="/pricebook-import" component={() => <ProtectedRoute component={PricebookImportPage} permission={RoutePermissions.CRM} featurePerm="canManageProcurement" />} />
      
      {/* Executive Intelligence routes */}
      <Route path="/company-health" component={() => <ProtectedRoute component={CompanyHealthPage} permission={RoutePermissions.CFO} featurePerm="canAccessFinancials" />} />
      <Route path="/executive-digest" component={() => <ProtectedRoute component={ExecutiveDigestPage} permission={RoutePermissions.CFO} featurePerm="canAccessFinancials" />} />
      <Route path="/what-if-simulator" component={() => <ProtectedRoute component={WhatIfSimulatorPage} permission={RoutePermissions.CFO} featurePerm="canAccessFinancials" />} />
      
      {/* Bid Network routes */}
      <Route path="/bid-network/:id" component={() => <ProtectedRoute component={BidNetworkDetailPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bid-network" component={() => <ProtectedRoute component={BidNetworkPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bid-inbox/:id" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BIDS} />} />
      <Route path="/bid-inbox" component={() => <ProtectedRoute component={BidInboxPage} permission={RoutePermissions.BIDS} />} />
      
      {/* Marketplace routes */}
      <Route path="/marketplace/contractors/:orgId" component={() => <ProtectedRoute component={ContractorProfilePage} />} />
      <Route path="/marketplace" component={() => <ProtectedRoute component={MarketplacePage} />} />
      
      {/* Tools routes */}
      <Route path="/calculator" component={() => <ProtectedRoute component={CalculatorPage} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={ReportsPage} permission={RoutePermissions.REPORTS} featurePerm="canAccessReports" />} />
      <Route path="/manage-workers/:id" component={() => <ProtectedRoute component={WorkerDetailPage} permission={RoutePermissions.MANAGE_WORKERS} featurePerm="canManagePayroll" />} />
      <Route path="/manage-workers" component={() => <ProtectedRoute component={ManageWorkersPage} permission={RoutePermissions.MANAGE_WORKERS} featurePerm="canManagePayroll" />} />
      <Route path="/safety-training" component={() => <ProtectedRoute component={SafetyTrainingPage} />} />
      <Route path="/payroll-management" component={() => <ProtectedRoute component={PayrollManagementPage} permission={RoutePermissions.PAYROLL_MANAGEMENT} featurePerm="canManagePayroll" />} />
      <Route path="/schedule-of-values" component={() => <ProtectedRoute component={ScheduleOfValuesPage} permission={RoutePermissions.SCHEDULE_OF_VALUES} featurePerm="canAccessFinancials" />} />
      <Route path="/subcontracts" component={() => <ProtectedRoute component={SubcontractsPage} permission={RoutePermissions.SUBCONTRACTS} featurePerm="canAccessFinancials" />} />
      <Route path="/rfis" component={() => <ProtectedRoute component={RFIsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/transmittals" component={() => <ProtectedRoute component={TransmittalsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/submittals" component={() => <ProtectedRoute component={SubmittalsPage} permission={RoutePermissions.SUBCONTRACTS} />} />
      <Route path="/website-builder" component={() => <ProtectedRoute component={WebsiteBuilderPage} permission={RoutePermissions.WEBSITE_BUILDER} featurePerm="canManageWebsite" />} />
      <Route path="/social-media" component={() => <ProtectedRoute component={SocialMediaPage} permission={RoutePermissions.SOCIAL_MEDIA} featurePerm="canPostSocialMedia" />} />
      <Route path="/email-assistant" component={() => <ProtectedRoute component={EmailAssistantPage} />} />
      <Route path="/procurement-module" component={() => <ProtectedRoute component={ProcurementModulePage} permission={RoutePermissions.PROCUREMENT} />} />
      <Route path="/billing" component={() => <ProtectedRoute component={BillingPage} permission={RoutePermissions.COMPANY_SETTINGS} />} />

      {/* Hiring Module routes */}
      <Route path="/hiring/jobs/:id" component={() => <ProtectedRoute component={HiringJobDetailPage} permission={RoutePermissions.HIRING_REVIEW} />} />
      <Route path="/hiring/jobs" component={() => <ProtectedRoute component={HiringJobsPage} permission={RoutePermissions.HIRING_REVIEW} />} />
      <Route path="/hiring/candidates/:id" component={() => <ProtectedRoute component={HiringCandidateDetailPage} permission={RoutePermissions.HIRING_REVIEW} />} />
      <Route path="/hiring/candidates" component={() => <ProtectedRoute component={HiringCandidatesPage} permission={RoutePermissions.HIRING_REVIEW} />} />
      <Route path="/hiring/pipeline" component={() => <ProtectedRoute component={HiringPipelinePage} permission={RoutePermissions.HIRING_REVIEW} />} />
      <Route path="/hiring/interviews" component={() => <ProtectedRoute component={HiringInterviewsPage} permission={RoutePermissions.HIRING_ADVANCED} />} />
      <Route path="/hiring/tasks" component={() => <ProtectedRoute component={HiringTasksPage} permission={RoutePermissions.HIRING_REVIEW} />} />
      <Route path="/hiring/analytics" component={() => <ProtectedRoute component={HiringAnalyticsPage} permission={RoutePermissions.HIRING_ADVANCED} />} />
      <Route path="/hiring/settings" component={() => <ProtectedRoute component={HiringSettingsPage} permission={RoutePermissions.HIRING_SETTINGS} />} />
      <Route path="/hiring" component={() => <ProtectedRoute component={HiringDashboardPage} permission={RoutePermissions.HIRING_REVIEW} />} />
      
      {/* Vendor Portal routes (VENDOR only) */}
      <Route path="/vendor/pricing" component={() => <ProtectedRoute component={VendorPortalPricing} permission={VendorRoutePermissions.VENDOR_PRICING} skipOnboardingCheck />} />
      <Route path="/vendor/clients" component={() => <ProtectedRoute component={VendorClients} permission={VendorRoutePermissions.VENDOR_CLIENTS} skipOnboardingCheck />} />
      <Route path="/vendor" component={() => <ProtectedRoute component={VendorDashboard} permission={VendorRoutePermissions.VENDOR_DASHBOARD} skipOnboardingCheck />} />
      
      {/* Platform Admin routes (SUPER_ADMIN only) */}
      <Route path="/admin" component={() => <ProtectedRoute component={PlatformAdminDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations/:id" component={() => <ProtectedRoute component={PlatformOrganizationDetail} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/organizations" component={() => <ProtectedRoute component={PlatformOrganizations} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/subscriptions" component={() => <ProtectedRoute component={PlatformSubscriptions} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/analytics" component={() => <ProtectedRoute component={PlatformAnalytics} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/support" component={() => <ProtectedRoute component={PlatformSupportTools} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      <Route path="/admin/audit" component={() => <ProtectedRoute component={PlatformAuditDashboard} permission={RoutePermissions.PLATFORM_ADMIN} skipOnboardingCheck />} />
      
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
        <TopHeader />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
      <PushNotificationBanner />
    </SidebarProvider>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { user, isLoading } = useAuth();
  
  const isStandaloneRoute = location.startsWith('/site/') || location.startsWith('/sub-portal');

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
  const { user } = useAuth();
  if (!user) return null;
  return <Suspense fallback={null}><AIAssistantWidget /></Suspense>;
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
              <AuthGatedWidget />
            </TooltipProvider>
          </DashboardCustomizationProvider>
        </TourProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
