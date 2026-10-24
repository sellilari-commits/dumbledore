# Eval · extraction · 2026-10-24T18:08:05.689Z

Result: **PASS** — 5/5 thresholds met · 17 s · `eval-prompts extraction --max-eur 0.12 --provider gemini`

Routes: triage: gemini:gemini-3.5-flash-lite · extract: gemini:gemini-3.5-flash-lite · reason: gemini:gemini-3.5-flash · write: gemini:gemini-3.5-flash · chat: gemini:gemini-3.5-flash

Prompt versions: P1v2 P3v2 P4v1 P5v1 P5vv1 P8v2

Estimated spend: **€0.0348** (src/engine/brain/llm/prices.ts; EUR = USD; thinking tokens billed as output)

## Thresholds (PLAN §9.2)

| metric | value | target | |
|---|---|---|---|
| precision | 1 | ≥ 0.85 | ✅ |
| recall | 1 | ≥ 0.8 | ✅ |
| three parts always filled | 1 | ≥ 1 | ✅ |
| "struggling" without evidence | 0 | ≤ 0 | ✅ |
| episodes that errored | 0 | ≤ 0 | ✅ |

## Metrics

- episodes: 42
- errors: 0
- tp: 23
- fp: 0
- fn: 0
- tn: 19
- precision: 1
- recall: 1
- threePartsFilled: 1
- strugglingWithoutEvidence: 0
- understandingAgreement: 20/23
- subjectAgreement: 23/23
- assignmentsFound: 3/3
- studentPromptCounts: 3/4
- finnishOutputs: 0/2

## Models used

| provider:model | task | calls | failures | tokens in/out | latency p50 / p90 (ms) |
|---|---|---|---|---|---|
| gemini:gemini-3.5-flash-lite | extract | 15 | 0 | 47526 / 8220 | 2110 / 2905 |

## Cases

### ✅ L01-wiki-sn1-struggle

learning yes (0.98) · understanding struggling · subject s_orgo

- path: Organic Chemistry › Nucleophilic Substitution › SN1 Reaction
- seen: The unimolecular nucleophilic substitution (SN1) has a rate equation of rate = k[R–X]. The mechanism involves 1) formation of a carbocation (rate-determining), 2) nucleophilic attack leading to racemization, and 3) deprotonation. SN1 is favoured by tertiary substrates due to hyperconjugation and ind…
- big picture: Understanding the SN1 reaction mechanism and why tertiary substrates favour it for an organic chemistry course.
- evidence: Read very slowly at 84 wpm, scrolled back 4 times, and performed multiple related searches.

### ✅ L02-chatgpt-carbocation-repeat

learning yes (0.95) · understanding struggling · subject s_orgo · student prompts 3/3

- path: Organic Chemistry › Carbocations › Stability and Hyperconjugation
- seen: The AI explained that tertiary carbocations are more stable due to hyperconjugation (C-H sigma bonds donating into the empty p orbital) and the inductive effect, using analogies of sharing electron density and friends helping a person in need.
- big picture: Clarifying the concept of hyperconjugation and why tertiary carbocations are stable, for organic chemistry studies.
- evidence: Asked follow-up questions 'i still dont get hyperconjugation' and 'can you explain it simpler'.

### ✅ N01-instagram

learning no (0.99)

- reason: Browsing Instagram social media feed

### ✅ L03-pdf-eigenvalues

learning yes (0.98) · understanding unknown · subject s_linalg

- path: Mathematics › Linear Algebra › Eigenvalues and eigenvectors
- seen: Definitions and examples of eigenvalues and eigenvectors, solving det(A - lambda I) = 0, and their geometric meaning as vectors that maintain direction and scale by lambda under a transformation.
- big picture: Learning eigenvalues and eigenvectors for the MS-A0011 Linear Algebra course.
- evidence: Read lecture notes normally with steady dwell time on mathematical definitions and examples.

### ✅ L04-slides-elimination

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Chemistry › Organic Chemistry › Elimination reactions
- seen: Mechanisms, rate laws, and requirements for E1 and E2 elimination reactions, including Zaitsev's rule predicting the major alkene product.
- big picture: Understanding elimination reactions and reaction mechanisms for the CHEM-A1200 Organic Chemistry I course.
- evidence: Read course presentation slides detailing reaction mechanisms and kinetics.

### ✅ N02-youtube-vlog

learning no (0.99)

- reason: Watching a lifestyle YouTube vlog

### ✅ L05-gdocs-essay-assignment

