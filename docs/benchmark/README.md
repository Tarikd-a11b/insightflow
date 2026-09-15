# Performans ölçümleri

**Tarih:** 15.09.2026
**Makine:** Intel Core i7-1165G7 (4 çekirdek / 8 iş parçacığı), 16 GB RAM, Windows 11

**Veri:** Demo e-ticaret şemasıyla (11 sütun) üretilmiş sentetik parquet dosyaları: 100 bin, 1 milyon ve 5 milyon satır. Üretim betiği: `backend/scripts/generate_bench_data.py`.

**Sorgular:** Uygulamanın ürettiği türden 5 analitik sorgu. İki ölçümde de aynılar.

| Ad | Ne yapıyor |
| --- | --- |
| `aylik_trend` | Aylara göre ciro (`date_trunc` + `GROUP BY`) |
| `kategori_sehir_top20` | Kategori × şehir kırılımında en yüksek 20 |
| `iade_orani` | Kategori bazında oran (`AVG(CASE …)`) |
| `kanal_medyan` | Kanal bazında medyan ve 90. yüzdelik |
| `sehir_basina_lider_kategori` | Pencere fonksiyonu (`ROW_NUMBER() OVER`) ile şehir başına lider kategori |

Her sorgu 1 ısınma koşusu ve ardından 5 ölçüm koşusuyla çalıştırıldı; tablolarda **medyan** değer var. Ham sonuçlar: [`browser.json`](browser.json), [`python.json`](python.json).

## 1. Tarayıcıda (uygulamanın kendisi)

**Betik:** `frontend/scripts/benchmark.mjs`
**Ortam:** Chromium 149, DuckDB-WASM 1.33 (tek iş parçacığı, eh paketi)

Ölçüm gerçek arayüzden geçiyor. Dosya yükleme alanına verilip "Veri önizlemesi" açılana kadar beklenir. Soru kutusuna yazılır. Kartta görünen "sorgu N ms" değeri okunur; bu değer DuckDB'nin sorguyu çalıştırması ile sonucun Arrow'dan JavaScript nesnelerine dönüşümünü kapsar. Yalnızca SQL'i yazan model adımı sabit SQL ile taklit edilir, böylece model gecikmesi ölçüme karışmaz.

| Satır | Dosya | Yükleme + profil | aylik_trend | kategori_sehir_top20 | iade_orani | kanal_medyan | lider_kategori |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100.000 | 1,2 MB | 0,8 sn | 9 ms | 16 ms | 29 ms | 31 ms | 37 ms |
| 1.000.000 | 11,7 MB | 3,0 sn | 59 ms | 108 ms | 60 ms | 137 ms | 112 ms |
| 5.000.000 | 58,3 MB | 11,9 sn | 252 ms | 495 ms | 308 ms | 510 ms | 472 ms |

"Yükleme + profil" şunları kapsar:
- Dosyanın `data` tablosuna alınması
- Motor kilidinin uygulanması ve doğrulanması
- `SUMMARIZE` ile sütun profilinin çıkarılması
- Her sütun için kesin benzersiz değer sayımı
- İlk 100 satırlık önizleme

**Sonuç:** 1 milyon satıra kadar tüm analitik sorgular tarayıcıda **200 ms'nin altında** (59–137 ms). 5 milyon satırda 250–510 ms'ye çıkıyor. 5 milyon satırda yükleme 12 saniye sürüyor ve süreyi büyük ölçüde profil çıkarma belirliyor. Bu boyutta profili örneklemle hesaplamak bir iyileştirme adayı.

## 2. pandas ve DuckDB karşılaştırması (Python, aynı veri ve aynı sorgular)

**Betik:** `backend/scripts/bench_pandas_vs_duckdb.py`
**Sürümler:** Python 3.12, pandas 3.0.5 (pyarrow), DuckDB 1.5.5

İki motor da veriyi belleğe alıyor: pandas'ta DataFrame, DuckDB'de bellek içi tablo. Her motor ve veri boyutu ayrı bir süreçte koşuyor. Bellek, işletim sisteminin ölçtüğü **tepe çalışma kümesi** (peak working set). Yorumlayıcının ve kütüphanelerin kendi yükü de bu değere dahil.

| Satır | Motor | Yükleme | 5 sorgu toplamı | Tepe bellek |
| ---: | --- | ---: | ---: | ---: |
| 100.000 | pandas | 512 ms | 53,8 ms | 122 MB |
| | DuckDB | 126 ms | 38,6 ms | 64 MB |
| 1.000.000 | pandas | 577 ms | 378,3 ms | 319 MB |
| | DuckDB | 141 ms | 92,5 ms | 202 MB |
| 5.000.000 | pandas | 1.222 ms | 1.925,4 ms | 1.046 MB |
| | DuckDB | 422 ms | 432,6 ms | 746 MB |

**Özet:**
- **Sorgu hızı:** DuckDB 1 milyon satırda **4,1 kat**, 5 milyon satırda **4,5 kat** hızlı. Pencere fonksiyonlu sorguda fark 6,8 kat (463,8 → 68,0 ms).
- **Tepe bellek:** DuckDB'de 1 milyon satırda **%37**, 5 milyon satırda **%29**, 100 bin satırda %48 daha düşük.

## Dürüstlük notları

- **Bellek iddiası:** ilk plandaki "bellek tüketimini %80 azalttım" ifadesi bu ölçümle **doğrulanmıyor**. Ölçülen fark %29–48.
- **Tarayıcı ile yerel DuckDB farkı:** tarayıcıdaki DuckDB-WASM tek iş parçacığında çalışıyor ve yerel çok çekirdekli DuckDB'den yaklaşık 5–7 kat yavaş. Örneğin 1 milyon satırda `aylik_trend` yerelde 11 ms, tarayıcıda 59 ms. Bu, verinin cihazdan çıkmaması için ödenen bedel.
- **Tek makine:** sonuçlar tek bir dizüstü bilgisayarda alındı. Mutlak değerler donanıma göre değişir, oranlar daha anlamlı.
- **Windows tuzağı:** ilk koşuda Windows "Uygulama Denetimi" bir pandas DLL'ini engelledi ve bir yükleme 44 saniye sürdü. Bu koşu atıldı; tablolardaki değerler tekrarlanan ikinci koşudan.
