import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '../components/navbar';
import { QueryProvider } from '../lib/query/query-provider';
import { CommandPalette } from '../components/command-palette';

export const metadata: Metadata = {
  title: 'ERP Preflight — Enterprise SAP Preflight & Clean Core SaaS',
  description:
    'Production-grade multi-tenant SaaS platform for automated SAP preflight analysis, clean core auditing, migration verification, and release intelligence.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col bg-background text-foreground">
        <QueryProvider>
          <Navbar />
          <CommandPalette />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </QueryProvider>
      </body>
    </html>
  );
}
