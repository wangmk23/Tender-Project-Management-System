import { t as createContext } from "./create-context-Dp8VhaeT.js";
import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { n as completeMenuItemSelection } from "./menu--bNbak0v.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";
import { t as menuContext } from "./context-D5Xgpnkx.js";

//#region ../html/dist/dev/ui/radio-group/context.js
/** @internal */
const radioGroupContext = createContext(Symbol("@videojs/radio-group"));

//#endregion
//#region ../html/dist/dev/ui/menu/radio-item.js
/**
* Menu item that selects its `value` in the enclosing `<media-menu-radio-group>` and closes the menu. The element
* itself takes `role="menuitemradio"`, checked while its value matches the group's.
*/
var MenuRadioItemElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.value = "";
		this.disabled = false;
		this.#menuCtx = new ContextConsumer(this, {
			context: menuContext,
			subscribe: true
		});
		this.#groupCtx = new ContextConsumer(this, {
			context: radioGroupContext,
			subscribe: true
		});
		this.#disconnect = null;
		this.#registered = false;
		this.#cleanupRegistration = null;
	}
	static {
		this.tagName = "media-menu-radio-item";
	}
	static {
		this.properties = {
			value: { type: String },
			disabled: { type: Boolean }
		};
	}
	#menuCtx;
	#groupCtx;
	#disconnect;
	#registered;
	#cleanupRegistration;
	connectedCallback() {
		super.connectedCallback();
		this.#disconnect = new AbortController();
		this.#registered = false;
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#cleanupRegistration?.();
		this.#cleanupRegistration = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
		this.#registered = false;
	}
	update(_changed) {
		super.update(_changed);
		const menuCtx = this.#menuCtx.value;
		const groupCtx = this.#groupCtx.value;
		if (!menuCtx || !groupCtx || !this.#disconnect) return;
		if (!this.#registered) {
			this.#registered = true;
			this.#cleanupRegistration = menuCtx.menu.registerItem(this);
			applyElementProps(this, {
				onClick: () => {
					const currentMenuCtx = this.#menuCtx.value;
					const currentGroupCtx = this.#groupCtx.value;
					if (!currentMenuCtx || !currentGroupCtx || this.disabled) return;
					currentGroupCtx.onValueChange(this.value);
					completeMenuItemSelection(currentMenuCtx.menu);
				},
				onPointerenter: () => {
					const currentMenuCtx = this.#menuCtx.value;
					if (!this.disabled) currentMenuCtx?.menu.highlight(this, {
						focus: false,
						pointer: true
					});
				}
			}, { signal: this.#disconnect.signal });
		}
		const checked = groupCtx.value === this.value;
		applyElementProps(this, {
			role: "menuitemradio",
			"aria-checked": String(checked),
			"aria-disabled": this.disabled ? "true" : void 0
		});
	}
};

//#endregion
export { radioGroupContext as n, MenuRadioItemElement as t };
//# sourceMappingURL=radio-item-BNMHAymS.js.map