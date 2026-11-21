import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({
  href = "/",
  size = "md",
  className,
  withWordmark = true,
}: {
  href?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  withWordmark?: boolean;
}) {
  const dims = { sm: "size-8", md: "size-9", lg: "size-12" }[size];
  const text = { sm: "text-base", md: "text-lg", lg: "text-2xl" }[size];

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-900 shadow-[0_4px_12px_-4px_rgba(15,146,80,0.6)]",
          dims,
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="size-[62%] text-white" fill="none">
          <path
            d="M7 4v8.5A2.5 2.5 0 0 0 9.5 15v5M7 7.5V9m2.5-5v8.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M16.5 4c1.6 0 2.5 1.7 2.5 4s-.9 3.6-1.8 3.9V20"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {withWordmark && (
        <span className={cn("font-semibold tracking-tight text-ink-900", text)}>
          Menuvo
        </span>
      )}
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="tap-target inline-flex items-center rounded-xl" aria-label="Menuvo — início">
      {content}
    </Link>
  );
}
