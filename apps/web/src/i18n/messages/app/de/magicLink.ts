import type { magicLink as En } from '../en/magicLink';

/** Anmeldung per E-Mail-Link (Spezifikation 10.2). */
export const magicLink: typeof En = {
  requestLink: 'Anmeldelink per E-Mail senden',
  or: 'oder',
  requestTitle: 'Mit einem E-Mail-Link anmelden',
  requestSubtitle:
    'Wir senden Ihnen einen einmalig gültigen Link, mit dem Sie sich ohne Passwort anmelden. Er ist 15 Minuten gültig.',
  send: 'Anmeldelink senden',
  sending: 'Wird gesendet…',
  sentTitle: 'Bitte prüfen Sie Ihr Postfach',
  sentBody:
    'Falls ein Konto für {email} existiert, haben wir einen Anmeldelink gesendet. Er ist {minutes} Minuten gültig und kann nur einmal verwendet werden.',
  sendAnother: 'Weiteren Link senden',
  usePassword: 'Stattdessen mit Passwort anmelden',
  requestFailed: 'Der Anmeldelink konnte nicht angefordert werden. Bitte versuchen Sie es erneut.',
  landingTitle: 'Mit Ihrem E-Mail-Link anmelden',
  checking: 'Anmeldelink wird geprüft…',
  signingInAsRich: 'Sie melden sich an als <b>{email}</b>.',
  expiresAt: 'Der Link ist bis {time} gültig und funktioniert nur einmal.',
  notYou: 'Nicht Ihr Konto? Schließen Sie diese Seite und ignorieren Sie die E-Mail.',
  continue: 'Weiter zur Anmeldung',
  signingIn: 'Anmeldung läuft…',
  invalidTitle: 'Dieser Anmeldelink ist nicht verwendbar',
  invalidBody:
    'Der Link ist ungültig, abgelaufen oder wurde bereits verwendet. Anmeldelinks sind 15 Minuten gültig und funktionieren nur einmal.',
  requestNew: 'Neuen Link anfordern',
  failedTitle: 'Anmeldung fehlgeschlagen',
  failed: 'Die Anmeldung mit diesem Link ist fehlgeschlagen. Fordern Sie einen neuen Link an und versuchen Sie es erneut.',
  ssoRequired:
    'Ihre Organisation verlangt Single Sign-on. Anmeldelinks per E-Mail sind für Ihr Konto deaktiviert.',
  continueWithSso: 'Weiter mit Single Sign-on',
  previewFailed: 'Der Anmeldelink konnte nicht geprüft werden.',
  retry: 'Erneut versuchen',
};
