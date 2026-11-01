/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as menuContext } from "../context-D5Xgpnkx.js";

//#region ../html/dist/dev/ui/menu/checkbox-item.js
/**
* Menu item that toggles `checked` when activated and leaves the menu open. The element itself takes
* `role="menuitemcheckbox"`.
*
* @fires checked-change - Fired when the checked state changes.
*/
var MenuCheckboxItemElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.checked = false;
		this.disabled = false;
		this.#ctx = new ContextConsumer(this, {
			context: menuContext,
			subscribe: true
		});
		this.#disconnect = null;
		this.#registered = false;
		this.#cleanupRegistration = null;
	}
	static {
		this.tagName = "media-menu-checkbox-item";
	}
	static {
		this.properties = {
			checked: { type: Boolean },
			disabled: { type: Boolean }
		};
	}
	#ctx;
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
		const ctx = this.#ctx.value;
		if (!ctx || !this.#disconnect) return;
		if (!this.#registered) {
			this.#registered = true;
			this.#cleanupRegistration = ctx.menu.registerItem(this);
			applyElementProps(this, {
				onClick: () => {
					if (!this.#ctx.value || this.disabled) return;
					this.checked = !this.checked;
					this.dispatchEvent(new CustomEvent("checked-change", {
						detail: { checked: this.checked },
						bubbles: true
					}));
				},
				onPointerenter: () => {
					const currentCtx = this.#ctx.value;
					if (!this.disabled) currentCtx?.menu.highlight(this, {
						focus: false,
						pointer: true
					});
				}
			}, { signal: this.#disconnect.signal });
		}
		applyElementProps(this, {
			role: "menuitemcheckbox",
			"aria-checked": String(this.checked),
			"aria-disabled": this.disabled ? "true" : void 0
		});
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/menu-checkbox-item.js
safeDefine(MenuCheckboxItemElement);

//#endregion
//# sourceMappingURL=menu-checkbox-item.dev.js.map