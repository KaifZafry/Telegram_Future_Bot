export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/$/,
  ""
);

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  nextCursor?: string;
  error?: {
    code: string;
    message: string;
    details?: { fieldErrors?: Record<string, string[]> };
  };
}

const request = async <T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Envelope<T>> => {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/api${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  } catch {
    throw new ApiError(
      `Cannot reach the bot API at ${API_URL}. Is the backend running?`,
      0,
      "NETWORK"
    );
  }

  const body = (await response.json().catch(() => ({}))) as Envelope<T>;

  if (!response.ok || !body.success) {
    const fieldErrors = body.error?.details?.fieldErrors;
    const firstFieldError = fieldErrors
      ? Object.entries(fieldErrors).find(([, messages]) => messages.length > 0)
      : undefined;
    const message = firstFieldError
      ? `${firstFieldError[0]}: ${firstFieldError[1][0]}`
      : (body.error?.message ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status, body.error?.code);
  }

  return body;
};

export const api = {
  get: async <T>(path: string): Promise<T> => (await request<T>(path)).data as T,
  page: async <T>(path: string): Promise<{ items: T; nextCursor?: string }> => {
    const body = await request<T>(path);
    return { items: body.data as T, nextCursor: body.nextCursor };
  },
  post: async <T>(path: string, body: unknown = {}): Promise<T> =>
    (await request<T>(path, { method: "POST", body })).data as T,
  put: async <T>(path: string, body: unknown): Promise<T> =>
    (await request<T>(path, { method: "PUT", body })).data as T,
  patch: async <T>(path: string, body: unknown): Promise<T> =>
    (await request<T>(path, { method: "PATCH", body })).data as T,
  delete: async <T>(path: string): Promise<T> =>
    (await request<T>(path, { method: "DELETE" })).data as T
};
