import { t as UIElement } from "./ui-element--3_7he7k.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";

//#region ../html/dist/dev/ui/menu/item-indicator.js
/**
* Decorative checked-state mark inside a menu item, hidden from assistive technology. It stays `hidden` unless
* `checked` or `force-mount` is set; option radio groups set `checked` on the indicators in the items they generate.
*/
var MenuItemIndicatorElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.checked = false;
		this.forceMount = false;
	}
	static {
		this.tagName = "media-menu-item-indicator";
	}
	static {
		this.properties = {
			checked: { type: Boolean },
			forceMount: {
				type: Boolean,
				attribute: "force-mount"
			}
		};
	}
	update(_changed) {
		super.update(_changed);
		const hidden = !this.checked && !this.forceMount;
		applyElementProps(this, {
			"aria-hidden": "true",
			hidden
		});
	}
};

//#endregion
export { MenuItemIndicatorElement as t };
//# sourceMappingURL=item-indicator-C7NitMbg.js.map