/*! Video.js | https://videojs.org/help */
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";

//#region ../html/dist/dev/ui/menu/separator.js
/** Visual divider between groups of menu items; the element itself takes `role="separator"`. */
var MenuSeparatorElement = class extends UIElement {
	static {
		this.tagName = "media-menu-separator";
	}
	update(_changed) {
		super.update(_changed);
		applyElementProps(this, { role: "separator" });
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/menu-separator.js
safeDefine(MenuSeparatorElement);

//#endregion
//# sourceMappingURL=menu-separator.dev.js.map