import AppHeader from "@/components/AppHeader";
import TMDailyForm from "@/components/TMDailyForm";
import { useLocation } from "wouter";

export default function TMDailyPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName="Mike Johnson"
        userRole="Superintendent"
        onLogout={() => setLocation('/login')}
      />
      
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">Daily T&M Sheet</h1>
          <p className="text-sm text-muted-foreground">
            Document time and materials for today's work
          </p>
        </div>

        <TMDailyForm
          projectName="OSU Outpatient East – Parking Lot"
          onSubmit={(data) => console.log('T&M Daily submitted:', data)}
        />
      </main>
    </div>
  );
}