learning yes (0.95) · understanding unclear · subject s_writing · assignment "Assignment 2: Argumentative essay" due 2026-10-30

- path: Academic Writing › Essay Structure › Thesis Statement
- seen: Assignment 2 asks for a 1,200-word argumentative essay with three peer-reviewed sources and a counter-argument. The draft evaluates green solvents in chemistry labs, but a peer reviewer noted the thesis is too vague.
- big picture: Improving an argumentative essay draft to meet academic writing course requirements.
- evidence: Scrolled back 2 times, searched for 'how to write a strong thesis statement', and reviewed peer feedback on the draft thesis.

### ✅ L06-mycourses-problem-set

learning yes (0.95) · understanding unknown · subject s_orgo · assignment "Problem set 4: Substitution and elimination" due 2026-11-03

- path: Organic Chemistry › Substitution and Elimination › SN2 Reaction
- seen: Problem set 4 requires ranking substrates (methyl bromide, 2-bromopropane, 1-bromobutane, 2-bromo-2-methylpropane) by SN2 rate, predicting major products for 2-bromo-2-methylbutane in ethanol, and explaining the stereochemistry of (R)-2-bromobutane reacting with NaOH.
- big picture: Completing organic chemistry problem set 4 on substitution and elimination mechanisms.
- evidence: Viewed MyCourses assignment page listing specific substitution and elimination homework problems.

### ✅ N03-yle-news-fi

learning no (0.99)

- reason: Reading general news on Yle Uutiset

### ✅ L07-claude-determinant-wrong

learning yes (0.99) · understanding unclear · subject s_linalg · student prompts 2/2

- path: Linear Algebra › Matrices › Determinants
- seen: Cofactor expansion along the first row: det(A) = a11·det(M11) − a12·det(M12) + a13·det(M13). Example matrix [[2,0,1],[1,3,2],[1,1,1]] has determinant 0 because 2(3-2) + 0 + 1(1-3) = 0. A determinant of 0 means the matrix is not invertible.
- big picture: Learning how to compute determinants of 3x3 matrices for Linear Algebra.
- evidence: Student proposed an incorrect determinant (1 instead of 0) and the AI corrected them.

### ✅ L08-khan-video-matrix-mult

learning yes (0.98) · understanding unknown · subject s_linalg

- path: Linear Algebra › Matrix Transformations › Matrix Multiplication
- seen: To get the entry in row i, column j of a matrix product, dot row i of matrix A with column j of matrix B (e.g. 1·5 + 2·7 = 19). Product AB is only defined if columns of A equals rows of B. Matrix multiplication is not commutative (AB != BA).
- big picture: Studying matrix multiplication rules and examples for Linear Algebra.
- evidence: Watched a Khan Academy tutorial video on matrix product examples.

### ✅ N04-zalando-shopping

learning no (0.99)

- reason: Shopping for sneakers on Zalando

### ✅ L09-anki-nucleophiles

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reagents › Nucleophiles and Leaving Groups
- seen: Good nucleophiles in polar aprotic solvents have high electron density and charge, following basicity (F- > Cl- > Br- > I-). Water is a good leaving group (weak base) but only a weak nucleophile.
- big picture: Reviewing nucleophilicity and leaving groups using Anki flashcards for an organic chemistry course.
- evidence: Reviewed Anki flashcards about nucleophiles and leaving groups.

### ✅ L10-textbook-exercises

learning yes (0.96) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic Substitution › SN1 and SN2 Exercises
- seen: Chapter 15 problems on predicting SN1 vs SN2 reactions, explaining the zero-order rate of t-BuCl hydrolysis regarding hydroxide concentration, drawing transition states for (S)-2-iodooctane, and analyzing why neopentyl bromide reacts slowly.
- big picture: Solving textbook problems on nucleophilic substitution to prepare for organic chemistry assignments or exams.
- evidence: Read Chapter 15 exercises for 12 minutes at a normal pace.

### ✅ N05-messages-smalltalk

learning no (0.99)

- reason: Small talk messaging on WhatsApp

### ✅ L11-arxiv-attention

learning yes (0.92) · understanding unclear (expected unknown) · subject new:Machine Learning

- path: Artificial Intelligence › Deep Learning › Transformers
- seen: The Transformer architecture relies solely on attention mechanisms instead of recurrence or convolutions. Scaled dot-product attention computes softmax of QK^T / sqrt(d_k) multiplied by V, where division by sqrt(d_k) prevents extremely small gradients for large d_k.
- big picture: Learning how the Transformer model and scaled dot-product attention work, likely for curiosity or personal study in machine learning.
- evidence: Read at 120 wpm vs 210 usual and searched for 'what is self attention'.

