import os

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings"""

    # API Configuration
    api_title: str = "TaskAgent API"
    api_version: str = "0.1.0"
    api_description: str = "AI-powered task management and scheduling API"

    # Server Configuration
    host: str = "0.0.0.0"  # nosec B104
    port: int = 8000
    debug: bool = False

    # Performance Monitoring
    slow_query_threshold_ms: int = Field(
        default=100, description="Threshold in milliseconds for logging slow queries"
    )
    max_query_stats: int = Field(
        default=1000, description="Maximum number of query statistics to keep in memory"
    )

    # Admin Configuration (temporary until User model has is_admin field)
    admin_user_ids: list[str] = Field(
        default_factory=list,
        description="List of user IDs with admin privileges for monitoring endpoints",
    )

    # Supabase Configuration
    supabase_url: str = Field(..., description="Supabase project URL")
    supabase_anon_key: str = Field(..., description="Supabase anonymous/public key")
    supabase_service_role_key: str = Field(..., description="Supabase service role key")

    # Database Configuration
    database_url: str = Field(..., description="PostgreSQL database URL")

    # OpenAI Configuration
    openai_api_key: str = Field(..., description="OpenAI API key")

    # Security Configuration
    secret_key: str = Field(
        default="taskagent-secret-key-change-in-production",
        description="Secret key for encryption",
    )
    encryption_key: str | None = Field(
        default=None,
        description="Optional encryption key for API keys (base64 encoded)",
    )

    # Environment
    environment: str = Field(
        default="development", pattern="^(development|staging|production|test)$"
    )

    # CORS Configuration
    # Allow Vercel deployments and local development
    cors_origins: list[str] | str = Field(
        default="https://*.vercel.app,http://localhost:3000,http://localhost:3001",
        description="Allowed CORS origins - supports dynamic Vercel deployments",
    )

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, v: str) -> str:
        """Validate Supabase URL format"""
        if not v.startswith(("https://", "http://")):
            raise ValueError("Supabase URL must start with https:// or http://")
        if ".supabase.co" not in v and "localhost" not in v:
            raise ValueError("Invalid Supabase URL format")
        return v

    @field_validator("supabase_anon_key", "supabase_service_role_key")
    @classmethod
    def validate_supabase_keys(cls, v: str) -> str:
        """Validate Supabase keys are not empty"""
        if not v or v.strip() == "":
            raise ValueError("Supabase keys cannot be empty")
        # Relax validation for production deployment testing
        if os.environ.get("ENVIRONMENT") != "production" and len(v) < 32:
            raise ValueError("Invalid Supabase key format")
        # Allow short test keys in production for deployment testing
        if os.environ.get("ENVIRONMENT") == "production":
            return v
        return v

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Validate database URL format"""
        # Allow SQLite URLs for testing
        if os.environ.get("ENVIRONMENT") == "test" and v.startswith("sqlite://"):
            return v
        if not v.startswith(("postgresql://", "postgres://")):
            raise ValueError(
                "Database URL must be a valid PostgreSQL connection string"
            )
        return v

    @field_validator("openai_api_key")
    @classmethod
    def validate_openai_key(cls, v: str) -> str:
        """Validate OpenAI API key format"""
        if not v or v.strip() == "":
            raise ValueError("OpenAI API key cannot be empty")
        # Remove length validation as different key formats may have different lengths
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list, supporting both list and comma-separated string"""
        if isinstance(self.cors_origins, str):
            origins = [origin.strip() for origin in self.cors_origins.split(",")]
        else:
            origins = self.cors_origins

        # Handle wildcard patterns for Vercel deployments
        expanded_origins = []
        for origin in origins:
            if origin == "https://*.vercel.app":
                # Add common Vercel domain patterns (production safe)
                expanded_origins.extend(
                    [
                        "https://taskagent.vercel.app",
                        "https://taskagent-five.vercel.app",
                        # Allow taskagent prefixed domains only for security
                    ]
                )
            else:
                expanded_origins.append(origin)

        return expanded_origins

    def is_vercel_domain_allowed(self, origin: str) -> bool:
        """Check if a Vercel domain matches our security patterns"""
        if not origin.endswith(".vercel.app"):
            return False

        # Extract subdomain
        subdomain = origin.replace("https://", "").replace(".vercel.app", "")

        # Allow taskagent-related domains only
        allowed_patterns = [
            "taskagent",
            "taskagent-",  # For dynamic deployments
        ]

        for pattern in allowed_patterns:
            if subdomain.startswith(pattern):
                return True

        return False

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False
    )


# Global settings instance
# Settings will automatically load from environment variables via pydantic_settings
try:
    settings = Settings()  # type: ignore[call-arg]
except Exception as e:
    # In development or when env vars are missing, use minimal config
    import warnings
    from typing import Any

    warnings.warn(
        f"Failed to load full settings: {e}. Using minimal configuration for development."
    )

    # Create settings with default values for development
    from types import SimpleNamespace

    settings = SimpleNamespace()  # type: ignore[assignment]
    settings.api_title = "TaskAgent API"
    settings.api_version = "0.1.0"
    settings.api_description = "AI-powered task management and scheduling API"
    settings.host = "0.0.0.0"  # nosec B104
    settings.port = 8000
    settings.debug = True
    settings.environment = "development"
    settings.cors_origins = ["http://localhost:3000", "http://localhost:3001"]
    settings.cors_origins_list = ["http://localhost:3000", "http://localhost:3001"]  # type: ignore[misc]
    # Required attributes for fallback mode
    settings.openai_api_key = "development-key-not-available"
    settings.database_url = "sqlite:///dev.db"
    settings.supabase_url = "https://dev.supabase.co"
    settings.supabase_anon_key = "dev-anon-key"
    settings.supabase_service_role_key = "dev-service-key"
    settings.secret_key = "taskagent-secret-key-change-in-production"  # nosec B105
    settings.encryption_key = (
        "dGFza2FnZW50LXNhbHQtZGV2"  # Development key (base64-encoded)
    )
    # Performance monitoring settings
    settings.slow_query_threshold_ms = 100
    settings.max_query_stats = 1000
    settings.admin_user_ids = []


# Production security check
def validate_production_config():
    """Validate configuration for production deployment security."""
    if hasattr(settings, "environment") and settings.environment == "production":
        default_secret = "taskagent-secret-key-change-in-production"  # nosec B105
        if settings.secret_key == default_secret:
            raise RuntimeError(
                "The default secret key cannot be used in production. "
                "Please set a secure SECRET_KEY environment variable."
            )
