/**
 * Shared TypeBox schemas. Schemas used by more than one feature go here.
 * Feature-specific schemas live in their own `schemas.ts` next to the
 * extension entry point.
 */

import { Type } from "typebox";

/** A non-empty string. Used for id fields. */
export const NonEmptyString = Type.String({ minLength: 1 });
