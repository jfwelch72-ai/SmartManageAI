import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { DashboardSectionComponent } from "@/components/DashboardSection";
import { PackageOpen } from "lucide-react";

interface DashboardGridProps {
  onAddWidgetToSection?: (sectionId: string) => void;
}

export function DashboardGrid({ onAddWidgetToSection }: DashboardGridProps) {
  const { isEditMode, localLayout } = useDashboardCustomization();
  const sections = localLayout?.sections || [];

  if (!localLayout || sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <div className="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center">
          <PackageOpen className="w-8 h-8 text-muted-foreground/50" />
        </div>
        <p className="text-sm font-medium">{isEditMode ? 'Click "Add Section" to get started.' : "No dashboard sections configured."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="dashboard-grid">
      {sections.map((section, index) => (
        <div
          key={section.id}
          className="animate-[fadeSlideUp_0.4s_ease-out_both]"
          style={{ animationDelay: `${index * 80}ms` }}
        >
          <DashboardSectionComponent
            section={section}
            sectionIndex={index}
            totalSections={sections.length}
            onAddWidget={onAddWidgetToSection}
          />
        </div>
      ))}
    </div>
  );
}
