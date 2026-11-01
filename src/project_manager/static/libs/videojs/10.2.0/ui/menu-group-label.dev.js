/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as menuGroupContext } from "../context-D5Xgpnkx.js";

//#region ../html/dist/dev/ui/menu/group-label.js
let idCounter = 0;
/** Non-interactive label that names its enclosing `<media-menu-group>` or `<media-menu-radio-group>`. */
var MenuGroupLabelElement = class extends UIElement {
	static {
		this.tagName = "media-menu-group-label";
	}
	#groupCtx = new ContextConsumer(this, {
		context: menuGroupContext,
		subscribe: true
	});
	#generatedId = `vjs-menu-group-label-${idCounter++}`;
	#cleanupRegistration = null;
	#registeredId = null;
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#cleanupRegistration?.();
		this.#cleanupRegistration = null;
		this.#registeredId = null;
	}
	update(_changed) {
		super.update(_changed);
		if (!this.id) this.id = this.#generatedId;
		this.#registerLabel();
	}
	#registerLabel() {
		const groupCtx = this.#groupCtx.value;
		if (!groupCtx) {
			this.#cleanupRegistration?.();
			this.#cleanupRegistration = null;
			this.#registeredId = null;
			return;
		}
		if (this.#registeredId === this.id) return;
		this.#cleanupRegistration?.();
		this.#registeredId = this.id;
		this.#cleanupRegistration = groupCtx.registerLabel(this.id);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/menu-group-label.js
safeDefine(MenuGroupLabelElement);

//#endregion
//# sourceMappingURL=menu-group-label.dev.js.map