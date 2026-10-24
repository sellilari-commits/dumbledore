/** SQLite QuizRepo: `quizzes` + `questions` + `answers`; exam titles feed the search index. */
import type { Answer, Question, Quiz } from '@shared/domain'
import type { QuizRepo } from '../../contracts'
import { codec, insertSql, type Row } from '../codec'
import { must, type StoreCtx, seqOf, sqlLimit } from '../context'

type QuizRow = Omit<Quiz, 'questions' | 'answers'>

export const quizCodec = codec<QuizRow>({
  id: 'text',
  kind: 'text',
  title: 'text',
  subjectIds: 'json',
  roadmapId: 'text',
  roadmapItemId: 'text',
  status: 'text',
  score: 'num',
  createdAt: 'text',
  completedAt: 'text',
})

const questionCodec = codec<Question>({
  id: 'text',
  conceptName: 'text',
  conceptId: 'text',
  stem: 'text',
  options: 'json',
  correctIndex: 'num',
  rationales: 'json',
  difficulty: 'num',
  carriedFrom: 'text',
})

const answerCodec = codec<Answer>({
  questionId: 'text',
  chosenIndex: 'num',
  correct: 'bool',
  answeredAt: 'text',
})

const UPSERT = `${insertSql('quizzes', quizCodec.columns)}
  ON CONFLICT (id) DO UPDATE SET ${quizCodec.columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`
const INSERT_QUESTION = insertSql('questions', ['quiz_id', 'pos', ...questionCodec.columns])
const INSERT_ANSWER = insertSql('answers', ['quiz_id', 'pos', ...answerCodec.columns])

export function createQuizRepo(ctx: StoreCtx): QuizRepo {
  const { stmt, index } = ctx

  const hydrate = (r: Row): Quiz => ({
    ...quizCodec.decode(r),
    questions: (
      stmt('SELECT * FROM questions WHERE quiz_id = ? ORDER BY pos').all(r.id) as Row[]
    ).map((q) => questionCodec.decode(q)),
    answers: (stmt('SELECT * FROM answers WHERE quiz_id = ? ORDER BY pos').all(r.id) as Row[]).map(
      (a) => answerCodec.decode(a),
    ),
  })

  const writeAnswers = (quizId: string, answers: readonly Answer[]) => {
    stmt('DELETE FROM answers WHERE quiz_id = ?').run(quizId)
    answers.forEach((a, pos) => {
      stmt(INSERT_ANSWER).run({ quiz_id: quizId, pos, ...answerCodec.params(a) })
    })
  }

  const repo: QuizRepo = {
    get(id) {
      const r = stmt('SELECT * FROM quizzes WHERE id = ?').get(id) as Row | undefined
      return r ? hydrate(r) : null
    },

    save(quiz) {
      ctx.db.transaction(() => {
        const { questions, answers, ...row } = quiz
        stmt(UPSERT).run(quizCodec.params(row))
        stmt('DELETE FROM questions WHERE quiz_id = ?').run(quiz.id)
        questions.forEach((q, pos) => {
          stmt(INSERT_QUESTION).run({ quiz_id: quiz.id, pos, ...questionCodec.params(q) })
        })
        writeAnswers(quiz.id, answers)
        const seq = must(seqOf(ctx, 'quizzes', quiz.id), `quiz ${quiz.id}`)
        if (quiz.kind === 'exam') index.put('exam', seq, [quiz.title])
        else index.remove('exam', seq)
      })()
    },

    list(filter) {
      const where: string[] = []
      const params: Record<string, unknown> = { limit: sqlLimit(filter.limit) }
      if (filter.kind) {
        where.push('kind = @kind')
        params.kind = filter.kind
      }
      if (filter.subjectId) {
        where.push(
          'EXISTS (SELECT 1 FROM json_each(quizzes.subject_ids) j WHERE j.value = @subjectId)',
        )
        params.subjectId = filter.subjectId
      }
      const sql = `SELECT * FROM quizzes ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, seq ASC LIMIT @limit`
      return (stmt(sql).all(params) as Row[]).map(hydrate)
    },

    recordAnswer(quizId, answer) {
      const quiz = must(repo.get(quizId), `quiz ${quizId}`)
      ctx.db.transaction(() => {
        writeAnswers(quizId, [
          ...quiz.answers.filter((a) => a.questionId !== answer.questionId),
          answer,
        ])
        if (quiz.status === 'ready') {
          stmt("UPDATE quizzes SET status = 'in_progress' WHERE id = ?").run(quizId)
        }
      })()
      return must(repo.get(quizId), `quiz ${quizId}`)
    },
  }
  return repo
}
