import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Briefcase,
  DollarSign,
  Building2,
  Calculator,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { EmployeeRatesTab } from "@/components/cost-rates/EmployeeRatesTab";
import {
  JobClassificationsContent,
  EmployeeAssignmentsContent,
} from "@/components/cost-rates/ClassificationsTab";
import { PrevailingWageTab } from "@/components/cost-rates/PrevailingWageTab";
import {
  SalaryCategoriesContent,
  BurdenRatesContent,
  CostAssignmentsContent,
} from "@/components/cost-rates/BurdenMultipliersTab";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  costRateRegular: string | null;
  costRateOvertime: string | null;
}

interface JobClassification {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  description: string | null;
  defaultRegularRate: string | null;
  defaultOvertimeRate: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface EmployeeClassification {
  id: string;
  userId: string;
  classificationId: string;
  regularRate: string;
  overtimeRate: string;
  isPrimary: boolean;
  effectiveDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  classification: { id: string; name: string; code: string | null } | null;
}

interface PrevailingWageRate {
  id: string;
  projectId: string;
  classificationId: string;
  wageRate: string;
  fringeRate: string;
  totalRate: string;
  overtimeMultiplier: string;
  effectiveDate: string;
  expirationDate: string | null;
  wageDecision: string | null;
  notes: string | null;
  createdAt: string;
  project: { id: string; name: string; code: string | null } | null;
  classification: { id: string; name: string; code: string | null } | null;
}

interface Project {
  id: string;
  name: string;
  code: string | null;
}

interface AnnualSalaryCategory {
  id: string;
  organizationId: string;
  name: string;
  baseAnnualSalary: string;
  salaryType: string | null;
  effectiveDate: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BurdenRateConfig {
  id: string;
  organizationId: string;
  name: string;
  burdenPercentage: string;
  fixedBurdenAmount: string | null;
  taxesPercent: string | null;
  benefitsPercent: string | null;
  insurancePercent: string | null;
  overheadPercent: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EmployeeCostAssignment {
  id: string;
  organizationId: string;
  userId: string;
  salaryCategoryId: string;
  burdenRateId: string | null;
  workingHoursPerYear: number;
  fullyBurdenedCost: string | null;
  derivedHourlyRate: string | null;
  effectiveDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
  userLastName: string | null;
  userEmail: string | null;
  salaryName: string | null;
  baseAnnualSalary: string | null;
  burdenName: string | null;
  burdenPercentage: string | null;
  fixedBurdenAmount: string | null;
}

export default function CostRatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("employee-rates");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: string;
    id: string;
    name: string;
  } | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: classifications = [], isLoading: classificationsLoading } =
    useQuery<JobClassification[]>({
      queryKey: ["/api/labor-rates/classifications"],
    });

  const { data: employeeClassifications = [], isLoading: empClassLoading } =
    useQuery<EmployeeClassification[]>({
      queryKey: ["/api/labor-rates/employee-classifications"],
    });

  const { data: prevailingWageRates = [], isLoading: pwRatesLoading } =
    useQuery<PrevailingWageRate[]>({
      queryKey: ["/api/labor-rates/prevailing-wage-rates"],
    });

  const { data: projectsResponse } = useQuery<{
    data: Project[];
    pagination?: any;
  }>({
    queryKey: ["/api/projects"],
  });
  const projects = projectsResponse?.data || [];

  const { data: salaryCategories = [], isLoading: salCatLoading } = useQuery<
    AnnualSalaryCategory[]
  >({
    queryKey: ["/api/labor-rates/salary-categories"],
  });

  const { data: burdenRatesList = [], isLoading: burdenLoading } = useQuery<
    BurdenRateConfig[]
  >({
    queryKey: ["/api/labor-rates/burden-rates"],
  });

  const { data: costAssignments = [], isLoading: costAssignLoading } = useQuery<
    EmployeeCostAssignment[]
  >({
    queryKey: ["/api/labor-rates/cost-assignments"],
  });

