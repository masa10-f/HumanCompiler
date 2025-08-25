# Content Security Policy (CSP) Documentation

## Overview
This document explains the Content Security Policy (CSP) configuration for the HumanCompiler web application.

## Current CSP Configuration

The CSP is configured in `vercel.json` with the following directives:

### Policy Directives

```
default-src 'self'
script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live
style-src 'self' 'unsafe-inline'
img-src 'self' data: https:
connect-src 'self' https://humancompiler-api-masa.fly.dev https://humancompiler-api-masa-preview.fly.dev https://*.supabase.co https://vercel.live
font-src 'self' data:
frame-src https://vercel.live
```

## Why 'unsafe-eval' and 'unsafe-inline'?

### Next.js Requirements
These directives are **required** for Next.js compatibility:

1. **'unsafe-eval'** is needed for:
   - Webpack's development mode
   - Dynamic imports and code splitting
   - React DevTools functionality
   - Next.js's runtime optimizations

2. **'unsafe-inline'** is needed for:
   - Next.js's critical CSS injection
   - Runtime-generated styles
   - Styled-jsx and CSS-in-JS solutions
   - Next.js's performance optimizations

### Security Trade-offs

While these directives do weaken CSP protection, they provide:
- ✅ Protection against external script injection
- ✅ Prevention of unauthorized resource loading
- ✅ Restriction of connection destinations
- ✅ Basic XSS attack mitigation

## Why 'https:' in img-src?

The broad HTTPS allowlist is necessary for:
- User-uploaded content from various CDNs
- Third-party service integrations
- Dynamic image sources from APIs
- External avatar services

## Future Improvements (Roadmap)

### Phase 1: Current Implementation ✅
- Basic CSP with Next.js compatibility
- Protection against common attack vectors

### Phase 2: Nonce-based CSP (Issue #55)
- Implement Next.js's built-in CSP support
- Use generateNonce for inline scripts
- Reduce reliance on 'unsafe-inline'

### Phase 3: Strict CSP
- Hash-based allowlisting
- Remove 'unsafe-eval' where possible
- Implement trusted types

### Phase 4: Domain Restrictions
- Restrict img-src to specific CDNs
- Implement strict source lists
- Regular security audits

## Testing CSP

### Browser Console
Check for CSP violations in the browser console:
```javascript
// No errors should appear related to CSP
console.log('CSP Test: Loading resources...');
```

### Verification Script
Use the provided verification script:
```bash
./verify-csp.sh
```

### Manual Testing
1. Open Developer Tools (F12)
2. Navigate to Network tab
3. Reload the page
4. Check response headers for Content-Security-Policy
5. Monitor Console for CSP violations

## Security Considerations

### Current Risks
- 'unsafe-eval' allows dynamic code execution
- 'unsafe-inline' permits inline scripts/styles
- 'https:' allows any HTTPS image source

### Mitigations
- Regular security audits
- Monitoring for CSP violations
- Progressive tightening of policies
- Input validation and sanitization

## References
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Next.js CSP Documentation](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy)
- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
