import SkillsCertificationsTab from "@/components/SkillsCertificationsTab";

export default function SkillsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-skills">Skills & Certifications</h2>
        <p className="text-muted-foreground mt-1">Manage your professional skills and certifications</p>
      </div>
      <SkillsCertificationsTab />
    </div>
  );
}