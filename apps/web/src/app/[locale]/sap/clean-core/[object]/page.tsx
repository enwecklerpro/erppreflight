import type { Metadata } from 'next';
import { SapObjectPage, sapObjectMetadata } from '../../../../../components/tools/sap-object-page';
import { resolveLocale } from '../../../locale-params';

type Params = Promise<{ locale: string; object: string }>;

/** /{locale}/sap/clean-core/{object} — rendered on demand, never generated eagerly (Part 02 §2.8). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { object } = await params;
  return sapObjectMetadata('clean-core', locale, object.toLowerCase());
}

export default async function CleanCoreObjectPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { object } = await params;
  return <SapObjectPage kind="clean-core" locale={locale} slug={object.toLowerCase()} />;
}
