#!/bin/bash

# TaskAgent API Preview Environment Setup Script
# This script creates the preview Fly.io app and sets up initial configuration

set -e

echo "🚀 Setting up TaskAgent API Preview Environment..."

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl could not be found. Please install it first:"
    echo "   curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in to Fly.io
if ! flyctl auth whoami &> /dev/null; then
    echo "❌ Please log in to Fly.io first: flyctl auth login"
    exit 1
fi

echo "📝 Creating preview app..."

# Create the preview app
flyctl apps create taskagent-api-masa-preview --org personal

echo "🔧 Setting up preview app configuration..."

# Deploy the preview app for the first time (this will fail without secrets, but creates the app)
cd "$(dirname "$0")/.."
flyctl deploy --config fly.preview.toml --remote-only --app taskagent-api-masa-preview || true

echo "✅ Preview environment setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set up GitHub secrets for DATABASE_URL_PREVIEW"
echo "2. Preview deployments will happen automatically on Pull Requests"
echo "3. Preview URL will be: https://taskagent-api-masa-preview.fly.dev"
echo ""
echo "💡 Cost optimization features:"
echo "- Auto-scales to zero after 5 minutes of inactivity"
echo "- Uses smaller instance size (512MB vs 1024MB)"
echo "- Only runs during PR review periods"
echo ""
echo "💰 Expected additional cost: ~$5-10/month (only when actively used)"
