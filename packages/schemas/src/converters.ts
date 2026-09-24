import {
  AnalysisJobRequest,
  AnalysisJobRequestWire,
  AnalysisJobRequestWireSchema,
  AnalysisJobRequestSchema,
  AnalysisJobResponse,
  AnalysisJobResponseWire,
  AnalysisJobResponseWireSchema,
  AnalysisJobResponseSchema,
} from './analysis';
import {
  Finding,
  FindingWire,
  FindingWireSchema,
  FindingSchema,
} from './finding';

export function toWireJobRequest(req: AnalysisJobRequest | Record<string, unknown>): AnalysisJobRequestWire {
  return AnalysisJobRequestWireSchema.parse(req);
}

export function fromWireJobRequest(wire: AnalysisJobRequestWire | Record<string, unknown>): AnalysisJobRequest {
  return AnalysisJobRequestSchema.parse(wire);
}

export function toWireFinding(finding: Finding | Record<string, unknown>): FindingWire {
  return FindingWireSchema.parse(finding);
}

export function fromWireFinding(wire: FindingWire | Record<string, unknown>): Finding {
  return FindingSchema.parse(wire);
}

export function toWireJobResponse(res: AnalysisJobResponse | Record<string, unknown>): AnalysisJobResponseWire {
  return AnalysisJobResponseWireSchema.parse(res);
}

export function fromWireJobResponse(wire: AnalysisJobResponseWire | Record<string, unknown>): AnalysisJobResponse {
  return AnalysisJobResponseSchema.parse(wire);
}
