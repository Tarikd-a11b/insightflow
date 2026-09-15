import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/*
 * Tarayıcı API'ye doğrudan değil, uygulamanın kendi alan adındaki `/api/*` üzerinden gider; Next bunu
 * derleme anında belirlenen API adresine iletir. Neden:
 * - Reklam/izleme engelleyiciler başka alan adına (ör. *.onrender.com) giden istekleri üçüncü taraf sayıp
 *   engelliyordu (net::ERR_BLOCKED_BY_CLIENT); aynı alan adındaki istekleri engellemiyorlar.
 * - CSP `connect-src 'self'` olabiliyor: tarayıcı veriyi uygulamanın kendi sunucusu dışında hiçbir yere gönderemez.
 * Değişken adı geriye uyumluluk için korunuyor; artık yalnızca sunucu tarafında (rewrite hedefi) kullanılıyor.
 */
const apiUpstream = (process.env.API_UPSTREAM_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
new URL(apiUpstream); // Geçersiz adres (ör. yer tutucu metin) derlemeyi anlaşılır biçimde durdursun.

/*
 * İçerik Güvenlik Politikası gizlilik iddiasının tarayıcı düzeyindeki güvencesi.
 * DuckDB-WASM için `wasm-unsafe-eval`; Next'in satır içi başlatma betikleri ve tema betiği için `unsafe-inline`.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Docker imajı için bağımsız sunucu çıktısı; Vercel bu ayarı yok sayar.
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUpstream}/:path*` }];
  },
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
