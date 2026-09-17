import type { Page, Request } from "@playwright/test";

/** Tarayıcı API'ye uygulamanın kendi alan adındaki /api vekili üzerinden gider (bkz. next.config.ts). */
export const API_PATTERN = "**/api/**";

type Json = Record<string, unknown>;
type Produced = { status?: number; json: Json } | Json;
type Handler = (body: Json) => Produced | Promise<Produced>;

export interface MockApi {
  /** Endpoint'e giden gövdeler, sırayla. */
  bodies: (path: string) => Json[];
  /** Endpoint'e giden isteklerin tam adresleri. */
  urls: (path: string) => string[];
  /** Endpoint için sıradaki yanıtları ekler (sırayla tüketilir, sonuncusu tekrar eder). */
  queue: (path: string, ...responses: (Json | Handler)[]) => void;
}

export function sqlOk(sql: string, chart = "table", explanation = "Test sorgusu."): Json {
  return { status: "ok", sql, explanation, chart, limited: false };
}

/** Backend'i taklit eder. /health varsayılan olarak "yapılandırılmış" döner. */
export async function mockApi(
  page: Page,
  {
    health = true,
    sleepingHealthChecks = 0,
  }: {
    health?: boolean | "unreachable";
    /** Uyuyan ücretsiz sunucuyu taklit eder: ilk N /health isteği bağlantı hatası verir. */
    sleepingHealthChecks?: number;
  } = {},
): Promise<MockApi> {
  const seen = new Map<string, Json[]>();
  const seenUrls = new Map<string, string[]>();
  const queues = new Map<string, (Json | Handler)[]>();
  let healthChecks = 0;

  await page.route(API_PATTERN, async (route) => {
    const req: Request = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");

    if (health === "unreachable") return route.abort("connectionrefused");
    if (path === "/health") {
      if (healthChecks++ < sleepingHealthChecks) return route.abort("connectionrefused");
      return route.fulfill({ json: { status: "ok", llm_configured: health } });
    }

    const body = (req.postDataJSON() ?? {}) as Json;
    seen.set(path, [...(seen.get(path) ?? []), body]);
    seenUrls.set(path, [...(seenUrls.get(path) ?? []), req.url()]);

    const q = queues.get(path) ?? [];
    const next = q.length > 1 ? q.shift()! : q[0];
    if (!next) return route.fulfill({ status: 500, json: { detail: `mock yok: ${path}` } });
    const produced = typeof next === "function" ? await next(body) : next;
    const { status = 200, json } = "json" in produced && typeof produced.json === "object" ? (produced as { status?: number; json: Json }) : { json: produced };
    return route.fulfill({ status, json });
  });

  return {
    bodies: (path) => seen.get(path) ?? [],
    urls: (path) => seenUrls.get(path) ?? [],
    queue: (path, ...responses) => queues.set(path, [...(queues.get(path) ?? []), ...responses]),
  };
}

export async function openDemo(page: Page, title = "E-ticaret satışları") {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("tab", { name: "Veri Tablosu" }).waitFor({ timeout: 45_000 });
}

export async function ask(page: Page, question: string) {
  await page.locator("#question").fill(question);
  await page.keyboard.press("Enter");
  const card = page.locator("article").filter({ hasText: question }).last();
  await card.locator("[role=status]").first().waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  return card;
}
