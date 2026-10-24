# Eval · extraction · 2026-10-24T15:10:33.904Z

Result: **PASS** — 5/5 thresholds met · 142 s · `eval-prompts extraction --provider ovh`

Routes: triage: ovh:gpt-oss-20b → ovh:gpt-oss-120b · extract: ovh:gpt-oss-20b → ovh:gpt-oss-120b · reason: ovh:gpt-oss-120b → ovh:gpt-oss-20b · write: ovh:gpt-oss-20b → ovh:gpt-oss-120b · chat: ovh:gpt-oss-120b → ovh:gpt-oss-20b

Prompt versions: P1v1 P3v1 P4v1 P5v1 P5vv1 P8v1

## Thresholds (PLAN §9.2)

| metric | value | target | |
|---|---|---|---|
| precision | 1 | ≥ 0.85 | ✅ |
| recall | 0.95 | ≥ 0.8 | ✅ |
| three parts always filled | 1 | ≥ 1 | ✅ |
| "struggling" without evidence | 0 | ≤ 0 | ✅ |
| episodes that errored | 0 | ≤ 0 | ✅ |

## Metrics

- episodes: 30
- errors: 0
- tp: 19
- fp: 0
- fn: 1
- tn: 10
- precision: 1
- recall: 0.95
- threePartsFilled: 1
- strugglingWithoutEvidence: 0
- understandingAgreement: 17/19
- subjectAgreement: 19/19
- assignmentsFound: 2/2
- studentPromptCounts: 4/4
- finnishOutputs: 1/2

## Models used

| provider:model | task | calls | failures | tokens in/out | latency p50 / p90 (ms) |
|---|---|---|---|---|---|
| ovh:gpt-oss-20b | extract | 6 | 0 | 13675 / 5483 | 11541 / 18014 |
| ovh:gpt-oss-120b | extract | 4 | 0 | 9032 / 4326 | 30530 / 32231 |

## Cases

### ✅ L01-wiki-sn1-struggle

learning yes (0.92) · understanding struggling · subject s_orgo

- path: Organic Chemistry › SN1
- seen: The unimolecular nucleophilic substitution (SN1) reaction is a substitution reaction in organic chemistry. The rate equation is first‑order in the substrate and zero‑order in the nucleophile. The mechanism involves formation of a planar carbocation (slow, rate‑determining), followed by fast nucleoph…
- big picture: Trying to understand the SN1 mechanism and why tertiary substrates are favored, likely for an upcoming organic chemistry exam.
- evidence: Reading 84 wpm vs 210 usual, scrolled back 4 times, searched for SN1 vs SN2 and tertiary carbocation stability.

### ✅ L02-chatgpt-carbocation-repeat

learning yes (0.88) · understanding unclear · subject s_orgo · student prompts 3/3

- path: Organic Chemistry › Carbocation Stability
- seen: The AI explained that tertiary carbocations are more stable because of hyperconjugation—C–H σ bonds on neighboring carbons donate electron density into the empty p orbital—and inductive effect, where alkyl groups push electron density toward the positive carbon. It then offered a simplified analogy:…
- big picture: Seeking a clearer explanation of why tertiary carbocations are more stable, focusing on hyperconjugation and inductive effects for an organic chemistry course.
- evidence: Repeated question “i still dont get hyperconjugation” and request for simpler explanation.

### ✅ N01-instagram

learning no (0.97)

- reason: Scrolling Instagram feed

### ✅ L03-pdf-eigenvalues

learning yes (0.92) · understanding understood · subject s_linalg

- path: Linear Algebra › Eigenvalues and Eigenvectors
- seen: Definition of eigenvector and eigenvalue, method to find eigenvalues via det(A−λI)=0, example with 2×2 matrix, geometric meaning of eigenvectors.
- big picture: Understanding eigenvalues/eigenvectors for Linear Algebra coursework.
- evidence: Reading at normal speed (190 wpm).

### ✅ L04-slides-elimination

learning yes (0.88) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Elimination reactions › E2 and E1
- seen: Details of E2 and E1 mechanisms, rate laws, base strength, anti-periplanar requirement, Zaitsev's rule for alkene products.
- big picture: Learning elimination reaction mechanisms for Organic Chemistry exam.
- evidence: No specific signals, but content is course material.

### ✅ N02-youtube-vlog

learning no (0.95)

- reason: Watching a personal vlog

### ✅ L05-gdocs-essay-assignment

learning yes (0.96) · understanding unclear · subject s_writing · assignment "Assignment 2: Argumentative essay" due 2026-10-30

- path: Academic Writing › Argumentative Essay › Thesis Statement
- seen: Assignment 2: 1,200‑word argumentative essay due Friday 30 Oct 2026 16:00; instructions to take a clear position, use three peer‑reviewed sources and address a counter‑argument; draft thesis “Green solvents are good and labs should use them more”; peer reviewer says the thesis is too vague; opening …
- big picture: Preparing a 1,200‑word argumentative essay for the academic writing course, focusing on a clear thesis.
- evidence: Scrolled back twice, searched “how to write a strong thesis statement”, and read the assignment brief and peer feedback.

