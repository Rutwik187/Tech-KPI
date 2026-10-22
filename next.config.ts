import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  devIndicators: false,
  // "Tasks" were renamed to "tickets". Old links keep working, with their filters.
  async redirects() {
    return [
      { source: '/tasks', destination: '/tickets', permanent: false },
      { source: '/demo/tasks', destination: '/demo/tickets', permanent: false },
      { source: '/demo', destination: '/demo/dashboard', permanent: false },
    ];
  },
};
export default nextConfig;
