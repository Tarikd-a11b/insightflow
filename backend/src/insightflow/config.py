from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str | None = None
    # Virgülle ayrılmış; ilki yoğun/kotalıysa sıradaki denenir.
    # Ücretsiz katmanda kota model başına ayrı işler; zincir kotası dolan modeli atlatır.
    gemini_models: str = "gemini-3.5-flash-lite,gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-2.5-flash"
    # Virgülle ayrılmış izinli kaynaklar (frontend adresleri).
    cors_origins: str = "http://localhost:3000"
    # IP başına: pencere içinde en fazla bu kadar LLM isteği.
    rate_limit_requests: int = 30
    rate_limit_window_seconds: int = 600

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gemini_model_list(self) -> list[str]:
        return [m.strip() for m in self.gemini_models.split(",") if m.strip()]


settings = Settings()
