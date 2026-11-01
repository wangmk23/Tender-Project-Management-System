import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { t as ContextProvider } from "./context-provider-2u40YNUB.js";
import { n as findElementChild } from "./children-D2Flrhz2.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { n as radioGroupContext, t as MenuRadioItemElement } from "./radio-item-BNMHAymS.js";
import { t as menuContext } from "./context-D5Xgpnkx.js";
import { t as MenuGroupController } from "./group-controller-juSZS8Uz.js";

//#region ../html/dist/dev/ui/radio-group/element.js
/** @fires value-change - Fired when the selected value changes. */
var RadioGroupElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.value = "";
		this.#provider = new ContextProvider(this, { context: radioGroupContext });
	}
	static {
		this.properties = { value: { type: String } };
	}
	#provider;
	update(changed) {
		super.update(changed);
		this.#provider.setValue({
			value: this.value,
			onValueChange: (next) => {
				this.value = next;
				this.dispatchEvent(new CustomEvent("value-change", {
					detail: { value: next },
					bubbles: true
				}));
			}
		});
	}
};

//#endregion
//#region ../html/dist/dev/ui/menu/radio-group.js
/** Group of mutually exclusive `<media-menu-radio-item>` children; the element itself takes `role="group"`. */
var MenuRadioGroupElement = class extends RadioGroupElement {
	static {
		this.tagName = "media-menu-radio-group";
	}
	#group = new MenuGroupController(this);
	#menu = new ContextConsumer(this, {
		context: menuContext,
		subscribe: true
	});
	#optionSource = Symbol("menu-option");
	#ariaLabel = null;
	#optionMenu = null;
	#setOptionState = null;
	disconnectedCallback() {
		this.#clearMenuOptionState();
		super.disconnectedCallback();
	}
	update(changed) {
		super.update(changed);
		this.#group.applyProps();
	}
	setItemLabel(item, label) {
		const labelPart = item.querySelector("[data-part~=\"label\"]");
		if (labelPart) labelPart.textContent = label;
		else item.textContent = label;
	}
	/** Applies a generated fallback without replacing an author-provided accessible name. */
	applyDefaultAriaLabel(label) {
		if (this.hasAttribute("aria-labelledby")) return;
		const current = this.getAttribute("aria-label");
		if (current !== null && current !== this.#ariaLabel) return;
		this.#ariaLabel = label;
		this.setAttribute("aria-label", label);
	}
	publishMenuOptionState(disabled, hidden, availability) {
		const context = this.#menu.value ?? null;
		if (context?.menu !== this.#optionMenu) {
			this.#clearMenuOptionState();
			this.#optionMenu = context?.menu ?? null;
			this.#setOptionState = context?.setOptionState ?? null;
		}
		if (!this.#setOptionState) return;
		const selectedItem = findElementChild(this, (item) => item instanceof MenuRadioItemElement && item.value === this.value);
		const value = selectedItem?.querySelector("[data-part~=\"label\"]")?.textContent ?? selectedItem?.textContent?.trim() ?? "";
		this.#setOptionState(this.#optionSource, {
			value,
			disabled,
			hidden,
			availability
		});
	}
	#clearMenuOptionState() {
		this.#setOptionState?.(this.#optionSource, null);
		this.#optionMenu = null;
		this.#setOptionState = null;
	}
};

//#endregion
export { MenuRadioGroupElement as t };
//# sourceMappingURL=radio-group-D0Xggx8c.js.map