import { t as shallowEqual } from "./shallow-equal-C7S8rj2f.js";
import { t as HlsJsAdapter } from "./adapter-BB46Wc2D.js";
import { a as createMuxStoryboardURL, i as createMuxPosterURL, n as MuxMetadataLoader, o as createMuxVideoURL, r as toMuxContentData, s as parseMuxVideoURL, t as createMuxDrmSystems } from "./drm-B3v6fR3p.js";

//#region ../adapters/mux-video/dist/dev/adapter.js
/**
* @fires sourcechange - Fired when `source` changes, either directly or by parsing a new `src`. Read `source` for the
*   new value.
* @fires contentdatachange - Fired when `contentData` changes: the derived URLs with `source`, and the metadata once it
*   loads. Read `contentData` for the new value.
*/
var MuxVideoAdapter = class MuxVideoAdapter extends HlsJsAdapter {
	static {
		this.defaultProps = {
			...HlsJsAdapter.defaultProps,
			src: "",
			source: null
		};
	}
	#source = MuxVideoAdapter.defaultProps.source;
	#contentData = {};
	#metadata = new MuxMetadataLoader(() => {
		if (this.#refreshContentData()) this.dispatchEvent(new Event("contentdatachange"));
	});
	destroy() {
		this.#metadata.destroy();
		super.destroy();
	}
	/**
	* Media source URL. Setting a Mux stream URL (`https://stream.mux.com/<playback-id>.m3u8?...`, with or without the
	* `.m3u8` extension) extracts the playback ID and query params into `source`; other URLs are kept as a plain
	* `source.src`.
	*
	* Only playback options carry over. Mux identity comes from the URL, and the signed `poster`, `storyboard`, and `drm`
	* tokens are scoped to a playback ID, so carrying them onto a different source would build rejected URLs.
	*/
	get src() {
		return super.src;
	}
	set src(value) {
		const parsed = parseMuxVideoURL(value);
		if (super.src === (createMuxVideoURL(parsed) ?? value)) return;
		const { type, preferPlayback, engine, maxAutoResolution, capRenditionToPlayerSize, minAutoResolution } = this.#source ?? {};
		const source = {
			...type && { type },
			...preferPlayback && { preferPlayback },
			...engine && { engine },
			...maxAutoResolution && { maxAutoResolution },
			...capRenditionToPlayerSize !== void 0 && { capRenditionToPlayerSize },
			...minAutoResolution && { minAutoResolution },
			...parsed ?? (value ? { src: value } : null)
		};
		this.source = Object.keys(source).length > 0 ? source : null;
	}
	/**
	* Structured Mux source. Setting it derives `src` from the playback ID, custom domain, and `playback` params
	* (appended as `snake_case` query params). A `playback.token` replaces all other params — signed URLs bake them into
	* the token. Engine options live under `engine`.
	*
	* A `drm.token` fills in `drm` itself: Mux's FairPlay, Widevine, and PlayReady license servers for this playback ID,
	* so protected media plays whichever path the browser takes. License servers named alongside the token win, key by
	* key, for content Mux does not license.
	*
	* `playback.maxResolution` and `playback.minResolution` are server-side: they decide which renditions Mux puts in the
	* manifest at all. The inherited `maxAutoResolution` and `minAutoResolution` only look like their pair — those are
	* client-side and bound which of the renditions that _do_ arrive adaptive selection reaches for. The two halves are
	* independent.
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
		super.source = source && {
			...source,
			src: createMuxVideoURL(source) ?? source.src ?? "",
			...withMuxDrm(source)
		};
		if (contentDataChanged) this.dispatchEvent(new Event("contentdatachange"));
	}
	/**
	* What `source` says about its content. `poster` and `storyboard` are image URLs it describes rather than plays, from
	* its `poster` and `storyboard` params; a key is absent when the URL can't be built — no playback ID, or signed
	* playback without a matching image token. `title` and the rest come from the metadata Mux publishes for the asset,
	* which loads with the source, so they arrive later than the URLs and are absent until then.
	*
	* The same object is handed back until something in it changes, and `contentdatachange` announces it when it does.
	* Nothing here is applied for you, apart from the thumbnail track `<mux-video>` adds from `storyboard` (and drops for
	* live streams).
	*/
	get contentData() {
		return this.#contentData;
	}
	load() {
		const loading = super.load();
		this.#metadata.load();
		return loading;
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
};
/**
* Resolve Mux's DRM authoring input into the license servers the HLS layer licenses from. Which engine ends up playing
* is decided later, and both read `drm`, so a signed Mux source plays either way.
*
* `token` is Mux's own input and stops here — it names no license server, and a key system is what everything
* downstream expects to find. Servers the caller named win, key by key, so their own licensing replaces the derived
* URLs.
*/
function withMuxDrm(source) {
	const { token: _token, ...systems } = source.drm ?? {};
	const drm = {
		...createMuxDrmSystems(source),
		...systems
	};
	return { drm: Object.keys(drm).length > 0 ? drm : void 0 };
}

//#endregion
export { MuxVideoAdapter as t };
//# sourceMappingURL=adapter-B6PUbU6H.js.map