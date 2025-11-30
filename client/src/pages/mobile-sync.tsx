import MobileSyncStatus from "@/components/MobileSyncStatus";
import { useAuth } from "@/hooks/use-auth";

export default function MobileSyncPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <MobileSyncStatus userId={user?.id} />
      </main>
    </div>
  );
}
