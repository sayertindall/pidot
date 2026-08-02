# Conceptual Design Document

For early ideas: problem framing, product concepts, "should we build this",
and directional bets before any implementation commitment. The costliest
mistake here is solving the wrong problem convincingly. The document's job
is to make the concept attackable before it becomes a roadmap.

## Audience

Decision makers and future implementers. The document succeeds if a reader
can argue against it precisely — a concept nobody can disagree with is not
yet a concept.

## Required sections

1. Metadata, objective, background.
2. **Problem statement with evidence.** Who has the problem, how you know
   (user reports, metrics, support load, observed workarounds), and the cost
   of not solving it. Separate observed facts from interpretation; this
   section decides whether the rest deserves to exist.
3. **The concept.** The proposed thing in one page: what it is, what it is
   not, and the core insight that makes it worth building. If the insight
   cannot be stated in a sentence or two, it is not yet found.
4. **Scenarios.** The world with the thing built: named people, concrete
   walks. These carry more conviction weight here than in any other type.
5. Goals and non-goals, stated as outcomes.
6. **Principles and constraints.** The rules any implementation must honor,
   separated from implementation sketches. This is what survives into later
   design docs.
7. **What we do not know.** Open questions, risky assumptions, and for each:
   the cheapest experiment that would falsify it. Rank assumptions by how
   much collapses if they are wrong.
8. **Alternatives and prior art.** Existing solutions, adjacent products,
   the do-nothing option honestly costed.
9. **Path to conviction.** Not a build plan — the ordered list of experiments
   or prototypes that would earn one, each with what it proves and what it
   costs.

## Optional sections

Rough architecture sketch (label it disposable; a conceptual doc with a
detailed architecture is pretending to be a system doc), market or ecosystem
context, success measures (only if honest ones exist this early).

## Level of detail

- High altitude on solution, high precision on problem and evidence.
- No SLOs, no schemas, no timelines beyond the experiment sequence. Their
  presence signals the wrong document type was chosen.

## Type-specific pitfalls

- Evidence-free problem statements ("users want...") that launder opinion
  into fact.
- The concept described only by its features, never by its insight.
- Non-goals missing, so every reader projects a different product onto the
  document.
- Assumptions listed without falsification paths, which makes them
  decorations.
- Premature architecture that anchors later design before the concept is
  validated.

## Checklist

- Is every problem claim backed by something observable?
- Can the core insight be quoted in one or two sentences?
- Does each risky assumption have a cheapest-experiment attached?
- Is the do-nothing alternative costed honestly?
- Would two readers describe the same product after reading it?