  const deleteClassificationMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/labor-rates/classifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/labor-rates/classifications"],
      });
      toast({ title: "Success", description: "Classification deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete classification",
        variant: "destructive",
      }),
  });

  const deleteEmployeeClassMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/labor-rates/employee-classifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/labor-rates/employee-classifications"],
      });
      toast({ title: "Success", description: "Assignment deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete assignment",
        variant: "destructive",
      }),
  });

  const deletePWRateMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/labor-rates/prevailing-wage-rates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/labor-rates/prevailing-wage-rates"],
      });
      toast({ title: "Success", description: "Rate deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete rate",
        variant: "destructive",
      }),
  });

  const deleteSalaryCatMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/labor-rates/salary-categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/labor-rates/salary-categories"],
      });
      toast({ title: "Success", description: "Salary category deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete salary category",
        variant: "destructive",
      }),
  });

  const deleteBurdenRateMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/labor-rates/burden-rates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/labor-rates/burden-rates"],
      });
      toast({ title: "Success", description: "Burden rate deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete burden rate",
        variant: "destructive",
      }),
  });

  const deleteCostAssignMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/labor-rates/cost-assignments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/labor-rates/cost-assignments"],
      });
      toast({ title: "Success", description: "Cost assignment deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete cost assignment",
        variant: "destructive",
      }),
  });

  const handleDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "classification") {
      deleteClassificationMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "employee-class") {
      deleteEmployeeClassMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "pw-rate") {
      deletePWRateMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "salary-cat") {
      deleteSalaryCatMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "burden-rate") {
      deleteBurdenRateMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "cost-assign") {
      deleteCostAssignMutation.mutate(deleteTarget.id);
    }
  };

  const confirmDelete = (type: string, id: string, name: string) => {
    setDeleteTarget({ type, id, name });
    setShowDeleteConfirm(true);
  };

  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER";

  const tabOptions = [
    { value: "employee-rates", label: "Employee Rates", icon: Users },
    { value: "classifications", label: "Job Classifications", icon: Briefcase },
    {
      value: "employee-classifications",
      label: "Employee Assignments",
      icon: Users,
    },
    { value: "prevailing-wage", label: "Prevailing Wage", icon: Building2 },
    {
      value: "salary-categories",
      label: "Salary Categories",
      icon: DollarSign,
    },
    { value: "burden-rates", label: "Burden Rates", icon: Calculator },
    { value: "cost-assignments", label: "Cost Assignments", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-4 sm:px-6 py-4 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">
            Labor Cost Rate Management
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Manage employee base rates, job classifications, and prevailing wage
            rates for projects
          </p>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <div className="md:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger data-testid="select-tab-mobile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tabOptions.map((tab) => (
                  <SelectItem
                    key={tab.value}
                    value={tab.value}
                    data-testid={`tab-mobile-${tab.value}`}
                  >
                    <span className="flex items-center gap-2">
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TabsList className="hidden md:flex flex-wrap w-full">
            {tabOptions.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-2"
                data-testid={`tab-${tab.value}`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="employee-rates">
            <EmployeeRatesTab
              users={users}
              usersLoading={usersLoading}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent value="classifications">
            <JobClassificationsContent
              classifications={classifications}
              classificationsLoading={classificationsLoading}
              canEdit={canEdit}
              confirmDelete={confirmDelete}
            />
          </TabsContent>

          <TabsContent value="employee-classifications">
            <EmployeeAssignmentsContent
              users={users}
              classifications={classifications}
              employeeClassifications={employeeClassifications}
              empClassLoading={empClassLoading}
              canEdit={canEdit}
              confirmDelete={confirmDelete}
            />
          </TabsContent>

          <TabsContent value="prevailing-wage">
            <PrevailingWageTab
              classifications={classifications}
              prevailingWageRates={prevailingWageRates}
              pwRatesLoading={pwRatesLoading}
              projects={projects}
              canEdit={canEdit}
              confirmDelete={confirmDelete}
            />
          </TabsContent>

          <TabsContent value="salary-categories">
            <SalaryCategoriesContent
              salaryCategories={salaryCategories}
              salCatLoading={salCatLoading}
              canEdit={canEdit}
              confirmDelete={confirmDelete}
            />
          </TabsContent>

          <TabsContent value="burden-rates">
            <BurdenRatesContent
              burdenRatesList={burdenRatesList}
              burdenLoading={burdenLoading}
              canEdit={canEdit}
              confirmDelete={confirmDelete}
            />
          </TabsContent>

          <TabsContent value="cost-assignments">
            <CostAssignmentsContent
              users={users}
              salaryCategories={salaryCategories}
              burdenRatesList={burdenRatesList}
              costAssignments={costAssignments}
              costAssignLoading={costAssignLoading}
              canEdit={canEdit}
              confirmDelete={confirmDelete}
            />
          </TabsContent>
        </Tabs>

        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent data-testid="dialog-delete-confirm">
            <DialogHeader>
              <DialogTitle>Confirm Delete</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteTarget?.name}"? This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={
                  deleteClassificationMutation.isPending ||
                  deleteEmployeeClassMutation.isPending ||
                  deletePWRateMutation.isPending ||
                  deleteSalaryCatMutation.isPending ||
                  deleteBurdenRateMutation.isPending ||
                  deleteCostAssignMutation.isPending
                }
                data-testid="button-confirm-delete"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
