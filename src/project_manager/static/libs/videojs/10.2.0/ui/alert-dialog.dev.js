/*! Video.js | https://videojs.org/help */
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as DialogDataAttrs } from "../data-CYlQCNZY.js";
import { t as AlertDialogCore } from "../core-DFC0TGue.js";
import { n as DialogElementBase } from "../element-XoJFKPO6.js";

//#region ../core/dist/dev/core/ui/alert-dialog/data.js
/** @internal */
const AlertDialogDataAttrs = { ...DialogDataAttrs };

//#endregion
//#region ../html/dist/dev/ui/alert-dialog/element.js
/**
* A modal dialog with alert semantics.
*
* @fires open-change - Fired when the dialog's open state changes.
*/
var AlertDialogElement = class extends DialogElementBase {
	static {
		this.tagName = "media-alert-dialog";
	}
	constructor() {
		super({
			core: new AlertDialogCore(),
			stateAttrMap: AlertDialogDataAttrs,
			idPrefix: "alert-dialog",
			bindTrigger: false
		});
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/alert-dialog.js
safeDefine(AlertDialogElement);

//#endregion
//# sourceMappingURL=alert-dialog.dev.js.map