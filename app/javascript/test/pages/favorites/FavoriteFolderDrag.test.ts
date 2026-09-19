import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/models/Favorite", () => ({ default: { move: vi.fn(() => Promise.resolve({})) } }));

// jsdom does not implement these (confirmed: both are `undefined` on Element.prototype /
// document under jsdom). They're only reached once a drag has actually activated past
// the movement threshold; the stuck-state regression tests below never cross it, so most
// tests don't need these at all. The few that do exercise activation get a harmless stub.
beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!document.elementFromPoint) {
    document.elementFromPoint = vi.fn(() => null);
  }
});

function buildFixture () {
  const container = document.createElement("section");
  container.className = "posts-container";

  const source = document.createElement("article");
  source.className = "thumbnail";
  source.dataset.id = "123";

  const link = document.createElement("a");
  link.className = "thm-link";
  link.setAttribute("href", "/posts/123");
  source.appendChild(link);

  container.appendChild(source);
  document.body.appendChild(container);
  return { container, source, link };
}

function firePointer (type: string, el: Element | Document, opts: Partial<PointerEventInit> = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
    clientX: 0,
    clientY: 0,
    ...opts,
  });
  el.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pages/favorites/FavoriteFolderDrag", () => {
  it("does not leave drag state stuck when the pointer is released over a different element before crossing the threshold", async () => {
    const { default: FavoriteFolderDrag } = await import("@/pages/favorites/FavoriteFolderDrag");
    const { container, source } = buildFixture();
    const instance = new FavoriteFolderDrag(container);

    firePointer("pointerdown", source, { clientX: 0, clientY: 0 });
    expect(instance.drag).not.toBeNull();

    // The pointer is released over document.body, not sourceEl - before pointer capture
    // is ever acquired (it's only acquired on activation), a real browser is free to
    // deliver this event to whatever's actually under the pointer. Listeners bound only
    // to sourceEl would never see this, leaving `drag` stuck forever.
    firePointer("pointerup", document.body, { clientX: 1, clientY: 1 });

    expect(instance.drag).toBeNull();

    // A fresh drag can start immediately after - proving onPointerDown's `if (this.drag)
    // return` guard isn't left permanently blocking future drags by the stuck state.
    firePointer("pointerdown", source, { clientX: 0, clientY: 0 });
    expect(instance.drag).not.toBeNull();
  });

  it("does not leave drag state stuck on a pointercancel delivered to a different element", async () => {
    const { default: FavoriteFolderDrag } = await import("@/pages/favorites/FavoriteFolderDrag");
    const { container, source } = buildFixture();
    const instance = new FavoriteFolderDrag(container);

    firePointer("pointerdown", source, { clientX: 0, clientY: 0 });
    firePointer("pointercancel", document.body);

    expect(instance.drag).toBeNull();
  });

  it("never crosses into drag mode when the pointer is released below the movement threshold, leaving the click untouched", async () => {
    const { default: FavoriteFolderDrag } = await import("@/pages/favorites/FavoriteFolderDrag");
    const { container, source } = buildFixture();
    new FavoriteFolderDrag(container);

    const downEvent = firePointer("pointerdown", source, { clientX: 0, clientY: 0 });
    firePointer("pointermove", document, { clientX: 2, clientY: 2 }); // below the 6px threshold
    firePointer("pointerup", document.body, { clientX: 2, clientY: 2 });

    expect(downEvent.defaultPrevented).toBe(false);
    expect(source.classList.contains("favorite-dragging")).toBe(false);

    // The browser's real click for this pointer sequence must resolve normally: nothing
    // was ever added to the suppression set, so it isn't prevented.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    const notPrevented = source.dispatchEvent(click);
    expect(notPrevented).toBe(true);
  });

  it("activates once the movement threshold is crossed, even via a document-level pointermove", async () => {
    const { default: FavoriteFolderDrag } = await import("@/pages/favorites/FavoriteFolderDrag");
    const { container, source } = buildFixture();
    const instance = new FavoriteFolderDrag(container);

    firePointer("pointerdown", source, { clientX: 0, clientY: 0 });
    firePointer("pointermove", document, { clientX: 20, clientY: 0 }); // past ACTIVATION_THRESHOLD

    expect(instance.drag?.active).toBe(true);
    expect(source.classList.contains("favorite-dragging")).toBe(true);
  });

  it("suppresses the synthetic click that follows a completed drag", async () => {
    const { default: FavoriteFolderDrag } = await import("@/pages/favorites/FavoriteFolderDrag");
    const { container, source, link } = buildFixture();
    new FavoriteFolderDrag(container);

    firePointer("pointerdown", source, { clientX: 0, clientY: 0 });
    firePointer("pointermove", document, { clientX: 20, clientY: 0 }); // activates
    // Post-activation events are scoped to captureEl (sourceEl) - real pointer capture
    // would redirect them there regardless of where they're dispatched; jsdom has no
    // such redirection, so the test dispatches directly on captureEl to match.
    firePointer("pointerup", source, { clientX: 20, clientY: 0 });

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    const notPrevented = link.dispatchEvent(click);
    expect(notPrevented).toBe(false); // false means preventDefault() was called
  });
});
