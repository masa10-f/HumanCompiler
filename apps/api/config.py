from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings"""

    # API Configuration
    api_title: str = "TaskAgent API"
    api_version: str = "0.1.0"
    api_description: str = "AI-powered task management and scheduling API"

    # Server Configuration
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # CORS Configuration
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Supabase Configuration
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # Database Configuration
    database_url: str

    # OpenAI Configuration
    openai_api_key: str

    # Environment
    environment: str = "development"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

# Global settings instance
settings = Settings()

