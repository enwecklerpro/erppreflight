/** Supported artifact formats reference (how to export each artifact family from SAP). */
export const artifacts = {
  eyebrow: 'Artifact reference',
  noPii: 'No retention of personal data',
  title: 'Supported artifact formats',
  intro:
    'Which SAP artifacts the preflight engines accept, how to export them and how uploads are redacted. The upload itself happens in the project workspace.',
  securityTitle: 'Automatic secret and personal-data redaction',
  securityBody:
    'Every upload is scanned for malware, its file type is verified from the file content, and credentials are removed by pattern and entropy detection before parsing.',
  trustLink: 'Open the Trust Center →',
  searchPlaceholder: 'Search artifacts or transaction codes (e.g. SFP, OPD)…',
  searchLabel: 'Search artifacts',
  categoriesLabel: 'Filter by category',
  allCategories: 'All categories',
  empty: 'No artifact matches the current filter.',
  tcodes: 'SAP transactions:',
  howTo: 'How to export from SAP',
  engines: 'Engines:',
  upload: 'Upload in a project',
  families: {
    'opd-matrix': {
      name: 'Output Parameter Determination (OPD) decision tables',
      summary: 'Decision table rules for output types, dispatch channels (EMAIL, PRINT, EDI), email recipients and sender addresses.',
      steps: [
        'Start transaction OPD in SAP S/4HANA.',
        'Select the application object type (e.g. BILLING_DOCUMENT or PURCHASE_ORDER).',
        'In the table operations choose Export → decision table as XML or Excel.',
        'Make sure all determination steps (output type, receiver, channel, printer settings, email settings) are included.',
      ],
      note: 'Recipients and email domains are pseudonymized (HMAC SHA-256) before the analysis.',
    },
    'form-xdp': {
      name: 'Adobe Document Services (ADS) form layouts and XML',
      summary: 'Interactive and print Adobe LiveCycle XDP form templates with data bindings, subforms and font definitions.',
      steps: [
        'Open transaction SFP (Form Builder).',
        'Enter the form name (e.g. S4H_INVOICE_LAYOUT).',
        'Choose Layout → Tools → Export Layout as XDP XML.',
        'Alternatively export the interface context as an XML schema via Context → Export XML Schema.',
      ],
      note: 'Sensitive test invoice values and personal data are redacted by pattern and entropy scanners.',
    },
    'custom-code-abapgit': {
      name: 'Custom code repository (abapGit export)',
      summary: 'Custom Z and Y packages, BAdI implementations, CDS views and ABAP classes for Clean Core tier classification.',
      steps: [
        'Start abapGit in the development system (transaction SE38 → ZABAPGIT).',
        'Select the custom development package (e.g. ZCORE_MIGRATION).',
        'Choose "Export as ZIP" in the repository menu.',
        'Save the archive locally.',
      ],
      note: 'Embedded database credentials, RFC passwords and hardcoded tokens are replaced with deterministic placeholders.',
    },
    'spro-cbc-config': {
      name: 'SPRO / IMG customizing tables',
      summary: 'Customizing tables (e.g. T001G, T005, TVKO, T161) that map legacy business rules to Cloud CBC / SSCUI.',
      steps: [
        'In transaction SPRO, open the customizing activity.',
        'Choose Table View → Print / Export → Local File (spreadsheet or delimited text).',
        'Alternatively use SE16N with the customizing table name and export all records of the client.',
      ],
      note: 'Client-specific business identifiers can be masked in the organization privacy settings.',
    },
    'api-metadata': {
      name: 'OData and SOAP API service metadata',
      summary: 'Entity Data Model (EDMX) or WSDL specifications that define API contracts, entity sets and mandatory parameters.',
      steps: [
        'In transaction /IWFND/GW_CLIENT, call the service URL with $metadata (e.g. /sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata).',
        'Execute the request and choose File → Export Response Body as XML.',
        'For SOAP services open SOAMANAGER, select the web service and download the WSDL file.',
      ],
      note: 'Authentication headers, API keys and session cookies are removed when the file is ingested.',
    },
    'transport-requests': {
      name: 'CTS transport request object lists',
      summary: 'Transport request headers, object lists (E070 / E071) and software collection manifests for the target release.',
      steps: [
        'In transaction SE01 or SE09, enter the transport requests (e.g. TRK900100 to TRK900110).',
        'Choose Display → Request → Object List → Export to Local File (tab-delimited text or CSV).',
        'Include all tasks and piece-list entries so that cross-transport dependencies can be checked.',
      ],
      note: 'Developer user names and system names are kept for dependency tracing but excluded from summaries.',
    },
    'mfs-telegrams': {
      name: 'SAP EWM MFS telegram buffers and logs',
      summary: 'Telegrams exchanged between SAP EWM and the PLCs of automated conveyors and stacker cranes.',
      steps: [
        'Open the warehouse management monitor (transaction /SCWM/MON).',
        'Navigate to Material Flow System (MFS) → Telegrams.',
        'Restrict the time window (e.g. 15 minutes before and during the stoppage).',
        'Choose List → Export → spreadsheet or delimited text file.',
      ],
      note: 'Handling unit barcodes and warehouse staff IDs can be replaced with deterministic SHA-256 tokens.',
    },
    'change-pointer-tbd52': {
      name: 'BD21 / BD52 change pointer configuration',
      summary: 'Change document objects and table fields that trigger asynchronous notifications to external systems.',
      steps: [
        'In transaction BD52, enter the message type (e.g. MATMAS or DEBMAS).',
        'Export the configured field list (table name, field name) to CSV or Excel.',
        'Also capture the activation status of the message type in transaction BD50.',
      ],
      note: 'Only structural table and field names are needed; no business values are ingested.',
    },
  },
};
