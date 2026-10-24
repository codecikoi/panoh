import { useCallback, useEffect, useState } from "react";
import { apiGet } from "./api";

const cache = new Map<string, unknown>();

export interface ApiState<T> {
  data: T | undefined;
  error: boolean;
  reload: () => void;
}

/** GET with a per-session cache, so switching tabs and months back and forth is instant. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<{ path: string | null; data: T | undefined; error: boolean }>({
    path,
    data: path ? (cache.get(path) as T | undefined) : undefined,
    error: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const cached = cache.get(path) as T | undefined;
    setState({ path, data: cached, error: false });
    if (cached !== undefined && attempt === 0) return;
    apiGet<T>(path)
      .then((data) => {
        cache.set(path, data);
        if (!cancelled) setState({ path, data, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ path, data: undefined, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const reload = useCallback(() => {
    if (path) cache.delete(path);
    setAttempt((n) => n + 1);
  }, [path]);

  return { data: state.path === path ? state.data : undefined, error: state.path === path && state.error, reload };
}
