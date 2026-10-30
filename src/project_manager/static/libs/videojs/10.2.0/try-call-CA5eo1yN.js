//#region ../utils/dist/function/try-call.js
/**
* Run a function that is expected to throw when the thing it targets is gone, ignoring the failure.
*
* Prefer `tryCatch` when the error should be handled or the result is needed; this is for fire-and-forget calls into an
* API that can be torn down underneath the caller, such as an embed inside an iframe.
*
* @example
*   ```ts
*   tryCall(() => player.destroy()); // Never throws
*   ```;
*
* @internal
*/
function tryCall(fn) {
	try {
		fn();
	} catch {}
}

//#endregion
export { tryCall as t };
//# sourceMappingURL=try-call-CA5eo1yN.js.map