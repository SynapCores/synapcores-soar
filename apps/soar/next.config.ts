import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle so the Docker runtime stage does not
  // have to ship the 585 MB workspace node_modules. Next traces exactly the
  // files the server needs, including the transpiled workspace package below.
  output: 'standalone',
  transpilePackages: ['@synapcores/app-framework'],
  // typedRoutes intentionally off: framework code uses dynamic string
  // routes (sidebars accept user-supplied hrefs) and apps may add
  // routes the framework doesn't know about at build time.
  typedRoutes: false,
};

export default nextConfig;
