/*! Video.js | https://videojs.org/help */
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { a as getIndicatorCloseDelay, i as IndicatorCloseController } from "../input-action-DMBaa6h-.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { a as predictVolumeActionOutcome, i as isVolumeIndicatorAction, o as DEFAULT_INPUT_INDICATOR_LABELS, r as getVolumeIndicatorDisplayValue, s as createInputIndicatorLabels, t as deriveVolumeStatus } from "../status-DsZydvT8.js";
import { n as InputIndicatorElement, t as LiveIndicator } from "../live-indicator-CshLlWRO.js";

//#region ../core/dist/dev/core/ui/volume-indicator/core.js
const BOUNDARY_CLEAR_DELAY = 300;
const INITIAL_STATE = {
	open: false,
	generation: 0,
	level: null,
	value: null,
	fill: null,
	min: false,
	max: false,
	transitionStarting: false,
	transitionEnding: false
};
/** @internal */
var VolumeIndicatorCore = class {
	state = createState({ ...INITIAL_STATE });
	#props = {};
	#boundaryTimer = null;
	#close = new IndicatorCloseController(() => this.state.patch({
		open: false,
		level: null,
		value: null,
		fill: null,
		min: false,
		max: false
	}), () => getIndicatorCloseDelay(this.#props));
	setProps(props) {
		this.#props = props;
	}
	destroy() {
		this.#close.destroy();
		this.#clearBoundaryTimers();
	}
	close() {
		this.#clearBoundaryTimers();
		this.#close.close();
	}
	processEvent(event, snapshot) {
		if (!isVolumeIndicatorAction(event.action)) return false;
		const current = this.state.current;
		const prediction = predictVolumeActionOutcome(event, snapshot);
		const details = deriveVolumeStatus(event, snapshot, {
			...DEFAULT_INPUT_INDICATOR_LABELS,
			...this.#props.labels
		}, prediction);
		const boundary = getVolumeBoundary(event, prediction.snapshotVolume, prediction.nextVolume);
		const showBoundary = boundary !== null && !event.repeat;
		if (!boundary) this.#clearBoundaryTimers();
		this.state.patch({
			open: true,
			generation: current.generation + 1,
			level: details.volumeLevel,
			value: details.value,
			fill: details.value,
			min: boundary && event.repeat ? current.min : showBoundary && boundary === "min",
			max: boundary && event.repeat ? current.max : showBoundary && boundary === "max"
		});
		if (showBoundary) this.#scheduleBoundaryClear();
		this.#close.arm();
		return true;
	}
	#scheduleBoundaryClear() {
		this.#clearBoundaryTimer();
		this.#boundaryTimer = setTimeout(() => {
			this.#boundaryTimer = null;
			this.state.patch({
				min: false,
				max: false
			});
		}, BOUNDARY_CLEAR_DELAY);
	}
	#clearBoundaryTimer() {
		if (this.#boundaryTimer === null) return;
		clearTimeout(this.#boundaryTimer);
		this.#boundaryTimer = null;
	}
	#clearBoundaryTimers() {
		this.#clearBoundaryTimer();
	}
};
function getVolumeBoundary(event, currentVolume, nextVolume) {
	if (event.action !== "volumeStep" || event.value === void 0 || event.value === 0) return null;
	if (nextVolume !== currentVolume) return null;
	return event.value < 0 ? "min" : "max";
}

//#endregion
//#region ../core/dist/dev/core/ui/volume-indicator/data.js
/** @internal */
const VolumeIndicatorDataAttrs = {
	/** Present while the indicator is open. */
	open: "data-open",
	/** Predicted volume level as `"off"`, `"low"`, or `"high"`. */
	level: "data-level",
	/** Present briefly when a downward step cannot lower the volume further. */
	min: "data-min",
	/** Present briefly when an upward step cannot raise the volume further. */
	max: "data-max",
	/** Present during the open transition. */
	transitionStarting: "data-starting-style",
	/** Present during the close transition. */
	transitionEnding: "data-ending-style"
};

//#endregion
//#region ../core/dist/dev/core/ui/volume-indicator/vars.js
/** @internal */
const VolumeIndicatorCSSVars = { 
/** Current predicted volume percentage, set on the Fill part. */
fill: "--media-volume-fill" };

//#endregion
//#region ../html/dist/dev/ui/volume-indicator/element.js
var VolumeIndicatorElement = class extends InputIndicatorElement {
	static {
		this.tagName = "media-volume-indicator";
	}
	static {
		this.properties = { closeDelay: {
			type: Number,
			attribute: "close-delay"
		} };
	}
	#i18n = new I18nController(this, i18nContext);
	#core = new VolumeIndicatorCore();
	#transition = createTransition();
	#liveIndicator = new LiveIndicator({
		host: this,
		dataAttrs: VolumeIndicatorDataAttrs,
		render: renderVolumeIndicator
	});
	#options = { replayOnUpdate: false };
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
			closeDelay: this.closeDelay,
			labels: createInputIndicatorLabels(this.#i18n.value)
		});
	}
};
function renderVolumeIndicator(element, state) {
	const fill = element.querySelector("media-volume-indicator-fill");
	const value = element.querySelector("media-volume-indicator-value");
	if (state.fill) fill?.style.setProperty(VolumeIndicatorCSSVars.fill, state.fill);
	else fill?.style.removeProperty(VolumeIndicatorCSSVars.fill);
	if (value) value.textContent = getVolumeIndicatorDisplayValue(state);
}

//#endregion
//#region ../html/dist/dev/define/ui/volume-indicator.js
safeDefine(VolumeIndicatorElement);

//#endregion
//# sourceMappingURL=volume-indicator.dev.js.map