import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle, Info } from 'lucide-react';
import type { Locale } from '../../../../i18n/config';
import { getMessages, getT, type TFunction } from '../../../../i18n/translate';
import { LEGAL_DOCS, type LegalDoc } from '../../../../lib/routing';
import { readLegalOperator, type LegalOperator } from '../../../../lib/legal';
import { publicPageMetadata } from '../../../../lib/seo';
import { CookieSettingsButton } from '../../../../components/public/cookie-consent';
import { resolveLocale } from '../../locale-params';

type Params = Promise<{ locale: string; doc: string }>;

function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

function docText(locale: Locale, doc: LegalDoc) {
  const legal = getMessages(locale).legal;
  return legal[doc];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { doc } = await params;
  if (!isLegalDoc(doc)) return {};
  const text = docText(locale, doc);
  return publicPageMetadata({
    locale,
    path: `/legal/${doc}`,
    title: `${text.title} — ERP Preflight`,
    description: text.metaDescription,
  });
}

function OperatorDetails({ operator, t }: { operator: LegalOperator; t: TFunction }) {
  if (!operator.configured) {
    return (
      <div role="status" data-testid="operator-not-configured" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold text-sm">{t('legal.notConfiguredTitle')}</p>
          <p className="mt-1 text-sm">{t('legal.notConfiguredBody')}</p>
        </div>
      </div>
    );
  }
  const rows: [string, React.ReactNode][] = [
    [t('legal.fields.company'), operator.companyName],
    [
      t('legal.fields.address'),
      <span key="address">
        {operator.address.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>,
    ],
  ];
  if (operator.representative) rows.push([t('legal.fields.representative'), operator.representative]);
  if (operator.register) rows.push([t('legal.fields.register'), operator.register]);
  if (operator.vatId) rows.push([t('legal.fields.vatId'), operator.vatId]);
  rows.push([
    t('legal.fields.email'),
    <a key="email" className="text-primary underline" href={`mailto:${operator.email}`}>
      {operator.email}
    </a>,
  ]);
  if (operator.phone) rows.push([t('legal.fields.phone'), operator.phone]);
  if (operator.responsiblePerson) rows.push([t('legal.fields.responsible'), operator.responsiblePerson]);

  return (
    <dl data-testid="operator-details" className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr] text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold text-foreground">{label}</dt>
          <dd className="text-muted-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function LegalPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();

  const t = getT(locale);
  const legal = getMessages(locale).legal;
  const operator = readLegalOperator();

  return (
    <article className="max-w-3xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">{legal[doc].title}</h1>
      </header>

      {doc !== 'imprint' && doc !== 'cookies' && (
        <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('legal.reviewNotice')}
        </p>
      )}

      {doc === 'imprint' && (
        <>
          <p className="text-sm text-muted-foreground">{legal.imprint.intro}</p>
          <OperatorDetails operator={operator} t={t} />
          <section>
            <h2 className="text-lg font-bold">{legal.imprint.disputeTitle}</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{legal.imprint.disputeBody}</p>
          </section>
        </>
      )}

      {(doc === 'privacy' || doc === 'terms') &&
        legal[doc].sections.map((section, i) => (
          <section key={section.heading}>
            <h2 className="text-lg font-bold">{section.heading}</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{section.body}</p>
            {doc === 'privacy' && i === 0 && (
              <div className="mt-4">
                <OperatorDetails operator={operator} t={t} />
              </div>
            )}
          </section>
        ))}

      {doc === 'subprocessors' && (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">{legal.subprocessors.intro}</p>
          {operator.subprocessors.length === 0 ? (
            <div role="status" data-testid="subprocessors-not-configured" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              {legal.subprocessors.notConfigured}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="p-3 font-semibold">{legal.subprocessors.name}</th>
                    <th scope="col" className="p-3 font-semibold">{legal.subprocessors.purpose}</th>
                    <th scope="col" className="p-3 font-semibold">{legal.subprocessors.region}</th>
                  </tr>
                </thead>
                <tbody>
                  {operator.subprocessors.map((s) => (
                    <tr key={s.name} className="border-t border-border align-top">
                      <td className="p-3 font-medium">{s.name}</td>
                      <td className="p-3 text-muted-foreground">{s.purpose}</td>
                      <td className="p-3 text-muted-foreground">{s.region}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {doc === 'dpa' && (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">{legal.dpa.intro}</p>
          <section>
            <h2 className="text-lg font-bold">{legal.dpa.includesTitle}</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1 text-sm text-muted-foreground">
              {legal.dpa.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          {operator.configured && operator.email ? (
            <a
              href={`mailto:${operator.email}?subject=${encodeURIComponent(legal.dpa.emailSubject)}`}
              className="inline-flex px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600"
            >
              {legal.dpa.requestCta}
            </a>
          ) : (
            <OperatorDetails operator={operator} t={t} />
          )}
        </>
      )}

      {doc === 'cookies' && (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">{legal.cookies.intro}</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="p-3 font-semibold">{legal.cookies.tableName}</th>
                  <th scope="col" className="p-3 font-semibold">{legal.cookies.tablePurpose}</th>
                  <th scope="col" className="p-3 font-semibold">{legal.cookies.tableType}</th>
                  <th scope="col" className="p-3 font-semibold">{legal.cookies.tableDuration}</th>
                </tr>
              </thead>
              <tbody>
                {legal.cookies.items.map((item) => (
                  <tr key={item.name} className="border-t border-border align-top">
                    <td className="p-3 font-mono text-xs">{item.name}</td>
                    <td className="p-3 text-muted-foreground">{item.purpose}</td>
                    <td className="p-3">{legal.cookies.necessary}</td>
                    <td className="p-3 text-muted-foreground">{item.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            <span className="inline-flex px-3 py-2 rounded-lg border border-border font-semibold">
              <CookieSettingsButton label={legal.cookies.manage} />
            </span>
          </p>
        </>
      )}
    </article>
  );
}
