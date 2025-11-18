import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import ScopeOfWorkTable from "@/components/ScopeOfWorkTable";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import MediaGallery from "@/components/MediaGallery";
import { Building2, MapPin, User, Phone, Mail, Calendar, Plus } from "lucide-react";
import { useLocation } from "wouter";

//todo: remove mock functionality
const mockProject = {
  code: "TFR-240639",
  name: "OSU Outpatient East – Parking Lot",
  clientName: "Ohio State University",
  clientContact: "Dr. Jennifer Martinez",
  clientEmail: "martinez.123@osu.edu",
  clientPhone: "(614) 555-0123",
  status: "ACTIVE" as const,
  location: "421 Medical Center Dr, Columbus, OH 43210",
  startDate: "2024-03-15",
  endDate: "2024-08-30",
  description: "Concrete work for new parking structure and connecting walkways at OSU Medical Center East campus.",
  superintendent: "Mike Johnson",
  estimator: "Sarah Williams",
};

const mockEstimates = [
  {
    id: '1',
    version: 1,
    status: 'WON' as const,
    amount: '$487,500',
    date: '2024-02-10',
  },
];

const mockProcurement = [
  {
    id: '1',
    description: 'Ready-mix concrete 4000 PSI',
    vendor: 'Columbus Concrete Supply',
    quantity: 450,
    unit: 'CY',
    status: 'ORDERED' as const,
  },
  {
    id: '2',
    description: 'Rebar #5 Grade 60',
    vendor: 'Steel Solutions Inc',
    quantity: 12000,
    unit: 'LF',
    status: 'DELIVERED' as const,
  },
];

const mockDocuments = [
  { id: '1', title: 'Site Plans Rev 3.pdf', type: 'PLANS', uploadedBy: 'Sarah Williams', date: '2024-03-01' },
  { id: '2', title: 'Structural Drawings.pdf', type: 'PLANS', uploadedBy: 'Sarah Williams', date: '2024-03-01' },
  { id: '3', title: 'Concrete Specifications.pdf', type: 'SPECS', uploadedBy: 'Mike Johnson', date: '2024-03-05' },
];

const mockScopeItems = [
  { id: '1', description: 'Sidewalk', unit: 'SF', totalQuantity: 5000, completedQuantity: 3200 },
  { id: '2', description: 'Curb', unit: 'LF', totalQuantity: 800, completedQuantity: 650 },
  { id: '3', description: 'Slab on Grade', unit: 'SF', totalQuantity: 12000, completedQuantity: 8500 },
  { id: '4', description: 'Bollards', unit: 'EA', totalQuantity: 24, completedQuantity: 18 },
];

const mockDailyNotes = [
  {
    id: '1',
    author: 'Mike Johnson',
    authorRole: 'Superintendent',
    date: '2024-01-18',
    time: '4:30 PM',
    content: 'Completed 1,200 SF of sidewalk today. Weather was clear. Concrete delivery arrived on time at 8:15 AM. No safety incidents. Crew of 8 performed well.',
  },
  {
    id: '2',
    author: 'Sarah Williams',
    authorRole: 'Project Manager',
    date: '2024-01-17',
    time: '3:15 PM',
    content: 'Met with client rep regarding schedule adjustment for upcoming rain forecast. Agreed to shift curb work to next week. Updated project timeline accordingly.',
  },
];

