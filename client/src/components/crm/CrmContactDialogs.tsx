import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Edit, User, Mail, Phone } from "lucide-react";
import type { CrmContact } from "@shared/schema";

type ContactRole = "PM" | "ESTIMATOR" | "SUPERINTENDENT" | "SALES" | "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "OWNER" | "GENERAL_MANAGER" | "FOREMAN" | "OTHER";

const ROLE_LABELS: Record<ContactRole, string> = {
  PM: "Project Manager",
  ESTIMATOR: "Estimator",
  SUPERINTENDENT: "Superintendent",
  SALES: "Sales",
  ACCOUNTS_PAYABLE: "Accounts Payable",
  ACCOUNTS_RECEIVABLE: "Accounts Receivable",
  OWNER: "Owner",
  GENERAL_MANAGER: "General Manager",
  FOREMAN: "Foreman",
  OTHER: "Other",
};

interface ContactFormState {
  firstName: string;
  lastName: string;
  title: string;
  role: ContactRole;
  email: string;
  phone: string;
  mobile: string;
  isPrimary: boolean;
  notes: string;
}

interface CrmContactDialogsProps {
  createContactOpen: boolean;
  setCreateContactOpen: (open: boolean) => void;
  editContactOpen: boolean;
  setEditContactOpen: (open: boolean) => void;
  viewContactOpen: boolean;
  setViewContactOpen: (open: boolean) => void;
  newContact: ContactFormState;
  setNewContact: (contact: ContactFormState) => void;
  selectedContact: CrmContact | null;
  selectedOrgName: string | undefined;
  selectedOrgId: string | undefined;
  createContactMutation: any;
  updateContactMutation: any;
  openEditContact: (contact: CrmContact) => void;
}

function ContactFormFields({ newContact, setNewContact, prefix }: {
  newContact: ContactFormState;
  setNewContact: (c: ContactFormState) => void;
  prefix: string;
}) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input
            value={newContact.firstName}
            onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
            placeholder="First name"
            data-testid={`input-${prefix}contact-first-name`}
          />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input
            value={newContact.lastName}
            onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
            placeholder="Last name"
            data-testid={`input-${prefix}contact-last-name`}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={newContact.title}
            onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
            placeholder="Job title"
            data-testid={`input-${prefix}contact-title`}
          />
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <Select value={newContact.role} onValueChange={(v) => setNewContact({ ...newContact, role: v as ContactRole })}>
            <SelectTrigger data-testid={`select-${prefix}contact-role`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PM">Project Manager</SelectItem>
              <SelectItem value="ESTIMATOR">Estimator</SelectItem>
              <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
              <SelectItem value="SALES">Sales</SelectItem>
              <SelectItem value="ACCOUNTS_PAYABLE">Accounts Payable</SelectItem>
              <SelectItem value="ACCOUNTS_RECEIVABLE">Accounts Receivable</SelectItem>
              <SelectItem value="OWNER">Owner</SelectItem>
              <SelectItem value="GENERAL_MANAGER">General Manager</SelectItem>
              <SelectItem value="FOREMAN">Foreman</SelectItem>
              <SelectItem value="OTHER">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          value={newContact.email}
          onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
          placeholder="email@example.com"
          data-testid={`input-${prefix}contact-email`}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input
            value={newContact.phone}
            onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
            placeholder="(555) 555-5555"
            data-testid={`input-${prefix}contact-phone`}
          />
        </div>
        <div className="space-y-2">
          <Label>Mobile</Label>
          <Input
            value={newContact.mobile}
            onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })}
            placeholder="(555) 555-5555"
            data-testid={`input-${prefix}contact-mobile`}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${prefix}isPrimary`}
          checked={newContact.isPrimary}
          onChange={(e) => setNewContact({ ...newContact, isPrimary: e.target.checked })}
          className="rounded border-input"
          data-testid={`checkbox-${prefix}contact-primary`}
        />
        <Label htmlFor={`${prefix}isPrimary`} className="cursor-pointer">Primary contact</Label>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={newContact.notes}
          onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
          placeholder="Additional notes..."
          data-testid={`input-${prefix}contact-notes`}
        />
      </div>
    </div>
  );
}

export function CrmContactDialogs({
  createContactOpen,
  setCreateContactOpen,
  editContactOpen,
  setEditContactOpen,
  viewContactOpen,
  setViewContactOpen,
  newContact,
  setNewContact,
  selectedContact,
  selectedOrgName,
  selectedOrgId,
  createContactMutation,
  updateContactMutation,
  openEditContact,
}: CrmContactDialogsProps) {
  return (
    <>
      <Dialog open={createContactOpen} onOpenChange={setCreateContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
            <DialogDescription>
              Add a new contact to {selectedOrgName}
            </DialogDescription>
          </DialogHeader>
          <ContactFormFields newContact={newContact} setNewContact={setNewContact} prefix="" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateContactOpen(false)} data-testid="button-cancel-contact">
              Cancel
            </Button>
            <Button
              onClick={() => selectedOrgId && createContactMutation.mutate({ ...newContact, organisationId: selectedOrgId })}
              disabled={!newContact.firstName || !newContact.lastName || createContactMutation.isPending}
              data-testid="button-save-contact"
            >
              {createContactMutation.isPending ? "Creating..." : "Add Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editContactOpen} onOpenChange={setEditContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>
              Update contact information
            </DialogDescription>
          </DialogHeader>
          <ContactFormFields newContact={newContact} setNewContact={setNewContact} prefix="edit-" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditContactOpen(false)} data-testid="button-cancel-edit-contact">
              Cancel
            </Button>
            <Button
              onClick={() => selectedContact && updateContactMutation.mutate({ id: selectedContact.id, ...newContact })}
              disabled={!newContact.firstName || !newContact.lastName || updateContactMutation.isPending}
              data-testid="button-update-contact"
            >
              {updateContactMutation.isPending ? "Updating..." : "Update Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewContactOpen} onOpenChange={setViewContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-xl">
                  {selectedContact?.firstName} {selectedContact?.lastName}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-2">
                  {selectedContact?.isPrimary && (
                    <Badge variant="secondary">Primary Contact</Badge>
                  )}
                  <Badge variant="outline">
                    {ROLE_LABELS[(selectedContact?.role || "OTHER") as ContactRole]}
                  </Badge>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedContact) {
                    openEditContact(selectedContact);
                    setViewContactOpen(false);
                  }
                }}
                data-testid="button-edit-from-view"
              >
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedContact?.title && (
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Title</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.title}</p>
                </div>
              </div>
            )}
            {selectedContact?.email && (
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <a href={`mailto:${selectedContact.email}`} className="text-sm text-primary hover:underline">
                    {selectedContact.email}
                  </a>
                </div>
              </div>
            )}
            {selectedContact?.phone && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Phone</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.phone}</p>
                </div>
              </div>
            )}
            {selectedContact?.mobile && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Mobile</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.mobile}</p>
                </div>
              </div>
            )}
            {selectedContact?.notes && (
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Notes</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.notes}</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
