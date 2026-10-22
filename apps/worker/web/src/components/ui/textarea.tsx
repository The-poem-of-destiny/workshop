import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md border border-white/[.11] bg-black/20 px-3 py-2 text-sm text-[#ececea] shadow-sm transition-colors placeholder:text-[#73726e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bea47d] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
