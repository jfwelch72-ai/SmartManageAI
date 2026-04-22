import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EnrollSequenceDialog } from "@/components/crm/EnrollSequenceDialog";
import { ContactSequenceTimeline } from "@/components/crm/ContactSequenceTimeline";
import { Textarea } from "@/components/ui/textarea";
import { Edit, User, Mail, Phone, Globe, Cake, UserCog } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { CrmContact } from "@shared/schema";
import { COMMON_TIMEZONES } from "@shared/timezones";
import { CrmCustomFieldsForm, CrmCustomFieldsDisplay, type CustomFieldsValue } from "./CrmCustomFieldsForm";

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
  timezone: string;
  birthday: string;
  ownerId: string;
}

interface OwnerOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

function formatBirthdayLabel(birthday: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  if (!m) return birthday;
  const [, , month, day] = m;
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthIdx = parseInt(month, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return birthday;
  return `${monthNames[monthIdx]} ${parseInt(day, 10)}`;
}

function getBirthdayBadge(birthday: string | null | undefined): { label: string; variant: "default" | "secondary" } | null {
  if (!birthday) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthday));
  if (!m) return null;
  const [, , monthStr, dayStr] = m;
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), month, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month, day);
  const diffDays = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return { label: "Birthday today", variant: "default" };
  if (diffDays <= 30) return { label: `Birthday in ${diffDays} day${diffDays === 1 ? "" : "s"}`, variant: "secondary" };
  return null;
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
  selectedContact: (CrmContact & { customFields?: Record<string, unknown> }) | null;
  selectedOrgName: string | undefined;
  selectedOrgId: string | undefined;
  createContactMutation: any;
  updateContactMutation: any;
  openEditContact: (contact: CrmContact) => void;
  customFields?: CustomFieldsValue;
  setCustomFields?: (v: CustomFieldsValue) => void;
}

function OwnerSummary({ ownerId }: { ownerId: string | null | undefined }) {
  const { data: orgUsers = [] } = useQuery<OwnerOption[]>({
    queryKey: ["/api/users"],
    enabled: !!ownerId,
  });
  if (!ownerId) return null;
  const owner = orgUsers.find((u) => u.id === ownerId);
  return (
    <div className="flex items-start gap-3" data-testid="text-contact-owner">
      <UserCog className="w-5 h-5 mt-0.5 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Owner</p>
        <p className="text-sm text-muted-foreground">{owner ? ownerLabel(owner) : ownerId}</p>
      </div>
    </div>
  );
}

function ownerLabel(u: OwnerOption): string {
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  if (name && u.email) return `${name} (${u.email})`;
  return name || u.email || u.id;
}

