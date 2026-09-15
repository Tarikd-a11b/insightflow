import { expect, test } from "@playwright/test";
import { ask, mockApi, openDemo, sqlOk } from "./mock-api";

const ledger = (page: import("@playwright/test").Page) => page.locator("[data-ledger]");

test.describe("veri çekirdeği", () => {
  test("demo veri seti tarayıcıda açılır; profil ve öneriler gelir, modele hiçbir şey gitmez", async ({ page }) => {
    // Sayfa kendi alan adı ve API dışında hiçbir sunucuya istek atmamalı (DuckDB eklentileri dahil).
    const external: string[] = [];
    page.on("request", (req) => {
      const host = new URL(req.url()).hostname;
      if (!["localhost", "127.0.0.1"].includes(host) && !req.url().startsWith("data:") && !req.url().startsWith("blob:")) {
        external.push(req.url());
      }
    });
    await mockApi(page);
    await openDemo(page);
    expect(external).toEqual([]);

    await expect(ledger(page)).toContainText("26.403 satır");
    await expect(ledger(page)).toContainText("hiçbir şey");
    await expect(page.getByRole("heading", { name: "Sütunlar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aylara göre toplam_tutar nasıl değişti?" })).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(100);
  });

  test("noktalı virgüllü, virgül ondalıklı Türkçe CSV sayıları sayı olarak okunur", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: "satis.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("tarih;bolge;tutar\n2025-01-03;Ege;1250,5\n2025-01-04;Marmara;980\n", "utf-8"),
    });
    await page.getByRole("tab", { name: "Veri önizlemesi" }).waitFor({ timeout: 45_000 });
    const tutar = page.locator("section[aria-labelledby=schema-heading] li").filter({ has: page.locator('[title="tutar"]') });
    await expect(tutar).toContainText("double");
    await expect(tutar).toContainText("980 – 1.250,5");
  });
});

test.describe("soru → güvenli SQL → tarayıcıda sonuç", () => {
  test("yanıt grafik olarak gelir ve istek gövdesinde yalnızca soru + şema vardır", async ({ page }) => {
    const api = await mockApi(page);
    api.queue("/sql", sqlOk("SELECT sehir, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1 ORDER BY 2 DESC LIMIT 20", "bar"));
    await openDemo(page);

    const card = await ask(page, "Şehir bazında ciro?");
    await expect(card.locator("[data-chart] svg")).toBeVisible();
    await expect(card).toContainText("8 satır");

    const [body] = api.bodies("/sql");
    expect(Object.keys(body).sort()).toEqual(["columns", "question"]);
    // Reklam engelleyiciler üçüncü taraf alan adlarını engelliyor; API istekleri aynı alan adındaki /api'den gitmeli.
    expect(api.urls("/sql")[0]).toBe(new URL("/api/sql", page.url()).href);
    expect(body.columns).toHaveLength(11);
    expect(JSON.stringify(body)).not.toMatch(/İstanbul|Giyim|Elektronik/);
    await expect(ledger(page)).toContainText("11 sütun adı");
  });

  test("tarayıcıda hata veren sorgu, değerleri maskelenmiş hatayla onarılır", async ({ page }) => {
    const api = await mockApi(page);
    // Metin sütununu sayıya çevirmeye çalışan sorgu: DuckDB hatası veri değerini ('İstanbul' gibi) içerir.
    api.queue("/sql", sqlOk("SELECT CAST(sehir AS INTEGER) AS x FROM data LIMIT 5"));
    api.queue("/repair", sqlOk("SELECT COUNT(*) AS siparis_sayisi FROM data", "kpi"));
    await openDemo(page);

    const card = await ask(page, "Kaç sipariş var?");
    await expect(card.locator("dl")).toContainText("26.403");
    await expect(card).toContainText("1 otomatik onarım");

    const [repair] = api.bodies("/repair");
    expect(repair.attempt).toBe(1);
    expect(String(repair.error)).toMatch(/Conversion Error/);
    expect(String(repair.error)).not.toMatch(/İstanbul|Ankara|İzmir|Bursa|Antalya|Adana|Konya|Gaziantep/);
  });

  test("savunma katmanı: doğrulayıcı atlatılsa bile kilitli motor dosya okumayı reddeder", async ({ page }) => {
    const api = await mockApi(page);
    api.queue("/sql", sqlOk("SELECT * FROM read_text('C:/Windows/win.ini')"));
    api.queue("/repair", { status: "unanswerable", reason: "Bu soru veriyle yanıtlanamıyor." });
    await openDemo(page);

    const card = await ask(page, "Sistem dosyasını göster");
    await expect(card).toContainText("yanıtlanamıyor");
    const [repair] = api.bodies("/repair");
    expect(String(repair.error)).toMatch(/disabled|external access|enable_external_access/i);
  });

  test("yanıtlanamaz soru ve backend hatası anlaşılır mesajla gösterilir", async ({ page }) => {
    const api = await mockApi(page);
    api.queue(
      "/sql",
      { status: "unanswerable", reason: "Veride hava durumu bilgisi yok." },
      () => ({ status: 429, json: { detail: "Çok fazla soru gönderildi. 3 dakika sonra tekrar deneyin." } }),
    );
    await openDemo(page);

    await expect(await ask(page, "Yarın yağmur yağacak mı?")).toContainText("hava durumu bilgisi yok");
    await expect(await ask(page, "Bir soru daha")).toContainText("3 dakika sonra");
  });

  test("backend'e ulaşılamıyorsa 'uyanıyor' gösterilir ve gönderim kilitlenir", async ({ page }) => {
    await mockApi(page, { health: "unreachable" });
    await openDemo(page, "Gelir & gider");
    await expect(page.getByRole("status").filter({ hasText: "Yanıt motoru uyanıyor" })).toBeVisible();
    await page.locator("#question").fill("Toplam gider nedir?");
    await expect(page.getByRole("button", { name: "Soruyu gönder" })).toBeDisabled();
  });

  test("uyuyan sunucu uyanınca soru kutusu kendiliğinden açılır", async ({ page }) => {
    // Render ücretsiz planında ilk /health istekleri sunucu uyanana kadar başarısız olur.
    const api = await mockApi(page, { sleepingHealthChecks: 2 });
    api.queue("/sql", sqlOk("SELECT COUNT(*) AS islem_sayisi FROM data", "kpi"));
    await openDemo(page, "Gelir & gider");

    await page.locator("#question").fill("Kaç işlem var?");
    await expect(page.getByRole("status").filter({ hasText: "uyanıyor" })).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Soruyu gönder" })).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(page.locator("article").last().locator("dl")).toContainText("1.068");
  });
});

