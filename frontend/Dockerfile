# InsightFlow arayüzü — Next.js standalone çıktısı.
# API_UPSTREAM_URL derleme anında /api vekilinin hedefi olarak gömülür; tarayıcı bu adresi hiç görmez.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
ARG API_UPSTREAM_URL=http://localhost:8000
ENV API_UPSTREAM_URL=$API_UPSTREAM_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prebuild: DuckDB-WASM dosyalarını ve eklentilerini public/duckdb altına koyar.
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
