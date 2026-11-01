import { t as translateText } from "./translate-text-4JIqxuMT.js";
import { t as clamp } from "./number-D2skb7-A.js";
import { n as exitText } from "./fullscreen-D5y_lZYB.js";
import { n as mutedText, t as labelText } from "./volume-DQ178W9h.js";

//#region ../core/dist/dev/i18n/text/status.js
const prefix = "status.";
const captionsOnText = {
	key: `${prefix}captionsOn`,
	text: "Captions on"
};
const captionsOffText = {
	key: `${prefix}captionsOff`,
	text: "Captions off"
};
const pausedText = {
	key: `${prefix}paused`,
	text: "Paused"
};
const playingText = {
	key: `${prefix}playing`,
	text: "Playing"
};
const fullscreenText = {
	key: `${prefix}fullscreen`,
	text: "Fullscreen"
};
const pipText = {
	key: `${prefix}pip`,
	text: "Picture in picture"
};
const exitPipText = {
	key: `${prefix}exitPip`,
	text: "Exit picture in picture"
};
const seekedToText = {
	key: `${prefix}seekedTo`,
	text: "Seeked to {time}"
};

//#endregion
//#region ../core/dist/dev/core/ui/indicator/labels.js
/** @internal */
const DEFAULT_INPUT_INDICATOR_LABELS = {
	muted: translateText(mutedText),
	volume: translateText(labelText),
	captionsOn: translateText(captionsOnText),
	captionsOff: translateText(captionsOffText),
	paused: translateText(pausedText),
	playing: translateText(playingText),
	fullscreen: translateText(fullscreenText),
	exitFullscreen: translateText(exitText),
	pictureInPicture: translateText(pipText),
	exitPictureInPicture: translateText(exitPipText)
};
/**
* Maps i18n indicator keys to {@link InputIndicatorLabels} for status / volume feedback.
*
* @internal
*/
function createInputIndicatorLabels(translator) {
	return {
		muted: translator(mutedText),
		volume: translator(labelText),
		captionsOn: translator(captionsOnText),
		captionsOff: translator(captionsOffText),
		paused: translator(pausedText),
		playing: translator(playingText),
		fullscreen: translator(fullscreenText),
		exitFullscreen: translator(exitText),
		pictureInPicture: translator(pipText),
		exitPictureInPicture: translator(exitPipText)
	};
}

//#endregion
//#region ../core/dist/dev/core/ui/volume-indicator/status.js
/** @internal */
function isVolumeIndicatorAction(action) {
	return action === "toggleMuted" || action === "volumeStep";
}
/** @internal */
function getVolumeLevel(volume) {
	if (volume <= 0) return "off";
	return volume <= .5 ? "low" : "high";
}
/** @internal */
function formatVolumeValue(volume) {
	return `${Math.round(clamp(volume, 0, 1) * 100)}%`;
}
/** @internal */
function getVolumeIndicatorDisplayValue(state) {
	return state.value ?? "";
}
/**
* Predicted mute/volume after a volume-indicator action.
*
* @internal
*/
function predictVolumeActionOutcome(event, snapshot) {
	const muted = snapshot.muted === true;
	const snapshotVolume = snapshot.volume ?? 0;
	if (event.action === "toggleMuted") return {
		snapshotVolume,
		nextMuted: !muted,
		nextVolume: snapshotVolume
	};
	if (event.action === "volumeStep") {
		const nextVolume = clamp(snapshotVolume + (event.value ?? 0), 0, 1);
		return {
			snapshotVolume,
			nextMuted: muted && nextVolume <= 0,
			nextVolume
		};
	}
	return {
		snapshotVolume,
		nextMuted: muted,
		nextVolume: snapshotVolume
	};
}
/**
* Labels/value/level for volume actions, shared with `StatusIndicatorCore`.
*
* @internal
*/
function deriveVolumeStatus(event, snapshot, labels = DEFAULT_INPUT_INDICATOR_LABELS, cachedPrediction) {
	const prediction = cachedPrediction ?? predictVolumeActionOutcome(event, snapshot);
	const level = prediction.nextMuted ? "off" : getVolumeLevel(prediction.nextVolume);
	const value = prediction.nextMuted ? "0%" : formatVolumeValue(prediction.nextVolume);
	return {
		status: level === "off" ? "volume-off" : level === "low" ? "volume-low" : "volume-high",
		label: level === "off" ? labels.muted : labels.volume,
		value,
		volumeLevel: level
	};
}

//#endregion
export { predictVolumeActionOutcome as a, seekedToText as c, isVolumeIndicatorAction as i, formatVolumeValue as n, DEFAULT_INPUT_INDICATOR_LABELS as o, getVolumeIndicatorDisplayValue as r, createInputIndicatorLabels as s, deriveVolumeStatus as t };
//# sourceMappingURL=status-DsZydvT8.js.map