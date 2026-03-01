import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 rounded border border-border bg-black/20 px-2 text-xs text-text outline-none ring-accent/50 placeholder:text-muted focus:ring-1",
        className
      )}
      {...props}
    />
  );
}
