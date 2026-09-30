import type { ButtonHTMLAttributes } from "react";

const variants = {
  lime: "bg-lime text-ground glow-lime",
  violet: "bg-violet-light text-ground glow-violet",
  burn: "bg-burn text-ground puff",
  ghost: "bg-raised-2 text-ink border border-white/10",
  outline: "bg-transparent text-ink border border-white/15",
  danger: "bg-transparent text-burn border border-burn/45",
};
const sizes = {
  sm: "px-4 py-2.5 text-sm min-h-11 font-sans font-semibold",
  md: "px-6 py-3.5 text-[15px] min-h-12 font-display font-bold",
  lg: "py-5 text-xl w-full min-h-16 font-display font-black",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes };

export function Button({ variant = "lime", size = "md", className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-full tracking-tight cursor-pointer transition-transform active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    />
  );
}
