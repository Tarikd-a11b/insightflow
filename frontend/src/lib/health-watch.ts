import type { BackendHealth } from "./api";

/**
 * Backend durumunu izler. Ücretsiz barındırmada (Render) servis boştayken uyur ve ilk istekte 20–50 sn'de
 * uyanır; tek seferlik kontrol bu sürede "ulaşılamıyor" deyip kullanıcıyı kilitli bırakıyordu.
 * Ulaşılamazsa `wakeWindowMs` boyunca aralıklarla yeniden dener ve bu süreyi "uyanıyor" olarak bildirir.
 */

export type HealthState = "checking" | "waking" | Exclude<BackendHealth, never>;

export interface HealthWatchOptions {
  intervalMs?: number;
  wakeWindowMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export function watchHealth(
  check: () => Promise<BackendHealth>,
  onChange: (state: HealthState) => void,
  { intervalMs = 5_000, wakeWindowMs = 90_000, now = Date.now, schedule = setTimeout, cancel = (h) => clearTimeout(h as number) }: HealthWatchOptions = {},
): () => void {
  const started = now();
  let stopped = false;
  let handle: unknown = null;

  const tick = async () => {
    const result = await check();
    if (stopped) return;
    if (result !== "unreachable") {
      onChange(result);
      return;
    }
    if (now() - started < wakeWindowMs) {
      onChange("waking");
      handle = schedule(() => void tick(), intervalMs);
    } else {
      onChange("unreachable");
    }
  };

  onChange("checking");
  void tick();
  return () => {
    stopped = true;
    if (handle !== null) cancel(handle);
  };
}
