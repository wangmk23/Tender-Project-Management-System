/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as dialogContext } from "../context-CjiW7_2k.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";

//#region ../html/dist/dev/ui/dialog/title.js
/** Text that labels its owning dialog. The element takes the `id` that the popup's `aria-labelledby` points to. */
var DialogTitleElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: dialogContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-dialog-title";
	}
	update(changed) {
		super.update(changed);
		const titleId = this.consumer.value?.state.titleId;
		if (titleId) this.id = titleId;
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/dialog-title.js
safeDefine(DialogTitleElement);

//#endregion
//# sourceMappingURL=dialog-title.dev.js.map