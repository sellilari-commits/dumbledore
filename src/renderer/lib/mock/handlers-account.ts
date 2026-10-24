/**
 * Mock handlers for the student's own things: the "About you" profile, the data export and
 * "Delete everything" (which leaves a first-run install: onboarding again, permissions kept;
 * main also deletes the exports folder and relaunches, which the mock skips).
 */
import type { Profile } from '@shared/domain'
import type { InvokeReq } from '@shared/ipc'
import type { MemoryScope } from '@shared/state'
import type { HandlerMap } from './context'
import { createDb, EMPTY_HABITS, type MockDb } from './db'
import { appState } from './handlers-core'
import { nowIso } from './time'

export type AccountChannel = 'profile.get' | 'profile.update' | 'data.export' | 'data.deleteAll'

const ALL_SCOPES: MemoryScope[] = [
  'subjects',
  'concepts',
  'inbox',
  'roadmaps',
  'quizzes',
  'assignments',
  'profile',
  'chat',
  'nudges',
  'settings',
]

/** Only the fields the patch actually sets (an explicit undefined keeps the old value). */
function definedFields(patch: InvokeReq<'profile.update'>): Partial<Profile> {
  const out: Partial<Profile> = {}
  if (patch.aboutMe !== undefined) out.aboutMe = patch.aboutMe
  if (patch.level !== undefined) out.level = patch.level
  if (patch.promptLanguage !== undefined) out.promptLanguage = patch.promptLanguage
  return out
}

/** Back to a fresh install. macOS permissions and the dev env file are not app data. */
function wipe(db: MockDb): void {
  const fresh = createDb('onboarding', { geminiEnvKey: db.envKeys.gemini })
  const permissions = db.appState.permissions
  const grantAt = db.grantAt
  Object.assign(db, fresh, { grantAt })
  db.appState.permissions = permissions
  db.profile.habits = { ...EMPTY_HABITS }
}

export const accountHandlers: HandlerMap<AccountChannel> = {
  'profile.get': (ctx) => structuredClone(ctx.db.profile),
  'profile.update': (ctx, patch) => {
    ctx.db.profile = { ...ctx.db.profile, ...definedFields(patch), updatedAt: nowIso() }
    ctx.changed('profile')
    return structuredClone(ctx.db.profile)
  },
  // Main writes to <data dir>/exports/ and reveals the file in Finder.
  'data.export': () => ({
    path: `~/Library/Application Support/Dumbledore/exports/dumbledore-export-${new Date().toISOString().slice(0, 10)}.json`,
  }),
  'data.deleteAll': (ctx, { confirm }) => {
    if (confirm !== true) throw new Error('Deleting everything needs a confirmation.')
    wipe(ctx.db)
    for (const scope of ALL_SCOPES) ctx.changed(scope)
    ctx.emit('session.changed', null)
    ctx.emit('state.changed', appState(ctx))
  },
}
