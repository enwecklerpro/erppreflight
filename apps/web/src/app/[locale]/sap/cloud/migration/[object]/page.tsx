import type { Metadata } from 'next';
import { SapObjectPage, sapObjectMetadata } from '../../../../../../components/tools/sap-object-page';
import { resolveLocale } from '../../../../locale-params';

type Params = Promise<{ locale: string; object: string }>;

/**
 * /{locale}/sap/cloud/migration/{object} — exists only where the graph has data:
 * a legacy object (not released / deprecated) with an official successor. Otherwise 404.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { object } = await params;
  return sapObjectMetadata('migration', locale, object.toLowerCase());
}

export default async function CloudMigrationObjectPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { object } = await params;
  return <SapObjectPage kind="migration" locale={locale} slug={object.toLowerCase()} />;
}
