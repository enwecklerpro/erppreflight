import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeGraphService } from './knowledge-graph.service';

/** Configuration key carrying the snapshot-derived list (python: knowledge_client.CONFIG_KEYS). */
export const RELEASED_OBJECTS_CONFIG_KEY = 'released_objects';

/**
 * Contract of `configuration.released_objects` sent to the Python analysis
 * service for CLEAN_CORE_OBJECT_GUARD (documented in docs/KNOWLEDGE_GRAPH.md
 * and parsed by services/analysis-python/src/platform/knowledge_client.py).
 * Additive: engines that do not read it behave exactly as before.
 */
export interface ReleasedObjectsConfiguration {
  schemaVersion: 1;
  source: string;
  snapshotId: string;
  snapshotSeq: number;
  contentSha256: string;
  release: {
    productCode: string;
    editionCode: string;
    releaseCode: string;
    label: string;
    exactMatch: boolean;
    note?: string;
  };
  objects: Array<{
    objectType: string;
    objectName: string;
    tadirObject: string | null;
    state: string | null;
    cleanCoreLevel: string | null;
    classicApiState: string | null;
    successorClassification: string | null;
    successorConcept: string | null;
    successors: Array<{ objectType: string; objectName: string }>;
  }>;
}

/** Engines that receive the snapshot-derived released-object list. */
export const KNOWLEDGE_AWARE_ENGINES = new Set(['CLEAN_CORE_OBJECT_GUARD']);

const MAX_CANDIDATES = 20_000;
const MAX_OBJECTS = 5_000;

/**
 * Candidate SAP object names referenced by an artifact: ABAP-style identifiers
 * (incl. namespaces like /BOBF/CL_X). Deliberately over-inclusive: only names
 * that exist in the knowledge graph are forwarded to the engine.
 */
export function extractCandidateNames(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:\/[A-Z0-9_]{1,10}\/)?[A-Z_][A-Z0-9_]{2,59}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[0].toUpperCase());
    if (out.size >= MAX_CANDIDATES) break;
  }
  return [...out];
}

@Injectable()
export class ReleasedObjectsProvider {
  private readonly logger = new Logger(ReleasedObjectsProvider.name);

  constructor(private readonly knowledge: KnowledgeGraphService) {}

  /**
   * Builds the released-object list for the objects referenced in a text
   * artifact. Returns null (and the engine runs with its built-in rules) when
   * the artifact is binary, references nothing known, or no snapshot exists.
   */
  async forArtifact(
    rawContent: string | null,
    encoding: 'utf-8' | 'base64',
    targetRelease: string
  ): Promise<ReleasedObjectsConfiguration | null> {
    if (!rawContent || encoding !== 'utf-8') return null;
    const names = extractCandidateNames(rawContent);
    if (names.length === 0) return null;
    try {
      const result = await this.knowledge.classifyObjects({ names, targetRelease });
      return {
        schemaVersion: 1,
        source: result.source,
        snapshotId: result.snapshotId,
        snapshotSeq: result.snapshotSeq,
        contentSha256: result.contentSha256,
        release: {
          productCode: result.release.productCode,
          editionCode: result.release.editionCode,
          releaseCode: result.release.releaseCode,
          label: result.release.label,
          exactMatch: result.release.exactMatch,
          ...(result.release.note ? { note: result.release.note } : {}),
        },
        objects: result.objects.slice(0, MAX_OBJECTS).map((o) => ({
          objectType: o.sapObjectType,
          objectName: o.name,
          tadirObject: o.tadirObject,
          state: o.state,
          cleanCoreLevel: o.cleanCoreLevel,
          classicApiState: o.classicApiState,
          successorClassification: o.successorClassification,
          successorConcept: o.successorConcept,
          successors: o.successors.map((x) => ({ objectType: x.objectType, objectName: x.name })),
        })),
      };
    } catch (err: any) {
      // No snapshot yet / DB hiccup: the analysis continues with engine-internal rules.
      this.logger.warn(`Released-object list unavailable: ${err?.message ?? err}`);
      return null;
    }
  }
}
