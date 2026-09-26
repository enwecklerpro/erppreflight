import type { TFunction } from '@/i18n/translate';
import { notificationText as EN } from '@/i18n/messages/app/en/notificationText';
import { notificationText as DE } from '@/i18n/messages/app/de/notificationText';

const LEGACY_ANALYSIS_FAILED_BODY = 'The analysis could not be completed. Open the project to review the run and retry.';

/**
 * Renders a stored in-app notification in the UI language.
 *
 * The API renders notification title/body once when the outbox event is processed: in English,
 * except `finding.assigned`, which is rendered in the recipient's notification language
 * (users.preferred_locale, EN or DE). The known templates of
 * apps/api/src/modules/notifications/notification-renderer.ts are recognized here and rendered
 * with the German dictionary; anything unrecognized (new event types, free-text failure reasons)
 * is shown exactly as stored. Pure function, unit tested.
 */
export interface NotificationTextInput {
  eventType: string;
  title: string;
  body: string;
}

type WatchEvent = keyof typeof EN.watchEvent;
const WATCH_LABELS = Object.entries(EN.watchEvent) as Array<[WatchEvent, string]>;

function na(value: string, t: TFunction): string {
  return value === 'n/a' ? t('app.notificationText.notAvailable') : value;
}

function watchLine(line: string, t: TFunction): string {
  const more = line.match(/^… and (\d+) more$/);
  if (more) return t('app.notificationText.watchMore', { count: Number(more[1]) });
  const label = WATCH_LABELS.find(([, en]) => line.startsWith(`${en}: `));
  if (!label) return line;
  const rest = line.slice(label[1].length).replace(/\bnot listed\b/g, t('app.notificationText.notListed'));
  return `${t(`app.notificationText.watchEvent.${label[0]}`)}${rest}`;
}

type SeverityKey = keyof typeof EN.severity;

/** Structured facts of a stored `finding.assigned` text (English or German template), or null. */
export function parseAssignment(title: string, body: string) {
  const t = title.match(/^(?:Finding assigned to you|Befund zugewiesen): ([\s\S]*)$/);
  const [first, ...rest] = body.split('\n');
  const en = first.match(
    /^(.+?) assigned (\S+) \(severity: ([^)]+)\)(?: in project "(.*)")? to you\.(?: Due (\d{4})-(\d{2})-(\d{2})\.)?$/
  );
  const de = en
    ? null
    : first.match(/^(.+?) hat Ihnen (\S+) \(Schweregrad: ([^)]+)\)(?: im Projekt „(.*)“)? zugewiesen\.(?: Fällig am (\d{2})\.(\d{2})\.(\d{4})\.)?$/);
  const m = en ?? de;
  if (!t || !m) return null;
  const labels = (en ? EN : DE).severity as Record<SeverityKey, string>;
  const severity = (Object.keys(labels) as SeverityKey[]).find((k) => labels[k] === m[3]);
  if (!severity) return null;
  const note = rest.join('\n').match(/^(?:Note|Notiz): ([\s\S]*)$/);
  if (rest.length > 0 && !note) return null;
  const date = en ? (m[5] ? { y: m[5], m: m[6], d: m[7] } : null) : m[5] ? { y: m[7], m: m[6], d: m[5] } : null;
  const source = en ? EN : DE;
  return {
    title: t[1],
    by: m[1] === source.assignedBySomeone ? null : m[1],
    rule: m[2] === source.assignedFinding ? null : m[2],
    severity,
    project: m[4] ?? null,
    date,
    note: note ? note[1] : null,
  };
}

function localizeAssignment(n: NotificationTextInput, t: TFunction): { title: string; body: string } | null {
  const a = parseAssignment(n.title, n.body);
  if (!a) return null;
  const vars = {
    by: a.by ?? t('app.notificationText.assignedBySomeone'),
    rule: a.rule ?? t('app.notificationText.assignedFinding'),
    severity: t(`app.notificationText.severity.${a.severity}`),
    project: a.project ?? '',
  };
  let body = t(a.project ? 'app.notificationText.assignedBodyProject' : 'app.notificationText.assignedBody', vars);
  if (a.date) body += t('app.notificationText.assignedDue', { date: t('app.notificationText.assignedDate', a.date) });
  if (a.note) body += `\n${t('app.notificationText.assignedNote', { note: a.note })}`;
  return { title: t('app.notificationText.assignedTitle', { title: a.title }), body };
}

export function localizeNotification(n: NotificationTextInput, t: TFunction): { title: string; body: string } {
  // Stored in the recipient's notification language, which may differ from the UI language.
  if (n.eventType === 'finding.assigned') return localizeAssignment(n, t) ?? { title: n.title, body: n.body };
  if (t('app.notificationText.localize') !== 'yes') return { title: n.title, body: n.body };
  let title = n.title;
  let body = n.body;
  switch (n.eventType) {
    case 'analysis.completed': {
      const m = n.title.match(/^Analysis (partially )?completed: (\d+) findings?$/);
      if (m) {
        title = t(m[1] ? 'app.notificationText.analysisPartial' : 'app.notificationText.analysisCompleted', { count: Number(m[2]) });
      }
      const b = n.body.match(/^Engines: (.*)\. Target release: (.*)\.$/);
      if (b) body = t('app.notificationText.analysisBody', { engines: na(b[1], t), release: na(b[2], t) });
      break;
    }
    case 'analysis.failed': {
      if (n.title === 'Analysis failed') title = t('app.notificationText.analysisFailed');
      // The API text changed with the analysis run lifecycle (link to the run instead of the
      // project); notifications stored before that keep the earlier wording.
      if (n.body === EN.analysisFailedBody || n.body === LEGACY_ANALYSIS_FAILED_BODY) {
        body = t('app.notificationText.analysisFailedBody');
      }
      break;
    }
    case 'finding.critical': {
      const m = n.title.match(/^(?:(\d+) blocker)?(?: and )?(?:(\d+) critical)? findings? detected$/);
      if (m && (m[1] || m[2])) {
        const parts = [
          m[1] ? t('app.notificationText.partBlocker', { count: Number(m[1]) }) : null,
          m[2] ? t('app.notificationText.partCritical', { count: Number(m[2]) }) : null,
        ].filter(Boolean) as string[];
        title = t('app.notificationText.criticalTitle', { parts: parts.join(t('app.notificationText.and')) });
      }
      const b = n.body.match(/^Engines: (.*)\. Review them before the next release gate\.$/);
      if (b) body = t('app.notificationText.criticalBody', { engines: na(b[1], t) });
      break;
    }
    case 'release_watch.changed': {
      const multi = n.title.match(/^Release watch "(.*)": (\d+) changes$/);
      title = multi ? t('app.notificationText.watchTitle', { label: multi[1], count: Number(multi[2]) }) : watchLine(n.title, t);
      body = n.body
        .split('\n')
        .map((line) => watchLine(line, t))
        .join('\n');
      break;
    }
    default:
      break;
  }
  return { title, body };
}
