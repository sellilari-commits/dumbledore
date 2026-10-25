/**
 * Undo for chat tool writes: each write registers a function that restores what it changed (from
 * a snapshot taken before the write) and gets an id; the receipt's Undo chip carries that id
 * (CoachAction undo_save, the same chip ChatSaves uses). Entries live for this run of the app,
 * the newest MAX_ENTRIES of them; an id is used once.
 */
const MAX_ENTRIES = 200

export interface UndoEntry {
  line: string
  restore: () => void | Promise<void>
}

export class UndoLog {
  private readonly entries = new Map<string, UndoEntry>()
  private seq = 0

  /** Registers a restore; returns its id ("undo_…"). */
  remember(line: string, restore: UndoEntry['restore']): string {
    const id = `undo_${Date.now().toString(36)}_${++this.seq}`
    this.entries.set(id, { line, restore })
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return id
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  /** Restores and forgets; false when unknown (already undone, too old, or the app restarted). */
  async undo(id: string): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry) return false
    this.entries.delete(id)
    await entry.restore()
    return true
  }
}
