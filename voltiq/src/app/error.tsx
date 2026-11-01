"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="loading-page">
      <h1>This view could not load.</h1>
      <p>
        Your saved backend artifacts are retained. Try opening the view again.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
