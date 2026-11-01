/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext, t as containerContext } from "../context-CL8SSE10.js";
import { t as SnapshotController } from "../snapshot-controller-CR9Xu35W.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { i as selectError } from "../selectors-B0umcXKn.js";
import { r as createDialog, t as DialogDataAttrs } from "../data-CYlQCNZY.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as AlertDialogCore } from "../core-DFC0TGue.js";
import { t as dialogContext } from "../context-CjiW7_2k.js";
import { translateText } from "../i18n.dev.js";

//#region ../core/dist/dev/core/ui/error-dialog/core.js
/**
* Error-dialog core: an alert dialog whose open state is driven by media error state.
*
* @internal
*/
var ErrorDialogCore = class extends AlertDialogCore {
	setProps() {}
};

//#endregion
//#region ../core/dist/dev/core/ui/error-dialog/data.js
/** @internal */
const ErrorDialogDataAttrs = { ...DialogDataAttrs };

//#endregion
//#region ../core/dist/dev/i18n/text/common.js
const prefix$1 = "common.";
const emptyText = {
	key: `${prefix$1}empty`,
	text: ""
};
const okText = {
	key: `${prefix$1}ok`,
	text: "OK"
};

//#endregion
//#region ../core/dist/dev/i18n/text/errors.js
const prefix = "errors.";
const abortedText = {
	key: `${prefix}aborted`,
	text: "You stopped media playback before it finished."
};
const networkText = {
	key: `${prefix}network`,
	text: "This media could not be loaded due to a network or server issue."
};
const decodeText = {
	key: `${prefix}decode`,
	text: "This media could not be played. It may be corrupted, or your browser may not support its format."
};
const sourceText = {
	key: `${prefix}source`,
	text: "This media could not be loaded. It may be unavailable, or your browser may not support its format."
};
const encryptedText = {
	key: `${prefix}encrypted`,
	text: "This media could not be played because it could not be decrypted."
};
const unplayableText = {
	key: `${prefix}unplayable`,
	text: "This media is unsupported by the player."
};
const titleText = {
	key: `${prefix}title`,
	text: "Something went wrong."
};
const unexpectedText = {
	key: `${prefix}unexpected`,
	text: "An unexpected error occurred."
};