const mockMediaItems = [
  {
    id: '1',
    type: 'image' as const,
    url: '/placeholder1.jpg',
    caption: 'Foundation excavation complete',
    uploadedBy: 'Mike Johnson',
    uploadedAt: '2024-01-18',
  },
  {
    id: '2',
    type: 'image' as const,
    url: '/placeholder2.jpg',
    caption: 'Concrete pour in progress - Section A',
    uploadedBy: 'Mike Johnson',
    uploadedAt: '2024-01-17',
  },
];

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName="Sarah Williams"
        userRole="Project Manager"
        onLogout={() => setLocation('/login')}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" onClick={() => setLocation('/projects')} data-testid="button-back">
              ← Back to Projects
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {mockProject.code}
                </Badge>
                <StatusBadge status={mockProject.status} type="project" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">{mockProject.name}</h1>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-scope">Scope & Progress</TabsTrigger>
            <TabsTrigger value="daily-notes" data-testid="tab-daily-notes">Daily Notes</TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">Photos & Videos</TabsTrigger>
            <TabsTrigger value="estimate" data-testid="tab-estimate">Estimate</TabsTrigger>
            <TabsTrigger value="procurement" data-testid="tab-procurement">Procurement</TabsTrigger>
            <TabsTrigger value="plans" data-testid="tab-plans">Plans & Takeoff</TabsTrigger>
            <TabsTrigger value="time" data-testid="tab-time">Time & T&M</TabsTrigger>
            <TabsTrigger value="receipts" data-testid="tab-receipts">Receipts</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Client</p>
                      <p className="text-sm text-muted-foreground">{mockProject.clientName}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact</p>
                      <p className="text-sm text-muted-foreground">{mockProject.clientContact}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-sm text-muted-foreground">{mockProject.clientEmail}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Phone</p>
                      <p className="text-sm text-muted-foreground">{mockProject.clientPhone}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-sm text-muted-foreground">{mockProject.location}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Project Team</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Superintendent</p>
                    <p className="text-sm text-muted-foreground">{mockProject.superintendent}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Estimator</p>
                    <p className="text-sm text-muted-foreground">{mockProject.estimator}</p>
                  </div>
                  <div className="flex items-start gap-3 pt-2">
                    <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Timeline</p>
                      <p className="text-sm text-muted-foreground">
                        {mockProject.startDate} → {mockProject.endDate}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{mockProject.description}</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scope">
            <Card>
              <CardHeader>
                <CardTitle>Scope of Work & Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <ScopeOfWorkTable
                  items={mockScopeItems}
                  onUpdateProgress={(id, qty) => console.log(`Update item ${id} to ${qty}`)}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="daily-notes">
            <DailyNoteFeed
              notes={mockDailyNotes}
              onAddNote={(content) => console.log('New daily note:', content)}
            />
          </TabsContent>

          <TabsContent value="media">
            <MediaGallery
              items={mockMediaItems}
              onUpload={(files) => console.log('Media uploaded:', files)}
              onDelete={(id) => console.log('Delete media:', id)}
            />
          </TabsContent>

          <TabsContent value="estimate">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Estimates</CardTitle>
                <Button size="sm" data-testid="button-new-estimate">
                  <Plus className="w-4 h-4 mr-2" />
                  New Estimate
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockEstimates.map(estimate => (
                    <div key={estimate.id} className="flex items-center justify-between p-4 border rounded-md hover-elevate">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">Version {estimate.version}</span>
                          <StatusBadge status={estimate.status} type="estimate" />
                        </div>
                        <p className="text-sm text-muted-foreground">{estimate.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold font-mono">{estimate.amount}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="procurement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Procurement Items</CardTitle>
                <Button size="sm" data-testid="button-new-procurement">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {mockProcurement.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-4 border rounded-md">
                      <div className="flex-1">
                        <p className="font-medium mb-1">{item.description}</p>
                        <p className="text-sm text-muted-foreground">{item.vendor}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-mono text-sm">{item.quantity} {item.unit}</p>
                        </div>
                        <StatusBadge status={item.status} type="procurement" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <FileUploadZone
                    onFileSelect={(files) => console.log('Files selected:', files)}
                    accept=".pdf,.dwg,.jpg,.png"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {mockDocuments.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate">
                        <div>
                          <p className="font-medium text-sm">{doc.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded by {doc.uploadedBy} on {doc.date}
                          </p>
                        </div>
                        <Badge variant="outline">{doc.type}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="time">
            <Card>
              <CardHeader>
                <CardTitle>Time & Material Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Time entries and T&M daily sheets will appear here.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Receipts</CardTitle>
                <Button size="sm" data-testid="button-upload-receipt">
                  <Plus className="w-4 h-4 mr-2" />
                  Upload Receipt
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  No receipts uploaded yet.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
