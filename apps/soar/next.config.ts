import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@synapcores/app-framework'],
  typedRoutes: true,
};

export default nextConfig;
