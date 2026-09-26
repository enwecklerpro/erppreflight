/**
 * Localized rendering of server-generated in-app notifications. The API stores the title/body in
 * English (apps/api/src/modules/notifications/notification-renderer.ts); the web recognizes the
 * known templates and renders them in the UI language. 'localize: no' keeps the stored English
 * text untouched in the English UI; unknown texts are always shown as stored.
 */
export const notificationText = {
  localize: 'no',
  analysisCompleted: 'Analysis completed: {count, plural, one {# finding} other {# findings}}',
  analysisPartial: 'Analysis partially completed: {count, plural, one {# finding} other {# findings}}',
  analysisBody: 'Engines: {engines}. Target release: {release}.',
  analysisFailed: 'Analysis failed',
  analysisFailedBody: 'The analysis could not be completed. Open the run to review the error and re-run it.',
  criticalTitle: '{parts} detected',
  partBlocker: '{count, plural, one {# blocker finding} other {# blocker findings}}',
  partCritical: '{count, plural, one {# critical finding} other {# critical findings}}',
  and: ' and ',
  criticalBody: 'Engines: {engines}. Review them before the next release gate.',
  notAvailable: 'n/a',
  watchTitle: 'Release watch "{label}": {count} changes',
  watchMore: '… and {count} more',
  notListed: 'not listed',
  watchEvent: {
    GAP_CLOSED: 'Gap closed',
    GAP_OPENED: 'Gap opened',
    NEW_DEPRECATION: 'New deprecation',
    SUCCESSOR_CHANGED: 'Successor changed',
    STATE_CHANGED: 'Release state changed',
    OBJECT_REMOVED: 'Removed from release list',
  },
};
