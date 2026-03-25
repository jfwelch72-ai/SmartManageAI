import VendorPricingSync from "@/components/VendorPricingSync";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess } from "@/lib/rbac";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function VendorPricingPage() {
  const { user } = useAuth();

  if (!hasManagementAccess(user?.role)) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container max-w-full mx-auto px-4 py-8">
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
      <main className="container max-w-full mx-auto px-4 py-8">
        <VendorPricingSync />
      </main>
    </div>
  );
}
