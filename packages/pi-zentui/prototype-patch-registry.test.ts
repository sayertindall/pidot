import { describe, it, expect, vi } from "vitest";
import {
  installPrototypePatch,
  ZENTUI_PROTOTYPE_PATCH_REGISTRY,
} from "./prototype-patch-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTarget() {
  return {
    render(arg: string): string {
      return `original:${arg}`;
    },
    invalidate(): string {
      return "invalidate-original";
    },
    otherMethod(): string {
      return "other";
    },
  };
}

// ---------------------------------------------------------------------------
// installPrototypePatch
// ---------------------------------------------------------------------------
describe("installPrototypePatch", () => {
  // -- 1. Basic patch: wrapper calls behavior, predecessor still called on passthrough --
  describe("basic patch behavior", () => {
    it("patches the render method and invokes the behavior", () => {
      const target = makeTarget();
      const behavior = vi.fn((inv) => `patched:${inv.predecessor.apply(inv.receiver, inv.args)}`);
      const cleanup = installPrototypePatch(target, "render", "user-message-render", behavior);

      const result = target.render("hello");
      expect(result).toBe("patched:original:hello");
      expect(behavior).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it("predecessor is still called when behavior passes through", () => {
      const target = makeTarget();
      const behavior = vi.fn(
        (inv) => Reflect.apply(inv.predecessor, inv.receiver, inv.args) as string,
      );
      const cleanup = installPrototypePatch(target, "render", "user-message-render", behavior);

      expect(target.render("hello")).toBe("original:hello");
      expect(behavior).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it("no behavior → wrapper calls predecessor directly", () => {
      const target = makeTarget();
      // Install one patch, then clean it up so behavior reverts to undefined
      const cleanup = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        (inv) => Reflect.apply(inv.predecessor, inv.receiver, inv.args) as string,
      );
      cleanup();

      // After cleanup the wrapper is still present but behavior is undefined,
      // so it should pass through to the predecessor (which is the original)
      expect(target.render("hello")).toBe("original:hello");
    });
  });

  // -- 2. Behavior can modify args and return value --
  describe("behavior modifications", () => {
    it("behavior can modify arguments before predecessor", () => {
      const target = makeTarget();
      const behavior = vi.fn(
        (inv) => Reflect.apply(inv.predecessor, inv.receiver, ["modified"]) as string,
      );
      const cleanup = installPrototypePatch(target, "render", "user-message-render", behavior);

      expect(target.render("original-arg")).toBe("original:modified");
      cleanup();
    });

    it("behavior can transform the return value", () => {
      const target = makeTarget();
      const behavior = vi.fn(
        (inv) =>
          `wrapped[${Reflect.apply(inv.predecessor, inv.receiver, inv.args) as string}]wrapped`,
      );
      const cleanup = installPrototypePatch(target, "render", "user-message-render", behavior);

      expect(target.render("hello")).toBe("wrapped[original:hello]wrapped");
      cleanup();
    });
  });

  // -- 3. Cleanup restores original method --
  describe("cleanup", () => {
    it("restores the original method after cleanup", () => {
      const target = makeTarget();
      const originalRender = target.render;

      const cleanup = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        (inv) => `patched:${inv.predecessor.apply(inv.receiver, inv.args)}`,
      );

      expect(target.render("hello")).not.toBe(originalRender("hello"));

      cleanup();
      expect(target.render("hello")).toBe("original:hello");
      expect(target.render).toBe(originalRender);
    });

    it("cleanup is idempotent", () => {
      const target = makeTarget();
      const cleanup = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        (inv) => `patched:${inv.predecessor.apply(inv.receiver, inv.args)}`,
      );
      cleanup();
      cleanup(); // should not throw
      expect(target.render("hello")).toBe("original:hello");
    });
  });

  // -- 4. Double-patch same adapter is safe --
  describe("double-patch same adapter", () => {
    it("second patch replaces the first behavior on the same adapter", () => {
      const target = makeTarget();
      const cleanup1 = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        () => "first",
      );
      const cleanup2 = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        () => "second",
      );

      expect(target.render("hello")).toBe("second");

      // cleanup1 should be a no-op because its token is no longer active
      cleanup1();
      expect(target.render("hello")).toBe("second");

      // cleanup2 should restore
      cleanup2();
      expect(target.render("hello")).toBe("original:hello");
    });

    it("second patch on same adapter reuses the same wrapper", () => {
      const target = makeTarget();
      const cleanup1 = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        () => "first",
      );
      const wrapperAfterFirst = target.render;

      const cleanup2 = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        () => "second",
      );
      // Same wrapper function instance
      expect(target.render).toBe(wrapperAfterFirst);

      cleanup1();
      cleanup2();
    });
  });

  // -- 5. Patch fails gracefully if method doesn't exist --
  describe("error handling", () => {
    it("throws TypeError when method is not a function", () => {
      const target = { render: 42 };
      expect(() =>
        installPrototypePatch(target, "render", "user-message-render", () => "patched"),
      ).toThrow(TypeError);
    });

    it("throws TypeError when method does not exist", () => {
      const target = {} as { render: () => string };
      expect(() =>
        installPrototypePatch(target, "render", "user-message-render", () => "patched"),
      ).toThrow(TypeError);
    });
  });

  // -- 6. Patch invalidate method --
  describe("invalidate method", () => {
    it("patches the invalidate method", () => {
      const target = makeTarget();
      const behavior = vi.fn((inv) => `patched-invalidate:${inv.predecessor.apply(inv.receiver, inv.args)}`);
      const cleanup = installPrototypePatch(target, "invalidate", "user-message-invalidate", behavior);

      expect(target.invalidate()).toBe("patched-invalidate:invalidate-original");
      expect(behavior).toHaveBeenCalledTimes(1);

      cleanup();
      expect(target.invalidate()).toBe("invalidate-original");
    });
  });

  // -- 7. Multiple adapters on same target --
  describe("multiple adapters", () => {
    it("can have two different adapters on render", () => {
      const target = makeTarget();
      const behavior1 = vi.fn(
        (inv) => `[border]${Reflect.apply(inv.predecessor, inv.receiver, inv.args) as string}[/border]`,
      );
      const behavior2 = vi.fn(
        (inv) => `[msg]${Reflect.apply(inv.predecessor, inv.receiver, inv.args) as string}[/msg]`,
      );

      const cleanup1 = installPrototypePatch(target, "render", "selector-border-render", behavior1);
      // selector-border-render patches render... Wait, looking at the types:
      // PrototypePatchAdapter = "user-message-render" | "user-message-invalidate" | "selector-border-render"
      // All of them could target "render" or "invalidate". Let me re-check the code.
      //
      // The `installPrototypePatch` takes `method: "render" | "invalidate"` and
      // `adapter: PrototypePatchAdapter`. The registry key is `adapter`.
      // So you can have `selector-border-render` on `render` and `user-message-render`
      // on `render` as separate registry entries.
      //
      // But wait, can both patch the same method? The registry is keyed by adapter,
      // not by method. So if you try to patch `render` with `user-message-render`
      // and then `render` with `selector-border-render`, they're different adapters.
      // BUT the code checks:
      //   let record = registry.get(adapter);
      //   if (!(record && record.method === method && target[method] === record.wrapper)) {
      // So the check is only for the SAME adapter. Different adapters are independent.
      // However, both would try to set `target[method]` to their own wrapper...
      // The SECOND one installed would wrap over the FIRST one's wrapper, since
      // `target[method]` would be the first wrapper at that point.
      // Actually wait, the check `target[method] === record.wrapper` — if the
      // second adapter sees that target[method] has been replaced (it's now the
      // first wrapper, not `record.wrapper` for the second adapter), it will
      // create a new record. The new predecessor will be the current target[method]
      // which is the first wrapper.
      //
      // So: two adapters on the same method → the second one wraps the first one's wrapper.
      // This is fine, both get called in chain.

      const cleanup2 = installPrototypePatch(target, "render", "user-message-render", behavior2);

      const result = target.render("hello");
      // The second-installed adapter wraps over the first.
      // user-message-render wraps selector-border-render wraps original.
      // So: [msg][border]original:hello[/border][/msg]
      expect(result).toBe("[msg][border]original:hello[/border][/msg]");

      cleanup1();
      // After removing selector-border-render, user-message-render should still work.
      // But the wrapper chain gets reconstructed... Actually cleanup1 restores
      // the original, removing the selector-border-render wrapper. But since
      // user-message-render was patched on top, and its predecessor was the
      // selector-border-render wrapper, after cleanup1 the user-message-render
      // wrapper is still in place (it's target[method]) and its predecessor is
      // still the selector-border-render wrapper... Wait, cleanup1 does:
      //   target[method] = record.predecessor  (restoring to what was before)
      // But target[method] right now is user-message-render's wrapper.
      // cleanup1's record is selector-border-render's record. Its predecessor
      // is the original method. So cleanup1 would set target[method] = original,
      // effectively removing BOTH wrappers. Hmm, that's a problem.
      //
      // Let me re-read cleanup:
      //   if (record.registration?.token !== token) return; // only the active registration
      //   record.registration.behavior = undefined;
      //   record.registration = undefined;
      //   const current = registry.get(adapter);
      //   if (current !== record) return;
      //   if (target[method] === record.wrapper) target[method] = record.predecessor;
      //   registry.delete(adapter);
      //
      // So when cleanup1 is called:
      // - record1 is selector-border-render's record
      // - target[method] is user-message-render's wrapper (NOT record1.wrapper)
      // - So target[method] !== record1.wrapper → it does NOT restore
      // - It deletes selector-border-render from registry
      //
      // But user-message-render's wrapper still calls nextRecord.predecessor,
      // and the predecessor of user-message-render's record is selector-border-render's wrapper.
      // That predecessor function still exists, it's just that it now calls
      // the original because its behavior is undefined and it checks
      //   return activeBehavior ? ... : Reflect.apply(nextRecord.predecessor, this, args);
      // But wait, selector-border-render's record had its registration cleared.
      // The wrapper function for selector-border-render is still being referenced
      // by user-message-render's predecessor. That wrapper checks:
      //   const activeBehavior = nextRecord.registration?.behavior;
      // which is now undefined. So it falls through to Reflect.apply(nextRecord.predecessor, this, args).
      //
      // So the chain after cleanup1 is: user-message-render wrapper → selector-border-render wrapper (passthrough) → original.
      // So the result should be: [msg]original:hello[/msg]
      //
      // Let's test this:
      expect(target.render("hello")).toBe("[msg]original:hello[/msg]");

      cleanup2();
      expect(target.render("hello")).toBe("original:hello");
    });
  });

  // -- 8. Cleanup only removes its own registration, not others --
  describe("cleanup isolation", () => {
    it("cleanup of one adapter does not affect another", () => {
      const target = makeTarget();
      const patchedRender = vi.fn(
        (inv) => `[render]${Reflect.apply(inv.predecessor, inv.receiver, inv.args) as string}[/render]`,
      );
      const patchedInvalidate = vi.fn(
        (inv) => `[inval]${inv.predecessor.apply(inv.receiver, inv.args)}[/inval]`,
      );

      const cleanupRender = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        patchedRender,
      );
      const cleanupInvalidate = installPrototypePatch(
        target,
        "invalidate",
        "user-message-invalidate",
        patchedInvalidate,
      );

      expect(target.render("hello")).toBe("[render]original:hello[/render]");
      expect(target.invalidate()).toBe("[inval]invalidate-original[/inval]");

      // Clean up only render
      cleanupRender();
      expect(target.render("hello")).toBe("original:hello");
      // Invalidate should still be patched
      expect(target.invalidate()).toBe("[inval]invalidate-original[/inval]");

      cleanupInvalidate();
      expect(target.invalidate()).toBe("invalidate-original");
    });
  });

  // -- 9. Symbol registry is cleaned up when all patches removed --
  describe("symbol registry lifecycle", () => {
    it("creates and removes the registry symbol", () => {
      const target = makeTarget();
      expect((target as Record<symbol, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY]).toBeUndefined();

      const cleanup = installPrototypePatch(target, "render", "user-message-render", (inv) =>
        Reflect.apply(inv.predecessor, inv.receiver, inv.args),
      );
      expect(
        (target as Record<symbol, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
      ).toBeInstanceOf(Map);

      cleanup();
      expect((target as Record<symbol, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY]).toBeUndefined();
    });

    it("keeps the symbol registry when one of multiple patches remains", () => {
      const target = makeTarget();
      const cleanup1 = installPrototypePatch(
        target,
        "render",
        "user-message-render",
        () => "first",
      );
      const cleanup2 = installPrototypePatch(
        target,
        "invalidate",
        "user-message-invalidate",
        () => "second",
      );

      expect(
        (target as Record<symbol, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
      ).toBeInstanceOf(Map);

      cleanup1();
      // Registry should still exist because invalidate patch remains
      expect(
        (target as Record<symbol, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
      ).toBeInstanceOf(Map);

      cleanup2();
      expect((target as Record<symbol, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY]).toBeUndefined();
    });
  });

  // -- Edge: patching a method preserves 'this' context --
  describe("this context", () => {
    it("preserves 'this' binding through the patch", () => {
      const target = {
        prefix: "ctx",
        render(arg: string): string {
          return `${this.prefix}:${arg}`;
        },
      };

      const cleanup = installPrototypePatch(target, "render", "user-message-render", (inv) =>
        Reflect.apply(inv.predecessor, inv.receiver, inv.args),
      );

      expect(target.render("hello")).toBe("ctx:hello");

      cleanup();
    });
  });
});
