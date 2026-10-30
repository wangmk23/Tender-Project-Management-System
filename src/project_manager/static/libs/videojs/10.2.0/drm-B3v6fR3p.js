import { a as isNil, d as isString, l as isPlainObject } from "./predicate-3rF1m2uv.js";
import { r as snakeCase, t as camelCase } from "./casing-4lg59-o1.js";

//#region ../utils/dist/jwt/parse-jwt.js
/**
* Decode the payload of a JWT without verifying its signature, `undefined` for malformed tokens.
*
* @internal
*/
function parseJwt(token) {
	const base64Url = (token ?? "").split(".")[1];
	if (!base64Url) return void 0;
	try {
		const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
		const json = decodeURIComponent(atob(base64).split("").map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`).join(""));
		return JSON.parse(json);
	} catch {
		return;
	}
}

//#endregion
//#region ../adapters/mux-video/dist/dev/mux/dist/default/source.js
/**
* The Mux source: playback identity, the params that modify it, and the URLs derived from both. Engine-neutral on
* purpose — every Mux Media needs it, and they don't share an engine. Nothing here may reach for a specific one
* (license-server derivation lives in `../drm.ts`, for the engines that license), because `@videojs/spf` imports this
* module for its own Mux Media.
*/
const MUX_VIDEO_DOMAIN = "mux.com";
/**
* Serialize params to a query string (`?a=1&b=2`), mapping camelCase keys to `snake_case` and skipping nullish values.
* A `token` replaces every other param — signed URLs bake all modifiers into the token itself.
*/
function createMuxQuery(params = {}) {
	const { token, ...rest } = params;
	if (token) return `?${new URLSearchParams({ token: String(token) })}`;
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(rest)) if (!isNil(value)) search.set(snakeCase(key), String(value));
	const query = search.toString();
	return query ? `?${query}` : "";
}
/** Build the Mux HLS stream URL for a source. */
function createMuxVideoURL(source) {
	if (!source?.playbackId) return void 0;
	const { playbackId, customDomain = MUX_VIDEO_DOMAIN, playback } = source;
	return `https://stream.${customDomain}/${playbackId}.m3u8${createMuxQuery(playback)}`;
}
/**
* Parse a Mux stream URL (`https://stream.<domain>/<playback-id>.m3u8?...`, with or without the `.m3u8` extension) into
* a `MuxSourceBase`, mapping `snake_case` query params back to camelCase playback params. Returns `undefined` for
* non-Mux URLs.
*/
function parseMuxVideoURL(src) {
	if (!src) return void 0;
	let url;
	try {
		url = new URL(src);
	} catch {
		return;
	}
	const [, domain] = url.hostname.match(/^stream\.(.+)$/) ?? [];
	const [, playbackId] = url.pathname.match(/^\/([^/.]+)(?:\.m3u8)?$/) ?? [];
	if (!domain || !playbackId) return void 0;
	const source = { playbackId };
	if (domain !== "mux.com") source.customDomain = domain;
	const playback = {};
	for (const [key, value] of url.searchParams) playback[camelCase(key)] = key === "token" ? value : parseMuxParamValue(value);
	if (Object.keys(playback).length > 0) source.playback = playback;
	return source;
}
/**
* Coerce a query param string back to the boolean/number types declared on `MuxPlaybackParams`. Numbers only convert
* when the string round-trips exactly (so `1080p`, `007`, and JWTs stay strings).
*/
function parseMuxParamValue(value) {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value !== "" && String(Number(value)) === value) return Number(value);
	return value;
}
/**
* Build the poster image URL a source describes. Read through `MuxVideoAdapter`'s `contentData`.
*
* @internal
*/
function createMuxPosterURL(source) {
	if (!source?.playbackId) return void 0;
	const { playbackId, customDomain = MUX_VIDEO_DOMAIN, poster, playback } = source;
	const { ext = "webp", token, ...query } = poster ?? {};
	if (token && parseJwt(token)?.aud !== "t") return void 0;
	if (!token && playback?.token) return void 0;
	return `https://image.${customDomain}/${playbackId}/thumbnail.${ext}${createMuxQuery({
		token,
		...query
	})}`;
}
/**
* Build the storyboard (thumbnail sprite) VTT URL a source describes. Read through `MuxVideoAdapter`'s `contentData`.
*
* @internal
*/
function createMuxStoryboardURL(source) {
	if (!source?.playbackId) return void 0;
	const { playbackId, customDomain = MUX_VIDEO_DOMAIN, storyboard, playback } = source;
	const { token, ...query } = storyboard ?? {};
	if (token && parseJwt(token)?.aud !== "s") return void 0;
	if (!token && playback?.token) return void 0;
	return `https://image.${customDomain}/${playbackId}/storyboard.vtt${createMuxQuery({
		token,
		format: "webp",
		...query
	})}`;
}

//#endregion
//#region ../adapters/mux-video/dist/dev/mux/dist/default/metadata.js
/**
* Build the metadata URL for a source. Every Mux asset has a document there, titled or not, and signed playback carries
* its `playback.token` along — the document sits under the playback ID like every other URL the token covers, and
* answers `403` without it.
*/
function createMuxMetadataURL(source) {
	if (!source?.playbackId) return void 0;
	const { playbackId, customDomain = MUX_VIDEO_DOMAIN, playback } = source;
	return `https://stream.${customDomain}/${playbackId}/metadata.json${createMuxQuery({ token: playback?.token })}`;
}
/**
* Flatten the metadata document to one value per key.
*
* The document is Apple's JSON chapters format: a list of chapters, the first of which stands for the asset. Its
* `titles` carry the asset title (`[{ language, title }]`, the first being the default), and its `metadata` carries `{
* key, value }` entries. An asset without metadata still has a document, just without either, so anything unexpected
* flattens to an empty object rather than failing.
*/
function parseMuxMetadata(json) {
	const metadata = {};
	const [first] = Array.isArray(json) ? json : [];
	if (!isPlainObject(first)) return metadata;
	const { titles, metadata: entries } = first;
	if (Array.isArray(entries)) {
		for (const entry of entries) if (isPlainObject(entry) && isString(entry.key) && entry.key && isString(entry.value)) metadata[entry.key] = entry.value;
	}
	const [defaultTitle] = Array.isArray(titles) ? titles : [];
	const title = isPlainObject(defaultTitle) ? defaultTitle.title : void 0;
	if (isString(title) && title) metadata.title = title;
	return metadata;
}
/**
* Fetch and flatten the metadata document at `url`.
*
* Resolves `undefined` when there is nothing to apply: the request was aborted, or it failed. Metadata is optional and
* playback never depends on it, so a failure is never fatal — a `404` says the document does not exist and stays quiet,
* and any other failure is only announced in development.
*/
async function loadMuxMetadata(url, signal) {
	try {
		const response = await fetch(url, signal ? { signal } : {});
		if (response.ok) return parseMuxMetadata(await response.json());
	} catch (error) {}
}
/**
* The content data a metadata document contributes: every key as it stands, so a consumer can read what the shared
* vocabulary does not name, with a `video_title` entry standing in for `title` when the document names none.
*/
function toMuxContentData(metadata) {
	if (!metadata) return {};
	const title = metadata.title || metadata.video_title;
	return {
		...metadata,
		...title && { title }
	};
}
/**
* The metadata document for one Mux source, across the request that fetches it.
*
* Keyed by the source's identity — playback ID, domain, and playback token — so a source assignment that keeps those
* keeps the document (an image param changing, say), and one that moves them drops it along with any request in flight.
* A Media owns one of these next to its `source`, and folds `metadata` into `contentData` when `onChange` says it
* moved.
*/
var MuxMetadataLoader = class {
	#key;
	#metadata;
	#request = null;
	#onChange;
	constructor(onChange) {
		this.#onChange = onChange;
	}
	/** The document for the current source, once it has arrived. */
	get metadata() {
		return this.#metadata;
	}
	/**
	* Re-key to `source`. A source with the same identity leaves everything alone; any other drops the document and
	* aborts a request in flight. Quiet either way — the owner rebuilds its `contentData` right after.
	*/
	reset(source) {
		const key = createMuxMetadataURL(source);
		if (key === this.#key) return;
		this.#key = key;
		this.#abort();
		this.#metadata = void 0;
	}
	/**
	* Fetch the document for the current source. Ignored without a Mux source, and once the document is here or on its
	* way — so repeated loads of one source cost one request.
	*/
	load() {
		if (!this.#key || this.#metadata || this.#request) return;
		const request = this.#request = new AbortController();
		loadMuxMetadata(this.#key, request.signal).then((metadata) => {
			if (request.signal.aborted) return;
			this.#request = null;
			this.#metadata = metadata ?? {};
			this.#onChange();
		});
	}
	destroy() {
		this.#abort();
	}
	#abort() {
		this.#request?.abort();
		this.#request = null;
	}
};

//#endregion
//#region ../adapters/mux-video/dist/dev/drm.js
/**
* Build the license servers a source describes, keyed by EME key system id — `source.drm` as any other source would
* name it. Mux signs one license token per playback ID and serves every system from a URL derived from it, so
* `drm.token` is all a caller provides.
*
* Returns `undefined` when no license token is present, or when the token is not scoped to DRM — an unsigned license
* request is always rejected, so there is nothing useful to configure.
*
* Separate from `./source` because it is the one part of the Mux source an engine that licenses differently has nothing
* to do with.
*
* @internal
*/
function createMuxDrmSystems(source) {
	if (!source?.playbackId) return void 0;
	const { playbackId, customDomain = MUX_VIDEO_DOMAIN, drm } = source;
	const { token } = drm ?? {};
	if (!token || parseJwt(token)?.aud !== "d") return void 0;
	const query = createMuxQuery({ token });
	const url = (path) => `https://license.${customDomain}/${path}/${playbackId}${query}`;
	return {
		"com.apple.fps": {
			licenseUrl: url("license/fairplay"),
			serverCertificateUrl: url("appcert/fairplay")
		},
		"com.widevine.alpha": { licenseUrl: url("license/widevine") },
		"com.microsoft.playready": { licenseUrl: url("license/playready") }
	};
}

//#endregion
export { createMuxStoryboardURL as a, createMuxPosterURL as i, MuxMetadataLoader as n, createMuxVideoURL as o, toMuxContentData as r, parseMuxVideoURL as s, createMuxDrmSystems as t };
//# sourceMappingURL=drm-B3v6fR3p.js.map