/**
 * Memory control reads (docs/NOTES.md §7): a subject's topic tree with its notes and the loose
 * notes. The writes ('notes.update', 'concepts.delete', …) go through `useAction`; queries.ts
 * lists what each of them refreshes.
 */
import { useQuery } from '@tanstack/react-query'
import { invoke } from './api'

export const memoryKeys = {
  tree: (subjectId: string) => ['subjects.tree', subjectId] as const,
  loose: () => ['notes.loose'] as const,
}

export const useSubjectTree = (subjectId: string) =>
  useQuery({
    queryKey: memoryKeys.tree(subjectId),
    queryFn: () => invoke('subjects.tree', subjectId),
    enabled: subjectId !== '',
  })

export const useLooseNotes = () =>
  useQuery({ queryKey: memoryKeys.loose(), queryFn: () => invoke('notes.loose') })
