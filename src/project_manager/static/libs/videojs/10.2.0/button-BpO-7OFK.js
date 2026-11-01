//#region ../core/dist/dev/dom/ui/button.js
/** @internal */
function createButton(options) {
	const { onActivate, isDisabled } = options;
	return {
		role: "button",
		tabIndex: 0,
		onClick(event) {
			if (isDisabled()) {
				event.preventDefault();
				return;
			}
			onActivate(event, (event.detail ?? 0) > 0 ? "pointer" : "virtual");
		},
		onPointerDown(event) {
			if (isDisabled()) event.preventDefault();
		},
		onMouseDown(event) {
			if (isDisabled()) event.preventDefault();
		},
		onKeyDown(event) {
			if (event.target !== event.currentTarget) return;
			if (isDisabled()) {
				if (event.key !== "Tab") event.preventDefault();
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				onActivate(event, "keyboard");
			} else if (event.key === " ") event.preventDefault();
		},
		onKeyUp(event) {
			if (event.target !== event.currentTarget) return;
			if (isDisabled()) return;
			if (event.key === " ") onActivate(event, "keyboard");
		}
	};
}

//#endregion
export { createButton as t };
//# sourceMappingURL=button-BpO-7OFK.js.map