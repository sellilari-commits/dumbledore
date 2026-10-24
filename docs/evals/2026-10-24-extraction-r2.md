# Eval · extraction · 2026-10-24T15:52:34.534Z

Result: **PASS** — 5/5 thresholds met · 8 s · `eval-prompts extraction --provider gemini --concurrency 4 --max-eur 0.07 --timeout 90000`

Routes: triage: gemini:gemini-3.5-flash-lite · extract: gemini:gemini-3.5-flash-lite · reason: gemini:gemini-3.5-flash · write: gemini:gemini-3.5-flash · chat: gemini:gemini-3.5-flash

Prompt versions: P1v1 P3v1 P4v1 P5v1 P5vv1 P8v1

Estimated spend: **€0.0242** (src/engine/brain/llm/prices.ts; EUR = USD; thinking tokens billed as output)

## Thresholds (PLAN §9.2)

| metric | value | target | |
|---|---|---|---|
| precision | 1 | ≥ 0.85 | ✅ |
| recall | 1 | ≥ 0.8 | ✅ |
| three parts always filled | 1 | ≥ 1 | ✅ |
| "struggling" without evidence | 0 | ≤ 0 | ✅ |
| episodes that errored | 0 | ≤ 0 | ✅ |

## Metrics

- episodes: 30
- errors: 0
- tp: 20
- fp: 0
- fn: 0
- tn: 10
- precision: 1
- recall: 1
- threePartsFilled: 1
- strugglingWithoutEvidence: 0
- understandingAgreement: 17/20
- subjectAgreement: 19/20
- assignmentsFound: 3/3
- studentPromptCounts: 4/4
- finnishOutputs: 0/2

## Models used

| provider:model | task | calls | failures | tokens in/out | latency p50 / p90 (ms) |
|---|---|---|---|---|---|
| gemini:gemini-3.5-flash-lite | extract | 10 | 0 | 23521 / 6843 | 2559 / 3047 |

## Cases

### ✅ L01-wiki-sn1-struggle

learning yes (0.99) · understanding struggling · subject s_orgo

- path: Organic Chemistry › Nucleophilic substitution › SN1
- seen: SN1 is a unimolecular nucleophilic substitution reaction. Rate = k[R-X]. Mechanism involves: 1. Formation of carbocation (slow, rate-determining). 2. Nucleophilic attack leading to racemization. 3. Deprotonation. Favoured by tertiary substrates due to hyperconjugation and inductive effect, and polar…
- big picture: Understanding the mechanism and scope of SN1 reactions for the Organic Chemistry course.
- evidence: Read very slowly at 84 wpm, scrolled back 4 times, and searched for SN1 vs SN2 differences.

### ✅ L02-chatgpt-carbocation-repeat

learning yes (0.99) · understanding struggling · subject s_orgo · student prompts 3/3

- path: Organic Chemistry › Nucleophilic substitution › Carbocation stability
- seen: The AI explained tertiary carbocation stability via hyperconjugation (C-H sigma bonds donating electron density into the empty p orbital) and the inductive effect. It used analogies like spreading charge out and friends lending electron density.
- big picture: Trying to grasp hyperconjugation and why tertiary carbocations are stable during organic chemistry study.
- evidence: Asked 'i still dont get hyperconjugation' and 'can you explain it simpler'.

### ✅ N01-instagram

learning no (0.99)

- reason: Browsing Instagram feed

### ✅ L03-pdf-eigenvalues

learning yes (0.98) · understanding unknown · subject s_linalg

- path: Linear Algebra › Eigenvalues and Eigenvectors › Definitions and Computation
- seen: Definition of eigenvalue and eigenvector: Av = λv. Eigenvalues are found by solving the characteristic equation det(A - λI) = 0. Example with matrix [[2, 1], [1, 2]] yielding eigenvalues λ = 3 and λ = 1, with corresponding eigenvectors. Geometric meaning: eigenvectors maintain direction under transf…
- big picture: Understanding eigenvalues and eigenvectors for the Linear Algebra course, specifically Lecture 5.
- evidence: Read at normal speed with standard academic presentation of course material.

### ✅ L04-slides-elimination

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Elimination Reactions › E1 and E2 Mechanisms
- seen: E2 is a concerted step requiring anti-periplanar H and leaving group, second-order kinetics, favoured by strong bulky bases. E1 proceeds via a carbocation in two steps, first-order kinetics, competes with SN1, favoured by heat and weak bases. Zaitsev's rule determines the major product as the more s…
- big picture: Learning E1 and E2 elimination reactions for the Organic Chemistry I course.
- evidence: Detailed lecture slide content covering chemical mechanisms and reaction conditions.

### ✅ N02-youtube-vlog

learning no (0.99)

- reason: Watching a YouTube lifestyle vlog

### ✅ L05-gdocs-essay-assignment

learning yes (0.98) · understanding unclear · subject s_writing · assignment "Assignment 2: Argumentative essay" due 2026-10-30

