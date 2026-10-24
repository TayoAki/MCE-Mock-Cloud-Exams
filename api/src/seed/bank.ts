/**
 * Development content for the pilot bank (Databricks Data Engineer Associate).
 *
 * Every item is an original DRAFT written for this reference build. None has had
 * independent subject-matter review, and none is a recalled exam question. The
 * seed marks them reviewed and published only so the app can be exercised; that
 * is a test fixture, not evidence of content approval.
 */

export const REVIEW_NOTE = 'Illustrative draft; independent subject-matter review not yet performed.';

const DOCS = 'https://docs.databricks.com/aws/en';
const SRC = {
  history: 'https://learn.microsoft.com/en-us/azure/databricks/tables/history',
  vacuum: 'https://learn.microsoft.com/en-us/azure/databricks/sql/language-manual/delta-vacuum',
  merge: `${DOCS}/sql/language-manual/delta-merge-into`,
  cdf: `${DOCS}/delta/delta-change-data-feed`,
  restore: `${DOCS}/sql/language-manual/delta-restore`,
  medallion: `${DOCS}/lakehouse/medallion`,
  expectations: `${DOCS}/dlt/expectations`,
  autoLoader: `${DOCS}/ingestion/cloud-object-storage/auto-loader/`,
  autoLoaderSchema: `${DOCS}/ingestion/cloud-object-storage/auto-loader/schema`,
  copyInto: `${DOCS}/sql/language-manual/delta-copy-into`,
  ingestion: `${DOCS}/ingestion/`,
  unityCatalog: `${DOCS}/data-governance/unity-catalog/`,
  volumes: `${DOCS}/volumes/`,
  privileges: `${DOCS}/data-governance/unity-catalog/manage-privileges/privileges`,
  jobs: `${DOCS}/jobs/`,
  taskValues: `${DOCS}/jobs/task-values`,
  repair: `${DOCS}/jobs/repair-job-failures`,
  optimize: `${DOCS}/sql/language-manual/delta-optimize`,
  clustering: `${DOCS}/delta/clustering`,
  sparkUi: `${DOCS}/optimizations/spark-ui-guide/`,
  bundles: `${DOCS}/dev-tools/bundles/`,
  bundleModes: `${DOCS}/dev-tools/bundles/deployment-modes`,
  git: `${DOCS}/repos/`,
  serverless: `${DOCS}/compute/serverless/`,
  compute: `${DOCS}/compute/`,
  photon: `${DOCS}/compute/photon`,
  delta: `${DOCS}/delta/`,
  lakehouse: `${DOCS}/lakehouse/`,
};

export interface SeedDomain {
  code: string;
  title: string;
  weight: number;
  objectives: { code: string; title: string }[];
}

/** Weights from the plan's reference snapshot; they total 100. */
export const DOMAINS: SeedDomain[] = [
  {
    code: 'platform',
    title: 'Databricks Intelligence Platform',
    weight: 6,
    objectives: [
      { code: 'platform.compute', title: 'Compute types and serverless' },
      { code: 'platform.lakehouse', title: 'Lakehouse and Delta Lake fundamentals' },
    ],
  },
  {
    code: 'ingestion',
    title: 'Data ingestion and loading',
    weight: 21,
    objectives: [
      { code: 'ingestion.auto-loader', title: 'Auto Loader incremental ingestion' },
      { code: 'ingestion.copy-into', title: 'COPY INTO batch loading' },
    ],
  },
  {
    code: 'transformation',
    title: 'Data transformation and modeling',
    weight: 22,
    objectives: [
      { code: 'transformation.time-travel', title: 'Time travel and retained files' },
      { code: 'transformation.cleanup', title: 'File cleanup and retention' },
      { code: 'transformation.merge', title: 'MERGE, upserts and change data' },
      { code: 'transformation.medallion', title: 'Medallion layers and data quality' },
    ],
  },
  {
    code: 'jobs',
    title: 'Working with Lakeflow Jobs',
    weight: 16,
    objectives: [
      { code: 'jobs.orchestration', title: 'Tasks, dependencies and triggers' },
      { code: 'jobs.recovery', title: 'Retries and repair runs' },
    ],
  },
  {
    code: 'cicd',
    title: 'Implementing CI/CD',
    weight: 10,
    objectives: [
      { code: 'cicd.bundles', title: 'Databricks Asset Bundles' },
      { code: 'cicd.git', title: 'Git folders' },
    ],
  },
  {
    code: 'troubleshooting',
    title: 'Troubleshooting and optimization',
    weight: 10,
    objectives: [
      { code: 'troubleshooting.layout', title: 'Data layout: OPTIMIZE, Z-order and liquid clustering' },
      { code: 'troubleshooting.spark-ui', title: 'Diagnosing slow queries' },
    ],
  },
  {
    code: 'governance',
    title: 'Governance and security',
    weight: 15,
    objectives: [
      { code: 'governance.namespace', title: 'Unity Catalog object model' },
      { code: 'governance.privileges', title: 'Privileges and access' },
    ],
  },
];

