/*! Video.js | https://videojs.org/help */
import { s as DEFAULT_LOCALE } from "../i18n-ByQGZLGb.js";
import { t as translateText } from "../translate-text-4JIqxuMT.js";
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as isDocument } from "../predicates-C_TReuAB.js";
import { t as getDeepActiveElement } from "../focus-CkXNMiCg.js";
import { t as containsComposed } from "../tree-idPlGAlz.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext, t as containerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { a as getIndicatorCloseDelay, i as IndicatorCloseController, n as getMediaSnapshot } from "../input-action-DMBaa6h-.js";
import { c as seekedToText, n as formatVolumeValue, o as DEFAULT_INPUT_INDICATOR_LABELS, s as createInputIndicatorLabels } from "../status-DsZydvT8.js";
import { i as valueText } from "../volume-DQ178W9h.js";
import { t as rateText } from "../playback-DeBAVfsg.js";
import { n as formatTimeAsPhrase } from "../format-Dhaf9oDP.js";

//#region ../core/dist/dev/dom/ui/slider/focus.js
/** @internal */
function isSliderFocused(root = document) {
	const doc = isDocument(root) ? root : root.ownerDocument;
	const active = getDeepActiveElement(doc);
	if (active?.getAttribute("role") !== "slider") return false;
	return isDocument(root) || containsComposed(root, active);
}

//#endregion
//#region ../core/dist/dev/dom/ui/status-announcer.js
/** @internal */
function subscribeToStatusAnnouncer(store, core) {
	let active = true;
	let pending = false;
	let target = store.target;
	let revision = 0;
	const baseline = () => {
		target = store.target;
		pending = true;
		const current = ++revision;
		core.resetSnapshot();
		queueMicrotask(() => {
			if (!active || current !== revision) return;
			pending = false;
			target = store.target;
			if (target) core.processSnapshot(getMediaSnapshot(store));
		});
	};
	const unsubscribe = store.subscribe(() => {
		const nextTarget = store.target;
		if (nextTarget !== target) {
			baseline();
			return;
		}
		if (!nextTarget || pending) return;
		core.processSnapshot(getMediaSnapshot(store));
	});
	baseline();
	return () => {
		active = false;
		unsubscribe();
	};
}
/** @internal */
function shouldAnnounceStatusChange(container) {
	return !container || !isSliderFocused(container);
}

//#endregion
//#region ../core/dist/dev/core/ui/status-announcer/labels.js
/**
* Default English labels used when no translated labels are provided.
*
* @internal
*/
const DEFAULT_STATUS_ANNOUNCER_LABELS = {
	...DEFAULT_INPUT_INDICATOR_LABELS,
	volumeWithValue: (value) => translateText(valueText, { value }),
	seekedTo: (time) => translateText(seekedToText, { time: formatTimeAsPhrase(time) }),
	playbackRate: (rate) => translateText(rateText, { rate })
};
/**
* Creates translated labels for status, volume, seek, and playback-rate announcements.
*
* @internal
*/
function createStatusAnnouncerLabels(translator, locale = "en") {
	return {
		...createInputIndicatorLabels(translator),
		volumeWithValue: (value) => translator(valueText, { value }),
		seekedTo: (time) => translator(seekedToText, { time: formatTimeAsPhrase(time, { locale }) }),
		playbackRate: (rate) => translator(rateText, { rate })
	};
}

//#endregion
//#region ../core/dist/dev/core/ui/status-announcer/status.js
/**
* Derives the immediate announcement for changed playback, captions, presentation, and playback-rate state.
*
* @internal
*/
function deriveStatusAnnouncement(previous, snapshot, labels = DEFAULT_STATUS_ANNOUNCER_LABELS) {
	const announcements = [];
	if (hasChanged(previous.paused, snapshot.paused)) announcements.push(snapshot.paused ? labels.paused : labels.playing);
	if (hasChanged(previous.subtitlesShowing, snapshot.subtitlesShowing) && snapshot.subtitlesAvailable !== false) announcements.push(snapshot.subtitlesShowing ? labels.captionsOn : labels.captionsOff);
	if (hasChanged(previous.isFullscreen, snapshot.isFullscreen)) announcements.push(snapshot.isFullscreen ? labels.fullscreen : labels.exitFullscreen);
	if (hasChanged(previous.isPictureInPicture, snapshot.isPictureInPicture)) announcements.push(snapshot.isPictureInPicture ? labels.pictureInPicture : labels.exitPictureInPicture);
	if (hasChanged(previous.playbackRate, snapshot.playbackRate)) announcements.push(labels.playbackRate(`${snapshot.playbackRate}×`));
	return announcements.length > 0 ? announcements.join(". ") : null;
}
/**
* Derives the announcement for changed volume or mute state.
*
* @internal
*/
function deriveVolumeAnnouncement(previous, snapshot, labels = DEFAULT_STATUS_ANNOUNCER_LABELS) {
	if (!hasChanged(previous.volume, snapshot.volume) && !hasChanged(previous.muted, snapshot.muted)) return null;
	const volume = snapshot.volume ?? previous.volume;
	const muted = snapshot.muted ?? previous.muted;
	if (volume === void 0 && muted === void 0) return null;
	return muted || (volume ?? 0) <= 0 ? labels.muted : labels.volumeWithValue(formatVolumeValue(volume ?? 0));
}
function hasChanged(previous, next) {
	return previous !== void 0 && next !== void 0 && !Object.is(previous, next);
}

