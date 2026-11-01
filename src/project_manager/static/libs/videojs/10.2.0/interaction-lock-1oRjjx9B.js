//#region ../core/dist/dev/dom/ui/interaction-lock.js
const locks = /* @__PURE__ */ new WeakMap();
/** Prevent container-level interactions while a scoped overlay owns the container. */
function lockInteractions(element) {
	locks.set(element, (locks.get(element) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const count = locks.get(element) ?? 0;
		if (count <= 1) locks.delete(element);
		else locks.set(element, count - 1);
	};
}
/** Whether a scoped overlay currently prevents interactions on this container. */
function isInteractionLocked(element) {
	return (locks.get(element) ?? 0) > 0;
}

//#endregion
export { lockInteractions as n, isInteractionLocked as t };
//# sourceMappingURL=interaction-lock-1oRjjx9B.js.map