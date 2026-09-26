import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { extractCandidateNames } from './candidate-names';
import { extractAbapGitCandidateNames, isZipBuffer } from './abapgit-object-scan';

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

const MAX_OBJECTS = 5_000;

export { extractCandidateNames };

@Injectable()
export class ReleasedObjectsProvider {
  private readonly logger = new Logger(ReleasedObjectsProvider.name);

  constructor(private readonly knowledge: KnowledgeGraphService) {}

  /**
   * Builds the released-object list for the objects referenced in a text
   * artifact or in the members of an abapGit repository ZIP (base64). Returns
   * null (and the engine runs with its built-in rules) when the artifact is a
   * non-ZIP binary or an unsafe archive, references nothing known, or no
   * snapshot exists.
   */
  async forArtifact(
    rawContent: string | null,
    encoding: 'utf-8' | 'base64',
    targetRelease: string
  ): Promise<ReleasedObjectsConfiguration | null> {
    if (!rawContent) return null;
    let names: string[];
    if (encoding === 'utf-8') {
      names = extractCandidateNames(rawContent);
    } else {
      // Binary artifact: abapGit repository ZIPs are scanned member by member (bounded, safety-checked).
      const buffer = Buffer.from(rawContent, 'base64');
      if (!isZipBuffer(buffer)) return null;
      try {
        names = (await extractAbapGitCandidateNames(buffer)).names;
      } catch (err: any) {
        // Unsafe / unreadable archive: the engine rejects it with its own diagnostics; no overlay.
        this.logger.warn(`abapGit object scan skipped: ${err?.message ?? err}`);
        return null;
      }
    }
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
