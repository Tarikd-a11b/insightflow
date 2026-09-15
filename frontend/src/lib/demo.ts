export interface DemoDataset {
  id: string;
  /** İlk dosya ana tablo (`data`), diğerleri ek tablolar olur. */
  files: string[];
  title: string;
  description: string;
  sample: string;
  /** Kartta gösterilecek kısa etiket (ör. "2 tablo"). */
  badge?: string;
}

export const DEMO_DATASETS: DemoDataset[] = [
  {
    id: "eticaret",
    files: ["eticaret_satis.parquet"],
    title: "E-ticaret satışları",
    description: "2024–2025 siparişleri: şehir, kategori, kanal, indirim, iade.",
    sample: "Kasım kampanyası hangi kategoriyi büyüttü?",
  },
  {
    id: "saas",
    files: ["saas_musteri_churn.parquet"],
    title: "SaaS müşteri kaybı",
    description: "6.200 müşteri: plan, bölge, destek talebi, NPS, churn.",
    sample: "Hangi planda müşteri kaybı en yüksek?",
  },
  {
    id: "finans",
    files: ["finans_gelir_gider.parquet"],
    title: "Gelir & gider",
    description: "Departman ve kalem bazında iki yıllık işlem kayıtları.",
    sample: "Aylık net kâr nasıl değişti?",
  },
  {
    id: "magaza",
    files: ["siparisler.parquet", "musteriler.parquet"],
    title: "Siparişler + müşteriler",
    description: "13.530 sipariş ve 1.500 müşteri, musteri_id ile birleşiyor.",
    sample: "Hangi segmentteki müşteriler en çok harcıyor?",
    badge: "2 tablo",
  },
];

export async function fetchDemoFiles(demo: DemoDataset): Promise<File[]> {
  return Promise.all(
    demo.files.map(async (name) => {
      const res = await fetch(`/demo/${name}`);
      if (!res.ok) throw new Error(`Demo veri seti indirilemedi (${res.status}).`);
      return new File([await res.blob()], name);
    }),
  );
}
