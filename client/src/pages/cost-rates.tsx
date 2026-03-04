import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Plus, Users, Briefcase, DollarSign, AlertCircle, Building2, Calculator, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";

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
  user: { id: string; firstName: string; lastName: string; email: string } | null;
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
  
  const [showEditRateDialog, setShowEditRateDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editRegularRate, setEditRegularRate] = useState("");
  const [editOvertimeRate, setEditOvertimeRate] = useState("");

  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [editingClassification, setEditingClassification] = useState<JobClassification | null>(null);
  const [classificationName, setClassificationName] = useState("");
  const [classificationCode, setClassificationCode] = useState("");
  const [classificationDescription, setClassificationDescription] = useState("");
  const [classificationDefaultRegRate, setClassificationDefaultRegRate] = useState("");
  const [classificationDefaultOTRate, setClassificationDefaultOTRate] = useState("");
  const [classificationIsActive, setClassificationIsActive] = useState(true);

  const [showEmployeeClassDialog, setShowEmployeeClassDialog] = useState(false);
  const [editingEmployeeClass, setEditingEmployeeClass] = useState<EmployeeClassification | null>(null);
  const [empClassUserId, setEmpClassUserId] = useState("");
  const [empClassClassificationId, setEmpClassClassificationId] = useState("");
  const [empClassRegularRate, setEmpClassRegularRate] = useState("");
  const [empClassOvertimeRate, setEmpClassOvertimeRate] = useState("");
  const [empClassIsPrimary, setEmpClassIsPrimary] = useState(false);
  const [empClassEffectiveDate, setEmpClassEffectiveDate] = useState("");
  const [empClassEndDate, setEmpClassEndDate] = useState("");
  const [empClassNotes, setEmpClassNotes] = useState("");

  const [showPWRateDialog, setShowPWRateDialog] = useState(false);
  const [editingPWRate, setEditingPWRate] = useState<PrevailingWageRate | null>(null);
  const [pwProjectId, setPwProjectId] = useState("");
  const [pwClassificationId, setPwClassificationId] = useState("");
  const [pwWageRate, setPwWageRate] = useState("");
  const [pwFringeRate, setPwFringeRate] = useState("");
  const [pwOvertimeMultiplier, setPwOvertimeMultiplier] = useState("1.5");
  const [pwEffectiveDate, setPwEffectiveDate] = useState("");
  const [pwExpirationDate, setPwExpirationDate] = useState("");
  const [pwWageDecision, setPwWageDecision] = useState("");
  const [pwNotes, setPwNotes] = useState("");

  const [showSalaryCatDialog, setShowSalaryCatDialog] = useState(false);
  const [editingSalaryCat, setEditingSalaryCat] = useState<AnnualSalaryCategory | null>(null);
  const [salCatName, setSalCatName] = useState("");
  const [salCatBaseSalary, setSalCatBaseSalary] = useState("");
  const [salCatType, setSalCatType] = useState("");
  const [salCatEffDate, setSalCatEffDate] = useState("");
  const [salCatDescription, setSalCatDescription] = useState("");
  const [salCatIsActive, setSalCatIsActive] = useState(true);

  const [showBurdenDialog, setShowBurdenDialog] = useState(false);
  const [editingBurden, setEditingBurden] = useState<BurdenRateConfig | null>(null);
  const [burdenName, setBurdenName] = useState("");
  const [burdenTaxes, setBurdenTaxes] = useState("");
  const [burdenBenefits, setBurdenBenefits] = useState("");
  const [burdenInsurance, setBurdenInsurance] = useState("");
  const [burdenOverhead, setBurdenOverhead] = useState("");
  const [burdenFixed, setBurdenFixed] = useState("");
  const [burdenDescription, setBurdenDescription] = useState("");
  const [burdenIsActive, setBurdenIsActive] = useState(true);

  const [showCostAssignDialog, setShowCostAssignDialog] = useState(false);
  const [editingCostAssign, setEditingCostAssign] = useState<EmployeeCostAssignment | null>(null);
  const [costAssignUserId, setCostAssignUserId] = useState("");
  const [costAssignSalaryCatId, setCostAssignSalaryCatId] = useState("");
  const [costAssignBurdenId, setCostAssignBurdenId] = useState("");
  const [costAssignHours, setCostAssignHours] = useState("2080");
  const [costAssignEffDate, setCostAssignEffDate] = useState("");
  const [costAssignEndDate, setCostAssignEndDate] = useState("");
  const [costAssignNotes, setCostAssignNotes] = useState("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: classifications = [], isLoading: classificationsLoading } = useQuery<JobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
  });

  const { data: employeeClassifications = [], isLoading: empClassLoading } = useQuery<EmployeeClassification[]>({
    queryKey: ["/api/labor-rates/employee-classifications"],
  });

  const { data: prevailingWageRates = [], isLoading: pwRatesLoading } = useQuery<PrevailingWageRate[]>({
    queryKey: ["/api/labor-rates/prevailing-wage-rates"],
  });

  const { data: projectsResponse } = useQuery<{ data: Project[], pagination?: any }>({
    queryKey: ["/api/projects"],
  });
  const projects = projectsResponse?.data || [];

  const { data: salaryCategories = [], isLoading: salCatLoading } = useQuery<AnnualSalaryCategory[]>({
    queryKey: ["/api/labor-rates/salary-categories"],
  });

  const { data: burdenRatesList = [], isLoading: burdenLoading } = useQuery<BurdenRateConfig[]>({
    queryKey: ["/api/labor-rates/burden-rates"],
  });

  const { data: costAssignments = [], isLoading: costAssignLoading } = useQuery<EmployeeCostAssignment[]>({
    queryKey: ["/api/labor-rates/cost-assignments"],
  });

  const updateRatesMutation = useMutation({
    mutationFn: async (data: { userId: string; costRateRegular: string; costRateOvertime: string }) => {
      return await apiRequest("PATCH", `/api/users/${data.userId}/cost-rates`, {
        costRateRegular: data.costRateRegular,
        costRateOvertime: data.costRateOvertime,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Base rates updated" });
      setShowEditRateDialog(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update rates", variant: "destructive" });
    },
  });

  const classificationMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingClassification) {
        return await apiRequest("PATCH", `/api/labor-rates/classifications/${editingClassification.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/classifications", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      toast({ title: "Success", description: editingClassification ? "Classification updated" : "Classification created" });
      resetClassificationDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save classification", variant: "destructive" });
    },
  });

  const deleteClassificationMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/classifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      toast({ title: "Success", description: "Classification deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete classification", variant: "destructive" });
    },
  });

  const employeeClassMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingEmployeeClass) {
        return await apiRequest("PATCH", `/api/labor-rates/employee-classifications/${editingEmployeeClass.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/employee-classifications", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/employee-classifications"] });
      toast({ title: "Success", description: editingEmployeeClass ? "Assignment updated" : "Assignment created" });
      resetEmployeeClassDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save assignment", variant: "destructive" });
    },
  });

  const deleteEmployeeClassMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/employee-classifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/employee-classifications"] });
      toast({ title: "Success", description: "Assignment deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete assignment", variant: "destructive" });
    },
  });

  const pwRateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingPWRate) {
        return await apiRequest("PATCH", `/api/labor-rates/prevailing-wage-rates/${editingPWRate.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/prevailing-wage-rates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      toast({ title: "Success", description: editingPWRate ? "Rate updated" : "Rate created" });
      resetPWRateDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save rate", variant: "destructive" });
    },
  });

  const deletePWRateMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/prevailing-wage-rates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      toast({ title: "Success", description: "Rate deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete rate", variant: "destructive" });
    },
  });

  const salaryCatMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingSalaryCat) {
        return await apiRequest("PATCH", `/api/labor-rates/salary-categories/${editingSalaryCat.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/salary-categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/salary-categories"] });
      toast({ title: "Success", description: editingSalaryCat ? "Salary category updated" : "Salary category created" });
      resetSalaryCatDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save salary category", variant: "destructive" });
    },
  });

  const deleteSalaryCatMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/salary-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/salary-categories"] });
      toast({ title: "Success", description: "Salary category deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete salary category", variant: "destructive" });
    },
  });

  const burdenRateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingBurden) {
        return await apiRequest("PATCH", `/api/labor-rates/burden-rates/${editingBurden.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/burden-rates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/burden-rates"] });
      toast({ title: "Success", description: editingBurden ? "Burden rate updated" : "Burden rate created" });
      resetBurdenDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save burden rate", variant: "destructive" });
    },
  });

  const deleteBurdenRateMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/burden-rates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/burden-rates"] });
      toast({ title: "Success", description: "Burden rate deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete burden rate", variant: "destructive" });
    },
  });

  const costAssignMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingCostAssign) {
        return await apiRequest("PATCH", `/api/labor-rates/cost-assignments/${editingCostAssign.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/cost-assignments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/cost-assignments"] });
      toast({ title: "Success", description: editingCostAssign ? "Cost assignment updated" : "Cost assignment created" });
      resetCostAssignDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save cost assignment", variant: "destructive" });
    },
  });

  const deleteCostAssignMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/cost-assignments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/cost-assignments"] });
      toast({ title: "Success", description: "Cost assignment deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete cost assignment", variant: "destructive" });
    },
  });

  const recalculateAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/labor-rates/cost-assignments/recalculate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/cost-assignments"] });
      toast({ title: "Success", description: "All cost assignments recalculated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to recalculate cost assignments", variant: "destructive" });
    },
  });

  const handleEditRate = (user: User) => {
    setSelectedUser(user);
    setEditRegularRate(user.costRateRegular || "50");
    setEditOvertimeRate(user.costRateOvertime || "75");
    setShowEditRateDialog(true);
  };

  const handleSaveRate = () => {
    if (!selectedUser) return;
    const regularRate = parseFloat(editRegularRate);
    const overtimeRate = parseFloat(editOvertimeRate);
    if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
      toast({ title: "Invalid Input", description: "Rates must be valid non-negative numbers", variant: "destructive" });
      return;
    }
    updateRatesMutation.mutate({
      userId: selectedUser.id,
      costRateRegular: regularRate.toFixed(2),
      costRateOvertime: overtimeRate.toFixed(2),
    });
  };

  const resetClassificationDialog = () => {
    setShowClassificationDialog(false);
    setEditingClassification(null);
    setClassificationName("");
    setClassificationCode("");
    setClassificationDescription("");
    setClassificationDefaultRegRate("");
    setClassificationDefaultOTRate("");
    setClassificationIsActive(true);
  };

  const openClassificationDialog = (classification?: JobClassification) => {
    if (classification) {
      setEditingClassification(classification);
      setClassificationName(classification.name);
      setClassificationCode(classification.code || "");
      setClassificationDescription(classification.description || "");
      setClassificationDefaultRegRate(classification.defaultRegularRate || "");
      setClassificationDefaultOTRate(classification.defaultOvertimeRate || "");
      setClassificationIsActive(classification.isActive);
    } else {
      resetClassificationDialog();
    }
    setShowClassificationDialog(true);
  };

  const handleSaveClassification = () => {
    if (!classificationName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    classificationMutation.mutate({
      name: classificationName.trim(),
      code: classificationCode.trim() || null,
      description: classificationDescription.trim() || null,
      defaultRegularRate: classificationDefaultRegRate || null,
      defaultOvertimeRate: classificationDefaultOTRate || null,
      isActive: classificationIsActive,
    });
  };

  const resetEmployeeClassDialog = () => {
    setShowEmployeeClassDialog(false);
    setEditingEmployeeClass(null);
    setEmpClassUserId("");
    setEmpClassClassificationId("");
    setEmpClassRegularRate("");
    setEmpClassOvertimeRate("");
    setEmpClassIsPrimary(false);
    setEmpClassEffectiveDate("");
    setEmpClassEndDate("");
    setEmpClassNotes("");
  };

  const openEmployeeClassDialog = (assignment?: EmployeeClassification) => {
    if (assignment) {
      setEditingEmployeeClass(assignment);
      setEmpClassUserId(assignment.userId);
      setEmpClassClassificationId(assignment.classificationId);
      setEmpClassRegularRate(assignment.regularRate);
      setEmpClassOvertimeRate(assignment.overtimeRate);
      setEmpClassIsPrimary(assignment.isPrimary);
      setEmpClassEffectiveDate(assignment.effectiveDate);
      setEmpClassEndDate(assignment.endDate || "");
      setEmpClassNotes(assignment.notes || "");
    } else {
      resetEmployeeClassDialog();
      setEmpClassEffectiveDate(new Date().toISOString().split('T')[0]);
    }
    setShowEmployeeClassDialog(true);
  };

  const handleSaveEmployeeClass = () => {
    if (!empClassUserId || !empClassClassificationId || !empClassRegularRate || !empClassOvertimeRate || !empClassEffectiveDate) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    employeeClassMutation.mutate({
      userId: empClassUserId,
      classificationId: empClassClassificationId,
      regularRate: empClassRegularRate,
      overtimeRate: empClassOvertimeRate,
      isPrimary: empClassIsPrimary,
      effectiveDate: empClassEffectiveDate,
      endDate: empClassEndDate || null,
      notes: empClassNotes.trim() || null,
    });
  };

  const resetPWRateDialog = () => {
    setShowPWRateDialog(false);
    setEditingPWRate(null);
    setPwProjectId("");
    setPwClassificationId("");
    setPwWageRate("");
    setPwFringeRate("");
    setPwOvertimeMultiplier("1.5");
    setPwEffectiveDate("");
    setPwExpirationDate("");
    setPwWageDecision("");
    setPwNotes("");
  };

  const openPWRateDialog = (rate?: PrevailingWageRate) => {
    if (rate) {
      setEditingPWRate(rate);
      setPwProjectId(rate.projectId);
      setPwClassificationId(rate.classificationId);
      setPwWageRate(rate.wageRate);
      setPwFringeRate(rate.fringeRate);
      setPwOvertimeMultiplier(rate.overtimeMultiplier);
      setPwEffectiveDate(rate.effectiveDate);
      setPwExpirationDate(rate.expirationDate || "");
      setPwWageDecision(rate.wageDecision || "");
      setPwNotes(rate.notes || "");
    } else {
      resetPWRateDialog();
      setPwEffectiveDate(new Date().toISOString().split('T')[0]);
    }
    setShowPWRateDialog(true);
  };

  const handleSavePWRate = () => {
    if (!pwProjectId || !pwClassificationId || !pwWageRate || !pwEffectiveDate) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    pwRateMutation.mutate({
      projectId: pwProjectId,
      classificationId: pwClassificationId,
      wageRate: pwWageRate,
      fringeRate: pwFringeRate || "0",
      overtimeMultiplier: pwOvertimeMultiplier || "1.5",
      effectiveDate: pwEffectiveDate,
      expirationDate: pwExpirationDate || null,
      wageDecision: pwWageDecision.trim() || null,
      notes: pwNotes.trim() || null,
    });
  };

  const resetSalaryCatDialog = () => {
    setShowSalaryCatDialog(false);
    setEditingSalaryCat(null);
    setSalCatName("");
    setSalCatBaseSalary("");
    setSalCatType("");
    setSalCatEffDate("");
    setSalCatDescription("");
    setSalCatIsActive(true);
  };

  const openSalaryCatDialog = (cat?: AnnualSalaryCategory) => {
    if (cat) {
      setEditingSalaryCat(cat);
      setSalCatName(cat.name);
      setSalCatBaseSalary(cat.baseAnnualSalary);
      setSalCatType(cat.salaryType || "");
      setSalCatEffDate(cat.effectiveDate);
      setSalCatDescription(cat.description || "");
      setSalCatIsActive(cat.isActive);
    } else {
      resetSalaryCatDialog();
      setSalCatEffDate(new Date().toISOString().split('T')[0]);
    }
    setShowSalaryCatDialog(true);
  };

  const handleSaveSalaryCat = () => {
    if (!salCatName.trim() || !salCatBaseSalary) {
      toast({ title: "Error", description: "Name and Base Salary are required", variant: "destructive" });
      return;
    }
    salaryCatMutation.mutate({
      name: salCatName.trim(),
      baseAnnualSalary: salCatBaseSalary,
      salaryType: salCatType || null,
      effectiveDate: salCatEffDate || new Date().toISOString().split('T')[0],
      description: salCatDescription.trim() || null,
      isActive: salCatIsActive,
    });
  };

  const resetBurdenDialog = () => {
    setShowBurdenDialog(false);
    setEditingBurden(null);
    setBurdenName("");
    setBurdenTaxes("");
    setBurdenBenefits("");
    setBurdenInsurance("");
    setBurdenOverhead("");
    setBurdenFixed("");
    setBurdenDescription("");
    setBurdenIsActive(true);
  };

  const openBurdenDialog = (burden?: BurdenRateConfig) => {
    if (burden) {
      setEditingBurden(burden);
      setBurdenName(burden.name);
      setBurdenTaxes(burden.taxesPercent || "");
      setBurdenBenefits(burden.benefitsPercent || "");
      setBurdenInsurance(burden.insurancePercent || "");
      setBurdenOverhead(burden.overheadPercent || "");
      setBurdenFixed(burden.fixedBurdenAmount || "");
      setBurdenDescription(burden.description || "");
      setBurdenIsActive(burden.isActive);
    } else {
      resetBurdenDialog();
    }
    setShowBurdenDialog(true);
  };

  const computedBurdenPercent = () => {
    const t = parseFloat(burdenTaxes) || 0;
    const b = parseFloat(burdenBenefits) || 0;
    const i = parseFloat(burdenInsurance) || 0;
    const o = parseFloat(burdenOverhead) || 0;
    return (t + b + i + o).toFixed(2);
  };

  const handleSaveBurden = () => {
    if (!burdenName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    burdenRateMutation.mutate({
      name: burdenName.trim(),
      burdenPercentage: computedBurdenPercent(),
      taxesPercent: burdenTaxes || null,
      benefitsPercent: burdenBenefits || null,
      insurancePercent: burdenInsurance || null,
      overheadPercent: burdenOverhead || null,
      fixedBurdenAmount: burdenFixed || null,
      description: burdenDescription.trim() || null,
      isActive: burdenIsActive,
    });
  };

  const resetCostAssignDialog = () => {
    setShowCostAssignDialog(false);
    setEditingCostAssign(null);
    setCostAssignUserId("");
    setCostAssignSalaryCatId("");
    setCostAssignBurdenId("");
    setCostAssignHours("2080");
    setCostAssignEffDate("");
    setCostAssignEndDate("");
    setCostAssignNotes("");
  };

  const openCostAssignDialog = (assign?: EmployeeCostAssignment) => {
    if (assign) {
      setEditingCostAssign(assign);
      setCostAssignUserId(assign.userId);
      setCostAssignSalaryCatId(assign.salaryCategoryId);
      setCostAssignBurdenId(assign.burdenRateId || "");
      setCostAssignHours(String(assign.workingHoursPerYear));
      setCostAssignEffDate(assign.effectiveDate);
      setCostAssignEndDate(assign.endDate || "");
      setCostAssignNotes(assign.notes || "");
    } else {
      resetCostAssignDialog();
      setCostAssignEffDate(new Date().toISOString().split('T')[0]);
    }
    setShowCostAssignDialog(true);
  };

  const handleSaveCostAssign = () => {
    if (!costAssignUserId || !costAssignSalaryCatId || !costAssignEffDate) {
      toast({ title: "Error", description: "Employee, Salary Category, and Effective Date are required", variant: "destructive" });
      return;
    }
    costAssignMutation.mutate({
      userId: costAssignUserId,
      salaryCategoryId: costAssignSalaryCatId,
      burdenRateId: costAssignBurdenId && costAssignBurdenId !== "none" ? costAssignBurdenId : null,
      workingHoursPerYear: parseInt(costAssignHours) || 2080,
      effectiveDate: costAssignEffDate,
      endDate: costAssignEndDate || null,
      notes: costAssignNotes.trim() || null,
    });
  };

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
    { value: "employee-classifications", label: "Employee Assignments", icon: Users },
    { value: "prevailing-wage", label: "Prevailing Wage", icon: Building2 },
    { value: "salary-categories", label: "Salary Categories", icon: DollarSign },
    { value: "burden-rates", label: "Burden Rates", icon: Calculator },
    { value: "cost-assignments", label: "Cost Assignments", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">Labor Cost Rate Management</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Manage employee base rates, job classifications, and prevailing wage rates for projects
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="md:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger data-testid="select-tab-mobile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tabOptions.map((tab) => (
                  <SelectItem key={tab.value} value={tab.value} data-testid={`tab-mobile-${tab.value}`}>
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
              <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-2" data-testid={`tab-${tab.value}`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="employee-rates">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Base Employee Rates
                </CardTitle>
                <CardDescription>
                  Default hourly rates for each employee. These are used when no classification or project-specific rate applies.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="text-right">Regular Rate ($/hr)</TableHead>
                            <TableHead className="text-right">Overtime Rate ($/hr)</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {users.map((u) => (
                            <TableRow key={u.id} data-testid={`row-employee-${u.id}`}>
                              <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                              <TableCell>{u.email}</TableCell>
                              <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                              <TableCell className="text-right font-mono">
                                {u.costRateRegular ? `$${parseFloat(u.costRateRegular).toFixed(2)}` : <span className="text-muted-foreground">Not set</span>}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {u.costRateOvertime ? `$${parseFloat(u.costRateOvertime).toFixed(2)}` : <span className="text-muted-foreground">Not set</span>}
                              </TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <Button size="sm" variant="outline" onClick={() => handleEditRate(u)} data-testid={`button-edit-rate-${u.id}`}>
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {users.map((u) => (
                        <div key={u.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-employee-${u.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{u.firstName} {u.lastName}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">{u.role}</Badge>
                              {canEdit && (
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => handleEditRate(u)} data-testid={`button-edit-rate-m-${u.id}`}>
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Regular</span>
                              <p className="font-mono font-medium">{u.costRateRegular ? `$${parseFloat(u.costRateRegular).toFixed(2)}/hr` : "Not set"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Overtime</span>
                              <p className="font-mono font-medium">{u.costRateOvertime ? `$${parseFloat(u.costRateOvertime).toFixed(2)}/hr` : "Not set"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="classifications">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="w-5 h-5" />
                    Job Classifications
                  </CardTitle>
                  <CardDescription>
                    Define labor classifications with default rates. Assign employees to classifications for standardized rate management.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openClassificationDialog()} data-testid="button-add-classification" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Classification
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {classificationsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : classifications.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No job classifications defined yet.</p>
                    <p className="text-sm mt-1">Create classifications to standardize labor rates across your organization.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Default Regular</TableHead>
                            <TableHead className="text-right">Default OT</TableHead>
                            <TableHead>Status</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classifications.map((c) => (
                            <TableRow key={c.id} data-testid={`row-classification-${c.id}`}>
                              <TableCell className="font-medium">{c.name}</TableCell>
                              <TableCell className="font-mono text-sm">{c.code || "-"}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{c.description || "-"}</TableCell>
                              <TableCell className="text-right font-mono">
                                {c.defaultRegularRate ? `$${parseFloat(c.defaultRegularRate).toFixed(2)}` : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {c.defaultOvertimeRate ? `$${parseFloat(c.defaultOvertimeRate).toFixed(2)}` : "-"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={c.isActive ? "default" : "secondary"}>
                                  {c.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openClassificationDialog(c)} data-testid={`button-edit-class-${c.id}`}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => confirmDelete("classification", c.id, c.name)} data-testid={`button-delete-class-${c.id}`}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {classifications.map((c) => (
                        <div key={c.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-classification-${c.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{c.name}</p>
                              {c.code && <p className="text-xs font-mono text-muted-foreground">{c.code}</p>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">
                                {c.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {canEdit && (
                                <>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openClassificationDialog(c)} data-testid={`button-edit-class-m-${c.id}`}>
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("classification", c.id, c.name)} data-testid={`button-delete-class-m-${c.id}`}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          {c.description && <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Regular</span>
                              <p className="font-mono font-medium">{c.defaultRegularRate ? `$${parseFloat(c.defaultRegularRate).toFixed(2)}/hr` : "-"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Overtime</span>
                              <p className="font-mono font-medium">{c.defaultOvertimeRate ? `$${parseFloat(c.defaultOvertimeRate).toFixed(2)}/hr` : "-"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="employee-classifications">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Employee Classification Assignments
                  </CardTitle>
                  <CardDescription>
                    Assign employees to job classifications with specific rates. Primary classification is used by default.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openEmployeeClassDialog()} data-testid="button-add-emp-class" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Assign Employee
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {empClassLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : employeeClassifications.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No employee assignments yet.</p>
                    <p className="text-sm mt-1">Assign employees to job classifications to track rates by trade.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead>Classification</TableHead>
                            <TableHead className="text-right">Regular Rate</TableHead>
                            <TableHead className="text-right">OT Rate</TableHead>
                            <TableHead>Primary</TableHead>
                            <TableHead>Effective Date</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employeeClassifications.map((ec) => (
                            <TableRow key={ec.id} data-testid={`row-emp-class-${ec.id}`}>
                              <TableCell className="font-medium">
                                {ec.user ? `${ec.user.firstName} ${ec.user.lastName}` : "Unknown"}
                              </TableCell>
                              <TableCell>{ec.classification?.name || "Unknown"}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(ec.regularRate).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(ec.overtimeRate).toFixed(2)}</TableCell>
                              <TableCell>
                                {ec.isPrimary && <Badge>Primary</Badge>}
                              </TableCell>
                              <TableCell>{ec.effectiveDate}</TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openEmployeeClassDialog(ec)} data-testid={`button-edit-emp-class-${ec.id}`}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => confirmDelete("employee-class", ec.id, `${ec.user?.firstName || ""} ${ec.user?.lastName || ""} - ${ec.classification?.name || ""}`)} data-testid={`button-delete-emp-class-${ec.id}`}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {employeeClassifications.map((ec) => (
                        <div key={ec.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-emp-class-${ec.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{ec.user ? `${ec.user.firstName} ${ec.user.lastName}` : "Unknown"}</p>
                              <p className="text-xs text-muted-foreground">{ec.classification?.name || "Unknown"}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {ec.isPrimary && <Badge className="text-xs">Primary</Badge>}
                              {canEdit && (
                                <>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openEmployeeClassDialog(ec)} data-testid={`button-edit-emp-class-m-${ec.id}`}>
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("employee-class", ec.id, `${ec.user?.firstName || ""} ${ec.user?.lastName || ""} - ${ec.classification?.name || ""}`)} data-testid={`button-delete-emp-class-m-${ec.id}`}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Regular</span>
                              <p className="font-mono font-medium">${parseFloat(ec.regularRate).toFixed(2)}/hr</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Overtime</span>
                              <p className="font-mono font-medium">${parseFloat(ec.overtimeRate).toFixed(2)}/hr</p>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">Effective: {ec.effectiveDate}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prevailing-wage">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    Project Prevailing Wage Rates
                  </CardTitle>
                  <CardDescription>
                    Define prevailing wage rates for specific projects. These override employee base rates and classification rates.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openPWRateDialog()} data-testid="button-add-pw-rate" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Add PW Rate
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {pwRatesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : prevailingWageRates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No prevailing wage rates defined yet.</p>
                    <p className="text-sm mt-1">Add rates for public works or government projects that require prevailing wages.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Project</TableHead>
                            <TableHead>Classification</TableHead>
                            <TableHead className="text-right">Wage Rate</TableHead>
                            <TableHead className="text-right">Fringe</TableHead>
                            <TableHead className="text-right">Total Rate</TableHead>
                            <TableHead className="text-right">OT Mult</TableHead>
                            <TableHead>Effective</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {prevailingWageRates.map((pw) => (
                            <TableRow key={pw.id} data-testid={`row-pw-rate-${pw.id}`}>
                              <TableCell className="font-medium">{pw.project?.name || "Unknown"}</TableCell>
                              <TableCell>{pw.classification?.name || "Unknown"}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(pw.wageRate).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(pw.fringeRate).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono font-semibold">${parseFloat(pw.totalRate).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono">{pw.overtimeMultiplier}x</TableCell>
                              <TableCell>{pw.effectiveDate}</TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openPWRateDialog(pw)} data-testid={`button-edit-pw-${pw.id}`}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => confirmDelete("pw-rate", pw.id, `${pw.project?.name || ""} - ${pw.classification?.name || ""}`)} data-testid={`button-delete-pw-${pw.id}`}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {prevailingWageRates.map((pw) => (
                        <div key={pw.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-pw-rate-${pw.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{pw.project?.name || "Unknown"}</p>
                              <p className="text-xs text-muted-foreground">{pw.classification?.name || "Unknown"}</p>
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openPWRateDialog(pw)} data-testid={`button-edit-pw-m-${pw.id}`}>
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("pw-rate", pw.id, `${pw.project?.name || ""} - ${pw.classification?.name || ""}`)} data-testid={`button-delete-pw-m-${pw.id}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Wage</span>
                              <p className="font-mono font-medium">${parseFloat(pw.wageRate).toFixed(2)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Fringe</span>
                              <p className="font-mono font-medium">${parseFloat(pw.fringeRate).toFixed(2)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Total</span>
                              <p className="font-mono font-semibold">${parseFloat(pw.totalRate).toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>OT: {pw.overtimeMultiplier}x</span>
                            <span>Effective: {pw.effectiveDate}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="salary-categories">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Annual Salary Categories
                  </CardTitle>
                  <CardDescription>
                    Define salary categories with base annual salaries for cost rate calculations.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openSalaryCatDialog()} data-testid="button-add-salary-cat" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Category
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {salCatLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : salaryCategories.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No salary categories defined yet.</p>
                    <p className="text-sm mt-1">Create salary categories to standardize annual compensation levels.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Base Salary</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Effective Date</TableHead>
                            <TableHead>Status</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {salaryCategories.map((sc) => (
                            <TableRow key={sc.id} data-testid={`row-salary-cat-${sc.id}`}>
                              <TableCell className="font-medium">{sc.name}</TableCell>
                              <TableCell className="text-right font-mono">
                                ${parseFloat(sc.baseAnnualSalary).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                {sc.salaryType ? <Badge variant="secondary">{sc.salaryType}</Badge> : "-"}
                              </TableCell>
                              <TableCell>{sc.effectiveDate}</TableCell>
                              <TableCell>
                                <Badge variant={sc.isActive ? "default" : "secondary"}>
                                  {sc.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openSalaryCatDialog(sc)} data-testid={`button-edit-salary-cat-${sc.id}`}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => confirmDelete("salary-cat", sc.id, sc.name)} data-testid={`button-delete-salary-cat-${sc.id}`}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {salaryCategories.map((sc) => (
                        <div key={sc.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-salary-cat-${sc.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{sc.name}</p>
                              <p className="text-lg font-mono font-semibold">${parseFloat(sc.baseAnnualSalary).toLocaleString()}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={sc.isActive ? "default" : "secondary"} className="text-xs">
                                {sc.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {canEdit && (
                                <>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openSalaryCatDialog(sc)} data-testid={`button-edit-salary-cat-m-${sc.id}`}>
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("salary-cat", sc.id, sc.name)} data-testid={`button-delete-salary-cat-m-${sc.id}`}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{sc.salaryType || "No type"}</span>
                            <span>Effective: {sc.effectiveDate}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="burden-rates">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="w-5 h-5" />
                    Burden Rate Configurations
                  </CardTitle>
                  <CardDescription>
                    Define burden rate profiles with component breakdowns for taxes, benefits, insurance, and overhead.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openBurdenDialog()} data-testid="button-add-burden-rate" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Burden Rate
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {burdenLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : burdenRatesList.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No burden rates defined yet.</p>
                    <p className="text-sm mt-1">Create burden rate profiles to calculate fully burdened employee costs.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Total Burden %</TableHead>
                            <TableHead>Component Breakdown</TableHead>
                            <TableHead className="text-right">Fixed Amount</TableHead>
                            <TableHead>Status</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {burdenRatesList.map((br) => (
                            <TableRow key={br.id} data-testid={`row-burden-rate-${br.id}`}>
                              <TableCell className="font-medium">{br.name}</TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                {parseFloat(br.burdenPercentage).toFixed(2)}%
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {br.taxesPercent && <Badge variant="secondary">Taxes: {br.taxesPercent}%</Badge>}
                                  {br.benefitsPercent && <Badge variant="secondary">Benefits: {br.benefitsPercent}%</Badge>}
                                  {br.insurancePercent && <Badge variant="secondary">Insurance: {br.insurancePercent}%</Badge>}
                                  {br.overheadPercent && <Badge variant="secondary">Overhead: {br.overheadPercent}%</Badge>}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {br.fixedBurdenAmount ? `$${parseFloat(br.fixedBurdenAmount).toLocaleString()}` : "-"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={br.isActive ? "default" : "secondary"}>
                                  {br.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openBurdenDialog(br)} data-testid={`button-edit-burden-${br.id}`}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => confirmDelete("burden-rate", br.id, br.name)} data-testid={`button-delete-burden-${br.id}`}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {burdenRatesList.map((br) => (
                        <div key={br.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-burden-rate-${br.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{br.name}</p>
                              <p className="text-lg font-mono font-semibold">{parseFloat(br.burdenPercentage).toFixed(2)}%</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={br.isActive ? "default" : "secondary"} className="text-xs">
                                {br.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {canEdit && (
                                <>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openBurdenDialog(br)} data-testid={`button-edit-burden-m-${br.id}`}>
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("burden-rate", br.id, br.name)} data-testid={`button-delete-burden-m-${br.id}`}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {br.taxesPercent && <Badge variant="secondary" className="text-xs">Taxes: {br.taxesPercent}%</Badge>}
                            {br.benefitsPercent && <Badge variant="secondary" className="text-xs">Benefits: {br.benefitsPercent}%</Badge>}
                            {br.insurancePercent && <Badge variant="secondary" className="text-xs">Insurance: {br.insurancePercent}%</Badge>}
                            {br.overheadPercent && <Badge variant="secondary" className="text-xs">Overhead: {br.overheadPercent}%</Badge>}
                          </div>
                          {br.fixedBurdenAmount && (
                            <p className="text-xs text-muted-foreground">Fixed: ${parseFloat(br.fixedBurdenAmount).toLocaleString()}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cost-assignments">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Employee Cost Assignments
                  </CardTitle>
                  <CardDescription>
                    Assign employees to salary categories and burden rates to calculate fully burdened costs and derived hourly rates.
                  </CardDescription>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  {canEdit && (
                    <>
                      <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => recalculateAllMutation.mutate()} disabled={recalculateAllMutation.isPending} data-testid="button-recalculate-all">
                        <RefreshCw className={`w-4 h-4 mr-2 ${recalculateAllMutation.isPending ? "animate-spin" : ""}`} />
                        Recalculate
                      </Button>
                      <Button className="flex-1 sm:flex-none" onClick={() => openCostAssignDialog()} data-testid="button-add-cost-assign">
                        <Plus className="w-4 h-4 mr-2" />
                        Add
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {costAssignLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : costAssignments.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No cost assignments defined yet.</p>
                    <p className="text-sm mt-1">Create assignments to link employees with salary categories and burden rates.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead>Salary Category</TableHead>
                            <TableHead>Burden Rate</TableHead>
                            <TableHead className="text-right">Base Salary</TableHead>
                            <TableHead className="text-right">Burden %</TableHead>
                            <TableHead className="text-right">Fully Burdened Cost</TableHead>
                            <TableHead className="text-right">Hourly Rate</TableHead>
                            <TableHead>Effective Date</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {costAssignments.map((ca) => (
                            <TableRow key={ca.id} data-testid={`row-cost-assign-${ca.id}`}>
                              <TableCell className="font-medium">
                                {ca.userName ? `${ca.userName} ${ca.userLastName || ""}`.trim() : "Unknown"}
                              </TableCell>
                              <TableCell>{ca.salaryName || "Unknown"}</TableCell>
                              <TableCell>{ca.burdenName || "-"}</TableCell>
                              <TableCell className="text-right font-mono">
                                {ca.baseAnnualSalary ? `$${parseFloat(ca.baseAnnualSalary).toLocaleString()}` : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {ca.burdenPercentage ? `${parseFloat(ca.burdenPercentage).toFixed(2)}%` : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                {ca.fullyBurdenedCost ? `$${parseFloat(ca.fullyBurdenedCost).toLocaleString()}` : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {ca.derivedHourlyRate ? `$${parseFloat(ca.derivedHourlyRate).toLocaleString()}` : "-"}
                              </TableCell>
                              <TableCell>{ca.effectiveDate}</TableCell>
                              {canEdit && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openCostAssignDialog(ca)} data-testid={`button-edit-cost-assign-${ca.id}`}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => confirmDelete("cost-assign", ca.id, `${ca.userName || ""} ${ca.userLastName || ""}`.trim())} data-testid={`button-delete-cost-assign-${ca.id}`}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {costAssignments.map((ca) => (
                        <div key={ca.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-cost-assign-${ca.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm">{ca.userName ? `${ca.userName} ${ca.userLastName || ""}`.trim() : "Unknown"}</p>
                              <p className="text-xs text-muted-foreground">{ca.salaryName || "Unknown"}</p>
                              {ca.burdenName && <p className="text-xs text-muted-foreground">{ca.burdenName}</p>}
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openCostAssignDialog(ca)} data-testid={`button-edit-cost-assign-m-${ca.id}`}>
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("cost-assign", ca.id, `${ca.userName || ""} ${ca.userLastName || ""}`.trim())} data-testid={`button-delete-cost-assign-m-${ca.id}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Base Salary</span>
                              <p className="font-mono font-medium">{ca.baseAnnualSalary ? `$${parseFloat(ca.baseAnnualSalary).toLocaleString()}` : "-"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Burden</span>
                              <p className="font-mono font-medium">{ca.burdenPercentage ? `${parseFloat(ca.burdenPercentage).toFixed(2)}%` : "-"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Burdened Cost</span>
                              <p className="font-mono font-semibold">{ca.fullyBurdenedCost ? `$${parseFloat(ca.fullyBurdenedCost).toLocaleString()}` : "-"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Hourly Rate</span>
                              <p className="font-mono font-semibold">{ca.derivedHourlyRate ? `$${parseFloat(ca.derivedHourlyRate).toLocaleString()}/hr` : "-"}</p>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">Effective: {ca.effectiveDate}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={showEditRateDialog} onOpenChange={setShowEditRateDialog}>
          <DialogContent data-testid="dialog-edit-base-rate">
            <DialogHeader>
              <DialogTitle>Edit Base Rates</DialogTitle>
              <DialogDescription>
                {selectedUser && `Update base cost rates for ${selectedUser.firstName} ${selectedUser.lastName}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="regular-rate">Regular Hourly Rate ($)</Label>
                <Input id="regular-rate" type="number" step="0.01" value={editRegularRate} onChange={(e) => setEditRegularRate(e.target.value)} data-testid="input-base-regular-rate" />
              </div>
              <div>
                <Label htmlFor="overtime-rate">Overtime Hourly Rate ($)</Label>
                <Input id="overtime-rate" type="number" step="0.01" value={editOvertimeRate} onChange={(e) => setEditOvertimeRate(e.target.value)} data-testid="input-base-overtime-rate" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditRateDialog(false)}>Cancel</Button>
              <Button onClick={handleSaveRate} disabled={updateRatesMutation.isPending} data-testid="button-save-base-rate">Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showClassificationDialog} onOpenChange={(open) => !open && resetClassificationDialog()}>
          <DialogContent data-testid="dialog-classification">
            <DialogHeader>
              <DialogTitle>{editingClassification ? "Edit Classification" : "Add Classification"}</DialogTitle>
              <DialogDescription>
                {editingClassification ? "Update job classification details" : "Create a new job classification for your organization"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="class-name">Name *</Label>
                  <Input id="class-name" value={classificationName} onChange={(e) => setClassificationName(e.target.value)} placeholder="e.g., Electrician" data-testid="input-class-name" />
                </div>
                <div>
                  <Label htmlFor="class-code">Code</Label>
                  <Input id="class-code" value={classificationCode} onChange={(e) => setClassificationCode(e.target.value)} placeholder="e.g., ELEC" data-testid="input-class-code" />
                </div>
              </div>
              <div>
                <Label htmlFor="class-description">Description</Label>
                <Textarea id="class-description" value={classificationDescription} onChange={(e) => setClassificationDescription(e.target.value)} placeholder="Optional description..." data-testid="input-class-description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="class-reg-rate">Default Regular Rate ($)</Label>
                  <Input id="class-reg-rate" type="number" step="0.01" value={classificationDefaultRegRate} onChange={(e) => setClassificationDefaultRegRate(e.target.value)} placeholder="50.00" data-testid="input-class-reg-rate" />
                </div>
                <div>
                  <Label htmlFor="class-ot-rate">Default OT Rate ($)</Label>
                  <Input id="class-ot-rate" type="number" step="0.01" value={classificationDefaultOTRate} onChange={(e) => setClassificationDefaultOTRate(e.target.value)} placeholder="75.00" data-testid="input-class-ot-rate" />
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="class-active" checked={classificationIsActive} onCheckedChange={(checked) => setClassificationIsActive(checked === true)} data-testid="checkbox-class-active" />
                <Label htmlFor="class-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetClassificationDialog}>Cancel</Button>
              <Button onClick={handleSaveClassification} disabled={classificationMutation.isPending} data-testid="button-save-classification">
                {editingClassification ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showEmployeeClassDialog} onOpenChange={(open) => !open && resetEmployeeClassDialog()}>
          <DialogContent data-testid="dialog-emp-class">
            <DialogHeader>
              <DialogTitle>{editingEmployeeClass ? "Edit Assignment" : "Assign Employee to Classification"}</DialogTitle>
              <DialogDescription>
                {editingEmployeeClass ? "Update employee classification assignment" : "Assign an employee to a job classification with specific rates"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Employee *</Label>
                  <Select value={empClassUserId} onValueChange={setEmpClassUserId} disabled={!!editingEmployeeClass}>
                    <SelectTrigger data-testid="select-emp-class-user">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} - {u.role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classification *</Label>
                  <Select value={empClassClassificationId} onValueChange={(val) => {
                    setEmpClassClassificationId(val);
                    const cls = classifications.find(c => c.id === val);
                    if (cls && !editingEmployeeClass) {
                      setEmpClassRegularRate(cls.defaultRegularRate || "");
                      setEmpClassOvertimeRate(cls.defaultOvertimeRate || "");
                    }
                  }} disabled={!!editingEmployeeClass}>
                    <SelectTrigger data-testid="select-emp-class-classification">
                      <SelectValue placeholder="Select classification" />
                    </SelectTrigger>
                    <SelectContent>
                      {classifications.filter(c => c.isActive).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="emp-reg-rate">Regular Rate ($/hr) *</Label>
                  <Input id="emp-reg-rate" type="number" step="0.01" value={empClassRegularRate} onChange={(e) => setEmpClassRegularRate(e.target.value)} data-testid="input-emp-class-reg-rate" />
                </div>
                <div>
                  <Label htmlFor="emp-ot-rate">Overtime Rate ($/hr) *</Label>
                  <Input id="emp-ot-rate" type="number" step="0.01" value={empClassOvertimeRate} onChange={(e) => setEmpClassOvertimeRate(e.target.value)} data-testid="input-emp-class-ot-rate" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="emp-eff-date">Effective Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !empClassEffectiveDate && "text-muted-foreground"
                        )}
                        data-testid="input-emp-class-eff-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {empClassEffectiveDate ? format(parseISO(empClassEffectiveDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={empClassEffectiveDate ? parseISO(empClassEffectiveDate) : undefined}
                        onSelect={(date) => setEmpClassEffectiveDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp-end-date">End Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !empClassEndDate && "text-muted-foreground"
                        )}
                        data-testid="input-emp-class-end-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {empClassEndDate ? format(parseISO(empClassEndDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={empClassEndDate ? parseISO(empClassEndDate) : undefined}
                        onSelect={(date) => setEmpClassEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="emp-primary" checked={empClassIsPrimary} onCheckedChange={(checked) => setEmpClassIsPrimary(checked === true)} data-testid="checkbox-emp-class-primary" />
                <Label htmlFor="emp-primary">Primary Classification</Label>
              </div>
              <div>
                <Label htmlFor="emp-notes">Notes</Label>
                <Textarea id="emp-notes" value={empClassNotes} onChange={(e) => setEmpClassNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-emp-class-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetEmployeeClassDialog}>Cancel</Button>
              <Button onClick={handleSaveEmployeeClass} disabled={employeeClassMutation.isPending} data-testid="button-save-emp-class">
                {editingEmployeeClass ? "Update" : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showPWRateDialog} onOpenChange={(open) => !open && resetPWRateDialog()}>
          <DialogContent className="max-w-lg" data-testid="dialog-pw-rate">
            <DialogHeader>
              <DialogTitle>{editingPWRate ? "Edit Prevailing Wage Rate" : "Add Prevailing Wage Rate"}</DialogTitle>
              <DialogDescription>
                {editingPWRate ? "Update prevailing wage rate for project" : "Add a prevailing wage rate for a project classification"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Project *</Label>
                  <Select value={pwProjectId} onValueChange={setPwProjectId} disabled={!!editingPWRate}>
                    <SelectTrigger data-testid="select-pw-project">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classification *</Label>
                  <Select value={pwClassificationId} onValueChange={setPwClassificationId} disabled={!!editingPWRate}>
                    <SelectTrigger data-testid="select-pw-classification">
                      <SelectValue placeholder="Select classification" />
                    </SelectTrigger>
                    <SelectContent>
                      {classifications.filter(c => c.isActive).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="pw-wage-rate">Wage Rate ($/hr) *</Label>
                  <Input id="pw-wage-rate" type="number" step="0.01" value={pwWageRate} onChange={(e) => setPwWageRate(e.target.value)} data-testid="input-pw-wage-rate" />
                </div>
                <div>
                  <Label htmlFor="pw-fringe-rate">Fringe Rate ($/hr)</Label>
                  <Input id="pw-fringe-rate" type="number" step="0.01" value={pwFringeRate} onChange={(e) => setPwFringeRate(e.target.value)} placeholder="0.00" data-testid="input-pw-fringe-rate" />
                </div>
                <div>
                  <Label htmlFor="pw-ot-mult">OT Multiplier</Label>
                  <Input id="pw-ot-mult" type="number" step="0.01" value={pwOvertimeMultiplier} onChange={(e) => setPwOvertimeMultiplier(e.target.value)} data-testid="input-pw-ot-mult" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pw-eff-date">Effective Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !pwEffectiveDate && "text-muted-foreground"
                        )}
                        data-testid="input-pw-eff-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {pwEffectiveDate ? format(parseISO(pwEffectiveDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={pwEffectiveDate ? parseISO(pwEffectiveDate) : undefined}
                        onSelect={(date) => setPwEffectiveDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw-exp-date">Expiration Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !pwExpirationDate && "text-muted-foreground"
                        )}
                        data-testid="input-pw-exp-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {pwExpirationDate ? format(parseISO(pwExpirationDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={pwExpirationDate ? parseISO(pwExpirationDate) : undefined}
                        onSelect={(date) => setPwExpirationDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div>
                <Label htmlFor="pw-decision">Wage Decision Number</Label>
                <Input id="pw-decision" value={pwWageDecision} onChange={(e) => setPwWageDecision(e.target.value)} placeholder="e.g., CA20230001" data-testid="input-pw-decision" />
              </div>
              <div>
                <Label htmlFor="pw-notes">Notes</Label>
                <Textarea id="pw-notes" value={pwNotes} onChange={(e) => setPwNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-pw-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetPWRateDialog}>Cancel</Button>
              <Button onClick={handleSavePWRate} disabled={pwRateMutation.isPending} data-testid="button-save-pw-rate">
                {editingPWRate ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showSalaryCatDialog} onOpenChange={(open) => !open && resetSalaryCatDialog()}>
          <DialogContent data-testid="dialog-salary-cat">
            <DialogHeader>
              <DialogTitle>{editingSalaryCat ? "Edit Salary Category" : "Add Salary Category"}</DialogTitle>
              <DialogDescription>
                {editingSalaryCat ? "Update salary category details" : "Create a new salary category for your organization"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sal-cat-name">Name *</Label>
                <Input id="sal-cat-name" value={salCatName} onChange={(e) => setSalCatName(e.target.value)} placeholder="e.g., Senior Engineer" data-testid="input-sal-cat-name" />
              </div>
              <div>
                <Label htmlFor="sal-cat-salary">Base Annual Salary ($) *</Label>
                <Input id="sal-cat-salary" type="number" step="0.01" value={salCatBaseSalary} onChange={(e) => setSalCatBaseSalary(e.target.value)} placeholder="85000.00" data-testid="input-sal-cat-salary" />
              </div>
              <div>
                <Label>Salary Type</Label>
                <Select value={salCatType} onValueChange={setSalCatType}>
                  <SelectTrigger data-testid="select-sal-cat-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">Fixed</SelectItem>
                    <SelectItem value="CONTRACT">Contract</SelectItem>
                    <SelectItem value="HOURLY_EQUIVALENT">Hourly Equivalent</SelectItem>
                    <SelectItem value="SEASONAL">Seasonal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sal-cat-eff-date">Effective Date</Label>
                <Input id="sal-cat-eff-date" value={salCatEffDate} onChange={(e) => setSalCatEffDate(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-sal-cat-eff-date" />
              </div>
              <div>
                <Label htmlFor="sal-cat-desc">Description</Label>
                <Textarea id="sal-cat-desc" value={salCatDescription} onChange={(e) => setSalCatDescription(e.target.value)} placeholder="Optional description..." data-testid="input-sal-cat-desc" />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="sal-cat-active" checked={salCatIsActive} onCheckedChange={(checked) => setSalCatIsActive(checked === true)} data-testid="checkbox-sal-cat-active" />
                <Label htmlFor="sal-cat-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetSalaryCatDialog}>Cancel</Button>
              <Button onClick={handleSaveSalaryCat} disabled={salaryCatMutation.isPending} data-testid="button-save-salary-cat">
                {editingSalaryCat ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showBurdenDialog} onOpenChange={(open) => !open && resetBurdenDialog()}>
          <DialogContent data-testid="dialog-burden-rate">
            <DialogHeader>
              <DialogTitle>{editingBurden ? "Edit Burden Rate" : "Add Burden Rate"}</DialogTitle>
              <DialogDescription>
                {editingBurden ? "Update burden rate configuration" : "Create a new burden rate profile for your organization"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="burden-name">Name *</Label>
                <Input id="burden-name" value={burdenName} onChange={(e) => setBurdenName(e.target.value)} placeholder="e.g., Standard Burden" data-testid="input-burden-name" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="burden-taxes">Taxes (%)</Label>
                  <Input id="burden-taxes" type="number" step="0.01" value={burdenTaxes} onChange={(e) => setBurdenTaxes(e.target.value)} placeholder="7.65" data-testid="input-burden-taxes" />
                </div>
                <div>
                  <Label htmlFor="burden-benefits">Benefits (%)</Label>
                  <Input id="burden-benefits" type="number" step="0.01" value={burdenBenefits} onChange={(e) => setBurdenBenefits(e.target.value)} placeholder="15.00" data-testid="input-burden-benefits" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="burden-insurance">Insurance (%)</Label>
                  <Input id="burden-insurance" type="number" step="0.01" value={burdenInsurance} onChange={(e) => setBurdenInsurance(e.target.value)} placeholder="5.00" data-testid="input-burden-insurance" />
                </div>
                <div>
                  <Label htmlFor="burden-overhead">Overhead (%)</Label>
                  <Input id="burden-overhead" type="number" step="0.01" value={burdenOverhead} onChange={(e) => setBurdenOverhead(e.target.value)} placeholder="10.00" data-testid="input-burden-overhead" />
                </div>
              </div>
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium">Total Burden: <span className="font-mono" data-testid="text-computed-burden">{computedBurdenPercent()}%</span></p>
              </div>
              <div>
                <Label htmlFor="burden-fixed">Fixed Burden Amount ($)</Label>
                <Input id="burden-fixed" type="number" step="0.01" value={burdenFixed} onChange={(e) => setBurdenFixed(e.target.value)} placeholder="0.00" data-testid="input-burden-fixed" />
              </div>
              <div>
                <Label htmlFor="burden-desc">Description</Label>
                <Textarea id="burden-desc" value={burdenDescription} onChange={(e) => setBurdenDescription(e.target.value)} placeholder="Optional description..." data-testid="input-burden-desc" />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="burden-active" checked={burdenIsActive} onCheckedChange={(checked) => setBurdenIsActive(checked === true)} data-testid="checkbox-burden-active" />
                <Label htmlFor="burden-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetBurdenDialog}>Cancel</Button>
              <Button onClick={handleSaveBurden} disabled={burdenRateMutation.isPending} data-testid="button-save-burden">
                {editingBurden ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showCostAssignDialog} onOpenChange={(open) => !open && resetCostAssignDialog()}>
          <DialogContent data-testid="dialog-cost-assign">
            <DialogHeader>
              <DialogTitle>{editingCostAssign ? "Edit Cost Assignment" : "Add Cost Assignment"}</DialogTitle>
              <DialogDescription>
                {editingCostAssign ? "Update employee cost assignment" : "Assign an employee to a salary category and burden rate"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Employee *</Label>
                <Select value={costAssignUserId} onValueChange={setCostAssignUserId} disabled={!!editingCostAssign}>
                  <SelectTrigger data-testid="select-cost-assign-user">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} - {u.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Salary Category *</Label>
                  <Select value={costAssignSalaryCatId} onValueChange={setCostAssignSalaryCatId}>
                    <SelectTrigger data-testid="select-cost-assign-salary-cat">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {salaryCategories.filter(sc => sc.isActive).map((sc) => (
                        <SelectItem key={sc.id} value={sc.id}>{sc.name} - ${parseFloat(sc.baseAnnualSalary).toLocaleString()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Burden Rate</Label>
                  <Select value={costAssignBurdenId} onValueChange={setCostAssignBurdenId}>
                    <SelectTrigger data-testid="select-cost-assign-burden">
                      <SelectValue placeholder="Select burden rate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {burdenRatesList.filter(br => br.isActive).map((br) => (
                        <SelectItem key={br.id} value={br.id}>{br.name} - {parseFloat(br.burdenPercentage).toFixed(2)}%</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="cost-assign-hours">Working Hours / Year</Label>
                <Input id="cost-assign-hours" type="number" value={costAssignHours} onChange={(e) => setCostAssignHours(e.target.value)} placeholder="2080" data-testid="input-cost-assign-hours" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cost-assign-eff-date">Effective Date *</Label>
                  <Input id="cost-assign-eff-date" value={costAssignEffDate} onChange={(e) => setCostAssignEffDate(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-cost-assign-eff-date" />
                </div>
                <div>
                  <Label htmlFor="cost-assign-end-date">End Date</Label>
                  <Input id="cost-assign-end-date" value={costAssignEndDate} onChange={(e) => setCostAssignEndDate(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-cost-assign-end-date" />
                </div>
              </div>
              <div>
                <Label htmlFor="cost-assign-notes">Notes</Label>
                <Textarea id="cost-assign-notes" value={costAssignNotes} onChange={(e) => setCostAssignNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-cost-assign-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetCostAssignDialog}>Cancel</Button>
              <Button onClick={handleSaveCostAssign} disabled={costAssignMutation.isPending} data-testid="button-save-cost-assign">
                {editingCostAssign ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent data-testid="dialog-delete-confirm">
            <DialogHeader>
              <DialogTitle>Confirm Delete</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button 
                variant="destructive" 
                onClick={handleDelete} 
                disabled={deleteClassificationMutation.isPending || deleteEmployeeClassMutation.isPending || deletePWRateMutation.isPending || deleteSalaryCatMutation.isPending || deleteBurdenRateMutation.isPending || deleteCostAssignMutation.isPending}
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
