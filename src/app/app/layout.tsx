import { redirect } from "next/navigation";
import { BottomNav } from "@/components/app/bottom-nav";
import { getSessionUser } from "@/lib/data/restaurants";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defesa em profundidade: o middleware já protege, mas o layout confirma.
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/app");

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* pb: espaço para a navegação fixa + área segura do iOS */}
      <div className="pb-[calc(4.25rem+env(safe-area-inset-bottom))]">{children}</div>
      <BottomNav />
    </div>
  );
}
