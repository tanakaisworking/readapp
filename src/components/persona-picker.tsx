import { Check } from "lucide-react";
import { PersonaAvatar } from "@/components/persona-avatar";
import { personaAccent, type Persona } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface Props {
  personas: Persona[];
  selected: string;
  onSelect: (id: string) => void;
  speaking?: boolean;
}

export function PersonaPicker({ personas, selected, onSelect, speaking }: Props) {
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
              "rounded-field border p-2.5 text-left transition-all duration-150 hover:-translate-y-px active:translate-y-0",
              active ? "border-primary/45 bg-primary/8" : "border-base-300/80 bg-base-100 hover:border-base-content/20",
            )}
            style={active ? { backgroundColor: `color-mix(in oklab, ${accent} 14%, var(--color-base-100))` } : undefined}
          >
            <span className="flex items-center gap-2">
              <PersonaAvatar accent={accent} size={30} speaking={speaking && active} />
              <span className="text-sm font-medium">{p.name}</span>
              <Check className={cn("ml-auto size-4 text-primary transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" />
            </span>
            <span className="mt-1.5 block text-xs leading-snug text-muted">{p.tagline}</span>
          </button>
        );
      })}
    </div>
  );
}
