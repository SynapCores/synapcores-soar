import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@synapcores/app-framework'],
  // typedRoutes intentionally off: framework code uses dynamic string
  // routes (sidebars accept user-supplied hrefs) and apps may add
  // routes the framework doesn't know about at build time.
  typedRoutes: false,
};

export default nextConfig;
