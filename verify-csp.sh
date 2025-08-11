#!/bin/bash

echo "=== CSP Header Verification Script ==="
echo ""

# Production URL
PROD_URL="https://taskagent-web.vercel.app/"

echo "📍 Checking Production Environment: $PROD_URL"
echo "----------------------------------------"

# Get headers
echo "🔍 Fetching security headers..."
curl -sI "$PROD_URL" | grep -E "(Content-Security-Policy|X-Frame-Options|X-Content-Type-Options|X-XSS-Protection|Referrer-Policy|Permissions-Policy)" | while IFS= read -r line; do
    echo "✅ $line"
done

echo ""
echo "📋 Full CSP Header (formatted):"
echo "----------------------------------------"
curl -sI "$PROD_URL" | grep "Content-Security-Policy" | sed 's/Content-Security-Policy: //' | sed 's/;/;\n  /g'

echo ""
echo "=== Verification Complete ==="
echo ""
echo "💡 What to check:"
echo "  1. CSP header is present"
echo "  2. All required directives are included:"
echo "     - default-src 'self'"
echo "     - script-src includes 'unsafe-eval' 'unsafe-inline' (for Next.js)"
echo "     - connect-src includes API endpoints and Supabase"
echo "  3. Other security headers are present"
