//#region ../utils/dist/dom/listen.js
/** @internal */
function listen(target, type, listener, options) {
	target.addEventListener(type, listener, options);
	return () => target.removeEventListener(type, listener, options);
}

//#endregion
export { listen as t };
//# sourceMappingURL=listen-CO63BggB.js.map