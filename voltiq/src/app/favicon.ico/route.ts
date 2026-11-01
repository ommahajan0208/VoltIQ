const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101A29"/><path d="M8 34h16l8-14 8 28 8-14h8" fill="none" stroke="#45DFF5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="20" r="4" fill="#F4BB62"/></svg>`;

export function GET() {
  return new Response(icon, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
