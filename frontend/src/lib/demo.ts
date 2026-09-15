export interface DemoDataset {
  id: string;
  file: string;
  title: string;
  description: string;
  sample: string;
}

export const DEMO_DATASETS: DemoDataset[] = [
  {
    id: "eticaret",
    file: "eticaret_satis.parquet",
    title: "E-ticaret satışları",
    description: "2024–2025 siparişleri: şehir, kategori, kanal, indirim, iade.",
    sample: "Kasım kampanyası hangi kategoriyi büyüttü?",
  },
  {
    id: "saas",
    file: "saas_musteri_churn.parquet",
    title: "SaaS müşteri kaybı",
    description: "6.200 müşteri: plan, bölge, destek talebi, NPS, churn.",
    sample: "Hangi planda müşteri kaybı en yüksek?",
  },
  {
    id: "finans",
    file: "finans_gelir_gider.parquet",
    title: "Gelir & gider",
    description: "Departman ve kalem bazında iki yıllık işlem kayıtları.",
    sample: "Aylık net kâr nasıl değişti?",
  },
];

export async function fetchDemoFile(demo: DemoDataset): Promise<File> {
  const res = await fetch(`/demo/${demo.file}`);
  if (!res.ok) throw new Error(`Demo veri seti indirilemedi (${res.status}).`);
  return new File([await res.blob()], demo.file);
}
