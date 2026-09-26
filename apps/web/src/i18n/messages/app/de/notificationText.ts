import type { notificationText as En } from '../en/notificationText';

export const notificationText: typeof En = {
  localize: 'yes',
  analysisCompleted: 'Analyse abgeschlossen: {count, plural, one {# Befund} other {# Befunde}}',
  analysisPartial: 'Analyse teilweise abgeschlossen: {count, plural, one {# Befund} other {# Befunde}}',
  analysisBody: 'Engines: {engines}. Ziel-Release: {release}.',
  analysisFailed: 'Analyse fehlgeschlagen',
  analysisFailedBody:
    'Die Analyse konnte nicht abgeschlossen werden. Öffnen Sie den Lauf, um den Fehler zu prüfen, und starten Sie ihn erneut.',
  criticalTitle: '{parts} erkannt',
  partBlocker: '{count, plural, one {# Blocker-Befund} other {# Blocker-Befunde}}',
  partCritical: '{count, plural, one {# kritischer Befund} other {# kritische Befunde}}',
  and: ' und ',
  criticalBody: 'Engines: {engines}. Prüfen Sie diese vor dem nächsten Release-Gate.',
  notAvailable: '–',
  watchTitle: 'Release-Überwachung „{label}“: {count} Änderungen',
  watchMore: '… und {count} weitere',
  notListed: 'nicht gelistet',
  watchEvent: {
    GAP_CLOSED: 'Lücke geschlossen',
    GAP_OPENED: 'Lücke geöffnet',
    NEW_DEPRECATION: 'Neue Abkündigung',
    SUCCESSOR_CHANGED: 'Nachfolger geändert',
    STATE_CHANGED: 'Release-Status geändert',
    OBJECT_REMOVED: 'Aus der Release-Liste entfernt',
  },
};