### ✅ L06-mycourses-problem-set

learning yes (0.94) · understanding unknown · subject s_orgo · assignment "Problem set 4" due 2026-11-03

- path: Organic Chemistry › Substitution and Elimination › SN2 Reactivity
- seen: CHEM‑A1200 Organic Chemistry I – Problem set 4: Substitution and elimination; due Tuesday 3 Nov 2026 23:59; three questions asking to rank substrates by SN2 rate, predict the major product in ethanol, and explain stereochemical inversion with NaOH.
- big picture: Working through the organic chemistry problem set on substitution and elimination before the November 3 deadline.
- evidence: Viewed the problem set page, noted due date, and read the three questions about SN2 rates, product prediction, and stereochemistry.

### ✅ N03-yle-news-fi

learning no (0.98)

- reason: Reading Finnish news headlines, not study material

### ✅ L07-claude-determinant-wrong

learning yes (0.96) · understanding unclear · subject s_linalg · student prompts 2/2

- path: Linear Algebra › Determinants › 3×3 determinant via cofactor expansion
- seen: The AI described cofactor expansion along the first row (det = a11·det(M11) − a12·det(M12) + a13·det(M13)) and then evaluated the matrix [[2,0,1],[1,3,2],[1,1,1]] showing the terms 2·(3·1−2·1)=2, middle term 0, last term 1·(1·1−3·1)=−2, giving a determinant of 0, not 1.
- big picture: Learning how to compute a 3×3 determinant, likely for a linear algebra assignment.
- evidence: Student asked for step‑by‑step computation and then checked a specific matrix result.

### ✅ L08-khan-video-matrix-mult

learning yes (0.94) · understanding unknown · subject s_linalg

- path: Linear Algebra › Matrix Operations › Matrix Multiplication
- seen: The video explains that the (1,2) entry of AB is the dot product of the first row of A with the second column of B (1·5 + 2·7 = 19), notes that AB is defined only when columns of A equal rows of B, and reminds that matrix multiplication is generally not commutative.
- big picture: Reviewing matrix multiplication rules for Linear Algebra I.
- evidence: Captions from a Khan Academy video explaining entry computation, dimension matching, and non‑commutativity.

### ✅ N04-zalando-shopping

learning no (0.99)

- reason: Browsing an online store, not studying material

### ✅ L09-anki-nucleophiles

learning yes (0.92) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Reagents › Nucleophiles
- seen: Front: What makes a good nucleophile in a polar aprotic solvent? Back: High electron density and charge; in polar aprotic solvents nucleophilicity follows basicity (F⁻ > Cl⁻ > Br⁻ > I⁻). Front: Is water a good leaving group or a good nucleophile? Back: Water is a good leaving group (weak base); it i…
- big picture: Studying nucleophile and leaving group properties for an organic chemistry course.
- evidence: No signals, but content is flashcards on nucleophilicity and leaving groups.

### ✅ L10-textbook-exercises

learning yes (0.88) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic substitution › SN1 & SN2
- seen: Problems — Chapter 15: Nucleophilic substitution at saturated carbon
15.1 Which of these reactions will go by SN1 and which by SN2? (a) t-BuCl + MeOH (b) MeI + NaCN in DMSO (c) PhCH2Br + H2O.
15.2 Explain why the rate of hydrolysis of t-BuCl does not depend on the concentration of hydroxide.
15.3 Dr…
- big picture: Practicing nucleophilic substitution problems for an organic chemistry exam.
- evidence: Reading at 150 wpm (normal) and scrolled back once.

### ✅ N05-messages-smalltalk

learning no (0.95)

- reason: WhatsApp small talk

### ✅ L11-arxiv-attention

learning yes (0.92) · understanding unclear (expected unknown) · subject new:Machine Learning

- path: Computer Science › Machine Learning › Transformer Models
- seen: The paper proposes the Transformer, a network based solely on attention mechanisms, and explains Scaled Dot‑Product Attention: Attention(Q,K,V)=softmax(QKᵀ/√dk)V, noting that large dk can push softmax into low‑gradient regions.
- big picture: Trying to understand the Transformer architecture for a machine‑learning project or course.
- evidence: Reading slow (120 wpm vs 210 usual) and scrolled back once; searched "what is self attention".

### ✅ L12-python-docs-classes

learning yes (0.88) · understanding unclear (expected unknown) · subject new:Python Programming

- path: Computer Science › Programming Languages › Python
- seen: The docs explain that class objects support attribute references and instantiation; __init__ is a special method for initializing new instances; methods receive the instance as the first argument, so x.f() is equivalent to MyClass.f(x).
- big picture: Learning Python OOP fundamentals for a programming assignment.
- evidence: Reading normal (170 wpm) but scrolled back twice; searched "python self keyword".

### ✅ N06-system-settings

learning no (0.95)

- reason: Checking Wi‑Fi settings

