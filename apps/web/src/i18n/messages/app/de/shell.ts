import type { shell as En } from '../en/shell';

export const shell: typeof En = {
  palette: {
    title: 'Befehlspalette',
    placeholder: 'Seiten, Projekte und Engines durchsuchen …',
    inputLabel: 'Befehle durchsuchen',
    results: 'Ergebnisse',
    close: 'Befehlspalette schließen',
    noMatches: 'Keine Treffer für „{query}“',
    navigate: 'Navigieren',
    select: 'Auswählen',
    projectDescription: 'Projekt · Ziel-Release {release}',
    category: {
      NAVIGATION: 'Seite',
      PROJECTS: 'Projekt',
      ENGINES: 'Engine',
    },
    nav: {
      dashboard: { title: 'Dashboard', description: 'Bereitschaft, Blocker und Engine-Status über alle Projekte' },
      projects: { title: 'Projekte', description: 'Alle Projekt-Workspaces mit Analysen und Befunden' },
      templates: { title: 'Analysevorlagen', description: 'Wiederverwendbare Analyseprofile für wiederkehrende Prüfungen' },
      matrix: { title: 'Release-Matrix', description: 'Welche Engines welche SAP-Releases unterstützen' },
      knowledgeGraph: { title: 'Wissensgraph', description: 'SAP-Objekte, Nachfolger und Release-Änderungen nachschlagen' },
      notifications: { title: 'Benachrichtigungen', description: 'Analyseergebnisse, Beobachtungen und Kontoereignisse' },
      settings: { title: 'Einstellungen', description: 'Organisation, Mitglieder, Sicherheit und Abrechnung' },
      status: { title: 'Dienststatus', description: 'Aktuelle Verfügbarkeit der Plattformdienste' },
      feedback: { title: 'Feedback', description: 'Neue Prüfungen anfragen oder über Anfragen abstimmen' },
      demo: { title: 'Demo-Sandbox', description: 'Ein Beispielprojekt mit synthetischen Daten erkunden' },
    },
  },
  bell: {
    label: 'Benachrichtigungen',
    labelUnread: 'Benachrichtigungen, {count} ungelesen',
    panel: 'Neueste Benachrichtigungen',
    title: 'Benachrichtigungen',
    markAllRead: 'Alle als gelesen markieren',
    loadError: 'Benachrichtigungen konnten nicht geladen werden.',
    empty: 'Sie sind auf dem neuesten Stand.',
    viewAll: 'Alle Benachrichtigungen anzeigen',
  },
  notification: {
    unread: 'Ungelesen',
    markRead: 'Als gelesen markieren',
    markUnread: 'Als ungelesen markieren',
    markReadLabel: '„{title}“ als gelesen markieren',
    markUnreadLabel: '„{title}“ als ungelesen markieren',
  },
  org: {
    active: 'Aktive Organisation',
  },
  banner: {
    verifyRich:
      '<b>Bestätigen Sie Ihre E-Mail-Adresse.</b> Bis dahin können Sie Artefakte hochladen, Analysen und Berichtsexporte bleiben jedoch gesperrt. Wir haben einen Link an {email} gesendet.',
    twoFactorRich:
      '<b>Zwei-Faktor-Authentifizierung erforderlich.</b> Diese Organisation verlangt 2FA. <link>Jetzt aktivieren</link>, um wieder auf Projekte zugreifen zu können.',
  },
  resend: {
    sending: 'Wird gesendet …',
    sent: 'Bestätigungs-E-Mail gesendet',
    resend: 'Bestätigungs-E-Mail erneut senden',
    checkInbox: 'Prüfen Sie Ihren Posteingang – der Link ist {hours} Stunden gültig.',
  },
  navbar: {
    signedInAs: 'Angemeldet als {email}',
  },
};