//#endregion
//#region ../core/dist/dev/core/ui/error-dialog/i18n.js
/**
* SVTA 99 [Custom] 001 — an engine reporting that it has no pipeline for something the source requires. Not a
* `MediaError.MEDIA_ERR_*` value: engines that report SVTA codes surface them on `error.code` directly.
*
* The literal rather than an import. `@videojs/spf` defines this as `SVTA_UNSUPPORTED_PLAYBACK_FEATURE` and owns its
* meaning, but core doesn't depend on spf, and reaching it through `@videojs/media` would pull an engine entry point
* into a barrel that has no other reason to load one. Same trade `HlsVideoMediaStreamType` makes in the other direction
* — compatibility by value, stated in a comment, instead of a dependency edge neither package wants.
*/
const SVTA_UNSUPPORTED_PLAYBACK_FEATURE = 99001;
const MEDIA_ERROR_TRANSLATIONS = {
	[MediaError.MEDIA_ERR_ABORTED]: abortedText,
	[MediaError.MEDIA_ERR_NETWORK]: networkText,
	[MediaError.MEDIA_ERR_DECODE]: decodeText,
	[MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: sourceText,
	[MediaError.MEDIA_ERR_ENCRYPTED]: encryptedText,
	[MediaError.MEDIA_ERR_CUSTOM]: emptyText,
	[SVTA_UNSUPPORTED_PLAYBACK_FEATURE]: unplayableText
};
const STANDARD_CODE_UA_MESSAGES = { [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: ["Failed to open media"] };
function isStandardMediaErrorCode(code) {
	return code >= MediaError.MEDIA_ERR_ABORTED && code <= MediaError.MEDIA_ERR_ENCRYPTED;
}
/** @internal */
function getErrorDialogTitleText() {
	return titleText;
}
/** @internal */
function getErrorDialogDismissText() {
	return okText;
}
/** @internal */
function getErrorDialogUnexpectedText() {
	return unexpectedText;
}
/**
* Resolves dialog body copy: default phrases for known {@link MediaError} defaults, literal text for custom messages,
* otherwise the generic fallback key.
*
* @internal
*/
function resolveErrorDialogDescription(error, cachedMessage) {
	if (error) {
		const text = MEDIA_ERROR_TRANSLATIONS[error.code];
		const message = error.message?.trim();
		if (message) {
			const defaultForCode = MediaError.defaultMessages[error.code];
			if (text && defaultForCode && message === defaultForCode) return text;
			const uaVariants = STANDARD_CODE_UA_MESSAGES[error.code];
			if (text && isStandardMediaErrorCode(error.code) && !error.context && uaVariants?.includes(message)) return text;
			return message;
		}
		if (text) return text;
	}
	const cached = cachedMessage?.trim();
	if (cached) return cached;
	return unexpectedText;
}

//#endregion
//#region ../html/dist/dev/ui/error-dialog/element.js
let idCounter = 0;
function hasAuthoredContent(host) {
	return Array.from(host.childNodes).some((node) => !!node.textContent?.trim());
}
var ErrorDialogElement = class extends UIElement {
	static {
		this.tagName = "media-error-dialog";
	}
	#core = new ErrorDialogCore();
	#provider = new ContextProvider(this, { context: dialogContext });
	#popupId = `vjs-error-dialog-popup-${idCounter++}`;
	#titleId = `vjs-error-dialog-title-${idCounter++}`;
	#descriptionId = `vjs-error-dialog-desc-${idCounter++}`;
	#errorState = new PlayerController(this, playerContext, selectError);
	#i18n = new I18nController(this, i18nContext);
	#container = new ContextConsumer(this, {
		context: containerContext,
		subscribe: true
	});
	#dialog = null;
	#snapshot = null;
	#modalitySnapshot = null;
	#lastError = null;
	#lastDescription = null;
	#seenCopyParts = /* @__PURE__ */ new WeakSet();
	#authoredCopyParts = /* @__PURE__ */ new WeakSet();
	constructor() {
		super();
		this.#core.setTitleId(this.#titleId);
		this.#core.setDescriptionId(this.#descriptionId);
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#dialog = createDialog({
			transition: createTransition(),
			onOpenChange: (nextOpen) => {
				if (!nextOpen) this.#errorState.value?.dismissError();
			}
		});
		if (this.#snapshot) this.#snapshot.track(this.#dialog.input);
		else this.#snapshot = new SnapshotController(this, this.#dialog.input);
		if (this.#modalitySnapshot) this.#modalitySnapshot.track(this.#dialog.modality);
		else this.#modalitySnapshot = new SnapshotController(this, this.#dialog.modality);
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#dialog?.destroy();
		this.#dialog = null;
	}
	willUpdate(_changed) {
		super.willUpdate(_changed);
		if (!this.#dialog) return;
		this.#dialog.setInteractionRoot(this.#container.value?.container ?? null);
		const errorState = this.#errorState.value;
		const hasError = Boolean(errorState?.error);
		const { active: isOpen } = this.#dialog.input.current;
		if (errorState?.error) this.#lastError = errorState.error;
		const errorForCopy = errorState?.error ?? (isOpen ? this.#lastError : null);
		this.#syncDialogCopy(errorForCopy);
		if (!hasError && !isOpen) {
			this.#lastError = null;
			this.#lastDescription = null;
		}
		if (hasError && !isOpen) this.#dialog.open();
		else if (!hasError && isOpen) this.#dialog.close();
	}
	update(_changed) {
		super.update(_changed);
		if (!this.#dialog) return;
		const input = this.#dialog.input.current;
		this.#core.setInput(input);
		this.#core.setDocumentModal(this.#dialog.modality.current.documentModal);
		const state = this.#core.getState();
		applyStateDataAttrs(this, state, ErrorDialogDataAttrs);
		this.#provider.setValue({
			state,
			stateAttrMap: ErrorDialogDataAttrs,
			dialog: this.#dialog,
			popupId: this.#popupId,
			popupAttrs: this.#core.getPopupAttrs(state),
			close: () => this.#dialog?.close()
		});
	}
	#syncDialogCopy(error) {
		const t = this.#i18n.value;
		const title = this.querySelector("media-dialog-title");
		if (title && !this.#hasAuthoredCopy(title)) title.textContent = translateText(getErrorDialogTitleText(), t);
		const desc = this.querySelector("media-dialog-description");
		if (desc && !this.#hasAuthoredCopy(desc)) {
			const description = error ? resolveErrorDialogDescription(error) : null;
			if (description) this.#lastDescription = description;
			const copy = description ?? this.#lastDescription;
			desc.textContent = copy ? translateText(copy, t) : translateText(getErrorDialogUnexpectedText(), t);
		}
		const close = this.querySelector("media-dialog-close");
		if (close && !this.#hasAuthoredCopy(close)) close.textContent = translateText(getErrorDialogDismissText(), t);
	}
	#hasAuthoredCopy(el) {
		if (!this.#seenCopyParts.has(el)) {
			this.#seenCopyParts.add(el);
			if (hasAuthoredContent(el)) this.#authoredCopyParts.add(el);
		}
		return this.#authoredCopyParts.has(el);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/error-dialog.js
safeDefine(ErrorDialogElement);

//#endregion
//# sourceMappingURL=error-dialog.dev.js.map