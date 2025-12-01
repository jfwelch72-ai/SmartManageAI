import { useState, useRef } from "react";
import TMDailyForm, { TMDailyFormRef } from "@/components/TMDailyForm";
import { useAuth } from "@/hooks/use-auth";
import { useProjects, useProjectTMSheets, useCreateTMSheet } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { FileText } from "lucide-react";

export default function TMDailyPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const formRef = useRef<TMDailyFormRef>(null);
  
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: tmSheets = [], isLoading: sheetsLoading } = useProjectTMSheets(
    projects.find(p => p.id === selectedProjectId)?.code || ""
  );
  const createSheet = useCreateTMSheet();

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const handleSubmit = async (data: {
    date: string;
    tfrRepName: string;
    clientRepName: string;
    weather: string;
    descriptionOfWork: string;
    crewSize: number;
  }) => {
    if (!selectedProject) {
      toast({
        title: "Error",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    try {
      await createSheet.mutateAsync({
        projectId: selectedProject.id,
        projectCode: selectedProject.code,
        date: new Date(data.date),
        tfrRepName: data.tfrRepName,
        clientRepName: data.clientRepName || "",
        weather: data.weather || "",
        descriptionOfWork: data.descriptionOfWork,
        crewSize: data.crewSize,
        createdById: user!.id,
      });
      toast({
        title: "Success",
        description: "T&M daily sheet submitted successfully",
      });
      // Reset form only after successful submission
      formRef.current?.reset();
    } catch (error: any) {
      console.error("T&M sheet submission error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to submit T&M sheet",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">Daily T&M Sheet</h1>
          <p className="text-sm text-muted-foreground">
            Document time and materials for project work
          </p>
        </div>

        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Select Project</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="project-select">Project</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger id="project-select" data-testid="select-tm-project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.code} - {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {selectedProject && (
            <>
              <TMDailyForm
                ref={formRef}
                projectName={`${selectedProject.code} - ${selectedProject.name}`}
                onSubmit={handleSubmit}
              />

              <Card>
                <CardHeader>
                  <CardTitle>Recent T&M Sheets</CardTitle>
                </CardHeader>
                <CardContent>
                  {sheetsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Loading...
                    </div>
                  ) : tmSheets.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No T&M sheets found for this project
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {tmSheets.map(sheet => (
                        <div 
                          key={sheet.id} 
                          className="flex items-start justify-between p-4 border rounded-md"
                          data-testid={`tm-sheet-${sheet.id}`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium text-sm" data-testid={`text-date-${sheet.id}`}>
                                {format(new Date(sheet.date), "EEEE, MMM d, yyyy")}
                              </span>
                              {sheet.crewSize && (
                                <Badge variant="secondary" className="text-xs">
                                  {sheet.crewSize} crew
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-1">
                              <strong>Company Rep:</strong> {sheet.tfrRepName}
                              {sheet.clientRepName && (
                                <> | <strong>Client Rep:</strong> {sheet.clientRepName}</>
                              )}
                            </p>
                            {sheet.weather && (
                              <p className="text-xs text-muted-foreground mb-1">
                                <strong>Weather:</strong> {sheet.weather}
                              </p>
                            )}
                            <p className="text-sm mt-2">{sheet.descriptionOfWork}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
