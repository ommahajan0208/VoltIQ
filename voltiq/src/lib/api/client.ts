import createClient from "openapi-fetch";
import type { paths } from "./generated";
import type { Envelope, Filters } from "../types";
export const client = createClient<paths>({ baseUrl: "" });
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
function unwrap<T>(result: {
  data?: unknown;
  error?: unknown;
  response: Response;
}): Envelope<T> {
  if (!result.response.ok) {
    const e = result.error as {
      error?: { message?: string; details?: unknown; request_id?: string };
    };
    throw new ApiError(
      e?.error?.message ??
        `Local API request failed (${result.response.status})`,
      result.response.status,
      e?.error?.details,
    );
  }
  const body = result.data as Envelope<T>;
  if (!body || !("data" in body) || !body.meta)
    throw new ApiError(
      "The API response does not match the expected envelope. Check the integration contract.",
      502,
    );
  return body;
}
async function customGet<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<Envelope<T>> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const response = await fetch(`${path}?${query.toString()}`, { signal });
  const result = await response.json();
  return unwrap<T>({ response, ...(response.ok ? { data: result } : { error: result }) });
}export async function readApi<T>(
  resource: string,
  f: Filters,
  signal?: AbortSignal,
  id?: string,
): Promise<Envelope<T>> {
  const range = { from: f.from || undefined, to: f.to || undefined };
  const runPath = { id: id ?? f.run };
  const detector = f.detector === "chronos_residual" ? "residual" :
    f.detector === "statistical" ? "slot_mad" : f.detector;
  const sort = f.sort === "newest" ? "start" :
    f.sort === "score" ? "peak_score" :
    f.sort === "duration" ? "duration_minutes" : f.sort;
  switch (resource) {
    case "datasets":
      return unwrap<T>(await client.GET("/api/v1/datasets", { signal }));
    case "runs":
      return unwrap<T>(
        await client.GET("/api/v1/runs", {
          params: { query: { dataset: f.dataset } },
          signal,
        }),
      );
    case "dataset":
      return unwrap<T>(
        await client.GET("/api/v1/datasets/{id}", {
          params: { path: { id: f.dataset } },
          signal,
        }),
      );
    case "run":
      return unwrap<T>(await client.GET("/api/v1/runs/{id}", { params: { path: runPath }, signal }));
    case "peaks":
      return customGet<T>(`/api/v1/datasets/${encodeURIComponent(f.dataset)}/peaks`, {
        from: f.from || undefined, to: f.to || undefined, dataset_version: f.version || undefined,
        percentile: 0.99, min_duration_minutes: 15, gap_minutes: 15,
      }, signal);
    case "recommendations":
      return customGet<T>(`/api/v1/runs/${encodeURIComponent(f.run)}/recommendations`, {
        from: f.from || undefined, to: f.to || undefined,
        percentile: 0.99, min_duration_minutes: 15, gap_minutes: 15,
      }, signal);
    case "series":
      return unwrap<T>(
        await client.GET("/api/v1/datasets/{id}/series", {
          params: { path: { id: f.dataset }, query: {
            ...range, dataset_version: f.version || undefined,
            channel: f.channel, max_buckets: 2000,
          } },
          signal,
        }),
      );
    case "profiles":
      return unwrap<T>(
        await client.GET("/api/v1/datasets/{id}/profiles", {
          params: { path: { id: f.dataset }, query: {
            ...range, dataset_version: f.version || undefined,
          } },
          signal,
        }),
      );
    case "quality":
      return unwrap<T>(
        await client.GET("/api/v1/datasets/{id}/quality", {
          params: { path: { id: f.dataset } },
          signal,
        }),
      );
    case "overview":
      return unwrap<T>(
        await client.GET("/api/v1/runs/{id}/overview", {
          params: { path: runPath, query: { ...range, scope: f.scope } }, signal,
        }),
      );
    case "scores":
      return unwrap<T>(
        await client.GET("/api/v1/runs/{id}/scores", {
          params: { path: runPath, query: { ...range,
            detector: detector === "all" ? undefined : detector || undefined,
          } }, signal,
        }),
      );
    case "events":
      return unwrap<T>(
        await client.GET("/api/v1/runs/{id}/events", {
          params: { path: runPath, query: { ...range,
            detector: detector === "all" ? undefined : detector || undefined,
            direction: f.direction === "all" ? undefined : f.direction || undefined,
            review: f.review === "all" ? undefined : f.review || undefined,
            sort: sort || undefined, cursor: f.cursor || undefined,
            min_peak_score: f.min_score ? Number(f.min_score) : undefined,
          } }, signal,
        }),
      );
    case "event":
      return unwrap<T>(await client.GET("/api/v1/events/{id}", { params: { path: runPath }, signal }));
    case "forecasts":
      return unwrap<T>(
        await client.GET("/api/v1/runs/{id}/forecasts", {
          params: { path: runPath, query: {
            horizon: f.horizon, model: f.model || undefined,
            origin: f.origin || undefined,
          } }, signal,
        }),
      );
    case "metrics":
      return unwrap<T>(
        await client.GET("/api/v1/runs/{id}/metrics", {
          params: { path: runPath },
          signal,
        }),
      );
    case "jobs":
      return unwrap<T>(await client.GET("/api/v1/jobs", { signal }));
    case "job":
      return unwrap<T>(await client.GET("/api/v1/jobs/{id}", { params: { path: runPath }, signal }));
    case "report":
      return unwrap<T>(await client.GET("/api/v1/reports/{id}", { params: { path: runPath }, signal }));
    default:
      throw new Error("Unsupported resource");
  }
}
const pendingKeys = new Map<string, string>();
export async function mutateApi<T>(
  path: string,
  body: unknown,
  method = "POST",
  key?: string,
): Promise<T> {
  const serialized = JSON.stringify(body);
  const fingerprint = method + ":" + path + ":" + serialized;
  const effectiveKey = key ? (pendingKeys.get(fingerprint) ?? key) : undefined;
  if (effectiveKey) pendingKeys.set(fingerprint, effectiveKey);
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(effectiveKey ? { "Idempotency-Key": effectiveKey } : {}),
    },
    body: serialized,
  });
  const result = await response.json();
  const data = unwrap<T>({
    response,
    ...(response.ok ? { data: result } : { error: result }),
  }).data;
  pendingKeys.delete(fingerprint);
  return data;
}
export async function uploadApi(
  file: File,
): Promise<import("../types").Upload> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/v1/datasets/uploads", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  const result = await response.json();
  return unwrap<import("../types").Upload>({
    response,
    ...(response.ok ? { data: result } : { error: result }),
  }).data;
}