- path: Academic Writing › Essay Structure › Thesis Statement
- seen: Assignment 2 for LC-1310 Academic Writing: 1,200-word argumentative essay due Oct 30, 2026. The draft evaluates whether first-year chemistry labs should switch to green solvents, and a peer reviewer noted the thesis statement is too vague.
- big picture: Refining the thesis statement and structure of an argumentative essay about green solvents for an academic writing course.
- evidence: Scrolled back 2 times, searched 'how to write a strong thesis statement', and viewed assignment instructions and peer feedback.

### ✅ L06-mycourses-problem-set

learning yes (0.98) · understanding unknown · subject s_orgo · assignment "Problem set 4: Substitution and elimination" due 2026-11-03

- path: Organic Chemistry › Substitution and Elimination › SN2 Reactions
- seen: CHEM-A1200 Organic Chemistry I Problem set 4 due Nov 3, 2026. Includes questions on ranking substrates by SN2 rate (methyl bromide, 2-bromopropane, 1-bromobutane, 2-bromo-2-methylpropane), predicting major products, and explaining stereochemical inversion.
- big picture: Reviewing homework problems on substitution and elimination mechanisms for an organic chemistry course.
- evidence: Viewed MyCourses assignment page containing specific problem set questions.

### ✅ N03-yle-news-fi

learning no (0.99)

- reason: Reading general news on Yle Uutiset

### ✅ L07-claude-determinant-wrong

learning yes (0.98) · understanding struggling · subject s_linalg · student prompts 2/2

- path: Mathematics › Linear Algebra › Determinants
- seen: Cofactor expansion along the first row for a 3x3 matrix: det(A) = a11·det(M11) − a12·det(M12) + a13·det(M13). For matrix [[2,0,1],[1,3,2],[1,1,1]], the correct determinant is 0.
- big picture: Learning how to compute the determinant of a 3x3 matrix using cofactor expansion for linear algebra.
- evidence: Student's manual calculation yielded 1 instead of the correct 0, indicating a sign or minor computation error.

### ✅ L08-khan-video-matrix-mult

learning yes (0.95) · understanding unknown · subject s_linalg

- path: Mathematics › Linear Algebra › Matrix Multiplication
- seen: To find the entry in row 1, column 2 of product AB, take the dot product of row 1 of A and column 2 of B. The product AB is defined only when columns of A equals rows of B. Matrix multiplication is not commutative.
- big picture: Understanding the mechanics and rules of matrix multiplication for linear algebra.
- evidence: Watched a Khan Academy video explaining matrix product examples and non-commutativity.

### ✅ N04-zalando-shopping

learning no (0.99)

- reason: Shopping for shoes on Zalando

### ✅ L09-anki-nucleophiles

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic Substitution › Nucleophiles and Leaving Groups
- seen: Good nucleophiles in polar aprotic solvents have high electron density/charge, following basicity (F⁻ > Cl⁻ > Br⁻ > I⁻). Water is a good leaving group (weak base) and a weak nucleophile.
- big picture: Reviewing core concepts about nucleophilicity and leaving groups for an organic chemistry course.
- evidence: Anki flashcard review format with fronts and backs covering organic chemistry reagents.

### ✅ L10-textbook-exercises

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic Substitution › SN1 and SN2 Practice
- seen: Solving Chapter 15 problems on nucleophilic substitution at saturated carbon: predicting SN1 vs SN2 for given reactions, explaining reaction rates, drawing transition states, and analyzing steric hindrance in neopentyl bromide.
- big picture: Practicing textbook problem sets to prepare for organic chemistry assignments or exams.
- evidence: Reading through textbook problem set with normal reading speed and one scroll back.

### ✅ N05-messages-smalltalk

learning no (0.99)

- reason: Messaging friends on WhatsApp

### ✅ L11-arxiv-attention

learning yes (0.92) · understanding unclear (expected unknown) · subject new:Artificial Intelligence

- path: Computer Science › Artificial Intelligence › Transformers › Scaled Dot-Product Attention
- seen: The Transformer architecture uses scaled dot-product attention computed as Attention(Q, K, V) = softmax(QKᵀ/√dk)V. Dividing by √dk prevents extremely small gradients in the softmax function for large dk.
- big picture: Learning how self-attention works in the Transformer model, likely out of personal or research curiosity.
- evidence: Read slowly at 120 wpm, searched for 'what is self attention', and read the equation section.

### ✅ L12-python-docs-classes

learning yes (0.95) · understanding unclear (expected unknown) · subject new:Python Programming

- path: Computer Science › Programming › Python › Classes and Methods
- seen: Class instantiation creates an empty object, and __init__() initializes it. Method objects automatically pass the instance object as the first argument, so x.f() is equivalent to MyClass.f(x).
- big picture: Learning object-oriented programming concepts in Python for coding practice or a project.
- evidence: Read at normal speed with some scrolling back and a search for 'python self keyword'.

### ✅ N06-system-settings

learning no (0.99)

- reason: Adjusting Wi-Fi settings

### ✅ L13-fi-wiki-fotosynteesi

