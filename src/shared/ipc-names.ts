/**
 * Wire names for IPC. Dependency-free on purpose: the sandboxed preload imports this file and
 * must stay tiny (Electron 45 sandboxed preloads have no Node built-ins).
 */
export const IPC_INVOKE_PREFIX = 'dd:invoke:'
export const IPC_EVENT_PREFIX = 'dd:event:'
