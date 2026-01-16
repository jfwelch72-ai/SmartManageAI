import * as React from "react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DatePickerProps {
  value?: Date | string | null;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  buttonClassName?: string;
  "data-testid"?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  readOnly = false,
  className,
  buttonClassName,
  "data-testid": testId,
}: DatePickerProps) {
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

  const formattedDate = parsedDate ? format(parsedDate, "PPP") : null;

  if (readOnly) {
    return (
      <div
        className={cn(
          "flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm",
          !formattedDate && "text-muted-foreground",
          className
        )}
        data-testid={testId}
      >
        {formattedDate || placeholder}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
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
          {formattedDate || <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsedDate}
          onSelect={onChange}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export interface FormDatePickerProps extends Omit<DatePickerProps, "value" | "onChange"> {
  field: {
    value: string | Date | null | undefined;
    onChange: (value: string | Date | null) => void;
  };
  dateFormat?: string;
  outputFormat?: "string" | "date";
}

export function FormDatePicker({
  field,
  dateFormat = "yyyy-MM-dd",
  outputFormat = "string",
  ...props
}: FormDatePickerProps) {
  const handleChange = (date: Date | undefined) => {
    if (date) {
      if (outputFormat === "date") {
        field.onChange(date);
      } else {
        field.onChange(format(date, dateFormat));
      }
    } else {
      field.onChange(outputFormat === "date" ? null : "");
    }
  };

  return (
    <DatePicker
      value={field.value}
      onChange={handleChange}
      {...props}
    />
  );
}
