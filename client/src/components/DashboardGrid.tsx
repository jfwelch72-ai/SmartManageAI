import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { DashboardSectionComponent } from "@/components/DashboardSection";

export function DashboardGrid() {
  const { isEditMode, localLayout } = useDashboardCustomization();
  const sections = localLayout?.sections || [];

  if (!localLayout || sections.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{isEditMode ? 'Click "Add Section" to get started.' : "No dashboard sections configured."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="dashboard-grid">
      {sections.map((section, index) => (
        <DashboardSectionComponent
          key={section.id}
          section={section}
          sectionIndex={index}
          totalSections={sections.length}
        />
      ))}
    </div>
  );
}
