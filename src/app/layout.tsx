import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geist = localFont({
  src: '../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  variable: '--font-geist',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tech workspace · Urban Gabru',
  description: 'A practical workspace for your tech team. Track work, clear blockers, and understand weekly delivery.',
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" className={`${geist.variable} font-sans`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
