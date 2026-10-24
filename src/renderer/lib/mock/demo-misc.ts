/**
 * Demo assignments, coach chat, provider usage, profile and app state for the mock API.
 */
import type { Assignment, ChatMessage, Profile } from '@shared/domain'
import type { AppState, UsageSummary } from '@shared/state'
import { DAY, HOUR, isoAgo, isoDayAt, MINUTE } from './time'

export function demoAssignments(): Assignment[] {
  return [
    {
      id: 'as_ps4',
      subjectId: 'sub_linalg',
      title: 'Problem set 4',
      course: 'MATH 2400',
      dueAt: isoDayAt(6, 23, 59),
      source: 'Canvas',
      status: 'open',
      createdAt: isoAgo(5 * HOUR),
    },
    {
      id: 'as_lab',
      subjectId: 'sub_orgo',
      title: 'Lab report: SN1 hydrolysis',
      course: 'CHEM 2210',
      dueAt: isoDayAt(10, 17),
      source: 'Canvas',
      status: 'open',
      createdAt: isoAgo(3 * DAY),
    },
  ]
}

export function demoChat(): ChatMessage[] {
  return [
    {
      id: 'msg_1',
      thread: 'panel',
      role: 'user',
      content: 'What should I focus on today?',
      actions: [],
      createdAt: isoAgo(3 * HOUR),
    },
    {
      id: 'msg_2',
      thread: 'panel',
      role: 'assistant',
      content:
        '1. **Carbocation stability** — you missed 2 of 3 yesterday, and it decides SN1 vs SN2.\n2. **Problem set 4** is due in 6 days; eigenvalues are still shaky.\n3. Two quick reviews are due: *Leaving groups* and *Determinants*.',
      actions: [
        { type: 'start_roadmap', subjectId: 'sub_orgo', goal: 'Carbocation stability' },
        {
          type: 'create_exam',
          spec: {
            subjectIds: ['sub_orgo', 'sub_linalg'],
            count: 5,
            focus: 'due',
            difficulty: 'mixed',
          },
        },
      ],
      createdAt: isoAgo(3 * HOUR - MINUTE),
    },
  ]
}

export function demoUsage(): UsageSummary {
  return {
    rows: [
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        calls: 132,
        failures: 1,
        tokensIn: 248_300,
        tokensOut: 41_600,
      },
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        calls: 391,
        failures: 0,
        tokensIn: 402_900,
        tokensOut: 28_700,
      },
      {
        provider: 'apple',
        model: 'on-device',
        calls: 214,
        failures: 2,
        tokensIn: 181_400,
        tokensOut: 22_900,
      },
      {
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        calls: 46,
        failures: 1,
        tokensIn: 61_200,
        tokensOut: 18_400,
      },
      {
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        calls: 88,
        failures: 0,
        tokensIn: 52_700,
        tokensOut: 9_100,
      },
      {
        provider: 'ovh',
        model: 'gpt-oss-20b',
        calls: 3,
        failures: 0,
        tokensIn: 2_100,
        tokensOut: 600,
      },
    ],
    limits: [
      { provider: 'gemini', model: 'gemini-3.5-flash', requestsPerDay: null, tokensPerDay: null },
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        requestsPerDay: null,
        tokensPerDay: null,
      },
      { provider: 'apple', model: 'on-device', requestsPerDay: null, tokensPerDay: null },
      {
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        requestsPerDay: 1000,
        tokensPerDay: 200_000,
      },
      {
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        requestsPerDay: 1000,
        tokensPerDay: 200_000,
      },
      { provider: 'ovh', model: 'gpt-oss-20b', requestsPerDay: 2880, tokensPerDay: null },
    ],
  }
}

export function demoProfile(): Profile {
  return {
    aboutMe:
      'Second-year chemistry student at the University of Helsinki. I learn best from worked examples and like being quizzed.',
    level: 'University, year 2',
    promptLanguage: 'auto',
    habits: {
      promptsSeen: 64,
      withContext: 22,
      withStructure: 31,
      askedToBeQuizzed: 9,
      askedForExamples: 27,
    },
    summary:
      'Strong on mechanisms once the intuition clicks; recurring struggle with stability arguments.',
    updatedAt: isoAgo(DAY),
  }
}

export function demoAppState(onboardingDone: boolean): AppState {
  return {
    capture: { enabled: true, active: true },
    permissions: { accessibility: onboardingDone, screenRecording: false },
    helper: 'connected',
    ai: {
      ready: true,
      onDevice: true,
      providers: [
        { id: 'gemini', ok: true },
        { id: 'apple', ok: true },
        { id: 'groq', ok: true },
        { id: 'ovh', ok: true },
      ],
    },
    focusSubjectId: 'sub_orgo',
    now: {
      app: 'Google Chrome',
      title: 'SN1 reaction – Wikipedia',
      url: 'https://en.wikipedia.org/wiki/SN1_reaction',
      minutes: 6,
      kind: 'reading',
      subjectId: 'sub_orgo',
      suggestion: {
        label: 'Carbocation stability looks tricky',
        action: { type: 'start_roadmap', subjectId: 'sub_orgo', goal: 'Carbocation stability' },
      },
    },
    aiChat: { provider: 'ChatGPT' },
    onboardingDone,
    version: '0.1.0',
  }
}

/** Study minutes this week per subject, plus quiz stats for Home. */
export const demoWeek = {
  minutes: { sub_orgo: 160, sub_linalg: 75, sub_geo: 12 } as Record<string, number>,
  questionsAnswered: 23,
  correct: 16,
}
