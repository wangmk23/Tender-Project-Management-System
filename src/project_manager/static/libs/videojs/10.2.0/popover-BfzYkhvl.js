import { t as listen } from "./listen-CO63BggB.js";
import { t as getDeepActiveElement } from "./focus-CkXNMiCg.js";
import { c as tryShowPopover, s as tryHidePopover } from "./vars-CTJASilF.js";
import { t as createDismissLayer } from "./dismiss-layer-Y52xS22o.js";

//#region ../core/dist/dev/dom/ui/popover/popover.js
/** @internal */
function createPopover(options) {
	const { onOpenChange, closeOnOutsideClick } = options;
	let triggerEl = null;
	let popupEl = null;
	let hoverTimeout = null;
	const capturedPointers = /* @__PURE__ */ new Set();
	let ignoreNextBlurClose = false;
	let blurGuardTimeout = null;
	const layer = createDismissLayer({
		transition: options.transition,
		closeOnEscape: options.closeOnEscape,
		onEscapeDismiss(event) {
			event.preventDefault();
			applyClose("escape", event);
		},
		onDocumentActive(signal) {
			listen(document, "pointerdown", handleDocumentPointerdown, {
				capture: true,
				signal
			});
		}
	});
	const state = layer.input;
	const groupMember = {
		close(reason) {
			applyClose(reason);
		},
		get triggerElement() {
			return triggerEl;
		}
	};
	function clearHoverTimeout() {
		if (hoverTimeout !== null) {
			clearTimeout(hoverTimeout);
			hoverTimeout = null;
		}
	}
	function canHover() {
		return globalThis.matchMedia?.("(hover: hover)")?.matches ?? false;
	}
	function canOpenOnFocus() {
		if (!canHover()) return false;
		return globalThis.matchMedia?.("(pointer: fine)")?.matches ?? false;
	}
	function canToggleOnClick() {
		if (!options.openOnHover?.()) return true;
		return canHover();
	}
	function clearBlurGuard() {
		ignoreNextBlurClose = false;
		if (blurGuardTimeout !== null) {
			clearTimeout(blurGuardTimeout);
			blurGuardTimeout = null;
		}
	}
	function armBlurGuard() {
		ignoreNextBlurClose = true;
		if (blurGuardTimeout !== null) clearTimeout(blurGuardTimeout);
		blurGuardTimeout = setTimeout(clearBlurGuard, 500);
	}
	function consumeBlurGuard() {
		if (!ignoreNextBlurClose) return false;
		clearBlurGuard();
		return true;
	}
	function isTriggerDisabled() {
		if (!triggerEl) return false;
		if (triggerEl.hasAttribute("disabled")) return true;
		return triggerEl.getAttribute("aria-disabled") === "true";
	}
	/**
	* The transition handler manages animation lifecycle via `createState`:
	*
	* **Open:** `transition.open()` patches `{ active: true, status: 'starting' }`. After a double-RAF it patches `{
	* status: 'idle' }`, then waits for the resulting element animations before the promise resolves. Frameworks render
	* `data-starting-style` / `data-ending-style` via `getPopupAttrs(state)` — no imperative DOM mutation needed.
	*
	* **Close:** `transition.close(el)` patches `{ status: 'ending' }` (keeping `active: true` so the element stays
	* mounted). After a double-RAF it waits for `getAnimations()` to settle, then patches `{ active: false, status:
	* 'idle' }`.
	*
	* `onOpenChange` fires immediately (before animations). `onOpenChangeComplete` fires after animations finish.
	*/
	function commitOpen() {
		const opening = layer.open(() => popupEl);
		if (!opening) return;
		queueMicrotask(() => {
			if (layer.signal.aborted || !state.current.active || state.current.status === "ending") return;
			tryShowPopover(popupEl);
		});
		options.group?.()?.open(groupMember);
		opening.then(() => {
			if (layer.signal.aborted || !state.current.active || state.current.status !== "idle") return;
			options.onOpenChangeComplete?.(true);
		});
	}
	function commitClose() {
		const closing = layer.close(popupEl);
		if (!closing) return;
		options.group?.()?.close(groupMember);
		closing.then(() => {
			if (layer.signal.aborted || state.current.active) return;
			tryHidePopover(popupEl);
			options.onOpenChangeComplete?.(false);
		});
	}
	function applyOpen(reason, event) {
		if (layer.signal.aborted) return;
		const { active, status } = state.current;
		if (active && status !== "ending") return;
		onOpenChange(true, event ? {
			reason,
			event
		} : { reason });
		if (!options.deferOpenChanges) commitOpen();
	}
	function applyClose(reason, event) {
		if (layer.signal.aborted) return;
		const { active, status } = state.current;
		if (!active || status === "ending") return;
		onOpenChange(false, event ? {
			reason,
			event
		} : { reason });
		if (!options.deferOpenChanges) commitClose();
	}
	function open(reason = "click") {
		applyOpen(reason);
	}
	function close(reason = "click") {
		clearHoverTimeout();
		applyClose(reason);
	}
	function syncOpen(open) {
		if (!options.deferOpenChanges) return;
		if (open) commitOpen();
		else commitClose();
	}
	function handleDocumentPointerdown(event) {
		if (!closeOnOutsideClick() || !state.current.active) return;
		const path = event.composedPath();
		if (triggerEl && path.includes(triggerEl) || popupEl && path.includes(popupEl)) {
			armBlurGuard();
			return;
		}
		clearBlurGuard();
		applyClose("outside-click", event);
	}
	layer.signal.addEventListener("abort", () => {
		options.group?.()?.close(groupMember);
		clearHoverTimeout();
		clearBlurGuard();
		capturedPointers.clear();
		triggerEl = null;
		popupEl = null;
	});
	const triggerProps = {
		onClick(event) {
			if (!canToggleOnClick()) return;
			if (isTriggerDisabled()) return;
			if (state.current.active && state.current.status !== "ending") applyClose("click", event);
			else applyOpen("click", event);
		},
		onPointerEnter(_event) {
			if (!options.openOnHover?.()) return;
			if (!canHover()) return;
			clearHoverTimeout();
			if (state.current.active) return;
			const delay = options.delay?.() ?? 300;
			hoverTimeout = setTimeout(() => applyOpen("hover"), delay);
		},
		onPointerLeave(_event) {
			if (!options.openOnHover?.()) return;
			if (!canHover()) return;
			clearHoverTimeout();
			if (!state.current.active) return;
			const closeDelay = options.closeDelay?.() ?? 0;
			hoverTimeout = setTimeout(() => applyClose("hover"), closeDelay);
		},
		onFocusIn(_event) {
			if (options.openOnHover?.()) {
				if (!canOpenOnFocus()) return;
				applyOpen("focus");
			}
		},
		onFocusOut(event) {
			const relatedTarget = event.relatedTarget;
			if (relatedTarget && (triggerEl?.contains(relatedTarget) || popupEl?.contains(relatedTarget))) return;
			if (options.openOnHover?.()) applyClose("blur");
		}
	};
	const popupProps = {
		onPointerEnter(_event) {
			if (!options.openOnHover?.()) return;
			clearHoverTimeout();
		},
		onPointerLeave(_event) {
			if (!options.openOnHover?.()) return;
			if (capturedPointers.size > 0) return;
			clearHoverTimeout();
			if (!state.current.active) return;
			const closeDelay = options.closeDelay?.() ?? 0;
			hoverTimeout = setTimeout(() => applyClose("hover"), closeDelay);
		},
		onGotPointerCapture(event) {
			capturedPointers.add(event.pointerId);
		},
		onLostPointerCapture(event) {
			capturedPointers.delete(event.pointerId);
		},
		onFocusOut(event) {
			const relatedTarget = event.relatedTarget;
			if (relatedTarget && (triggerEl?.contains(relatedTarget) || popupEl?.contains(relatedTarget))) return;
			if (consumeBlurGuard()) return;
			if (relatedTarget !== null) {
				applyClose("blur");
				return;
			}
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (!state.current.active || state.current.status === "ending" || state.current.status === "starting") return;
					const active = getDeepActiveElement(popupEl?.ownerDocument);
					if (active && (triggerEl?.contains(active) || popupEl?.contains(active))) return;
					applyClose("blur");
				});
			});
		}
	};
	function setTriggerElement(el) {
		triggerEl = el;
	}
	function setPopupElement(el) {
		if (!el && popupEl && state.current.active) tryHidePopover(popupEl);
		popupEl = el;
		if (el) {
			if (state.current.active) tryShowPopover(el);
		}
	}
	return {
		input: state,
		triggerProps,
		popupProps,
		get triggerElement() {
			return triggerEl;
		},
		setTriggerElement,
		setPopupElement,
		open,
		close,
		syncOpen,
		destroy: layer.destroy
	};
}

//#endregion
export { createPopover as t };
//# sourceMappingURL=popover-BfzYkhvl.js.map