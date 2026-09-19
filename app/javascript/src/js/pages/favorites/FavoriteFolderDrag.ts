import Favorite from "@/models/Favorite";

/** Pixels of pointer movement required before a click becomes a drag. */
const ACTIVATION_THRESHOLD = 6;

interface DragState {
  pointerId: number;
  sourceEl: HTMLElement;
  captureEl: HTMLElement;
  postId: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  originNextSibling: ChildNode | null;
  active: boolean; // true once the movement threshold has been crossed
  currentTarget: HTMLElement | null;
  rafId: number;
  pendingMove: { clientX: number; clientY: number } | null;
  ghost: HTMLElement | null;
}

// Elements whose pointer sequence ended in a completed (threshold-crossing) drag get a
// one-shot entry here, so the synthetic click the browser still fires after pointerup can
// be caught and suppressed - a movement threshold alone only stops a *drag* from starting
// on a small jitter, it does nothing about the click a real, completed drag still
// generates on release.
const suppressedClickTargets = new WeakSet<Element>();

/**
 * Favorites-specific click-and-drag: dragging a post thumbnail onto a folder or the Go
 * Up card moves that Favorite server-side. Mouse/pen only in v1 - touch users still get
 * full folder navigation via taps/links, just not drag-and-drop, to avoid risking a
 * touch-scroll regression.
 *
 * Not built on the generic Sortable utility: that one starts dragging immediately on
 * pointerdown (which would break normal click-to-open-post navigation) and its
 * placeholder-insertion heuristic is specific to reordering within one container, not
 * detecting a drop target among several distinct drop zones.
 */
export default class FavoriteFolderDrag {
  container: HTMLElement;
  drag: DragState | null = null;

  constructor (container: Element) {
    this.container = container as HTMLElement;
    this.container.addEventListener("pointerdown", this.onPointerDown);
    // Capture phase: must run before the thumbnail link's own click/navigation handling.
    this.container.addEventListener("click", this.onClickCapture, true);
  }

  onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") return; // mouse/pen only in v1
    if (this.drag) return;

    const target = event.target as Element;
    if (target.closest("[data-drop-target]")) return; // folder/Go-Up cards are never drag sources

    const sourceEl = target.closest<HTMLElement>("article.thumbnail[data-id]");
    if (!sourceEl || !this.container.contains(sourceEl)) return;

    const postId = sourceEl.dataset.id;
    if (!postId) return;

    const rect = sourceEl.getBoundingClientRect();
    this.drag = {
      pointerId: event.pointerId,
      sourceEl,
      captureEl: sourceEl,
      postId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      originNextSibling: sourceEl.nextSibling,
      active: false,
      currentTarget: null,
      rafId: 0,
      pendingMove: null,
      ghost: null,
    };

