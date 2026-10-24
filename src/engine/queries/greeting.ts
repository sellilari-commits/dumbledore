/** The name Home greets the student with: the first part of the macOS account name. */
import { userInfo } from 'node:os'

/** "ilari.stuhi" → "Ilari", "anna_k" → "Anna", "" → "". */
export function greetingNameFrom(username: string): string {
  const first = username.split(/[._\-\s]+/).find((part) => part.length > 0) ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
}

export function defaultGreetingName(): string {
  try {
    return greetingNameFrom(userInfo().username)
  } catch {
    return ''
  }
}
