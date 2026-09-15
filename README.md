# InsightFlow

Verini tarayıcına bırak, doğal dille sor. Dosya cihazdan çıkmaz: sorgu motoru (DuckDB-WASM) tarayıcıda çalışır, yapay zekâya yalnızca tablonun şeması gider.

Plan ve mimari: [`docs/InsightFlow_Proje_Plani_v2.pdf`](docs/InsightFlow_Proje_Plani_v2.pdf) · Performans: [`docs/benchmark`](docs/benchmark/README.md)

## Durum

| Faz | İçerik | Durum |
| --- | --- | --- |
| 1 | Tarayıcıda veri çekirdeği: CSV/Parquet/Excel yükleme, motor kilidi, profil, örnek sorular, demo veri setleri | ✅ |
| 2 | Güvenli text-to-SQL: şema-only prompt, sqlglot doğrulama + saldırı test seti, self-healing, istek sınırı, soru-cevap akışı | ✅ |
| 3 | Grafik seçici (ECharts: çizgi/çubuk/dağılım/KPI) + onaylı yönetici özeti | ✅ |
| 4 | "Modele ne gitti?" paneli, grafik panosu (IndexedDB), durdurma, backend durumu, boş/hata durumları | ✅ |
| 5 | Playwright E2E, benchmark, CSP, Docker, CI, Render + Vercel yapılandırması | ✅ (canlıya alma bekliyor) |

## Akış

```
Tarayıcı                                   Backend (durumsuz)                Gemini
────────                                   ──────────────────                ──────
dosya → DuckDB-WASM (kilitli)
şema {ad, tip}  + soru  ───────────────▶  POST /sql ──────────────────────▶  yapılandırılmış JSON
                                          sqlglot doğrulama ◀─────────────  {sql, açıklama, grafik}
                                          (red → nedenini modele geri besle, en fazla 3 tur)
onaylı SQL  ◀───────────────────────────
sorgu tarayıcıda koşar
  hata → değerleri maskele → POST /repair (en fazla 3 kez)
sonuç tablosu (satırlar asla sunucuya gitmez)
```

## Performans (özet)

Ayrıntılar ve yöntem: [`docs/benchmark/README.md`](docs/benchmark/README.md). i7-1165G7, 16 GB RAM.

| | 100 bin satır | 1 milyon satır | 5 milyon satır |
| --- | ---: | ---: | ---: |
| Tarayıcıda 5 analitik sorgu (medyan aralığı) | 9–37 ms | 59–137 ms | 252–510 ms |
| Tarayıcıda yükleme + profil | 0,8 sn | 3,0 sn | 11,9 sn |
| Yerel Python: DuckDB / pandas sorgu hızı | 1,4× | 4,1× | 4,5× |
| Yerel Python: tepe bellek, DuckDB'de pandas'a göre | −%48 | −%37 | −%29 |

## Güvenlik

**Tarayıcıda**
- Dosya `data` tablosuna alındıktan sonra `enable_external_access=false` ve `lock_configuration=true` uygulanır. Motor, kilidi doğrulamadan veri setini açmaz. E2E testi: doğrulayıcı atlatılsa bile `read_text(...)` motor tarafından reddedilir.
- **CSP** (`next.config.ts`): `connect-src` yalnızca kendi alan adı ve API. Bir hata ya da kötü niyetli bir bağımlılık olsa bile tarayıcı veriyi başka bir sunucuya gönderemez.
- DuckDB-WASM'ın parquet/json eklentileri derleme sırasında indirilip kendi alan adından sunulur. Varsayılan davranışta çalışma anında `extensions.duckdb.org`'a istek atılıyordu. Bu, CSP eklenince fark edildi ve E2E testiyle kilitlendi: sayfa dış hiçbir adrese istek atmaz.
- Onarım isteğine giden DuckDB hata mesajında tırnak içi değerler ve sayılar maskelenir (`src/lib/sanitize.ts`).

**Backend** (`src/insightflow/validator.py`)
- Tek ifade; kök yalnızca SELECT veya UNION/INTERSECT/EXCEPT.
- Tablo izin listesi: yalnızca `data` ve sorgunun kendi CTE'leri. Şema niteliği, dosya yolu ve tablo fonksiyonu yasak.
- Fonksiyon izin listesi: `read_csv`, `glob`, `getenv`, `current_setting`, `duckdb_*` gibi fonksiyonlar SELECT içinde olsa bile reddedilir.
- LIMIT yoksa eklenir, 1000'den büyükse düşürülür.
- Ek korumalar:
  - Hata mesajları sunucuda da ayrıca temizlenir.
  - IP başına istek sınırı var.
  - Girdi boyutu ve sütun adları doğrulanır.
