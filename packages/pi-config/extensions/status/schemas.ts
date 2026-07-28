/**
 * status/schemas.ts
 *
 * The status extension has no persistent state and exposes no tool params
 * (only a command), but we keep `schemas.ts` per principle 9 so the
 * extension's interface surface is discoverable in one place.
 *
 * The /status command takes a subcommand string. No TypeBox schema is
 * needed because no parameters flow into pi internals.
 */
