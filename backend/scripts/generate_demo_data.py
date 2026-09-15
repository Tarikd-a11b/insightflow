"""Demo modu için sentetik veri setleri üretir (sabit tohum, tekrarlanabilir): 3 tek tablolu + 1 iki tablolu (JOIN).

Çalıştırma: uv run python scripts/generate_demo_data.py
Çıktı: ../frontend/public/demo/*.parquet
"""

import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

import duckdb

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"
rng = random.Random(42)


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def weighted(options: dict[str, float]) -> str:
    return rng.choices(list(options), weights=list(options.values()))[0]


def ecommerce() -> list[tuple]:
    cities = {"İstanbul": 38, "Ankara": 14, "İzmir": 11, "Bursa": 7, "Antalya": 6, "Adana": 5, "Konya": 4, "Gaziantep": 4}
    categories = {  # kategori: (ağırlık, ortalama birim fiyat)
        "Elektronik": (18, 4200), "Giyim": (26, 650), "Ev & Yaşam": (17, 900),
        "Kozmetik": (16, 380), "Kitap": (10, 160), "Spor": (13, 1100),
    }
    channels = {"Mobil Uygulama": 48, "Web": 34, "Pazaryeri": 18}
    segments = {"Yeni": 35, "Sadık": 45, "Kurumsal": 20}
    rows, oid = [], 100000
    for d in daterange(date(2024, 1, 1), date(2025, 12, 31)):
        growth = 1 + (d - date(2024, 1, 1)).days / 730 * 0.6
        season = 1 + 0.25 * math.sin((d.timetuple().tm_yday - 80) / 365 * 2 * math.pi)
        if d.month == 11 and d.day >= 20:
            season *= 2.4  # Efsane Cuma
        if d.weekday() >= 5:
            season *= 1.2
        for _ in range(int(rng.gauss(26, 5) * growth * season)):
            oid += 1
            cat = rng.choices(list(categories), weights=[v[0] for v in categories.values()])[0]
            price = round(max(40.0, rng.lognormvariate(math.log(categories[cat][1]), 0.45)), 2)
            qty = rng.choices([1, 2, 3, 4], weights=[70, 20, 7, 3])[0]
            disc = rng.choice([0, 0, 0, 0.05, 0.10, 0.15, 0.20])
            if d.month == 11 and d.day >= 20:
                disc = max(disc, 0.20)
            total = round(price * qty * (1 - disc), 2)
            returned = rng.random() < (0.14 if cat == "Giyim" else 0.05)
            rows.append((oid, d, weighted(cities), cat, weighted(channels), weighted(segments), qty, price, disc, total, returned))
    return rows


def saas() -> list[tuple]:
    plans = {"Starter": (55, 49), "Pro": (33, 199), "Enterprise": (12, 1450)}
    regions = {"Türkiye": 40, "Avrupa": 32, "Orta Doğu": 16, "Kuzey Amerika": 12}
    rows = []
    for i in range(1, 6201):
        signup = date(2023, 1, 1) + timedelta(days=rng.randint(0, 900))
        plan = rng.choices(list(plans), weights=[v[0] for v in plans.values()])[0]
        seats = {"Starter": rng.randint(1, 5), "Pro": rng.randint(3, 40), "Enterprise": rng.randint(30, 400)}[plan]
        mrr = round(plans[plan][1] * (seats if plan != "Enterprise" else seats / 20) * rng.uniform(0.9, 1.1), 2)
        tickets = max(0, int(rng.gauss(3 if plan == "Starter" else 6, 3)))
        last_login = max(0, int(rng.expovariate(1 / 9)))
        nps = max(0, min(10, int(rng.gauss(7.2, 2.1))))
        risk = -2.2 + 0.06 * last_login + 0.18 * max(0, tickets - 6) - 0.25 * (nps - 7) - (0.9 if plan == "Enterprise" else 0)
        churned = rng.random() < 1 / (1 + math.exp(-risk))
        churn_date = signup + timedelta(days=rng.randint(30, 600)) if churned else None
        if churn_date and churn_date > date(2025, 12, 31):
            churn_date = date(2025, 12, 31) - timedelta(days=rng.randint(0, 60))
        rows.append((f"C-{i:05d}", signup, plan, weighted(regions), seats, mrr, tickets, last_login, nps, churned, churn_date))
    return rows


