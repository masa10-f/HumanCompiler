-- Migration: Add user settings and API usage tracking tables
-- Purpose: Enable user-configurable OpenAI API keys and usage tracking

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    openai_api_key_encrypted TEXT,
    openai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4',
    ai_features_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_settings_user_id_unique UNIQUE (user_id)
);

-- Create index for user_id lookups
CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- Create api_usage_logs table
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint VARCHAR(100) NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
    response_status VARCHAR(20) NOT NULL,
    request_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for api_usage_logs
CREATE INDEX idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX idx_api_usage_logs_request_timestamp ON api_usage_logs(request_timestamp);
CREATE INDEX idx_api_usage_logs_endpoint ON api_usage_logs(endpoint);

-- Add updated_at trigger for user_settings
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE
    ON user_settings FOR EACH ROW EXECUTE PROCEDURE
    update_updated_at_column();
