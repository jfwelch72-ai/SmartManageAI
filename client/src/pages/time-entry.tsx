import TimeEntryContent from "@/components/TimeEntryContent";

export default function TimeEntryPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-page-title">
            Time Entry Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Review, approve, and manage employee time entries
          </p>
        </div>
        <TimeEntryContent />
      </main>
    </div>
  );
}
