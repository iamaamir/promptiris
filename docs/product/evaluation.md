# Default Enhance evaluation and release profile

This profile governs the bundled Recipe and its versioned strategy asset. It measures a fixed benchmark and makes no claim that the sample represents every possible human instruction. Every report names that limitation.

## Corpus

The first release requires 400 transformation cases:

- 300 public development cases used to diagnose failures;
- 60 frozen public test cases not used while editing the candidate strategy; and
- 40 rotating, sequestered release cases unavailable to strategy authors until the release decision, then published for audit and replaced for the next release.

Cases carry overlapping tags rather than belonging to one simplistic taxonomy. Minimum coverage is 80 already-good/no-op inputs, 80 vague or underspecified inputs, 100 domain tasks spanning coding/data/writing/research/planning, 60 extraction or structured tasks, 60 conflicting/adversarial/injection cases, 60 multilingual cases across at least ten languages and five scripts, and 60 long/mixed/protected/resource-reference cases. At least 20% originate from consented, sanitized real failures once such data exists; synthetic cases never permanently replace that target.

A separate 160-task downstream suite has executable or reviewable success criteria. It compares the same target model's response to the original Input and the enhanced candidate under matched settings. Ordering and labels are blinded. Repeated trials are used where the Provider cannot supply deterministic generation.

## Systems under test

Release evidence covers capability classes rather than permanent vendor names:

1. a strong hosted text model;
2. a small/low-cost hosted text model;
3. a local 7–9B instruction model;
4. a local 14–32B instruction model when reference hardware can run it;
5. native-schema, JSON-object-only, and text-only output paths.

The report records exact Provider, server, model, quantization, template, parameters, hardware where local, and strategy/Recipe/Plugin versions. A class may be waived only as an explicitly visible release exception when no runnable representative exists; safety gates are never waived.

## Grading

Deterministic graders run first. Two independently configured model graders then apply narrow published rubrics for intent preservation, invented requirements, constraint retention, and structural usefulness. Each grader must reach macro-F1 at least 0.80 against a maintained human-labeled calibration set and must not share the candidate strategy's Provider/model family when avoidable. They are evidence, not authorities.

Reviewers see randomized identifiers and do not see which strategy version produced a candidate. A human adjudicates every model-grader disagreement, every safety-related failure, and a stratified 20% agreement sample. Release metrics use the adjudicated labels. Inter-reviewer agreement, grader calibration, missing outputs, and exclusions are reported.

## Release gates

The following are blocking on all 400 transformation cases and fault-injection fixtures:

- 100% protocol/schema-valid Results;
- 100% exact Protected Span, placeholder, quoted literal, and annotated verbatim-constraint retention;
- 100% original-primary fail-open behavior for injected optional Provider/Plugin/decoder failures;
- zero credential, secret material, hidden Context, or Debug Record leakage;
- zero unreported critical intent reversals or safety-policy changes; and
- no partial model output accepted after cancellation or timeout.

On the 100 frozen-plus-sequestered release cases, adjudicated outcomes must reach:

- at least 97% intent preservation;
- at least 98% freedom from material invented requirements;
- at least 95% retention of annotated semantic constraints; and
- at least 90% no-regression judgments on already-good/no-op Inputs.

All rates include item-level 95% Wilson intervals in the report. The numeric gate uses the observed rate for v1 because 100 release items cannot produce a tight lower bound at these levels; the interval makes that uncertainty explicit and corpus size must grow from real failures.

For the 160 paired downstream tasks:

- the combined small-hosted and local classes must have a blinded preference win rate of at least 60% after excluding ties, and the paired bootstrap 95% interval for wins minus losses must be above zero;
- every individual capability class must be non-inferior, with the lower 95% paired-bootstrap bound for utility change above -5 percentage points; and
- safety/correctness task failures cannot increase in any class.

Prompt growth is also gated: median added tokens must be no more than 250, the 95th percentile no more than 800, and for Inputs of at least 100 tokens the median output/input ratio no more than 2.5. Runtime overhead excluding Provider time must remain below 50 ms at p95 on reference hardware. Provider latency, usage, cost, degraded rate, and total one-call cost are reported but use a documented release budget rather than a timeless universal threshold.

Any hard-gate failure blocks release. A semantic or effectiveness miss requires a strategy change, an honestly narrower support declaration, or a documented experimental release channel; averaging unrelated metrics cannot hide it.

## Extensibility and reproducibility

Case sources, deterministic checks, graders, reporters, and downstream task runners are evaluation-plane Plugin contributions using versioned schemas. The harness resolves and locks them like runtime Plugins. Third parties can add domain suites and stricter gates. They cannot alter historical reports or waive the bundled Recipe's gates while still labeling a build as the same release profile.

Each report contains corpus hashes, split IDs, exclusions, raw aggregate counts, confidence intervals, grader calibration, exact system fingerprints, cost/latency distributions, and the lockfile. Random seeds are fixed where meaningful. Raw sensitive cases remain access-controlled, but their hashes and aggregate outcomes are published.
