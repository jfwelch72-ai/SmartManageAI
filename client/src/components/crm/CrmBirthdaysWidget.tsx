import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Cake, ChevronDown, ChevronUp, Mail, Phone } from "lucide-react";

export interface BirthdayContact {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  birthday: string;
  organisationId: string;
  orgName: string | null;
  daysUntil: number;
  turningAge: number | null;
}

interface BirthdaysResponse {
  today: BirthdayContact[];
  upcoming: BirthdayContact[];
  days: number;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatBirthday(birthday: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  if (!m) return birthday;
  const monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return birthday;
  return `${MONTH_NAMES[monthIdx]} ${parseInt(m[3], 10)}`;
}

interface CrmBirthdaysWidgetProps {
  onSelectContact: (contact: BirthdayContact) => void;
}

export function CrmBirthdaysWidget({ onSelectContact }: CrmBirthdaysWidgetProps) {
  const [showUpcoming, setShowUpcoming] = useState(false);

  const { data, isLoading } = useQuery<BirthdaysResponse>({
    queryKey: ["/api/crm/contacts/birthdays/upcoming", { days: 7 }],
  });

  if (isLoading) {
    return (
      <Card data-testid="card-crm-birthdays">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cake className="w-4 h-4 text-pink-500" />
            Birthdays
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];
  const totalCount = today.length + upcoming.length;

  if (totalCount === 0) {
    return (
      <Card data-testid="card-crm-birthdays">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cake className="w-4 h-4 text-pink-500" />
            Birthdays
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-birthdays-empty">
            No contacts have birthdays in the next 7 days.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-crm-birthdays">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Cake className="w-4 h-4 text-pink-500" />
            Birthdays
          </span>
          <Badge variant="secondary" className="font-normal" data-testid="badge-birthdays-count">
            {today.length} today &middot; {upcoming.length} this week
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {today.length > 0 ? (
          <div className="space-y-2" data-testid="list-birthdays-today">
            {today.map((c) => (
              <BirthdayRow
                key={c.id}
                contact={c}
                highlighted
                onClick={() => onSelectContact(c)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-birthdays-today">
            No birthdays today.
          </p>
        )}

        {upcoming.length > 0 && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 -ml-2 text-muted-foreground"
              onClick={() => setShowUpcoming((v) => !v)}
              data-testid="button-toggle-upcoming-birthdays"
            >
              {showUpcoming ? (
                <ChevronUp className="w-4 h-4 mr-1" />
              ) : (
                <ChevronDown className="w-4 h-4 mr-1" />
              )}
              Next 7 days ({upcoming.length})
            </Button>
            {showUpcoming && (
              <div className="space-y-2 mt-2" data-testid="list-birthdays-upcoming">
                {upcoming.map((c) => (
                  <BirthdayRow
                    key={c.id}
                    contact={c}
                    onClick={() => onSelectContact(c)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BirthdayRow({
  contact,
  highlighted = false,
  onClick,
}: {
  contact: BirthdayContact;
  highlighted?: boolean;
  onClick: () => void;
}) {
  const dayLabel =
    contact.daysUntil === 0
      ? "Today"
      : contact.daysUntil === 1
      ? "Tomorrow"
      : `In ${contact.daysUntil} days`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 rounded-md border p-2 text-left transition-colors hover-elevate active-elevate-2 ${
        highlighted ? "border-pink-300 bg-pink-50 dark:bg-pink-950/30 dark:border-pink-900" : ""
      }`}
      data-testid={`button-birthday-contact-${contact.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate" data-testid={`text-birthday-name-${contact.id}`}>
            {contact.firstName} {contact.lastName}
          </span>
          {contact.orgName && (
            <span className="text-xs text-muted-foreground truncate">&middot; {contact.orgName}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span data-testid={`text-birthday-date-${contact.id}`}>{formatBirthday(contact.birthday)}</span>
          {contact.turningAge !== null && contact.turningAge > 0 && (
            <span>turning {contact.turningAge}</span>
          )}
          {contact.email && (
            <span className="hidden sm:inline-flex items-center gap-1">
              <Mail className="w-3 h-3" />
              {contact.email}
            </span>
          )}
          {!contact.email && contact.phone && (
            <span className="hidden sm:inline-flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {contact.phone}
            </span>
          )}
        </div>
      </div>
      <Badge
        variant={highlighted ? "default" : "secondary"}
        className="shrink-0"
        data-testid={`badge-birthday-days-${contact.id}`}
      >
        {dayLabel}
      </Badge>
    </button>
  );
}

