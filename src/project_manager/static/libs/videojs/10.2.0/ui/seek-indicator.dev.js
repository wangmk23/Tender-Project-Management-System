/*! Video.js | https://videojs.org/help */
import { c as isDefaultLocale, s as DEFAULT_LOCALE } from "../i18n-ByQGZLGb.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { a as getIndicatorCloseDelay, i as IndicatorCloseController } from "../input-action-DMBaa6h-.js";
import { t as clamp } from "../number-D2skb7-A.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { t as formatTime } from "../format-Dhaf9oDP.js";
import { n as InputIndicatorElement, t as LiveIndicator } from "../live-indicator-CshLlWRO.js";

//#region ../core/dist/dev/core/ui/seek-indicator/status.js
/** @internal */
function isSeekIndicatorAction(action) {
	return action === "seekStep" || action === "seekToPercent";
}
/** @internal */
function formatCurrentTime(snapshot, locale) {
	const options = locale === void 0 ? void 0 : { locale };
	return formatTime(snapshot.currentTime ?? 0, snapshot.duration, options);
}
/** @internal */
function getSeekIndicatorDisplayValue(state) {
	return state.value ?? state.currentTime;
}
/** @internal */
function getSeekToPercent(event) {
	if (event.value !== void 0) return clamp(event.value, 0, 100);
	if (!event.key || event.key < "0" || event.key > "9") return null;
	return Number(event.key) * 10;
}
/** @internal */
function getSeekDirection(event, snapshot) {
	if (event.action === "seekStep" && event.value !== void 0) {
		if (event.value > 0) return "forward";
		if (event.value < 0) return "backward";
	}
	if (event.action === "seekToPercent") {
		const percent = getSeekToPercent(event);
		if (percent === null || snapshot.duration === void 0 || snapshot.duration <= 0) return null;
		const targetTime = percent / 100 * snapshot.duration;
		const currentTime = snapshot.currentTime ?? 0;
		if (targetTime > currentTime) return "forward";
		if (targetTime < currentTime) return "backward";
	}
	return null;
}

//#endregion
//#region ../core/dist/dev/core/ui/seek-indicator/core.js
const INITIAL_STATE = {
	open: false,
	generation: 0,
	direction: null,
	count: 0,
	seekTotal: 0,
	value: null,
	currentTime: "0:00",
	transitionStarting: false,
	transitionEnding: false
};
/** @internal */
var SeekIndicatorCore = class {
	state = createState({ ...INITIAL_STATE });
	#props = {};
	#originTime = null;
	#close = new IndicatorCloseController(() => {
		this.#originTime = null;
		this.state.patch({
			open: false,
			direction: null,
			count: 0,
			seekTotal: 0,
			value: null
		});
	}, () => getIndicatorCloseDelay(this.#props));
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
		if (!isSeekIndicatorAction(event.action)) return false;
		const current = this.state.current;
		const direction = getSeekDirection(event, snapshot);
		const rapidRepeat = current.open && event.action === "seekStep" && current.direction === direction;
		if (!rapidRepeat) this.#originTime = snapshot.currentTime ?? null;
		const value = this.#getEffectiveSeekValue(event, snapshot, rapidRepeat);
		const seekTotal = rapidRepeat ? current.seekTotal + Math.abs(value) : Math.abs(value);
		const label = event.action === "seekStep" && seekTotal > 0 ? new Intl.NumberFormat(this.#props.locale ?? "en", {
			style: "unit",
			unit: "second",
			unitDisplay: isDefaultLocale(this.#props.locale) ? "narrow" : "short",
			useGrouping: false
		}).format(seekTotal) : null;
		this.state.patch({
			open: true,
			generation: current.generation + 1,
			direction,
			count: rapidRepeat ? current.count + 1 : 1,
			seekTotal,
			value: label,
			currentTime: formatCurrentTime(snapshot, this.#props.locale)
		});
		this.#close.arm();
		return true;
	}
	#getEffectiveSeekValue(event, snapshot, rapidRepeat) {
		if (event.action !== "seekStep" || event.value === void 0) return 0;
		if (!rapidRepeat || this.#originTime === null) return event.value;
		const originTime = this.#originTime;
		const duration = snapshot.duration ?? Infinity;
		const currentTotal = this.state.current.seekTotal;
		const step = Math.abs(event.value);
		return (event.value < 0 ? Math.max(0, originTime - currentTotal) : Math.max(0, duration - originTime - currentTotal)) >= step ? event.value : 0;
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/seek-indicator/data.js
/** @internal */
const SeekIndicatorDataAttrs = {
	/** Present while the indicator is open. */
	open: "data-open",
	/** Direction of the seek as `"forward"` or `"backward"`. */
	direction: "data-direction",
	/** Present during the open transition. */
	transitionStarting: "data-starting-style",
	/** Present during the close transition. */
	transitionEnding: "data-ending-style"
};

//#endregion
//#region ../html/dist/dev/ui/seek-indicator/element.js
var SeekIndicatorElement = class extends InputIndicatorElement {
	static {
		this.tagName = "media-seek-indicator";
	}
	static {
		this.properties = { closeDelay: {
			type: Number,
			attribute: "close-delay"
		} };
	}
	#i18n = new I18nController(this, i18nContext);
	#core = new SeekIndicatorCore();
	#transition = createTransition();
	#liveIndicator = new LiveIndicator({
		host: this,
		dataAttrs: SeekIndicatorDataAttrs,
		render: renderSeekIndicator
	});
	get core() {
		return this.#core;
	}
	get transition() {
		return this.#transition;
	}
	get liveIndicator() {
		return this.#liveIndicator;
	}
	syncCoreProps() {
		this.#core.setProps({
			closeDelay: this.closeDelay,
			locale: this.#i18n.locale
		});
	}
};
function renderSeekIndicator(element, state) {
	const value = element.querySelector("media-seek-indicator-value");
	if (!value) return;
	value.textContent = getSeekIndicatorDisplayValue(state);
}

//#endregion
//#region ../html/dist/dev/define/ui/seek-indicator.js
safeDefine(SeekIndicatorElement);

//#endregion
//# sourceMappingURL=seek-indicator.dev.js.map