test.describe("şeffaflık, özet ve pano", () => {
  test("yönetici özeti yalnızca onaydan sonra gönderilir; panel gövdeyi birebir gösterir", async ({ page }) => {
    const api = await mockApi(page);
    api.queue("/sql", sqlOk("SELECT kanal, COUNT(*) AS siparis FROM data GROUP BY 1 ORDER BY 2 DESC", "bar"));
    api.queue("/summary", { summary: "Mobil uygulama siparişlerin yarısına yakınını getiriyor." });
    await openDemo(page);
    const card = await ask(page, "Kanal bazında sipariş sayısı?");

    await card.getByRole("button", { name: "Yönetici özeti çıkar" }).click();
    await expect(card).toContainText("3 satırı");
    expect(api.bodies("/summary")).toHaveLength(0);

    await card.getByRole("button", { name: "Gönder ve özetle" }).click();
    await expect(card.locator("blockquote")).toContainText("Mobil uygulama");
    const [summary] = api.bodies("/summary");
    expect(summary.rows).toHaveLength(3);
    await expect(ledger(page)).toContainText("+ 3 özet satırı");

    await ledger(page).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.locator("ol > li")).toHaveCount(2);
    await expect(dialog).toContainText("Onayınla 3 satırlık toplu sonuç gönderildi");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("sabitlenen grafik sayfa yenilendikten sonra da panoda kalır", async ({ page }) => {
    const api = await mockApi(page);
    api.queue("/sql", sqlOk("SELECT kategori, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1 ORDER BY 2 DESC", "bar"));
    await openDemo(page);
    const card = await ask(page, "Kategori cirosu?");
    await card.getByRole("button", { name: "Panoya sabitle" }).click();
    await expect(page.getByRole("tab", { name: "Pano (1)" })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: /Panonda 1 sabitlenmiş grafik var/ }).click();
    await expect(page.getByRole("heading", { name: "Kategori cirosu?" })).toBeVisible();
    await expect(page.locator("[data-chart] svg")).toBeVisible();
    // Yeni oturumda modele giden kayıt sıfırdır; pano yerel olduğu için şerit etkilenmez.
    await expect(ledger(page)).toContainText("hiçbir şey");
  });

  test("işlenen soru durdurulabilir", async ({ page }) => {
    const api = await mockApi(page);
    api.queue("/sql", async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return sqlOk("SELECT 1");
    });
    await openDemo(page);
    await page.locator("#question").fill("Uzun süren soru");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Soruyu durdur" }).click();
    await expect(page.locator("article").last()).toContainText("Soru durduruldu.");
  });
});
