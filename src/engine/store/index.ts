/** Public surface of the store: SQLite repos, data paths, migrations, concept name matching. */
export { normalizeName } from './codec'
export { conceptKey, isNicerName, singularize } from './concept-key'
export { type Db, openDatabase } from './db'
export { currentSchemaVersion, LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from './migrations'
export {
  DATA_DIR_ENV,
  type DataPaths,
  defaultDataRoot,
  ensureDataDirs,
  resolveDataPaths,
} from './paths'
export {
  createSqliteRepos,
  type RelinkSupport,
  type SqliteRepos,
  type SqliteReposOptions,
} from './sqlite-repos'
