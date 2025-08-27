-- Migration: Drop unused api_usage_logs table
-- Purpose: Remove api_usage_logs table after removing API usage dashboard functionality
-- Related: Issue #175 - Remove non-functional API usage dashboard

-- Drop indexes first
DROP INDEX IF EXISTS idx_api_usage_logs_user_id;
DROP INDEX IF EXISTS idx_api_usage_logs_request_timestamp;
DROP INDEX IF EXISTS idx_api_usage_logs_endpoint;

-- Drop the api_usage_logs table
DROP TABLE IF EXISTS api_usage_logs CASCADE;