export interface SeedQuestion {
  family: string;
  objective: string;
  prompt: string;
  options: string[];
  /** One letter for single answer; several for multiple answer. */
  correct: string | string[];
  rationale: string;
  source: string;
}

const q = (family: string, objective: string, prompt: string, options: string[], correct: string | string[], rationale: string, source: string): SeedQuestion => ({
  family,
  objective,
  prompt,
  options,
  correct,
  rationale,
  source,
});

export interface SeedLesson {
  title: string;
  summary: string;
  kind?: 'learn' | 'checkpoint';
  questions: SeedQuestion[];
}

export interface SeedUnit {
  title: string;
  subtitle: string;
  lessons: SeedLesson[];
}

export const UNITS: SeedUnit[] = [
  {
    title: 'Delta Lake',
    subtitle: 'Keep your data reliable',
    lessons: [
      {
        title: 'Time travel',
        summary: 'History, retention, and table versions.',
        // The plan's five original sample items, unchanged. Answers A, B, B, A, D score 3/5.
        questions: [
          q('retained-files', 'transformation.time-travel', 'What is needed to query an older table version?', ['Its retained log and data files', 'Only the latest table version', 'Only its history entry', 'A new table name'], 'A', 'An older version needs its corresponding log and data files.', SRC.history),
          q('history-versus-data', 'transformation.time-travel', 'Does table history guarantee that old data is still available?', ['No. Required files may be removed.', 'Yes. History keeps every data file.', 'Only if the table gets larger.', 'Yes. Old versions last forever.'], 'A', 'History is not a data archive. Cleanup can remove files an older version needs.', SRC.history),
          q('vacuum-purpose', 'transformation.cleanup', 'What can VACUUM remove from a Delta table?', ['Every row in the latest version', 'Unused data files beyond the retention threshold', 'Only the table name', 'Only active streaming checkpoints'], 'B', 'VACUUM can remove unused data files after the retention threshold.', SRC.vacuum),
          q('version-query', 'transformation.time-travel', 'Which query requests version 12 of sales?', ['SELECT * FROM sales VERSION AS OF 12', 'SELECT * FROM sales ONLY VERSION 12', 'RESTORE SELECT sales VERSION 12', 'SELECT HISTORY(12) FROM sales'], 'A', 'VERSION AS OF selects a historical table version when its required files remain available.', SRC.history),
          q('retention-settings', 'transformation.time-travel', 'A team needs a 30-day-old snapshot. What should it check?', ['Only current storage capacity', 'Only the latest version number', 'Both log and data file retention', 'Only the table owner'], 'C', 'Both retention settings matter when planning access to older versions.', SRC.history),
        ],
      },
      {
        title: 'Cleanup',
        summary: 'What changes when files are removed?',
        questions: [
          q('vacuum-default-retention', 'transformation.cleanup', 'What retention threshold does VACUUM use by default before removing unreferenced data files?', ['7 days', '24 hours', '30 days', 'There is no default; you must always pass one'], 'A', 'The default threshold is 7 days (168 hours). You can change it with RETAIN or the delta.deletedFileRetentionDuration table property.', SRC.vacuum),
          q('vacuum-breaks-time-travel', 'transformation.cleanup', 'After VACUUM removes old files, what happens to a time travel query for a version that needed them?', ['It can fail because the required data files are gone', 'It is rebuilt automatically from the transaction log', 'It silently returns the latest version', 'It succeeds but runs more slowly'], 'A', 'The log records which files a version used, but it does not contain the data. Once VACUUM deletes those files, that version can no longer be read.', SRC.vacuum),
          q('log-retention-property', 'transformation.cleanup', 'Which table property controls how long Delta keeps transaction log history?', ['delta.logRetentionDuration', 'delta.deletedFileRetentionDuration', 'delta.autoOptimize.optimizeWrite', 'delta.enableChangeDataFeed'], 'A', 'delta.logRetentionDuration (30 days by default) controls log history. delta.deletedFileRetentionDuration sets how long removed data files are kept before VACUUM can delete them.', SRC.history),
          q('vacuum-dry-run', 'transformation.cleanup', 'How can you preview which files VACUUM would delete without deleting anything?', ['VACUUM events DRY RUN', 'DESCRIBE HISTORY events', 'OPTIMIZE events DRY RUN', 'VACUUM events RETAIN 0 HOURS'], 'A', 'DRY RUN lists files that would be removed without deleting them. RETAIN 0 HOURS would actually delete aggressively.', SRC.vacuum),
          q('short-retention-risk', 'transformation.cleanup', 'Why does Databricks warn you before running VACUUM with a retention shorter than the default?', ['Readers or writers may still need files that would be removed', 'Short retention makes OPTIMIZE slower', 'It disables the transaction log', 'It converts the table to plain Parquet'], 'A', 'Long-running queries and streams can still be reading older snapshots. Deleting their files too early can make them fail, so a safety check blocks very short retention by default.', SRC.vacuum),
        ],
      },
      {
        title: 'MERGE and upserts',
        summary: 'Update and insert in one step.',
        questions: [
          q('merge-upsert', 'transformation.merge', 'Which statement updates matching rows and inserts new rows from a source into a Delta table in one operation?', ['MERGE INTO', 'INSERT OVERWRITE', 'COPY INTO', 'CREATE OR REPLACE TABLE ... AS SELECT'], 'A', 'MERGE INTO matches source rows to target rows on a condition, then applies WHEN MATCHED and WHEN NOT MATCHED actions in one atomic operation.', SRC.merge),
          q('merge-duplicate-source', 'transformation.merge', 'A MERGE fails because several source rows match the same target row. What is the most direct fix?', ['Deduplicate the source so each key appears once', 'Run OPTIMIZE on the target first', 'Switch the job to INSERT INTO', 'Use a larger cluster'], 'A', 'MERGE cannot decide which source row should update a target row when several match. Deduplicate or aggregate the source on the merge key first.', SRC.merge),
          q('merge-not-matched-by-source', 'transformation.merge', 'Which MERGE clause acts on target rows that have no match in the source, for example to delete them?', ['WHEN NOT MATCHED BY SOURCE', 'WHEN NOT MATCHED', 'WHEN MATCHED', 'ON CONFLICT DO NOTHING'], 'A', 'WHEN NOT MATCHED (BY TARGET) handles source rows missing from the target, usually to insert them. WHEN NOT MATCHED BY SOURCE handles target rows missing from the source.', SRC.merge),
          q('insert-only-merge', 'transformation.merge', 'Why might a pipeline use a MERGE with only WHEN NOT MATCHED THEN INSERT when loading events?', ['To insert only records whose keys are not already present', 'To overwrite the whole table', 'To compact small files', 'To remove old table versions'], 'A', 'An insert-only merge skips records that already exist, which avoids duplicates when the same events can arrive more than once.', SRC.merge),
          q('change-data-feed', 'transformation.merge', 'What does enabling Change Data Feed on a Delta table provide?', ['Row-level change records between table versions', 'Automatic schema inference for JSON files', 'A copy of the table in another region', 'An index for faster point lookups'], 'A', 'With delta.enableChangeDataFeed set, Delta records inserts, updates and deletes so downstream jobs can read only what changed.', SRC.cdf),
        ],
      },
      {
        title: 'Checkpoint',
        summary: 'Fresh scenarios from this unit.',
        kind: 'checkpoint',
        questions: [
          q('restore-version', 'transformation.time-travel', 'A bad write corrupted the sales table. Which command returns the table itself to an earlier version?', ['RESTORE TABLE sales TO VERSION AS OF 41', 'VACUUM sales RETAIN 41 HOURS', 'SELECT * FROM sales VERSION AS OF 41', 'DESCRIBE HISTORY sales LIMIT 41'], 'A', 'RESTORE writes a new commit that makes the table match the earlier version. SELECT ... VERSION AS OF only reads the old version.', SRC.restore),
          q('describe-history', 'transformation.time-travel', 'Which command lists a Delta table’s versions, operations and timestamps?', ['DESCRIBE HISTORY', 'DESCRIBE DETAIL', 'SHOW TBLPROPERTIES', 'SHOW PARTITIONS'], 'A', 'DESCRIBE HISTORY returns one row per commit, including the version, timestamp and operation. DESCRIBE DETAIL describes the current table.', SRC.history),
          q('timestamp-travel', 'transformation.time-travel', 'Which query reads the orders table as it was at a point in time?', ["SELECT * FROM orders TIMESTAMP AS OF '2026-10-01'", "SELECT * FROM orders AT TIME '2026-10-01'", "SELECT * FROM orders WHERE _version = '2026-10-01'", "RESTORE orders AS OF '2026-10-01'"], 'A', 'TIMESTAMP AS OF selects the version that was current at that time, if its files are still retained.', SRC.history),
          q('medallion-silver', 'transformation.medallion', 'In a medallion architecture, which layer usually holds cleaned, validated and conformed data?', ['Silver', 'Bronze', 'Gold', 'Landing'], 'A', 'Bronze keeps raw ingested data, silver holds cleaned and conformed records, and gold holds business-level aggregates.', SRC.medallion),
          q('expectation-drop-row', 'transformation.medallion', 'In Lakeflow Declarative Pipelines, what does an expectation with ON VIOLATION DROP ROW do?', ['Drops invalid records and reports them in pipeline metrics', 'Fails the update immediately', 'Keeps invalid records and only logs them', 'Moves invalid records to a quarantine table automatically'], 'A', 'Without an action, invalid records are kept and counted. DROP ROW removes them; FAIL UPDATE stops the update.', SRC.expectations),
        ],
      },
    ],
  },
  {
    title: 'Ingestion',
    subtitle: 'Load new data incrementally',
    lessons: [
      {
        title: 'Auto Loader',
        summary: 'Process new files as they arrive.',
        questions: [
          q('autoloader-format', 'ingestion.auto-loader', 'Which source format do you use to read files with Auto Loader in a stream?', ['cloudFiles', 'autoloader', 'delta', 'kafka'], 'A', 'Auto Loader is the cloudFiles source: spark.readStream.format("cloudFiles") with options such as cloudFiles.format.', SRC.autoLoader),
          q('autoloader-state', 'ingestion.auto-loader', 'How does Auto Loader avoid reprocessing files it has already ingested?', ['It records discovered files in the stream’s checkpoint location', 'It deletes source files after reading them', 'It compares file sizes on every run', 'It reads the target table’s VACUUM history'], 'A', 'Auto Loader keeps file discovery state in the checkpoint, which gives exactly-once ingestion across restarts.', SRC.autoLoader),
          q('autoloader-schema-location', 'ingestion.auto-loader', 'What is cloudFiles.schemaLocation used for?', ['Storing the inferred schema and how it changes over time', 'Choosing where ingested data is written', 'Listing folders to ignore', 'Setting the maximum file size'], 'A', 'Auto Loader saves the inferred schema at schemaLocation so it can reuse and evolve it across runs.', SRC.autoLoaderSchema),
          q('autoloader-rescue-mode', 'ingestion.auto-loader', "With schema evolution mode 'rescue', where do values that don't fit the schema go?", ['Into the _rescued_data column', 'They are silently dropped', 'Into a separate error table automatically', 'The stream fails until the schema is updated'], 'A', 'In rescue mode the schema never evolves and the stream does not fail; unexpected data is captured in the rescued data column.', SRC.autoLoaderSchema),
          q('autoloader-add-new-columns', 'ingestion.auto-loader', 'With the default schema evolution mode (addNewColumns), what happens when files contain a new column?', ['The stream stops, and after a restart the new column is in the schema', 'The new column is ignored permanently', 'The whole file is skipped', 'The target table is recreated'], 'A', 'addNewColumns updates the stored schema and fails the stream so it can restart with the new column. Restarting is usually automated with job retries.', SRC.autoLoaderSchema),
        ],
      },
      {
        title: 'COPY INTO',
        summary: 'Repeatable batch loads.',
        questions: [
          q('copyinto-idempotent', 'ingestion.copy-into', 'You run the same COPY INTO command twice over the same folder. What happens to files that were already loaded?', ['They are skipped', 'They are loaded again, creating duplicates', 'The command fails', 'The table is truncated and reloaded'], 'A', 'COPY INTO tracks loaded files and skips them on later runs, so re-running it is safe.', SRC.copyInto),
          q('copyinto-force', 'ingestion.copy-into', 'Which option makes COPY INTO load files it has already loaded?', ["COPY_OPTIONS ('force' = 'true')", "FORMAT_OPTIONS ('mergeSchema' = 'true')", "PATTERN = '*'", 'VALIDATE ALL'], 'A', 'force = true disables the skip for previously loaded files. Use it deliberately, because it can create duplicates.', SRC.copyInto),
          q('copyinto-vs-autoloader', 'ingestion.copy-into', 'A folder receives millions of files continuously. Which approach is generally recommended?', ['Auto Loader', 'COPY INTO run every minute', 'CREATE TABLE AS SELECT on each run', 'Manual uploads'], 'A', 'COPY INTO suits repeatable loads of thousands of files. Auto Loader scales to millions of files and continuous arrival.', SRC.ingestion),
          q('copyinto-merge-schema', 'ingestion.copy-into', 'Which option lets COPY INTO evolve the target table schema when files contain new columns?', ["COPY_OPTIONS ('mergeSchema' = 'true')", "COPY_OPTIONS ('force' = 'true')", "FILES = ('new_column')", 'VALIDATE 10 ROWS'], 'A', 'mergeSchema in COPY_OPTIONS allows the target schema to evolve to match incoming data.', SRC.copyInto),
          q('copyinto-validate', 'ingestion.copy-into', 'What does adding VALIDATE to a COPY INTO statement do?', ['Checks the data can be parsed and loaded without writing it', 'Loads the data and then checks constraints', 'Deletes invalid files from the source', 'Grants SELECT on the target table'], 'A', 'VALIDATE runs a check of the data to load and returns the result without writing to the table.', SRC.copyInto),
        ],
      },
    ],
  },
  {
    title: 'Unity Catalog',
    subtitle: 'Govern data and access',
    lessons: [
      {
        title: 'Catalogs and tables',
        summary: 'The three-level namespace.',
        questions: [
          q('three-level-namespace', 'governance.namespace', 'How do you fully qualify a table name in Unity Catalog?', ['catalog.schema.table', 'metastore.table', 'workspace.database.table.column', 'schema.table only'], 'A', 'Unity Catalog uses a three-level namespace: catalog, then schema, then table (or view, volume or function).', SRC.unityCatalog),
          q('metastore-top-level', 'governance.namespace', 'What is the top-level container for Unity Catalog metadata?', ['The metastore', 'A schema', 'A cluster', 'A Git folder'], 'A', 'A metastore holds catalogs and the permissions on them. Workspaces attach to a metastore in their region.', SRC.unityCatalog),
          q('external-table-drop', 'governance.namespace', 'What happens to the data files when you drop an external table in Unity Catalog?', ['They stay at their storage location', 'They are deleted immediately', 'They move to the metastore root', 'The table becomes a managed table'], 'A', 'Dropping an external table removes only its metadata. The files remain where they are.', SRC.unityCatalog),
          q('managed-table-lifecycle', 'governance.namespace', 'Who manages the storage and data lifecycle of a Unity Catalog managed table?', ['Unity Catalog', 'The last user who queried it', 'The cloud provider’s backup service', 'The external location owner only'], 'A', 'For managed tables, Unity Catalog manages where data is stored and removes it after the table is dropped.', SRC.unityCatalog),
          q('volumes-files', 'governance.namespace', 'Which Unity Catalog object governs access to non-tabular files such as CSVs or images?', ['A volume', 'A view', 'A function', 'A share'], 'A', 'Volumes are Unity Catalog objects for files. They use the same catalog.schema.volume namespace and privileges.', SRC.volumes),
        ],
      },
      {
        title: 'Privileges',
        summary: 'Who can see and change what.',
        questions: [
          q('query-table-privileges', 'governance.privileges', 'A user needs to query main.sales.orders. Which privileges are required? (Choose three.)', ['USE CATALOG on main', 'USE SCHEMA on main.sales', 'SELECT on main.sales.orders', 'MODIFY on main.sales.orders', 'CREATE TABLE on main.sales'], ['A', 'B', 'C'], 'Reading a table needs SELECT on it plus USE CATALOG and USE SCHEMA on its parents. MODIFY and CREATE TABLE are for writing.', SRC.privileges),
          q('privilege-inheritance', 'governance.privileges', 'You grant SELECT on a schema. Which tables does it apply to?', ['All current and future tables in that schema', 'Only tables that exist at grant time', 'Only tables the grantor owns', 'None until each table is granted again'], 'A', 'Privileges granted on a catalog or schema are inherited by the objects inside it, including ones created later.', SRC.privileges),
          q('grant-select-syntax', 'governance.privileges', 'Which statement gives the analysts group read access to a table?', ['GRANT SELECT ON TABLE main.sales.orders TO `analysts`', 'ALLOW READ main.sales.orders FOR analysts', 'GRANT READ ON main.sales.orders TO analysts', 'SET OWNER main.sales.orders = analysts'], 'A', 'GRANT <privilege> ON <securable> TO <principal> is the syntax. SELECT is the read privilege for tables.', SRC.privileges),
          q('who-can-grant', 'governance.privileges', 'By default, who can grant privileges on a Unity Catalog object?', ['Its owner or a metastore admin', 'Any user with SELECT on it', 'Only the person who created the workspace', 'Nobody without a support request'], 'A', 'Owners can grant privileges on objects they own; metastore admins can manage privileges across the metastore. SELECT alone does not allow granting.', SRC.privileges),
          q('row-level-view', 'governance.privileges', "How can analysts see only rows for their own region in a shared table?", ['Use a view (or row filter) that checks the user’s group membership', 'Run VACUUM separately per region', 'Partition the table by region', 'Grant SELECT on each partition'], 'A', 'Dynamic views and row filters can use functions such as is_account_group_member() to decide which rows a user sees. Partitions are not securable objects.', SRC.privileges),
        ],
      },
    ],
  },
  {
    title: 'Lakeflow Jobs',
    subtitle: 'Orchestrate reliable workflows',
    lessons: [
      {
        title: 'Tasks, triggers and repairs',
        summary: 'Run steps in order and recover cleanly.',
        questions: [
          q('task-dependencies', 'jobs.orchestration', 'In a job, how do you make task B run only after task A succeeds?', ['Add task A as a dependency of task B', 'Put both tasks in the same notebook cell', 'Give task B more retries', 'Schedule task B an hour later'], 'A', 'Task dependencies form the job graph. A dependent task starts when its upstream tasks finish successfully (by default).', SRC.jobs),
          q('file-arrival-trigger', 'jobs.orchestration', 'Which trigger starts a job when new files land in a storage location?', ['A file arrival trigger', 'A continuous trigger', 'A cron schedule', 'Manual runs only'], 'A', 'File arrival triggers watch a location and start a run when new files appear, instead of polling on a fixed schedule.', SRC.jobs),
          q('task-values', 'jobs.orchestration', 'How can one task pass a small value, such as a row count, to a later task in the same run?', ['Set a task value with dbutils.jobs.taskValues', 'Print it to the driver log', 'Use a widget default', 'Store it in a cluster environment variable'], 'A', 'Task values let a task publish small values that downstream tasks in the same run can read.', SRC.taskValues),
          q('repair-run', 'jobs.recovery', 'A five-task job failed at task 4. What does a repair run do?', ['Re-runs the failed task and its dependents, not the tasks that succeeded', 'Re-runs all five tasks from the start', 'Rolls back every table the job wrote', 'Deletes the failed run’s logs'], 'A', 'Repair reruns only unsuccessful tasks and the tasks that depend on them, which saves time and cost.', SRC.repair),
          q('task-retries', 'jobs.recovery', 'What does configuring retries on a task do?', ['Re-runs that task automatically after a failure, up to the set limit', 'Re-runs the entire job after any failure', 'Skips the task and continues', 'Restores the previous table version'], 'A', 'Retries apply to the individual task. They help with transient failures without manual intervention.', SRC.jobs),
        ],
      },
    ],
  },
  {
    title: 'Performance',
    subtitle: 'Optimize and troubleshoot',
    lessons: [
      {
        title: 'Data layout and slow queries',
        summary: 'Fewer files, better skipping, clear diagnoses.',
        questions: [
          q('optimize-small-files', 'troubleshooting.layout', 'A table has many small files and queries are slow. Which command compacts them?', ['OPTIMIZE', 'VACUUM', 'ANALYZE TABLE', 'REFRESH TABLE'], 'A', 'OPTIMIZE rewrites small files into larger ones. VACUUM only deletes unreferenced files.', SRC.optimize),
          q('zorder-skipping', 'troubleshooting.layout', 'What does OPTIMIZE events ZORDER BY (customer_id) improve?', ['Data skipping for filters on customer_id', 'Write speed for streaming inserts', 'Storage cost by deleting old versions', 'Join correctness'], 'A', 'Z-ordering colocates related values in the same files so queries filtering on that column can skip more files.', SRC.optimize),
          q('liquid-clustering', 'troubleshooting.layout', 'Which statement enables liquid clustering on a new table?', ['CREATE TABLE t (...) CLUSTER BY (event_date)', 'CREATE TABLE t (...) PARTITIONED BY (event_date) ZORDER', 'CREATE TABLE t (...) BUCKET BY (event_date)', 'ALTER TABLE t SET ZORDER = event_date'], 'A', 'CLUSTER BY enables liquid clustering. It replaces partitioning and Z-ordering for that table and can be changed later.', SRC.clustering),
          q('task-skew', 'troubleshooting.spark-ui', 'In the Spark UI, one task in a stage runs far longer than the rest. What is the most likely cause?', ['Data skew: one partition holds much more data', 'The cluster has too many workers', 'The table has too few columns', 'VACUUM ran recently'], 'A', 'When one partition is much larger than the others, its task dominates the stage. Adaptive query execution and better keys can help.', SRC.sparkUi),
          q('disk-spill', 'troubleshooting.spark-ui', 'Large "spill (disk)" values for a stage usually mean what?', ['Tasks ran short of memory and wrote intermediate data to disk', 'The job wrote its output twice', 'Data was cached successfully', 'The network was idle'], 'A', 'Spill means data did not fit in memory during shuffles or aggregations, which slows tasks down.', SRC.sparkUi),
        ],
      },
    ],
  },
  {
    title: 'CI/CD',
    subtitle: 'Ship changes safely',
    lessons: [
      {
        title: 'Asset Bundles and Git folders',
        summary: 'Version, validate and deploy.',
        questions: [
          q('bundle-config-file', 'cicd.bundles', "Which file defines a Databricks Asset Bundle's resources and targets?", ['databricks.yml', 'requirements.txt', 'pipeline.json', 'cluster.conf'], 'A', 'The bundle configuration lives in databricks.yml at the bundle root, with resources and per-target settings.', SRC.bundles),
          q('bundle-deploy', 'cicd.bundles', 'Which CLI command deploys a bundle to its prod target?', ['databricks bundle deploy -t prod', 'databricks jobs create --all', 'databricks workspace import-dir', 'git push databricks'], 'A', 'databricks bundle deploy uploads files and creates or updates the defined resources for the chosen target.', SRC.bundles),
          q('bundle-dev-mode', 'cicd.bundles', 'What does mode: development do for a bundle target?', ['Prefixes resources with your name and pauses schedules and triggers', 'Deploys to production with extra logging', 'Disables Unity Catalog checks', 'Skips validation'], 'A', 'Development mode isolates each developer’s deployment and keeps scheduled jobs from running unexpectedly.', SRC.bundleModes),
          q('git-feature-branch', 'cicd.git', 'In a Databricks Git folder, how do you work on a feature without changing main?', ['Create or switch to a feature branch', 'Duplicate the notebook and rename it', 'Attach a different cluster', 'Turn off version control'], 'A', 'Git folders support branching, so you can commit to a feature branch and merge through your usual review process.', SRC.git),
          q('git-pull', 'cicd.git', 'A teammate merged changes into the remote branch you are on. How do you get them into your Git folder?', ['Pull', 'Commit', 'Restart the cluster', 'Create a new workspace'], 'A', 'Pull fetches and applies remote changes to your Git folder’s current branch.', SRC.git),
        ],
      },
    ],
  },
  {
    title: 'Platform',
    subtitle: 'Compute and the lakehouse',
    lessons: [
      {
        title: 'Compute and the lakehouse',
        summary: 'Where your code runs and why Delta matters.',
        questions: [
          q('serverless-benefit', 'platform.compute', 'What is a key benefit of serverless compute for notebooks and jobs?', ['Databricks manages the infrastructure, with fast startup', 'You pick the exact VM type for every node', 'It can only run SQL', 'It turns off Unity Catalog'], 'A', 'Serverless compute removes cluster configuration and starts quickly because Databricks manages the capacity.', SRC.serverless),
          q('job-compute', 'platform.compute', 'Why run scheduled production jobs on job compute instead of an all-purpose cluster?', ['Job compute exists only for the run and usually costs less', 'All-purpose clusters cannot run notebooks', 'Job compute keeps state between runs', 'Delta tables require job compute'], 'A', 'Job compute is created for a run and terminated afterwards. All-purpose compute is meant for interactive work.', SRC.compute),
          q('photon-engine', 'platform.compute', 'What is Photon?', ['A vectorized query engine that speeds up SQL and DataFrame workloads', 'A file format', 'A Git integration', 'A streaming source'], 'A', 'Photon is a native vectorized engine compatible with Apache Spark APIs.', SRC.photon),
          q('delta-transaction-log', 'platform.lakehouse', 'What gives Delta Lake tables ACID transactions on cloud object storage?', ['The transaction log (_delta_log)', 'Parquet file footers', 'The Hive metastore alone', 'Local disks on the cluster'], 'A', 'Every change is an ordered commit in the _delta_log, which gives readers consistent snapshots.', SRC.delta),
          q('lakehouse-definition', 'platform.lakehouse', 'Which statement best describes a lakehouse?', ['One platform combining lake storage with warehouse features like transactions and governance', 'A warehouse that cannot store files', 'A backup system for databases', 'A dashboard tool'], 'A', 'A lakehouse keeps open data in low-cost storage and adds reliability, performance and governance on top.', SRC.lakehouse),
        ],
      },
    ],
  },
];
