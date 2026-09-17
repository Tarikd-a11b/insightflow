import type { ChartKind } from "./api";
import type { DataEngine } from "./data/engine";
import { PRIMARY_TABLE } from "./data/tables";
import type { DatasetProfile, QueryResult, TableProfile } from "./data/types";
import { pinStore, type Pin } from "./pins";

interface DashboardCard {
  question: string;
  explanation: string;
  sql: string;
  chart: ChartKind;
  summary: string;
}

/**
 * Veri seti şemasını ve dağılımlarını analiz ederek tek tıkla 4 parçalı kurumsal BI Dashboard'u üretir.
 */
export async function generateAutoDashboard(
  engine: DataEngine,
  profile: DatasetProfile,
): Promise<Pin[]> {
  const table = (profile as Partial<TableProfile>).table ?? PRIMARY_TABLE;
  const cols = profile.columns;

  const numerics = cols.filter((c) => c.kind === "numeric" && !c.identifier);
  const temporals = cols.filter((c) => c.kind === "temporal");
  const categoricals = cols.filter((c) => (c.kind === "text" || c.kind === "other") && !c.identifier && c.distinct <= 50);

  const primaryMetric = numerics[0] ?? null;
  const primaryTime = temporals[0] ?? null;
  const primaryCat = categoricals[0] ?? null;
  const secondaryCat = categoricals[1] ?? categoricals[0] ?? null;

  const queries: DashboardCard[] = [];

  // 1. KPI Özeti
  if (primaryMetric) {
    const mName = primaryMetric.name;
    const sql = `SELECT ROUND(SUM("${mName}"), 2) AS "Toplam ${mName}", ROUND(AVG("${mName}"), 2) AS "Ortalama ${mName}", ROUND(MAX("${mName}"), 2) AS "Maksimum ${mName}", COUNT(*) AS "Toplam Kayıt" FROM "${table}"`;
    queries.push({
      question: `Temel Metrikler & Genel Performans Özeti (${profile.name})`,
      explanation: `${profile.name} tablosunun toplam hacim, ortalama değer ve genel işlem sayıları.`,
      sql,
      chart: "kpi",
      summary: `Veri setindeki toplam işlem sayısı ve ${mName} genelinde kümülatif hacim özeti çıkarıldı.`,
    });
  } else {
    const sql = `SELECT COUNT(*) AS "Toplam Kayıt Sayısı", COUNT(DISTINCT "${cols[0]?.name}") AS "Tekil Kayıt" FROM "${table}"`;
    queries.push({
      question: `Genel Hacim & Kayıt Özeti (${profile.name})`,
      explanation: "Tablodaki toplam kayıt ve tekil varlık sayıları.",
      sql,
      chart: "kpi",
      summary: `Veri seti genelinde toplam ${profile.rowCount.toLocaleString("tr-TR")} kayıt tespit edildi.`,
    });
  }

  // 2. Zaman Serisi Trend Çizgisi
  if (primaryTime && primaryMetric) {
    const tName = primaryTime.name;
    const mName = primaryMetric.name;
    const sql = `SELECT strftime('%Y-%m-%d', "${tName}") AS tarih, ROUND(SUM("${mName}"), 2) AS "Toplam ${mName}" FROM "${table}" WHERE "${tName}" IS NOT NULL GROUP BY tarih ORDER BY tarih ASC`;
    queries.push({
      question: `Zaman İçindeki Trend ve Değişim Analizi (${tName})`,
      explanation: `${tName} bazında ${mName} metriklerinin zaman çizgisindeki seyri.`,
      sql,
      chart: "line",
      summary: "Zaman serisi grafiği, belirli dönemlerdeki tepe (peak) ve düşüş eğilimlerini net şekilde ortaya koymaktadır.",
    });
  }

  // 3. Kategori / Segment Dağılımı (Bar Chart)
  if (primaryCat && primaryMetric) {
    const cName = primaryCat.name;
    const mName = primaryMetric.name;
    const sql = `SELECT "${cName}" AS kategori, ROUND(SUM("${mName}"), 2) AS "Toplam ${mName}" FROM "${table}" WHERE "${cName}" IS NOT NULL GROUP BY "${cName}" ORDER BY "Toplam ${mName}" DESC LIMIT 8`;
    queries.push({
      question: `En Yüksek Pay Sahibi ${cName} Dağılımı`,
      explanation: `${cName} bazında toplam ${mName} kırılımı (İlk 8).`,
      sql,
      chart: "bar",
      summary: `En büyük payı alan lider ${cName} segmentleri genel hacmin büyük kısmını domine etmektedir.`,
    });
  } else if (primaryCat) {
    const cName = primaryCat.name;
    const sql = `SELECT "${cName}" AS kategori, COUNT(*) AS "İşlem Adedi" FROM "${table}" WHERE "${cName}" IS NOT NULL GROUP BY "${cName}" ORDER BY "İşlem Adedi" DESC LIMIT 8`;
    queries.push({
      question: `${cName} Segment Dağılımı ve Frekansı`,
      explanation: `${cName} bazında kayıt adetlerinin dağılımı.`,
      sql,
      chart: "bar",
      summary: `Kategorik dağılımda en yoğun işlem gören ilk segmentler listelendi.`,
    });
  }

  // 4. İkincil Segment / Durum Kırılımı
  if (secondaryCat && secondaryCat.name !== primaryCat?.name) {
    const sName = secondaryCat.name;
    const mName = primaryMetric ? primaryMetric.name : null;
    const sql = mName
      ? `SELECT "${sName}" AS segment, ROUND(AVG("${mName}"), 2) AS "Ortalama Değer", COUNT(*) AS "Hacim" FROM "${table}" WHERE "${sName}" IS NOT NULL GROUP BY "${sName}" ORDER BY "Hacim" DESC LIMIT 6`
      : `SELECT "${sName}" AS segment, COUNT(*) AS "Adet" FROM "${table}" WHERE "${sName}" IS NOT NULL GROUP BY "${sName}" ORDER BY "Adet" DESC LIMIT 6`;
    queries.push({
      question: `${sName} Bazında İkincil Segment Analizi`,
      explanation: `${sName} kırılımında işlem yoğunluğu ve ortalamalar.`,
      sql,
      chart: "bar",
      summary: `${sName} bazındaki karşılaştırma segmentler arası performans farkını gösterir.`,
    });
  }

  // Paralel DuckDB sorgularını çalıştır ve Pano'ya sabitle
  const createdPins: Pin[] = [];

  for (const q of queries) {
    try {
      const start = performance.now();
      const res = await engine.query(q.sql);
      const ms = Math.round(performance.now() - start);
      const queryResult: QueryResult = { ...res, ms };

      const pin = await pinStore.add({
        datasetName: profile.name,
        question: q.question,
        explanation: q.explanation,
        sql: q.sql,
        chart: q.chart,
        result: queryResult,
        summary: q.summary,
      });

      createdPins.push(pin);
    } catch {
      // Bir sorgu çalışmazsa diğerlerini engelleme
    }
  }

  return createdPins;
}