### ✅ L12-python-docs-classes

learning yes (0.95) · understanding unclear (expected unknown) · subject new:Python Programming

- path: Computer Science › Programming › Python Classes
- seen: Classes support attribute references and instantiation. Class instantiation calls a parameterless function returning a new instance, invoking __init__() if defined. Method objects pass the instance as the first argument, so x.f() is equivalent to MyClass.f(x).
- big picture: Learning Python object-oriented programming concepts for writing software.
- evidence: Read at 170 wpm, scrolled back twice, and searched for 'python self keyword'.

### ✅ N06-system-settings

learning no (0.99)

- reason: System Settings screen

### ✅ L13-fi-wiki-fotosynteesi

learning yes (0.95) · understanding unknown · subject new:Biology · not in Finnish

- path: Biology › Photosynthesis › Light and dark reactions
- seen: Photosynthesis converts light energy into chemical energy in chloroplasts. It consists of light reactions on thylakoid membranes (making ATP, NADPH, and O2 from water) and the Calvin cycle in the stroma (fixing CO2 into sugars). Overall reaction: 6 CO2 + 6 H2O -> C6H12O6 + 6 O2.
- big picture: Understanding the process of photosynthesis and its light and dark reactions, likely for a general science or biology background topic.
- evidence: Read Wikipedia article on photosynthesis and searched for 'fotosynteesi valoreaktiot'.

### ✅ L14-fi-chatgpt-derivaatta

learning yes (0.95) · understanding understood (expected unknown|unclear) · subject new:Calculus · student prompts 2/2 · not in Finnish

- path: Mathematics › Calculus › Derivatives
- seen: The AI explained that a derivative measures the rate of change of a function and corresponds to the slope of the tangent line. Using f(x) = x², the derivative is f'(x) = 2x, so at x = 3 the growth rate is 6.
- big picture: Learning the concept and geometric interpretation of derivatives for mathematics, outside current registered courses.
- evidence: Asked ChatGPT to explain derivatives for a high school student level and requested an example.

### ✅ N07-netflix

learning no (0.99)

- reason: Browsing Netflix

### ✅ L15-quiz-wrong-answer

learning yes (0.95) · understanding struggling · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN2 stereochemistry
- seen: Question 2 on Weekly quiz 5: (R)-2-bromobutane with hydroxide via SN2 results in inversion of configuration (Walden inversion), not a racemic mixture. Racemization occurs in SN1 via a planar carbocation.
- big picture: Reviewing a failed quiz question on SN2 stereochemistry for Organic Chemistry I to correct misconceptions.
- evidence: Read slowly (110 wpm), scrolled back twice, and reviewed an incorrect quiz answer and feedback.

### ✅ L16-youtube-mit-ocw

learning yes (0.95) · understanding unknown · subject s_linalg

- path: Linear Algebra › Matrices › Matrix Inverse
- seen: A matrix has no inverse if there is a nonzero vector x where Ax = 0. Gauss-Jordan elimination can be performed by placing A next to the identity matrix and eliminating until A becomes the identity, transforming the identity into A inverse.
- big picture: Studying matrix inverses and Gauss-Jordan elimination for the Linear Algebra course.
- evidence: Watched an educational MIT OpenCourseWare lecture video for 18 minutes.

### ✅ N08-gmail-triage

learning no (0.98)

- reason: Checking email inbox

### ✅ L17-notion-own-notes

learning yes (0.95) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reaction Mechanisms › Substitution and Elimination
- seen: Summary notes on SN2 (one step, backside attack, inversion, rate = k[RX][Nu], methyl > 1° > 2°), SN1 (two steps, carbocation, racemization, rate = k[RX], 3° > 2°), E2 (strong/bulky base, anti-periplanar, Zaitsev/Hofmann), and E1 (heat, weak base, carbocation competing with SN1).
- big picture: Consolidating and revising reaction mechanisms for organic chemistry study.
- evidence: Read notes covering SN1, SN2, E1, and E2 mechanisms at normal reading speed.

### ✅ L18-exam-info-page

learning yes (0.98) · understanding unknown · subject s_orgo · assignment "Midterm exam" due 2026-12-12

- path: Organic Chemistry › Exams › Midterm Exam Information
- seen: Midterm exam for CHEM-A1200 Organic Chemistry I is on Saturday 12 December 2026, 9:00–12:00 in hall A1, covering chapters 1–6. Registration in Sisu is required by 1 December.
- big picture: Checking exam schedule, coverage, and administrative requirements for the organic chemistry course.
- evidence: Read official course page listing exam date, time, venue, and syllabus.

