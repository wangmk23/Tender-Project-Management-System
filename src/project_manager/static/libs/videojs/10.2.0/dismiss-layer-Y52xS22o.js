import { t as listen } from "./listen-CO63BggB.js";

//#region ../core/dist/dev/dom/ui/dismiss-layer.js
/** @internal */
function createDismissLayer(options) {
	const { transition } = options;
	const state = transition.state;
	const abort = new AbortController();
	let docAbort = null;
	function open(element) {
		if (abort.signal.aborted) return null;
		const { active, status } = state.current;
		if (active && status !== "ending") return null;
		if (status === "ending") transition.cancel();
		return transition.open(element);
	}
	function close(element) {
		const { active, status } = state.current;
		if (abort.signal.aborted || !active || status === "ending") return null;
		return transition.close(element);
	}
	function setupDocumentListeners() {
		cleanupDocumentListeners();
		if (typeof document === "undefined") return;
		docAbort = new AbortController();
		const { signal } = docAbort;
		listen(document, "keydown", handleKeydown, { signal });
		options.onDocumentActive?.(signal);
	}
	function cleanupDocumentListeners() {
		docAbort?.abort();
		docAbort = null;
	}
	function handleKeydown(event) {
		if (event.key !== "Escape") return;
		if (event.defaultPrevented) return;
		if (!state.current.active) return;
		if (!(options.closeOnEscape?.() ?? true)) return;
		options.onEscapeDismiss(event);
	}
	const unsubscribe = state.subscribe(() => {
		if (state.current.active && state.current.status !== "ending") setupDocumentListeners();
		else cleanupDocumentListeners();
	});
	abort.signal.addEventListener("abort", () => {
		unsubscribe();
		transition.destroy();
		cleanupDocumentListeners();
	});
	function destroy() {
		if (abort.signal.aborted) return;
		abort.abort();
	}
	return {
		input: state,
		open,
		close,
		signal: abort.signal,
		destroy
	};
}

//#endregion
export { createDismissLayer as t };
//# sourceMappingURL=dismiss-layer-Y52xS22o.js.map