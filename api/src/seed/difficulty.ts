import { QuestionFamily } from '../models/index.js';

/**
 * Level Up difficulty for the pilot fixtures: 1 recalls a fact or command,
 * 2 applies it to a situation, 3 is a scenario, an edge case or a trap.
 * Families not listed (story questions) keep the default of 1.
 */
export const SEED_DIFFICULTY: Record<string, 1 | 2 | 3> = {
  // Platform
  'serverless-benefit': 1,
  'photon-engine': 1,
  'lakehouse-definition': 1,
  'delta-transaction-log': 2,
  'job-compute': 2,
  'type-delta-log': 3,
  // Ingestion
  'autoloader-format': 1,
  'autoloader-state': 1,
  'copyinto-idempotent': 1,
  'copyinto-force': 1,
  'autoloader-schema-location': 2,
  'copyinto-merge-schema': 2,
  'copyinto-validate': 2,
  'match-ingestion-tools': 2,
  'autoloader-rescue-mode': 3,
  'autoloader-add-new-columns': 3,
  'copyinto-vs-autoloader': 3,
  // Transformation
  'vacuum-purpose': 1,
  'version-query': 1,
  'describe-history': 1,
  'medallion-silver': 1,
  'merge-upsert': 1,
  'timestamp-travel': 1,
  'retained-files': 1,
  'restore-version': 1,
  'order-medallion': 1,
  'history-versus-data': 2,
  'retention-settings': 2,
  'vacuum-default-retention': 2,
  'change-data-feed': 2,
  'expectation-drop-row': 2,
  'vacuum-dry-run': 2,
  'match-delta-commands': 2,
  'type-vacuum': 2,
  'type-version-as-of': 2,
  'vacuum-breaks-time-travel': 3,
  'log-retention-property': 3,
  'short-retention-risk': 3,
  'merge-duplicate-source': 3,
  'merge-not-matched-by-source': 3,
  'insert-only-merge': 3,
  'order-restore-steps': 3,
  'listen-merge-duplicates': 3,
  // Jobs
  'task-dependencies': 1,
  'task-retries': 1,
  'file-arrival-trigger': 2,
  'repair-run': 2,
  'task-values': 3,
  // CI/CD
  'bundle-config-file': 1,
  'git-feature-branch': 1,
  'bundle-deploy': 2,
  'git-pull': 2,
  'listen-bundle-file': 2,
  'bundle-dev-mode': 3,
  // Troubleshooting
  'optimize-small-files': 1,
  'zorder-skipping': 2,
  'liquid-clustering': 2,
  'task-skew': 3,
  'disk-spill': 3,
  // Governance
  'three-level-namespace': 1,
  'metastore-top-level': 1,
  'volumes-files': 1,
  'order-uc-namespace': 1,
  'grant-select-syntax': 2,
  'privilege-inheritance': 2,
  'managed-table-lifecycle': 2,
  'who-can-grant': 2,
  'external-table-drop': 3,
  'query-table-privileges': 3,
  'row-level-view': 3,
};

/** Sets fixture difficulties, idempotently. Only families the seed created are touched. */
export async function applySeedDifficulty(examVersionId: string, reviewerId: string) {
  const ops = Object.entries(SEED_DIFFICULTY).map(([familyKey, difficulty]) => ({
    updateOne: { filter: { examVersionId, familyKey, createdBy: reviewerId, difficulty: { $ne: difficulty } }, update: { $set: { difficulty } } },
  }));
  if (ops.length) await QuestionFamily.bulkWrite(ops);
}
