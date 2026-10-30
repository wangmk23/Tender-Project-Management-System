import { i as isFunction } from "./predicate-3rF1m2uv.js";
import { t as HTMLMediaAdapter } from "./html-media-adapter-GddOWzPG.js";

//#region ../media/dist/dev/dom/html-video-adapter/html-video-adapter.js
var HTMLVideoAdapter = class extends HTMLMediaAdapter {
	get poster() {
		return this.target?.poster ?? "";
	}
	set poster(value) {
		if (this.target) this.target.poster = value;
	}
	get playsInline() {
		return this.target?.playsInline ?? false;
	}
	set playsInline(value) {
		if (this.target) this.target.playsInline = value;
	}
	get videoWidth() {
		return this.target?.videoWidth ?? 0;
	}
	get videoHeight() {
		return this.target?.videoHeight ?? 0;
	}
	get disablePictureInPicture() {
		return this.target?.disablePictureInPicture ?? false;
	}
	set disablePictureInPicture(value) {
		if (this.target) this.target.disablePictureInPicture = value;
	}
	get webkitCurrentPlaybackTargetIsWireless() {
		return this.target?.webkitCurrentPlaybackTargetIsWireless;
	}
	get webkitPresentationMode() {
		return this.target?.webkitPresentationMode;
	}
	get webkitSetPresentationMode() {
		const target = this.target;
		const fn = target?.webkitSetPresentationMode;
		return isFunction(fn) ? fn.bind(target) : void 0;
	}
	get isPictureInPicture() {
		const el = this.target;
		return !!el && globalThis.document?.pictureInPictureElement === el || this.webkitPresentationMode === "picture-in-picture";
	}
	get isFullscreen() {
		const el = this.target;
		if (!el) return false;
		if (this.webkitPresentationMode === "fullscreen") return true;
		const doc = globalThis.document;
		return doc?.fullscreenElement === el || doc?.webkitFullscreenElement === el;
	}
	async requestPictureInPicture() {
		if (!this.target) return Promise.reject();
		return this.target.requestPictureInPicture();
	}
	async exitPictureInPicture() {
		if (!this.target) return Promise.reject();
		return globalThis.document?.exitPictureInPicture();
	}
	requestFullscreen() {
		if (!this.target) return Promise.reject();
		return this.target.requestFullscreen();
	}
	exitFullscreen() {
		if (!this.target) return Promise.reject();
		return globalThis.document?.exitFullscreen();
	}
};

//#endregion
export { HTMLVideoAdapter as t };
//# sourceMappingURL=html-video-adapter-ClZq4auT.js.map