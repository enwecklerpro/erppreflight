import type { TFunction } from '@/i18n/translate';
import { notificationText as EN } from '@/i18n/messages/app/en/notificationText';

/**
 * Renders a stored in-app notification in the UI language.
 *
 * The API renders notification title/body once, in English, when the outbox event is processed
 * (users have no persisted language preference). The known templates of
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

export function localizeNotification(n: NotificationTextInput, t: TFunction): { title: string; body: string } {
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
      if (n.body === EN.analysisFailedBody) body = t('app.notificationText.analysisFailedBody');
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
