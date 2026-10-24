import { insideTelegram, tg } from "./telegram";

/** Local development outside Telegram: ?debugUser=<telegram id> (the API accepts it only outside production). */
const debugUser = import.meta.env.DEV ? new URLSearchParams(location.search).get("debugUser") : null;

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API ${status}`);
  }
}

function headers(): Record<string, string> {
  if (insideTelegram) return { authorization: `tma ${tg.initData}` };
  if (debugUser) return { "x-debug-user": debugUser };
  return {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: headers() });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export const canAuthenticate = insideTelegram || Boolean(debugUser);
