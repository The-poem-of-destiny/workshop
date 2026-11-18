import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef, type HTMLAttributes, useEffect } from "react";
import { cn } from "../../lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn("dialog-overlay fixed inset-0 z-50 bg-black/75 backdrop-blur-xs", className)}
      {...props}
    />
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent("dismissableLayer.update"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "dialog-surface fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-32px)] max-w-[860px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[12px] border border-white/[.1] bg-[#161920] text-[#efeee9] shadow-[0_24px_72px_rgba(0,0,0,.55)]",
          className?.includes("mobile-sheet") &&
            "max-md:inset-0 max-md:left-0 max-md:top-0 max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="close absolute right-2.5 top-2.5 inline-grid size-9 place-items-center rounded-md text-[#b5b2aa] transition-colors hover:bg-white/[.07] hover:text-[#efeee9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8ae82]">
          <X className="size-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-white/[.07] px-5 py-4", className)} {...props} />;
}

function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("pr-10 text-base font-semibold text-[#e5e4e1]", className)} {...props} />;
}

function DialogDescription({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-[#aaa8a3]", className)} {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
