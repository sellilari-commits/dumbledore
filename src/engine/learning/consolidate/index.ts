/** Notes consolidation (docs/NOTES.md §5) and the study order it gives the roadmap (§6). */
export { applyConsolidation, type ConsolidationReport, MAX_TOPICS } from './apply'
export { isMastered, MASTERED_AT, type StudyOrderInput, studyOrder, treeOrder } from './order'
export {
  CONSOLIDATION_DEFAULTS,
  type ConsolidationDeps,
  type ConsolidationOptions,
  type ConsolidationReason,
  type ConsolidationService,
  createConsolidation,
  pickConcepts,
} from './service'
