import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Wrench, Image, Shield, FileText, Clock, Users } from "lucide-react";
import { CompanyTradeConfigTab } from "@/components/settings/CompanyTradeConfigTab";
import { CompanyProfileTab } from "@/components/settings/CompanyProfileTab";
import { CompanyNotificationsTab } from "@/components/settings/CompanyNotificationsTab";
import { CompanyUserInviteTab } from "@/components/settings/CompanyUserInviteTab";

export default function CompanySettings() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("trade");

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view company settings</p>
      </div>
    );
  }

  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8 text-primary" />
            Company Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your organization's branding, insurance, and compliance documents
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {isMobile ? (
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="mb-4" data-testid="select-company-settings-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trade">Trade</SelectItem>
              <SelectItem value="branding">Branding</SelectItem>
              <SelectItem value="insurance">Insurance</SelectItem>
              <SelectItem value="compliance">Compliance</SelectItem>
              <SelectItem value="payroll">Payroll</SelectItem>
              <SelectItem value="hustler">Hustler Oversight</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <TabsList data-testid="tabs-company-settings">
            <TabsTrigger value="trade" data-testid="tab-trade">
              <Wrench className="h-4 w-4 mr-2" /> Trade
            </TabsTrigger>
            <TabsTrigger value="branding" data-testid="tab-branding">
              <Image className="h-4 w-4 mr-2" /> Branding
            </TabsTrigger>
            <TabsTrigger value="insurance" data-testid="tab-insurance">
              <Shield className="h-4 w-4 mr-2" /> Insurance
            </TabsTrigger>
            <TabsTrigger value="compliance" data-testid="tab-compliance">
              <FileText className="h-4 w-4 mr-2" /> Compliance
            </TabsTrigger>
            <TabsTrigger value="payroll" data-testid="tab-payroll">
              <Clock className="h-4 w-4 mr-2" /> Payroll
            </TabsTrigger>
            <TabsTrigger value="hustler" data-testid="tab-hustler">
              <Users className="h-4 w-4 mr-2" /> Hustler Oversight
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="trade" className="mt-6">
          <CompanyTradeConfigTab />
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <CompanyProfileTab activeDocTab="branding" />
        </TabsContent>

        <TabsContent value="insurance" className="mt-6">
          <CompanyProfileTab activeDocTab="insurance" />
        </TabsContent>

        <TabsContent value="compliance" className="mt-6">
          <CompanyProfileTab activeDocTab="compliance" />
        </TabsContent>

        <TabsContent value="payroll" className="mt-6">
          <CompanyNotificationsTab />
        </TabsContent>

        <TabsContent value="hustler" className="mt-6">
          <CompanyUserInviteTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
