import type { NextRequest } from "next/server";
// Loopback proxy keeps the per-launch application token on the Next.js server.
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (path.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === ".."))
    return Response.json(
      { error: { code: "invalid_path", message: "Invalid API path" } },
      { status: 400 },
    );
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    // NextURL normalizes 127.0.0.1 to localhost. Preserve the actual Host header.
    const host = request.headers.get("host") ?? request.nextUrl.host;
    const applicationOrigin = `${request.nextUrl.protocol}//${host}`;
    const localHosts = ["localhost", "127.0.0.1", "[::1]"];
    if (
      !localHosts.includes(new URL(applicationOrigin).hostname) ||
      (origin && origin !== applicationOrigin)
    )
      return Response.json(
        {
          error: {
            code: "invalid_origin",
            message: "This action must come from the local application.",
          },
        },
        { status: 403 },
      );
  }
  const base = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
  const headers = new Headers();
  for (const name of ["content-type", "idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (process.env.APPLICATION_TOKEN)
    headers.set("X-Application-Token", process.env.APPLICATION_TOKEN);
  try {
    const response = await fetch(
      `${base}/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
        ...(!["GET", "HEAD"].includes(request.method)
          ? { duplex: "half" }
          : {}),
      } as RequestInit,
    );
    const outgoing = new Headers();
    for (const name of [
      "content-type",
      "content-disposition",
      "content-length",
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    outgoing.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "backend_unavailable",
          message:
            "The local backend is unavailable. Start FastAPI or explicitly choose the synthetic demonstration.",
        },
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH };
