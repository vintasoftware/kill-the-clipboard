/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
  serverExternalPackages: ['@libsql/client', '@prisma/client', '@prisma/adapter-libsql'],
};

export default nextConfig;
