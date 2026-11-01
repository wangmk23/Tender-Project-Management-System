/*! Video.js | https://videojs.org/help */
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { a as getIndicatorCloseDelay, i as IndicatorCloseController } from "../input-action-DMBaa6h-.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { o as DEFAULT_INPUT_INDICATOR_LABELS, s as createInputIndicatorLabels, t as deriveVolumeStatus } from "../status-DsZydvT8.js";
import { n as InputIndicatorElement, t as LiveIndicator } from "../live-indicator-CshLlWRO.js";

//#region ../core/dist/dev/core/ui/input-action.js
/** @internal */
function isInputActionIncluded(action, actions) {
	if (!action) return false;
	return !actions || actions.includes(action);
}

//#endregion
//#region ../core/dist/dev/core/ui/status-indicator/status.js
/**
* Derives the predicted visual status from an input action and its pre-action media snapshot.
*
* @internal
*/
function deriveStatus(event, snapshot, labels = DEFAULT_INPUT_INDICATOR_LABELS) {
	switch (event.action) {
		case "togglePaused": {
			const paused = snapshot.paused !== void 0 ? !snapshot.paused : true;
			return {
				status: paused ? "pause" : "play",
				label: paused ? labels.paused : labels.playing,
				value: null
			};
		}
		case "toggleMuted":
		case "volumeStep": return deriveVolumeStatus(event, snapshot, labels);
		case "toggleSubtitles": {
			if (snapshot.subtitlesAvailable === false) return null;
			const showing = snapshot.subtitlesShowing !== void 0 ? !snapshot.subtitlesShowing : true;
			return {
				status: showing ? "captions-on" : "captions-off",
				label: showing ? labels.captionsOn : labels.captionsOff,
				value: null
			};
		}
		case "toggleFullscreen": {
			const fullscreen = snapshot.isFullscreen !== void 0 ? !snapshot.isFullscreen : true;
			return {
				status: fullscreen ? "fullscreen" : "exit-fullscreen",
				label: fullscreen ? labels.fullscreen : labels.exitFullscreen,
				value: null
			};
		}
		case "togglePictureInPicture": {
			const pip = snapshot.isPictureInPicture !== void 0 ? !snapshot.isPictureInPicture : true;
			return {
				status: pip ? "pip" : "exit-pip",
				label: pip ? labels.pictureInPicture : labels.exitPictureInPicture,
				value: null
			};
		}
		default: return null;
	}
}
/**
* Returns the volume percentage when present, then the translated status label.
*
* @internal
*/
function getStatusIndicatorDisplayValue(state) {
	return state.value ?? state.label ?? "";
}

//#endregion
//#region ../core/dist/dev/core/ui/status-indicator/core.js
const INITIAL_STATE = {
	open: false,
	generation: 0,
	status: null,
	label: null,
	value: null,
	transitionStarting: false,
	transitionEnding: false
};
/** @internal */
var StatusIndicatorCore = class {
	state = createState({ ...INITIAL_STATE });
	#props = {};
	#close = new IndicatorCloseController(() => this.state.patch({
		open: false,
		status: null,
		label: null,
		value: null
	}), () => getIndicatorCloseDelay(this.#props));
	setProps(props) {
		this.#props = props;
	}
	destroy() {
		this.#close.destroy();
	}
	close() {
		this.#close.close();
	}
	processEvent(event, snapshot) {
		if (!isInputActionIncluded(event.action, this.#props.actions)) return false;
		const details = deriveStatus(event, snapshot, {
			...DEFAULT_INPUT_INDICATOR_LABELS,
			...this.#props.labels
		}) ?? this.#props.deriveCustomStatus?.(event, snapshot);
		if (!details) return false;
		this.state.patch({
			open: true,
			generation: this.state.current.generation + 1,
			status: details.status,
			label: details.label,
			value: details.value
		});
		this.#close.arm();
		return true;
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/status-indicator/data.js
/** @internal */
const StatusIndicatorDataAttrs = {
	/** Present while the indicator is open. */
	open: "data-open",
	/** Predicted visual status for the handled input action. */
	status: "data-status",
	/** Present during the open transition. */
	transitionStarting: "data-starting-style",
	/** Present during the close transition. */
	transitionEnding: "data-ending-style"
};

//#endregion
//#region ../html/dist/dev/ui/status-indicator/element.js
var StatusIndicatorElement = class extends InputIndicatorElement {
	static {
		this.tagName = "media-status-indicator";
	}
	static {
		this.properties = {
			actions: { type: String },
			closeDelay: {
				type: Number,
				attribute: "close-delay"
			}
		};
	}
	#i18n = new I18nController(this, i18nContext);
	#core = new StatusIndicatorCore();
	#transition = createTransition();
	#liveIndicator = new LiveIndicator({
		host: this,
		dataAttrs: StatusIndicatorDataAttrs,
		render: renderStatusIndicator
	});
	#options = { replayOnUpdate: false };
	#deriveCustomStatus;
	/**
	* Derives display details for actions without built-in feedback, such as custom hotkey actions. Called only when the
	* built-in derivation returns `null`. Set as a JavaScript property; it has no attribute.
	*/
	get deriveCustomStatus() {
		return this.#deriveCustomStatus;
	}
	set deriveCustomStatus(value) {
		this.#deriveCustomStatus = value;
		this.requestUpdate();
	}
	get core() {
		return this.#core;
	}
	get transition() {
		return this.#transition;
	}
	get liveIndicator() {
		return this.#liveIndicator;
	}
	get options() {
		return this.#options;
	}
	syncCoreProps() {
		this.#core.setProps({
			actions: parseActions(this.actions),
			closeDelay: this.closeDelay,
			labels: createInputIndicatorLabels(this.#i18n.value),
			deriveCustomStatus: this.#deriveCustomStatus
		});
	}
};
function parseActions(actions) {
	return actions?.split(/[\s,]+/).filter(Boolean);
}
function renderStatusIndicator(element, state) {
	const value = element.querySelector("media-status-indicator-value");
	if (!value) return;
	value.textContent = getStatusIndicatorDisplayValue(state);
}

//#endregion
//#region ../html/dist/dev/define/ui/status-indicator.js
safeDefine(StatusIndicatorElement);

//#endregion
//# sourceMappingURL=status-indicator.dev.js.map