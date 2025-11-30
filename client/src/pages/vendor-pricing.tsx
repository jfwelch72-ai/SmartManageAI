import AppHeader from "@/components/AppHeader";
import VendorPricingSync from "@/components/VendorPricingSync";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess } from "@/lib/rbac";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function VendorPricingPage() {
  const { user, logout, organizationName } = useAuth();

  if (!hasManagementAccess(user?.role)) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader 
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
          organizationName={organizationName || undefined}
        />
        <main className="container mx-auto px-4 py-8">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription>
              You do not have permission to access vendor pricing management.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />
      <main className="container mx-auto px-4 py-8">
        <VendorPricingSync />
      </main>
    </div>
  );
}
