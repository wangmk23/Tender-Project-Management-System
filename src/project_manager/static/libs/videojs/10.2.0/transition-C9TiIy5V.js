import { t as noop } from "./noop-DBLxABor.js";
import { t as createState } from "./state-DLDF0q4U.js";

//#region ../core/dist/dev/dom/ui/transition.js
/**
* Manages open/close transition lifecycle via `createState`.
*
* **Open:** patches `{ active: true, status: 'starting' }`, then after a double-RAF patches `{ status: 'idle' }` so the
* browser paints the initial ("from") state before transitioning. It then waits for the resulting element animations to
* finish. Reopening an active transition flushes styles first so CSS transitions can restart.
*
* **Close:** patches `{ status: 'ending' }` (keeping `active: true` so the element stays mounted), then after a
* double-RAF waits for `getAnimations()` to settle before patching `{ active: false, status: 'idle' }`.
*
* @internal
*/
function createTransition() {
	const state = createState({
		active: false,
		status: "idle"
	});
	let destroyed = false;
	let rafId1 = 0;
	let rafId2 = 0;
	let operationId = 0;
	let resolvePending = null;
	function cancelFrames() {
		cancelAnimationFrame(rafId1);
		cancelAnimationFrame(rafId2);
		rafId1 = 0;
		rafId2 = 0;
	}
	function beginOperation() {
		operationId++;
		cancelFrames();
		resolvePending?.();
		resolvePending = null;
		return operationId;
	}
	function finishOperation(id) {
		if (id !== operationId) return;
		const resolve = resolvePending;
		resolvePending = null;
		resolve?.();
	}
	function open(el = null) {
		if (destroyed) return Promise.resolve();
		const id = beginOperation();
		const restarting = state.current.active;
		if (restarting) state.patch({ status: "idle" });
		state.patch({
			active: true,
			status: "starting"
		});
		return new Promise((resolve) => {
			resolvePending = resolve;
			rafId1 = requestAnimationFrame(() => {
				rafId1 = 0;
				if (restarting) {
					const element = resolveElement(el);
					cancelAnimations(element);
					flushStyles(element);
				}
				rafId2 = requestAnimationFrame(() => {
					rafId2 = 0;
					if (destroyed || id !== operationId || !state.current.active) return finishOperation(id);
					state.patch({ status: "idle" });
					rafId1 = requestAnimationFrame(() => {
						rafId1 = 0;
						if (destroyed || id !== operationId || !state.current.active) return finishOperation(id);
						waitForAnimations(resolveElement(el)).finally(() => finishOperation(id));
					});
				});
			});
		});
	}
	function close(el) {
		if (destroyed) return Promise.resolve();
		const id = beginOperation();
		state.patch({ status: "ending" });
		return new Promise((resolve) => {
			resolvePending = resolve;
			rafId1 = requestAnimationFrame(() => {
				rafId1 = 0;
				rafId2 = requestAnimationFrame(() => {
					rafId2 = 0;
					if (destroyed || id !== operationId) return finishOperation(id);
					waitForAnimations(el).finally(() => {
						if (destroyed || id !== operationId || state.current.status !== "ending") return finishOperation(id);
						state.patch({
							active: false,
							status: "idle"
						});
						finishOperation(id);
					});
				});
			});
		});
	}
	function cancel() {
		operationId++;
		cancelFrames();
		resolvePending?.();
		resolvePending = null;
		if (state.current.status !== "idle") state.patch({ status: "idle" });
	}
	return {
		state,
		open,
		close,
		cancel,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			cancel();
		}
	};
}
function resolveElement(element) {
	return typeof element === "function" ? element() : element;
}
function flushStyles(el) {
	if (!el) return;
	el.offsetHeight;
}
function cancelAnimations(el) {
	const animations = el?.getAnimations?.({ subtree: true }) ?? [];
	for (const animation of animations) animation.cancel();
}
function waitForAnimations(el) {
	if (!el) return Promise.resolve();
	const animations = el.getAnimations?.() ?? [];
	if (animations.length === 0) return Promise.resolve();
	return Promise.all(animations.map((a) => a.finished)).then(noop, noop);
}

//#endregion
export { createTransition as t };
//# sourceMappingURL=transition-C9TiIy5V.js.map