- `tests/test_validator.py`: 47 saldırı sorgusu (hepsi reddedilmeli) ve 18 gerçekçi analitik sorgu (hepsi kabul edilip gerçek DuckDB'de demo verisi üzerinde çalışmalı).

## Grafikler ve yönetici özeti

- `src/lib/chart-spec.ts`: modelin grafik önerisi yalnızca bir ipucu. Sonucun şekli (tarih/sayı/kategori sütunları) uymuyorsa şekle uygun tür seçilir.
  - Uzun biçimli zaman serileri (ay, kategori, değer) seriye çevrilir. En fazla 4 seri çizilir, fazlası "Diğer"e toplanır.
  - Farklı büyüklükteki ölçüler tek eksende çizilmez.
- Palet: dataviz referans paletinin ilk 4 slotu, uygulamanın açık ve koyu kart yüzeylerinde `validate_palette.js` ile doğrulandı. Yeşil ve çivit arayüzde "cihazda kalan / modele giden" anlamına ayrıldığı için grafiklerde kullanılmaz. Her grafikte tablo görünümü var.
- **Yönetici özeti**, veri sözleşmesinin tek istisnası:
  - Kullanıcı onayı ve gidecek tablonun önizlemesi olmadan istek atılmaz.
  - En fazla 20 satır × 8 sütun gönderilir.
  - Sunucu, sonucu üreten SQL'in toplulaştırılmış olduğunu yeniden doğrular (`summary.py`). `data`'yı okuyan her SELECT GROUP BY veya toplama fonksiyonu içermeli; pencere fonksiyonu ve alt sorgudaki COUNT sayılmaz.

## Şeffaflık ve pano

- **Modele ne gitti?** (`src/lib/outbound-log.ts`): sunucuya giden her istek tek bir `postJson` üzerinden geçer ve gövdesi gönderildiği hâliyle kayda alınır. Üst şeritteki sayılar bu kayıttan türetilir; şeride tıklayınca gövdelerin kendisi açılır.
- **Pano** (`src/lib/pins.ts`): sabitlenen yanıt, sonuç satırlarıyla birlikte yalnızca tarayıcının IndexedDB'sinde saklanır.
- Soru "Durdur" ile iptal edilebilir. Backend'e ulaşılamıyorsa soru kutusu kilitlenir ve nedeni gösterilir.

## Testler

| Katman | Komut | Kapsam |
| --- | --- | --- |
| Backend | `uv run pytest` | 109 test: doğrulayıcı saldırı korpusu, API, özet toplulaştırma kuralı, hata temizleme, istek sınırı |
| Frontend birim | `npm test` | 38 test: grafik seçici, profil, öneri soruları, onarım döngüsü, giden istek kaydı, pano deposu |
| Uçtan uca | `npm run test:e2e` | 11 senaryo, gerçek Chromium + gerçek DuckDB-WASM (backend taklit edilir): dış istek yok, veri sızıntısı yok, motor kilidi, onarım, özet onayı, pano kalıcılığı, durdurma, mobil |
| Model | `uv run python scripts/eval_llm.py` | Gerçek Gemini ile 3 veri setinde 16 soru; SQL gerçek DuckDB'de çalıştırılır |

Son model değerlendirmesi (15.09.2026, gemini-3.5-flash-lite, 16 soru): **14 doğru sonuç, 1 doğru red** ("yarın dolar kaç olacak"), **1 yanlış red** ("aylık net kâr"), 0 çalışmayan SQL.

Yanlış red, yalnızca şema gönderme kararının bilinen bedeli: model `islem_turu` sütununda "Gelir/Gider" değerleri olduğunu göremiyor. Önceki koşularda aynı soruyu doğru yanıtlamıştı, yani sonuç koşudan koşuya değişebiliyor. Plandaki çözüm, düşük kardinaliteli sütunların örnek değerlerini **kullanıcı onayıyla** göndermek; henüz uygulanmadı.

Bir model, JSON içinde çift tırnaklı sütun adını kaçıramayıp kesik SQL döndürdü. Çözüm olarak sade adlar tırnaksız yazdırılıyor ve reddedilen turlardan sonra model zinciri kaydırılıyor. Bu hatayı yakalayan iki soru sete eklendi.

## Çalıştırma

```bash
# Docker ile tek komut
GEMINI_API_KEY=... docker compose up --build      # http://localhost:3000

# veya ayrı ayrı
cd backend && uv sync && uv run uvicorn insightflow.main:app --reload   # http://localhost:8000/docs
cd frontend && npm install && npm run dev                                # http://localhost:3000
```

## Canlıya alma

- **Backend → Render:** `render.yaml` (Docker, Frankfurt, `/health`). `GEMINI_API_KEY` ve `CORS_ORIGINS` panelden girilir.
- **Frontend → Vercel:** kök dizin `frontend`, ortam değişkeni `NEXT_PUBLIC_API_URL=<Render adresi>`. Bu adres CSP'ye de derleme sırasında gömülür.
- **CI** (`.github/workflows/ci.yml`): pytest, lint, tip kontrolü, vitest, production derlemesine karşı Playwright ve iki Docker imajının derlenmesi.

## Yapı

```
frontend/   Next.js 16 + TypeScript + Tailwind + shadcn/ui, DuckDB-WASM, ECharts
  src/lib/data/engine.ts     tarayıcı içi motor (yükle → data tablosu → kilitle)
  src/lib/ask.ts             soru → /sql → tarayıcıda çalıştır → gerekirse /repair
  src/lib/chart-spec.ts      sonuç şekli → grafik tanımı
  src/lib/outbound-log.ts    giden istek kaydı ("Modele ne gitti?")
  e2e/                       Playwright senaryoları
  scripts/benchmark.mjs      tarayıcı performans ölçümü
backend/    FastAPI (Python 3.12, uv)
  src/insightflow/validator.py   AST güvenlik doğrulaması
  src/insightflow/summary.py     yönetici özeti için toplulaştırma kuralı
  src/insightflow/llm.py         Gemini (model zinciri: kota/yoğunlukta sıradakine geçer)
  scripts/                       demo/benchmark verisi, model değerlendirmesi, pandas–DuckDB karşılaştırması
docs/       plan PDF, benchmark sonuçları
```
