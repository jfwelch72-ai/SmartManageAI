import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface MarkupTextInputProps {
  initialValue?: string;
  left: number;
  top: number;
  onSubmit: (text: string) => void | Promise<void>;
  onCancel: () => void;
  blurDelayMs?: number;
}

export function MarkupTextInput({
  initialValue = "",
  left,
  top,
  onSubmit,
  onCancel,
  blurDelayMs = 120,
}: MarkupTextInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {}
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finalize = (text: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = (text || "").trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    void onSubmit(trimmed);
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  const stopAll = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="absolute z-[60] pointer-events-auto flex items-center gap-1 bg-background border-2 border-primary rounded-md shadow-lg p-1"
      style={{ left, top }}
      onMouseDown={stopAll}
      onMouseUp={stopAll}
      onClick={stopAll}
      onPointerDown={stopAll}
      onWheel={stopAll}
      data-testid="markup-text-input-wrapper"
    >
      <input
        ref={inputRef}
        type="text"
        className="px-2 py-1 text-sm bg-background text-foreground outline-none border-0 min-w-[200px]"
        placeholder="Type label, then Enter…"
        value={value}
        data-testid="input-markup-text"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            finalize(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onKeyUp={stopAll}
        onBlur={(e) => {
          const v = e.currentTarget.value;
          window.setTimeout(() => {
            if (!submittedRef.current) finalize(v);
          }, blurDelayMs);
        }}
      />
      <button
        type="button"
        onClick={() => finalize(inputRef.current?.value ?? value)}
        className="px-2 py-1 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
        data-testid="button-save-markup-text"
        title="Save (Enter)"
      >
        Save
      </button>
      <button
        type="button"
        onClick={cancel}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent shrink-0"
        data-testid="button-cancel-markup-text"
        title="Cancel (Esc)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
