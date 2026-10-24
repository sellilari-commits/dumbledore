/** App-wide identifiers and names. */

export const APP_NAME = 'Dumbledore'
export const APP_BUNDLE_ID = 'org.stuhi.dumbledore'
export const HELPER_BUNDLE_ID = 'org.stuhi.dumbledore.helper'
export const HELPER_APP_NAME = 'Dumbledore Helper'

/** Folder name under ~/Library/Application Support. */
export const DATA_DIR_NAME = 'Dumbledore'
export const DB_FILE_NAME = 'dumbledore.db'
export const MEMORY_DIR_NAME = 'memory' // per-subject Markdown "memory files"
export const RUN_DIR_NAME = 'run' // helper socket lives here (0700)
export const HELPER_SOCKET_NAME = 'helper.sock'

export const SURFACES = ['overlay', 'panel', 'askbar', 'app'] as const
export type Surface = (typeof SURFACES)[number]
