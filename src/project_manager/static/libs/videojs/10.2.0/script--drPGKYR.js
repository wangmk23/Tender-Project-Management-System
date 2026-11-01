//#region ../utils/dist/dom/script.js
const cache = /* @__PURE__ */ new Map();
function hasScript(src) {
	for (const script of document.scripts) if (script.getAttribute("src") === src) return true;
	return false;
}
/**
* Load a script once. Concurrent and repeat calls for the same `src` share a single promise; failed loads are evicted
* (and the tag removed) so they can be retried.
*
* @internal
*/
function loadScript(src) {
	let promise = cache.get(src);
	if (promise) return promise;
	if (hasScript(src)) return Promise.resolve();
	promise = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.onload = () => resolve();
		script.onerror = () => {
			script.remove();
			reject(/* @__PURE__ */ new Error(`Failed to load script: ${src}`));
		};
		document.head.appendChild(script);
	});
	cache.set(src, promise);
	promise.catch(() => cache.delete(src));
	return promise;
}

//#endregion
export { loadScript as t };
//# sourceMappingURL=script--drPGKYR.js.map