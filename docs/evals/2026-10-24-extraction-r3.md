# Eval · extraction · 2026-10-24T18:05:08.371Z

Result: **PASS** — 5/5 thresholds met · 6 s · `eval-prompts extraction --only R --max-eur 0.05 --provider gemini`

Routes: triage: gemini:gemini-3.5-flash-lite · extract: gemini:gemini-3.5-flash-lite · reason: gemini:gemini-3.5-flash · write: gemini:gemini-3.5-flash · chat: gemini:gemini-3.5-flash

Prompt versions: P1v1 P3v2 P4v1 P5v1 P5vv1 P8v2

Estimated spend: **€0.0120** (src/engine/brain/llm/prices.ts; EUR = USD; thinking tokens billed as output)

## Thresholds (PLAN §9.2)

| metric | value | target | |
|---|---|---|---|
| precision | 1 | ≥ 0.85 | ✅ |
| recall | 1 | ≥ 0.8 | ✅ |
| three parts always filled | 1 | ≥ 1 | ✅ |
| "struggling" without evidence | 0 | ≤ 0 | ✅ |
| episodes that errored | 0 | ≤ 0 | ✅ |

## Metrics

- episodes: 12
- errors: 0
- tp: 3
- fp: 0
- fn: 0
- tn: 9
- precision: 1
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
| gemini:gemini-3.5-flash-lite | extract | 5 | 0 | 20285 / 2367 | 1499 / 3349 |

## Cases

### ✅ R01-real-chatgpt-sn1-sn2-misconceptions

learning yes (0.98) · understanding unclear · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN1 vs SN2
- seen: The AI compared SN1 (two steps, carbocation intermediate, favored by tertiary substrates and polar protic solvents, racemic product) and SN2 (one concerted step, backside attack, favored by primary substrates and polar aprotic solvents, inversion of configuration). Leaving groups depart as anions; s…
- big picture: Clearing up misconceptions about SN1 and SN2 reaction mechanisms, substrate preferences, solvents, and leaving-group ability for an organic chemistry course.
- evidence: Student asked detailed questions about leaving groups, solvents (acetone vs water), and secondary carbons, and received quiz questions from ChatGPT.

### ✅ R02-real-chatgpt-home-typed-practice-prompt

learning yes (0.95) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reaction Prediction
- seen: The student requested a reaction context (substrate, nucleophile, solvent) to practice predicting whether a reaction proceeds via SN1 or SN2.
- big picture: Practicing reaction prediction and mechanism identification for organic chemistry.
- evidence: Prompt typed into ChatGPT asking for practice reaction contexts.

### ✅ R04-real-chatgpt-empty-start-page

learning no (0.99)

- reason: Empty ChatGPT landing page with no active learning content

### ✅ R03-real-gemini-home-typed-sn1-prompt

learning yes (0.95) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN1 vs SN2
- seen: Student requested an explanation of key differences in mechanism and rate laws, preferred substrate types, and the role of nucleophiles and solvents for SN1 and SN2 reactions.
- big picture: Understanding the mechanistic and substrate differences between SN1 and SN2 reactions for an organic chemistry course.
- evidence: Asked for a structured breakdown of SN1 and SN2 reactions including mechanism, rate laws, and preferred substrates.

### ✅ R05-real-chatgpt-empty-start-page-fi

learning no (0.98)

- reason: ChatGPT landing page with login and terms of service text

### ✅ R06-real-gemini-empty-start-page-ocr

learning no (0.98)

- reason: Google Gemini empty start page and bookmarks UI

### ✅ R07-real-dumbledore-mock-chat-test-page

learning no (0.98)

- reason: Viewing a mock ChatGPT page for Dumbledore tests

### ✅ R08-real-claude-code-with-dumbledore-demo-home

learning no (0.9)

- reason: Claude coding session and checking Dumbledore study dashboard

### ✅ R09-real-claude-with-dumbledore-demo-subject-page

learning no (0.85)

- reason: Reviewing Organic Chemistry roadmap and Dumbledore app instructions

### ✅ R10-real-claude-code-signing-dev-work

learning no (0.99)

- reason: Developing and code-signing the student coach app with Claude

### ✅ R11-real-claude-permissions-dev-work

learning no (0.99)

- reason: Fixing macOS permissions and onboarding for the student coach app

### ✅ R12-real-claude-code-agent-status

learning no (0.99)

- reason: Coding session debugging the study tracking software
