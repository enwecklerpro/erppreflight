import { describe, it, expect } from 'vitest';
import { getT } from '../i18n/translate';
import { localizeNotification } from '../lib/notification-text';
// Contract: the web recognizes exactly what the API renderer produces.
import { renderNotification } from '../../../api/src/modules/notifications/notification-renderer';

const tDe = getT('de');
const tEn = getT('en');
const P = '11111111-1111-4111-8111-111111111111';

function rendered(eventType: string, payload: Record<string, unknown>) {
  const r = renderNotification(eventType, P, payload);
  if (!r) throw new Error('not rendered');
  return { eventType, title: r.title, body: r.body };
}

describe('localizeNotification (server-rendered notifications in German)', () => {
  it('keeps the stored English text in the English UI', () => {
    const n = rendered('analysis.completed', { status: 'COMPLETED', totalFindings: 3, engineTypes: ['OPD_GUARD'], targetRelease: 'S4H_2023', projectId: P });
    expect(localizeNotification(n, tEn)).toEqual({ title: n.title, body: n.body });
  });

  it('renders analysis notifications in German', () => {
    const done = localizeNotification(
      rendered('analysis.completed', { status: 'PARTIAL', totalFindings: 1, engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'], targetRelease: 'S4H_2023', projectId: P }),
      tDe
    );
    expect(done.title).toBe('Analyse teilweise abgeschlossen: 1 Befund');
    expect(done.body).toBe('Engines: OPD_GUARD, FORM_DOCTOR. Ziel-Release: S4H_2023.');
    const failed = localizeNotification(rendered('analysis.failed', { projectId: P }), tDe);
    expect(failed.title).toBe('Analyse fehlgeschlagen');
    expect(failed.body).toMatch(/^Die Analyse konnte nicht abgeschlossen werden/);
    // Free-text failure reasons from the service are shown as stored.
    expect(localizeNotification(rendered('analysis.failed', { reason: 'Engine timeout' }), tDe).body).toBe('Engine timeout');
  });

  it('renders critical findings in German', () => {
    const both = localizeNotification(rendered('finding.critical', { blockerCount: 2, criticalCount: 1, engines: ['CLEAN_CORE_OBJECT_GUARD'] }), tDe);
    expect(both.title).toBe('2 Blocker-Befunde und 1 kritischer Befund erkannt');
    expect(both.body).toBe('Engines: CLEAN_CORE_OBJECT_GUARD. Prüfen Sie diese vor dem nächsten Release-Gate.');
    const one = localizeNotification(rendered('finding.critical', { blockerCount: 0, criticalCount: 3, engines: [] }), tDe);
    expect(one.title).toBe('3 kritische Befunde erkannt');
    expect(one.body).toBe('Engines: –. Prüfen Sie diese vor dem nächsten Release-Gate.');
  });

  it('renders release watch changes in German', () => {
    const change = { eventType: 'GAP_OPENED', objectKey: 'BKPF', sapObjectType: 'TABL', releaseLabel: '2508', previous: { supportState: 'RELEASED' }, current: null };
    const single = localizeNotification(rendered('release_watch.changed', { changes: [change], label: 'FI' }), tDe);
    expect(single.title).toBe('Lücke geöffnet: BKPF (TABL) in 2508');
    expect(single.body).toBe('Lücke geöffnet: BKPF (TABL) in 2508 (RELEASED → nicht gelistet)');
    const many = localizeNotification(
      rendered('release_watch.changed', { label: 'FI', changes: Array.from({ length: 22 }, () => ({ ...change, eventType: 'GAP_CLOSED' })) }),
      tDe
    );
    expect(many.title).toBe('Release-Überwachung „FI“: 22 Änderungen');
    expect(many.body.split('\n').at(-1)).toBe('… und 2 weitere');
    expect(many.body).not.toMatch(/Gap closed|not listed/);
  });

  it('leaves unknown event types untouched', () => {
    const n = { eventType: 'finding.assigned', title: 'Finding assigned to you', body: 'x' };
    expect(localizeNotification(n, tDe)).toEqual({ title: n.title, body: n.body });
  });
});
