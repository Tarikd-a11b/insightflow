import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const apiOrigin = new URL(apiUrl).origin;

/*
 * İçerik Güvenlik Politikası gizlilik iddiasının tarayıcı düzeyindeki güvencesi: `connect-src` yalnızca kendi
 * alan adımıza ve InsightFlow API'sine izin verir. Uygulamada bir hata ya da kötü niyetli bir bağımlılık olsa
 * bile tarayıcı veriyi başka bir sunucuya gönderemez.
 * DuckDB-WASM için `wasm-unsafe-eval`; Next'in satır içi başlatma betikleri ve tema betiği için `unsafe-inline`.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin}${isDev ? " ws://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(apiUrl.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  // Docker imajı için bağımsız sunucu çıktısı; Vercel bu ayarı yok sayar.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // WASM ve worker dosyaları sürümle değişmediği sürece uzun süre önbelleğe alınabilir.
        source: "/duckdb/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }],
      },
    ];
  },
};

export default nextConfig;
