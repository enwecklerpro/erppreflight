/**
 * Deterministic Fiori 403 decision tree (free tool, Part 01 §1.11).
 *
 * The structure lives here; every question, option and outcome text lives in
 * the message dictionaries (publicTools.fiori.*). Outcome categories map 1:1 to
 * the finding codes of the FIORI_403_ROOT_CAUSE_DOCTOR engine, so the tree
 * never names a cause the engine could not confirm from evidence.
 */
export type FioriQuestionId = 'start' | 'method' | 'csrf' | 'log' | 'icf' | 'ucon' | 'btp';
export type FioriOutcomeId = 'content' | 'csrf' | 'gateway' | 'auth' | 'icf' | 'ucon' | 'connector' | 'unknown';

export type FioriNext = { question: FioriQuestionId } | { outcome: FioriOutcomeId };

export const FIORI_TREE: Record<FioriQuestionId, Record<string, FioriNext>> = {
  start: {
    content: { outcome: 'content' },
    http: { question: 'method' },
    btp: { question: 'btp' },
  },
  method: {
    modifying: { question: 'csrf' },
    read: { question: 'log' },
  },
  csrf: {
    yes: { outcome: 'csrf' },
    no: { question: 'log' },
  },
  log: {
    service: { outcome: 'gateway' },
    auth: { outcome: 'auth' },
    backend: { outcome: 'auth' },
    nothing: { question: 'icf' },
  },
  icf: {
    inactive: { outcome: 'icf' },
    active: { question: 'ucon' },
  },
  ucon: {
    yes: { outcome: 'ucon' },
    no: { outcome: 'unknown' },
  },
  btp: {
    connector: { outcome: 'connector' },
    backend: { question: 'log' },
    unsure: { outcome: 'unknown' },
  },
};

/** Review date of the tree content against the engine's rule catalog (ISO date). */
export const FIORI_TREE_REVIEWED = '2026-09-26';

export interface FioriWalk {
  /** Answered steps in order. */
  steps: Array<{ question: FioriQuestionId; answer: string }>;
  /** The question to ask next, or null when an outcome was reached. */
  current: FioriQuestionId | null;
  outcome: FioriOutcomeId | null;
}

/**
 * Replays an answer path such as "http,read,nothing" from the start question.
 * Invalid or superfluous answers are ignored (the walk stops there), so any
 * URL resolves to a valid state.
 */
export function walkFioriTree(path: string): FioriWalk {
  const answers = path.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const steps: FioriWalk['steps'] = [];
  let current: FioriQuestionId | null = 'start';
  let outcome: FioriOutcomeId | null = null;
  for (const answer of answers) {
    if (!current) break;
    const next: FioriNext | undefined = FIORI_TREE[current][answer];
    if (!next) break;
    steps.push({ question: current, answer });
    if ('outcome' in next) {
      outcome = next.outcome;
      current = null;
    } else {
      current = next.question;
    }
  }
  return { steps, current, outcome };
}
