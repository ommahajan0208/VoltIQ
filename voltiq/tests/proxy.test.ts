import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/v1/[...path]/route";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("local API proxy boundary", () => {
  it("keeps the launch token server-side and preserves idempotency", async () => {
    vi.stubEnv("APPLICATION_TOKEN", "test-launch-token");
    const upstream = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          data: { job_id: "j1" },
          meta: { schema_version: "2.0", time_basis: "source_local_naive" },
        }),
      );
    vi.stubGlobal("fetch", upstream);
    const request = new NextRequest("http://127.0.0.1:3000/api/v1/runs", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
        "Idempotency-Key": "unique-job",
      },
      body: JSON.stringify({ dataset_id: "d1" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ path: ["runs"] }),
    });
    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/runs");
    const outgoing = upstream.mock.calls[0][1].headers as Headers;
    expect(outgoing.get("X-Application-Token")).toBe("test-launch-token");
    expect(outgoing.get("Idempotency-Key")).toBe("unique-job");
    expect(await response.text()).not.toContain("test-launch-token");
  });
  it("rejects mutation requests from unrelated origins", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const request = new NextRequest("http://127.0.0.1:3000/api/v1/runs", {
      method: "POST",
      headers: { origin: "https://unrelated.example" },
      body: "{}",
    });
    expect(
      (await POST(request, { params: Promise.resolve({ path: ["runs"] }) }))
        .status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects path traversal before contacting the backend", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect(
      (
        await GET(new NextRequest("http://127.0.0.1:3000/api/v1/test"), {
          params: Promise.resolve({ path: ["..", "file"] }),
        })
      ).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("returns an actionable error without demo fallback when the backend is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private diagnostic path")),
    );
    const response = await GET(
      new NextRequest("http://127.0.0.1:3000/api/v1/datasets"),
      { params: Promise.resolve({ path: ["datasets"] }) },
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("backend_unavailable");
    expect(body.data).toBeUndefined();
    expect(body.error.message).not.toContain("private diagnostic path");
  });
  it("streams registered artifact responses with download metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("csv-data", {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": 'attachment; filename="observations.csv"',
            },
          }),
        ),
    );
    const response = await GET(
      new NextRequest("http://127.0.0.1:3000/api/v1/artifacts/a1/download"),
      { params: Promise.resolve({ path: ["artifacts", "a1", "download"] }) },
    );
    expect(response.headers.get("Content-Disposition")).toContain(
      "observations.csv",
    );
    expect(await response.text()).toBe("csv-data");
  });
});
