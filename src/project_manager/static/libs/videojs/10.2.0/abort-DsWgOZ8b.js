//#region ../utils/dist/dom/event.js
/**
* Resolve the deepest event target, preferring composedPath for shadow DOM.
*
* @internal
*/
function resolveEventTarget(event) {
	const path = event.composedPath();
	return path.length > 0 ? path[0] : event.target;
}
/** @internal */
function onEvent(target, type, options) {
	return new Promise((resolve, reject) => {
		const handleAbort = () => {
			reject(options?.signal?.reason ?? "Aborted");
		};
		if (options?.signal?.aborted) {
			handleAbort();
			return;
		}
		options?.signal?.addEventListener("abort", handleAbort, { once: true });
		target.addEventListener(type, (event) => {
			options?.signal?.removeEventListener("abort", handleAbort);
			resolve(event);
		}, {
			...options,
			once: true
		});
	});
}

//#endregion
//#region ../utils/dist/events/abort.js
/**
* Compose multiple abort signals into one that aborts when **any** input fires. Uses native `AbortSignal.any` when
* available, otherwise falls back to a manual `AbortController` composition for Chromium ≤115 and similar runtimes.
*
* @internal
*/
function anyAbortSignal(signals) {
	if ("any" in AbortSignal) return AbortSignal.any(signals);
	const controller = new AbortController();
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			return controller.signal;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), { signal: controller.signal });
	}
	return controller.signal;
}

//#endregion
export { onEvent as n, resolveEventTarget as r, anyAbortSignal as t };
//# sourceMappingURL=abort-DsWgOZ8b.js.map