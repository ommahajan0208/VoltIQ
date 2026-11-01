import { Suspense } from "react";
import { Landing } from "@/features/landing";
export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="loading-page">Loading VoltIQ…</main>
      }
    >
      <Landing />
    </Suspense>
  );
}
