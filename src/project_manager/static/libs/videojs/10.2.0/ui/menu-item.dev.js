/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as completeMenuItemSelection } from "../menu--bNbak0v.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as menuContext } from "../context-D5Xgpnkx.js";

//#region ../html/dist/dev/ui/menu/item.js
/**
* Menu action; the element itself takes `role="menuitem"`. Activation fires a cancelable `select` event and then closes
* the menu, unless `commandfor` names a nested `<media-menu-content>` page to open instead.
*/
var MenuItemElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.disabled = false;
		this.commandfor = void 0;
		this.#ctx = new ContextConsumer(this, {
			context: menuContext,
			subscribe: true
		});
		this.#disconnect = null;
		this.#registeredMenu = null;
		this.#cleanupRegistration = null;
	}
	static {
		this.tagName = "media-menu-item";
	}
	static {
		this.properties = {
			disabled: { type: Boolean },
			commandfor: { type: String }
		};
	}
	#ctx;
	#disconnect;
	#registeredMenu;
	#cleanupRegistration;
	connectedCallback() {
		super.connectedCallback();
		this.#disconnect = new AbortController();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#cleanupRegistration?.();
		this.#cleanupRegistration = null;
		this.#registeredMenu = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	update(_changed) {
		super.update(_changed);
		const ctx = this.#ctx.value;
		if (!ctx || !this.#disconnect) return;
		if (this.#registeredMenu !== ctx.menu) {
			this.#cleanupRegistration?.();
			this.#registeredMenu = ctx.menu;
			this.#cleanupRegistration = ctx.menu.registerItem(this);
			applyElementProps(this, {
				onClick: (event) => {
					const currentCtx = this.#ctx.value;
					if (!currentCtx || this.#isDisabled()) return;
					const target = this.commandfor;
					if (target) this.#openSubmenu(target);
					else {
						const select = new CustomEvent("select", {
							bubbles: true,
							cancelable: true
						});
						if (!this.dispatchEvent(select)) {
							event.preventDefault();
							return;
						}
						completeMenuItemSelection(currentCtx.menu);
					}
					event.preventDefault();
				},
				onKeyDown: (event) => {
					if (!this.#ctx.value || this.#isDisabled() || event.key !== "ArrowRight") return;
					const target = this.commandfor;
					if (!target) return;
					this.#openSubmenu(target);
					event.preventDefault();
				},
				onPointerenter: () => {
					const currentCtx = this.#ctx.value;
					if (!this.#isDisabled()) currentCtx?.menu.highlight(this, {
						focus: false,
						pointer: true
					});
				}
			}, { signal: this.#disconnect.signal });
		}
		const hasSubmenu = Boolean(this.commandfor);
		applyElementProps(this, {
			role: "menuitem",
			"aria-disabled": this.#isDisabled() ? "true" : void 0,
			...hasSubmenu && {
				"aria-haspopup": "menu",
				"aria-expanded": "false",
				"data-has-submenu": ""
			}
		});
	}
	#openSubmenu(id) {
		this.getRootNode().querySelector(`#${CSS.escape(id)}`)?.openMenu?.("click");
	}
	#isDisabled() {
		return this.disabled || this.getAttribute("aria-disabled") === "true";
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/menu-item.js
safeDefine(MenuItemElement);

//#endregion
//# sourceMappingURL=menu-item.dev.js.map