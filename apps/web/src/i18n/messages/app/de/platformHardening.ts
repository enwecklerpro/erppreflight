import type { platformHardening as En } from '../en/platformHardening';

export const platformHardening: typeof En = {
  notificationLanguage: {
    title: 'Sprache der Benachrichtigungen',
    hint: 'Gilt für Benachrichtigungen in der App und E-Mails zu Befunden, die Ihnen zugewiesen werden. Andere Benachrichtigungs-E-Mails werden auf Englisch versendet.',
    groupLabel: 'Sprache der Benachrichtigungen',
    en: 'Englisch',
    de: 'Deutsch',
    defaultNote: 'Noch nicht gewählt – es wird Englisch verwendet.',
    saving: 'Wird gespeichert …',
    saved: 'Sprache gespeichert.',
    saveFailed: 'Die Sprache konnte nicht gespeichert werden.',
    loadFailed: 'Die Sprache der Benachrichtigungen konnte nicht geladen werden.',
  },
  findingFocus: {
    title: 'Befund aus Ihrer Benachrichtigung',
    close: 'Alle Befunde anzeigen',
    loading: 'Befund wird geladen …',
    notFound: 'Dieser Befund existiert nicht mehr oder Sie haben keinen Zugriff darauf.',
    loadFailed: 'Der Befund konnte nicht geladen werden.',
    otherOrganization: 'Dieser Befund gehört zur Organisation „{name}“. Sie sind in einer anderen Organisation angemeldet.',
    switchOrganization: 'Zu {name} wechseln',
  },
  usage: {
    connectorRequests: 'Connector-Anfragen in diesem Zeitraum (ausgehende Aufrufe an Jira, ServiceNow, Cloud ALM, OData und Code-Repositories): {count}',
  },
};
