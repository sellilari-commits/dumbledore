# Eval · extraction · 2026-10-24T18:05:22.354Z

Result: **GAP** — 3/5 thresholds met · 58 s · `eval-prompts extraction --only R --max-eur 0.02 --provider ovh`

Routes: triage: ovh:gpt-oss-20b → ovh:gpt-oss-120b · extract: ovh:gpt-oss-20b → ovh:gpt-oss-120b · reason: ovh:gpt-oss-120b → ovh:gpt-oss-20b · write: ovh:gpt-oss-20b → ovh:gpt-oss-120b · chat: ovh:gpt-oss-120b → ovh:gpt-oss-20b

Prompt versions: P1v1 P3v2 P4v1 P5v1 P5vv1 P8v2

Estimated spend: **€0.0000** (src/engine/brain/llm/prices.ts; EUR = USD; thinking tokens billed as output)

## Thresholds (PLAN §9.2)

| metric | value | target | |
|---|---|---|---|
| precision | 0.75 | ≥ 0.85 | ❌ |
| recall | 1 | ≥ 0.8 | ✅ |
| three parts always filled | 1 | ≥ 1 | ✅ |
| "struggling" without evidence | 1 | ≤ 0 | ❌ |
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
- strugglingWithoutEvidence: 1
- understandingAgreement: 3/3
- subjectAgreement: 3/3
- assignmentsFound: 0/0
- studentPromptCounts: 0/0
- finnishOutputs: 0/0

## Models used

| provider:model | task | calls | failures | tokens in/out | latency p50 / p90 (ms) |
|---|---|---|---|---|---|
| ovh:gpt-oss-20b | extract | 3 | 0 | 10094 / 2078 | 6183 / 17394 |
| ovh:gpt-oss-120b | extract | 2 | 0 | 9201 / 1394 | 36764 / 36764 |

## Cases

### ✅ R01-real-chatgpt-sn1-sn2-misconceptions

learning yes (0.92) · understanding unclear · subject s_orgo

- path: Organic Chemistry › SN1 › SN2
- seen: The AI explained the two‑step SN1 mechanism (leaving group departs forming a carbocation, then nucleophile attacks) and the one‑step SN2 mechanism (concurrent leaving group departure and nucleophile attack). It discussed substrate preferences (tertiary for SN1, primary for SN2), the role of weak vs …
- big picture: Trying to clarify misconceptions about SN1 vs SN2 mechanisms, leaving‑group ability, solvent effects, and substrate preferences for a first‑year organic chemistry course.
- evidence: scrolled_back=1, revisits_today=3, ai_questions list, repeated re‑phrased questions in the chat.

### ✅ R02-real-chatgpt-home-typed-practice-prompt

learning yes (0.88) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reaction Prediction
- seen: Student says: "1 am practicing organic chemistry reaction prediction. Give me a reaction context (substrate, nucleophile, solvent) and let me explain back to you whether it goes SN1 or SN2 and why, then correct any mistakes I make."
- big picture: Student is practicing reaction prediction, asking ChatGPT to give a substrate/nucleophile/solvent scenario and to identify SN1 or SN2 and explain the reasoning.
- evidence: scrolled_back=1, revisits_today=2, ai_questions list, student explicitly states practice goal.

### ✅ R04-real-chatgpt-empty-start-page

learning no (0.95)

- reason: ChatGPT start page, no learning content

### ✅ R03-real-gemini-home-typed-sn1-prompt

learning yes (0.92) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic substitution › SN1 › SN2
- seen: Explain SN1 and SN2: 1) key differences in mechanism and rate laws; 2) preferred substrate types; 3) role of nucleophiles and solvents. Bulleted, short, bold key terms. Then ask a question to check understanding.
- big picture: Trying to grasp basic SN1 vs SN2 mechanisms for an organic chemistry course.
- evidence: Student explicitly asked for explanation of SN1 and SN2, including mechanism, rate laws, substrates, nucleophiles, solvents.

### ✅ R05-real-chatgpt-empty-start-page-fi

learning no (0.95)

- reason: Only opening ChatGPT start page, no learning content

### ✅ R06-real-gemini-empty-start-page-ocr

learning no (0.95)

- reason: Only opening Gemini start page, no learning content

### ✅ R07-real-dumbledore-mock-chat-test-page

learning no (0.96)

- reason: Mock chat page showing only topic list, no study content

### ✅ R08-real-claude-code-with-dumbledore-demo-home

learning no (0.94)

- reason: Debugging software helper, not academic material

### ❌ R09-real-claude-with-dumbledore-demo-subject-page

learning yes (0.97) ✗ · struggling without evidence ✗

- path: Organic Chemistry › Substitution reactions › SN1 vs SN2
- seen: The interface displays "SN1 vs SN2 Step 3 of 8 … Know when each substitution mechanism happens, and why" along with progress bars, a "struggling" tag and missed idea count.
- big picture: Reviewing SN1 vs SN2 mechanisms to prepare for upcoming organic chemistry lab report and midterm.
- evidence: UI shows "SN1 vs SN2 Step 3 of 8" with progress indicators, a "struggling" flag and missed ideas, indicating active study.

### ✅ R10-real-claude-code-signing-dev-work

learning no (0.96)

- reason: Focused on code‑signing and app permissions, not studying course material

### ✅ R11-real-claude-permissions-dev-work

learning no (0.96)

- reason: Troubleshooting macOS permissions for a development tool, not learning academic content

### ✅ R12-real-claude-code-agent-status

learning no (0.98)

- reason: Debugging app functionality, not studying chemistry
