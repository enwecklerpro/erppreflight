import type { Metadata } from 'next';
import { PRIVATE_ROUTE_METADATA } from '../../lib/seo';

export const metadata: Metadata = PRIVATE_ROUTE_METADATA;

export default function AnalyzeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
