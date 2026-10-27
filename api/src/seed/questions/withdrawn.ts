/**
 * Factory questions withdrawn after they were published, with the reason. The
 * importer retires them, and the validator stops their family keys being reused,
 * because learner history still points at them.
 */
export const WITHDRAWN_FAMILIES: Record<string, string> = {
  'monitoring-skipped-runs-enable-queueing': 'Tested the same fact as recovery-queue-overrunning-runs (enable queueing so skipped runs execute).',
};
