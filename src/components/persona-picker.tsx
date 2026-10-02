import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { personaAccent, type Persona } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface Props {
  personas: Persona[];
  selected: string;
  onSelect: (id: string) => void;
  speaking?: boolean;
}

export function PersonaPicker({ personas, selected, onSelect, speaking }: Props) {
  const reduce = useReducedMotion();
  return (
    <div className="grid grid-cols-2 gap-2">
      {personas.map((p) => {
        const active = p.id === selected;
        const accent = personaAccent(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={active}
            className={cn(
              "rounded-lg bg-card p-3 text-left transition-all duration-150",
              "outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/50",
              "shadow-[0_1px_2px_rgba(41,39,45,0.06)]",
              active && "ring-2 ring-primary/60",
            )}
          >
            <span className="flex items-center gap-2">
              <motion.span
                animate={speaking && active && !reduce ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={
                  speaking && active
                    ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
                    : { duration: 0.15 }
                }
                className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold"
                style={{ backgroundColor: `${accent}33`, color: "#29272d" }}
              >
                {p.name.slice(0, 1)}
              </motion.span>
              <span className="text-sm font-medium">{p.name}</span>
              {active && <Check className="ml-auto h-4 w-4 text-primary" />}
            </span>
            <span className="mt-1.5 block text-xs text-muted-foreground">{p.tagline}</span>
          </button>
        );
      })}
    </div>
  );
}
