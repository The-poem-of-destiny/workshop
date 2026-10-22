import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-white/[.11] bg-black/20 px-3 py-1 text-sm text-[#ececea] shadow-sm transition-colors placeholder:text-[#73726e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bea47d] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
