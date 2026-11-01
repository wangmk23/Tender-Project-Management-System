import { t as shallowEqual } from "./shallow-equal-C7S8rj2f.js";
import { a as createMuxStoryboardURL, i as createMuxPosterURL, n as MuxMetadataLoader, o as createMuxVideoURL, r as toMuxContentData, s as parseMuxVideoURL, t as createMuxDrmSystems } from "./drm-B3v6fR3p.js";

//#region ../adapters/mux-video/dist/dev/spf/mixin.js
/**
* Mux identity over any SPF Media: the structured `source`, the `src` derived from it, and the image URLs it describes.
*
* Everything here is Mux identity, so it carries no engine and both flavors get it unchanged — the video Media over the
* full HLS engine, the audio-only Media over the subtractive one. A mixin rather than a shared base class because each
* flavor extends a different SPF Media, so there is no common class to put this on, only a common `src` accessor to
* write through.
*
* Unlike the hls.js-backed `MuxVideoAdapter`, there is no inherited `source` to delegate to — the SPF Medias know only
* `src` — so this owns the structured source and dispatches `sourcechange` itself.
*
* The metadata Mux publishes for the asset is fetched as soon as a playback ID is known. The hls.js-backed flavor waits
* for its `load()`; SPF has no such step — assigning `src` is the load — so the assignment is the moment here.
*
* @fires sourcechange - Fired when `source` changes, either directly or by parsing a new `src`. Read `source` for the
*   new value.
* @fires contentdatachange - Fired when `contentData` changes: the derived URLs with `source`, and the metadata once it
*   loads. Read `contentData` for the new value.
* @internal
*/
function MuxMixin(BaseClass) {
	class MuxImpl extends BaseClass {
		static {
			this.defaultProps = {
				src: "",
				source: null
			};
		}
		/**
		* Named on the error copy when this engine can't play a source: the hls.js-backed Mux Media plays the MPEG-TS
		* sources that SPF does not, and it backs both `<mux-video>` and `<mux-audio>`.
		*
		* Names the flavor rather than an import path, because one Media is reached through three of them —
		* `@videojs/html`, `@videojs/react`, and this package — and each has a different counterpart. The flavor suffix is
		* the one thing common to the layers a consumer imports elements and components from.
		*/
		static get alternativeMediaSuggestion() {
			return "Try the hls.js-backed Mux media instead: import the `hls-js` flavor in place of the `spf` one.";
		}
		#source = MuxImpl.defaultProps.source;
		#contentData = {};
		#metadata = new MuxMetadataLoader(() => {
			if (this.#refreshContentData()) this.dispatchEvent?.(new Event("contentdatachange"));
		});
		destroy() {
			this.#metadata.destroy();
			super.destroy?.();
		}
		/**
		* Media source URL. Setting a Mux stream URL (`https://stream.mux.com/<playback-id>.m3u8?...`, with or without the
		* `.m3u8` extension) extracts the playback ID and query params into `source`; other URLs are kept as a plain
		* `source.src`.
		*
		* Only playback options carry over. Mux identity comes from the URL, and the signed `poster`, `storyboard`, and
		* `drm` tokens are scoped to a playback ID, so carrying them onto a different source would build rejected URLs.
		*/
		get src() {
			return super.src;
		}
		set src(value) {
			const parsed = parseMuxVideoURL(value);
			if (super.src === (createMuxVideoURL(parsed) ?? value)) return;
			this.source = parsed ?? (value ? { src: value } : null);
		}
		/**
		* Structured Mux source. Setting it derives `src` from the playback ID, custom domain, and `playback` params
		* (appended as `snake_case` query params). A `playback.token` replaces all other params — signed URLs bake them
		* into the token.
		*/
		get source() {
			return this.#source;
		}
		set source(value) {
			const source = value ?? null;
			if (source === this.#source) return;
			this.#source = source;
			this.#metadata.reset(source);
			const contentDataChanged = this.#refreshContentData();
			const { token: _token, ...named } = source?.drm ?? {};
			const drm = {
				...createMuxDrmSystems(source),
				...named
			};
			super.source = source ? {
				src: (createMuxVideoURL(source) ?? source.src) || "",
				...Object.keys(drm).length > 0 && { drm }
			} : null;
			if (contentDataChanged) this.dispatchEvent?.(new Event("contentdatachange"));
			this.#metadata.load();
		}
		/**
		* What `source` says about its content. `poster` and `storyboard` are image URLs it describes rather than plays,
		* from its `poster` and `storyboard` params. `title` and the rest come from the metadata Mux publishes for the
		* asset, which loads with the source, so they arrive later than the URLs and are absent until then.
		*
		* The same object is handed back until something in it changes, and `contentdatachange` announces it when it does.
		* Nothing here is applied for you.
		*/
		get contentData() {
			return this.#contentData;
		}
		/** Rebuild the bag from `source` and the metadata, reporting whether anything about it changed. */
		#refreshContentData() {
			const poster = createMuxPosterURL(this.#source);
			const storyboard = createMuxStoryboardURL(this.#source);
			const next = {
				...toMuxContentData(this.#metadata.metadata),
				...poster && { poster },
				...storyboard && { storyboard }
			};
			if (shallowEqual(this.#contentData, next)) return false;
			this.#contentData = next;
			return true;
		}
	}
	return MuxImpl;
}

//#endregion
export { MuxMixin as t };
//# sourceMappingURL=mixin-CUfVgYXU.js.map