import type { Metadata } from 'next';
import { PRIVATE_ROUTE_METADATA } from '../../lib/seo';

/** Authenticated segment: noindex. Public children (knowledge-graph/lookup) override robots explicitly. */
export const metadata: Metadata = PRIVATE_ROUTE_METADATA;

export default function PrivateRouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