### ✅ N09-spotify

learning no (0.99)

- reason: Listening to music on Spotify

### ✅ L19-chatgpt-understood-sn2

learning yes (0.98) · understanding understood · subject s_orgo · student prompts 1/2

- path: Organic Chemistry › Substitution reactions › SN2
- seen: The AI explained SN2 backside attack, planar transition state, and configuration inversion in 3 bullet points, then asked about the product of (R)-2-bromobutane + OH⁻. The student correctly answered (S)-2-butanol due to the umbrella-like flip.
- big picture: Learning SN2 stereochemistry and Walden inversion for a first-year organic chemistry course.
- evidence: Student explained back-side attack and inversion correctly; AI confirmed 'Exactly right'.

### ✅ L20-textbook-fast-read

learning yes (0.95) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic substitution › Leaving groups and solvents
- seen: Good leaving groups are conjugate bases of strong acids (iodide, bromide, tosylate); alcohols need protonation/tosylation. Nucleophile strength affects SN2 rate. Polar aprotic solvents (DMSO, acetone) accelerate SN2 by leaving anions unsolvated.
- big picture: Understanding the factors influencing nucleophilic substitution (leaving groups, nucleophiles, and solvents) for Organic Chemistry I.
- evidence: Normal reading pace on textbook PDF regarding substitution reactions.

### ✅ N10-budget-sheet

learning no (0.99)

- reason: Personal budget spreadsheet

### ✅ R01-real-chatgpt-sn1-sn2-misconceptions

learning yes (0.99) · understanding unclear · subject s_orgo

- path: Organic Chemistry › Reaction Mechanisms › SN1 vs SN2
- seen: The AI explained differences in mechanism, step count, substrate preferences (tertiary for SN1, primary for SN2), solvents (polar protic vs aprotic), and leaving group stability (weak bases like Br- are good leaving groups).
- big picture: Clarifying misconceptions about SN1 and SN2 reactions for an organic chemistry course.
- evidence: Asked detailed conceptual questions about leaving groups, solvents, and secondary carbons, and responded to quiz questions.

### ✅ R02-real-chatgpt-home-typed-practice-prompt

learning yes (0.95) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reaction Mechanisms › Practice
- seen: Prompting ChatGPT to provide reaction contexts (substrate, nucleophile, solvent) for reaction prediction practice between SN1 and SN2.
- big picture: Practicing reaction prediction for organic chemistry.
- evidence: Typed a structured prompt requesting reaction contexts and feedback.

### ✅ R04-real-chatgpt-empty-start-page

learning no (0.99)

- reason: Empty ChatGPT start page

### ✅ R03-real-gemini-home-typed-sn1-prompt

learning yes (0.95) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN1 vs SN2
- seen: The student asked Gemini to explain the key differences in mechanism, rate laws, preferred substrate types, nucleophiles, and solvents for SN1 and SN2 reactions using short structured bullet points, followed by a check question.
- big picture: Learning the core differences between SN1 and SN2 reactions for the Organic Chemistry I course.
- evidence: Asked for key differences in mechanism and rate laws, preferred substrates, nucleophiles, and solvents with specific structural formatting constraints.

### ✅ R05-real-chatgpt-empty-start-page-fi

learning no (0.99)

- reason: Empty ChatGPT start page with sign-in and terms text

### ✅ R06-real-gemini-empty-start-page-ocr

learning no (0.99)

- reason: Empty Gemini start page with bookmarks and navigation

### ✅ R07-real-dumbledore-mock-chat-test-page

learning no (0.99)

- reason: Mock ChatGPT test page

### ✅ R08-real-claude-code-with-dumbledore-demo-home

learning no (0.99)

- reason: Claude Code fixing screen-reading helper crashes while showing Dumbledore coach UI

### ✅ R09-real-claude-with-dumbledore-demo-subject-page

learning no (0.99)

- reason: Claude Code fixing macOS permissions and displaying Dumbledore subject page

### ✅ R10-real-claude-code-signing-dev-work

learning no (0.99)

- reason: Software development and code-signing with Claude

### ✅ R11-real-claude-permissions-dev-work

learning no (0.99)

- reason: Configuring app permissions, software installation, and Dumbledore coaching UI views

### ✅ R12-real-claude-code-agent-status

learning no (1)

- reason: Building or fixing one's own software with a coding agent
