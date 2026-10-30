/*! Video.js | https://videojs.org/help */
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { h as selectVolume } from "../selectors-B0umcXKn.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { n as PopoverCore, t as PopoverElement } from "../element-jd0GsAQp.js";

//#region ../core/dist/dev/core/ui/volume-popover/core.js
/**
* A volume-aware popover that preserves its mute trigger when volume level controls are unavailable.
*
* @internal
*/
var VolumePopoverCore = class extends PopoverCore {
	static defaultProps = PopoverCore.defaultProps;
	#media = null;
	setMedia(media) {
		this.#media = media;
	}
	getState() {
		const availability = this.#media.volumeAvailability;
		return {
			...super.getState(),
			availability,
			hidden: availability !== "available"
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/volume-popover/data.js
/** @internal */
const VolumePopoverDataAttrs = {
	/** Present when the popover is open. */
	open: "data-open",
	/** Indicates the rendered side after collision handling. */
	side: "data-side",
	/** Indicates how the popup is aligned relative to its side. */
	align: "data-align",
	/** Present during the open transition. */
	transitionStarting: "data-starting-style",
	/** Present during the close transition. */
	transitionEnding: "data-ending-style",
	/** Indicates volume control availability (`available`, `unavailable`, or `unsupported`). */
	availability: "data-availability",
	/** Present when volume level controls are unavailable. */
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/volume-popover/element.js
const unavailableVolume = {
	volume: 0,
	muted: false,
	volumeAvailability: "unsupported",
	mutedAvailability: "unsupported",
	setVolume: () => 0,
	setMuted: () => false
};
/** A volume-aware popover that keeps its adjacent mute trigger available as a fallback. */
var VolumePopoverElement = class extends PopoverElement {
	static {
		this.tagName = "media-volume-popover";
	}
	#core = new VolumePopoverCore();
	#volume = new PlayerController(this, playerContext, selectVolume);
	update(changed) {
		super.update(changed);
		this.#core.setProps(this);
		this.#core.setInput({
			active: this.hasAttribute("data-open"),
			status: this.hasAttribute("data-starting-style") ? "starting" : this.hasAttribute("data-ending-style") ? "ending" : "idle"
		});
		this.#core.setMedia(this.#volume.value ?? unavailableVolume);
		const state = this.#core.getState();
		applyStateDataAttrs(this, state, VolumePopoverDataAttrs);
		this.hidden = state.hidden;
		if (state.hidden) {
			this.close();
			if (this.triggerElement) applyElementProps(this.triggerElement, {
				"aria-expanded": void 0,
				"aria-haspopup": void 0,
				"aria-controls": void 0
			});
		}
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/volume-popover.js
safeDefine(VolumePopoverElement);

//#endregion
//# sourceMappingURL=volume-popover.dev.js.map