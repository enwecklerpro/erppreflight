/** Application shell: command palette, notification bell, organization switcher, account banners. */
export const shell = {
  palette: {
    title: 'Command palette',
    placeholder: 'Search pages, projects and engines…',
    inputLabel: 'Search commands',
    results: 'Results',
    close: 'Close command palette',
    noMatches: 'Nothing found for “{query}”',
    navigate: 'Navigate',
    select: 'Select',
    projectDescription: 'Project · target release {release}',
    category: {
      NAVIGATION: 'Page',
      PROJECTS: 'Project',
      ENGINES: 'Engine',
    },
    nav: {
      dashboard: { title: 'Dashboard', description: 'Readiness, blockers and engine status across your projects' },
      projects: { title: 'Projects', description: 'All project workspaces with their analyses and findings' },
      templates: { title: 'Analysis templates', description: 'Reusable analysis profiles for recurring checks' },
      matrix: { title: 'Release matrix', description: 'Which engines support which SAP releases' },
      knowledgeGraph: { title: 'Knowledge graph', description: 'Look up SAP objects, successors and release changes' },
      notifications: { title: 'Notifications', description: 'Analysis results, watches and account events' },
      settings: { title: 'Settings', description: 'Organization, members, security and billing' },
      status: { title: 'Service status', description: 'Current availability of the platform services' },
      feedback: { title: 'Feedback', description: 'Request new checks or vote on existing requests' },
      demo: { title: 'Demo sandbox', description: 'Explore a sample project with synthetic data' },
    },
  },
  bell: {
    label: 'Notifications',
    labelUnread: 'Notifications, {count} unread',
    panel: 'Recent notifications',
    title: 'Notifications',
    markAllRead: 'Mark all as read',
    loadError: 'Could not load notifications.',
    empty: 'You are all caught up.',
    viewAll: 'View all notifications',
  },
  notification: {
    unread: 'Unread',
    markRead: 'Mark read',
    markUnread: 'Mark unread',
    markReadLabel: 'Mark “{title}” as read',
    markUnreadLabel: 'Mark “{title}” as unread',
  },
  org: {
    active: 'Active organization',
  },
  banner: {
    verifyRich:
      '<b>Verify your email address.</b> Until then you can upload artifacts, but analyses and report exports stay locked. We sent a link to {email}.',
    twoFactorRich:
      '<b>Two-factor authentication required.</b> This organization requires 2FA. <link>Enable it now</link> to regain access to projects.',
  },
  resend: {
    sending: 'Sending…',
    sent: 'Verification email sent',
    resend: 'Resend verification email',
    checkInbox: 'Check your inbox — the link is valid for {hours} hours.',
  },
  navbar: {
    signedInAs: 'Signed in as {email}',
  },
};
