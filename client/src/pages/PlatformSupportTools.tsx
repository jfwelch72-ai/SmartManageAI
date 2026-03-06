import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ChevronLeft, Users, Archive, Building2, Database } from "lucide-react";
import { Link } from "wouter";
import { SupportUserLookup } from "@/components/platform/SupportUserLookup";
import { SupportAuditPanel } from "@/components/platform/SupportAuditPanel";
import { SupportOrgTools } from "@/components/platform/SupportOrgTools";
import { SupportSystemChecks } from "@/components/platform/SupportSystemChecks";

export default function PlatformSupportTools() {
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="min-h-screen bg-background">
      <main className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-support-title">Support Tools</h1>
            <p className="text-muted-foreground">Backend support tools for resolving user issues</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="w-full max-w-xs">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger data-testid="select-support-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="users" data-testid="tab-users">
                <span className="flex items-center gap-2"><Users className="h-4 w-4" /> All Users</span>
              </SelectItem>
              <SelectItem value="archived" data-testid="tab-archived">
                <span className="flex items-center gap-2"><Archive className="h-4 w-4" /> Archived Users</span>
              </SelectItem>
              <SelectItem value="sow" data-testid="tab-sow">
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> SOW Items</span>
              </SelectItem>
              <SelectItem value="worktypes" data-testid="tab-worktypes">
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Work Types</span>
              </SelectItem>
              <SelectItem value="datatools" data-testid="tab-datatools">
                <span className="flex items-center gap-2"><Database className="h-4 w-4" /> Data Tools</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="users" className="space-y-4">
          <SupportUserLookup />
        </TabsContent>

        <TabsContent value="archived" className="space-y-4">
          <SupportAuditPanel />
        </TabsContent>

        <TabsContent value="sow" className="space-y-4">
          <SupportOrgTools tab="sow" />
        </TabsContent>

        <TabsContent value="worktypes" className="space-y-4">
          <SupportOrgTools tab="worktypes" />
        </TabsContent>

        <TabsContent value="datatools" className="space-y-4">
          <SupportSystemChecks />
        </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
