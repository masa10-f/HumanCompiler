const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable gzip compression
  compress: true,
  // Enable React strict mode
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 86400,
    dangerouslyAllowSVG: false,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  // The roadmap image route rasterizes SVG with resvg's native binary and
  // reads the Japanese font files at run time, so ship both with that route.
  serverExternalPackages: ['@resvg/resvg-js'],
  outputFileTracingIncludes: {
    '/api/internal/timeline-image': [
      './node_modules/@expo-google-fonts/noto-sans-jp/400Regular/*.ttf',
      './node_modules/@expo-google-fonts/noto-sans-jp/700Bold/*.ttf',
    ],
  },
}

module.exports = process.env.ANALYZE === 'true' ? withBundleAnalyzer(nextConfig) : nextConfig
