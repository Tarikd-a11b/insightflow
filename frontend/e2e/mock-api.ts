import type { Page, Request } from "@playwright/test";

export const API = "http://localhost:8000";

type Json = Record<string, unknown>;
type Produced = { status?: number; json: Json } | Json;
type Handler = (body: Json) => Produced | Promise<Produced>;

export interface MockApi {
  /** Endpoint'e giden gövdeler, sırayla. */
  bodies: (path: string) => Json[];
  /** Endpoint için sıradaki yanıtları ekler (sırayla tüketilir, sonuncusu tekrar eder). */
  queue: (path: string, ...responses: (Json | Handler)[]) => void;
}

export function sqlOk(sql: string, chart = "table", explanation = "Test sorgusu."): Json {
  return { status: "ok", sql, explanation, chart, limited: false };
}

/** Backend'i taklit eder. /health varsayılan olarak "yapılandırılmış" döner. */
export async function mockApi(page: Page, { health = true }: { health?: boolean | "unreachable" } = {}): Promise<MockApi> {
  const seen = new Map<string, Json[]>();
  const queues = new Map<string, (Json | Handler)[]>();

  await page.route(`${API}/**`, async (route) => {
    const req: Request = route.request();
    const path = new URL(req.url()).pathname;

    if (health === "unreachable") return route.abort("connectionrefused");
    if (path === "/health") return route.fulfill({ json: { status: "ok", llm_configured: health } });

    const body = (req.postDataJSON() ?? {}) as Json;
    seen.set(path, [...(seen.get(path) ?? []), body]);

    const q = queues.get(path) ?? [];
    const next = q.length > 1 ? q.shift()! : q[0];
    if (!next) return route.fulfill({ status: 500, json: { detail: `mock yok: ${path}` } });
    const produced = typeof next === "function" ? await next(body) : next;
    const { status = 200, json } = "json" in produced && typeof produced.json === "object" ? (produced as { status?: number; json: Json }) : { json: produced };
    return route.fulfill({ status, json });
  });

  return {
    bodies: (path) => seen.get(path) ?? [],
    queue: (path, ...responses) => queues.set(path, [...(queues.get(path) ?? []), ...responses]),
  };
}

export async function openDemo(page: Page, title = "E-ticaret satışları") {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("tab", { name: "Veri önizlemesi" }).waitFor({ timeout: 45_000 });
}

export async function ask(page: Page, question: string) {
  await page.locator("#question").fill(question);
  await page.keyboard.press("Enter");
  const card = page.locator("article").filter({ hasText: question }).last();
  await card.locator("[role=status]").first().waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  return card;
}
