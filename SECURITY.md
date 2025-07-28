# Security Guidelines

## Environment Variables

### Required Environment Variables

All sensitive configuration must be stored in environment variables, never hardcoded:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous/public key  
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (keep secret!)
- `OPENAI_API_KEY` - OpenAI API key
- `DATABASE_URL` - PostgreSQL connection string

### Security Best Practices

1. **Never commit secrets**: Ensure `.env` files are in `.gitignore`
2. **Use strong keys**: All API keys should be generated from official sources
3. **Rotate keys regularly**: Update API keys periodically
4. **Minimal permissions**: Use keys with only necessary permissions
5. **Environment validation**: The application validates all environment variables on startup

### Setting Up Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual values from:
   - Supabase: https://app.supabase.com/project/_/settings/api
   - OpenAI: https://platform.openai.com/api-keys

3. Never share or commit the `.env` file

### Production Deployment

For production deployments:

1. Use environment variable management services (e.g., Vercel env vars, Fly.io secrets)
2. Enable audit logging for API key usage
3. Implement rate limiting
4. Use HTTPS everywhere
5. Enable CORS only for trusted origins

### Reporting Security Issues

If you discover a security vulnerability, please create a private security advisory on GitHub or contact the repository maintainers directly instead of using the public issue tracker.