import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bea47d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1012] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-[#cdb38b] bg-[#bea47d] text-[#151619] hover:bg-[#cdb38b]",
        secondary: "border-white/10 bg-white/[.045] text-[#d9d8d4] hover:border-[#bea47d]/30 hover:bg-[#bea47d]/10",
        ghost: "border-transparent bg-transparent text-[#aaa8a3] hover:bg-white/[.055] hover:text-[#ececea]",
        destructive: "border-red-300/35 bg-red-400/10 text-red-200 hover:bg-red-400/20",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});

Button.displayName = "Button";

export { Button, buttonVariants };
