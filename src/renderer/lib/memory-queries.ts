/**
 * Memory control reads (docs/NOTES.md §7): a subject's topic tree with its notes and the loose
 * notes. The writes ('notes.update', 'concepts.delete', …) go through `useAction`; queries.ts
 * lists what each of them refreshes.
 */
import type { SubjectTree } from '@shared/state'
import { useQueries, useQuery } from '@tanstack/react-query'
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

/** Every listed subject's tree at once (the Memory page); `trees` follows `subjectIds`. */
export function useSubjectTrees(subjectIds: string[]) {
  return useQueries({
    queries: subjectIds.map((id) => ({
      queryKey: memoryKeys.tree(id),
      queryFn: () => invoke('subjects.tree', id),
    })),
    combine: (results) => ({
      trees: results.map((r) => r.data as SubjectTree | undefined),
      isLoading: results.some((r) => r.isLoading),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => Promise.all(results.map((r) => r.refetch())),
    }),
  })
}
