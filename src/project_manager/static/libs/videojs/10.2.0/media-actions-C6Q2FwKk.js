import { u as isPromise } from "./predicate-3rF1m2uv.js";
import { y as getMediaInputActionValue } from "./volume-aFyxrX8a.js";
import { t as noop } from "./noop-DBLxABor.js";
import { a as selectFullscreen, c as selectPiP, h as selectVolume, l as selectPlayback, m as selectTime, u as selectPlaybackRate } from "./selectors-B0umcXKn.js";

//#region ../core/dist/dev/dom/media-actions.js
/** Swallow a rejected promise, since input actions have no caller to report it to. */
function ignoreRejection(result) {
	if (isPromise(result)) result.catch(noop);
}
const MEDIA_INPUT_ACTION_OVERRIDES = {
	togglePaused({ store }) {
		const playback = selectPlayback(store.state);
		if (!playback) return;
		ignoreRejection(playback.paused ? playback.play() : playback.pause());
	},
	toggleMuted({ store }) {
		const volume = selectVolume(store.state);
		if (!volume) return;
		volume.setMuted(!(volume.muted || volume.volume === 0));
	},
	toggleFullscreen({ store }) {
		const fullscreen = selectFullscreen(store.state);
		if (!fullscreen) return;
		ignoreRejection(fullscreen.isFullscreen ? fullscreen.exitFullscreen() : fullscreen.requestFullscreen());
	},
	togglePictureInPicture({ store }) {
		const pip = selectPiP(store.state);
		if (!pip) return;
		ignoreRejection(pip.isPictureInPicture ? pip.exitPictureInPicture() : pip.requestPictureInPicture());
	},
	seekStep({ store, value, key }) {
		const step = getMediaInputActionValue("seekStep", key, value);
		const time = selectTime(store.state);
		if (!time) return;
		time.seek(time.currentTime + step);
	},
	volumeStep({ store, value, key }) {
		const step = getMediaInputActionValue("volumeStep", key, value);
		const vol = selectVolume(store.state);
		if (!vol) return;
		vol.setVolume(vol.volume + step);
	},
	speedUp({ store }) {
		const rate = selectPlaybackRate(store.state);
		if (!rate) return;
		const { playbackRates, playbackRate } = rate;
		const idx = playbackRates.indexOf(playbackRate);
		const next = idx < 0 || idx >= playbackRates.length - 1 ? 0 : idx + 1;
		rate.setPlaybackRate(playbackRates[next]);
	},
	speedDown({ store }) {
		const rate = selectPlaybackRate(store.state);
		if (!rate) return;
		const { playbackRates, playbackRate } = rate;
		const idx = playbackRates.indexOf(playbackRate);
		const next = idx <= 0 ? playbackRates.length - 1 : idx - 1;
		rate.setPlaybackRate(playbackRates[next]);
	}
};

//#endregion
export { ignoreRejection as n, MEDIA_INPUT_ACTION_OVERRIDES as t };
//# sourceMappingURL=media-actions-C6Q2FwKk.js.map