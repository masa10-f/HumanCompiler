# Supabase Settings for TaskAgent

This document outlines the required Supabase configuration for proper user authentication and email verification.

## Required Supabase Dashboard Settings

### 1. Authentication Settings

**Location**: Authentication > Settings

#### Site URL Configuration
Set the Site URL to your application's URL:
- **Development**: `http://localhost:3000`
- **Production**: `https://taskagent-web.vercel.app` (or your actual domain)

#### Redirect URLs
Add the following URLs to the **Redirect URLs** list:
- **Development**: `http://localhost:3000/auth/callback`
- **Production**: `https://taskagent-web.vercel.app/auth/callback`

### 2. Email Template Configuration

**Location**: Authentication > Email Templates

#### Confirm signup template
The default template should work, but ensure the redirect URL uses the correct variable:
```html
<a href="{{ .ConfirmationURL }}">Confirm your email</a>
```

The `ConfirmationURL` will automatically use the `emailRedirectTo` parameter we set in the `signUp` function.

### 3. Auth Settings Check

**Location**: Authentication > Settings

Ensure the following settings are configured:
- ✅ **Enable email confirmations**: Should be enabled
- ✅ **Disable signup**: Should be disabled (to allow new user registrations)
- ✅ **Enable email change**: Recommended to be enabled
- ✅ **Enable password recovery**: Recommended to be enabled

### 4. User Management

**Location**: Authentication > Users

After fixing the configuration:
1. Test user registration with a valid email
2. Check if the user appears in the Users table with `email_confirmed_at` timestamp after clicking the confirmation link

## Testing Checklist

1. [ ] User can register with a valid email address
2. [ ] Confirmation email is received with correct redirect URL
3. [ ] Clicking the confirmation link redirects to `/auth/callback`
4. [ ] User is successfully redirected to dashboard after confirmation
5. [ ] User can log in with confirmed credentials
6. [ ] User cannot log in before email confirmation (if email confirmation is required)

## Troubleshooting

### Common Issues

1. **"Invalid login credentials" error for newly registered users**
   - Ensure email confirmation is complete
   - Check if user exists in Authentication > Users with `email_confirmed_at` set

2. **Confirmation email shows localhost in production**
   - Verify `NEXT_PUBLIC_APP_URL` environment variable is set correctly in production
   - Check that the correct redirect URLs are configured in Supabase dashboard

3. **Email not being sent**
   - Check Supabase project's email rate limits
   - Verify email template is not disabled
   - Check spam folder

### Environment Variables Checklist

Ensure these environment variables are set:

**Development (.env.local):**
```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Production (Vercel Environment Variables):**
```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_APP_URL=https://taskagent-web.vercel.app
```