def finance() -> list[tuple]:
    income = {"Satış Geliri": (40, 85000), "Danışmanlık Geliri": (12, 42000), "Abonelik Geliri": (25, 18000)}
    expense = {
        "Maaş": ("İnsan Kaynakları", 380000), "Kira": ("Operasyon", 95000), "Pazarlama": ("Pazarlama", 30000),
        "Yazılım Lisansı": ("Bilgi Teknolojileri", 12000), "Seyahat": ("Satış", 7000), "Enerji": ("Operasyon", 16000),
    }
    rows, tid = [], 0
    for d in daterange(date(2024, 1, 1), date(2025, 12, 31)):
        if d.weekday() >= 5:
            continue
        inflation = 1 + (d - date(2024, 1, 1)).days / 365 * 0.38  # yıllık ~%38 fiyat artışı
        for cat, (weight, avg) in income.items():
            for _ in range(rng.choices([0, 1, 2], weights=[100 - weight, weight, weight // 3])[0]):
                tid += 1
                rows.append((tid, d, "Satış", "Gelir", cat, round(rng.lognormvariate(math.log(avg * inflation), 0.5), 2)))
        for cat, (dept, avg) in expense.items():
            monthly = cat in {"Maaş", "Kira"}
            if (monthly and d.day <= 3 and d.weekday() == 0) or (monthly and d.day == 1) or (not monthly and rng.random() < 0.22):
                if monthly and any(r[1].year == d.year and r[1].month == d.month and r[4] == cat for r in rows[-40:]):
                    continue
                tid += 1
                amount = avg * inflation * (rng.uniform(0.97, 1.03) if monthly else rng.lognormvariate(0, 0.6))
                rows.append((tid, d, dept, "Gider", cat, round(amount, 2)))
    return rows


def customers_and_orders() -> tuple[list[tuple], list[tuple]]:
    """İki tablolu JOIN demosu: müşteri özellikleri bir tabloda, harcamalar diğerinde.
    Kendi rastgele üreticisini kullanır; diğer demo dosyalarının içeriği değişmez."""
    r = random.Random(2026)
    cities = {"İstanbul": 34, "Ankara": 15, "İzmir": 12, "Bursa": 9, "Antalya": 8, "Adana": 6, "Konya": 6, "Gaziantep": 5}
    # segment: (ağırlık, ortalama sepet çarpanı, aylık sipariş sıklığı)
    segments = {"Bireysel": (62, 1.0, 0.55), "Kurumsal": (14, 3.4, 1.3), "Öğrenci": (24, 0.6, 0.4)}
    age_groups = {"18-24": 22, "25-34": 34, "35-44": 24, "45-54": 13, "55+": 7}
    categories = {"Elektronik": (18, 3900), "Giyim": (27, 620), "Ev & Yaşam": (17, 880), "Kozmetik": (16, 360), "Kitap": (9, 150), "Spor": (13, 1050)}

    customers, orders = [], []
    for i in range(1, 1501):
        seg = r.choices(list(segments), weights=[v[0] for v in segments.values()])[0]
        signup = date(2023, 6, 1) + timedelta(days=r.randint(0, 900))
        customers.append((f"M-{i:05d}", r.choices(list(cities), weights=list(cities.values()))[0], seg,
                          r.choices(list(age_groups), weights=list(age_groups.values()))[0], signup))

    oid = 500000
    for cid, _city, seg, _age, signup in customers:
        _, basket, freq = segments[seg]
        months = max(1, (date(2025, 12, 31) - max(signup, date(2024, 1, 1))).days // 30)
        for _ in range(int(r.gauss(freq * months, 1.5))):
            oid += 1
            day = max(signup, date(2024, 1, 1)) + timedelta(days=r.randint(0, months * 30))
            if day > date(2025, 12, 31):
                continue
            cat = r.choices(list(categories), weights=[v[0] for v in categories.values()])[0]
            amount = round(max(30.0, r.lognormvariate(math.log(categories[cat][1] * basket), 0.5)), 2)
            orders.append((oid, cid, day, cat, r.choices([1, 2, 3], weights=[75, 18, 7])[0], amount))
    # Gerçekçi bir kusur: siparişlerin küçük bir kısmı müşteri listesinde olmayan (silinmiş) hesaplara ait.
    for _ in range(220):
        oid += 1
        orders.append((oid, f"M-9{r.randint(1000, 9999)}", date(2024, 1, 1) + timedelta(days=r.randint(0, 730)),
                       r.choice(list(categories)), 1, round(r.uniform(80, 900), 2)))
    orders.sort(key=lambda o: (o[2], o[0]))
    return customers, orders


def write(name: str, columns: str, rows: list[tuple]) -> None:
    # executemany satır satır çok yavaş; önce geçici CSV'ye yazıp DuckDB'ye tek seferde okutuyoruz.
    tmp = OUT / f"{name}.tmp.csv"
    with tmp.open("w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)
    con = duckdb.connect()
    con.execute(f"CREATE TABLE t ({columns})")
    con.execute(f"INSERT INTO t SELECT * FROM read_csv('{tmp.as_posix()}', header=false, all_varchar=true)")
    tmp.unlink()
    path = OUT / f"{name}.parquet"
    con.execute(f"COPY t TO '{path.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
    print(f"{path.name}: {len(rows):,} satır, {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write("eticaret_satis",
          "siparis_id BIGINT, siparis_tarihi DATE, sehir VARCHAR, kategori VARCHAR, kanal VARCHAR, musteri_segmenti VARCHAR, "
          "adet INTEGER, birim_fiyat DOUBLE, indirim_orani DOUBLE, toplam_tutar DOUBLE, iade_edildi BOOLEAN",
          ecommerce())
    write("saas_musteri_churn",
          "musteri_id VARCHAR, kayit_tarihi DATE, plan VARCHAR, bolge VARCHAR, koltuk_sayisi INTEGER, aylik_gelir_usd DOUBLE, "
          "destek_talebi INTEGER, son_giristen_gun INTEGER, nps_puani INTEGER, churn_oldu BOOLEAN, churn_tarihi DATE",
          saas())
    write("finans_gelir_gider",
          "islem_id BIGINT, islem_tarihi DATE, departman VARCHAR, islem_turu VARCHAR, kalem VARCHAR, tutar_try DOUBLE",
          finance())
    customers, orders = customers_and_orders()
    write("siparisler",
          "siparis_id BIGINT, musteri_id VARCHAR, siparis_tarihi DATE, kategori VARCHAR, adet INTEGER, tutar DOUBLE",
          orders)
    write("musteriler",
          "musteri_id VARCHAR, sehir VARCHAR, segment VARCHAR, yas_grubu VARCHAR, kayit_tarihi DATE",
          customers)
