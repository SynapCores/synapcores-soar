import type { NextConfig } from 'next';

const ANALYZE = process.env.ANALYZE === 'true';

let nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@synapcores/app-framework'],
  // typedRoutes intentionally off: framework code uses dynamic string
  // routes (sidebars accept user-supplied hrefs) and apps may add
  // routes the framework doesn't know about at build time.
  typedRoutes: false,

  // Bundle size optimization — NFR-10: < 2.5 MB gzipped excluding React Flow
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@xyflow/react',
    ],
  },

  // Server-only packages must not appear in client bundle — NFR-9
  serverExternalPackages: [],
};

if (ANALYZE) {
  // Dynamic import so @next/bundle-analyzer is a dev-only dep
  const withBundleAnalyzer = (await import('@next/bundle-analyzer')).default({
    enabled: true,
    openAnalyzer: false,
  });
  nextConfig = withBundleAnalyzer(nextConfig);
}

export default nextConfig;
