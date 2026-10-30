/*! Video.js | https://videojs.org/help */
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { r as selectControls, s as selectMetadata } from "../selectors-B0umcXKn.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";

//#region ../core/dist/dev/core/ui/title/core.js
/** @internal */
var TitleCore = class {
	getState(media, controls) {
		const { title } = media;
		return {
			title,
			hidden: title.length === 0,
			visible: controls?.controlsVisible ?? false
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/title/data.js
/** @internal */
const TitleDataAttrs = {
	/** Present when the element is hidden because no title is available. */
	hidden: "data-hidden",
	/** Present while the player controls are visible. */
	visible: "data-visible"
};

//#endregion
//#region ../html/dist/dev/ui/title/element.js
/**
* Displays the resolved content title.
*
* The element owns its text content. Set the title through the player's `content-title` attribute.
*/
var TitleElement = class extends UIElement {
	static {
		this.tagName = "media-title";
	}
	#core = new TitleCore();
	#metadataState = new PlayerController(this, playerContext, selectMetadata);
	#controlsState = new PlayerController(this, playerContext, selectControls);
	connectedCallback() {
		super.connectedCallback();
		if (!this.#metadataState.value) logMissingFeature(this.localName, this.#metadataState.displayName);
	}
	update(changed) {
		super.update(changed);
		const metadata = this.#metadataState.value;
		if (!metadata) return;
		const state = this.#core.getState(metadata, this.#controlsState.value);
		if (this.textContent !== state.title) this.textContent = state.title;
		this.hidden = state.hidden;
		applyStateDataAttrs(this, state, TitleDataAttrs);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/title.js
safeDefine(TitleElement);

//#endregion
//# sourceMappingURL=title.dev.js.map