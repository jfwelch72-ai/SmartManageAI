import AppHeader from "@/components/AppHeader";
import MobileSyncStatus from "@/components/MobileSyncStatus";
import { useAuth } from "@/hooks/use-auth";

export default function MobileSyncPage() {
  const { user, logout, organizationName } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />
      <main className="container mx-auto px-4 py-8">
        <MobileSyncStatus userId={user?.id} />
      </main>
    </div>
  );
}
