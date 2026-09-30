import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const inputClass =
  "w-full min-w-0 bg-surface border border-white/10 rounded-2xl px-5 py-[18px] text-xl text-ink outline-none transition-colors focus:border-lime/60";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-2.5 text-[13px] text-muted min-w-0">
      <span>{label}</span>
      {children}
      {hint}
    </label>
  );
}

export function TextInput({ font = "sans", className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { font?: "sans" | "mono" | "display" }) {
  const f = font === "mono" ? "font-mono" : font === "display" ? "font-display font-bold" : "font-sans";
  return <input {...rest} className={`${inputClass} ${f} ${className}`} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${inputClass} font-sans text-base min-h-28 resize-y ${className}`} />;
}

export function Suffixed({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <span className="flex items-center bg-surface border border-white/10 rounded-2xl px-5 focus-within:border-lime/60 transition-colors">
      {children}
      <span className="font-display font-bold text-sm text-muted pl-3">{suffix}</span>
    </span>
  );
}
