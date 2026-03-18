import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SidebarSectionProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}

export function SidebarSection({ label, children, defaultOpen = true, action }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <div className="flex items-center px-2 py-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex-1 text-left"
        >
          {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <span>{label}</span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}
