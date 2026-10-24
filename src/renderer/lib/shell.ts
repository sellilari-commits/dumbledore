/**
 * App-window UI state (zustand): sidebar collapsed, ⌘K palette, and the global "new subject"
 * and "new exam" dialogs, so shortcuts and buttons anywhere can open them.
 */
import { create } from 'zustand'

interface ShellState {
  sidebarCollapsed: boolean
  paletteOpen: boolean
  newSubjectOpen: boolean
  newExam: { open: boolean; subjectIds: string[] }
  toggleSidebar(): void
  setPalette(open: boolean): void
  setNewSubject(open: boolean): void
  openNewExam(subjectIds?: string[]): void
  closeNewExam(): void
}

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem('dumbledore.sidebarCollapsed') === '1'
  } catch {
    return false
  }
}

export const useShell = create<ShellState>((set, get) => ({
  sidebarCollapsed: initialCollapsed(),
  paletteOpen: false,
  newSubjectOpen: false,
  newExam: { open: false, subjectIds: [] },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    try {
      localStorage.setItem('dumbledore.sidebarCollapsed', next ? '1' : '0')
    } catch {
      // Not persisted in private mode; harmless.
    }
    set({ sidebarCollapsed: next })
  },
  setPalette: (open) => set({ paletteOpen: open }),
  setNewSubject: (open) => set({ newSubjectOpen: open }),
  openNewExam: (subjectIds = []) => set({ newExam: { open: true, subjectIds } }),
  closeNewExam: () => set((s) => ({ newExam: { ...s.newExam, open: false } })),
}))
