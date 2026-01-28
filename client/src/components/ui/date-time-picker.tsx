import * as React from "react";
import { format, parseISO, setHours, setMinutes } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DateTimePickerProps {
  value?: Date | string | null;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  buttonClassName?: string;
  required?: boolean;
  "data-testid"?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date and time",
  disabled = false,
  readOnly = false,
  className,
  buttonClassName,
  required = false,
  "data-testid": testId,
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const parsedDate = React.useMemo(() => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value === "string") {
      try {
        return parseISO(value);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }, [value]);

  const [time, setTime] = React.useState(() => {
    if (parsedDate) {
      return format(parsedDate, "HH:mm");
    }
    return "09:00";
  });

  React.useEffect(() => {
    if (parsedDate) {
      setTime(format(parsedDate, "HH:mm"));
    }
  }, [parsedDate]);

  const formattedDateTime = parsedDate 
    ? format(parsedDate, "MMM d, yyyy h:mm a") 
    : null;

  const handleDateSelect = (date: Date | undefined) => {
    if (date && onChange) {
      const [hours, minutes] = time.split(":").map(Number);
      const newDate = setMinutes(setHours(date, hours), minutes);
      onChange(newDate);
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = e.target.value;
    setTime(newTime);
    
    if (parsedDate && onChange && newTime) {
      const [hours, minutes] = newTime.split(":").map(Number);
      const newDate = setMinutes(setHours(parsedDate, hours), minutes);
      onChange(newDate);
    }
  };

  if (readOnly) {
    return (
      <div
        className={cn(
          "flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm",
          !formattedDateTime && "text-muted-foreground",
          className
        )}
        data-testid={testId}
      >
        {formattedDateTime || placeholder}
      </div>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !parsedDate && "text-muted-foreground",
            buttonClassName
          )}
          disabled={disabled}
          data-testid={testId}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formattedDateTime || <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsedDate}
          onSelect={handleDateSelect}
          initialFocus
        />
        <div className="border-t p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Input
              type="time"
              value={time}
              onChange={handleTimeChange}
              className="w-auto"
              data-testid={testId ? `${testId}-time` : undefined}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
