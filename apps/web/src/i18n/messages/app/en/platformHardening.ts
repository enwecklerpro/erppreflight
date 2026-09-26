/** Notification language, focused finding (deep link) and extra usage meters. */
export const platformHardening = {
  notificationLanguage: {
    title: 'Language of notifications',
    hint: 'Used for in-app notifications and e-mails about findings assigned to you. Other notification e-mails are sent in English.',
    groupLabel: 'Language of notifications',
    en: 'English',
    de: 'German',
    defaultNote: 'Not chosen yet — English is used.',
    saving: 'Saving…',
    saved: 'Language saved.',
    saveFailed: 'The language could not be saved.',
    loadFailed: 'The notification language could not be loaded.',
  },
  findingFocus: {
    title: 'Finding from your notification',
    close: 'Show all findings',
    loading: 'Loading the finding…',
    notFound: 'This finding no longer exists or you have no access to it.',
    loadFailed: 'The finding could not be loaded.',
    otherOrganization: 'This finding belongs to the organization “{name}”. You are signed in to another organization.',
    switchOrganization: 'Switch to {name}',
  },
  usage: {
    connectorRequests: 'Connector requests this period (outbound calls to Jira, ServiceNow, Cloud ALM, OData and code repositories): {count}',
  },
};
