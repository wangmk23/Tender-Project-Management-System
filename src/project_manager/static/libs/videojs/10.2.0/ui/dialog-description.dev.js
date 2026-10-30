/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as dialogContext } from "../context-CjiW7_2k.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";

//#region ../html/dist/dev/ui/dialog/description.js
/**
* Text announced as its owning dialog's description. The element takes the `id` that the popup's `aria-describedby`
* points to.
*/
var DialogDescriptionElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: dialogContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-dialog-description";
	}
	update(changed) {
		super.update(changed);
		const descriptionId = this.consumer.value?.state.descriptionId;
		if (descriptionId) this.id = descriptionId;
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/dialog-description.js
safeDefine(DialogDescriptionElement);

//#endregion
//# sourceMappingURL=dialog-description.dev.js.map