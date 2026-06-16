import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@synapcores/app-framework'],
  typedRoutes: false,
};

export default nextConfig;