    // Pre-activation tracking is deliberately bound at the document level, not on
    // sourceEl: no pointer capture is held yet below the activation threshold, so the
    // pointer is free to move off sourceEl's bounds entirely (a fast flick, a small
    // thumbnail, etc.) before enough movement has accumulated to activate the drag.
    // Listeners attached directly to sourceEl would then simply never fire again -
    // whatever element the pointer ends up over receives the pointerup/pointercancel
    // instead - leaving `this.drag` stuck non-null forever and permanently blocking any
    // future drag (see onPointerDown's `if (this.drag) return`). Document-level
    // listeners always see the event regardless of what's currently under the pointer.
    document.addEventListener("pointermove", this.onPreActivationPointerMove);
    document.addEventListener("pointerup", this.onPreActivationPointerUp);
    document.addEventListener("pointercancel", this.onPreActivationPointerCancel);
  };

  onPreActivationPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.active || event.pointerId !== drag.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < ACTIVATION_THRESHOLD) return;
    this.activate(event);
  };

  onPreActivationPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.active || event.pointerId !== drag.pointerId) return;
    // Below threshold: nothing was ever touched (no preventDefault, no capture), so the
    // browser's normal click/navigation for this pointer sequence proceeds untouched.
    this.removePreActivationListeners();
    this.drag = null;
  };

  onPreActivationPointerCancel = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.active || event.pointerId !== drag.pointerId) return;
    this.removePreActivationListeners();
    this.drag = null;
  };

  removePreActivationListeners (): void {
    document.removeEventListener("pointermove", this.onPreActivationPointerMove);
    document.removeEventListener("pointerup", this.onPreActivationPointerUp);
    document.removeEventListener("pointercancel", this.onPreActivationPointerCancel);
  }

  activate (event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;

    this.removePreActivationListeners();

    drag.active = true;
    event.preventDefault(); // suppresses text-selection/native drag now that a real drag has started
    drag.captureEl.setPointerCapture(drag.pointerId);
    drag.sourceEl.classList.add("favorite-dragging");
    drag.ghost = this.createGhost(drag, event.clientX, event.clientY);

    // Post-activation tracking is scoped to captureEl instead of the document: pointer
    // capture guarantees every subsequent event for this pointer targets captureEl
    // regardless of what's visually under the pointer, so element-scoped listeners are
    // both correct and sufficient from here on.
    drag.captureEl.addEventListener("pointermove", this.onPointerMove);
    drag.captureEl.addEventListener("pointerup", this.onPointerUp);
    drag.captureEl.addEventListener("pointercancel", this.onPointerCancel);
  }

  createGhost (drag: DragState, clientX: number, clientY: number): HTMLElement {
    const rect = drag.sourceEl.getBoundingClientRect();
    const ghost = drag.sourceEl.cloneNode(true) as HTMLElement;
    ghost.classList.add("favorite-drag-ghost");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${clientX - drag.offsetX}px`,
      top: `${clientY - drag.offsetY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      pointerEvents: "none",
      zIndex: "9999",
    });
    document.body.appendChild(ghost);
    return ghost;
  }

  onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
      drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
    }

    drag.pendingMove = { clientX: event.clientX, clientY: event.clientY };
    if (!drag.rafId) {
      drag.rafId = requestAnimationFrame(() => {
        drag.rafId = 0;
        const move = drag.pendingMove;
        drag.pendingMove = null;
        if (move) this.updateHoverTarget(move.clientX, move.clientY);
      });
    }
  };

  updateHoverTarget (clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;

    const hit = document.elementFromPoint(clientX, clientY);
    const hovered = hit ? hit.closest<HTMLElement>("[data-drop-target]") : null;
    const resolved = hovered && this.container.contains(hovered) ? hovered : null;

    if (resolved === drag.currentTarget) return;
    if (drag.currentTarget) drag.currentTarget.classList.remove("drag-hover");
    if (resolved) resolved.classList.add("drag-hover");
    drag.currentTarget = resolved;
  }

  onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.endDrag(false);
  };

  onPointerCancel = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.endDrag(true);
  };

  endDrag (cancelled: boolean): void {
    const drag = this.drag;
    if (!drag) return;

    drag.captureEl.removeEventListener("pointermove", this.onPointerMove);
    drag.captureEl.removeEventListener("pointerup", this.onPointerUp);
    drag.captureEl.removeEventListener("pointercancel", this.onPointerCancel);
    if (drag.rafId) cancelAnimationFrame(drag.rafId);

    if (drag.currentTarget) drag.currentTarget.classList.remove("drag-hover");
    if (drag.ghost) drag.ghost.remove();
    drag.sourceEl.classList.remove("favorite-dragging");

    // A completed drag still generates a synthetic click on release, valid drop or not -
    // suppress it so a real drag never also navigates to the post.
    if (!cancelled) suppressedClickTargets.add(drag.sourceEl);

    const dropTarget = cancelled ? null : drag.currentTarget;
    this.drag = null;

    if (!dropTarget) return; // cancelled, or released over empty space: no-op, source stays put untouched
    this.commitMove(drag, dropTarget);
  }

  commitMove (drag: DragState, dropTarget: HTMLElement): void {
    const destinationFolderId = dropTarget.dataset.dropTarget === "go-up"
      ? dropTarget.dataset.destinationFolderId || null
      : dropTarget.dataset.folderId || null;

    const originalParent = drag.sourceEl.parentNode;
    const originalNextSibling = drag.originNextSibling;

    // Optimistic removal: the post no longer belongs in the currently-open folder view.
    drag.sourceEl.remove();

    Favorite.move(Number(drag.postId), destinationFolderId ? Number(destinationFolderId) : null)
      .catch(() => {
        // Roll back: reinsert the thumbnail exactly where it was. Favorite.move already
        // dispatched the danbooru:error toast for this failure.
        if (originalParent) originalParent.insertBefore(drag.sourceEl, originalNextSibling);
      });
  }

  onClickCapture = (event: MouseEvent): void => {
    const target = event.target as Element;
    const sourceEl = target.closest("article.thumbnail[data-id]");
    if (sourceEl && suppressedClickTargets.has(sourceEl)) {
      suppressedClickTargets.delete(sourceEl);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
}

$(() => {
  const container = document.querySelector("#c-favorites .posts-container");
  // No-op outside folder-scoped mode: without any rendered folder/Go-Up cards there is
  // nowhere to drop a post, so skip attaching listeners entirely rather than tracking
  // drags that could never resolve to a target.
  if (!container || !container.querySelector("[data-drop-target]")) return;
  new FavoriteFolderDrag(container);
});
