import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function useCrmMutations(selectedOrgId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createOrgMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/crm/organisations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      toast({ title: "Organization created successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create organization", description: err.message, variant: "destructive" });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...rest } = data;
      return apiRequest("PUT", `/api/crm/organisations/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      toast({ title: "Organization updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update organization", description: err.message, variant: "destructive" });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/organisations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      toast({ title: "Organization deleted successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete organization", description: err.message, variant: "destructive" });
    },
  });

  const createContactMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/crm/contacts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}`] });
      toast({ title: "Contact created successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create contact", description: err.message, variant: "destructive" });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...rest } = data;
      return apiRequest("PUT", `/api/crm/contacts/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}`] });
      toast({ title: "Contact updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update contact", description: err.message, variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}`] });
      toast({ title: "Contact deleted successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete contact", description: err.message, variant: "destructive" });
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: async (data: { noteType: string; content: string; contactId?: string }) => {
      if (!selectedOrgId) throw new Error("No organization selected");
      return apiRequest("POST", `/api/crm/organisations/${selectedOrgId}/notes`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/notes`] });
      toast({ title: "Note added successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!selectedOrgId) throw new Error("No organization selected");
      return apiRequest("DELETE", `/api/crm/organisations/${selectedOrgId}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/notes`] });
      toast({ title: "Note deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete note", description: err.message, variant: "destructive" });
    },
  });

  const createPricingMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedOrgId) throw new Error("No organization selected");
      const payload = {
        ...data,
        unitPrice: data.unitPrice || "0",
        minimumOrder: data.minimumOrder || null,
        deliveryFee: data.deliveryFee || null,
        leadTimeDays: data.leadTimeDays ? parseInt(data.leadTimeDays) : null,
        effectiveDate: new Date(data.effectiveDate),
      };
      return apiRequest("POST", `/api/crm/organisations/${selectedOrgId}/pricing`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing`] });
      toast({ title: "Pricing item added" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add pricing item", description: err.message, variant: "destructive" });
    },
  });

  const updatePricingMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...rest } = data;
      const payload = {
        ...rest,
        unitPrice: rest.unitPrice || "0",
        minimumOrder: rest.minimumOrder || null,
        deliveryFee: rest.deliveryFee || null,
        leadTimeDays: rest.leadTimeDays ? parseInt(rest.leadTimeDays) : null,
        effectiveDate: new Date(rest.effectiveDate),
      };
      return apiRequest("PUT", `/api/crm/pricing/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing`] });
      toast({ title: "Pricing item updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update pricing item", description: err.message, variant: "destructive" });
    },
  });

  const deletePricingMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/pricing/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing`] });
      toast({ title: "Pricing item deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete pricing item", description: err.message, variant: "destructive" });
    },
  });

  const createRentalMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedOrgId) throw new Error("No organization selected");
      const payload = {
        ...data,
        hourlyRate: data.hourlyRate || null,
        dailyRate: data.dailyRate || null,
        weeklyRate: data.weeklyRate || null,
        monthlyRate: data.monthlyRate || null,
        deliveryFee: data.deliveryFee || null,
        pickupFee: data.pickupFee || null,
        minimumRentalDays: data.minimumRentalDays ? parseInt(data.minimumRentalDays) : 1,
      };
      return apiRequest("POST", `/api/crm/organisations/${selectedOrgId}/rental-catalog`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/rental-catalog`] });
      toast({ title: "Rental equipment added" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add rental equipment", description: err.message, variant: "destructive" });
    },
  });

  const updateRentalMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...rest } = data;
      const payload = {
        ...rest,
        hourlyRate: rest.hourlyRate || null,
        dailyRate: rest.dailyRate || null,
        weeklyRate: rest.weeklyRate || null,
        monthlyRate: rest.monthlyRate || null,
        deliveryFee: rest.deliveryFee || null,
        pickupFee: rest.pickupFee || null,
        minimumRentalDays: rest.minimumRentalDays ? parseInt(rest.minimumRentalDays) : 1,
      };
      return apiRequest("PUT", `/api/crm/rental-catalog/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/rental-catalog`] });
      toast({ title: "Rental equipment updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update rental equipment", description: err.message, variant: "destructive" });
    },
  });

  const deleteRentalMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/rental-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/rental-catalog`] });
      toast({ title: "Rental equipment deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete rental equipment", description: err.message, variant: "destructive" });
    },
  });

  const inviteVendorMutation = useMutation({
    mutationFn: async (data: { vendorEmail: string; autoApprove: boolean }) => {
      if (!selectedOrgId) throw new Error("No organization selected");
      return apiRequest("POST", `/api/vendor-enrollments/invite`, {
        vendorCrmOrganisationId: selectedOrgId,
        vendorEmail: data.vendorEmail,
        autoApproveNewPricing: data.autoApprove,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-enrollments/by-crm-org/${selectedOrgId}`] });
      toast({ title: "Vendor invitation sent", description: "The vendor will receive an email to set up their portal access." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to invite vendor", description: err.message, variant: "destructive" });
    },
  });

  const updateEnrollmentMutation = useMutation({
    mutationFn: async (data: { enrollmentId: string; autoApprove: boolean }) => {
      return apiRequest("PATCH", `/api/vendor-enrollments/${data.enrollmentId}`, {
        autoApproveNewPricing: data.autoApprove,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-enrollments/by-crm-org/${selectedOrgId}`] });
      toast({ title: "Enrollment settings updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update enrollment", description: err.message, variant: "destructive" });
    },
  });

  const suspendEnrollmentMutation = useMutation({
    mutationFn: async (enrollmentId: string) => {
      return apiRequest("POST", `/api/vendor-enrollments/${enrollmentId}/suspend`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-enrollments/by-crm-org/${selectedOrgId}`] });
      toast({ title: "Vendor portal access suspended" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to suspend vendor", description: err.message, variant: "destructive" });
    },
  });

  const reactivateEnrollmentMutation = useMutation({
    mutationFn: async (enrollmentId: string) => {
      return apiRequest("POST", `/api/vendor-enrollments/${enrollmentId}/reactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-enrollments/by-crm-org/${selectedOrgId}`] });
      toast({ title: "Vendor portal access reactivated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to reactivate vendor", description: err.message, variant: "destructive" });
    },
  });

  const approvePricingMutation = useMutation({
    mutationFn: async (pricingId: string) => {
      return apiRequest("POST", `/api/crm/pricing/${pricingId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing`] });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing/pending`] });
      toast({ title: "Pricing approved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to approve pricing", description: err.message, variant: "destructive" });
    },
  });

  const rejectPricingMutation = useMutation({
    mutationFn: async (pricingId: string) => {
      return apiRequest("POST", `/api/crm/pricing/${pricingId}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing`] });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/organisations/${selectedOrgId}/pricing/pending`] });
      toast({ title: "Pricing rejected" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to reject pricing", description: err.message, variant: "destructive" });
    },
  });

  return {
    createOrgMutation,
    updateOrgMutation,
    deleteOrgMutation,
    createContactMutation,
    updateContactMutation,
    deleteContactMutation,
    createNoteMutation,
    deleteNoteMutation,
    createPricingMutation,
    updatePricingMutation,
    deletePricingMutation,
    createRentalMutation,
    updateRentalMutation,
    deleteRentalMutation,
    inviteVendorMutation,
    updateEnrollmentMutation,
    suspendEnrollmentMutation,
    reactivateEnrollmentMutation,
    approvePricingMutation,
    rejectPricingMutation,
  };
}
