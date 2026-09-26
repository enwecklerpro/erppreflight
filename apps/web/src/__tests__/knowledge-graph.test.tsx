import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../test/render';
import { SupportStateBadge, TrustLevelBadge } from '../components/knowledge-graph/badges';
import { ObjectDetailView, objectHref } from '../components/knowledge-graph/object-detail';
import { NotificationItem } from '../components/notifications/notification-item';
import { LookupResultSchema, ObjectDetailSchema, NotificationPageSchema } from '../lib/knowledge-graph';

// Shape captured from the live API (GET /knowledge-graph/public/objects/TABL/BSEG), trimmed.
const BSEG_DETAIL = {
  object: {
    id: 'b1', objectType: 'TABLE', sapObjectType: 'TABL', objectKey: 'BSEG', tadirObject: 'TABL', tadirObjName: 'BSEG',
    displayName: null, description: null, applicationComponent: 'FI-GL-2CL', softwareComponent: 'SAPSCORE', scope: 'GLOBAL',
    reviewStatus: 'PUBLISHED',
  },
  aliases: [],
  states: [
    {
      productCode: 'SAP_S4HANA', productName: 'SAP S/4HANA / SAP Cloud ERP', editionCode: 'CLOUD_PRIVATE',
      editionName: 'SAP Cloud ERP Private', releaseId: 'r1', releaseCode: '2023 FPS03', releaseLabel: 'SAP S/4HANA 2023 FPS03',
      isRolling: false, scheme: 'RELEASE_CONTRACT', state: 'notToBeReleased', supportState: 'NOT_RELEASED', cleanCoreLevel: null,
      successorClassification: 'oneObject', successorConcept: null,
      successors: [{ sapObjectType: 'CDS_STOB', objectKey: 'I_OPERATIONALACCTGDOCITEM', objectId: 's1' }],
      labels: [], softwareComponent: 'S4CORE', applicationComponent: 'FI', confidenceClass: 'VERIFIED', confidenceScore: 1,
      scope: 'GLOBAL',
      evidence: { sourceId: 'e1', title: 'Cloudification Repository — released APIs, SAP S/4HANA 2023 FPS03', trustLevel: 'OFFICIAL_REPOSITORY', url: 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfo_PCE2023_3.json' },
      validFromSnapshotSeq: 1,
    },
  ],
  replaces: [],
  relationships: [],
  evidenceSources: [
    { id: 'e1', title: 'Cloudification Repository', trustLevel: 'OFFICIAL_REPOSITORY', url: 'https://raw.githubusercontent.com/x.json',
      publisher: 'SAP SE', lastRetrievedAt: '2026-09-26T00:55:18.768Z', sha256: 'ab'.repeat(32), etag: 'W/"x"' },
  ],
  history: [],
  snapshot: { id: 'snap', seq: 1, adapterId: 'SAP_CLOUDIFICATION_REPOSITORY', contentSha256: 'cd'.repeat(32), parserVersion: 'cloudification-normalizer/1.0.0', publishedAt: '2026-09-26T00:56:00.000Z' },
  seo: { indexable: true, reasons: [] },
};

describe('knowledge graph UI', () => {
  it('support-state badges carry text and an accessible label (not color alone)', () => {
    render(<SupportStateBadge state="NOT_RELEASED" />);
    const badge = screen.getByLabelText('Support state: Not released');
    expect(badge).toHaveTextContent('Not released');
    render(<SupportStateBadge state="CLASSIC_API" level="B" />);
    expect(screen.getByLabelText('Support state: Classic API, clean core level B')).toBeInTheDocument();
  });

  it('trust-level badges distinguish official from third-party evidence', () => {
    render(<TrustLevelBadge level="OFFICIAL_REPOSITORY" />);
    render(<TrustLevelBadge level="THIRD_PARTY" />);
    expect(screen.getByLabelText('Evidence trust level: Official repository')).toBeInTheDocument();
    expect(screen.getByLabelText('Evidence trust level: Third party')).toBeInTheDocument();
  });

  it('renders release states, successor navigation and provenance for an object', () => {
    const detail = ObjectDetailSchema.parse(BSEG_DETAIL);
    render(<ObjectDetailView detail={detail} mode="app" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BSEG');
    expect(screen.getByText('SAP S/4HANA 2023 FPS03')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /I_OPERATIONALACCTGDOCITEM/ });
    expect(link).toHaveAttribute('href', '/knowledge-graph/objects/s1');
    expect(screen.getByText(/SHA-256/)).toBeInTheDocument();
  });

  it('public mode links to public object pages, never to tenant routes', () => {
    expect(objectHref('public', { id: 'x', sapObjectType: 'CDS_STOB', objectKey: 'I_PRODUCT' })).toBe(
      '/knowledge-graph/lookup/CDS_STOB/I_PRODUCT'
    );
  });

  it('rejects contract drift in lookup responses', () => {
    expect(LookupResultSchema.safeParse({ query: 'x', snapshot: null, results: [{ id: 1 }] }).success).toBe(false);
  });

  it('notification items show severity as text and unread state explicitly', () => {
    const page = NotificationPageSchema.parse({
      items: [
        { id: 'n1', eventType: 'release_watch.changed', severity: 'MEDIUM', title: 'New deprecation: I_PRODUCT (CDS_STOB)', body: '',
          link: '/knowledge-graph/watches?watch=w', projectId: null, readAt: null, createdAt: '2026-09-26T01:00:00.000Z' },
      ],
      nextBefore: null,
      unreadCount: 1,
    });
    render(<ul><NotificationItem n={page.items[0]} onToggleRead={() => undefined} /></ul>);
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByLabelText('Severity: Medium')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark “New deprecation/ })).toBeInTheDocument();
  });
});
