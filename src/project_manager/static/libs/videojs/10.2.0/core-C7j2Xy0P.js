import { t as defaults } from "./defaults-nT7MwJ_t.js";
import { n as getTransitionFlags, t as TransitionDataAttrs } from "./transition-CzuKD0-9.js";

//#region ../core/dist/dev/core/ui/menu/data.js
/**
* Root popup state used for positioning and surface transitions.
*
* @internal
*/
const MenuPopupDataAttrs = {
	/** Present when the menu is open. */
	open: "data-open",
	/** Rendered positioning side after collision handling. Absent on submenus. */
	side: "data-side",
	/** Popover positioning alignment. Absent on submenus. */
	align: "data-align",
	...TransitionDataAttrs
};
/**
* State for one root or nested Content.
*
* @internal
*/
const MenuContentDataAttrs = {
	/** Present while this Content is active or transitioning out. */
	open: "data-open",
	/** Present on Content when this menu is nested inside a parent menu. */
	isSubmenu: "data-submenu",
	/** Present when this Content has an open logical child. */
	childOpen: "data-child-open",
	...TransitionDataAttrs
};
/**
* All public Menu data attributes exposed to component transforms.
*
* @internal
*/
const MenuDataAttrs = {
	...MenuPopupDataAttrs,
	...MenuContentDataAttrs
};

//#endregion
//#region ../core/dist/dev/core/ui/menu/core.js
/**
* Combines direct and nested option-menu state for a parent trigger.
*
* @internal
*/
function resolveMenuOptionState(states) {
	const options = [...states];
	if (options.length === 0) return null;
	const visible = options.filter((state) => !state.hidden);
	const availability = visible.filter((state) => state.availability === "available").length > 0 ? "available" : options.every((state) => state.availability === "unsupported") ? "unsupported" : "unavailable";
	return {
		value: options.length === 1 ? options[0].value : "",
		disabled: visible.length === 0 || visible.every((state) => state.disabled),
		hidden: visible.length === 0,
		availability
	};
}
/**
* Base menu logic: ARIA attributes and open/close state computation.
*
* @internal
*/
var MenuCore = class MenuCore {
	static defaultProps = {
		side: "bottom",
		align: "start",
		open: false,
		defaultOpen: false,
		closeOnEscape: true,
		closeOnOutsideClick: true
	};
	#props = { ...MenuCore.defaultProps };
	#input = null;
	get props() {
		return this.#props;
	}
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, MenuCore.defaultProps);
	}
	setInput(input) {
		this.#input = input;
	}
	getState() {
		const input = this.#input;
		const isSubmenu = input.isSubmenu;
		return {
			open: input.active,
			status: input.status,
			side: isSubmenu ? void 0 : this.#props.side,
			align: isSubmenu ? void 0 : this.#props.align,
			isSubmenu,
			...getTransitionFlags(input.status)
		};
	}
	getTriggerAttrs(state, contentId) {
		return {
			...!state.isSubmenu && { tabIndex: 0 },
			"aria-haspopup": "menu",
			"aria-expanded": state.open && state.status !== "ending" ? "true" : "false",
			"aria-controls": contentId
		};
	}
	getContentAttrs() {
		return {
			role: "menu",
			tabIndex: -1
		};
	}
	getPopupAttrs() {
		return { popover: "manual" };
	}
};

//#endregion
export { MenuPopupDataAttrs as i, resolveMenuOptionState as n, MenuContentDataAttrs as r, MenuCore as t };
//# sourceMappingURL=core-C7j2Xy0P.js.map