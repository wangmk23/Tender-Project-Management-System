/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { c as selectPiP } from "../selectors-B0umcXKn.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/i18n/text/pip.js
const prefix = "pip.";
const enterText = {
	key: `${prefix}enter`,
	text: "Enter picture-in-picture"
};
const exitText = {
	key: `${prefix}exit`,
	text: "Exit picture-in-picture"
};

//#endregion
//#region ../core/dist/dev/core/ui/pip-button/core.js
/** @internal */
var PiPButtonCore = class PiPButtonCore {
	static defaultProps = {
		label: "",
		disabled: false
	};
	state = createState({
		pip: false,
		availability: "unavailable",
		disabled: true,
		hidden: true,
		label: ""
	});
	#props = { ...PiPButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, PiPButtonCore.defaultProps);
	}
	getLabel(state) {
		const label = resolveLabel(this.#props.label, state);
		if (label) return label;
		return state.pip ? exitText : enterText;
	}
	getAttrs(state) {
		return {
			"aria-label": this.getLabel(state),
			"aria-disabled": state.disabled ? "true" : void 0,
			hidden: state.hidden ? "" : void 0
		};
	}
	setMedia(media) {
		this.#media = media;
	}
	getState() {
		const media = this.#media;
		const availability = media.pictureInPictureAvailability;
		const actionable = media.isPictureInPicture || availability === "available";
		this.state.patch({
			pip: media.isPictureInPicture,
			availability,
			disabled: this.#props.disabled || !actionable,
			hidden: !actionable
		});
		this.state.patch({ label: resolveText(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	async toggle(media) {
		this.setMedia(media);
		if (this.getState().disabled) return;
		return media.isPictureInPicture ? media.exitPictureInPicture() : media.requestPictureInPicture();
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/pip-button/data.js
/** @internal */
const PiPButtonDataAttrs = {
	/** Present when picture-in-picture mode is active. */
	pip: "data-pip",
	/** Indicates picture-in-picture availability (`available`, `unavailable`, `unsupported`). */
	availability: "data-availability",
	/** Present when the button is non-interactive (mirrors `aria-disabled`). */
	disabled: "data-disabled",
	/** Present when the button is hidden because picture-in-picture is not available. */
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/pip-button/element.js
var PiPButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.core = new PiPButtonCore();
		this.stateAttrMap = PiPButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectPiP);
		this.hotkeyAction = "togglePictureInPicture";
	}
	static {
		this.tagName = "media-pip-button";
	}
	activate(state) {
		return this.core.toggle(state);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/pip-button.js
safeDefine(PiPButtonElement);

//#endregion
//# sourceMappingURL=pip-button.dev.js.map