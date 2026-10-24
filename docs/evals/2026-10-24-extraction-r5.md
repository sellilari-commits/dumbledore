# Eval · extraction · 2026-10-24T18:06:40.533Z

Result: **GAP** — 4/5 thresholds met · 67 s · `eval-prompts extraction --only R --max-eur 0.02 --provider ovh`

Routes: triage: ovh:gpt-oss-20b → ovh:gpt-oss-120b · extract: ovh:gpt-oss-20b → ovh:gpt-oss-120b · reason: ovh:gpt-oss-120b → ovh:gpt-oss-20b · write: ovh:gpt-oss-20b → ovh:gpt-oss-120b · chat: ovh:gpt-oss-120b → ovh:gpt-oss-20b

Prompt versions: P1v2 P3v2 P4v1 P5v1 P5vv1 P8v2

Estimated spend: **€0.0000** (src/engine/brain/llm/prices.ts; EUR = USD; thinking tokens billed as output)

## Thresholds (PLAN §9.2)

| metric | value | target | |
|---|---|---|---|
| precision | 0.75 | ≥ 0.85 | ❌ |
| recall | 1 | ≥ 0.8 | ✅ |
| three parts always filled | 1 | ≥ 1 | ✅ |
| "struggling" without evidence | 0 | ≤ 0 | ✅ |
| episodes that errored | 0 | ≤ 0 | ✅ |

## Metrics

- episodes: 12
- errors: 0
- tp: 3
- fp: 1
- fn: 0
- tn: 8
- precision: 0.75
- recall: 1
- threePartsFilled: 1
- strugglingWithoutEvidence: 0
- understandingAgreement: 3/3
- subjectAgreement: 3/3
- assignmentsFound: 0/0
- studentPromptCounts: 0/0
- finnishOutputs: 0/0

## Models used

| provider:model | task | calls | failures | tokens in/out | latency p50 / p90 (ms) |
|---|---|---|---|---|---|
| ovh:gpt-oss-20b | extract | 3 | 1 | 7738 / 669 | 8473 / 8473 |
| ovh:gpt-oss-120b | extract | 3 | 0 | 12753 / 2908 | 25822 / 52817 |

Failed calls:
- ovh:gpt-oss-20b extract: rate_limit: HTTP 429: Too Many Requests

## Cases

### ✅ R01-real-chatgpt-sn1-sn2-misconceptions

learning yes (0.96) · understanding unclear · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN1 vs SN2
- seen: The AI lists key differences: SN1 is two‑step (leaving group leaves → carbocation → nucleophile attack, rate = k[substrate]); SN2 is one‑step (nucleophile attacks as leaving group leaves, rate = k[substrate][nucleophile]). It notes substrate preference (tertiary for SN1, primary for SN2), nucleophil…
- big picture: Clarify SN1 vs SN2 mechanisms, substrate/solvent effects, and leaving‑group ability for the organic chemistry course.
- evidence: Student asks multiple detailed questions, scrolls back, revisits the chat three times, and requests a quiz.

### ✅ R02-real-chatgpt-home-typed-practice-prompt

learning yes (0.93) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN1 vs SN2 Practice
- seen: Student requests: “I am practicing organic chemistry reaction prediction. Give me a reaction context (substrate, nucleophile, solvent) and let me explain back to you whether it goes SN1 or SN2 and why, then correct any mistakes I make. No greetings or small talk. Short structured bullets, max ~150 w…
- big picture: Practice predicting whether a given substrate, nucleophile, and solvent will undergo SN1 or SN2, to prepare for organic chemistry exams.
- evidence: Student explicitly asks the AI to give a reaction context for them to explain back and be corrected.

### ✅ R04-real-chatgpt-empty-start-page

learning no (0.99)

- reason: Empty ChatGPT start page with no substantive content

### ✅ R03-real-gemini-home-typed-sn1-prompt

learning yes (0.92) · understanding unknown · subject s_orgo

- path: Organic Chemistry › SN1 › SN2
- seen: The AI was instructed to explain SN1 and SN2: key differences in mechanism and rate laws, preferred substrate types, role of nucleophiles and solvents, with bold key terms and a short structured bullet list, followed by a question to check understanding.
- big picture: Learning the fundamentals of SN1 and SN2 mechanisms for an organic chemistry course.
- evidence: Student explicitly asked Gemini to explain SN1 and SN2 with structured bullets and a follow‑up question.

### ✅ R05-real-chatgpt-empty-start-page-fi

learning no (0.97)

- reason: Empty ChatGPT start page, no learning content

### ✅ R06-real-gemini-empty-start-page-ocr

learning no (0.97)

- reason: Empty Gemini start page, no learning content

### ✅ R07-real-dumbledore-mock-chat-test-page

learning no (0.96)

- reason: Only UI elements of a mock Dumbledore page, no study content

### ✅ R08-real-claude-code-with-dumbledore-demo-home

learning no (0.94)

- reason: Discussion of software debugging, not learning academic material

### ❌ R09-real-claude-with-dumbledore-demo-subject-page

learning yes (0.92) ✗

- path: Organic Chemistry › Substitution reactions › SN1 vs SN2
- seen: The review step reads: "Know when each substitution mechanism happens, and why" and lists related concepts such as nucleophiles, carbocation stability, and leaving groups for SN1 vs SN2.
- big picture: Reviewing SN1 vs SN2 mechanisms to prepare for the Organic Chemistry midterm
- evidence: UI shows "SN1 vs SN2 Step 3 of 8" and the checkpoint text "Know when each substitution mechanism happens, and why"

### ✅ R10-real-claude-code-signing-dev-work

learning no (0.98)

- reason: Developer work on code‑signing, not studying chemistry or math

### ✅ R11-real-claude-permissions-dev-work

learning no (0.98)

- reason: Developer work on permissions, not learning content

### ✅ R12-real-claude-code-agent-status

learning no (0.97)

- reason: User is troubleshooting software, not studying course material
