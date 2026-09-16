export interface DemoDataset {
  id: string;
  /** İlk dosya ana tablo (`data`), diğerleri ek tablolar olur. */
  files: string[];
  title: string;
  description: string;
  sample: string;
  /** Kartta gösterilecek kısa etiket (ör. "2 tablo"). */
  badge?: string;
  /** Dosyadaki gerçek satır sayısı (çoklu tabloda toplam). Kartta gösterilir. */
  rows: number;
  /** Gerçek kolon sayısı (çoklu tabloda toplam). */
  columns: number;
  /** Dosya biçimi etiketi. */
  format: string;
}

export const DEMO_DATASETS: DemoDataset[] = [
  {
    id: "eticaret",
    files: ["eticaret_satis.parquet"],
    title: "E-ticaret satışları",
    description: "2024–2025 siparişleri: şehir, kategori, kanal, indirim, iade.",
    sample: "Kasım kampanyası hangi kategoriyi büyüttü?",
    rows: 26_403,
    columns: 11,
    format: "parquet",
  },
  {
    id: "saas",
    files: ["saas_musteri_churn.parquet"],
    title: "SaaS müşteri kaybı",
    description: "6.200 müşteri: plan, bölge, destek talebi, NPS, churn.",
    sample: "Hangi planda müşteri kaybı en yüksek?",
    rows: 6_200,
    columns: 11,
    format: "parquet",
  },
  {
    id: "finans",
    files: ["finans_gelir_gider.parquet"],
    title: "Gelir & gider",
    description: "Departman ve kalem bazında iki yıllık işlem kayıtları.",
    sample: "Aylık net kâr nasıl değişti?",
    rows: 1_068,
    columns: 6,
    format: "parquet",
  },
  {
    id: "magaza",
    files: ["siparisler.parquet", "musteriler.parquet"],
    title: "Siparişler + müşteriler",
    description: "13.530 sipariş ve 1.500 müşteri, musteri_id ile birleşiyor.",
    sample: "Hangi segmentteki müşteriler en çok harcıyor?",
    badge: "2 tablo",
    rows: 15_030,
    columns: 11,
    format: "parquet ×2",
  },
];

/** Hazır setlerdeki toplam satır — boş durumda "elinin altındaki veri" ölçüsü. */
export const DEMO_TOTAL_ROWS = DEMO_DATASETS.reduce((sum, d) => sum + d.rows, 0);

export async function fetchDemoFiles(demo: DemoDataset): Promise<File[]> {
  return Promise.all(
    demo.files.map(async (name) => {
      const res = await fetch(`/demo/${name}`);
      if (!res.ok) throw new Error(`Demo veri seti indirilemedi (${res.status}).`);
      return new File([await res.blob()], name);
    }),
  );
}
