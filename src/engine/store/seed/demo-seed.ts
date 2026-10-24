/**
 * Seeds a realistic demo dataset through the public Repos API, so it works on SQLite and on the
 * in-memory twin alike: 3 subjects (🌍 Geography suggested), 22 concepts, 25 encounters with
 * episodes, an active roadmap halfway through, quizzes, assignments, profile, chat and LLM usage.
 *
 * `clock` must be the clock the repos were created with; the seed moves it into the past to stamp
 * records and leaves it at `now`.
 */
import type { ChatMessage, Concept, Id, Subject } from '@shared/domain'
import type { LlmCallRecord, Repos } from '../../contracts'
import { newId } from '../../ids'
import { APP_BUNDLES, DEMO_CONCEPTS, DEMO_ENCOUNTERS, type DemoSubjectKey } from './demo-data'
import { demoRoadmapAndQuizzes } from './demo-quizzes'
import type { ManualClock } from './manual-clock'

const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

export interface DemoSeedResult {
  subjects: Record<DemoSubjectKey, Subject>
  counts: Record<'concepts' | 'encounters' | 'quizzes' | 'assignments' | 'llmCalls', number>
  roadmapId: Id
}

export function seedDemo(
  repos: Repos,
  clock: ManualClock,
  now: number = clock.now(),
): DemoSeedResult {
  return repos.transaction(() => {
    const at = <T>(ms: number, fn: () => T): T => {
      clock.set(ms)
      return fn()
    }
    const subjects: Record<DemoSubjectKey, Subject> = {
      orgo: at(now - 21 * 24 * H, () =>
        repos.subjects.create({
          name: 'Organic Chemistry',
          emoji: '🧪',
          color: 'purple',
          description: 'CHEM 2210 — reaction mechanisms and stereochemistry',
          goal: 'Pass the midterm',
          deadline: iso(Math.floor((now + 49 * 24 * H) / (24 * H)) * 24 * H + 9 * H),
        }),
      ),
      la: at(now - 14 * 24 * H, () =>
        repos.subjects.create({
          name: 'Linear Algebra',
          emoji: '📐',
          color: 'blue',
          description: 'MATH 2400',
          goal: 'Get comfortable with eigenvalues',
        }),
      ),
      geo: at(now - 22 * H, () =>
        repos.subjects.create({
          name: 'Geography',
          emoji: '🌍',
          color: 'green',
          description: 'Suggested from what you read about monsoons and plate tectonics',
          status: 'suggested',
        }),
      ),
    }
    clock.set(now)
    repos.subjects.update(subjects.orgo.id, { focus: 'focus' })

    const concepts = new Map<string, Concept>()
    for (const spec of DEMO_CONCEPTS) {
      const subjectId = subjects[spec.subject].id
      const created = repos.concepts.upsert({
        subjectId,
        name: spec.name,
        parentName: spec.parent,
        summary: spec.summary,
      })
      concepts.set(
        `${spec.subject}:${spec.name}`,
        repos.concepts.update(created.id, {
          mastery: spec.mastery,
          status: spec.status,
          box: spec.box,
          nextReviewAt: spec.reviewInHours === null ? null : iso(now + spec.reviewInHours * H),
          struggleCount: spec.struggle,
          lastSeenAt: spec.lastSeenHoursAgo === null ? null : iso(now - spec.lastSeenHoursAgo * H),
        }),
      )
    }
    const conceptByName = (name: string): Concept => {
      const found = [...concepts.values()].find((c) => c.name === name)
      if (!found) throw new Error(`demo concept "${name}" missing`)
      return found
    }

    for (const e of DEMO_ENCOUNTERS) {
      const createdAt = now - e.hoursAgo * H
      const episodeId = newId('epi')
      const isChat = e.app === 'ChatGPT' || (e.url ?? '').includes('chatgpt.com')
      repos.episodes.save({
        id: episodeId,
        bundleId: APP_BUNDLES[e.app],
        app: e.app,
        title: e.title,
        url: e.url,
        kind: isChat ? 'ai_chat' : 'reading',
        aiProvider: isChat ? 'chatgpt' : null,
        startedAt: iso(createdAt - e.minutes * 60_000 - 30_000),
        endedAt: iso(createdAt - 30_000),
        dwellSeconds: e.minutes * 60,
        text: e.hoursAgo < 48 ? `${e.title}\n${e.seen}` : '',
        source: e.app === 'Preview' ? 'ocr' : 'ax',
        signals: {
          readingWpm: 190,
          baselineWpm: 210,
          scrollBacks: e.understanding === 'struggling' ? 3 : 0,
          revisitsToday: 0,
          searches: [],
          aiQuestions: [],
        },
        extracted: true,
      })
      at(createdAt, () =>
        repos.encounters.add({
          subjectId: e.subject ? subjects[e.subject].id : null,
          conceptId:
            e.subject && e.concept ? (concepts.get(`${e.subject}:${e.concept}`)?.id ?? null) : null,
          episodeId,
          seen: e.seen,
          bigPicture: e.bigPicture,
          topicPath: e.topicPath,
          understanding: e.understanding,
          evidence: e.evidence,
          openQuestions: e.openQuestions ?? [],
          keyTerms: e.keyTerms ?? [],
          source: { app: e.app, bundleId: APP_BUNDLES[e.app], url: e.url, title: e.title },
          dwellSeconds: e.minutes * 60,
          inboxState: e.inbox,
        }),
      )
    }

    const { roadmap, quizzes } = demoRoadmapAndQuizzes(
      { orgo: subjects.orgo.id, la: subjects.la.id },
      conceptByName,
      now,
    )
    repos.roadmaps.save(roadmap)
    for (const q of quizzes) repos.quizzes.save(q)

    at(now - 27 * H, () =>
      repos.assignments.upsert({
        subjectId: subjects.orgo.id,
        title: 'Problem Set 5: SN1/SN2',
        course: 'CHEM 2210',
        dueAt: iso(now + 3 * 24 * H),
        source: 'canvas.example.edu',
      }),
    )
    at(now - 30 * H, () =>
      repos.assignments.upsert({
        subjectId: subjects.la.id,
        title: 'Linear Algebra Homework 3',
        course: 'MATH 2400',
        dueAt: iso(now + 6 * 24 * H),
        source: 'manual',
      }),
    )

    at(now - 48 * H, () =>
      repos.profile.update({
        aboutMe: 'Second-year chemistry student. I learn best from worked examples.',
        level: 'undergraduate, year 2',
        promptLanguage: 'en',
        habits: {
          promptsSeen: 23,
          withContext: 9,
          withStructure: 6,
          askedToBeQuizzed: 4,
          askedForExamples: 11,
        },
        summary:
          'Solid on reaction basics; shaky on carbocation stability and eigenvalues. Prefers worked examples.',
      }),
    )

    const chat: Pick<ChatMessage, 'role' | 'content' | 'actions'>[] = [
      { role: 'user', content: 'What should I focus on today?', actions: [] },
      {
        role: 'assistant',
        content:
          'Carbocation stability — you missed it in checkpoint 1 and re-read it 3× today. Then 2 reviews are due: Leaving groups and Chirality.',
        actions: [
          { type: 'start_roadmap', subjectId: subjects.orgo.id, goal: 'Carbocation stability' },
          {
            type: 'start_review',
            conceptIds: [conceptByName('Leaving groups').id, conceptByName('Chirality').id],
          },
        ],
      },
      { role: 'user', content: 'Quiz me on eigenvalues later', actions: [] },
      {
        role: 'assistant',
        content: "Will do — I'll offer a 3-minute eigenvalue check at your next break.",
        actions: [],
      },
    ]
    chat.forEach((m, i) => {
      at(now - (90 - i * 2) * 60_000, () => repos.chat.append({ thread: 'coach', ...m }))
    })

    type Call = Pick<LlmCallRecord, 'provider' | 'model' | 'tier' | 'ok'> & { minutesAgo: number }
    const call = (
      minutesAgo: number,
      provider: Call['provider'],
      model: string,
      tier: Call['tier'],
      ok = true,
    ): Call => ({ minutesAgo, provider, model, tier, ok })
    const calls: Call[] = [
      ...Array.from({ length: 12 }, (_, i) => call(i * 3 + 2, 'apple', 'system', 'extract')),
      ...Array.from({ length: 9 }, (_, i) =>
        call(i * 4 + 1, 'groq', 'openai/gpt-oss-20b', 'write'),
      ),
      call(15, 'groq', 'openai/gpt-oss-120b', 'reason'),
      call(16, 'groq', 'openai/gpt-oss-120b', 'reason', false),
      call(17, 'groq', 'openai/gpt-oss-120b', 'reason'),
      call(33, 'groq', 'openai/gpt-oss-120b', 'reason'),
      call(20, 'ovh', 'gpt-oss-20b', 'extract'),
      call(21, 'ovh', 'gpt-oss-20b', 'extract'),
      call(30 * 60, 'groq', 'openai/gpt-oss-120b', 'reason'),
      call(31 * 60, 'apple', 'system', 'extract'),
    ]
    for (const c of calls) {
      repos.usage.record({
        at: iso(now - c.minutesAgo * 60_000),
        provider: c.provider,
        model: c.model,
        tier: c.tier,
        task: c.tier === 'extract' ? 'extract' : c.tier === 'write' ? 'step' : 'roadmap',
        tokensIn: c.tier === 'reason' ? 2400 : 900,
        tokensOut: c.tier === 'reason' ? 700 : 180,
        latencyMs: c.provider === 'apple' ? 850 : 1200,
        ok: c.ok,
        error: c.ok ? null : '429 rate limited',
      })
    }

    repos.settings.update({ onboardingDone: true, focusSubjectId: subjects.orgo.id })
    clock.set(now)
    const fresh = (s: Subject) => repos.subjects.get(s.id) ?? s
    return {
      subjects: { orgo: fresh(subjects.orgo), la: fresh(subjects.la), geo: fresh(subjects.geo) },
      roadmapId: roadmap.id,
      counts: {
        concepts: concepts.size,
        encounters: DEMO_ENCOUNTERS.length,
        quizzes: quizzes.length,
        assignments: 2,
        llmCalls: calls.length,
      },
    }
  })
}
