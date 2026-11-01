import { Suspense } from "react";
import { Shell } from "@/components/shell";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={<main className="loading-page">Loading your workspace…</main>}
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
