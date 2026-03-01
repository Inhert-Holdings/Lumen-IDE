import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
};

export function Modal({ open, title, children, onConfirm, onCancel, confirmLabel = "Approve" }: ModalProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded border border-border bg-panel shadow-2xl">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold">{title}</div>
        <div className="max-h-[60vh] overflow-auto p-3 text-xs text-text">{children}</div>
        <div className={cn("flex justify-end gap-2 border-t border-border px-3 py-2")}> 
          <Button onClick={onCancel}>Deny</Button>
          <Button className="border-accent text-accent" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