learning yes (0.92) · understanding unknown · subject new:Biology · not in Finnish

- path: Biology › Photosynthesis › Light and dark reactions
- seen: Photosynthesis converts light energy to chemical energy in chloroplasts, divided into light reactions on thylakoid membranes producing ATP and NADPH, and Calvin cycle in stroma fixing CO2. Total reaction: 6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂.
- big picture: Learning or reviewing the basics of photosynthesis and its chemical equation, likely out of general curiosity or for a biology module.
- evidence: Read at normal pace with a search for 'fotosynteesi valoreaktiot'.

### ✅ L14-fi-chatgpt-derivaatta

learning yes (0.95) · understanding understood (expected unknown|unclear) · subject s_linalg ✗ · student prompts 2/2 · not in Finnish

- path: Mathematics › Calculus › Derivatives
- seen: The AI explained a derivative as the rate of change of a function at a point (tangent slope) and gave an example with f(x) = x² and its derivative f'(x) = 2x.
- big picture: Building an intuitive understanding of derivatives using simple examples, likely brushing up on high school math or preparing for university mathematics.
- evidence: Asked for an explanation geared towards a high schooler and requested an example.

### ✅ N07-netflix

learning no (0.98)

- reason: Browsing Netflix entertainment streaming service

### ✅ L15-quiz-wrong-answer

learning yes (0.98) · understanding struggling · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › SN2 Stereochemistry
- seen: SN2 is a concerted backside attack causing configuration inversion (Walden inversion), turning (R) into (S), whereas racemization occurs in SN1 via a planar carbocation. Acetone is a solvent favouring SN2.
- big picture: Reviewing a failed quiz question on SN2 stereochemistry to understand why the product of (R)-2-bromobutane with hydroxide is inverted rather than racemic.
- evidence: Read slowly at 110 wpm and scrolled back 2 times to review the incorrect answer feedback.

### ✅ L16-youtube-mit-ocw

learning yes (0.95) · understanding unknown · subject s_linalg

- path: Linear Algebra › Matrices › Matrix Inverses
- seen: A matrix has no inverse if a nonzero vector x exists such that Ax = 0. For square matrices, left inverse equals right inverse. Gauss-Jordan elimination transforms [A I] into [I A^(-1)].
- big picture: Studying matrix multiplication, inverses, and Gauss-Jordan elimination for Linear Algebra.
- evidence: Watched an 18-minute segment of an MIT OpenCourseWare lecture on linear algebra.

### ✅ N08-gmail-triage

learning no (0.99)

- reason: Checking personal emails and notifications

### ✅ L17-notion-own-notes

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reaction Mechanisms › Substitution and Elimination
- seen: Summary of SN2, SN1, E2, and E1 reaction mechanisms, including step counts, stereochemistry, rate laws, and substrate preferences.
- big picture: Reviewing and consolidating reaction mechanisms for Organic Chemistry, likely preparing for coursework or exams.
- evidence: Reading personal study notes summarizing reaction mechanisms at a normal speed.

### ✅ L18-exam-info-page

learning yes (0.99) · understanding unknown · subject s_orgo · assignment "Midterm exam" due 2026-12-12

- path: Organic Chemistry › Exam Information
- seen: Midterm exam for CHEM-A1200 Organic Chemistry I is on Saturday 12 December 2026, covering chapters 1-6. Registration deadline in Sisu is 1 December.
- big picture: Finding out exam dates, coverage, and logistics for the Organic Chemistry course.
- evidence: Viewing the official announcements page for the course on MyCourses.

### ✅ N09-spotify

learning no (0.99)

- reason: Listening to music on Spotify

### ✅ L19-chatgpt-understood-sn2

learning yes (0.99) · understanding understood · subject s_orgo · student prompts 2/2

- path: Organic Chemistry › Substitution Reactions › SN2 › Stereochemistry
- seen: The AI explained SN2 inversion in 3 bullet points: backside attack by the nucleophile, a flat transition state like an umbrella in the wind, and configuration inversion as the leaving group departs. It then quizzed the student on (R)-2-bromobutane + OH-, and the student answered correctly with (S)-2…
- big picture: Understanding the stereochemical inversion mechanism of SN2 reactions for an organic chemistry course.
- evidence: Student answered the AI's quiz question correctly and the AI confirmed it was exactly right.

### ✅ L20-textbook-fast-read

learning yes (0.98) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Substitution Reactions › Nucleophilic Substitution › Leaving Groups and Solvents
- seen: Good leaving groups are conjugate bases of strong acids (iodide, bromide, tosylate). Alcohols need protonation or tosylation to leave. Nucleophile strength matters in SN2 but not SN1. Polar aprotic solvents (DMSO, acetone) accelerate SN2 by leaving anions unsolvated and reactive.
- big picture: Learning the factors affecting nucleophilic substitution reactions from a textbook for organic chemistry.
- evidence: Read normally at 260 wpm with continuous textbook text covering chemical principles.

### ✅ N10-budget-sheet

learning no (0.99)

- reason: Managing monthly personal budget in Google Sheets