### ✅ L13-fi-wiki-fotosynteesi

learning yes (0.93) · understanding unknown · subject new:Biology · written in Finnish

- path: Biology › Photosynthesis › Light-dependent and Calvin cycle
- seen: Fotosynteesi on prosessi, jossa kasvit, levät ja syanobakteerit muuttavat valoenergiaa kemialliseksi energiaksi; se tapahtuu kloroplasteissa ja jakautuu valo- (valoreaktioissa vesi hajoaa, vapautuu happea, syntyy ATP:tä ja NADPH:ta) ja pimeäreaktioihin (Calvinin kierto, jossa CO₂ sidotaan sokeriksi …
- big picture: Grasping the overall process of photosynthesis, likely for a general science overview or upcoming exam.
- evidence: Reading at normal speed and performing a search for "valoreaktiot" indicates focused study.

### ✅ L14-fi-chatgpt-derivaatta

learning yes (0.96) · understanding unclear · subject new:Calculus · student prompts 2/2 · not in Finnish

- path: Mathematics › Calculus › Derivatives
- seen: AI selitti derivaatan mittaavan, kuinka nopeasti funktion arvo muuttuu tietyssä kohdassa, graafisesti se on tangentin kulmakerroin; esimerkkinä f(x)=x², derivaatta f'(x)=2x, ja pisteessä x=3 kasvunopeus on 6.
- big picture: Learning the basic definition and a concrete example of a derivative, likely for a math prerequisite or exam.
- evidence: Student asked for a simpler explanation and then requested an example, showing active engagement.

### ✅ N07-netflix

learning no (0.98)

- reason: Browsing Netflix home page, no educational content

### ✅ L15-quiz-wrong-answer

learning yes (0.92) · understanding unclear · subject s_orgo

- path: Organic Chemistry › SN2
- seen: Feedback explained that SN2 is a concerted backside attack causing Walden inversion: (R) gives (S); racemization occurs in SN1 via a planar carbocation.
- big picture: Understanding how SN2 reactions affect stereochemistry, likely for an organic chemistry exam.
- evidence: Read at 110 wpm vs 210 usual and scrolled back 2 times.

### ✅ L16-youtube-mit-ocw

learning yes (0.88) · understanding unknown · subject s_linalg

- path: Linear Algebra › Matrices › Inverse
- seen: The lecture explained that a matrix has an inverse iff no nonzero vector satisfies Ax=0, and showed how to use Gauss‑Jordan to compute the inverse.
- big picture: Learning the conditions for matrix invertibility and the Gauss‑Jordan method, likely for a linear algebra assignment.
- evidence: No signals, but long video watch time (18m20s).

### ✅ N08-gmail-triage

learning no (0.95)

- reason: Checking email inbox

### ✅ L17-notion-own-notes

learning yes (0.96) · understanding understood · subject s_orgo

- path: Organic Chemistry › Reaction Mechanisms › Substitution and Elimination
- seen: Student notes summarising four organic mechanisms: SN2 (one‑step, backside attack, inversion, rate ∝ [RX][Nu]; methyl > 1° > 2°; never 3°), SN1 (two‑step carbocation, racemisation, rate ∝ [RX]; 3° > 2°, polar protic solvent), E2 (strong/bulky base, anti‑periplanar, Zaitsev unless bulky base → Hofman…
- big picture: Reviewing core organic reaction mechanisms to prepare for the upcoming midterm exam.
- evidence: Reading speed normal and revisited notes today, indicating purposeful study.

### ❌ L18-exam-info-page

learning no (0.94) ✗

- reason: Viewing exam schedule and logistics, not content learning

### ✅ N09-spotify

learning no (0.98)

- reason: Listening to music, no educational content

### ✅ L19-chatgpt-understood-sn2

learning yes (0.95) · understanding understood · subject s_orgo · student prompts 2/2

- path: Organic Chemistry › Nucleophilic substitution › SN2
- seen: • The nucleophile attacks the carbon from the side opposite the leaving group (backside attack). • In the transition state the three other groups are flat, like an umbrella in the wind. • As the leaving group departs, the groups flip to the other side: the configuration is inverted. Question: what p…
- big picture: Understanding SN2 inversion for a first‑year organic chemistry course, likely for an upcoming exam or assignment.
- evidence: Student asked for a quiz and answered correctly.

### ✅ L20-textbook-fast-read

learning yes (0.9) · understanding unknown · subject s_orgo

- path: Organic Chemistry › Nucleophilic substitution › SN2
- seen: Nucleophilic substitution at saturated carbon
The leaving group: the best leaving groups are the conjugate bases of strong acids. Iodide, bromide and tosylate leave easily; hydroxide does not, which is why alcohols must be protonated or converted into tosylates before substitution.
The nucleophile: …
- big picture: Reading textbook to understand factors influencing SN2 reactions for coursework.
- evidence: Reading at normal speed (260 wpm) with no signs of confusion.

### ✅ N10-budget-sheet

learning no (0.97)

- reason: Budget spreadsheet, no learning content
