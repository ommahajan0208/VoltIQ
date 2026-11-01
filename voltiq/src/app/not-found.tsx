import Link from "next/link";
export default function NotFound() {
  return (
    <main className="loading-page">
      <h1>Page not found</h1>
      <p>Return to your energy workspace.</p>
      <Link className="button primary" href="/data">
        Open workspace
      </Link>
    </main>
  );
}
