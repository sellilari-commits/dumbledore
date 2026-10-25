/**
 * Roadmap history reads: a subject's earlier roadmap versions (replaced, never deleted), newest
 * replacement first. "Bring back" ('roadmaps.restore') goes through `useAction`; queries.ts lists
 * what it refreshes.
 */
import { useQuery } from '@tanstack/react-query'
import { invoke } from './api'

export const roadmapKeys = {
  history: (subjectId: string) => ['roadmaps.history', subjectId] as const,
}

export const useRoadmapHistory = (subjectId: string) =>
  useQuery({
    queryKey: roadmapKeys.history(subjectId),
    queryFn: () => invoke('roadmaps.history', subjectId),
    enabled: subjectId !== '',
  })
