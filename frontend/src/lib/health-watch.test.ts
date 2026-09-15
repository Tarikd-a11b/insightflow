import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendHealth } from "./api";
import { watchHealth, type HealthState } from "./health-watch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function sequence(...results: BackendHealth[]) {
  return vi.fn(async () => (results.length > 1 ? results.shift()! : results[0]));
}

describe("watchHealth", () => {
  it("uyuyan sunucu uyanana kadar 'waking' der, sonra 'ok' olur ve durur", async () => {
    const states: HealthState[] = [];
    const check = sequence("unreachable", "unreachable", "ok");
    watchHealth(check, (s) => states.push(s), { intervalMs: 5_000, wakeWindowMs: 90_000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(states).toEqual(["checking", "waking", "waking", "ok"]);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("uyanma penceresi dolarsa 'unreachable' der ve denemeyi bırakır", async () => {
    const states: HealthState[] = [];
    const check = sequence("unreachable");
    watchHealth(check, (s) => states.push(s), { intervalMs: 10_000, wakeWindowMs: 25_000 });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(states.at(-1)).toBe("unreachable");
    expect(check).toHaveBeenCalledTimes(4); // 0, 10, 20 sn uyanıyor; 30 sn'de pencere dolu
  });

  it("anahtar tanımsızsa beklemeden bildirir; durdurulunca yeni deneme yapmaz", async () => {
    const states: HealthState[] = [];
    watchHealth(sequence("unconfigured"), (s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(["checking", "unconfigured"]);

    const check = sequence("unreachable");
    const stop = watchHealth(check, () => {});
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
