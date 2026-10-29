/**
 * Factory questions withdrawn after they were published, with the reason. The
 * importer retires them, and the validator stops their family keys being reused,
 * because learner history still points at them.
 */
export const WITHDRAWN_FAMILIES: Record<string, string> = {
  'monitoring-skipped-runs-enable-queueing': 'Tested the same fact as recovery-queue-overrunning-runs (enable queueing so skipped runs execute).',
  'choosing-cloud-storage-standard-connector': 'Tested the same fact as patterns-standard-vs-managed-file-connectors (Auto Loader on S3 is a standard connector).',
  // Same-fact duplicates found by the whole-bank review after batch 3.
  'lakehouse-workspace-catalog-binding': 'Tested the same fact as privileges-workspace-catalog-binding (binding a catalog to specific workspaces blocks access from others).',
  'orchestration-pipeline-schedule-button-job': 'Tested the same fact as lakeflow-connect-schedule-creates-job (scheduling a pipeline creates a job with a pipeline task).',
  'tables-predictive-optimization-managed-only': 'Tested the same fact as layout-po-external-table-skipped (predictive optimization runs only on Unity Catalog managed tables).',
  'reshaping-dot-notation-array-of-structs': 'Tested the same fact as semi-structured-array-of-structs-field (dot notation on an array of structs returns an array of the field).',
  'layout-po-serverless-jobs-billing': 'Tested the same fact as compute-serverless-billing-background-features (predictive optimization is billed as serverless jobs compute).',
  'lakehouse-deletion-vectors-small-deletes': 'Tested the same fact as spark-ui-merge-output-deletion-vectors (deletion vectors avoid rewriting whole files for row-level changes).',
  'compute-serverless-standard-mode-cost': 'Tested the same fact as monitoring-serverless-standard-mode-startup (serverless standard mode costs less but starts slower than performance optimized).',
  'compute-issues-topandas-driver-oom': 'Tested the same fact as tuning-driver-max-result-size (collect() and toPandas() pull all rows to the driver).',
  'auto-loader-separate-checkpoint-per-source': 'Tested the same fact as patterns-checkpoint-one-per-query (each streaming query needs its own checkpoint).',
  'choosing-sql-streaming-table-over-copy-into': 'Tested the same fact as patterns-streaming-table-replaces-ctas (incremental file ingestion in SQL uses a streaming table over read_files).',
  'auto-loader-path-glob-filter-suffix': 'Tested the same fact as semi-structured-binaryfile-glob-partitions (pathGlobFilter filters input files by suffix).',
  'orchestration-git-source-run-snapshot': 'Tested the same fact as git-job-reads-folder-mid-update (a Git provider source gives every task in a run one commit).',
  'choosing-remote-query-existing-dialect': 'Tested the same fact as jdbc-rest-native-dialect-identifier-quoting (remote_query passes the source dialect through untranslated).',
  'control-flow-boolean-task-value-in-condition': 'Tested the same fact as control-flow-if-else-string-equality (the If/else == operator compares operands as strings).',
  'monitoring-pipeline-event-log-expectations': 'Tested the same fact as medallion-standalone-expectation-metrics (expectation metrics are in the pipeline event log).',
  'bundles-include-resource-files': 'Tested the same fact as bundle-config-shared-variables-include (more configuration files join a bundle through include).',
  'triggers-table-update-unknown-upstream-writer': 'Tested the same fact as triggers-table-update-system-billing (a table updated at unpredictable times calls for a table update trigger).',
  'lakehouse-time-travel-retention-window': 'Tested the same fact as retention-settings (time travel needs both log and data file retention).',
  'recovery-schema-evolution-needs-retries': 'Tested the same fact as autoloader-add-new-columns (Auto Loader schema evolution stops the stream and a retry picks up the new schema).',
  'jdbc-rest-write-default-mode-error': 'Tested the same fact as cleaning-save-mode-overwrite (the default errorifexists save mode fails when the table exists).',
  'semi-structured-from-json-keep-corrupt-text': 'Tested the same fact as auto-loader-corrupt-record-column (columnNameOfCorruptRecord captures malformed records).',
  'copy-into-validate-constraints': 'Tested the same fact as copyinto-validate (COPY INTO VALIDATE checks the load without writing).',
  'medallion-action-per-rule': 'Tested the same fact as expectation-drop-row (what fail, drop and warn expectations each do).',
  'triggers-file-arrival-debounce-batches': 'Tested the same fact as triggers-table-update-any-wait-partial-batches (Wait after last change gives one run per burst of updates).',
  'triggers-file-arrival-recursive-subfolders': 'Tested the same fact as triggers-five-trigger-cap-parent-folder (a file arrival trigger covers every subfolder of its path).',
  'git-pull-request-link-after-push': 'Tested the same fact as git-pull-request-protected-main (pull requests are created in the Git provider).',
};
