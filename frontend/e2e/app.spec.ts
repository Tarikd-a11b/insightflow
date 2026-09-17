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
    await expect(page.getByRole("heading", { name: "Şema ve Sütun Profili" })).toBeVisible();
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
    await page.getByRole("tab", { name: "Veri Tablosu" }).waitFor({ timeout: 45_000 });
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
    // Örnek değer paylaşımı varsayılan olarak kapalı: hiçbir sütunda values yok.
    expect(JSON.stringify(body)).not.toContain('"values"');
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

  test("iki tablolu veri seti: ilişki tarayıcıda bulunur, JOIN tarayıcıda çalışır, modele yalnızca şema ve ilişki gider", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Siparişler \+ müşteriler/ }).click();
    await page.getByRole("tab", { name: "Veri Tablosu" }).waitFor({ timeout: 45_000 });

    // Tablolar ve tarayıcıda hesaplanan ilişki
    const tables = page.getByRole("listbox", { name: "Şeması gösterilecek tablo" });
    await expect(tables.getByRole("option")).toHaveCount(2);
    await expect(page.locator("[data-relationship]")).toContainText("data.musteri_id ↔ musteriler.musteri_id");
    await expect(page.locator("[data-relationship]")).toContainText("%87 eşleşme");
    await expect(page.locator("header").first()).toContainText("+1 tablo");
    await expect(page.locator("[data-ledger]")).toContainText("15.030 satır");
    await expect(page.getByRole("button", { name: /^musteriler tablosundaki .* bazında toplam tutar nedir\?$/ })).toBeVisible();

    // Birleştirmeli soru: SQL tarayıcıdaki DuckDB'de gerçekten JOIN olarak koşar.
    api.queue(
      "/sql",
      sqlOk(
        "SELECT m.segment, ROUND(SUM(d.tutar), 2) AS toplam_tutar FROM data d JOIN musteriler m ON d.musteri_id = m.musteri_id GROUP BY 1 ORDER BY 2 DESC",
        "bar",
      ),
    );
    const card = await ask(page, "Hangi segment en çok harcıyor?");
    await expect(card.locator("[data-chart] svg")).toBeVisible();
    await expect(card).toContainText("3 satır");
    await card.getByRole("tab", { name: "Tablo" }).click();
    await expect(card.locator("tbody tr").first()).toContainText("Kurumsal");

    const [body] = api.bodies("/sql");
    expect((body.tables as { name: string; columns: { name: string }[] }[]).map((t) => t.name)).toEqual(["musteriler"]);
    expect((body.tables as { columns: { name: string }[] }[])[0].columns.map((c) => c.name)).toEqual(["musteri_id", "sehir", "segment", "yas_grubu", "kayit_tarihi"]);
    expect(body.relationships).toEqual([{ left: "data.musteri_id", right: "musteriler.musteri_id" }]);
    expect(JSON.stringify(body)).not.toMatch(/Kurumsal|İstanbul|M-0000/);
    await expect(page.locator("[data-ledger]")).toContainText("11 sütun adı"); // 6 (siparisler) + 5 (musteriler)

    // Tablo seçimi önizlemeyi ve şemayı değiştirir.
    await tables.getByRole("option", { name: /musteriler/ }).click();
    await page.getByRole("tab", { name: "Veri Tablosu" }).click();
    await expect(page.locator("main")).toContainText("musteriler · ilk 100 / 1.500 satır");
    await expect(page.locator("section[aria-labelledby=schema-heading]")).toContainText("yas_grubu");

    // Dosya eklenir ve çıkarılır (motor tüm dosyalarla yeniden kurulur, kilit yeniden uygulanır).
    await page.locator("input[data-add-table]").setInputFiles({
      name: "Kategori Hedefleri.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("kategori,hedef\nElektronik,3000000\nGiyim,900000\n", "utf-8"),
    });
    await expect(tables.getByRole("option")).toHaveCount(3, { timeout: 45_000 });
    await expect(tables).toContainText("kategori_hedefleri");
    await page.getByRole("button", { name: "kategori_hedefleri tablosunu çıkar" }).click();
    await expect(tables.getByRole("option")).toHaveCount(2, { timeout: 45_000 });
  });

  test("veriyi keşfet tarayıcıda içgörü üretir, modele istek atmaz; içgörüden takip sorusu sorulabilir", async ({ page }, testInfo) => {
    const api = await mockApi(page);
    const apiCalls: string[] = [];
    page.on("request", (req) => /\/api\/(sql|repair|summary)/.test(req.url()) && apiCalls.push(req.url()));
    await openDemo(page);

    await page.getByRole("button", { name: /Veriyi keşfet/ }).first().click();
    const insights = page.locator("article").filter({ hasText: "Otomatik keşif · model kullanılmadı" });
    await expect(insights).toHaveCount(5);
    expect(apiCalls).toHaveLength(0);

    const texts = await insights.evaluateAll((els) => els.map((e) => (e.querySelector("h3")?.textContent ?? "") + " — " + (e.querySelector("p.text-sm")?.textContent ?? "")));
    await testInfo.attach("icgoruler.txt", { body: texts.join("\n") });
    expect(texts[0]).toMatch(/^Aylık toplam_tutar trendi — En yüksek ay /);
    expect(texts[1]).toMatch(/payla ilk sırada/);
    expect(texts[2]).toMatch(/iade_edildi oranı en yüksek Giyim/);
    expect(texts[4]).toMatch(/^Veri kalitesi — Birebir tekrar eden kayıt yok/);
    await expect(insights.first().locator("[data-chart] svg")).toBeVisible();

    // Keşif sonrası soru kutusu otomatik olarak bir içgörüye bağlanmaz.
    await expect(page.locator("form")).not.toContainText("Önceki soruyla bağlantılı");

    // İçgörüden devam: modele içgörünün SQL'i bağlam olarak gider.
    api.queue("/sql", sqlOk("SELECT date_trunc('month', siparis_tarihi) AS ay, kanal, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1, 2 ORDER BY 1", "line"));
    await insights.first().getByRole("button", { name: "Buna devam et" }).click();
    await ask(page, "Bunu kanal bazında kır");
    const [body] = api.bodies("/sql");
    expect((body.history as { question: string; sql: string }[])[0]).toMatchObject({ question: "Aylık toplam_tutar trendi", sql: expect.stringContaining("date_trunc") });
  });

  test("takip soruları önceki soru ve SQL'i bağlam olarak gönderir; bağlam kaldırılabilir ve seçilebilir", async ({ page }) => {
    const api = await mockApi(page);
    const sqlA = "SELECT kategori, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1 ORDER BY 2 DESC";
    const sqlB = "SELECT kategori, SUM(toplam_tutar) AS ciro FROM data WHERE YEAR(siparis_tarihi) = 2025 GROUP BY 1 ORDER BY 2 DESC";
    api.queue("/sql", sqlOk(sqlA, "bar"), sqlOk(sqlB, "bar"), sqlOk("SELECT COUNT(*) AS n FROM data", "kpi"), sqlOk(sqlA, "bar"));
    await openDemo(page);

    // İlk soru bağımsızdır.
    await ask(page, "Kategori bazında ciro?");
    expect(api.bodies("/sql")[0]).not.toHaveProperty("history");

    // Varsayılan bağlam: son yanıt.
    await expect(page.locator("form")).toContainText("Önceki soruyla bağlantılı");
    const b = await ask(page, "Sadece 2025");
    expect(api.bodies("/sql")[1].history).toEqual([{ question: "Kategori bazında ciro?", sql: expect.stringContaining("SUM(toplam_tutar)") }]);
    await expect(b).toContainText("“Kategori bazında ciro?” sorusunun devamı");

    // Bağlam kaldırılınca soru bağımsız gider.
    await page.getByRole("button", { name: "Önceki soruyla bağlantıyı kaldır" }).click();
    await ask(page, "Kaç sipariş var?");
    expect(api.bodies("/sql")[2]).not.toHaveProperty("history");

    // Eski bir karttan devam: yalnızca o kartın zinciri gider (B → A).
    await page.locator("article").nth(1).getByRole("button", { name: "Buna devam et" }).click();
    await expect(page.locator("form")).toContainText("Sadece 2025");
    await ask(page, "Bunu grafik yerine tablo olarak ver");
    const history = api.bodies("/sql")[3].history as { question: string }[];
    expect(history.map((h) => h.question)).toEqual(["Kategori bazında ciro?", "Sadece 2025"]);
  });

  test("örnek değerler yalnızca onaylanan sütunlar için ve önizlendikten sonra gönderilir", async ({ page }) => {
    const api = await mockApi(page);
    api.queue("/sql", sqlOk("SELECT islem_turu, SUM(tutar_try) AS toplam FROM data GROUP BY 1", "bar"));
    await openDemo(page, "Gelir & gider");

    await page.getByRole("button", { name: "Örnek değerleri paylaş" }).click();
    const dialog = page.locator("dialog[open]");
    const turu = dialog.locator("label").filter({ hasText: "islem_turu" });
    await expect(turu).toContainText("Gelir");
    await expect(turu).toContainText("Gider");
    // Aday sütunlar: departman (5), islem_turu (2), kalem (9). Departmanı paylaşmıyoruz.
    await dialog.locator("label").filter({ hasText: "departman" }).getByRole("checkbox").uncheck();
    await expect(dialog).toContainText("Modele 11 değer gidecek");
    await dialog.getByRole("button", { name: "Seçilenleri paylaş" }).click();
    await expect(page.locator("form")).toContainText("11 örnek değer");

    await ask(page, "Net kâr nedir?");
    const [body] = api.bodies("/sql");
    const byName = Object.fromEntries((body.columns as { name: string; values?: string[] }[]).map((c) => [c.name, c.values]));
    expect(byName.islem_turu).toEqual(["Gelir", "Gider"]);
    expect(byName.kalem).toHaveLength(9);
    expect(byName.departman).toBeUndefined();
    expect(byName.tutar_try).toBeUndefined();
    await expect(page.locator("[data-ledger]")).toContainText("11 örnek değer");

    // Paylaşım kapatılınca sonraki sorularda değer gitmez.
    await page.getByRole("button", { name: "Örnek değerleri düzenle" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Paylaşmayı kapat" }).click();
    api.queue("/sql", sqlOk("SELECT COUNT(*) AS n FROM data", "kpi"));
    await ask(page, "Kaç işlem var?");
    expect(JSON.stringify(api.bodies("/sql").at(-1))).not.toContain('"values"');
  });

  test("sunucu uyanırken sorulan soru kuyrukta bekler, istek atılmaz ve durdurulabilir", async ({ page }) => {
    await mockApi(page, { health: "unreachable" });
    const sqlRequests: string[] = [];
    page.on("request", (req) => req.url().includes("/api/sql") && sqlRequests.push(req.url()));
    await openDemo(page, "Gelir & gider");
    await expect(page.getByRole("status").filter({ hasText: "Yanıt motoru uyanıyor" })).toBeVisible();

    await page.locator("#question").fill("Toplam gider nedir?");
    await page.keyboard.press("Enter");
    const card = page.locator("article").last();
    await expect(card).toContainText("hazır olunca soru gönderilecek");
    await page.waitForTimeout(1_000);
    expect(sqlRequests).toHaveLength(0);

    await card.getByRole("button", { name: "Durdur" }).click();
    await expect(card).toContainText("Soru durduruldu.");
    expect(sqlRequests).toHaveLength(0);
  });

  test("uyanırken sorulan soru, sunucu uyanınca kendiliğinden gönderilir", async ({ page }) => {
    // Render ücretsiz planında ilk /health istekleri sunucu uyanana kadar başarısız olur (5 sn arayla).
    // 6 başarısız yoklama ≈ 25 sn uyku: paralel koşuda demo yüklemesi uzasa da test "uyanıyor" durumunu yakalar.
    const api = await mockApi(page, { sleepingHealthChecks: 6 });
    api.queue("/sql", sqlOk("SELECT COUNT(*) AS islem_sayisi FROM data", "kpi"));
    await openDemo(page, "Gelir & gider");
    await expect(page.getByRole("status").filter({ hasText: "uyanıyor" })).toBeVisible();

    await page.locator("#question").fill("Kaç işlem var?");
    await page.keyboard.press("Enter");
    const card = page.locator("article").last();
    await expect(card).toContainText("hazır olunca soru gönderilecek");
    expect(api.bodies("/sql")).toHaveLength(0);

    await expect(card.locator("dl")).toContainText("1.068", { timeout: 45_000 });
    expect(api.bodies("/sql")).toHaveLength(1);
    await expect(page.getByRole("status").filter({ hasText: "uyanıyor" })).toHaveCount(0);
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
    const boardTab = page.getByRole("tab", { name: /Panom \(Dashboard\)/ });
    await expect(boardTab).toBeVisible();
    await expect(boardTab).toContainText("1");

    await page.reload();
    await page.getByRole("button", { name: /Panonda 1 sabitlenmiş grafik var/ }).click();
    await expect(page.getByRole("heading", { name: "Kategori cirosu?" })).toBeVisible();
    await expect(page.locator("[data-chart] svg")).toBeVisible();
    // Yeni oturumda modele giden kayıt sıfırdır; pano yerel olduğu için şerit etkilenmez.
    await expect(ledger(page)).toContainText("hiçbir şey");
  });

  test("panodaki analizler PDF rapor olarak tarayıcıda üretilip indirilir", async ({ page }, testInfo) => {
    const api = await mockApi(page);
    api.queue(
      "/sql",
      sqlOk("SELECT kategori, ROUND(AVG(CASE WHEN iade_edildi THEN 1 ELSE 0 END), 4) AS iade_orani FROM data GROUP BY 1 ORDER BY 2 DESC", "bar", "Kategori bazında iade oranı."),
      sqlOk("SELECT date_trunc('month', siparis_tarihi) AS ay, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1 ORDER BY 1", "line", "Aylık ciro."),
      sqlOk("SELECT COUNT(*) AS siparis_sayisi, ROUND(AVG(toplam_tutar), 2) AS ortalama_sepet FROM data", "kpi", "Genel özet."),
    );
    api.queue("/summary", { summary: "Giyim %14 ile en yüksek iade oranına sahip; diğer kategoriler %5–6 aralığında." });
    await openDemo(page);

    for (const q of ["Kategori bazında iade oranı?", "Aylık ciro nasıl değişti?", "Sipariş sayısı ve ortalama sepet?"]) {
      const card = await ask(page, q);
      await card.getByRole("button", { name: "Panoya sabitle" }).click();
      await expect(card.getByRole("button", { name: "Panodan kaldır" })).toBeVisible();
    }
    // Özet sabitlemeden sonra çıkarılsa da panodaki kayda işlenmeli.
    const first = page.locator("article").first();
    await first.getByRole("button", { name: "Yönetici özeti çıkar" }).click();
    await first.getByRole("button", { name: "Gönder ve özetle" }).click();
    await expect(first.locator("blockquote")).toContainText("Giyim");

    const boardTab = page.getByRole("tab", { name: /Panom \(Dashboard\)/ });
    await expect(boardTab).toContainText("3");
    await boardTab.click();
    await expect(page.getByText("Giyim %14 ile en yüksek")).toBeVisible();
    const requestsBefore = api.bodies("/sql").length + api.bodies("/summary").length;

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Raporu indir (PDF)" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^insightflow-rapor-\d{4}-\d{2}-\d{2}\.pdf$/);
    const file = testInfo.outputPath("rapor.pdf");
    await download.saveAs(file);

    const bytes = await import("node:fs").then((fs) => fs.readFileSync(file));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(30_000); // gömülü font + vektörel grafikler
    // Rapor üretimi hiçbir API isteği atmaz.
    expect(api.bodies("/sql").length + api.bodies("/summary").length).toBe(requestsBefore);
    await expect(page.getByRole("button", { name: "Raporu indir (PDF)" })).toBeEnabled();
    await expect(page.getByText("Rapor oluşturulamadı.")).toHaveCount(0);
    if (process.env.REPORT_COPY_TO) await download.saveAs(process.env.REPORT_COPY_TO);
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
