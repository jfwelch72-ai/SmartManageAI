import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import TimeEntryForm from "@/components/TimeEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

//todo: remove mock functionality
const mockProjects = [
  { id: '1', code: 'TFR-240639', name: 'OSU Outpatient East' },
  { id: '2', code: 'TFR-240512', name: 'Downtown Office Tower' },
  { id: '3', code: 'TFR-240420', name: 'Riverside Apartments' },
];

const mockTimeEntries = [
  {
    id: '1',
    date: '2024-01-15',
    project: 'TFR-240639 - OSU Outpatient East',
    regularHours: 8,
    overtimeHours: 2,
    costCode: '03-300 - Concrete',
    status: 'pending',
  },
  {
    id: '2',
    date: '2024-01-14',
    project: 'TFR-240512 - Downtown Office Tower',
    regularHours: 8,
    overtimeHours: 0,
    costCode: '03-100 - Formwork',
    status: 'approved',
  },
];

export default function TimeEntryPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName="John Martinez"
        userRole="Hourly Employee"
        onLogout={() => setLocation('/login')}
      />
      
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">My Time Entries</h1>
          <p className="text-sm text-muted-foreground">
            Log your daily hours worked on projects
          </p>
        </div>

        <div className="space-y-8">
          <TimeEntryForm
            projects={mockProjects}
            onSubmit={(entry) => console.log('Time entry submitted:', entry)}
          />

          <Card>
            <CardHeader>
              <CardTitle>Recent Entries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mockTimeEntries.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between p-4 border rounded-md">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{entry.date}</span>
                        <Badge 
                          variant={entry.status === 'approved' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {entry.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{entry.project}</p>
                      <p className="text-xs text-muted-foreground">{entry.costCode}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium font-mono">
                        {entry.regularHours}h reg
                        {entry.overtimeHours > 0 && `, ${entry.overtimeHours}h OT`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
