import * as coreSchemas from './schema/core';
import * as auditSchemas from './schema/audit';
import * as platformSchemas from './schema/platform';
import * as templatesSchemas from './schema/templates';
import * as catalogSchemas from './schema/catalog';
import * as eventsSchemas from './schema/events';
import * as accountSchemas from './schema/account';
import * as knowledgeSchemas from './schema/knowledge';
import * as knowledgeArticleSchemas from './schema/knowledge-articles';
import * as findingLifecycleSchemas from './schema/finding-lifecycle';

export const schema = {
  ...coreSchemas,
  ...auditSchemas,
  ...platformSchemas,
  ...templatesSchemas,
  ...catalogSchemas,
  ...eventsSchemas,
  ...accountSchemas,
  ...knowledgeSchemas,
  ...knowledgeArticleSchemas,
  ...findingLifecycleSchemas,
};

// Re-export the schemas directly
export * from './schema/core';
export * from './schema/audit';
export * from './schema/platform';
export * from './schema/templates';
export * from './schema/catalog';
export * from './schema/events';
export * from './schema/account';
export * from './schema/knowledge';
export * from './schema/knowledge-articles';
export * from './schema/finding-lifecycle';

// Export types for core
export type OrganizationRow = typeof coreSchemas.organizations.$inferSelect;
export type NewOrganizationRow = typeof coreSchemas.organizations.$inferInsert;
export type UserRow = typeof coreSchemas.users.$inferSelect;
export type NewUserRow = typeof coreSchemas.users.$inferInsert;
export type OrganizationMemberRow = typeof coreSchemas.organizationMembers.$inferSelect;
export type NewOrganizationMemberRow = typeof coreSchemas.organizationMembers.$inferInsert;
export type ProjectRow = typeof coreSchemas.projects.$inferSelect;
export type NewProjectRow = typeof coreSchemas.projects.$inferInsert;
export type UploadedFileRow = typeof coreSchemas.uploadedFiles.$inferSelect;
export type NewUploadedFileRow = typeof coreSchemas.uploadedFiles.$inferInsert;
export type AnalysisRow = typeof coreSchemas.analyses.$inferSelect;
export type NewAnalysisRow = typeof coreSchemas.analyses.$inferInsert;
export type FindingRow = typeof coreSchemas.findings.$inferSelect;
export type NewFindingRow = typeof coreSchemas.findings.$inferInsert;
export type EvidenceRow = typeof coreSchemas.evidence.$inferSelect;
export type NewEvidenceRow = typeof coreSchemas.evidence.$inferInsert;
export type TestRow = typeof coreSchemas.tests.$inferSelect;
export type NewTestRow = typeof coreSchemas.tests.$inferInsert;

// Export types for audit
// auditEvents types are already exported in audit.ts as AuditEventRow / NewAuditEventRow
export type { AuditEventRow, NewAuditEventRow } from './schema/audit';

// Export types for platform
export type ReportRow = typeof platformSchemas.reports.$inferSelect;
export type NewReportRow = typeof platformSchemas.reports.$inferInsert;
export type ChangesetRow = typeof platformSchemas.changesets.$inferSelect;
export type NewChangesetRow = typeof platformSchemas.changesets.$inferInsert;
export type TraceabilityNodeRow = typeof platformSchemas.traceabilityNodes.$inferSelect;
export type NewTraceabilityNodeRow = typeof platformSchemas.traceabilityNodes.$inferInsert;
export type ApiKeyRow = typeof platformSchemas.apiKeys.$inferSelect;
export type NewApiKeyRow = typeof platformSchemas.apiKeys.$inferInsert;
export type WebhookRow = typeof platformSchemas.webhooks.$inferSelect;
export type NewWebhookRow = typeof platformSchemas.webhooks.$inferInsert;
export type RegisteredAgentRow = typeof platformSchemas.registeredAgents.$inferSelect;
export type NewRegisteredAgentRow = typeof platformSchemas.registeredAgents.$inferInsert;
export type AgentProposalRow = typeof platformSchemas.agentProposals.$inferSelect;
export type NewAgentProposalRow = typeof platformSchemas.agentProposals.$inferInsert;
export type LandscapeRow = typeof platformSchemas.landscapes.$inferSelect;
export type NewLandscapeRow = typeof platformSchemas.landscapes.$inferInsert;

// Export types for templates
export type AnalysisTemplateRow = typeof templatesSchemas.analysisTemplates.$inferSelect;
export type NewAnalysisTemplateRow = typeof templatesSchemas.analysisTemplates.$inferInsert;
export type CustomerFeedbackRow = typeof templatesSchemas.customerFeedback.$inferSelect;
export type NewCustomerFeedbackRow = typeof templatesSchemas.customerFeedback.$inferInsert;
export type ReleaseNoteRow = typeof templatesSchemas.releaseNotes.$inferSelect;
export type NewReleaseNoteRow = typeof templatesSchemas.releaseNotes.$inferInsert;
export type SyntheticScenarioRow = typeof templatesSchemas.syntheticScenarios.$inferSelect;
export type NewSyntheticScenarioRow = typeof templatesSchemas.syntheticScenarios.$inferInsert;

// Export types for catalog
export type SapObjectRow = typeof catalogSchemas.sapObjects.$inferSelect;
export type NewSapObjectRow = typeof catalogSchemas.sapObjects.$inferInsert;

// Export types for events
export type DomainEventsOutboxRow = typeof eventsSchemas.domainEventsOutbox.$inferSelect;
export type NewDomainEventsOutboxRow = typeof eventsSchemas.domainEventsOutbox.$inferInsert;
export type ScheduledPreflightRow = typeof eventsSchemas.scheduledPreflights.$inferSelect;
export type NewScheduledPreflightRow = typeof eventsSchemas.scheduledPreflights.$inferInsert;