function ContactFormFields({ newContact, setNewContact, prefix, customFields, setCustomFields }: {
  newContact: ContactFormState;
  setNewContact: (c: ContactFormState) => void;
  prefix: string;
  customFields?: CustomFieldsValue;
  setCustomFields?: (v: CustomFieldsValue) => void;
}) {
  const { data: orgUsers = [] } = useQuery<OwnerOption[]>({
    queryKey: ["/api/users"],
  });
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
      <div className="space-y-2">
        <Label>Birthday</Label>
        <Input
          type="date"
          value={newContact.birthday}
          onChange={(e) => setNewContact({ ...newContact, birthday: e.target.value })}
          data-testid={`input-${prefix}contact-birthday`}
        />
      </div>
      <div className="space-y-2">
        <Label>Timezone</Label>
        <Select
          value={newContact.timezone || "__none__"}
          onValueChange={(v) => setNewContact({ ...newContact, timezone: v === "__none__" ? "" : v })}
        >
          <SelectTrigger data-testid={`select-${prefix}contact-timezone`}>
            <SelectValue placeholder="Select timezone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No timezone (use sender default)</SelectItem>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Used by optimized sends to land messages in this contact's local hours.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Owner</Label>
        <Select
          value={newContact.ownerId || "__none__"}
          onValueChange={(v) => setNewContact({ ...newContact, ownerId: v === "__none__" ? "" : v })}
        >
          <SelectTrigger data-testid={`select-${prefix}contact-owner`}>
            <SelectValue placeholder="Select owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Unassigned</SelectItem>
            {orgUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>{ownerLabel(u)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Receives birthday reminders and other ownership-based notifications for this contact.
        </p>
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
      {setCustomFields && (
        <CrmCustomFieldsForm
          entityType="CONTACT"
          values={customFields ?? {}}
          onChange={setCustomFields}
          prefix={prefix}
        />
      )}
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
  customFields,
  setCustomFields,
}: CrmContactDialogsProps) {
  return (
    <>
      <Dialog open={createContactOpen} onOpenChange={setCreateContactOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
            <DialogDescription>
              Add a new contact to {selectedOrgName}
            </DialogDescription>
          </DialogHeader>
          <ContactFormFields newContact={newContact} setNewContact={setNewContact} prefix="" customFields={customFields} setCustomFields={setCustomFields} />
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>
              Update contact information
            </DialogDescription>
          </DialogHeader>
          <ContactFormFields newContact={newContact} setNewContact={setNewContact} prefix="edit-" customFields={customFields} setCustomFields={setCustomFields} />
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
        <DialogContent className="sm:max-w-lg">
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
              <div className="flex items-center gap-2">
                {selectedContact?.id && (
                  <EnrollSequenceDialog contactIds={[selectedContact.id]} />
                )}
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
            {selectedContact?.birthday && (
              <div className="flex items-start gap-3" data-testid="text-contact-birthday">
                <Cake className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Birthday</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-muted-foreground">
                      {formatBirthdayLabel(String(selectedContact.birthday))}
                    </p>
                    {(() => {
                      const badge = getBirthdayBadge(String(selectedContact.birthday));
                      return badge ? (
                        <Badge variant={badge.variant} data-testid="badge-contact-birthday-upcoming">
                          {badge.label}
                        </Badge>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            )}
            <OwnerSummary ownerId={selectedContact?.ownerId ?? null} />
            {selectedContact?.timezone && (
              <div className="flex items-start gap-3" data-testid="text-contact-timezone">
                <Globe className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Timezone</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.timezone}</p>
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
            {selectedContact?.customFields && (
              <CrmCustomFieldsDisplay
                entityType="CONTACT"
                values={selectedContact.customFields}
                testIdPrefix="contact-"
              />
            )}
            {selectedContact?.id && (
              <div className="pt-2 border-t">
                <p className="text-sm font-medium mb-2">Sequence history</p>
                <ContactSequenceTimeline contactId={selectedContact.id} />
              </div>
            )}
            {selectedContact?.id && (
              <div className="pt-2 border-t">
                <p className="text-sm font-medium mb-2">Email history</p>
                <ContactEmailsPanel contactId={selectedContact.id} />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface CrmEmailMessageRow {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromAddress: string;
  toAddresses: string | null;
  subject: string;
  snippet: string | null;
  sentAt: string;
}

function ContactEmailsPanel({ contactId }: { contactId: string }) {
  const { data, isLoading, error } = useQuery<CrmEmailMessageRow[]>({
    queryKey: ["/api/crm/contacts", contactId, "emails"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${contactId}/emails`, { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to load emails");
      return res.json();
    },
  });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-xs text-muted-foreground">Unable to load emails.</p>;
  if (!data || data.length === 0) {
    return <p className="text-xs text-muted-foreground" data-testid="text-no-contact-emails">No logged emails yet.</p>;
  }
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {data.map((m) => (
        <div key={m.id} className="border rounded p-2 text-xs" data-testid={`row-contact-email-${m.id}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{m.subject || "(no subject)"}</span>
            <Badge variant={m.direction === "INBOUND" ? "secondary" : "outline"}>{m.direction}</Badge>
          </div>
          <div className="text-muted-foreground truncate">{m.direction === "INBOUND" ? m.fromAddress : m.toAddresses}</div>
          {m.snippet && <div className="text-muted-foreground line-clamp-2 mt-1">{m.snippet}</div>}
          <div className="text-muted-foreground mt-1">{new Date(m.sentAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
