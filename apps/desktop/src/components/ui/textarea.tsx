import { cn } from "@/lib/utils";
import { forwardRef, type TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "rounded border border-border bg-black/20 px-2 py-1.5 text-xs text-text outline-none ring-accent/50 placeholder:text-muted focus:ring-1",
        className
      )}
      {...props}
    />
  );
});