//#endregion
//#region ../core/dist/dev/core/ui/status-announcer/core.js
const ANNOUNCEMENT_DEBOUNCE = 200;
/** @internal */
var StatusAnnouncerCore = class {
	state = createState({
		generation: 0,
		label: null
	});
	#props = {};
	#snapshot = null;
	#seekStartTime = null;
	#seekTargetTime = null;
	#timer = null;
	#close = new IndicatorCloseController(() => this.state.patch({ label: null }), () => getIndicatorCloseDelay(this.#props));
	setProps(props) {
		this.#props = props;
	}
	resetSnapshot() {
		this.#snapshot = null;
		this.#seekStartTime = null;
		this.#seekTargetTime = null;
		this.#clearTimer();
		this.#close.close();
	}
	destroy() {
		this.#clearTimer();
		this.#close.destroy();
	}
	processSnapshot(snapshot) {
		const previous = this.#snapshot;
		this.#snapshot = snapshot;
		if (!previous) return false;
		const labels = this.#getLabels();
		const statusLabel = deriveStatusAnnouncement(previous, snapshot, labels);
		const statusHandled = statusLabel !== null && this.#announce(statusLabel);
		const seekHandled = this.#processSeekSnapshot(previous, snapshot, labels, statusHandled);
		const volumeHandled = this.#processVolumeSnapshot(previous, snapshot, labels, statusHandled || seekHandled);
		return statusHandled || seekHandled || volumeHandled;
	}
	#getLabels() {
		return {
			...DEFAULT_STATUS_ANNOUNCER_LABELS,
			...this.#props.labels
		};
	}
	#announce(label) {
		this.#clearTimer();
		this.state.patch({
			generation: this.state.current.generation + 1,
			label
		});
		this.#close.arm();
		return true;
	}
	#processVolumeSnapshot(previous, snapshot, labels, alreadyHandled) {
		const label = deriveVolumeAnnouncement(previous, snapshot, labels);
		if (label === null || alreadyHandled || !this.#shouldAnnounce()) return false;
		this.#schedule(label);
		return true;
	}
	#processSeekSnapshot(previous, snapshot, labels, alreadyHandled) {
		if (previous.seeking !== true && snapshot.seeking === true) {
			this.#seekStartTime = previous.currentTime ?? null;
			this.#seekTargetTime = snapshot.currentTime ?? null;
			this.#clearTimer();
			return false;
		}
		if (snapshot.seeking === true) {
			this.#seekTargetTime = snapshot.currentTime ?? this.#seekTargetTime;
			return false;
		}
		if (previous.seeking !== true || snapshot.seeking !== false) return false;
		const targetTime = snapshot.currentTime ?? this.#seekTargetTime;
		const startTime = this.#seekStartTime;
		this.#seekStartTime = null;
		this.#seekTargetTime = null;
		if (targetTime === void 0 || targetTime === null || Object.is(targetTime, startTime)) return false;
		if (alreadyHandled || !this.#shouldAnnounce()) return false;
		this.#schedule(labels.seekedTo(targetTime));
		return true;
	}
	#schedule(label) {
		this.#clearTimer();
		this.#timer = setTimeout(() => {
			this.#timer = null;
			if (!this.#shouldAnnounce()) return;
			this.#announce(label);
		}, ANNOUNCEMENT_DEBOUNCE);
	}
	#shouldAnnounce() {
		return this.#props.shouldAnnounce?.() !== false;
	}
	#clearTimer() {
		if (this.#timer === null) return;
		clearTimeout(this.#timer);
		this.#timer = null;
	}
};

//#endregion
//#region ../html/dist/dev/ui/status-announcer/element.js
var StatusAnnouncerElement = class extends UIElement {
	static {
		this.tagName = "media-status-announcer";
	}
	static {
		this.properties = { closeDelay: {
			type: Number,
			attribute: "close-delay"
		} };
	}
	#i18n = new I18nController(this, i18nContext);
	#core = new StatusAnnouncerCore();
	#storeUnsubscribe = null;
	#player = new ContextConsumer(this, {
		context: playerContext,
		callback: (store) => this.#reconnect(store),
		subscribe: true
	});
	#container = new ContextConsumer(this, {
		context: containerContext,
		subscribe: true
	});
	#disconnect = null;
	#liveText = null;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.setAttribute("role", "status");
		this.#ensureLiveText();
		this.#disconnect = new AbortController();
		this.#core.state.subscribe(() => this.requestUpdate(), { signal: this.#disconnect.signal });
		this.#reconnect();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#storeUnsubscribe?.();
		this.#storeUnsubscribe = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	destroyCallback() {
		this.#storeUnsubscribe?.();
		this.#core.destroy();
		super.destroyCallback();
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		this.#core.setProps({
			closeDelay: this.closeDelay,
			labels: createStatusAnnouncerLabels(this.#i18n.value, this.#i18n.locale),
			shouldAnnounce: () => shouldAnnounceStatusChange(this.#container.value?.container)
		});
	}
	update(changed) {
		super.update(changed);
		const label = this.#core.state.current.label;
		const liveText = this.#ensureLiveText();
		if (label === null) liveText.replaceChildren();
		else liveText.replaceChildren(document.createTextNode(label));
	}
	#reconnect(store = this.#player.value) {
		this.#storeUnsubscribe?.();
		this.#storeUnsubscribe = null;
		if (!store) {
			this.#core.resetSnapshot();
			return;
		}
		this.#storeUnsubscribe = subscribeToStatusAnnouncer(store, this.#core);
	}
	#ensureLiveText() {
		if (this.#liveText?.isConnected) return this.#liveText;
		const existing = this.querySelector("[data-status-announcer-content]");
		this.#liveText = existing ?? document.createElement("span");
		this.#liveText.setAttribute("data-status-announcer-content", "");
		if (!existing) this.append(this.#liveText);
		return this.#liveText;
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/status-announcer.js
safeDefine(StatusAnnouncerElement);

//#endregion
//# sourceMappingURL=status-announcer.dev.js.map