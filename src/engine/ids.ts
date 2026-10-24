/** Prefixed, roughly time-ordered ids: "sub_m2x9k1a7q3f8z". */
import { randomBytes } from 'node:crypto'

export type IdPrefix =
  | 'sub' // subject
  | 'con' // concept
  | 'enc' // encounter
  | 'epi' // episode
  | 'asg' // assignment
  | 'rdm' // roadmap
  | 'itm' // roadmap item
  | 'quz' // quiz
  | 'qst' // question
  | 'ndg' // nudge
  | 'msg' // chat message
  | 'tst' // toast

export function newId(prefix: IdPrefix): string {
  const time = Date.now().toString(36)
  const rand = randomBytes(5).toString('hex')
  return `${prefix}_${time}${rand}`
}
