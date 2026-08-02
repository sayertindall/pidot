# Feature Design Document

For a change inside an existing system: a new capability, a subsystem
overhaul, a refactor with behavioral consequences. The costliest mistakes
here are integration mistakes: the design is right in isolation and wrong
against the code that exists.

## Audience

Engineers who know the system. Do not re-explain the whole architecture;
link it. Do explain the corner of it this change touches, with evidence.

## Required sections

1. Metadata, objective, background.
2. **Current-state audit.** What the code does today, with file-level
   references. This section is the difference between a feature doc and a
   wish. If current behavior is broken, list the defects here and let the
   design reference them; a design justified by defects nobody verified will
   be re-litigated in review.
3. Goals and non-goals. Non-goals matter double here: a feature doc without
   them grows until it becomes a system redesign.
4. **The design.** New behavior, changed ownership, new or changed
   interfaces. State what is deleted, not just what is added — dead code
   paths left "for safety" are a design decision and usually the wrong one.
5. **Compatibility and migration.** What happens to existing data, existing
   clients, in-flight operations, and persisted state on the first run of the
   new code. If nothing migrates, say so explicitly.
6. Scenarios: the changed workflows, told through a user or caller.
7. **Rollout.** Phases that are independently mergeable and revertable, each
   with a verification gate. Feature docs are where phased rollout earns its
   keep; big-bang cutovers need a stated reason.
8. Open issues, resolved issues, alternatives.

## Optional sections

Diagrams (include when ownership or data flow changes; skip for contained
logic changes), SLOs and monitoring (include when the feature has its own
failure modes), security (include when the feature touches a trust boundary),
test strategy (include when the change is hard to verify by inspection).

## Level of detail

- Reference real symbols and files for current state; describe future state
  by responsibility, not by function signature, unless the signature is the
  contract being designed.
- Every "the system currently does X" claim needs a `path:line` or a label
  saying it is unverified.

## Type-specific pitfalls

- Designing against the documented behavior instead of the actual behavior.
  Audit first; documents lag trees.
- Silent scope growth: each "while we are in there" item belongs in
  non-goals or in its own document.
- A migration section that only covers the happy upgrade. Cover: corrupt
  state, downgrade after a failed rollout, and the user who skipped versions.
- Phases that cannot be verified independently, which makes the rollout plan
  a fiction.

## Checklist

- Is every claim about current behavior sourced?
- Does the design say what dies, not only what is born?
- Can each phase be merged, verified, and reverted on its own?
- Would the diff between current-state and designed-state be legible to a
  reviewer who reads only this document?
