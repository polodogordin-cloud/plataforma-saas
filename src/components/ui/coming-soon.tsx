import { Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/card";

/**
 * Placeholder honesto para etapas ainda não implementadas.
 * Deixa claro o que vem e em qual etapa, sem simular funcionalidade.
 */
export function ComingSoon({
  title,
  stage,
  description,
  bullets,
}: {
  title: string;
  stage: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <div className="card animate-pop-in overflow-hidden">
      <div className="flex flex-col items-center px-5 py-9 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <Clock3 className="size-7" aria-hidden="true" />
        </span>
        <Badge tone="warning" className="mt-4">
          {stage}
        </Badge>
        <h2 className="mt-3 text-xl font-semibold text-ink-900">{title}</h2>
        <p className="mt-2 max-w-sm text-[0.95rem] leading-relaxed text-ink-500">
          {description}
        </p>

        {bullets?.length ? (
          <ul className="mt-5 w-full space-y-2 text-left">
            {bullets.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-2.5 rounded-xl bg-ink-50 px-3.5 py-3 text-sm text-ink-600"
              >
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
