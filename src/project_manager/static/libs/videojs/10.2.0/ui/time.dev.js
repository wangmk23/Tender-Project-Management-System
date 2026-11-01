/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { D as isInteractiveActivation } from "../volume-aFyxrX8a.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { r as hasTimeRange, t as getTimeRangeEnd } from "../predicate-VHPnHoui.js";
import { m as selectTime, n as selectBuffer } from "../selectors-B0umcXKn.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { n as formatTimeAsPhrase, r as secondsToIsoDuration, t as formatTime } from "../format-Dhaf9oDP.js";
import { c as showDurationText, d as toggleDurationText, f as toggleElapsedText, i as elapsedSuffixText, l as showElapsedText, n as durationSuffixText, o as remainingSuffixText, p as unknownText, r as durationText, s as remainingText, t as currentText, u as showRemainingText } from "../time-e6HJCQ4C.js";
import { translateText } from "../i18n.dev.js";

//#region ../core/dist/dev/core/ui/time/core.js
const TOGGLE_LABELS = {
	current: showElapsedText,
	duration: showDurationText,
	remaining: showRemainingText
};
const DEFAULT_LABELS = {
	current: currentText,
	duration: durationText,
	remaining: remainingText
};
const TOGGLE_DESCRIPTIONS = {
	current: toggleElapsedText,
	duration: toggleDurationText,
	remaining: toggleDurationText
};
/** @internal */
var TimeCore = class TimeCore {
	static defaultProps = {
		type: "current",
		negativeSign: "-",
		label: "",
		toggle: false
	};
	#props = { ...TimeCore.defaultProps };
	#media = null;
	#formatLocale;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, TimeCore.defaultProps);
	}
	setMedia(media) {
		this.#media = media;
	}
	/** @internal Platform adapters set the active i18n locale for digital time formatting. */
	setFormatLocale(locale) {
		this.#formatLocale = locale;
	}
	#getSeconds() {
		const media = this.#media;
		const duration = getTimeRangeEnd(media);
		const { type } = this.#props;
		switch (type) {
			case "current": return media.currentTime;
			case "duration": return duration;
			case "remaining": return media.currentTime - duration;
			default: return 0;
		}
	}
	#getText() {
		const media = this.#media;
		const seconds = this.#getSeconds();
		const duration = getTimeRangeEnd(media);
		const options = this.#formatLocale === void 0 ? void 0 : { locale: this.#formatLocale };
		return formatTime(Math.abs(seconds), duration, options);
	}
	#getPhrase() {
		const { type } = this.#props;
		const seconds = this.#getSeconds();
		if (type === "remaining") return formatTimeAsPhrase(seconds < 0 ? seconds : -Math.abs(seconds));
		return formatTimeAsPhrase(seconds);
	}
	#getDatetime() {
		const seconds = this.#getSeconds();
		return secondsToIsoDuration(Math.abs(seconds));
	}
	#getToggleType(type, currentType) {
		if (type === "current") return currentType === "remaining" ? "current" : "remaining";
		return currentType === "duration" ? "remaining" : "duration";
	}
	getLabel(state, type = this.#props.type) {
		const custom = resolveLabel(this.#props.label, state);
		if (custom !== void 0) return custom;
		if (state.disabled || state.unavailable) return unknownText;
		if (!this.#props.toggle) return DEFAULT_LABELS[this.#props.type];
		const toggleType = this.#getToggleType(type, state.type);
		return TOGGLE_LABELS[toggleType];
	}
	getLabelParams(state) {
		if (resolveLabel(this.#props.label, state) !== void 0 || state.disabled || !this.#props.toggle) return void 0;
		const options = this.#formatLocale === void 0 ? void 0 : { locale: this.#formatLocale };
		const duration = formatTimeAsPhrase(Math.abs(state.seconds), options);
		switch (state.type) {
			case "current": return { duration: `${duration} elapsed` };
			case "duration": return { duration: `${duration} duration` };
			case "remaining": return { duration: `${duration} remaining` };
		}
	}
	getDescription(state, type = this.#props.type) {
		return this.#props.toggle && !state.disabled ? TOGGLE_DESCRIPTIONS[type] : void 0;
	}
	getAttrs(state, type = this.#props.type) {
		return {
			"aria-label": this.getLabel(state, type),
			"aria-description": this.getDescription(state, type),
			"aria-disabled": this.#props.toggle && state.disabled ? "true" : void 0,
			role: this.#props.toggle ? "button" : void 0,
			tabIndex: this.#props.toggle ? state.disabled ? -1 : 0 : void 0
		};
	}
	getState() {
		const seconds = this.#getSeconds();
		const unavailable = !hasTimeRange(this.#media);
		return {
			type: this.#props.type,
			disabled: this.#props.toggle && unavailable,
			unavailable: !this.#props.toggle && unavailable,
			seconds,
			negative: this.#props.type === "remaining" && seconds < 0,
			text: this.#getText(),
			phrase: this.#getPhrase(),
			datetime: this.#getDatetime()
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/time/data.js
/** @internal */
const TimeDataAttrs = {
	/** The type of time being displayed. */
	type: "data-type",
	/** Present when the time toggle is disabled. */
	disabled: "data-disabled",
	/** Present when the non-interactive time value is unavailable. */
	unavailable: "data-unavailable"
};

//#endregion
//#region ../html/dist/dev/ui/time/element.js
var TimeElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.type = TimeCore.defaultProps.type;
		this.negativeSign = TimeCore.defaultProps.negativeSign;
		this.label = "";
		this.toggle = TimeCore.defaultProps.toggle;
		this.#core = new TimeCore();
		this.#state = new PlayerController(this, playerContext, selectTime);
		this.#buffer = new PlayerController(this, playerContext, selectBuffer);
		this.#i18n = new I18nController(this, i18nContext);
		this.#signSpan = document.createElement("span");
		this.#textNode = new Text();
		this.#disconnect = null;
		this.#listening = false;
		this.#activeType = TimeCore.defaultProps.type;
		this.#handleClick = (event) => {
			if (event.defaultPrevented || !this.toggle || !this.#state.value || !this.#hasTimeRange()) return;
			this.#toggleType();
		};
		this.#handleKeyDown = (event) => {
			if (event.defaultPrevented || !isInteractiveActivation(event)) return;
			if (!this.toggle || !this.#state.value || !this.#hasTimeRange()) return;
			event.preventDefault();
			if (event.repeat) return;
			this.#toggleType();
		};
	}
	static {
		this.tagName = "media-time";
	}
	static {
		this.properties = {
			type: { type: String },
			negativeSign: {
				type: String,
				attribute: "negative-sign"
			},
			label: { type: String },
			toggle: { type: Boolean }
		};
	}
	#core;
	#state;
	#buffer;
	#i18n;
	#signSpan;
	#textNode;
	#disconnect;
	#listening;
	#activeType;
	connectedCallback() {
		super.connectedCallback();
		this.#disconnect = new AbortController();
		this.#syncListeners();
		if (!this.#signSpan.parentNode) {
			this.#signSpan.setAttribute("aria-hidden", "true");
			this.#signSpan.hidden = true;
			this.append(this.#signSpan, this.#textNode);
		}
		if (!this.#state.value) logMissingFeature(this.localName, this.#state.displayName);
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
		this.#listening = false;
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		if (changed.has("type") || changed.has("toggle")) this.#activeType = this.type;
	}
	update(changed) {
		super.update(changed);
		if (changed.has("toggle")) this.#syncListeners();
		const media = this.#state.value;
		if (!media) {
			this.#clearAttrs();
			return;
		}
		this.#core.setProps({
			type: this.toggle ? this.#activeType : this.type,
			negativeSign: this.negativeSign,
			label: this.label,
			toggle: this.toggle
		});
		this.#core.setMedia({
			...media,
			seekable: this.#buffer.value?.seekable ?? []
		});
		this.#core.setFormatLocale(this.#i18n.locale);
		const state = this.#core.getState();
		this.#signSpan.hidden = !state.negative;
		this.#signSpan.textContent = state.negative ? this.negativeSign : "";
		this.#textNode.textContent = state.text;
		const attrs = this.#core.getAttrs(state, this.type);
		const label = translateText(attrs["aria-label"], this.#i18n.value, this.#getLabelParams(state));
		const description = attrs["aria-description"] ? translateText(attrs["aria-description"], this.#i18n.value) : void 0;
		applyElementProps(this, {
			"aria-label": label,
			"aria-description": description,
			"aria-disabled": attrs["aria-disabled"],
			role: this.toggle ? attrs.role : "time",
			tabIndex: attrs.tabIndex,
			datetime: this.toggle || state.unavailable ? void 0 : state.datetime
		});
		applyStateDataAttrs(this, state, TimeDataAttrs);
	}
	#getLabelParams(state) {
		if (!this.#core.getLabelParams(state)) return void 0;
		const duration = formatTimeAsPhrase(Math.abs(state.seconds), { locale: this.#i18n.locale });
		const text = {
			current: elapsedSuffixText,
			duration: durationSuffixText,
			remaining: remainingSuffixText
		}[state.type];
		return { duration: translateText(text, this.#i18n.value, { duration }) };
	}
	#handleClick;
	#handleKeyDown;
	#toggleType() {
		if (this.type === "current") this.#activeType = this.#activeType === "remaining" ? "current" : "remaining";
		else this.#activeType = this.#activeType === "duration" ? "remaining" : "duration";
		this.requestUpdate();
	}
	#hasTimeRange() {
		const media = this.#state.value;
		if (!media) return false;
		return hasTimeRange({
			...media,
			seekable: this.#buffer.value?.seekable ?? []
		});
	}
	#syncListeners() {
		if (!this.toggle || !this.#disconnect || this.#listening) return;
		this.#listening = true;
		applyElementProps(this, {
			onClick: this.#handleClick,
			onKeyDown: this.#handleKeyDown
		}, { signal: this.#disconnect.signal });
	}
	#clearAttrs() {
		applyElementProps(this, {
			"aria-label": void 0,
			"aria-description": void 0,
			"aria-disabled": void 0,
			role: void 0,
			tabIndex: void 0,
			datetime: void 0,
			"data-type": void 0,
			"data-disabled": void 0,
			"data-unavailable": void 0
		});
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/time.js
safeDefine(TimeElement);

//#endregion
//# sourceMappingURL=time.dev.js.map