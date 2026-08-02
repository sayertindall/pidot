# UI/UX Design Document

For screens, panels, navigation, interaction behavior, and client state. The
costliest mistakes here are ownership mistakes (which layer owns which piece
of state) and honesty mistakes (interfaces that render "empty", "loading",
and "failed" identically, or controls that promise actions the system cannot
perform).

## Audience

Engineers implementing the surface, and a designer or product owner judging
the behavior. Write behavior precisely enough to implement without a mockup;
sketches support the prose, they do not replace it.

## Required sections

1. Metadata, objective, background.
2. Goals and non-goals. UI goals are stated as user-visible outcomes
   ("closing a tab works offline"), never as widget inventory.
3. **State ownership model.** Every piece of state named with exactly one
   owner and one durability class: server truth, synchronized cache,
   persisted local state, session state, transient view state. Most UI
   defects trace to two owners of one fact or a fact stored in the wrong
   tier. A table works.
4. **Surface inventory and behavior.** Per surface: what it shows, where its
   data comes from, and its full state matrix — loading, ready, empty,
   degraded or stale, error, and disabled must all be distinct and defined.
   "Empty", "not loaded", and "failed" must never render identically.
5. **Interaction flows.** The primary flows as scenarios, plus keyboard
   access for each mouse action.
6. **Failure and offline behavior.** What works without the network, what
   disables (with its reason shown), what happens on conflict, and how the
   user recovers. Disabled-with-reason versus hidden is a per-action
   decision; record it.
7. **Copy rules.** Labels, confirmations, and error messages must be true:
   never claim an action is permanent when it is recoverable, never show an
   enabled control wired to nothing.
8. Persistence: which local state survives restart, in what file or store,
   and the migration story for existing users.
9. Open issues, resolved issues, alternatives.

## Optional sections

State-transition or flow diagrams in Mermaid (include whenever a surface has
more than three states — usually yes), accessibility (include when the
product has commitments; at minimum keyboard coverage), visual design tokens
(usually out of scope — link the design system instead), test strategy
(include for state logic; pure state models should be unit-testable).

## Level of detail

- Behavior is specified to the level a test could assert: given state, given
  action, resulting state and render.
- Visual detail (spacing, color) stays out unless it carries meaning
  (a danger treatment on a destructive action).

## Type-specific pitfalls

- Conflating "the item exists" with "the item is open". Directories and
  working sets are different state tiers.
- Local gestures coupled to network availability (a close button that needs
  the server).
- Optimistic renders of non-optimistic operations; destructive actions
  confirmed after the fact.
- Persisting server truth into local files, guaranteeing divergence.
- A keyboard story added after the mouse story shipped.

## Checklist

- Does every state fact have one owner and one durability class?
- Does every surface define all of: loading, ready, empty, degraded, error?
- Does every enabled control call something real, and every disabled control
  show why?
- Do the flows work offline where the design claims they do?
- Is every confirmation dialog's copy literally true?
