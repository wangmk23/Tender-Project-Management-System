/*! Video.js | https://videojs.org/help */
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as MenuGroupController } from "../group-controller-juSZS8Uz.js";

//#region ../html/dist/dev/ui/menu/group.js
/**
* Groups related menu items; the element itself takes `role="group"`. A `<media-menu-group-label>` child names the
* group unless it already has an `aria-label` or `aria-labelledby`.
*/
var MenuGroupElement = class extends UIElement {
	static {
		this.tagName = "media-menu-group";
	}
	#group = new MenuGroupController(this);
	update(_changed) {
		super.update(_changed);
		this.#group.applyProps();
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/menu-group.js
safeDefine(MenuGroupElement);

//#endregion
//# sourceMappingURL=menu-group.dev.js.map