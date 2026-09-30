"use client";

export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`font-display font-bold text-base rounded-full px-5 py-3 min-h-12 cursor-pointer transition-colors ${
              active ? "bg-lime text-ground border border-lime glow-lime" : "bg-surface text-ink border border-white/10 hover:border-white/25"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
