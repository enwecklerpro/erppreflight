import type { EngineType } from '@erppreflight/schemas';

/**
 * AI Problem Router — deterministic rule set (Part 05 §5.1). Versioned: every
 * persisted routing records ROUTER_RULESET_VERSION so a suggestion can always be
 * explained and reproduced. Text is normalised before matching (lower-case,
 * German umlauts folded: ä→ae, ö→oe, ü→ue, ß→ss), so rules are written in folded
 * form and cover English and German phrasing.
 *
 * The router never produces findings; it only proposes engines.
 */
export const ROUTER_RULESET_VERSION = 'router-2026.09.1';

export type Matcher = (text: string) => boolean;

export interface PhraseRule {
  id: string;
  label: string;
  test: Matcher;
  engines: Array<{ engine: EngineType; weight: number; condition?: string }>;
}

const re = (pattern: RegExp): Matcher => (t) => pattern.test(t);
const all = (...ms: Matcher[]): Matcher => (t) => ms.every((m) => m(t));
const any = (...ms: Matcher[]): Matcher => (t) => ms.some((m) => m(t));

// Shared vocabulary -----------------------------------------------------------------
const NEGATION = re(/\b(not|nicht|kein|keine|keinen|never|nie|no|fails?|failed|fehlt|fehlen|missing|stuck|haengt)\b|n't\b/);
const OUTPUT_MEDIUM = re(/(e-?mail|\bmail\b|\boutput\b|ausgabe|\bprint|druck|gedruckt|\bfax\b|\bedi\b|nachricht|\bmessage\b|\bpdf\b)/);
const OUTPUT_VERB = re(
  /(\bsent\b|\bsend|versend|versandt|verschickt|gesendet|gedruckt|printed|\bprint|generat|erzeugt|\bcreated?\b|triggered|ausgegeben|zugestellt|delivered|received|arrive|ankommt|angekommen)/
);
const BUSINESS_DOC = re(
  /(purchase order|bestellung|billing|faktura|rechnung|invoice|delivery note|lieferschein|sales order|kundenauftrag|order confirmation|auftragsbestaetigung|mahnung|dunning)/
);
const FIELD_WORD = re(/(\bfield\b|\bfeld\b|\bnumber\b|nummer|\bvat\b|\bust\b|ust-?id|tax (id|number)|steuernummer|\biban\b|\bdate\b|datum|\bname\b|adresse|address)/);
const WANT_OR_MISSING = re(
  /(\bneed\b|brauche|benoetige|\badd\b|hinzufueg|ergaenz|missing|fehlt|\bempty\b|\bleer\b|not (shown|displayed|printed|visible)|nicht (angezeigt|gedruckt|sichtbar)|show|appear|anzeig|print)/
);
const MIGRATION_SOURCE = re(/(\becc\b|\br\/3\b|\br3\b|erp 6|ecc ?6|\behp ?\d|suite on hana|\bsoh\b)/);
const MIGRATION_TARGET = re(/(s\/4|\bs4\b|s4hana|s\/4hana|\bcloud\b|\brise\b|public edition|private edition)/);
const MIGRATION_VERB = re(/(migrat|umstell|conversion|konvertier|brownfield|greenfield|bluefield|transition|\bmoving\b|move to|\bwechsel|umzug|ueberfuehr)/);

export const PHRASE_RULES: PhraseRule[] = [
  // ---------------------------------------------------------------- Output (OPD)
  {
    id: 'OPD.output-not-produced',
    label: 'output / e-mail / print is not produced',
    test: all(OUTPUT_MEDIUM, NEGATION, OUTPUT_VERB),
    engines: [{ engine: 'OPD_GUARD', weight: 4 }],
  },
  {
    id: 'OPD.explicit',
    label: 'output determination (OPD / BRFplus) mentioned',
    test: re(/(\bopd\b|\bbrf\+?\b|brfplus|output (parameter )?determination|ausgabesteuerung|output control|output management|nachrichtenfindung|output type|ausgabeart|nachrichtenart)/),
    engines: [{ engine: 'OPD_GUARD', weight: 4 }],
  },
  {
    id: 'OPD.recipient-channel',
    label: 'output recipient / channel / printer',
    test: all(
      re(/(recipient|empfaenger|\bchannel\b|\bkanal\b|printer|drucker|\bspool\b|e-?mail address|e-?mail-adresse|output device|ausgabegeraet)/),
      any(OUTPUT_MEDIUM, BUSINESS_DOC)
    ),
    engines: [{ engine: 'OPD_GUARD', weight: 2 }],
  },
  {
    id: 'OPD.business-document-output',
    label: 'business document output',
    test: all(BUSINESS_DOC, OUTPUT_MEDIUM, NEGATION),
    engines: [{ engine: 'OPD_GUARD', weight: 1 }],
  },
  // ---------------------------------------------------------------- Forms
  {
    id: 'FORM.explicit',
    label: 'form technology (Adobe Forms / XDP / Smart Forms / SAPscript) mentioned',
    test: re(/(adobe[ -]?form|adobe-formular|\bxdp\b|smart ?forms?|sapscript|formular|form template|formularvorlage|\bads\b|adobe document services|print form|druckformular)/),
    engines: [{ engine: 'FORM_DOCTOR', weight: 4 }],
  },
  {
    id: 'FORM.field-on-document',
    label: 'field content on a PDF / printed form',
    test: all(re(/(\bpdf\b|\bform\b|formular|printout|ausdruck|\blayout\b|druckbild)/), any(FIELD_WORD, WANT_OR_MISSING)),
    engines: [{ engine: 'FORM_DOCTOR', weight: 3 }],
  },
  // ---------------------------------------------------------------- Custom fields
  {
    id: 'CFFD.explicit',
    label: 'custom field / key-user extension field mentioned',
    test: re(/(\byy1_|\bzz1_|custom fields?|kundenfeld|zusatzfeld|eigenes feld|extension field|erweiterungsfeld|key[- ]user extensib|custom field flow)/),
    engines: [{ engine: 'CUSTOM_FIELD_FLOW_DOCTOR', weight: 4 }],
  },
  {
    id: 'CFFD.field-not-in-standard',
    label: 'a data field must be added to / carried into a document',
    test: all(FIELD_WORD, re(/(\bneed\b|brauche|benoetige|\badd\b|hinzufueg|ergaenz|not available|nicht verfuegbar|nicht vorhanden)/)),
    engines: [
      {
        engine: 'CUSTOM_FIELD_FLOW_DOCTOR',
        weight: 2,
        condition: 'Only if the field is not part of the standard form data (it then has to flow as a custom field).',
      },
    ],
  },
  {
    id: 'CFFD.propagation',
    label: 'field value not propagated along the document flow',
    test: all(
      any(FIELD_WORD, re(/\bwert\b|\bvalue\b/)),
      re(/(propagat|not (copied|transferred|passed|carried)|nicht (uebernommen|uebertragen|weitergegeben|kopiert)|document flow|belegfluss|follow-?on document|folgebeleg)/)
    ),
    engines: [{ engine: 'CUSTOM_FIELD_FLOW_DOCTOR', weight: 3 }],
  },
  // ---------------------------------------------------------------- Migration
  {
    id: 'MIG.source-target',
    label: 'ECC → S/4HANA migration (source and target named)',
    test: all(MIGRATION_SOURCE, MIGRATION_TARGET),
    engines: [
      { engine: 'ECC2CLOUD_NAVIGATOR', weight: 3 },
      { engine: 'SPRO2CLOUD', weight: 3 },
      { engine: 'SAP_GAP_RADAR', weight: 3 },
      { engine: 'CLEAN_CORE_OBJECT_GUARD', weight: 3 },
    ],
  },
  {
    id: 'MIG.intent',
    label: 'migration / conversion intent',
    test: all(MIGRATION_VERB, MIGRATION_TARGET),
    engines: [
      { engine: 'ECC2CLOUD_NAVIGATOR', weight: 2 },
      { engine: 'SPRO2CLOUD', weight: 2 },
      { engine: 'SAP_GAP_RADAR', weight: 2 },
      { engine: 'CLEAN_CORE_OBJECT_GUARD', weight: 2 },
    ],
  },
  {
    id: 'ECC2.transactions',
    label: 'transaction / usage / simplification item analysis',
    test: re(/(transactions?\b|transaktion|\btcodes?\b|t-codes?|st03n|usage data|nutzungsdaten|readiness check|simplification (item|list)|vereinfachungsliste|obsolete transaction)/),
    engines: [{ engine: 'ECC2CLOUD_NAVIGATOR', weight: 3 }],
  },
  {
    id: 'SPRO.explicit',
    label: 'configuration (SPRO / IMG / Customizing) mentioned',
    test: re(/(\bspro\b|\bimg\b|customizing|einstellungen|configuration settings|\bsscui|central business configuration|\bcbc\b|konfiguration)/),
    engines: [{ engine: 'SPRO2CLOUD', weight: 4 }],
  },
  {
    id: 'GAP.explicit',
    label: 'fit-to-standard / gap analysis of requirements',
    test: re(/(\bgaps?\b|fit[- ]to[- ]standard|fit-gap|anforderung|requirements?\b|\bluecke|scope items?|standard coverage|standardabdeckung)/),
    engines: [{ engine: 'SAP_GAP_RADAR', weight: 4 }],
  },
  {
    id: 'CC.explicit',
    label: 'clean core / custom code compliance',
    test: re(
      /(clean[- ]core|\btier ?[123]\b|released apis?|freigegeben|unreleased|nicht freigegeben|abap cloud|direct (table|db|database) access|direkte[rnm]? (tabellen|db|datenbank)|modifications?\b|modifikation|z-?programm?|z-?reports?|custom code|eigenentwicklung|kundeneigen)/
    ),
    engines: [{ engine: 'CLEAN_CORE_OBJECT_GUARD', weight: 4 }],
  },
  {
    id: 'CC.abap',
    label: 'ABAP code',
    test: re(/\babap\b/),
    engines: [{ engine: 'CLEAN_CORE_OBJECT_GUARD', weight: 2 }],
  },
  // ---------------------------------------------------------------- Integration
  {
    id: 'API.change',
    label: 'API / interface change, deprecation or breakage',
    test: all(
      re(/(odata|\bapis?\b|\brest\b|\bsoap\b|edmx|openapi|swagger|service interface|schnittstelle|\binterfaces?\b)/),
      re(/(\bbreak|brechen|bricht|deprecat|veraltet|\bremoved\b|entfernt|incompatib|inkompatib|\bchange|aender|upgrade|\brelease\b|version)/)
    ),
    engines: [{ engine: 'API_CHANGE_GUARD', weight: 4 }],
  },
  {
    id: 'CP.explicit',
    label: 'ALE change pointers / IDoc replication',
    test: re(/(change pointers?|aenderungszeiger|\bbd21\b|\bbd52\b|\bbd61\b|\bbd50\b|\bbdcp2?\b|\bale\b|\bidocs?\b|matmas|debmas|cremas|replicat|replizier|\bverteil)/),
    engines: [{ engine: 'CHANGE_POINTER_COVERAGE_AUDITOR', weight: 3 }],
  },
  {
    id: 'CP.not-replicated',
    label: 'master data changes not distributed',
    test: all(
      re(/(change pointers?|aenderungszeiger|\bidocs?\b|matmas|debmas|cremas|replicat|replizier|\bverteil|distribution)/),
      NEGATION
    ),
    engines: [{ engine: 'CHANGE_POINTER_COVERAGE_AUDITOR', weight: 2 }],
  },
  // ---------------------------------------------------------------- Release & transport
  {
    id: 'TR.explicit',
    label: 'transport requests / CTS',
    test: re(/(\btransports?\b|trkorr|\bcts\b|\bstms\b|import queue|importqueue|transportauftrag|transportreihenfolge|\b[a-z0-9]{3}k9\d{5}\b)/),
    engines: [{ engine: 'TRANSPORT_DEPENDENCY_ANALYZER', weight: 3 }],
  },
  {
    id: 'TR.sequence',
    label: 'transport order / missing dependency / collision',
    test: all(
      re(/(\btransports?\b|transportauftr|\bimport\b|\bcts\b)/),
      re(/(order|sequence|reihenfolge|missing|fehlt|depend|abhaengig|collision|kollision|overwrite|ueberschreib|\bfails?\b|return code 8|\brc ?8\b|earlier)/)
    ),
    engines: [{ engine: 'TRANSPORT_DEPENDENCY_ANALYZER', weight: 2 }],
  },
  {
    id: 'SWC.explicit',
    label: 'key-user software collections',
    test: re(/(software collections?|softwarekollektion|export software collection|extensibility items?|key[- ]user (transport|export))/),
    engines: [{ engine: 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', weight: 5 }],
  },
  {
    id: 'EIG.impact',
    label: 'impact of changing / deleting an extension',
    test: any(
      re(/(extension impact|blast radius|where[- ]used|verwendungsnachweis)/),
      all(
        re(/(delet|loesch|remov|entfern|retire|aender|chang)/),
        re(/(extension|erweiterung|custom field|cds view|\bbadi\b|yy1_|zz1_)/),
        re(/(impact|break|what happens|auswirkung|kaputt|dependen|abhaengig|consumer|verwend)/)
      )
    ),
    engines: [{ engine: 'EXTENSION_IMPACT_GUARD', weight: 5 }],
  },
  // ---------------------------------------------------------------- Operations
  {
    id: 'DECOM.user',
    label: 'retiring / deleting a user or technical account',
    test: all(
      re(/(decommission|stilll?eg|deactivat|deaktivier|\block\b|sperren|\bdelet|loesch|retire|abschalt|\bremov|safe(ly)? to)/),
      re(/(\busers?\b|benutzer|account|konto|technical user|batch user|rfc user|service user)/)
    ),
    engines: [{ engine: 'SAFE_DECOMMISSION_PREFLIGHT', weight: 4 }],
  },
  {
    id: 'F403.explicit',
    label: 'HTTP 403 / missing authorization',
    test: re(/(\b403\b|forbidden|not authori[sz]ed|keine berechtigung|berechtigung fehlt|fehlende berechtigung|\bsu53\b|s_service|s_start|\/iwfnd)/),
    engines: [{ engine: 'FIORI_403_ROOT_CAUSE_DOCTOR', weight: 4 }],
  },
  {
    id: 'F403.fiori-auth',
    label: 'Fiori app / OData authorization',
    test: all(re(/(fiori|\bapp\b|\btile\b|kachel|odata|launchpad)/), re(/(authori[sz]|berechtig|access denied|zugriff verweigert|cannot open|laesst sich nicht oeffnen)/)),
    engines: [{ engine: 'FIORI_403_ROOT_CAUSE_DOCTOR', weight: 3 }],
  },
  {
    id: 'WF.stuck',
    label: 'workflow / work item stuck',
    test: all(
      re(/(workflow|work ?items?|workitem|swwwihead|\bswi1\b|genehmigung|approval|freigabe)/),
      re(/(stuck|haengt|haengen|haengend|blocked|blockiert|not (processed|moving|forwarded|arriving)|no agent|kein bearbeiter|keinen bearbeiter|waiting|wartet|status ready|in process)/)
    ),
    engines: [{ engine: 'WORKFLOW_STUCK_EXPLAINER', weight: 5 }],
  },
  {
    id: 'WF.explicit',
    label: 'workflow mentioned',
    test: re(/(workflow|work ?items?|workitem|swwwihead)/),
    engines: [{ engine: 'WORKFLOW_STUCK_EXPLAINER', weight: 2 }],
  },
  {
    id: 'IAM.licence',
    label: 'licence / authorization cost optimisation',
    test: all(
      re(/(licen[cs]es?|lizenz|\bfue\b|full use equivalent|\bcosts?\b|kosten|pay too much|zu viel|price|downgrade|over-?licens|optimi[sz])/),
      re(/(roles?\b|rolle|\busers?\b|benutzer|fiori|catalog|katalog|authori[sz]ation|berechtigung)/)
    ),
    engines: [{ engine: 'IAM_COST_OPTIMIZER', weight: 5 }],
  },
  {
    id: 'ACCT.explicit',
    label: 'automatic account determination',
    test: re(/(account determination|kontenfindung|\bobyc\b|\bvkoa\b|g\/l account|gl account|sachkonto|hauptbuchkonto|valuation class|bewertungsklasse|\bwrx\b|\bbsx\b|\bgbb\b|revenue account|erloeskonto|umsatzerloes)/),
    engines: [{ engine: 'ACCOUNT_DETERMINATION_PREFLIGHT', weight: 5 }],
  },
  {
    id: 'SR.refresh',
    label: 'system refresh / system copy',
    test: re(/(system refresh|systemrefresh|system copy|systemkopie|client copy|mandantenkopie|\bbdls\b|post-?copy|nach dem refresh|after the refresh)/),
    engines: [{ engine: 'SYSTEM_REFRESH_DELTA_GUARD', weight: 4 }],
  },
  {
    id: 'SR.connectivity',
    label: 'connections still pointing to the wrong system after a copy',
    test: all(
      re(/(\brfc\b|destination|logical system|logisches system|\bscot\b|printer|drucker|batch jobs?)/),
      re(/(refresh|system copy|systemkopie|kopie|production|produktiv|\bprd\b|\bprod\b)/)
    ),
    engines: [{ engine: 'SYSTEM_REFRESH_DELTA_GUARD', weight: 2 }],
  },
  {
    id: 'MFS.explicit',
    label: 'warehouse material flow / conveyor telegrams',
    test: re(/(\bmfs\b|material flow|materialfluss|conveyor|foerdertechnik|foerderanlage|telegram|\bplc\b|\bsps\b|handling units?|\bhu_|ewm-mfs|lagerautomati|warehouse automation)/),
    engines: [{ engine: 'MFS_BLACKBOX', weight: 5 }],
  },
];

/** Object-identifier patterns (applied to the optional "object identifier" input, upper-cased). */
export const OBJECT_RULES: Array<{ id: string; label: string; pattern: RegExp; engine: EngineType; weight: number }> = [
  { id: 'OBJ.custom-field', label: 'key-user custom field', pattern: /^(YY1|ZZ1)_[A-Z0-9_]+$/, engine: 'CUSTOM_FIELD_FLOW_DOCTOR', weight: 3 },
  { id: 'OBJ.transport', label: 'transport request number', pattern: /^[A-Z0-9]{3}K9\d{5}$/, engine: 'TRANSPORT_DEPENDENCY_ANALYZER', weight: 4 },
  { id: 'OBJ.api', label: 'API / OData service', pattern: /^(API_[A-Z0-9_]+|[A-Z0-9_]+_SRV|[A-Z0-9_]+_CDS|\/[A-Z0-9_/]+)$/, engine: 'API_CHANGE_GUARD', weight: 3 },
  { id: 'OBJ.workflow', label: 'workflow task / work item', pattern: /^(TS|WS)\d{8}$|^\d{12}$/, engine: 'WORKFLOW_STUCK_EXPLAINER', weight: 3 },
  { id: 'OBJ.message-type', label: 'IDoc message type', pattern: /^(MATMAS|DEBMAS|CREMAS|ORDERS|ORDRSP|INVOIC|DESADV|ARTMAS|HRMD_A)\d*$/, engine: 'CHANGE_POINTER_COVERAGE_AUDITOR', weight: 3 },
  { id: 'OBJ.business-role', label: 'business role', pattern: /^SAP_BR_[A-Z0-9_]+$/, engine: 'IAM_COST_OPTIMIZER', weight: 3 },
  { id: 'OBJ.handling-unit', label: 'handling unit', pattern: /^HU_?\d+$/, engine: 'MFS_BLACKBOX', weight: 3 },
  { id: 'OBJ.output-type', label: 'output / message type', pattern: /^(NEU|BA00|RD00|LD00|PURCHASE_ORDER|BILLING_DOCUMENT)$/, engine: 'OPD_GUARD', weight: 3 },
  { id: 'OBJ.custom-object', label: 'customer (Z/Y) development object', pattern: /^[ZY][A-Z0-9_/]{2,}$/, engine: 'CLEAN_CORE_OBJECT_GUARD', weight: 3 },
];

/** Folds case and German umlauts so rules match English and German phrasing alike. */
export function normalizeProblemText(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
