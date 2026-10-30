/*! Video.js | https://videojs.org/help */
import { n as VideoCSSVars } from "../custom-media-element-CfmsPmjg.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as EMPTY_TEXT_TRACKS, t as EMPTY_REMOTE } from "../constants-CMPy89v9.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../media/dist/dev/core/source/wistia.js
/**
* Extract a Wistia hashed id from a raw ten-character id or any recognized URL: media pages
* (`<account>.wistia.com/medias/<id>`), embed URLs (`fast.wistia.net/embed/iframe/<id>` and the `medias/<id>.jsonp` and
* `playlists/<id>` paths), the `wi.st` short host, and the `wvideo=<id>` parameter Wistia links carry.
*
* @internal
*/
function parseWistiaMediaId(src) {
	if (!src) return null;
	if (MATCH_HASHED_ID.test(src)) return src;
	return MATCH_SRC.exec(src)?.[1] ?? MATCH_WVIDEO.exec(src)?.[1] ?? null;
}
/**
* Parse the `wtime` parameter of a Wistia URL into seconds. Wistia spells timestamps the way it spells them elsewhere:
* `90`, `90s`, `1m30s`, `1h2m3s`.
*
* @internal
*/
function parseWistiaStartTime(src) {
	const value = /[?&]wtime=([\dhms]+)/i.exec(src)?.[1]?.toLowerCase();
	if (!value) return null;
	let seconds = null;
	for (const [pattern, multiplier] of WTIME_UNITS) {
		const amount = pattern.exec(value)?.[1];
		if (amount) seconds = (seconds ?? 0) + Number.parseInt(amount, 10) * multiplier;
	}
	return seconds;
}
/** The trailing `s` is optional, so the bare-number form (`90`) lands on the same pattern. */
const WTIME_UNITS = [
	[/(\d+)h/, 3600],
	[/(\d+)m/, 60],
	[/(\d+)s?$/, 1]
];
const MATCH_HASHED_ID = /^[a-z\d]{10}$/i;
const MATCH_SRC = /(?:wistia\.(?:com|net)|wi\.st)\/(?:medias|embed)\/(?:iframe\/|medias\/|playlists\/)?([a-z\d]{10})/i;
const MATCH_WVIDEO = /[?&]wvideo=([a-z\d]{10})/i;

//#endregion
//#region ../adapters/wistia-video/dist/dev/source.js
/**
* What a Wistia player is started with here, whatever Wistia's default or the Wistia app says; a source overrides it.
* Only the corner radius so far, squared because the skin is what rounds a media — see `wistiaPlayerStyle`.
* `roundedPlayer` is the one to set: the three `*BorderRadius` options derive from it.
*
* @internal
*/
const wistiaPlayerDefaultOptions = { roundedPlayer: 0 };
/**
* The style a Wistia player is given: the skin's corners, and no pointer events without chrome.
*
* `borderRadius` reads the same custom property a `<video>` does, and `overflow` goes with it — a `<video>` is replaced
* content that the radius alone clips, where Wistia paints into children the box has to clip too. `pointerEvents` is
* off for a chromeless player because the skin over it is what the viewer is clicking; left interactive it swallows
* those clicks and answers them with chrome of its own. The iframe embeds do the same through a
* `:host(:not([controls]))` rule in a template they own, which a player that brings its own element has no equivalent
* of.
*
* @internal
*/
function wistiaPlayerStyle(controls) {
	return {
		borderRadius: `var(${VideoCSSVars.borderRadius})`,
		overflow: "hidden",
		pointerEvents: controls ? "auto" : "none"
	};
}
/**
* The eight control-bar switches `controls` drives as a group, since Wistia has no single chromeless flag.
* `playBarControl` doubles as the one the group is read back from.
*
* @internal
*/
function wistiaControlProps(controls) {
	return {
		bigPlayButton: controls,
		controlsVisibleOnLoad: controls,
		fullscreenControl: controls,
		playBarControl: controls,
		playPauseControl: controls,
		playPauseNotifier: controls,
		settingsControl: controls,
		volumeControl: controls
	};
}

//#endregion
//#region ../adapters/wistia-video/dist/dev/normalize.js
/**
* Wistia's spellings for the media events it renames, against the ones a media element uses. `play`, `pause`, `ended`,
* `seeking`, and `seeked` are absent because Wistia already spells those the way a media does.
*
* `durationchange` comes from three, because Wistia has no single moment where a duration appears: `duration` reads `0`
* until `api-ready`, the media data lands on `loaded-media-data`, and `loaded-metadata` may wait on the viewer
* interacting. `loadedmetadata` is held to once per source below, since that one is not repeatable. `timeupdate` comes
* from two: `second-change` is a coarser subset of `time-update`, so taking both keeps the clock running at whatever
* resolution is on offer, and a repeat costs one re-read of the playhead. `progress` and `playing` ride along because
* Wistia announces neither.
*
* @internal
*/
const WISTIA_EVENT_ALIASES = {
	"api-ready": ["loadedmetadata", "durationchange"],
	"can-play": ["canplay"],
	"can-play-through": ["canplaythrough"],
	"loaded-data": ["loadeddata"],
	"loaded-media-data": ["durationchange", "contentdatachange"],
	"loaded-metadata": ["loadedmetadata", "durationchange"],
	"load-start": ["loadstart"],
	play: ["playing"],
	"rate-change": ["ratechange"],
	"second-change": ["timeupdate", "progress"],
	"time-update": ["timeupdate", "progress"],
	"volume-change": ["volumechange"]
};
/**
* Give a `<wistia-player>` the surface the rest of Video.js expects of a media: the members `HTMLMediaElement` has that
* Wistia names differently or not at all, and the events it spells its own way.
*
* Applied to the element rather than wrapped around it, so the player a consumer holds and the media the store drives
* are one object — `WistiaAdapter` calls this on itself, React on the element it renders. Idempotent.
*
* `controls` is deliberately not among the members: Wistia has one already and it means the player's control instances,
* which its internals read. Turning chrome on and off is `wistiaControlProps`.
*
* @internal
*/
function normalizeWistiaPlayer(player) {
	const target = player;
	if (normalized.has(target)) return player;
	normalized.add(target);
	const endSeek = () => {
		const state = stateOf(target);
		if (!state.seeking) return;
		state.seeking = false;
		target.dispatchEvent(new Event("seeked"));
	};
	target.addEventListener("seeking", () => {
		stateOf(target).seeking = true;
	});
	target.addEventListener("seeked", () => {
		stateOf(target).seeking = false;
	});
	for (const type of ["second-change", "time-update"]) target.addEventListener(type, endSeek);
	for (const [from, to] of Object.entries(WISTIA_EVENT_ALIASES)) target.addEventListener(from, () => {
		for (const type of to) {
			if (type === "loadedmetadata") {
				const state = stateOf(target);
				if (state.announcedMetadata) continue;
				state.announcedMetadata = true;
			}
			target.dispatchEvent(new Event(type));
		}
	});
	Object.defineProperties(target, WISTIA_MEDIA_DESCRIPTORS);
	return player;
}
const normalized = /* @__PURE__ */ new WeakSet();
/** The source last assigned to a player, which is the record of what a consumer asked for. */
const sources = /* @__PURE__ */ new WeakMap();
/** Values with no home on the player, held per element rather than on it. */
const shadowState = /* @__PURE__ */ new WeakMap();
function stateOf(player) {
	let state = shadowState.get(player);
	if (!state) shadowState.set(player, state = {
		announcedMetadata: false,
		defaultMuted: false,
		playsInline: true,
		seeking: false
	});
	return state;
}
/**
* An empty range that is not the shared `EMPTY_TIME_RANGES`: `isMediaBufferCapable` reads that exact object as "no
* buffer surface at all" and skips the feature for good, where a Wistia player has one and merely has nothing in it
* until a duration arrives.
*/
const NO_RANGE = Object.freeze({
	length: 0,
	start: () => 0,
	end: () => 0
});
function accessor(get, set) {
	return {
		configurable: true,
		enumerable: true,
		get,
		...set && { set }
	};
}
/** Always reports this, and swallows what the store writes back: Wistia has nowhere to put it. */
function inert(value) {
	return accessor(() => value, () => {});
}
function method(value) {
	return {
		configurable: true,
		value
	};
}
const WISTIA_MEDIA_DESCRIPTORS = {
	/** The media's hashed id. Accepts any Wistia URL too, and reports the id it resolved to. */
	src: accessor(function() {
		return this.mediaId ?? "";
	}, function(value) {
		this.source = {
			...this.source,
			mediaId: parseWistiaMediaId(value) ?? ""
		};
		const startTime = parseWistiaStartTime(value);
		if (startTime != null) this.currentTime = startTime;
	}),
	currentSrc: accessor(function() {
		return this.mediaId ?? "";
	}),
	/** Wistia's own options, `mediaId` among them. Assigning applies every one of them to the player. */
	source: accessor(function() {
		return sources.get(this) ?? (this.mediaId ? { mediaId: this.mediaId } : null);
	}, function(value) {
		sources.set(this, value);
		stateOf(this).announcedMetadata = false;
		this.dispatchEvent(new Event("emptied"));
		if (value) Object.assign(this, value);
		else this.mediaId = "";
		this.dispatchEvent(new Event("sourcechange"));
	}),
	/**
	* True unless the media is playing. Wistia answers `state === 'paused'`, which is `false` in the `beforeplay` state a
	* player opens in and `false` again before its API is ready — so left alone, the first click on an untouched player
	* pauses something that was never playing.
	*/
	paused: accessor(function() {
		return this.state !== "playing";
	}),
	/** Wistia spells looping as an end-of-video behavior. */
	loop: accessor(function() {
		return this.endVideoBehavior === "loop";
	}, function(value) {
		this.endVideoBehavior = value ? "loop" : "default";
	}),
	/** The player is live from the moment it exists, so this mutes it now and `muted` changes it afterwards. */
	defaultMuted: accessor(function() {
		return stateOf(this).defaultMuted;
	}, function(value) {
		stateOf(this).defaultMuted = value;
		this.muted = value;
	}),
	/** Stored and reported, but never passed on: Wistia has no inline-playback knob and plays inline. */
	playsInline: accessor(function() {
		return stateOf(this).playsInline;
	}, function(value) {
		stateOf(this).playsInline = value;
	}),
	/** Whether a seek is in flight: tracked from events, and defined at all because the store gates seeking on it. */
	seeking: accessor(function() {
		return stateOf(this).seeking;
	}),
	/** Wistia reports no seekable range of its own, and every Wistia media is seekable end to end. */
	seekable: accessor(function() {
		const duration = this.duration;
		return duration > 0 && Number.isFinite(duration) ? createTimeRange(0, duration) : NO_RANGE;
	}),
	/** The media's own metadata. Wistia knows its name once `loaded-media-data` has fired, and nothing else. */
	contentData: accessor(function() {
		return { title: this.name ?? null };
	}),
	played: accessor(() => NO_RANGE),
	textTracks: accessor(() => EMPTY_TEXT_TRACKS),
	videoWidth: accessor(() => 0),
	videoHeight: accessor(() => 0),
	error: accessor(() => null),
	crossOrigin: inert(null),
	remote: accessor(() => EMPTY_REMOTE),
	isPictureInPicture: accessor(() => false),
	disableRemotePlayback: inert(true),
	disablePictureInPicture: inert(true),
	/** Wistia serves on-demand media only. */
	streamType: inert("on-demand"),
	isFullscreen: accessor(function() {
		return this.inFullscreen === true;
	}),
	exitFullscreen: method(function() {
		return this.cancelFullscreen();
	}),
	/** Re-apply the current source, which is all a Wistia player can be asked to reload. */
	load: method(function() {
		const source = this.source;
		this.source = source;
	}),
	canPlayType: method(() => ""),
	addTextTrack: method(() => void 0)
};

//#endregion
//#region ../adapters/wistia-video/dist/dev/options.js
/**
* Wistia's options for the props a media element is written with — the translation both platforms need, in neither
* one's terms: the custom element assigns the result as properties, React writes it as attributes.
*
* The whole set comes back every time, because a prop that goes away has to take its option with it. A prop that was
* never given is left out rather than defaulted: a Wistia media is configured in Wistia's app too, and a `poster`
* written for a consumer who said nothing would overrule that.
*
* `muted` is missing because it is the state a player _starts_ in, where this runs again on every render and every
* attribute change; `src` and `source` because they name a media rather than configure one.
*
* @internal
*/
function wistiaMediaOptions(props) {
	return {
		...wistiaPlayerDefaultOptions,
		...props.autoplay !== void 0 && { autoplay: props.autoplay },
		...props.loop !== void 0 && { endVideoBehavior: props.loop ? "loop" : "default" },
		...props.poster !== void 0 && { poster: props.poster },
		...props.preload !== void 0 && { preload: props.preload || "metadata" },
		...wistiaControlProps(props.controls ?? false)
	};
}

//#endregion
//#region ../../node_modules/.pnpm/@wistia+wistia-player@0.7.12_webpack@5.109.2_csso@5.0.5_esbuild@0.28.2_lightningcss@1.33.0_postcss@8.5.26_/node_modules/@wistia/wistia-player/dist/wistia-player.js
var __webpack_modules__ = {
	159(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { Rb: () => findScriptInDomBySrc });
		var utilities_wlog_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(6637);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(731);
		var utilities_runScript_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1248);
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var findScriptInDomBySrc = function findScriptInDomBySrc(targetSrc) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var scriptTags = document.getElementsByTagName("script");
			for (var i = 0; i < scriptTags.length; i++) {
				var s = scriptTags[i];
				var src = s.getAttribute("src") || "";
				if (options.ignoreQueryParams) src = src.split("?")[0];
				if (!options.scriptRegex && options.ignoreProtocol) {
					src = src.replace(/^https?:/, "");
					targetSrc = targetSrc.replace(/^https?:/, "");
				}
				if (options.scriptRegex && options.scriptRegex.test(src)) return s;
				if (options.testStartsWith && src.indexOf(targetSrc) === 0) return s;
				if (src === targetSrc) return s;
			}
			return null;
		};
		var removeScriptsBySrc = function removeScriptsBySrc(targetSrc) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var s;
			var _loop = function _loop() {
				if (s) {
					s.onload = s.onreadystatechange = s.onerror = null;
					if (s.parentNode && typeof s.parentNode.removeChild) try {
						s.parentNode.removeChild(s);
					} catch (e) {
						setTimeout(function() {
							throw e;
						}, 0);
					}
				}
			};
			while (s = findScriptInDomBySrc(targetSrc, options)) _loop();
		};
		var runScript = function runScript(src) {
			var timeout = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 8e3;
			var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			if (timeout == null) timeout = 8e3;
			if (options == null) options = {};
			var s;
			var alreadyExists;
			return new Promise(function(resolve) {
				if (options.once === true && (s = findScriptInDomBySrc(src))) alreadyExists = true;
				if (options.once && alreadyExists) {
					if (!s.readyState || /loaded|complete/.test(s.readyState)) setTimeout(function() {
						resolve();
					}, 1);
				} else runScriptWithPromise(src, timeout).then(resolve).catch(function(msg) {
					resolve(msg);
					setTimeout(function() {
						console.error(msg);
					}, 1);
				});
			});
		};
		var runScripts = function runScripts() {
			var scripts;
			for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) args[_key] = arguments[_key];
			if (args[0] instanceof Array) scripts = args[0];
			else scripts = args;
			scripts = scriptInputsToHash(scripts);
			var asyncScripts = [];
			var syncScripts = [];
			var scriptPromises = [];
			scripts.forEach(function(s) {
				var script = _objectSpread({}, s);
				script.promise = new Promise(function(resolve) {
					script.resolve = resolve;
				});
				scriptPromises.push(script.promise);
				if (s.async) asyncScripts.push(script);
				else syncScripts.push(script);
			});
			syncScripts.reduce(function(prev, script) {
				if (script.fn) try {
					script.fn();
				} catch (e) {
					wlog.error(e);
				} finally {
					script.resolve();
				}
				else if (script.src) runScript(script.src, null, script).then(script.resolve);
				return prev.then(script.promise);
			}, Promise.resolve());
			setTimeout(function() {
				asyncScripts.forEach(function(script) {
					if (script.fn) try {
						script.fn();
					} catch (e) {
						wlog.error(e);
					} finally {
						script.resolve();
					}
					else if (script.src) runScript(script.src, null, script).then(script.resolve);
				});
			}, 1);
			return Promise.all(scriptPromises);
		};
		var scriptInputsToHash = function scriptInputsToHash(scripts) {
			var result = [];
			for (var i = 0; i < scripts.length; i++) {
				var script = scripts[i];
				if (typeof script === "string") result.push({
					src: script,
					async: false
				});
				else if (isObject(script)) result.push(script);
				else result.push({
					fn: script,
					async: false
				});
			}
			return result;
		};
	},
	267(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { O: () => hasPerformanceMeasureSupport });
		var hasPerformanceMeasureSupport = function hasPerformanceMeasureSupport() {
			var performance = window.performance;
			return Boolean(performance) && Boolean(performance.measure);
		};
	},
	438(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			$F: () => choosePlayer,
			gC: () => buildContext
		});
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var utilities_detect_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(7231);
		var utilities_metrics_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(655);
		var utilities_legacyLocalstorage_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(3695);
		var utilities_root_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(8176);
		var utilities_wlog_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(6637);
		var _assets_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(7209);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(5509);
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var wlog = utilities_wlog_js__WEBPACK_IMPORTED_MODULE_5__.ct.getPrefixedFunctions("judy");
		var AUTO = "auto";
		var CAROUSEL_HARD_WALL = "carouselHardWall";
		var EXTERNAL = "external";
		var HLS_VIDEO = "hlsVideo";
		var HTML5 = "html5";
		var MANUAL_QUALITY_VIDEO = "manualQualityVideo";
		var NATIVE_HLS_VIDEO = "nativeHlsVideo";
		var NOT_PLAYABLE = "notplayable";
		var PASSWORD_PROTECTED = "passwordprotected";
		var SIMPLE_HTML5 = "simplehtml5";
		var VULCAN_V2 = "vulcan-v2";
		var SPHERICAL_VIDEO = "sphericalVideo";
		var PLAYERS = [
			VULCAN_V2,
			HTML5,
			SIMPLE_HTML5,
			EXTERNAL,
			NOT_PLAYABLE,
			PASSWORD_PROTECTED
		];
		var HLS_ENGINE_PATH = "engines/hls_video.js";
		var NATIVE_HLS_ENGINE_PATH = "engines/native_hls_video.js";
		var SIMPLE_AUDIO_ENGINE_PATH = "engines/simple_audio.js";
		var MANUAL_QUALITY_ENGINE_PATH = "engines/manual_quality_video.js";
		var SPHERICAL_VIDEO_ENGINE_PATH = "engines/spherical_video.js";
		var PLUGIN_CONFIGS = {
			notPlayableVideo: {
				on: true,
				initBeforeHasData: true,
				async: false,
				loadWeight: -1
			},
			vulcanV2Player: {
				on: true,
				initBeforeHasData: false,
				async: false,
				loadWeight: -1
			},
			hlsVideo: {
				on: true,
				initBeforeHasData: false,
				async: false,
				loadWeight: 0
			},
			nativeHlsVideo: {
				on: true,
				initBeforeHasData: false,
				async: false,
				loadWeight: 0
			},
			passwordProtectedVideo: {
				on: true,
				initBeforeHasData: true,
				async: false,
				loadWeight: -1
			},
			externalPlayer: {
				on: true,
				initBeforeHasData: false,
				async: false,
				loadWeight: -1
			},
			html5Player: {
				on: true,
				initBeforeHasData: false,
				async: false,
				loadWeight: -1
			},
			playlist: {
				on: true,
				initBeforeHasData: false,
				async: false,
				loadWeight: -1
			}
		};
		var bestPlayer = function bestPlayer(context, mediaData, embedOptions) {
			var detect = context.detect, logger = context.logger;
			var isSpherical = isSphericalVideo({
				mediaData,
				options: embedOptions
			}, detect);
			if (detect.oldandroid) {
				logger.info("external on old android");
				return EXTERNAL;
			}
			if (canUsePlayer(context, VULCAN_V2, mediaData)) {
				logger.info("default, ret", VULCAN_V2);
				return VULCAN_V2;
			}
			if (mediaData.mediaType === "Audio" || mediaData.mediaType === "LiveStream") return VULCAN_V2;
			if (canUsePlayer(context, HTML5, mediaData)) {
				logger.info("default, ret", HTML5);
				return HTML5;
			}
			logger.info("nothing left, use", EXTERNAL);
			return EXTERNAL;
		};
		var bestUsableEngine = function bestUsableEngine(context, mediaData) {
			var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			var detect = context.detect, logger = context.logger;
			logger.info("bestUsableEngineClass");
			var allowHls = shouldServeHls(context, mediaData, options);
			var isSpherical = isSphericalVideo({
				mediaData,
				options
			}, detect);
			if (options.engine) return options.engine;
			if (isSpherical) {
				logger.info(SPHERICAL_VIDEO);
				return SPHERICAL_VIDEO_ENGINE_PATH;
			}
			if (mediaData.mediaType === "Audio") return SIMPLE_AUDIO_ENGINE_PATH;
			var isApple = detect.safari || detect.ios.version > 0;
			var allowsSameOrigin = window.origin !== "null";
			var restrictedBySameOrigin = isApple && !allowsSameOrigin;
			if (allowHls && detect.nativeHls && (detect.managedMediaSource === false || restrictedBySameOrigin)) {
				logger.info(NATIVE_HLS_VIDEO);
				return NATIVE_HLS_ENGINE_PATH;
			}
			if (allowHls) {
				logger.info(HLS_VIDEO);
				return HLS_ENGINE_PATH;
			}
			logger.info(MANUAL_QUALITY_VIDEO);
			return MANUAL_QUALITY_ENGINE_PATH;
		};
		var bestUsableEngineClass = function bestUsableEngineClass(context, mediaData) {
			var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			var detect = context.detect, logger = context.logger;
			logger.info("bestUsableEngineClass");
			var allowHls = shouldServeHls(context, mediaData, options);
			var engines = Wistia.engines || {};
			if (mediaData.mediaType === "Audio") return engines.SimpleAudio;
			if (allowHls && detect.nativeHls && engines.NativeHlsVideo) {
				logger.info(NATIVE_HLS_VIDEO);
				return engines.NativeHlsVideo;
			}
			if (allowHls && engines.HlsVideo) {
				logger.info(HLS_VIDEO);
				return engines.HlsVideo;
			}
			logger.info(MANUAL_QUALITY_VIDEO);
			return engines.ManualQualityVideo;
		};
		var buildContext = function buildContext() {
			var overrides = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			var pageUrl = contextUrl(overrides);
			return _objectSpread(_objectSpread(_objectSpread({}, getDefaultContext()), overrides), {}, { pageUrl });
		};
		var canPlayInline = function canPlayInline(context) {
			var detect = context.detect;
			return detect.android || detect.ios.version >= 10;
		};
		var canUsePlayer = function canUsePlayer(context, player, mediaData) {
			return isSupportedPlayer(context, player) && hasAssetsForPlayer(context, player, mediaData);
		};
		var choosePlayer = function choosePlayer(context, mediaData, embedOptions) {
			var detect = context.detect;
			var logger = context.logger;
			var playerForce = embedOptions.playerForce;
			logger.info("choosePlayer input", mediaData.hashedId);
			var playerPreference = determinePlayerPreferenceFromInput(context, mediaData, embedOptions);
			if (playerForce && !isValidPlayer(context, playerForce)) {
				logger.error("Invalid playerForce option: \"".concat(playerForce, "\", ignoring"));
				playerForce = null;
			}
			if (playerPreference && playerPreference !== AUTO && !isValidPlayer(context, playerPreference)) {
				logger.error("Invalid playerPreference option: \"".concat(playerPreference, "\", ignoring"));
				playerPreference = AUTO;
			}
			logger.info("playerPreference is", playerPreference);
			if (playerForce) {
				logger.info("\"playerForce\" used, return", playerForce);
				return playerForce;
			}
			if (mediaData.carouselHardWall) {
				logger.info("return", CAROUSEL_HARD_WALL);
				return CAROUSEL_HARD_WALL;
			}
			if (isPasswordProtected(context, embedOptions)) {
				logger.info("return", PASSWORD_PROTECTED);
				return PASSWORD_PROTECTED;
			}
			if (isNotPlayable(context, mediaData, embedOptions)) {
				logger.info("return", NOT_PLAYABLE);
				return NOT_PLAYABLE;
			}
			if (mediaData.protected) return VULCAN_V2;
			if (playerPreference !== AUTO && canUsePlayer(context, playerPreference, mediaData)) {
				var isSpherical = isSphericalVideo({
					mediaData,
					options: embedOptions
				}, detect);
				if (playerPreference !== VULCAN_V2 && isSpherical) {
					logger.info("this player doesn't support spherical, return", VULCAN_V2);
					return VULCAN_V2;
				}
				logger.info("\"playerPreference\" used, return", playerPreference);
				return playerPreference;
			}
			logger.info("choosing player with no preference");
			return bestPlayer(context, mediaData, embedOptions);
		};
		var contextUrl = function contextUrl() {
			var opts = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			if (opts.pageUrl) return opts.pageUrl;
			if (Object(window.FreshUrl).originalUrl) return window.FreshUrl.originalUrl;
			if (window.top === window.self) return location.href || "";
			return document.referrer || "";
		};
		var determinePlayerPreferenceFromInput = function determinePlayerPreferenceFromInput(context, mediaData, embedOptions) {
			var playerPreference = embedOptions.playerPreference || embedOptions.platformPreference;
			if (playerPreference && playerPreference !== AUTO) {
				if (playerPreference === HTML5) {
					if (isMobile(context)) return HTML5;
					return VULCAN_V2;
				}
				if (playerPreference === SIMPLE_HTML5) return HTML5;
				return playerPreference;
			}
			return AUTO;
		};
		var doesBrowserSupportHlsTools = function doesBrowserSupportHlsTools(detect) {
			var hasPromise = Boolean(window.Promise);
			return (detect.mediaSource || detect.nativeHls) && hasPromise;
		};
		var enginesToLoad = function enginesToLoad(context, mediaData) {
			var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			var detect = context.detect, logger = context.logger;
			var engineNames = [];
			logger.info("enginesToLoad");
			var allowHls = shouldServeHls(context, mediaData, options);
			if (allowHls && detect.nativeHls) {
				logger.info(NATIVE_HLS_VIDEO);
				engineNames.push(NATIVE_HLS_VIDEO);
			} else if (allowHls) {
				logger.info(HLS_VIDEO);
				engineNames.push(HLS_VIDEO);
			} else {
				logger.info(MANUAL_QUALITY_VIDEO);
				engineNames.push(MANUAL_QUALITY_VIDEO);
			}
			if (isSphericalVideo({
				mediaData,
				options
			}, detect)) {
				engineNames.push(SPHERICAL_VIDEO);
				logger.info(SPHERICAL_VIDEO);
			}
			var tmpHash = {};
			engineNames.forEach(function(engineName) {
				tmpHash[engineName] = true;
			});
			var result = [];
			for (var engineName in tmpHash) result.push(engineName);
			return result;
		};
		var cachedDefaultContext;
		var getDefaultContext = function getDefaultContext() {
			if (cachedDefaultContext) return cachedDefaultContext;
			cachedDefaultContext = {
				detect: (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.o8)((0, utilities_detect_js__WEBPACK_IMPORTED_MODULE_1__.o1)()),
				inIframe: top !== self,
				location: window.location,
				logger: wlog,
				pageUrl: location.href,
				silenceGlobalWarnings: utilities_root_js__WEBPACK_IMPORTED_MODULE_4__.z.wistiaSilenceGlobalWarnings,
				userAgent: navigator.userAgent
			};
			return cachedDefaultContext;
		};
		var getPluginConfig = function getPluginConfig(context, pluginName) {
			var result = {};
			result[pluginName] = PLUGIN_CONFIGS[pluginName];
			return result;
		};
		var canUseInstantHls = function canUseInstantHls(context, mediaData) {
			var embedOptions = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			return embedOptions.instantHls !== false && mediaData.instantHlsAssetsReady && shouldServeHls(context, mediaData, embedOptions);
		};
		var canUseOriginalFilePlayback = function canUseOriginalFilePlayback(context, mediaData) {
			var embedOptions = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			return mediaData.originalIsEligibleForDirectPlayback && shouldServeHls(context, mediaData, embedOptions);
		};
		var hasAssetsForPlayer = function hasAssetsForPlayer(context, player, mediaData) {
			if (!isValidPlayer(context, player)) return false;
			if (player === NOT_PLAYABLE || player === PASSWORD_PROTECTED || player === CAROUSEL_HARD_WALL) return true;
			var assets = mediaData.assets;
			if (player === VULCAN_V2) return canUseInstantHls(context, mediaData) || canUseOriginalFilePlayback(context, mediaData) || hasReadyVideoAssets(assets) || hasReadyAudioAssets(assets);
			if (player === HTML5) return (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.Fi)(assets).length > 0;
			if (player === EXTERNAL) return (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.Fi)(assets).length > 0;
			throw new Error("Unhandled player type '".concat(player, "'"));
		};
		var hasReadyVideoAssets = function hasReadyVideoAssets(assets) {
			return (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.Fi)(assets).length > 0 || (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.x4)(assets).length > 0;
		};
		var hasReadyAudioAssets = function hasReadyAudioAssets(assets) {
			return (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.o2)(assets).length > 0;
		};
		var hasEnoughReadyMp4Assets = function hasEnoughReadyMp4Assets(assets) {
			var mp4Assets = (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.pb)(assets, {
				container: "mp4",
				metadata: function metadata(m) {
					return m && m.max_bitrate;
				},
				public: true,
				sortBy: "width desc",
				status: _assets_js__WEBPACK_IMPORTED_MODULE_6__.yE,
				type: /\b(?!captioned_video)\S+/
			});
			return Boolean(mp4Assets[0] && mp4Assets[0].width >= 400);
		};
		var hasSupportedHlsAssets = function hasSupportedHlsAssets(mediaData) {
			if ((arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}).instantHls !== false && mediaData.instantHlsAssetsReady) return true;
			if (mediaData.originalIsEligibleForDirectPlayback) return true;
			var hasAssets = hasEnoughReadyMp4Assets(mediaData.assets);
			if (!hasAssets) (0, utilities_metrics_js__WEBPACK_IMPORTED_MODULE_2__.U9)("player/originV2/media-has-no-metadata", 1, { hashedId: mediaData.hashedId });
			return hasAssets;
		};
		var hlsOverrideValue = function hlsOverrideValue(_ref, embedOptions) {
			var pageUrl = _ref.pageUrl;
			var paramVal = hlsQueryParamValue(pageUrl);
			if (paramVal != null) return paramVal;
			var localStorageVal = (0, utilities_legacyLocalstorage_js__WEBPACK_IMPORTED_MODULE_3__.Qy)("forceHls");
			if (localStorageVal != null) return localStorageVal;
			return embedOptions.hls;
		};
		var hlsQueryParamValue = function hlsQueryParamValue(pageUrl) {
			var match = pageUrl && pageUrl.match && pageUrl.match(/[&?]whls=([^&]+)/);
			var val = match && match[1];
			if (val != null) return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.wg)(val);
			return null;
		};
		var isBrowserInNativeAndroid = function isBrowserInNativeAndroid(detect, embedOptions) {
			return detect.android && (embedOptions.playsinline === false || embedOptions.nativeMode === true);
		};
		var isBrowserOldChrome = function isBrowserOldChrome(detect) {
			return detect.chrome && parseInt(detect.chrome.version, 10) < 50;
		};
		var isHlsEnabled = function isHlsEnabled(context, mediaData, embedOptions) {
			var overrideValue = hlsOverrideValue(context, embedOptions);
			if (overrideValue === true || overrideValue === false) return overrideValue;
			if (mediaData.hls_enabled === false) return false;
			return true;
		};
		var isMobile = function isMobile(_ref2) {
			var detect = _ref2.detect;
			return detect.iphone || detect.ipad || detect.android;
		};
		var isNotPlayable = function isNotPlayable(context, mediaData) {
			var _embedOptions$authori;
			var embedOptions = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			var assets = mediaData.assets;
			if (!mediaData.protected && (canUseInstantHls(context, mediaData, embedOptions) || canUseOriginalFilePlayback(context, mediaData, embedOptions))) return false;
			var assetsArentReady = mediaData.type === "Audio" ? (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.o2)(assets).length == 0 : (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.Fi)(assets).length == 0;
			if (mediaData.mediaType === "LiveStream") return false;
			if (mediaData.protected && !((_embedOptions$authori = embedOptions.authorization) !== null && _embedOptions$authori !== void 0 && _embedOptions$authori.jwt)) {
				embedOptions.notPlayableOptions = {
					fadeIn: false,
					message: "This video is set to private.",
					shouldRefresh: false
				};
				return true;
			}
			var allowHls = shouldServeHls(context, mediaData, embedOptions);
			if (mediaData.protected && allowHls === false) {
				embedOptions.notPlayableOptions = {
					fadeIn: false,
					message: "This video is not playable.",
					shouldRefresh: false
				};
				return true;
			}
			return assets.length === 0 || assets.length === 1 && assets[0].type === "original" || assetsArentReady || (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.aF)(assets).length > 0 && (0, _assets_js__WEBPACK_IMPORTED_MODULE_6__.n9)(assets).length === 0;
		};
		var isPasswordProtected = function isPasswordProtected(context, embedOptions) {
			var pluginOpts = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.b$)(embedOptions, "plugin.passwordProtectedVideo");
			return pluginOpts != null && pluginOpts.on !== false;
		};
		var isSphericalVideo = function isSphericalVideo() {
			var _mediaInfo$mediaData, _mediaInfo$opts;
			var mediaInfo = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			if (mediaInfo.options.overrideSpherical) return false;
			var mediaDataSpherical = String((_mediaInfo$mediaData = mediaInfo.mediaData) === null || _mediaInfo$mediaData === void 0 ? void 0 : _mediaInfo$mediaData.spherical);
			var optsSpherical = String((_mediaInfo$opts = mediaInfo.opts) === null || _mediaInfo$opts === void 0 ? void 0 : _mediaInfo$opts.spherical);
			return mediaDataSpherical === "true" || optsSpherical === "true";
		};
		var isSupportedPlayer = function isSupportedPlayer(context, player) {
			if (!isValidPlayer(context, player)) return false;
			return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.qh)(supportedPlayers(context), player) >= 0;
		};
		var isValidPlayer = function isValidPlayer(context, player) {
			return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.qh)(PLAYERS, player) >= 0;
		};
		var logWarnings = function logWarnings(context) {
			var detect = context.detect, userAgent = context.userAgent, logger = context.logger;
			if (context.silenceGlobalWarnings) return;
			var isHeadless = /phantomjs/i.test(userAgent);
			if (xhrHasBeenTamperedWith()) {
				if (!isHeadless) logger.error("The XMLHttpRequest constructor has been tampered with. Because this affects CORS/Range XHR requests, HLS playback has been disabled. To enable HLS playback and other important features, please remove code that changes the definition of window.XMLHttpRequest.");
			}
			if (urlHasBeenTamperedWith()) {
				if (detect.mediaSource && !isHeadless) logger.error("window.URL.createObjectURL has been tampered with. Because this affects use of Media Source Extensions, HLS playback has been disabled. window.URL is a browser API that should not be clobbered. Its current value is:", window.URL);
			}
		};
		var playerPlugins = function playerPlugins(context, player, mediaData, embedOptions) {
			var logger = context.logger;
			var plugins = {};
			logger.info("playerPlugins input", player, mediaData.hashedId, mediaData, embedOptions);
			if (player === NOT_PLAYABLE) merge(plugins, getPluginConfig(context, "notPlayableVideo"));
			else if (player === PASSWORD_PROTECTED) merge(plugins, getPluginConfig(context, "passwordProtectedVideo"));
			else if (player === HTML5) merge(plugins, getPluginConfig(context, "html5Player"));
			else if (player === EXTERNAL) merge(plugins, getPluginConfig(context, "externalPlayer"));
			else if (player === VULCAN_V2) merge(plugins, getPluginConfig(context, "vulcanV2Player"));
			var pluginNames = [];
			for (var k in plugins) pluginNames.push(k);
			logger.info.apply(logger, ["playerPlugins output"].concat(pluginNames, [plugins]));
			return plugins;
		};
		var report = function report(context, mediaData, embedOptions) {
			return {
				bestPlayer: bestPlayer(context, mediaData, embedOptions),
				playerPreferenceFromInput: determinePlayerPreferenceFromInput(context, mediaData, embedOptions),
				supportedPlayers: supportedPlayers(context),
				usablePlayers: usablePlayers(context, mediaData.assets)
			};
		};
		var shouldServeHls = function shouldServeHls(context, mediaData, embedOptions) {
			if (mediaData.type === "LiveStream") return true;
			var detect = context.detect;
			return doesBrowserSupportHlsTools(detect) && !isBrowserOldChrome(detect) && !isBrowserInNativeAndroid(detect, embedOptions) && isHlsEnabled(context, mediaData, embedOptions) && hasSupportedHlsAssets(mediaData) && (!xhrHasBeenTamperedWith(context) && !urlHasBeenTamperedWith(context) || hlsOverrideValue(context, embedOptions));
		};
		var supportedPlayers = function supportedPlayers(context) {
			var detect = context.detect;
			var result = [
				NOT_PLAYABLE,
				PASSWORD_PROTECTED,
				EXTERNAL,
				CAROUSEL_HARD_WALL
			];
			if (detect.vulcanV2Support) result.push(VULCAN_V2);
			if (detect.video.h264) result.push(HTML5);
			return result;
		};
		var usablePlayers = function usablePlayers(context, mediaData) {
			var result = [];
			var candidates = supportedPlayers(context);
			for (var i = 0; i < candidates.length; i++) {
				var player = candidates[i];
				if (canUsePlayer(context, player, mediaData)) result.push(player);
			}
			return result;
		};
		var urlHasBeenTamperedWith = function urlHasBeenTamperedWith() {
			return typeof (window.URL && window.URL.createObjectURL) !== "function";
		};
		var XMLHTTPREQUEST_CONSTRUCTOR_RE = /\s*function\s+XMLHttpRequest\(\)\s*{\s*\[native code\]\s*}\s*/m;
		var XMLHTTPREQUEST_CONSTRUCTOR_IN_SAFARI_9_RE = /\[object XMLHttpRequestConstructor\]/m;
		var xhrHasBeenTamperedWith = function xhrHasBeenTamperedWith() {
			if (XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.constructor) {
				var constructorString = XMLHttpRequest.prototype.constructor.toString();
				return !(XMLHTTPREQUEST_CONSTRUCTOR_RE.test(constructorString) || XMLHTTPREQUEST_CONSTRUCTOR_IN_SAFARI_9_RE.test(constructorString));
			}
			return true;
		};
	},
	541(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { z: () => maybeStartWistiaQueue });
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5509);
		var QUEUE_INTERVAL = 500;
		var wistiaQueue = null;
		/**
		* Periodically checks the Wistia queue and executes the functions in it
		* @returns {void}
		*/
		var maybeStartWistiaQueue = function maybeStartWistiaQueue() {
			if (wistiaQueue) return;
			wistiaQueue = setInterval(function() {
				if (typeof window === "undefined") return;
				var queue = window._wq;
				if (!queue || queue.length === 0) return;
				queue.slice(0).forEach(function(item) {
					if (typeof item === "function") {
						item(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s);
						queue.splice(queue.indexOf(item), 1);
					} else if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s.flushInitQueue) {
						queue.splice(queue.indexOf(item), 1);
						console.warn("<wistia-player> elements must be configured via window.wistiaOptions instead of window._wq. Config not applied", item);
					}
				});
			}, QUEUE_INTERVAL);
		};
		/**
		* Stops the Wistia queue
		* @returns {void}
		*/
		var stopWistiaQueue = function stopWistiaQueue() {
			if (wistiaQueue) {
				clearInterval(wistiaQueue);
				wistiaQueue = null;
			}
		};
	},
	655(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { U9: () => count });
		var utilities_timeout_utils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(3737);
		var utilities_wlog_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6637);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(731);
		var utilities_elem_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(7715);
		var utilities_url_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(2671);
		var utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(5857);
		var utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(4755);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(5509);
		var _this = void 0;
		var W = null;
		if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_7__.s._metricsCache == null) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_7__.s._metricsCache = {};
		var METRICS_CACHE = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_7__.s._metricsCache;
		var send = function send(type, key, val) {
			var extraData = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
			try {
				if (METRICS_CACHE.toMput == null) METRICS_CACHE.toMput = [];
				if (METRICS_CACHE.requestId == null) METRICS_CACHE.requestId = 0;
				var messageObj = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__.h1)({
					type,
					key,
					value: val != null ? val : null,
					request_id: METRICS_CACHE.requestId
				}, extraData);
				var serialized = JSON.stringify(messageObj);
				utilities_wlog_js__WEBPACK_IMPORTED_MODULE_1__.ct.debug("send metrics", serialized);
				METRICS_CACHE.toMput.push(serialized);
				(0, utilities_timeout_utils_js__WEBPACK_IMPORTED_MODULE_0__.L)("metrics.debounce", function() {
					(0, utilities_elem_js__WEBPACK_IMPORTED_MODULE_3__.Rx)(function() {
						msend.apply(_this, METRICS_CACHE.toMput);
						METRICS_CACHE.toMput = [];
						METRICS_CACHE.requestId += 1;
					});
				}, 500);
			} catch (e) {
				utilities_wlog_js__WEBPACK_IMPORTED_MODULE_1__.ct.error(e);
			}
		};
		var msend = function msend() {
			if (!(0, utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_6__.D5)()) return;
			var url = "".concat((0, utilities_url_js__WEBPACK_IMPORTED_MODULE_4__.ff)(), "//").concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__.Qz)(), "/mput?topic=metrics");
			for (var _len = arguments.length, messages = new Array(_len), _key = 0; _key < _len; _key++) messages[_key] = arguments[_key];
			return fetch(url, {
				method: "POST",
				mode: "cors",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: messages.join("\n")
			}).then(function(response) {
				if (!response.ok) console.error(response);
			}).catch(function(reason) {
				console.error(reason);
			});
		};
		var count = function count(key) {
			return send("count", key, arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 1, arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {});
		};
		var sample = function sample(key, val, extraData) {
			return send("sample", key, val, extraData);
		};
	},
	731(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Cs: () => eachLeaf,
			G0: () => unsetDeep,
			Im: () => isEmpty,
			Lt: () => select,
			b$: () => getDeep,
			cy: () => isArray,
			di: () => sort,
			h1: () => merge,
			iu: () => except,
			j6: () => only,
			kp: () => utilities_assign_js__WEBPACK_IMPORTED_MODULE_0__.k,
			mA: () => setAndPreserveUndefined,
			o8: () => clone,
			qh: () => indexOf,
			vd: () => setDeep,
			wg: () => cast
		});
		var utilities_assign_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9025);
		var _this = null;
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		var aps = Array.prototype.slice;
		var merge = function merge(obj1) {
			if ((arguments.length <= 1 ? 0 : arguments.length - 1) === 0) return obj1;
			for (var i = 0; i < (arguments.length <= 1 ? 0 : arguments.length - 1); i++) _mergeOne(obj1, i + 1 < 1 || arguments.length <= i + 1 ? void 0 : arguments[i + 1]);
			return obj1;
		};
		var _mergeOne = function mergeOne(obj1, obj2) {
			var transformerFn = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : identityFunc;
			var shouldDeleteFn = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : legacyShouldDeleteFromMerge;
			if (isArray(obj2)) {
				if (!isArray(obj1)) obj1 = [];
				for (var i = 0; i < obj2.length; i++) {
					var v = obj2[i];
					if (obj1[i] == null && v != null) {
						if (isArray(v)) obj1[i] = [];
						else if (isObject(v)) obj1[i] = {};
					}
					var result = _mergeOne(obj1[i], v, transformerFn);
					if (shouldDeleteFn(obj2, i, result)) delete obj1[i];
					else obj1[i] = result;
				}
				return transformerFn(obj1);
			}
			if (isObject(obj2)) {
				for (var k in obj2) if (_objectHasOwn(obj2, k) && (_objectHasOwn(obj1, k) || obj1[k] == null)) {
					var _v = obj2[k];
					if (isArray(_v)) {
						if (!isArray(obj1[k])) obj1[k] = [];
						_mergeOne(obj1[k], _v, transformerFn);
						obj1[k] = transformerFn(obj1[k]);
					} else if (isObject(_v)) {
						if (!isObject(obj1[k])) obj1[k] = {};
						_mergeOne(obj1[k], _v, transformerFn);
						obj1[k] = transformerFn(obj1[k]);
					} else if (obj1 == null) {
						obj1 = {};
						if (!shouldDeleteFn(obj2, k, _v)) obj1[k] = transformerFn(_v);
					} else if (shouldDeleteFn(obj2, k, _v)) delete obj1[k];
					else obj1[k] = transformerFn(_v);
				}
				return transformerFn(obj1);
			}
			return transformerFn(obj2);
		};
		var identityFunc = function identityFunc(v) {
			return v;
		};
		var legacyShouldDeleteFromMerge = function legacyShouldDeleteFromMerge(obj, k, v) {
			return v == null;
		};
		var clone = function clone(obj, transformerFn) {
			if (isArray(obj)) return _mergeOne([], obj, transformerFn);
			return _mergeOne({}, obj, transformerFn);
		};
		var getDeep = function getDeep(obj, parts, create) {
			if (typeof parts === "string") parts = parts.split(".");
			else parts = aps.call(parts);
			var lastObj = obj;
			var lastP;
			while (obj != null && parts.length) {
				var p = parts.shift();
				if ((obj[p] === void 0 || !isObject(obj[p]) && !isArray(obj[p])) && create) {
					if (p === 0) {
						obj = lastObj[lastP] = [];
						obj[p] = {};
					} else obj[p] = {};
				}
				lastObj = obj;
				lastP = p;
				if (_objectHasOwn(obj, p)) obj = obj[p];
				else obj = void 0;
			}
			return obj;
		};
		var setDeep = function setDeep(obj, parts, value) {
			return setAndMaybeDeleteUndefined(obj, parts, value, true);
		};
		var setAndPreserveUndefined = function setAndPreserveUndefined(obj, parts, value) {
			return setAndMaybeDeleteUndefined(obj, parts, value, false);
		};
		var setAndMaybeDeleteUndefined = function setAndMaybeDeleteUndefined(obj, parts, value) {
			var shouldDeleteUndefined = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : true;
			if (typeof parts === "string") parts = parts.split(".");
			else parts = aps.call(parts);
			var prop = parts.pop();
			obj = getDeep(obj, parts, true);
			if (obj != null && (isObject(obj) || isArray(obj)) && prop != null) {
				if (!shouldDeleteUndefined || value != null) obj[prop] = value;
				else delete obj[prop];
			} else return;
		};
		var unsetDeep = function unsetDeep(obj, parts) {
			return setDeep(obj, parts);
		};
		var exists = function exists(obj, name) {
			return getDeep(obj, name) !== void 0;
		};
		var cast = function cast(maybeStr) {
			if (maybeStr == null) return maybeStr;
			if (isObject(maybeStr) || isArray(maybeStr)) return castDeep(maybeStr);
			return castStr("".concat(maybeStr), maybeStr);
		};
		var castStr = function castStr(str) {
			var defaultRet = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : str;
			if (/^-?[1-9]\d*?$/.test(str)) return parseInt(str, 10);
			if (str === "0" || str === "-0") return 0;
			if (/^-?\d*\.\d+$/.test(str)) return parseFloat(str);
			if (/^true$/i.test(str)) return true;
			if (/^false$/i.test(str)) return false;
			return defaultRet;
		};
		var castDeep = function castDeep(obj) {
			return _mergeOne(obj, obj, function castTransformer(val) {
				if (typeof val === "string") return castStr(val);
				return val;
			}, function dontDeleteAnything() {
				return false;
			});
		};
		var only = function only(hash, keys) {
			var result = {};
			var keyHash = {};
			for (var i = 0; i < keys.length; i++) keyHash[keys[i]] = true;
			for (var k in hash) if (keyHash[k]) result[k] = hash[k];
			return result;
		};
		var except = function except(hash, keys) {
			var result = {};
			var keyHash = {};
			for (var i = 0; i < keys.length; i++) keyHash[keys[i]] = true;
			for (var k in hash) if (!keyHash[k]) result[k] = hash[k];
			return result;
		};
		var select = function select(arr, keyPairs) {
			var result = [];
			var isFn = typeof keyPairs === "function";
			var filterFn = isFn ? keyPairs : null;
			for (var i = 0; i < arr.length; i++) {
				var elem = arr[i];
				if (isFn) {
					if (filterFn(elem)) result.push(elem);
				} else {
					var matching = true;
					for (var k in keyPairs) {
						var v = keyPairs[k];
						if (v instanceof Array) {
							if (!elem[k] || elem[k] < v[0] || elem[k] > v[1]) {
								matching = false;
								break;
							}
						} else if (v instanceof RegExp) {
							if (!v.test(elem[k])) {
								matching = false;
								break;
							}
						} else if (v instanceof MultipleValues) {
							var anyMatch = false;
							for (var j = 0; j < v.values.length; j++) {
								var value = v.values[j];
								if (elem[k] === value) {
									anyMatch = true;
									break;
								}
							}
							if (!anyMatch) {
								matching = false;
								break;
							}
						} else if (typeof v === "function") {
							if (elem[k] == null || !v(elem[k])) {
								matching = false;
								break;
							}
						} else if (elem[k] !== v) {
							matching = false;
							break;
						}
					}
					if (matching) result.push(elem);
				}
			}
			return result;
		};
		var MultipleValues = function MultipleValues(values) {
			var self = this;
			(function construct() {
				self.values = values;
			})();
			return self;
		};
		var values = function values() {
			for (var _len = arguments.length, values = new Array(_len), _key = 0; _key < _len; _key++) values[_key] = arguments[_key];
			return new MultipleValues(values);
		};
		var sort = function sort(arr, keys) {
			var isFn = typeof keys === "function";
			var filterFn = isFn ? keys : null;
			var result = aps.call(arr);
			if (isFn) result.sort(filterFn);
			else result.sort(function(a, b) {
				var sortBys;
				if (keys instanceof Array) sortBys = clone(keys);
				else sortBys = keys.split(/\s*,\s*/);
				var ret = 0;
				while (ret === 0 && sortBys.length > 0) {
					var pieces = sortBys.shift().split(/\s+/);
					var sortBy = pieces[0];
					var dir = pieces[1];
					dir = dir === "desc" ? -1 : 1;
					if (a[sortBy] < b[sortBy]) {
						ret = -1 * dir;
						break;
					} else if (a[sortBy] === b[sortBy]) ret = 0;
					else {
						ret = 1 * dir;
						break;
					}
				}
				return ret;
			});
			return result;
		};
		var filter = function filter(arr, callback, thisArg) {
			var ctx = thisArg === void 0 ? _this : thisArg;
			var result = [];
			for (var i = 0; i < arr.length; i++) if (callback.call(ctx, arr[i], i, arr)) result.push(arr[i]);
			return result;
		};
		var ARR_REGEXP = /^\s*function Array()/;
		var isArray = function isArray(obj) {
			return obj != null && obj.push && ARR_REGEXP.test(obj.constructor);
		};
		var OBJ_REGEXP = /^\s*function Object()/;
		var isObject = function isObject(obj) {
			return obj != null && typeof obj === "object" && OBJ_REGEXP.test(obj.constructor);
		};
		var isFunction = function isFunction(obj) {
			return obj != null && typeof obj === "function";
		};
		var REGEXP_REGEXP = /^\s*function RegExp()/;
		var isRegExp = function isRegExp(obj) {
			return obj != null && REGEXP_REGEXP.test(obj.constructor);
		};
		var BASIC_TYPE_REGEXP = /^string|number|boolean|function$/i;
		var isBasicType = function isBasicType(obj) {
			return obj != null && (BASIC_TYPE_REGEXP.test(typeof obj) || isRegExp(obj));
		};
		var isEmpty = function isEmpty(obj) {
			if (obj == null) return true;
			if (isArray(obj) && !obj.length) return true;
			if (isObject(obj)) {
				if (Object.keys(obj).length) return false;
				return true;
			}
			return false;
		};
		var isSubsetDeep = function isSubsetDeep(obj1, obj2) {
			if (obj1 === obj2) return true;
			if (obj1 != null && obj2 == null || obj1 == null && obj2 != null) return false;
			var result = true;
			eachLeaf(obj1, function(obj1LeafVal, path) {
				if (obj1LeafVal !== getDeep(obj2, path)) result = false;
			});
			return result;
		};
		var equalsDeep = function equalsDeep(obj1, obj2) {
			return isSubsetDeep(obj1, obj2) && isSubsetDeep(obj2, obj1);
		};
		var _eachDeep = function eachDeep(obj, fn, path, parent, key) {
			if (path == null) path = [];
			if (isBasicType(obj)) fn(obj, path, parent, key);
			else if (isObject(obj) || isArray(obj)) {
				fn(obj, path, parent, key);
				for (var _key2 in obj) if (_objectHasOwn(obj, _key2)) {
					var newPath = aps.call(path);
					newPath.push(_key2);
					_eachDeep(obj[_key2], fn, newPath, obj, _key2);
				}
			} else fn(obj, path, parent, key);
		};
		var eachLeaf = function eachLeaf(obj, fn) {
			_eachDeep(obj, function(obj, path, parent, key) {
				if (!isArray(obj) && !isObject(obj)) fn(obj, path, parent, key);
			});
		};
		var pick = function pick(obj, keys) {
			var result = {};
			for (var i = 0; i < keys.length; i++) {
				var key = keys[i];
				if (obj[key] !== void 0) result[key] = obj[key];
			}
			return result;
		};
		var indexOf = function indexOf(arr, target) {
			for (var i = 0; i < arr.length; i++) if (arr[i] === target) return i;
			return -1;
		};
		var keys = function keys(obj) {
			if (Object.keys) return Object.keys(obj);
			var result = [];
			for (var k in obj) if (_objectHasOwn(obj, k)) result.push(k);
			return result;
		};
	},
	787(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Ni: () => appHostname,
			rY: () => getSubdomainSuffixHostname
		});
		var REGEX_CLOUD_DEV_BOX = /([a-z0-9-]+)-cde-([a-z0-9-]+)\.([a-z0-9-]+)\.wistia\.io/i;
		var REGEX_OPENCLAW_DEV_BOX = /([a-z0-9-]+)-cde-([a-z0-9-]+)\.([a-z0-9-]+)\.claw\.wistia\.io/i;
		var REGEX_WIZARD_DEV_BOX = /([a-z0-9-]+)-cde-([a-z0-9-]+)\.([a-z0-9-]+)\.wiz\.wistia\.io/i;
		var REGEX_CDB_STAGING_DEV_BOX = /([a-z0-9-]+)-cde-([a-z0-9-]+)\.([a-z0-9-]+)\.cdb-staging\.wistia\.io/i;
		var REGEX_DEV_METAL_TUNNEL = /([a-z0-9-]+)-txl-([a-z0-9-]+)\.([a-z0-9-]+)\.mtl\.wistia\.io/i;
		var appHostname = function appHostname() {
			var subdomain = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "app";
			var hostname = "wistia.com";
			var subdomainSuffixHostname = getSubdomainSuffixHostname(subdomain);
			if (subdomainSuffixHostname) return subdomainSuffixHostname;
			return "".concat(subdomain, ".").concat(hostname);
		};
		var getSubdomainSuffixHostname = function getSubdomainSuffixHostname() {
			var subdomain = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "app";
			if (typeof window !== "undefined" && window.location) {
				var currentHost = window.location.hostname;
				var cdbStagingDevBoxMatches = REGEX_CDB_STAGING_DEV_BOX.exec(currentHost);
				if (cdbStagingDevBoxMatches) return "".concat(subdomain, "-cde-").concat(cdbStagingDevBoxMatches[2], ".").concat(cdbStagingDevBoxMatches[3], ".cdb-staging.wistia.io");
				var cloudDevBoxMatches = REGEX_CLOUD_DEV_BOX.exec(currentHost);
				if (cloudDevBoxMatches) return "".concat(subdomain, "-cde-").concat(cloudDevBoxMatches[2], ".").concat(cloudDevBoxMatches[3], ".wistia.io");
				var openclawDevBoxMatches = REGEX_OPENCLAW_DEV_BOX.exec(currentHost);
				if (openclawDevBoxMatches) return "".concat(subdomain, "-cde-").concat(openclawDevBoxMatches[2], ".").concat(openclawDevBoxMatches[3], ".claw.wistia.io");
				var wizardDevBoxMatches = REGEX_WIZARD_DEV_BOX.exec(currentHost);
				if (wizardDevBoxMatches) return "".concat(subdomain, "-cde-").concat(wizardDevBoxMatches[2], ".").concat(wizardDevBoxMatches[3], ".wiz.wistia.io");
				var metalTunnelMatches = REGEX_DEV_METAL_TUNNEL.exec(currentHost);
				if (metalTunnelMatches) return "".concat(subdomain, "-txl-").concat(metalTunnelMatches[2], ".").concat(metalTunnelMatches[3], ".mtl.wistia.io");
			}
			return null;
		};
	},
	959(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { V: () => isMediaDataError });
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		var isMediaDataError = function isMediaDataError(mediaData) {
			if (!_objectHasOwn(mediaData, "error") || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(mediaData.error)) return false;
			if (mediaData.error === "true" || mediaData.error === true) return true;
			return false;
		};
	},
	998(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			K6: () => rgbToHsl,
			bJ: () => getContrast,
			cO: () => DEFAULT_PLAYER_COLOR,
			hu: () => getVideoPlayerIconColor,
			s1: () => colorContrastRatiosByShape,
			ui: () => adjustColorForProperContrast
		});
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var _color_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5417);
		var _sentryUtils_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(2621);
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var DEFAULT_PLAYER_COLOR = "#2949E5";
		var colorContrastRatiosByShape = {
			nonText: 3,
			largeText: 3,
			paragraphText: 4.5,
			smallText: 5.5,
			backgroundColorWhereNonTextHitAreaContentsHaveProperContrast: 2
		};
		var rgbToHsl = function rgbToHsl(color) {
			var colorArray = color;
			if (color instanceof _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1) {
				if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(color.r) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(color.g) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(color.b)) throw new Error("Color does not contain required RGB values");
				colorArray = [
					color.r,
					color.g,
					color.b
				];
			} else if (typeof color === "string") {
				var colorInstance = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(color);
				if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(colorInstance.r) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(colorInstance.g) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(colorInstance.b)) throw new Error("Color does not contain required RGB values");
				colorArray = [
					colorInstance.r,
					colorInstance.g,
					colorInstance.b
				];
			}
			var red = colorArray[0] / 255;
			var green = colorArray[1] / 255;
			var blue = colorArray[2] / 255;
			var max = Math.max(red, green, blue);
			var min = Math.min(red, green, blue);
			var hue = 0;
			var saturation = 0;
			var lightness = (max + min) / 2;
			if (max === min) {
				hue = 0;
				saturation = 0;
			}
			var delta = max - min;
			if (delta === 0) return {
				hue,
				saturation,
				lightness: red * 100
			};
			if (lightness > .5) saturation = delta / (2 - max - min);
			else saturation = delta / (max + min);
			if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
			else if (max === green) hue = (blue - red) / delta + 2;
			else hue = (red - green) / delta + 4;
			hue /= 6;
			return {
				hue: hue * 360,
				saturation: saturation * 100,
				lightness: lightness * 100
			};
		};
		var getContrast = function getContrast(foreground, background) {
			var foregroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(foreground);
			var backgroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(background);
			var l1 = foregroundColor.getRelativeLuminance();
			var l2 = backgroundColor.getRelativeLuminance();
			var contrastRatio = l1 > l2 ? (l1 + .05) / (l2 + .05) : (l2 + .05) / (l1 + .05);
			return Number.parseFloat(contrastRatio.toFixed(3));
		};
		var adjustColorForProperContrast = function adjustColorForProperContrast(foreground, background) {
			var shape = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : "paragraphText";
			var foregroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(foreground);
			var backgroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(background);
			if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(foregroundColor.r) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(foregroundColor.g) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(foregroundColor.b)) throw new Error("Color does not contain required RGB values");
			var initialContrastRatio = getContrast(foregroundColor.toHexWithHash(), backgroundColor.toHexWithHash());
			if (foregroundColor.hasAccessibleContrast(backgroundColor, shape)) return foregroundColor.toHexWithHash();
			var foregroundColorLightness = rgbToHsl([
				foregroundColor.r,
				foregroundColor.g,
				foregroundColor.b
			]).lightness;
			var slightlyLighterForegroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(foregroundColor).lighten(1);
			var slightlyDarkerForegroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(foregroundColor).darken(1);
			var shouldForegroundColorBeLighter = foregroundColorLightness < 15 || slightlyLighterForegroundColor.getContrastRatio(backgroundColor) > slightlyDarkerForegroundColor.getContrastRatio(backgroundColor);
			if (foregroundColorLightness > 75 && initialContrastRatio === 1) shouldForegroundColorBeLighter = false;
			var adjustedForegroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(foregroundColor);
			var i = 0;
			while (!adjustedForegroundColor.hasAccessibleContrast(backgroundColor, shape)) {
				i += 1;
				if (i > 1e3) {
					(0, _sentryUtils_ts__WEBPACK_IMPORTED_MODULE_2__.N7)("other", new Error("Exceeded ".concat(i, " attempts to find contrasting color")), {
						key: "adjust-color-for-proper-contrast",
						foregroundColor: foregroundColor.toHexWithHash(),
						backgroundColor: backgroundColor.toHexWithHash()
					});
					return adjustedForegroundColor.toHexWithHash();
				}
				var adjustedForegroundColorLuminance = adjustedForegroundColor.getRelativeLuminance();
				if (i > 1 && (adjustedForegroundColorLuminance === 1 || adjustedForegroundColorLuminance === 0)) {
					if (colorContrastRatiosByShape[shape] > 3) return getContrast("#fff", backgroundColor.toHexWithHash()) > getContrast("#000", backgroundColor.toHexWithHash()) ? "#fff" : "#000";
					shouldForegroundColorBeLighter = !shouldForegroundColorBeLighter;
					adjustedForegroundColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(foregroundColor);
				}
				if (shouldForegroundColorBeLighter) adjustedForegroundColor.lighten(1);
				else adjustedForegroundColor.darken(1);
			}
			return adjustedForegroundColor.toHexWithHash();
		};
		/**
		* Takes an array of values, either strings or Color objects, then
		*   - inserts black and white values in case we need these for our contrast-fetching functions using palettes
		*   - filters any duplicate values
		*   - sorts the palette from darkest to lightest color value by its relative luminance
		*
		* @param colors - an array of Color objects or strings representing hex values
		* @returns Color[]
		*/
		var generateColorPalette = function generateColorPalette(colors) {
			var formattedColors = colors.map(function(color) {
				return new Color(color);
			});
			return [new Color("#ffffff"), new Color("#000000")].concat(_toConsumableArray(formattedColors)).reduce(function(acc, currentColor) {
				if (acc.find(function(colorObj) {
					return colorObj.toHex() === currentColor.toHex();
				})) return acc;
				acc.push(currentColor);
				return acc;
			}, []).sort(function(colorOne, colorTwo) {
				return colorOne.getRelativeLuminance() - colorTwo.getRelativeLuminance();
			});
		};
		/**
		* Given a set of colors, a background color, and any colors from the set that we want to exclude from consideration,
		* this utility returns an appropriate foreground color based on the contrast ratio required for the shape param.
		*
		* For example, this method could be used to determine that we should use white text against a black background and vice versa.
		*
		* @param colors - an array of Color objects or strings representing hex values
		* @param backgroundColor - a Color object or hex string
		* @param [colorsToExclude] - optional,  an array of Color objects or strings representing hex values
		* @param [shape] - optional, used to determine the appropriate contrast ratio used in calculating the foreground color
		* @returns
		*/
		var getBestColorForShape = function getBestColorForShape(colors, backgroundColor) {
			var colorsToExclude = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : [];
			var shape = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : "paragraphText";
			var colorPalette = generateColorPalette(colors);
			var backgroundColorObj = new Color(backgroundColor);
			var formattedExcludedColors = colorsToExclude.map(function(color) {
				return new Color(color);
			});
			formattedExcludedColors.push(new Color(backgroundColor));
			formattedExcludedColors = formattedExcludedColors.filter(function(color) {
				return color.toHex() !== "000000" && color.toHex() !== "FFFFFF";
			});
			var stringifiedExcludedColors = formattedExcludedColors.map(function(formattedColor) {
				return formattedColor.toHex();
			});
			var availableColors = colorPalette.filter(function(color) {
				return !stringifiedExcludedColors.includes(color.toHex());
			});
			if (!backgroundColorObj.isDark(true)) availableColors.reverse();
			var textColor = availableColors.find(function(color) {
				return color.getContrastRatio(backgroundColor) >= colorContrastRatiosByShape[shape];
			});
			if (!textColor) return backgroundColorObj.isDark(true) ? "#ffffff" : "#000000";
			return textColor.toHexWithHash();
		};
		var getHexWithoutHash = function getHexWithoutHash(hex) {
			if (!isNonEmptyString(hex)) return "";
			if (hex.startsWith("#")) return hex.substring(1);
			return hex;
		};
		var getVideoPlayerIconColor = function getVideoPlayerIconColor(_playerColor, shouldUseAccessibleIconColor, isGradientEnabled) {
			var _searchParams$get;
			var playerColor = new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1(_playerColor);
			var searchParams = new URL(window.location.toString()).searchParams;
			var hasQueryParamOverride = Boolean((_searchParams$get = searchParams.get("useAccessiblePlayerIconColor")) !== null && _searchParams$get !== void 0 ? _searchParams$get : false);
			if (isGradientEnabled || !hasQueryParamOverride && !shouldUseAccessibleIconColor) return "#ffffff";
			if (new _color_js__WEBPACK_IMPORTED_MODULE_1__.Q1("#fff").getContrastRatio(playerColor) >= colorContrastRatiosByShape.paragraphText) return "#ffffff";
			return adjustColorForProperContrast(_playerColor, _playerColor, "paragraphText");
		};
		var getAudioPlayerIconColor = function getAudioPlayerIconColor(_playerColor, shouldUseAccessibleIconColor, isGradientEnabled) {
			var _searchParams$get2;
			var playerColor = new Color(_playerColor);
			var searchParams = new URL(window.location.toString()).searchParams;
			var hasQueryParamOverride = Boolean((_searchParams$get2 = searchParams.get("useAccessiblePlayerIconColor")) !== null && _searchParams$get2 !== void 0 ? _searchParams$get2 : false);
			if (isGradientEnabled || !hasQueryParamOverride && !shouldUseAccessibleIconColor) return "#ffffff";
			if (new Color("#fff").getContrastRatio(playerColor) >= colorContrastRatiosByShape.paragraphText) return "#ffffff";
			return adjustColorForProperContrast(_playerColor, _playerColor, "paragraphText");
		};
		var SHADE = .8;
		var getBackgroundColorFromPlayerColor = function getBackgroundColorFromPlayerColor() {
			var color = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : DEFAULT_PLAYER_COLOR;
			return new Color(color).shade(SHADE).toHexWithHash();
		};
		var isDarkColor = function isDarkColor(color) {
			return new Color(color).getRelativeLuminance() < .15;
		};
		var isVeryDarkColor = function isVeryDarkColor(color) {
			return new Color(color).getRelativeLuminance() < .05;
		};
		var isLightColor = function isLightColor(color) {
			return new Color(color).getRelativeLuminance() >= .8;
		};
		var isMidToneColor = function isMidToneColor(color) {
			var relativeLuminance = new Color(color).getRelativeLuminance();
			return relativeLuminance > .13 && relativeLuminance < .75;
		};
	},
	1161(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { WO: () => countMetric });
		var utilities_assign_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9025);
		var utilities_pageLoaded_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(9562);
		var utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(4755);
		var _hosts_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5857);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(5509);
		var _this = void 0;
		if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._simpleMetricsCache == null) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._simpleMetricsCache = {};
		if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._simpleMetricsDebounceInterval == null) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._simpleMetricsDebounceInterval = 500;
		var METRICS_CACHE = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._simpleMetricsCache;
		var countMetric = function countMetric(key) {
			return sendMetric("count", key, arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 1, arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {});
		};
		var sendMetrics = function sendMetrics() {
			if (!(0, utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_2__.D5)()) return;
			var url = "https://".concat((0, _hosts_js__WEBPACK_IMPORTED_MODULE_3__.Qz)(), "/mput?topic=metrics");
			for (var _len = arguments.length, messages = new Array(_len), _key = 0; _key < _len; _key++) messages[_key] = arguments[_key];
			return fetch(url, {
				method: "POST",
				mode: "cors",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: messages.join("\n")
			}).then(function(response) {
				if (!response.ok) console.error(response);
			}).catch(function(reason) {
				console.error(reason);
			});
		};
		var sampleMetric = function sampleMetric(key, val, extraData) {
			return sendMetric("sample", key, val, extraData);
		};
		var getCircularReplacer = function getCircularReplacer() {
			var seen = /* @__PURE__ */ new WeakSet();
			return function(key, value) {
				if (typeof value === "object" && value !== null) {
					if (seen.has(value)) return "[Circular]";
					seen.add(value);
				}
				return value;
			};
		};
		var sendMetric = function sendMetric(type, key, val) {
			var extraData = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
			if (!(0, utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_2__.D5)()) return;
			try {
				if (METRICS_CACHE.toMput == null) METRICS_CACHE.toMput = [];
				var messageObj = (0, utilities_assign_js__WEBPACK_IMPORTED_MODULE_0__.k)({
					type,
					key,
					value: val != null ? val : null
				}, extraData);
				var serialized = JSON.stringify(messageObj, getCircularReplacer());
				METRICS_CACHE.toMput.push(serialized);
				clearTimeout(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._msendTimeout);
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._msendTimeout = setTimeout(function() {
					(0, utilities_pageLoaded_js__WEBPACK_IMPORTED_MODULE_1__.R)(function() {
						sendMetrics.apply(_this, METRICS_CACHE.toMput);
						METRICS_CACHE.toMput = [];
					});
				}, _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_4__.s._simpleMetricsDebounceInterval);
			} catch (e) {
				console.error(e.message);
				console.error(e.stack);
			}
		};
		var _clearMetricsCache = function _clearMetricsCache() {
			METRICS_CACHE.toMput = [];
		};
	},
	1224(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { h: () => seqId });
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5509);
		var seqId = function seqId() {
			var prefix = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "wistia_";
			var suffix = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : "";
			var currentVal = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._sequenceVal || 1;
			var result = "".concat(prefix).concat(currentVal).concat(suffix);
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._sequenceVal = currentVal + 1;
			return result;
		};
	},
	1248(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { j: () => runScript });
		var _hosts_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5857);
		var runScript = function runScript(src, timeout) {
			var taggedVersion = _hosts_js__WEBPACK_IMPORTED_MODULE_0__.U4;
			return new Promise(function(resolve, reject) {
				if (timeout == null) timeout = 8e3;
				var s = document.createElement("script");
				s.src = src;
				s.async = true;
				s.type = "text/javascript";
				if (/https?:\/\/fast\.wistia\./.test(s.src) && taggedVersion !== "" && taggedVersion.length > 0) s.src = "".concat(s.src, "@").concat(taggedVersion);
				var cleanupTimeoutId = null;
				var done = false;
				var cleanUp = function cleanUp() {
					s.onerror = s.onreadystatechange = s.onload = null;
					clearTimeout(cleanupTimeoutId);
					clearTimeout(loadingTimeout);
					cleanupTimeoutId = setTimeout(function() {
						if (s && s.parentNode) s.parentNode.removeChild(s);
					}, 500);
				};
				var onSuccess = function onSuccess() {
					var state = s.readyState;
					if (!done && (!state || /loaded|complete/.test(state))) {
						done = true;
						setTimeout(function() {
							resolve();
							cleanUp();
						}, 1);
					}
				};
				var onTimeout = function onTimeout() {
					done = true;
					cleanUp();
					reject(/* @__PURE__ */ new Error("timeout"));
				};
				var onError = function onError(e) {
					done = true;
					cleanUp();
					reject(e);
				};
				var loadingTimeout = setTimeout(onTimeout, timeout);
				s.onerror = onError;
				s.onreadystatechange = onSuccess;
				s.onload = onSuccess;
				(document.body || document.head).appendChild(s);
			});
		};
	},
	1341(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			G5: () => flexibleDuration,
			ab: () => secondsConverter
		});
		var iso8601_duration__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(6633);
		var SECONDS_IN_HOUR = 3600;
		var MINUTES_IN_HOUR = 60;
		var SECONDS_IN_MINUTE = 60;
		var SECONDS_CUTTOFF = 45;
		var padNumber = function padNumber(num) {
			var length = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
			var result = "".concat(num);
			while (result.length < length) result = "0".concat(result);
			return result;
		};
		var secondsConverter = function secondsConverter(total, format) {
			var hours = 0;
			var minutes = 0;
			var seconds = 0;
			var remainingDuration = total;
			var useHours = format.includes("h");
			var useMinutes = format.includes("m");
			if (useHours && remainingDuration > 0) {
				hours += Math.floor(remainingDuration / SECONDS_IN_HOUR);
				remainingDuration %= SECONDS_IN_HOUR;
			}
			if (useMinutes && remainingDuration > 0) {
				minutes += Math.floor(remainingDuration / MINUTES_IN_HOUR);
				remainingDuration %= MINUTES_IN_HOUR;
			}
			seconds = Math.round(remainingDuration);
			if (useHours && minutes === MINUTES_IN_HOUR) {
				hours += 1;
				minutes = 0;
			}
			if (useMinutes && seconds === SECONDS_IN_MINUTE) {
				minutes += 1;
				seconds = 0;
			}
			return {
				hours,
				minutes,
				seconds
			};
		};
		var flexibleDuration = function flexibleDuration(total) {
			var _secondsConverter = secondsConverter(total, "hms"), hours = _secondsConverter.hours, minutes = _secondsConverter.minutes, seconds = _secondsConverter.seconds;
			if (hours === 0) return "".concat(minutes, ":").concat(padNumber(seconds, 2));
			return "".concat(hours, ":").concat(padNumber(minutes, 2), ":").concat(padNumber(seconds, 2));
		};
		var formattedDurationToSeconds = function formattedDurationToSeconds(dur) {
			if (isNil(dur) || isNumber(dur)) return dur;
			try {
				var parsed = parse(dur.toUpperCase());
				return toSeconds(parsed);
			} catch (_unused) {}
			try {
				var _parsed = parse("PT".concat(dur.toUpperCase()));
				return toSeconds(_parsed);
			} catch (_unused2) {}
			return dur;
		};
		var accessibilityDuration = function accessibilityDuration(duration) {
			var _secondsConverter2 = secondsConverter(duration, "hms"), hours = _secondsConverter2.hours, minutes = _secondsConverter2.minutes, seconds = _secondsConverter2.seconds;
			var zeroHours = hours === 0;
			var zeroMinutes = minutes === 0;
			if (zeroHours && zeroMinutes) return "".concat(seconds, " second").concat(seconds === 1 ? "" : "s");
			var hoursText = zeroHours ? "" : "".concat(hours, " hour").concat(hours === 1 ? "" : "s");
			var minText = zeroMinutes ? "" : "".concat(minutes, " minute").concat(hours === 1 ? "" : "s");
			return "".concat(hoursText, " ").concat(minText).trim();
		};
		var humanReadableDuration = function humanReadableDuration(duration) {
			var _secondsConverter3 = secondsConverter(duration, "hms"), hours = _secondsConverter3.hours, minutes = _secondsConverter3.minutes, seconds = _secondsConverter3.seconds;
			var zeroHours = hours === 0;
			var zeroMinutes = minutes === 0;
			if (zeroHours && zeroMinutes) return "".concat(seconds, " Sec");
			var hoursText = zeroHours ? "" : "".concat(hours, " Hr");
			var minText = zeroMinutes ? "" : "".concat(minutes, " Min");
			return "".concat(hoursText, " ").concat(minText).trim();
		};
		var getSecondsRemaining = function getSecondsRemaining(start, end) {
			return (end.getTime() - start.getTime()) / 1e3;
		};
		var secondsToMilliseconds = function secondsToMilliseconds(seconds) {
			return seconds * 1e3;
		};
		var formatDuration = function formatDuration(totalSeconds) {
			var _secondsConverter4 = secondsConverter(totalSeconds, "hms"), hours = _secondsConverter4.hours, minutes = _secondsConverter4.minutes;
			if (totalSeconds < SECONDS_CUTTOFF) return "".concat(Math.round(totalSeconds), " SEC");
			if (hours) return "".concat(hours, " HR ").concat(minutes, " MIN");
			return "".concat(Math.round(totalSeconds / SECONDS_IN_MINUTE), " MIN");
		};
	},
	1512(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			EA: () => CONTROL_BAR_HEIGHT,
			Lc: () => AUDIO_DEFAULT_HEIGHT,
			R7: () => DEFAULT_ASPECT
		});
		var CONTROL_BAR_HEIGHT = 34;
		var AUDIO_DEFAULT_HEIGHT = 218;
		var DEFAULT_ASPECT = 16 / 9;
	},
	1525(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.r(__webpack_exports__);
		__webpack_require__.d(__webpack_exports__, {
			Children: () => L,
			Component: () => preact__WEBPACK_IMPORTED_MODULE_0__.Component,
			Fragment: () => preact__WEBPACK_IMPORTED_MODULE_0__.Fragment,
			PureComponent: () => M,
			StrictMode: () => preact__WEBPACK_IMPORTED_MODULE_0__.Fragment,
			Suspense: () => P,
			SuspenseList: () => B,
			__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: () => fn,
			cloneElement: () => mn,
			createContext: () => preact__WEBPACK_IMPORTED_MODULE_0__.createContext,
			createElement: () => preact__WEBPACK_IMPORTED_MODULE_0__.createElement,
			createFactory: () => sn,
			createPortal: () => $,
			createRef: () => preact__WEBPACK_IMPORTED_MODULE_0__.createRef,
			"default": () => gn,
			findDOMNode: () => yn,
			flushSync: () => bn,
			forwardRef: () => D,
			hydrate: () => tn,
			isElement: () => Sn,
			isFragment: () => vn,
			isMemo: () => dn,
			isValidElement: () => hn,
			lazy: () => z,
			memo: () => N,
			render: () => nn,
			startTransition: () => x,
			unmountComponentAtNode: () => pn,
			unstable_batchedUpdates: () => _n,
			useCallback: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useCallback,
			useContext: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useContext,
			useDebugValue: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useDebugValue,
			useDeferredValue: () => w,
			useEffect: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useEffect,
			useErrorBoundary: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useErrorBoundary,
			useId: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useId,
			useImperativeHandle: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useImperativeHandle,
			useInsertionEffect: () => I,
			useLayoutEffect: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useLayoutEffect,
			useMemo: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useMemo,
			useReducer: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useReducer,
			useRef: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useRef,
			useState: () => preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState,
			useSyncExternalStore: () => C,
			useTransition: () => k,
			version: () => an
		});
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var preact_hooks__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3817);
		function g(n, t) {
			for (var e in t) n[e] = t[e];
			return n;
		}
		function E(n, t) {
			for (var e in n) if ("__source" !== e && !(e in t)) return !0;
			for (var r in t) if ("__source" !== r && n[r] !== t[r]) return !0;
			return !1;
		}
		function C(n, t) {
			var e = t(), r = (0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState)({ t: {
				__: e,
				u: t
			} }), u = r[0].t, o = r[1];
			return (0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useLayoutEffect)(function() {
				u.__ = e, u.u = t, R(u) && o({ t: u });
			}, [
				n,
				e,
				t
			]), (0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useEffect)(function() {
				return R(u) && o({ t: u }), n(function() {
					R(u) && o({ t: u });
				});
			}, [n]), e;
		}
		function R(n) {
			try {
				return !((t = n.__) === (e = n.u()) && (0 !== t || 1 / t == 1 / e) || t != t && e != e);
			} catch (n) {
				return !0;
			}
			var t, e;
		}
		function x(n) {
			n();
		}
		function w(n) {
			return n;
		}
		function k() {
			return [!1, x];
		}
		var I = preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useLayoutEffect;
		function M(n, t) {
			this.props = n, this.context = t;
		}
		function N(n, e) {
			function r(n) {
				var t = this.props.ref;
				return t != n.ref && t && ("function" == typeof t ? t(null) : t.current = null), e ? !e(this.props, n) || t != n.ref : E(this.props, n);
			}
			function u(e) {
				return this.shouldComponentUpdate = r, (0, preact__WEBPACK_IMPORTED_MODULE_0__.createElement)(n, e);
			}
			return u.displayName = "Memo(" + (n.displayName || n.name) + ")", u.__f = u.prototype.isReactComponent = !0, u.type = n, u;
		}
		(M.prototype = new preact__WEBPACK_IMPORTED_MODULE_0__.Component()).isPureReactComponent = !0, M.prototype.shouldComponentUpdate = function(n, t) {
			return E(this.props, n) || E(this.state, t);
		};
		var T = preact__WEBPACK_IMPORTED_MODULE_0__.options.__b;
		preact__WEBPACK_IMPORTED_MODULE_0__.options.__b = function(n) {
			n.type && n.type.__f && n.ref && (n.props.ref = n.ref, n.ref = null), T && T(n);
		};
		var A = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.forward_ref") || 3911;
		function D(n) {
			function t(t) {
				var e = g({}, t);
				return delete e.ref, n(e, t.ref || null);
			}
			return t.$$typeof = A, t.render = n, t.prototype.isReactComponent = t.__f = !0, t.displayName = "ForwardRef(" + (n.displayName || n.name) + ")", t;
		}
		var F = function(n, t) {
			return null == n ? null : (0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)((0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)(n).map(t));
		}, L = {
			map: F,
			forEach: F,
			count: function(n) {
				return n ? (0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)(n).length : 0;
			},
			only: function(n) {
				var t = (0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)(n);
				if (1 !== t.length) throw "Children.only";
				return t[0];
			},
			toArray: preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray
		}, O = preact__WEBPACK_IMPORTED_MODULE_0__.options.__e;
		preact__WEBPACK_IMPORTED_MODULE_0__.options.__e = function(n, t, e, r) {
			if (n.then) {
				for (var u, o = t; o = o.__;) if ((u = o.__c) && u.__c) return t.__e ?? (t.__e = e.__e, t.__k = e.__k), u.__c(n, t);
			}
			O(n, t, e, r);
		};
		var U = preact__WEBPACK_IMPORTED_MODULE_0__.options.unmount;
		function V(n, t, e) {
			return n && (n.__c && n.__c.__H && (n.__c.__H.__.forEach(function(n) {
				"function" == typeof n.__c && n.__c();
			}), n.__c.__H = null), null != (n = g({}, n)).__c && (n.__c.__P === e && (n.__c.__P = t), n.__c.__e = !0, n.__c = null), n.__k = n.__k && n.__k.map(function(n) {
				return V(n, t, e);
			})), n;
		}
		function W(n, t, e) {
			return n && e && (n.__v = null, n.__k = n.__k && n.__k.map(function(n) {
				return W(n, t, e);
			}), n.__c && n.__c.__P === t && (n.__e && e.appendChild(n.__e), n.__c.__e = !0, n.__c.__P = e)), n;
		}
		function P() {
			this.__u = 0, this.o = null, this.__b = null;
		}
		function j(n) {
			var t = n.__ && n.__.__c;
			return t && t.__a && t.__a(n);
		}
		function z(n) {
			var e, r, u, o = null;
			function i(i) {
				if (e || (e = n()).then(function(n) {
					n && (o = n.default || n), u = !0;
				}, function(n) {
					r = n, u = !0;
				}), r) throw r;
				if (!u) throw e;
				return o ? (0, preact__WEBPACK_IMPORTED_MODULE_0__.createElement)(o, i) : null;
			}
			return i.displayName = "Lazy", i.__f = !0, i;
		}
		function B() {
			this.i = null, this.l = null;
		}
		preact__WEBPACK_IMPORTED_MODULE_0__.options.unmount = function(n) {
			var t = n.__c;
			t && (t.__z = !0), t && t.__R && t.__R(), t && 32 & n.__u && (n.type = null), U && U(n);
		}, (P.prototype = new preact__WEBPACK_IMPORTED_MODULE_0__.Component()).__c = function(n, t) {
			var e = t.__c, r = this;
			r.o ??= [], r.o.push(e);
			var u = j(r.__v), o = !1, i = function() {
				o || r.__z || (o = !0, e.__R = null, u ? u(c) : c());
			};
			e.__R = i;
			var l = e.__P;
			e.__P = null;
			var c = function() {
				if (!--r.__u) {
					if (r.state.__a) {
						var n = r.state.__a;
						r.__v.__k[0] = W(n, n.__c.__P, n.__c.__O);
					}
					var t;
					for (r.setState({ __a: r.__b = null }); t = r.o.pop();) t.__P = l, t.forceUpdate();
				}
			};
			r.__u++ || 32 & t.__u || r.setState({ __a: r.__b = r.__v.__k[0] }), n.then(i, i);
		}, P.prototype.componentWillUnmount = function() {
			this.o = [];
		}, P.prototype.render = function(n, e) {
			if (this.__b) {
				if (this.__v.__k) {
					var r = document.createElement("div"), o = this.__v.__k[0].__c;
					this.__v.__k[0] = V(this.__b, r, o.__O = o.__P);
				}
				this.__b = null;
			}
			var i = e.__a && (0, preact__WEBPACK_IMPORTED_MODULE_0__.createElement)(preact__WEBPACK_IMPORTED_MODULE_0__.Fragment, null, n.fallback);
			return i && (i.__u &= -33), [(0, preact__WEBPACK_IMPORTED_MODULE_0__.createElement)(preact__WEBPACK_IMPORTED_MODULE_0__.Fragment, null, e.__a ? null : n.children), i];
		};
		var H = function(n, t, e) {
			if (++e[1] === e[0] && n.l.delete(t), n.props.revealOrder && ("t" !== n.props.revealOrder[0] || !n.l.size)) for (e = n.i; e;) {
				for (; e.length > 3;) e.pop()();
				if (e[1] < e[0]) break;
				n.i = e = e[2];
			}
		};
		function Z(n) {
			return this.getChildContext = function() {
				return n.context;
			}, n.children;
		}
		function Y(n) {
			var e = this, r = n.h;
			if (e.componentWillUnmount = function() {
				(0, preact__WEBPACK_IMPORTED_MODULE_0__.render)(null, e.v), e.v = null, e.h = null;
			}, e.h && e.h !== r && e.componentWillUnmount(), !e.v) {
				for (var u = e.__v; null !== u && !u.__m && null !== u.__;) u = u.__;
				e.h = r, e.v = {
					nodeType: 1,
					parentNode: r,
					childNodes: [],
					__k: { __m: u.__m },
					contains: function() {
						return !0;
					},
					namespaceURI: r.namespaceURI,
					insertBefore: function(n, t) {
						this.childNodes.push(n), e.h.insertBefore(n, t);
					},
					removeChild: function(n) {
						this.childNodes.splice(this.childNodes.indexOf(n) >>> 1, 1), e.h.removeChild(n);
					}
				};
			}
			(0, preact__WEBPACK_IMPORTED_MODULE_0__.render)((0, preact__WEBPACK_IMPORTED_MODULE_0__.createElement)(Z, { context: e.context }, n.__v), e.v);
		}
		function $(n, e) {
			var r = (0, preact__WEBPACK_IMPORTED_MODULE_0__.createElement)(Y, {
				__v: n,
				h: e
			});
			return r.containerInfo = e, r;
		}
		(B.prototype = new preact__WEBPACK_IMPORTED_MODULE_0__.Component()).__a = function(n) {
			var t = this, e = j(t.__v), r = t.l.get(n);
			return r[0]++, function(u) {
				var o = function() {
					t.props.revealOrder ? (r.push(u), H(t, n, r)) : u();
				};
				e ? e(o) : o();
			};
		}, B.prototype.render = function(n) {
			this.i = null, this.l = /* @__PURE__ */ new Map();
			var t = (0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)(n.children);
			n.revealOrder && "b" === n.revealOrder[0] && t.reverse();
			for (var e = t.length; e--;) this.l.set(t[e], this.i = [
				1,
				0,
				this.i
			]);
			return n.children;
		}, B.prototype.componentDidUpdate = B.prototype.componentDidMount = function() {
			var n = this;
			this.l.forEach(function(t, e) {
				H(n, e, t);
			});
		};
		var q = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.element") || 60103, G = /^(?:accent|alignment|arabic|baseline|cap|clip(?!PathU)|color|dominant|fill|flood|font|glyph(?!R)|horiz|image(!S)|letter|lighting|marker(?!H|W|U)|overline|paint|pointer|shape|stop|strikethrough|stroke|text(?!L)|transform|underline|unicode|units|v|vector|vert|word|writing|x(?!C))[A-Z]/, J = /^on(Ani|Tra|Tou|BeforeInp|Compo)/, K = /[A-Z0-9]/g, Q = "undefined" != typeof document, X = function(n) {
			return ("undefined" != typeof Symbol && "symbol" == typeof Symbol() ? /fil|che|rad/ : /fil|che|ra/).test(n);
		};
		function nn(n, t, e) {
			return t.__k ?? (t.textContent = ""), (0, preact__WEBPACK_IMPORTED_MODULE_0__.render)(n, t), "function" == typeof e && e(), n ? n.__c : null;
		}
		function tn(n, t, e) {
			return (0, preact__WEBPACK_IMPORTED_MODULE_0__.hydrate)(n, t), "function" == typeof e && e(), n ? n.__c : null;
		}
		preact__WEBPACK_IMPORTED_MODULE_0__.Component.prototype.isReactComponent = !0, [
			"componentWillMount",
			"componentWillReceiveProps",
			"componentWillUpdate"
		].forEach(function(t) {
			Object.defineProperty(preact__WEBPACK_IMPORTED_MODULE_0__.Component.prototype, t, {
				configurable: !0,
				get: function() {
					return this["UNSAFE_" + t];
				},
				set: function(n) {
					Object.defineProperty(this, t, {
						configurable: !0,
						writable: !0,
						value: n
					});
				}
			});
		});
		var en = preact__WEBPACK_IMPORTED_MODULE_0__.options.event;
		preact__WEBPACK_IMPORTED_MODULE_0__.options.event = function(n) {
			return en && (n = en(n)), n.persist = function() {}, n.isPropagationStopped = function() {
				return this.cancelBubble;
			}, n.isDefaultPrevented = function() {
				return this.defaultPrevented;
			}, n.nativeEvent = n;
		};
		var rn, un = {
			configurable: !0,
			get: function() {
				return this.class;
			}
		}, on = preact__WEBPACK_IMPORTED_MODULE_0__.options.vnode;
		preact__WEBPACK_IMPORTED_MODULE_0__.options.vnode = function(n) {
			"string" == typeof n.type && function(n) {
				var t = n.props, e = n.type, u = {}, o = -1 == e.indexOf("-");
				for (var i in t) {
					var l = t[i];
					if (!("value" === i && "defaultValue" in t && null == l || Q && "children" === i && "noscript" === e || "class" === i || "className" === i)) {
						var c = i.toLowerCase();
						"defaultValue" === i && "value" in t && null == t.value ? i = "value" : "download" === i && !0 === l ? l = "" : "translate" === c && "no" === l ? l = !1 : "o" === c[0] && "n" === c[1] ? "ondoubleclick" === c ? i = "ondblclick" : "onchange" !== c || "input" !== e && "textarea" !== e || X(t.type) ? "onfocus" === c ? i = "onfocusin" : "onblur" === c ? i = "onfocusout" : J.test(i) && (i = c) : c = i = "oninput" : o && G.test(i) ? i = i.replace(K, "-$&").toLowerCase() : null === l && (l = void 0), "oninput" === c && u[i = c] && (i = "oninputCapture"), u[i] = l;
					}
				}
				"select" == e && (u.multiple && Array.isArray(u.value) && (u.value = (0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)(t.children).forEach(function(n) {
					n.props.selected = -1 != u.value.indexOf(n.props.value);
				})), null != u.defaultValue && (u.value = (0, preact__WEBPACK_IMPORTED_MODULE_0__.toChildArray)(t.children).forEach(function(n) {
					n.props.selected = u.multiple ? -1 != u.defaultValue.indexOf(n.props.value) : u.defaultValue == n.props.value;
				}))), t.class && !t.className ? (u.class = t.class, Object.defineProperty(u, "className", un)) : t.className && (u.class = u.className = t.className), n.props = u;
			}(n), n.$$typeof = q, on && on(n);
		};
		var ln = preact__WEBPACK_IMPORTED_MODULE_0__.options.__r;
		preact__WEBPACK_IMPORTED_MODULE_0__.options.__r = function(n) {
			ln && ln(n), rn = n.__c;
		};
		var cn = preact__WEBPACK_IMPORTED_MODULE_0__.options.diffed;
		preact__WEBPACK_IMPORTED_MODULE_0__.options.diffed = function(n) {
			cn && cn(n);
			var t = n.props, e = n.__e;
			null != e && "textarea" === n.type && "value" in t && t.value !== e.value && (e.value = null == t.value ? "" : t.value), rn = null;
		};
		var fn = { ReactCurrentDispatcher: { current: {
			readContext: function(n) {
				return rn.__n[n.__c].props.value;
			},
			useCallback: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useCallback,
			useContext: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useContext,
			useDebugValue: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useDebugValue,
			useDeferredValue: w,
			useEffect: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useEffect,
			useId: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useId,
			useImperativeHandle: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useImperativeHandle,
			useInsertionEffect: I,
			useLayoutEffect: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useLayoutEffect,
			useMemo: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useMemo,
			useReducer: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useReducer,
			useRef: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useRef,
			useState: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState,
			useSyncExternalStore: C,
			useTransition: k
		} } }, an = "18.3.1";
		function sn(n) {
			return preact__WEBPACK_IMPORTED_MODULE_0__.createElement.bind(null, n);
		}
		function hn(n) {
			return !!n && n.$$typeof === q;
		}
		function vn(n) {
			return hn(n) && n.type === preact__WEBPACK_IMPORTED_MODULE_0__.Fragment;
		}
		function dn(n) {
			return !!n && "string" == typeof n.displayName && 0 == n.displayName.indexOf("Memo(");
		}
		function mn(n) {
			return hn(n) ? preact__WEBPACK_IMPORTED_MODULE_0__.cloneElement.apply(null, arguments) : n;
		}
		function pn(n) {
			return !!n.__k && ((0, preact__WEBPACK_IMPORTED_MODULE_0__.render)(null, n), !0);
		}
		function yn(n) {
			return n && (n.base || 1 === n.nodeType && n) || null;
		}
		var _n = function(n, t) {
			return n(t);
		}, bn = function(n, t) {
			var r = preact__WEBPACK_IMPORTED_MODULE_0__.options.debounceRendering;
			preact__WEBPACK_IMPORTED_MODULE_0__.options.debounceRendering = function(n) {
				return n();
			};
			var u = n(t);
			return preact__WEBPACK_IMPORTED_MODULE_0__.options.debounceRendering = r, u;
		}, Sn = hn, gn = {
			useState: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState,
			useId: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useId,
			useReducer: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useReducer,
			useEffect: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useEffect,
			useLayoutEffect: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useLayoutEffect,
			useInsertionEffect: I,
			useTransition: k,
			useDeferredValue: w,
			useSyncExternalStore: C,
			startTransition: x,
			useRef: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useRef,
			useImperativeHandle: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useImperativeHandle,
			useMemo: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useMemo,
			useCallback: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useCallback,
			useContext: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useContext,
			useDebugValue: preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useDebugValue,
			version: "18.3.1",
			Children: L,
			render: nn,
			hydrate: tn,
			unmountComponentAtNode: pn,
			createPortal: $,
			createElement: preact__WEBPACK_IMPORTED_MODULE_0__.createElement,
			createContext: preact__WEBPACK_IMPORTED_MODULE_0__.createContext,
			createFactory: sn,
			cloneElement: mn,
			createRef: preact__WEBPACK_IMPORTED_MODULE_0__.createRef,
			Fragment: preact__WEBPACK_IMPORTED_MODULE_0__.Fragment,
			isValidElement: hn,
			isElement: Sn,
			isFragment: vn,
			isMemo: dn,
			findDOMNode: yn,
			Component: preact__WEBPACK_IMPORTED_MODULE_0__.Component,
			PureComponent: M,
			memo: N,
			forwardRef: D,
			flushSync: bn,
			unstable_batchedUpdates: _n,
			StrictMode: preact__WEBPACK_IMPORTED_MODULE_0__.Fragment,
			Suspense: P,
			SuspenseList: B,
			lazy: z,
			__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: fn
		};
	},
	1627(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Uh: () => utilities_unescape_html_js__WEBPACK_IMPORTED_MODULE_0__.U,
			u: () => base64Decode
		});
		var utilities_unescape_html_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(2428);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var unbreakifyText = function unbreakifyText() {
			return (arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "").replace(" ", "&nbsp;");
		};
		var stripHtml = function stripHtml(htmlStr) {
			var tmp = document.createElement("div");
			tmp.innerHTML = htmlStr;
			return tmp.textContent || tmp.innerText || "";
		};
		var camelCase = function camelCase(snakeStr) {
			return snakeStr.replace(/[_-]([a-z])/g, function(g) {
				return g.charAt(1).toUpperCase();
			});
		};
		var snakeCase = function snakeCase(camelStr) {
			return camelStr.replace(/[A-Z]/g, function(g) {
				return "_".concat(g.toLowerCase());
			});
		};
		var shallowCamelizeKeys = function shallowCamelizeKeys(o) {
			return Object.keys(o).reduce(function(memo, key) {
				memo[camelCase(key)] = o[key];
				return memo;
			}, {});
		};
		var shallowSnakeKeys = function shallowSnakeKeys(o) {
			return Object.keys(o).reduce(function(memo, key) {
				memo[snakeCase(key)] = o[key];
				return memo;
			}, {});
		};
		var base64Decode = function base64Decode(input) {
			return decodeURIComponent(atob(input).split("").map(function(c) {
				return "%".concat("00".concat(c.charCodeAt(0).toString(16)).slice(-2));
			}).join(""));
		};
		var base64Encode = function base64Encode(input) {
			return btoa(encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, function(match, p1) {
				return String.fromCharCode("0x".concat(p1));
			}));
		};
		var notSetOrTrue = function notSetOrTrue(val) {
			return val == null || val === true;
		};
		var preventOuterMouseWheel = function preventOuterMouseWheel(e, container) {
			var topMargin = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 0;
			var bottomMargin = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 0;
			var scrollTop = container.scrollTop, scrollHeight = container.scrollHeight, offsetHeight = container.offsetHeight;
			var hitTop = function hitTop() {
				return scrollTop + (arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 0) - topMargin <= 0;
			};
			var hitBottom = function hitBottom() {
				return scrollTop + (arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 0) + bottomMargin >= scrollHeight - offsetHeight;
			};
			var delta = e.deltaY || -e.wheelDelta;
			var dir = delta > 0 ? "down" : "up";
			if (!!e.deltaY) {
				if (dir === "up" && hitTop() || dir === "down" && hitBottom()) e.preventDefault();
			} else {
				var extra = 47.5 * delta / 120;
				if (dir === "up" && hitTop(extra)) {
					e.preventDefault();
					container.scrollTop = 0;
				} else if (dir === "down" && hitBottom(extra)) {
					e.preventDefault();
					container.scrollTop = scrollHeight - offsetHeight;
				}
			}
		};
		var parentFramesLength = function parentFramesLength() {
			try {
				return parent.frames.length;
			} catch (e) {
				Wistia.warn(e);
				return 1;
			}
		};
	},
	1885(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			CC: () => mediaDataUrl,
			dq: () => mediaDataScriptRegExp
		});
		var wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5509);
		var utilities_root_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(8176);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(731);
		var utilities_script_utils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(159);
		var utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(3411);
		var utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(5857);
		var utilities_media_data_transforms_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(3917);
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var transformResponse = function transformResponse(mediaData, options) {
			var _mediaWithOpts$media;
			var mediaWithOpts = _objectSpread({}, mediaData);
			var transformOpts = merge({}, (_mediaWithOpts$media = mediaWithOpts.media) === null || _mediaWithOpts$media === void 0 ? void 0 : _mediaWithOpts$media.embedOptions, options);
			if (mediaWithOpts.error) return mediaWithOpts;
			delete mediaWithOpts.media.unnamed_assets;
			mediaDataTransforms(mediaWithOpts.media, transformOpts);
			return mediaWithOpts.media;
		};
		var mediaDataUrl = function mediaDataUrl(hashedId) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var host = (0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__.Dd)(options);
			return "".concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__.v9)(), "//").concat(host, "/embed/medias/").concat(hashedId, ".json");
		};
		var mediaDataScriptRegExp = function mediaDataScriptRegExp(hashedId) {
			var protocolMatch = location.protocol === "https:" ? "https" : "https?";
			return new RegExp("^(".concat(protocolMatch, ":)?//((").concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__.CX)().replace(".", "\\."), ")|(").concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_5__.kh)().replace(".", "\\."), "))/embed/medias/").concat(hashedId, "\\.jsonp\\??"));
		};
		var cacheMedia = function cacheMedia(hashedId, data) {
			return cacheMediaData(hashedId, data);
		};
		var uncacheMedia = function uncacheMedia(hashedId) {
			var _Wistia$uncacheCaptio;
			uncacheMediaData(hashedId);
			(_Wistia$uncacheCaptio = Wistia.uncacheCaptions) === null || _Wistia$uncacheCaptio === void 0 || _Wistia$uncacheCaptio.call(Wistia, hashedId);
			removeSpeedDemonScriptAndData(hashedId);
		};
		var removeSpeedDemonScriptAndData = function removeSpeedDemonScriptAndData(hashedId) {
			window["wistiajsonp-/embed/medias/".concat(hashedId, ".json")] = null;
			removeScriptsBySrc(mediaDataUrl(hashedId), { scriptRegex: mediaDataScriptRegExp(hashedId) });
		};
		var mediaFromCache = function mediaFromCache(hashedId) {
			return dataFromCache(hashedId);
		};
		var dataFromCache = function dataFromCache(hashedId) {
			var resultFromFetchCache = getMediaDataFromCache(hashedId);
			if (resultFromFetchCache) return resultFromFetchCache;
			var speedDemonData = root["wistiajsonp-/embed/medias/".concat(hashedId, ".json")];
			if (speedDemonData != null && speedDemonData.media) return speedDemonData.media;
			return null;
		};
	},
	1919(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { I: () => standardSvgAttrs });
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var standardSvgAttrs = function standardSvgAttrs(_ref) {
			var _ref$width = _ref.width, width = _ref$width === void 0 ? 40 : _ref$width, _ref$height = _ref.height, height = _ref$height === void 0 ? 34 : _ref$height, _ref$styleOverride = _ref.styleOverride, styleOverride = _ref$styleOverride === void 0 ? {} : _ref$styleOverride, _ref$ariaHidden = _ref.ariaHidden, ariaHidden = _ref$ariaHidden === void 0 ? false : _ref$ariaHidden, _ref$fillColor = _ref.fillColor, fillColor = _ref$fillColor === void 0 ? "#ffffff" : _ref$fillColor;
			return {
				x: "0px",
				y: "0px",
				viewBox: "0 0 ".concat(width, " ").concat(height),
				"enable-background": "new 0 0 ".concat(width, " ").concat(height),
				"aria-hidden": "".concat(ariaHidden),
				style: _objectSpread({
					fill: fillColor,
					height: "100%",
					left: 0,
					strokeWidth: 0,
					top: 0,
					width: "100%"
				}, styleOverride)
			};
		};
	},
	2147(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Z: () => removeInjectedJsonLd,
			g: () => injectJsonLd
		});
		var utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(3441);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(731);
		var utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5857);
		var utilities_assets_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(7209);
		var utilities_url_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(2671);
		var _iso8601Helper_ts__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(7229);
		var _normalizeChapters_ts__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(9128);
		var generateAudioJsonLd = function generateAudioJsonLd(mediaData) {
			var _embedOptions;
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var videoWidth = options.videoWidth, videoHeight = options.videoHeight;
			var embedOptions = options.embedOptions;
			if (!embedOptions) embedOptions = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.wg)((0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.o8)(mediaData.embedOptions));
			var obj = {
				"@context": "http://schema.org/",
				"@id": "https://".concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__.kh)(), "/embed/iframe/").concat(mediaData.hashedId),
				"@type": "AudioObject",
				duration: "PT".concat((0, _iso8601Helper_ts__WEBPACK_IMPORTED_MODULE_5__.J)(mediaData.duration)),
				name: mediaData.name,
				thumbnailUrl: (0, utilities_assets_js__WEBPACK_IMPORTED_MODULE_3__.Wz)(mediaData.assets, {
					ext: "jpg",
					protocol: "https:",
					videoWidth,
					videoHeight,
					embedHost: (_embedOptions = embedOptions) === null || _embedOptions === void 0 ? void 0 : _embedOptions.embedHost
				}),
				contentUrl: generateContentUrl(mediaData),
				embedUrl: generateEmbedUrl(mediaData, embedOptions),
				uploadDate: (/* @__PURE__ */ new Date(mediaData.createdAt * 1e3)).toISOString(),
				description: mediaData.seoDescription
			};
			if (mediaData.captions && mediaData.captions[0]) obj.transcript = mediaData.captions[0].text;
			return obj;
		};
		var generateEmbedUrl = function generateEmbedUrl(mediaData, embedOptions) {
			var _mediaData$embedOptio;
			var baseUrl = "https://".concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__.kh)(), "/embed/iframe/").concat(mediaData.hashedId);
			if ((0, utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__.Vq)(mediaData, embedOptions) && !(0, utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__.Qy)(embedOptions) && (_mediaData$embedOptio = mediaData.embedOptions.plugin) !== null && _mediaData$embedOptio !== void 0 && _mediaData$embedOptio.videoThumbnail) return "".concat(baseUrl, "?wseektoaction=true");
			return baseUrl;
		};
		var generateContentUrl = function generateContentUrl(mediaData) {
			var assets = mediaData.assets;
			if (mediaData.mediaType === "Audio") {
				var _readyPublicMp3s$;
				return (_readyPublicMp3s$ = (0, utilities_assets_js__WEBPACK_IMPORTED_MODULE_3__.o2)(assets)[0]) === null || _readyPublicMp3s$ === void 0 ? void 0 : _readyPublicMp3s$.url;
			}
			var availableMp4s = (0, utilities_assets_js__WEBPACK_IMPORTED_MODULE_3__.Fi)(assets);
			if (availableMp4s.length === 0) return;
			var highestQuality = (0, utilities_assets_js__WEBPACK_IMPORTED_MODULE_3__.tt)(availableMp4s, 1080);
			if (!highestQuality) return;
			var url = new utilities_url_js__WEBPACK_IMPORTED_MODULE_4__.s0(highestQuality.url);
			url.ext("m3u8");
			return url.absolute();
		};
		var generateVideoJsonLd = function generateVideoJsonLd(mediaData) {
			var _embedOptions2;
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var videoWidth = options.videoWidth, videoHeight = options.videoHeight;
			var embedOptions = options.embedOptions;
			if (!embedOptions) {
				var _cast;
				embedOptions = (_cast = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.wg)((0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.o8)(mediaData.embedOptions))) !== null && _cast !== void 0 ? _cast : {};
			}
			var obj = {
				"@context": "http://schema.org/",
				"@id": "https://".concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__.kh)(), "/embed/iframe/").concat(mediaData.hashedId),
				"@type": "VideoObject",
				duration: "PT".concat((0, _iso8601Helper_ts__WEBPACK_IMPORTED_MODULE_5__.J)(mediaData.duration)),
				name: mediaData.name,
				thumbnailUrl: (0, utilities_assets_js__WEBPACK_IMPORTED_MODULE_3__.Wz)(mediaData.assets, {
					ext: "jpg",
					protocol: "https:",
					videoWidth,
					videoHeight,
					embedHost: (_embedOptions2 = embedOptions) === null || _embedOptions2 === void 0 ? void 0 : _embedOptions2.embedHost
				}),
				embedUrl: generateEmbedUrl(mediaData, embedOptions),
				uploadDate: (/* @__PURE__ */ new Date(mediaData.createdAt * 1e3)).toISOString(),
				description: mediaData.seoDescription
			};
			if (mediaData.mediaType === "Video") obj.contentUrl = generateContentUrl(mediaData);
			if (mediaData.captions && mediaData.captions[0]) obj.transcript = mediaData.captions[0].text;
			if ((0, utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__.Vq)(mediaData, embedOptions)) {
				if ((0, utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__.Qy)(embedOptions)) {
					var chapterList = (0, _normalizeChapters_ts__WEBPACK_IMPORTED_MODULE_6__.a)(embedOptions).chapterList;
					obj.hasPart = (0, utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__.oG)(chapterList, location.href, mediaData.duration);
				} else obj.potentialAction = (0, utilities_keyMoments_ts__WEBPACK_IMPORTED_MODULE_0__.CR)();
			}
			return obj;
		};
		var injectJsonLd = function injectJsonLd(id, mediaData) {
			var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			var jsonLdObj;
			if (mediaData.mediaType === "Audio") jsonLdObj = generateAudioJsonLd(mediaData, options);
			else jsonLdObj = generateVideoJsonLd(mediaData, options);
			var stringified = JSON.stringify(jsonLdObj);
			var jsonLd = document.createElement("script");
			jsonLd.className = "w-json-ld";
			jsonLd.type = "application/ld+json";
			jsonLd.innerHTML = stringified;
			jsonLd._wistia = true;
			jsonLd.setAttribute("id", id);
			removeInjectedJsonLd(id);
			var existingScripts = document.querySelectorAll("script.w-json-ld");
			var existingScript = existingScripts[existingScripts.length - 1];
			if (existingScript) existingScript.parentNode.insertBefore(jsonLd, existingScript.nextSibling);
			else document.head.insertBefore(jsonLd, document.head.childNodes[0]);
		};
		var removeInjectedJsonLd = function removeInjectedJsonLd(id) {
			if (!id) return;
			var el = document.getElementById(id);
			if (!el) return;
			el.remove();
		};
	},
	2428(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { U: () => unescapeHtml });
		var unescapedCache = {};
		var unescapeHtml = function unescapeHtml(encodedHtmlStr) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			if (!encodedHtmlStr) return "";
			if (options.cache) {
				var cachedVal = unescapedCache[encodedHtmlStr];
				if (unescapedCache[encodedHtmlStr]) return cachedVal;
			}
			var e = document.createElement("div");
			e.innerHTML = encodedHtmlStr.toString().replace(/</g, "&lt;").replace(/>/g, "&gt;");
			var result;
			if (e.childNodes.length > 0) result = e.childNodes[0].nodeValue;
			else result = "";
			if (options.cache) unescapedCache[encodedHtmlStr] = result;
			return result;
		};
	},
	2621(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { N7: () => reportError });
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var _trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(4755);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5509);
		var _appHostname_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(787);
		var _hosts_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(5857);
		var _simpleMetrics_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(1161);
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var getSampleRatesByProductType = function getSampleRatesByProductType(productType) {
			if (productType === "mediaPlayback") return .001;
			if (productType === "hlsPlayback") return .01;
			return 1;
		};
		var IS_DEV_ENV = false;
		var IS_TEST_ENV = false;
		var isSentryLoading = false;
		var errorsCapturedBeforeSentryClientInit = [];
		var MAX_PENDING_ERRORS = 50;
		var configureSentry = function configureSentry() {
			if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(window.Sentry) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(window.Sentry.BrowserClient) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(window.Sentry.makeFetchTransport) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(window.Sentry.defaultStackParser) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(window.Sentry.Scope)) return;
			/**
			* Since the webpages our code is embedded in might have their own Sentry instances defined,
			* we cannot use Sentry.init();
			*
			* Instead, we can follow the example provided by Sentry (https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/)
			* and create our own client that we use to report errors. This will prevent any Wistia exceptions
			* from being logged in customer Sentry instances, and it should also help prevent our Sentry instance
			* from picking up exceptions in customer code.
			*/
			var client = new window.Sentry.BrowserClient({
				dsn: "https://a3591ba5e949a37083cc6f5a4191e903@o4505518331658240.ingest.us.sentry.io/4505794284290048",
				transport: window.Sentry.makeFetchTransport,
				stackParser: window.Sentry.defaultStackParser,
				integrations: [window.Sentry.httpContextIntegration()],
				release: (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.uI)(_hosts_js__WEBPACK_IMPORTED_MODULE_4__.U4) ? _hosts_js__WEBPACK_IMPORTED_MODULE_4__.U4 : _hosts_js__WEBPACK_IMPORTED_MODULE_4__.lR
			});
			var scope = new window.Sentry.Scope();
			scope.setClient(client);
			scope.setTags({ pillar: "publish" });
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope = scope;
			client.init();
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.isSentryInitialized = true;
			if (errorsCapturedBeforeSentryClientInit.length > 0) (0, _simpleMetrics_js__WEBPACK_IMPORTED_MODULE_5__.WO)("player/buffered-sentry-errors", errorsCapturedBeforeSentryClientInit.length);
			errorsCapturedBeforeSentryClientInit.forEach(function(pending) {
				reportError(pending.product, pending.error, _objectSpread(_objectSpread({}, pending.details), {}, { isBuffered: "true" }));
			});
			errorsCapturedBeforeSentryClientInit.length = 0;
			listenForGlobalErrors();
			listenForGlobalUnhandledRejections();
		};
		var initializeSentry = function initializeSentry() {
			if ((0, _trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_1__.D5)() !== true) return;
			if (!window.Sentry && !_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.isSentryInitialized && !isSentryLoading) {
				isSentryLoading = true;
				var sentryLoader = document.createElement("script");
				/**
				* Using the Sentry loader script means Sentry will init a second time after
				* our own call to init inside configureSentry(). The second init will include
				* all the default Sentry integrations, which we do not want.
				*
				* Instead of using the loader script, we can load the bundle directly
				* and configure the client when the script loads. This allows us to maintain
				* our own Sentry client without worrying about it colliding with customer instances of Sentry.
				*
				*/
				sentryLoader.src = "https://browser.sentry-cdn.com/9.6.1/bundle.min.js";
				sentryLoader.crossOrigin = "anonymous";
				sentryLoader.integrity = "sha384-kbRmCeIl7Uxr+vT9YhSAdguCdd4L5QPRj7jzQTanorUVVlw/Y5X9vtzVyOEHLfpH";
				sentryLoader.onload = function() {
					return configureSentry();
				};
				document.head.appendChild(sentryLoader);
			}
		};
		var reportError = function reportError(product, error, details) {
			try {
				if ((0, _trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_1__.D5)() !== true) return;
				if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.isSentryInitialized) {
					initializeSentry();
					if (errorsCapturedBeforeSentryClientInit.length < MAX_PENDING_ERRORS) errorsCapturedBeforeSentryClientInit.push({
						details,
						error,
						product
					});
					return;
				}
				var sampleRate = getSampleRatesByProductType(product);
				if (IS_DEV_ENV) {
					console.error(error);
					return;
				}
				if (IS_TEST_ENV) return;
				var shouldSendToSentry = false;
				var cryptoObj = (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(window.crypto) ? window.msCrypto : window.crypto;
				if (cryptoObj !== void 0) shouldSendToSentry = cryptoObj.getRandomValues(/* @__PURE__ */ new Uint32Array(1))[0] / 4294967296 < sampleRate;
				else shouldSendToSentry = Math.random() < sampleRate;
				if (!shouldSendToSentry) console.error(error);
				else if ((0, _trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_1__.D5)()) {
					_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope.clear();
					_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope.setTag("pillar", "publish");
					_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope.setTag("product", product);
					if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.uu)(details)) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope.setTags(details);
					_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope.setTag("url", window.location.href);
					_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._sentryScope.captureException(error);
				}
			} catch (err) {
				console.error(err);
			}
		};
		var globalErrorHandler = function globalErrorHandler(event) {
			var _event$error$source, _event$error;
			var eventError = event.error;
			if (!(eventError instanceof Error)) return;
			var eventErrorSource = (_event$error$source = (_event$error = event.error) === null || _event$error === void 0 ? void 0 : _event$error.source) !== null && _event$error$source !== void 0 ? _event$error$source : "";
			var fastHostName = (0, _appHostname_js__WEBPACK_IMPORTED_MODULE_3__.Ni)("fast");
			if (eventErrorSource.includes(fastHostName)) reportError("globalListener", eventError);
		};
		var globalUnhandledRejectionHandler = function globalUnhandledRejectionHandler(event) {
			var _event$reason$stack, _event$reason;
			var eventReason = event.reason;
			if (!(eventReason instanceof Error)) return;
			if (((_event$reason$stack = (_event$reason = event.reason) === null || _event$reason === void 0 ? void 0 : _event$reason.stack) !== null && _event$reason$stack !== void 0 ? _event$reason$stack : "").includes((0, _appHostname_js__WEBPACK_IMPORTED_MODULE_3__.Ni)("fast"))) reportError("globalListener", eventReason);
		};
		var listenForGlobalErrors = function listenForGlobalErrors() {
			if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._isListeningForGlobalErrors) {
				window.addEventListener("error", globalErrorHandler);
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._isListeningForGlobalErrors = true;
			}
		};
		var listenForGlobalUnhandledRejections = function listenForGlobalUnhandledRejections() {
			if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._isListeningForGlobalUnhandledRejections) {
				window.addEventListener("unhandledrejection", globalUnhandledRejectionHandler);
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._isListeningForGlobalUnhandledRejections = true;
			}
		};
	},
	2671(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			ff: () => proto,
			s0: () => Url
		});
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var utilities_wlog_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6637);
		var proto = function proto() {
			var url = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : location.href;
			if (/^http:\/\//.test(url)) return "http:";
			return "https:";
		};
		var queryParamsToObject = function queryParamsToObject(raw) {
			var result = {};
			if (!raw) return result;
			var parts = raw.split("&");
			var _loop = function _loop() {
				var pair = parts[i].split("=");
				var key = pair[0];
				var val = pair[1];
				try {
					key = debrack(decodeURIComponent(key)) || "";
				} catch (e) {
					setTimeout(function() {
						utilities_wlog_js__WEBPACK_IMPORTED_MODULE_1__.ct.notice(e);
					}, 50);
					key = "";
				}
				(0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.wg)(key);
				var existing = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.b$)(result, key);
				if (existing != null) {
					if ((0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.cy)(existing)) existing.push(urlComponentToObject(val));
					else {
						var arr = [existing];
						arr.push(urlComponentToObject(val));
						(0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.mA)(result, key, arr);
					}
				} else (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.mA)(result, key, urlComponentToObject(val));
			};
			for (var i = 0; i < parts.length; i++) _loop();
			return result;
		};
		var urlComponentToObject = function urlComponentToObject(val) {
			if (val == null) return val;
			var result;
			try {
				result = decodeURIComponent(val);
			} catch (e) {
				setTimeout(function() {
					utilities_wlog_js__WEBPACK_IMPORTED_MODULE_1__.ct.notice(e);
				}, 50);
				result = val;
			}
			return result;
		};
		var objectToQueryParams = function objectToQueryParams(obj) {
			var result = [];
			(0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.Cs)(obj, function(leafVal, path) {
				if (leafVal != null) result.push("".concat(encodeURIComponent(brack(path)), "=").concat(encodeURIComponent(leafVal)));
				else result.push(encodeURIComponent(brack(path)));
			});
			return result.join("&");
		};
		var splitPath = function splitPath(str) {
			var result = [];
			if (str == null) return result;
			var parts = str.split(/\/+/);
			for (var i = 0; i < parts.length; i++) {
				var part = parts[i];
				if (part != null && part !== "") result.push(part);
			}
			return result;
		};
		var joinPath = function joinPath(path) {
			if (typeof path === "string") path = path.split("/");
			if (path == null) return "";
			return "/".concat(path.join("/"));
		};
		var brack = function brack(path) {
			var result = path[0];
			for (var i = 1; i < path.length; i++) result += "[".concat(path[i], "]");
			return result;
		};
		var debrack = function debrack(str) {
			return str.match(/([\w\-_]+)/g);
		};
		var URL_CONSTRUCTOR_KEYS = [
			"protocol",
			"host",
			"port",
			"params",
			"path"
		];
		var Url = function Url(url) {
			var self = this;
			(function construct() {
				self.params = {};
				self.path = [];
				self.host = "";
				self.rawPath = "";
				if (typeof url === "object") self.fromOptions(url);
				else if (url) self.fromRaw(url);
			})();
		};
		var uproto = Url.prototype;
		uproto.fromOptions = function(options) {
			for (var i = 0; i < URL_CONSTRUCTOR_KEYS.length; i++) {
				var opt = URL_CONSTRUCTOR_KEYS[i];
				if (options[opt] != null) this[opt] = options[opt];
			}
			return this;
		};
		uproto.fromRaw = function(raw) {
			this.rawUrl = raw;
			var match = raw.match(/^((?:https?:)|(?:file:)|(?:ftp:))?\/\//);
			if (match) this.protocol = match[1] || void 0;
			match = raw.match(/\/\/([^:?#/]*)/);
			if (match) this.host = match[1] || void 0;
			match = raw.match(/\/\/.*?(\/[^?#$]+)/) || raw.match(/(^\/[^/][^?#$]+)/);
			if (match) this.setPath(match[1]);
			match = raw.match(/:(\d+)/);
			if (match) this.port = parseInt(match[1], 10);
			match = raw.match(/\?([^#]+)/);
			if (match) {
				this.rawParams = match[1];
				this.params = queryParamsToObject(this.rawParams);
			}
			match = raw.match(/#(.*)$/);
			if (match) this.anchor = match[1];
			return this;
		};
		uproto.clone = function() {
			return new Url({
				protocol: this.protocol,
				host: this.host,
				port: this.port,
				path: (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.o8)(this.path),
				params: (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.o8)(this.params),
				anchor: this.anchor
			});
		};
		uproto.ext = function(ext) {
			if (ext != null) {
				var current = this.ext();
				var i = this.path.length - 1;
				var regexp = new RegExp("\\.".concat(current), "g");
				if (current) this.path[i] = "".concat(this.path[i].replace(regexp, ""));
				return this.path[i] = "".concat(this.path[i], ".").concat(ext);
			}
			var match = this.path[this.path.length - 1].match(/\.(.*)$/);
			return match != null && match[1] || null;
		};
		uproto.isRelative = function() {
			var loc = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : window.location;
			var proto = this.protocol;
			var host = this.host;
			return (proto == null || proto === "" || proto === loc.protocol) && (!host || host === loc.hostname);
		};
		uproto.toString = function() {
			if (this.isRelative()) return this.relative();
			return this.absolute();
		};
		uproto.absolute = function() {
			var protocolPart = "";
			if (this.protocol != null) protocolPart = this.protocol;
			var portPart = "";
			if (this.port != null) portPart = ":".concat(this.port);
			return "".concat(protocolPart, "//").concat(this.host || location.host).concat(portPart).concat(this.relative());
		};
		uproto.relative = function() {
			var pathPart = "";
			if (this.path.length > 0) {
				pathPart = joinPath(this.path);
				if (this._hasTrailingSlash) pathPart += "/";
			}
			var paramPart = "?".concat(objectToQueryParams(this.params));
			if (paramPart.length === 1) paramPart = "";
			return "".concat(pathPart).concat(paramPart).concat(this.relativeAnchor());
		};
		uproto.authority = function() {
			var portPart = this.port != null ? ":".concat(this.port) : "";
			return "".concat(this.host).concat(portPart);
		};
		uproto.relativeProtocol = function() {
			var portPart = "";
			if (this.port != null) portPart = ":".concat(this.port);
			return "//".concat(this.host).concat(portPart).concat(this.relative());
		};
		uproto.relativeAnchor = function() {
			var anchorPart = "";
			if (this.anchor != null) anchorPart = "#".concat(this.anchor);
			return "".concat(anchorPart);
		};
		uproto.setPath = function(rawPath) {
			this.rawPath = rawPath;
			this._hasTrailingSlash = /\/$/.test(this.rawPath);
			this.path = splitPath(this.rawPath);
		};
		Url.create = function(options) {
			return new Url(options);
		};
		var createUrl = Url.create;
		Url.parse = function(str) {
			return new Url(str);
		};
		var parseUrl = Url.parse;
	},
	2694(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			S: () => EventShepherd,
			h: () => convertedEventNames
		});
		var _eventConstants_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(2760);
		function _classCallCheck(a, n) {
			if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
		}
		function _defineProperties(e, r) {
			for (var t = 0; t < r.length; t++) {
				var o = r[t];
				o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
			}
		}
		function _createClass(e, r, t) {
			return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var convertedEventNames = { mutechange: _eventConstants_ts__WEBPACK_IMPORTED_MODULE_0__.Gd };
		var callbackDetailsConversions = { mutechange: function mutechange(detail) {
			return detail.isMuted;
		} };
		var EventShepherd = /*#__PURE__*/ function() {
			function EventShepherd() {
				_classCallCheck(this, EventShepherd);
				_defineProperty(this, "convertedEventsMap", {});
			}
			return _createClass(EventShepherd, [
				{
					key: "addListener",
					value: function addListener(eventName, element, callback) {
						var _convertedEventNames$, _this$convertedEvents, _this$convertedEvents2;
						var normalizedEventName = (_convertedEventNames$ = convertedEventNames[eventName]) !== null && _convertedEventNames$ !== void 0 ? _convertedEventNames$ : eventName;
						(_this$convertedEvents2 = (_this$convertedEvents = this.convertedEventsMap)[normalizedEventName]) !== null && _this$convertedEvents2 !== void 0 || (_this$convertedEvents[normalizedEventName] = []);
						var eventListenerCallback = function eventListenerCallback(customEvent) {
							if (callbackDetailsConversions[eventName]) callback(callbackDetailsConversions[eventName](customEvent.detail));
							else callback();
						};
						this.convertedEventsMap[normalizedEventName].push({
							givenCallback: callback,
							eventListenerCallback
						});
						element.addEventListener(normalizedEventName, eventListenerCallback);
					}
				},
				{
					key: "removeAllListeners",
					value: function removeAllListeners(element) {
						var _this = this;
						Object.keys(this.convertedEventsMap).forEach(function(eventName) {
							var _this$convertedEvents3;
							(_this$convertedEvents3 = _this.convertedEventsMap[eventName]) === null || _this$convertedEvents3 === void 0 || _this$convertedEvents3.forEach(function(storedCallbacks) {
								element.removeEventListener(eventName, storedCallbacks.eventListenerCallback);
							});
							_this.convertedEventsMap[eventName] = [];
						});
					}
				},
				{
					key: "removeListener",
					value: function removeListener(eventName, element, callback) {
						var _convertedEventNames$2, _this2 = this;
						var normalizedEventName = (_convertedEventNames$2 = convertedEventNames[eventName]) !== null && _convertedEventNames$2 !== void 0 ? _convertedEventNames$2 : eventName;
						var indexesToRemove = [];
						if (callback) {
							element.removeEventListener(normalizedEventName, callback);
							if (this.convertedEventsMap[normalizedEventName]) {
								this.convertedEventsMap[normalizedEventName].forEach(function(storedCallbacks, index) {
									if (storedCallbacks.givenCallback === callback) {
										indexesToRemove.push(index);
										element.removeEventListener(normalizedEventName, storedCallbacks.eventListenerCallback);
									}
								});
								indexesToRemove.forEach(function(index) {
									if (_this2.convertedEventsMap[normalizedEventName]) _this2.convertedEventsMap[normalizedEventName].splice(index, 1);
								});
							}
						} else this.convertedEventsMap[normalizedEventName] = [];
					}
				}
			]);
		}();
	},
	2721(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			$: () => usePlayerData,
			z: () => PlayerDataProvider
		});
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var preact_hooks__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3817);
		var PlayerDataContext = (0, preact__WEBPACK_IMPORTED_MODULE_0__.createContext)(null);
		var PlayerDataProvider = function PlayerDataProvider(_ref) {
			var children = _ref.children, embedOptions = _ref.embedOptions, mediaData = _ref.mediaData;
			return (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(PlayerDataContext.Provider, { value: {
				embedOptions,
				mediaData
			} }, children);
		};
		var usePlayerData = function usePlayerData() {
			var context = (0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useContext)(PlayerDataContext);
			if (context == null) throw new Error("usePlayerData must be used within a PlayerDataProvider");
			return context;
		};
	},
	2760(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			$1: () => AFTER_REPLACE_EVENT,
			Gd: () => MUTE_CHANGE_EVENT,
			c5: () => API_READY_EVENT,
			dp: () => IMPL_CREATED_EVENT,
			iP: () => INTERNAL_API_ON_FIND_EVENT,
			kY: () => BEFORE_REPLACE_EVENT,
			rO: () => LOADED_MEDIA_DATA_EVENT,
			ve: () => INPUT_CONTEXT_CHANGE_EVENT
		});
		var AFTER_REPLACE_EVENT = "after-replace";
		var API_READY_EVENT = "api-ready";
		var BEFORE_REPLACE_EVENT = "before-replace";
		var BETWEENTIMES_EVENT_EV1 = "betweentimes";
		var CROSSTIME_EVENT_EV1 = "crosstime";
		var EMBED_OPTIONS_CHANGED_EVENT = "embed-options-changed";
		var IMPL_CREATED_EVENT = "impl-created";
		var INIT_EMBED_EVENT = "initembed";
		var INPUT_CONTEXT_CHANGE_EVENT = "input-context-change";
		var INTERNAL_API_ON_FIND_EVENT = "internal-api-on-find";
		var LOADED_MEDIA_DATA_EVENT = "loaded-media-data";
		var MUTE_CHANGE_EVENT = "mute-change";
		var PLAYER_COLOR_CHANGE_EVENT = "playercolorchange";
		var TIME_UPDATE_EVENT = "time-update";
	},
	2917(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Lg: () => getLocalStorage,
			yo: () => updateLocalStorage
		});
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5509);
		var throwAsync = function throwAsync(e) {
			setTimeout(function() {
				throw e;
			}, 0);
		};
		var OBJ_PROP = "_namespacedLocalStorage";
		var localStorageWorks = function localStorageWorks() {
			var ns = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "wistia-test-localstorage";
			try {
				if (typeof localStorage === "undefined") return false;
				if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._localStorageWorks != null) return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._localStorageWorks;
				var currentVal = localStorage.getItem(ns);
				localStorage.removeItem(ns);
				localStorage.setItem(ns, currentVal);
				localStorage.removeItem(ns);
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._localStorageWorks = true;
			} catch (e) {
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._localStorageWorks = false;
			}
			return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._localStorageWorks;
		};
		var getMemory = function getMemory() {
			if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s[OBJ_PROP] == null) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s[OBJ_PROP] = {};
			return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s[OBJ_PROP];
		};
		var getLocalStorage = function getLocalStorage(ns) {
			if (!localStorageWorks()) return getMemory()[ns] || {};
			if (localStorage[ns]) try {
				if (localStorage[ns] === "null") return {};
				return JSON.parse(localStorage[ns]);
			} catch (e) {
				throwAsync(e);
			}
			return {};
		};
		var removeLocalStorage = function removeLocalStorage(ns) {
			if (!localStorageWorks()) {
				getMemory()[ns] = {};
				return;
			}
			try {
				localStorage.removeItem(ns);
			} catch (e) {
				throwAsync(e);
			}
		};
		var setLocalStorage = function setLocalStorage(ns, obj) {
			if (!localStorageWorks()) {
				if (obj != null && typeof obj === "object") getMemory()[ns] = obj;
				return obj;
			}
			try {
				getMemory()[ns] = obj;
				localStorage[ns] = JSON.stringify(obj);
			} catch (e) {
				throwAsync(e);
			}
			return obj;
		};
		var updateLocalStorage = function updateLocalStorage(ns, fn) {
			var obj = getLocalStorage(ns);
			try {
				fn(obj);
			} catch (e) {
				throwAsync(e);
			}
			return setLocalStorage(ns, obj);
		};
	},
	3065(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { j: () => fetchMediaData });
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var _hosts_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5857);
		var _media_data_transforms_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(3917);
		var _remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(3411);
		var _mediaDataError_ts__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(959);
		var _embeds_wistiaPlayer_utilities_getPreferredLanguageIndex_ts__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(4400);
		var _viewerPreferences_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(7438);
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _regenerator() {
			/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag";
			function i(r, n, o, i) {
				var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype);
				return _regeneratorDefine2(u, "_invoke", function(r, n, o) {
					var i, c, u, f = 0, p = o || [], y = !1, G = {
						p: 0,
						n: 0,
						v: e,
						a: d,
						f: d.bind(e, 4),
						d: function d(t, r) {
							return i = t, c = 0, u = e, G.n = r, a;
						}
					};
					function d(r, n) {
						for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) {
							var o, i = p[t], d = G.p, l = i[2];
							r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0));
						}
						if (o || r > 1) return a;
						throw y = !0, n;
					}
					return function(o, p, l) {
						if (f > 1) throw TypeError("Generator is already running");
						for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) {
							i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u);
							try {
								if (f = 2, i) {
									if (c || (o = "next"), t = i[o]) {
										if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object");
										if (!t.done) return t;
										u = t.value, c < 2 && (c = 0);
									} else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1);
									i = e;
								} else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break;
							} catch (t) {
								i = e, c = 1, u = t;
							} finally {
								f = 1;
							}
						}
						return {
							value: t,
							done: y
						};
					};
				}(r, o, i), !0), u;
			}
			var a = {};
			function Generator() {}
			function GeneratorFunction() {}
			function GeneratorFunctionPrototype() {}
			t = Object.getPrototypeOf;
			var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function() {
				return this;
			}), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c);
			function f(e) {
				return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e;
			}
			return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function() {
				return this;
			}), _regeneratorDefine2(u, "toString", function() {
				return "[object Generator]";
			}), (_regenerator = function _regenerator() {
				return {
					w: i,
					m: f
				};
			})();
		}
		function _regeneratorDefine2(e, r, n, t) {
			var i = Object.defineProperty;
			try {
				i({}, "", {});
			} catch (e) {
				i = 0;
			}
			_regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) {
				function o(r, n) {
					_regeneratorDefine2(e, r, function(e) {
						return this._invoke(r, n, e);
					});
				}
				r ? i ? i(e, r, {
					value: n,
					enumerable: !t,
					configurable: !t,
					writable: !t
				}) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2));
			}, _regeneratorDefine2(e, r, n, t);
		}
		function asyncGeneratorStep(n, t, e, r, o, a, c) {
			try {
				var i = n[a](c), u = i.value;
			} catch (n) {
				e(n);
				return;
			}
			i.done ? t(u) : Promise.resolve(u).then(r, o);
		}
		function _asyncToGenerator(n) {
			return function() {
				var t = this, e = arguments;
				return new Promise(function(r, o) {
					var a = n.apply(t, e);
					function _next(n) {
						asyncGeneratorStep(a, r, o, _next, _throw, "next", n);
					}
					function _throw(n) {
						asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);
					}
					_next(void 0);
				});
			};
		}
		var fetchUnlocalizedMediaData = /*#__PURE__*/ function() {
			var _ref = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee(hashedId) {
				var _options$channelPassw, _options$plugin, _options$plugin$passw;
				var options, cacheKey, mediaDataFromCache, host, url, channelPasswordParam, promise, _args = arguments;
				return _regenerator().w(function(_context) {
					while (1) switch (_context.n) {
						case 0:
							options = _args.length > 1 && _args[1] !== void 0 ? _args[1] : {};
							cacheKey = hashedId;
							mediaDataFromCache = (0, _remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_4__.F2)(cacheKey);
							if (!(mediaDataFromCache && options.skipCache !== true)) {
								_context.n = 1;
								break;
							}
							return _context.a(2, Promise.resolve(mediaDataFromCache));
						case 1:
							if (!((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._mediaDataPromises[cacheKey]) && options.skipCache !== true)) {
								_context.n = 2;
								break;
							}
							return _context.a(2, _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._mediaDataPromises[cacheKey]);
						case 2:
							host = (0, _hosts_js__WEBPACK_IMPORTED_MODULE_2__.Dd)(options);
							url = new window.URL("https://".concat(host, "/embed/medias/").concat(hashedId, ".json"));
							if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(options.channelId)) url.searchParams.set("channelId", options.channelId.toString());
							channelPasswordParam = (_options$channelPassw = options.channelPassword) !== null && _options$channelPassw !== void 0 ? _options$channelPassw : (_options$plugin = options.plugin) === null || _options$plugin === void 0 ? void 0 : (_options$plugin$passw = _options$plugin.passwordProtectedChannel) === null || _options$plugin$passw === void 0 ? void 0 : _options$plugin$passw.password;
							if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(channelPasswordParam)) url.searchParams.set("channelPassword", channelPasswordParam);
							if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(options.password)) url.searchParams.set("password", options.password);
							if (options.deferFetchingToCarousel) url.searchParams.set("defer_fetching_to_carousel", "true");
							if (options.bypassOriginShield) url.searchParams.set("bos", "1");
							promise = fetch(url.href).then(function(resp) {
								return resp.json();
							}).then(function(response) {
								var _mediaData$hashedId;
								if ((0, _mediaDataError_ts__WEBPACK_IMPORTED_MODULE_5__.V)(response)) return response;
								var mediaData = response.media;
								(0, _media_data_transforms_js__WEBPACK_IMPORTED_MODULE_3__.M)(mediaData, options);
								(0, _remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_4__.ry)((_mediaData$hashedId = mediaData.hashedId) !== null && _mediaData$hashedId !== void 0 ? _mediaData$hashedId : "", mediaData);
								return mediaData;
							}).finally(function() {
								Reflect.deleteProperty(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._mediaDataPromises, cacheKey);
							});
							_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._mediaDataPromises[cacheKey] = promise;
							return _context.a(2, promise);
					}
				}, _callee);
			}));
			return function fetchUnlocalizedMediaData(_x) {
				return _ref.apply(this, arguments);
			};
		}();
		var fetchMediaData = /*#__PURE__*/ function() {
			var _ref3 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee2(hashedId) {
				var options, mediaDataOrError, mediaData, typedViewerPreferences, localizationViewerPreferences, preferredLanguages, uniquePreferredLanguages, preferredLanguageIndex, _navigator$languages, preferredLocalization, _args2 = arguments;
				return _regenerator().w(function(_context2) {
					while (1) switch (_context2.n) {
						case 0:
							options = _args2.length > 1 && _args2[1] !== void 0 ? _args2[1] : {};
							_context2.n = 1;
							return fetchUnlocalizedMediaData(hashedId, options);
						case 1:
							mediaDataOrError = _context2.v;
							if (!(0, _mediaDataError_ts__WEBPACK_IMPORTED_MODULE_5__.V)(mediaDataOrError)) {
								_context2.n = 2;
								break;
							}
							return _context2.a(2, mediaDataOrError);
						case 2:
							mediaData = mediaDataOrError;
							if (!(mediaData.localizations == null || mediaData.localizations.length === 0)) {
								_context2.n = 3;
								break;
							}
							return _context2.a(2, mediaData);
						case 3:
							typedViewerPreferences = (0, _viewerPreferences_js__WEBPACK_IMPORTED_MODULE_7__.hy)();
							localizationViewerPreferences = typedViewerPreferences.localization;
							preferredLanguages = [];
							if (options.overrideMediaLanguage != null) preferredLanguages.push(options.overrideMediaLanguage);
							if ((localizationViewerPreferences === null || localizationViewerPreferences === void 0 ? void 0 : localizationViewerPreferences.bcp47LanguageTag) != null) preferredLanguages.push(localizationViewerPreferences.bcp47LanguageTag);
							if (options.defaultMediaLanguage != null) preferredLanguages.push(options.defaultMediaLanguage);
							uniquePreferredLanguages = preferredLanguages.filter(function(lang, index) {
								return preferredLanguages.indexOf(lang) === index;
							});
							preferredLanguageIndex = (0, _embeds_wistiaPlayer_utilities_getPreferredLanguageIndex_ts__WEBPACK_IMPORTED_MODULE_6__.J)(mediaData.localizations.map(function(loc) {
								return loc.bcp47LanguageTag;
							}), uniquePreferredLanguages);
							if (preferredLanguageIndex === -1) preferredLanguageIndex = (0, _embeds_wistiaPlayer_utilities_getPreferredLanguageIndex_ts__WEBPACK_IMPORTED_MODULE_6__.J)(mediaData.localizations.map(function(loc) {
								return loc.wistiaLanguageCode;
							}), uniquePreferredLanguages);
							if (preferredLanguageIndex === -1) preferredLanguageIndex = (0, _embeds_wistiaPlayer_utilities_getPreferredLanguageIndex_ts__WEBPACK_IMPORTED_MODULE_6__.J)(mediaData.localizations.map(function(loc) {
								return loc.bcp47LanguageTag;
							}), _toConsumableArray((_navigator$languages = navigator.languages) !== null && _navigator$languages !== void 0 ? _navigator$languages : ["en"]));
							if (!(preferredLanguageIndex >= 0)) {
								_context2.n = 6;
								break;
							}
							preferredLocalization = mediaData.localizations[preferredLanguageIndex];
							if (!(mediaData.hashedId === preferredLocalization.hashedId)) {
								_context2.n = 4;
								break;
							}
							return _context2.a(2, mediaData);
						case 4:
							if (!(preferredLocalization.localizationIntent === "alternate_audio")) {
								_context2.n = 5;
								break;
							}
							return _context2.a(2, mediaData);
						case 5: return _context2.a(2, fetchUnlocalizedMediaData(preferredLocalization.hashedId, _objectSpread({}, options)));
						case 6: return _context2.a(2, mediaData);
					}
				}, _callee2);
			}));
			return function fetchMediaData(_x2) {
				return _ref3.apply(this, arguments);
			};
		}();
	},
	3123(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			JA: () => getDefaultPlayerBorderRadius,
			Ru: () => getDefaultControlBarDistance,
			gl: () => getDefaultBigPlayButtonBorderRadius
		});
		var BIG_PLAY_BUTTON_RADIUS_RATIO = .75;
		var CONTROL_BAR_DISTANCE_RATIO = .75;
		var FLOATING_CONTROL_BAR_RADIUS = 18;
		var FLOATING_CONTROL_BAR_DISTANCE = 6;
		/**
		* Takes rounded player embed options and returns the calculated player border radius.
		* @param {EmbedOptions} embedOptions
		* @returns {number}
		*/
		var getDefaultPlayerBorderRadius = function getDefaultPlayerBorderRadius(_ref) {
			var playerBorderRadius = _ref.playerBorderRadius, roundedPlayer = _ref.roundedPlayer;
			if (roundedPlayer !== void 0) return roundedPlayer;
			if (playerBorderRadius !== void 0) return playerBorderRadius;
			return 0;
		};
		/**
		* Takes rounded player embed options and returns the calculated big play button border radius.
		* @param {EmbedOptions} embedOptions
		* @returns {number}
		*/
		var getDefaultBigPlayButtonBorderRadius = function getDefaultBigPlayButtonBorderRadius(_ref2) {
			var bigPlayButtonBorderRadius = _ref2.bigPlayButtonBorderRadius, roundedPlayer = _ref2.roundedPlayer;
			if (bigPlayButtonBorderRadius !== void 0) return bigPlayButtonBorderRadius;
			if (roundedPlayer !== void 0) return roundedPlayer * BIG_PLAY_BUTTON_RADIUS_RATIO;
			return 0;
		};
		/**
		* Takes rounded player embed options and returns the calculated control bar border radius.
		* @param {EmbedOptions} embedOptions
		* @returns {number}
		*/
		var getDefaultControlBarBorderRadius = function getDefaultControlBarBorderRadius(_ref3) {
			var controlBarBorderRadius = _ref3.controlBarBorderRadius, floatingControlBar = _ref3.floatingControlBar, roundedPlayer = _ref3.roundedPlayer;
			if (controlBarBorderRadius !== void 0) return controlBarBorderRadius;
			if (roundedPlayer !== void 0) return roundedPlayer * CONTROL_BAR_DISTANCE_RATIO;
			if (floatingControlBar === true) return FLOATING_CONTROL_BAR_RADIUS;
			return 0;
		};
		/**
		* Takes rounded player embed options and returns the calculated control bar distance.
		* @param {EmbedOptions} embedOptions
		* @returns {number}
		*/
		var getDefaultControlBarDistance = function getDefaultControlBarDistance(_ref4) {
			var controlBarBorderRadius = _ref4.controlBarBorderRadius, floatingControlBar = _ref4.floatingControlBar, roundedPlayer = _ref4.roundedPlayer;
			if (roundedPlayer !== void 0) return roundedPlayer / 4;
			if (controlBarBorderRadius !== void 0) return controlBarBorderRadius / 2;
			if (floatingControlBar === true) return FLOATING_CONTROL_BAR_DISTANCE;
			return 0;
		};
	},
	3164(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { E: () => ProgressiveThumbnail });
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var preact__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5181);
		var utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5857);
		var _Thumbnail_jsx__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5819);
		function _extends() {
			return _extends = Object.assign ? Object.assign.bind() : function(n) {
				for (var e = 1; e < arguments.length; e++) {
					var t = arguments[e];
					for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
				}
				return n;
			}, _extends.apply(null, arguments);
		}
		function _classCallCheck(a, n) {
			if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
		}
		function _defineProperties(e, r) {
			for (var t = 0; t < r.length; t++) {
				var o = r[t];
				o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
			}
		}
		function _createClass(e, r, t) {
			return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
		}
		function _callSuper(t, o, e) {
			return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
		}
		function _possibleConstructorReturn(t, e) {
			if (e && ("object" == typeof e || "function" == typeof e)) return e;
			if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
			return _assertThisInitialized(t);
		}
		function _assertThisInitialized(e) {
			if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
			return e;
		}
		function _isNativeReflectConstruct() {
			try {
				var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
			} catch (t) {}
			return (_isNativeReflectConstruct = function _isNativeReflectConstruct() {
				return !!t;
			})();
		}
		function _getPrototypeOf(t) {
			return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t) {
				return t.__proto__ || Object.getPrototypeOf(t);
			}, _getPrototypeOf(t);
		}
		function _inherits(t, e) {
			if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
			t.prototype = Object.create(e && e.prototype, { constructor: {
				value: t,
				writable: !0,
				configurable: !0
			} }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);
		}
		function _setPrototypeOf(t, e) {
			return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t, e) {
				return t.__proto__ = e, t;
			}, _setPrototypeOf(t, e);
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var ProgressiveThumbnail = /*#__PURE__*/ function(_Component) {
			function ProgressiveThumbnail(props) {
				var _this;
				_classCallCheck(this, ProgressiveThumbnail);
				_this = _callSuper(this, ProgressiveThumbnail, [props]);
				_defineProperty(_this, "afterTwoSeconds", function() {
					if (!_this._displayed && _this.state.normalThumbOpacity === 1) _this.setState({ normalThumbOpacity: 0 });
				});
				_defineProperty(_this, "onDisplayNormalThumb", function() {
					_this.setState({ normalThumbOpacity: 1 });
					_this._displayed = true;
					if (_this.onDisplay) _this.onDisplay();
				});
				_this.state = { normalThumbOpacity: props.isVisible ? 1 : 0 };
				_this.onDisplay = props.onDisplay;
				return _this;
			}
			_inherits(ProgressiveThumbnail, _Component);
			return _createClass(ProgressiveThumbnail, [
				{
					key: "componentWillReceiveProps",
					value: function componentWillReceiveProps(nextProps) {
						if (!this.onDisplay && nextProps.onDisplay) this.onDisplay = nextProps.onDisplay;
					}
				},
				{
					key: "render",
					value: function render() {
						if (this.props.isVisible) this._hasRenderedVisible = true;
						var sharedProps = {
							backgroundColor: this.props.backgroundColor,
							fitStrategy: this.props.fitStrategy,
							isVisible: this.props.isVisible,
							stillSnap: this.props.stillSnap,
							stretchLimit: this.props.stretchLimit,
							videoHeight: this.props.videoHeight,
							videoWidth: this.props.videoWidth,
							thumbnailAltText: this.props.thumbnailAltText,
							playerBorderRadius: this.props.playerBorderRadius
						};
						var swatchProps = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.kp)({}, sharedProps, {
							ariaHidden: true,
							images: [{ url: "".concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__.v9)(), "//").concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_2__.bC)(), "/embed/medias/").concat(this.props.hashedId, "/swatch") }]
						});
						var normalThumbProps = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.kp)({}, sharedProps, {
							onDisplay: this.onDisplayNormalThumb,
							images: this.props.images
						});
						return (0, preact__WEBPACK_IMPORTED_MODULE_1__.h)("div", { ref: this.props.elemRef }, this.props.swatchEnabled && this._hasRenderedVisible ? (0, preact__WEBPACK_IMPORTED_MODULE_1__.h)(_Thumbnail_jsx__WEBPACK_IMPORTED_MODULE_3__.V, _extends({}, swatchProps, { wrapperStyle: this.swatchWrapperStyle() })) : null, this._hasRenderedVisible ? (0, preact__WEBPACK_IMPORTED_MODULE_1__.h)(_Thumbnail_jsx__WEBPACK_IMPORTED_MODULE_3__.V, _extends({}, normalThumbProps, { wrapperStyle: this.normalThumbWrapperStyle() })) : null);
					}
				},
				{
					key: "componentDidMount",
					value: function componentDidMount() {
						this._fadeTimer = setTimeout(this.afterTwoSeconds, 2e3);
					}
				},
				{
					key: "componentWillUnmount",
					value: function componentWillUnmount() {
						clearTimeout(this._fadeTimer);
					}
				},
				{
					key: "normalThumbWrapperStyle",
					value: function normalThumbWrapperStyle() {
						var transition = this.props.swatchEnabled && this.props.uiHasRendered && this.state.normalThumbOpacity === 1 ? "opacity 3s" : "";
						return {
							height: "100%",
							left: 0,
							opacity: this.state.normalThumbOpacity,
							position: this.props.fitStrategy === "naturalHeight" ? "relative" : "absolute",
							top: 0,
							transition,
							width: "100%"
						};
					}
				},
				{
					key: "swatchWrapperStyle",
					value: function swatchWrapperStyle() {
						return {
							filter: "blur(5px)",
							height: "100%",
							left: 0,
							position: this.props.fitStrategy === "naturalHeight" ? "relative" : "absolute",
							top: 0,
							width: "100%"
						};
					}
				}
			]);
		}(preact__WEBPACK_IMPORTED_MODULE_1__.Component);
	},
	3280(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			gY: () => setEmbedOptionStore,
			iU: () => removeEmbedOptionStore
		});
		var _obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3997);
		var _getApiHandles_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5510);
		var OPTION_PREFIX = "wistia_embed_options_";
		var GLOBAL_ID_KEY = "__global__";
		/**
		* Get the embed options for a given key or embed id
		* @param {string} id - The key or embed id
		* @param {Function} [matcherFn=getOneApiHandle] - Custom matcher function
		* @returns {object}
		*/
		var getEmbedOptionStore = function getEmbedOptionStore(id) {
			var matcherFn = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : getOneApiHandle;
			if (wData([OPTION_PREFIX, id]) !== void 0) return wData([OPTION_PREFIX, id]);
			var apiHandleFromKey = matcherFn(id);
			if (apiHandleFromKey === null || apiHandleFromKey === "removed") return {};
			if (wData(OPTION_PREFIX) !== void 0) {
				var matchedKey = Object.keys(wData(OPTION_PREFIX)).find(function(key) {
					return matcherFn(key) === apiHandleFromKey;
				});
				if (wData([OPTION_PREFIX, matchedKey]) !== void 0) return wData([OPTION_PREFIX, matchedKey]);
			}
			return {};
		};
		/**
		* Set the embed options for a given key or embed id
		* @param {string} id - The key or embed id
		* @param {object} options - The options to set
		* @returns {object}
		*/
		var setEmbedOptionStore = function setEmbedOptionStore(id, options) {
			if (options !== null) return (0, _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__.m)([OPTION_PREFIX, id], (0, _obj_js__WEBPACK_IMPORTED_MODULE_0__.wg)((0, _obj_js__WEBPACK_IMPORTED_MODULE_0__.o8)(options)));
			return {};
		};
		/**
		* Remove the embed options for a given key or embed id
		* @param {string} id - The key or embed id
		* @param {object} options - The options to set
		* @returns {void}
		*/
		var removeEmbedOptionStore = function removeEmbedOptionStore(id) {
			(0, _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__.S)([OPTION_PREFIX, id]);
		};
		/**
		* Legacy behavior replacement for Wistia.options - Get or set embed options based
		* on the parameters provided
		* @param {string | object} id - The id of the embed or an object of options
		* @param {object} options - The options to set
		* @returns {object}
		*/
		var getOrSetEmbedOptionStore = function getOrSetEmbedOptionStore(id, options) {
			var optionsKey = id;
			var embedOptions = options;
			if (isObject(optionsKey) && typeof optionsKey === "object") {
				embedOptions = optionsKey;
				optionsKey = GLOBAL_ID_KEY;
			}
			if (embedOptions !== void 0 && embedOptions !== null) return wData([OPTION_PREFIX, optionsKey], cast(clone(embedOptions)));
			if (optionsKey !== void 0) {
				if (wData([OPTION_PREFIX, id]) !== void 0) return wData([OPTION_PREFIX, id]);
				var apiHandleFromKey = getOneApiHandle(optionsKey);
				if (apiHandleFromKey === null || apiHandleFromKey === "removed") return {};
				if (wData(OPTION_PREFIX) !== void 0) {
					var matchedKey = Object.keys(wData(OPTION_PREFIX)).find(function(key) {
						return getOneApiHandle(key) === apiHandleFromKey;
					});
					if (wData([OPTION_PREFIX, matchedKey]) !== void 0) return wData([OPTION_PREFIX, matchedKey]);
				}
				return {};
			}
			return wData(OPTION_PREFIX);
		};
	},
	3411(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			F2: () => getMediaDataFromCache,
			ry: () => cacheMediaData,
			s3: () => uncacheMediaData
		});
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var _wlog_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(6637);
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		var getMediaDataFromCache = function getMediaDataFromCache(hashedId) {
			var mediaData = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._remoteData.get("media_".concat(hashedId));
			if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.gD)(mediaData)) return null;
			if (_objectHasOwn(mediaData, "error")) _wlog_js__WEBPACK_IMPORTED_MODULE_2__.ct.error("Received cached error response instead of MediaData when retrieving cached mediaData for ".concat(hashedId));
			return mediaData;
		};
		var cacheMediaData = function cacheMediaData(hashedId, data) {
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._remoteData.set("media_".concat(hashedId), data);
		};
		var uncacheMediaData = function uncacheMediaData(hashedId) {
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._remoteData.delete("media_".concat(hashedId));
			Reflect.deleteProperty(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._mediaDataPromises, hashedId);
		};
		var cacheLiveStreamEventData = function cacheLiveStreamEventData(hashedId, data) {
			Wistia._remoteData.set("live_stream_event_".concat(hashedId), data);
		};
		var uncacheLiveStreamEventData = function uncacheLiveStreamEventData(hashedId) {
			Wistia._remoteData.delete("live_stream_event_".concat(hashedId));
		};
		var getLiveStreamEventDataFromCache = function getLiveStreamEventDataFromCache(hashedId) {
			var liveStreamEventData = Wistia._remoteData.get("live_stream_event_".concat(hashedId));
			if (isNil(liveStreamEventData)) return null;
			if (_objectHasOwn(liveStreamEventData, "error")) {
				wlog.error("Received cached error response instead of LiveStreamEventData when retrieving cached liveStreamEventData for ".concat(hashedId));
				uncacheLiveStreamEventData(hashedId);
			}
			return liveStreamEventData;
		};
		var getCarouselDataFromCache = function getCarouselDataFromCache(hashedId) {
			var carouselData = Wistia._remoteData.get("carousel_".concat(hashedId));
			if (isNil(carouselData)) return null;
			return carouselData;
		};
		var cacheCarouselData = function cacheCarouselData(hashedId, data) {
			Wistia._remoteData.set("carousel_".concat(hashedId), data);
		};
		var uncacheCarouselData = function uncacheCarouselData(hashedId) {
			Wistia._remoteData.delete("carousel_".concat(hashedId));
		};
	},
	3441(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			CR: () => seekToAction,
			Qy: () => shouldAddClipsFromChapters,
			Vq: () => shouldAddKeyMoments,
			oG: () => clipsFromChapters
		});
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var _normalizeChapters_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(9128);
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var DEFAULT_CHAPTER_TITLE = "Chapter Title";
		var MINIMUM_DURATION = 30;
		var shouldAddClipsFromChapters = function shouldAddClipsFromChapters(embedOptions) {
			var chapters = (0, _normalizeChapters_ts__WEBPACK_IMPORTED_MODULE_1__.a)(embedOptions);
			if (!chapters) return false;
			var chapterList = chapters.chapterList;
			return chapters.on !== false && chapters.on !== "false" && Array.isArray(chapterList) && chapterList.length > 0;
		};
		var shouldAddKeyMoments = function shouldAddKeyMoments(mediaData, embedOptions) {
			var _embedOptions$plugin;
			if (embedOptions.keyMoments === false) return false;
			var duration = mediaData.duration, type = mediaData.type;
			var _ref = (_embedOptions$plugin = embedOptions.plugin) !== null && _embedOptions$plugin !== void 0 ? _embedOptions$plugin : {}, passwordProtectedVideo = _ref.passwordProtectedVideo, turnstilePlugin = _ref["requireEmail-v1"], form = _ref.form;
			var isLiveStream = type === "LiveStream";
			var passwordEnabled = (passwordProtectedVideo === null || passwordProtectedVideo === void 0 ? void 0 : passwordProtectedVideo.on) === true || (passwordProtectedVideo === null || passwordProtectedVideo === void 0 ? void 0 : passwordProtectedVideo.on) === "true";
			var turnstileBlocksContent = turnstilePlugin && turnstilePlugin.on !== false && turnstilePlugin.time !== "end" && !turnstilePlugin.persistentTurnstile;
			var formBlocksContent = (form === null || form === void 0 ? void 0 : form.on) !== false && (form === null || form === void 0 ? void 0 : form.time) !== "end" && (form === null || form === void 0 ? void 0 : form.displayMode) === "pause";
			return !passwordEnabled && !turnstileBlocksContent && !formBlocksContent && !isLiveStream && typeof duration === "number" && duration >= MINIMUM_DURATION;
		};
		var sortedFilteredChapters = function sortedFilteredChapters(chapterList) {
			var chapterExistsAtTime = {};
			return _toConsumableArray(chapterList).sort(function(firstChapter, secondChapter) {
				return firstChapter.time - secondChapter.time;
			}).filter(function(_ref2) {
				var time = _ref2.time, title = _ref2.title, deleted = _ref2.deleted;
				if (Boolean(chapterExistsAtTime[time]) || deleted || title === DEFAULT_CHAPTER_TITLE) return false;
				chapterExistsAtTime[time] = true;
				return true;
			});
		};
		var clipsFromChapters = function clipsFromChapters(chapterList, baseUrl, mediaDuration) {
			if (!Array.isArray(chapterList) || chapterList.length === 0) return [];
			return sortedFilteredChapters(chapterList).map(function(chapter, index, chapters) {
				var time = chapter.time, title = chapter.title;
				var url = new window.URL(baseUrl);
				var floorTime = Math.floor(time);
				var nextChapter = chapters[index + 1];
				var endOffsetTime = (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(nextChapter) ? nextChapter.time : mediaDuration;
				url.searchParams.set("wtime", "".concat(floorTime, "s"));
				return {
					"@type": "Clip",
					endOffset: Math.floor(endOffsetTime),
					name: title,
					startOffset: floorTime,
					url: url.toString()
				};
			});
		};
		var seekToAction = function seekToAction() {
			var url = new window.URL(window.location.href);
			url.searchParams.set("wtime", "{seek_to_second_number}");
			return {
				"@type": "SeekToAction",
				target: url.toString().replace("%7Bseek_to_second_number%7D", "{seek_to_second_number}"),
				"startOffset-input": "required name=seek_to_second_number"
			};
		};
	},
	3695(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { Qy: () => setOrGet });
		var utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(4997);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(731);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5509);
		if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._localStorage) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._localStorage = (0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__.y1)();
		var uncache = function uncache() {
			Wistia._localStorage = {};
		};
		var setOrGet = function setOrGet(key, val) {
			var unset = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
			if (val != null) {
				var fn = unset ? utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.G0 : utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.vd;
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._localStorage = (0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__.$B)(function(ls) {
					return fn(ls, key, val);
				});
				return val;
			}
			if (key != null) return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_1__.b$)(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._localStorage, key);
			return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._localStorage;
		};
		var removeLocalStorage = function removeLocalStorage(key) {
			return setOrGet(key, "nada", true);
		};
		var dumpLocalStorage = null;
	},
	3737(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { L: () => doTimeout });
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var W = null;
		if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts == null) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts = {};
		var doTimeout = function doTimeout(key, fn) {
			var time = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 1;
			if ((0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.cy)(key)) key = key.join(".");
			var namespace = timeoutNamespace(key);
			clearTimeouts(key, namespace);
			if (fn) {
				var timeouts = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[namespace];
				if (timeouts == null) timeouts = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[namespace] = {};
				var timeoutId = setTimeout(function() {
					delete timeouts[key];
					fn();
				}, time);
				timeouts[key] = timeoutId;
				return timeoutId;
			}
			return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[namespace][key];
		};
		var clearTimeouts = function clearTimeouts(key) {
			var namespace = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
			if ((0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.cy)(key)) key = key.join(".");
			namespace = namespace || timeoutNamespace(key);
			var timeouts;
			if (namespace === "__global__") {
				timeouts = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[key];
				if (timeouts) for (var k in timeouts) {
					var v = timeouts[k];
					clearTimeout(v);
					delete timeouts[k];
				}
			}
			timeouts = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[namespace];
			if (timeouts) for (var _k in timeouts) {
				var _v = timeouts[_k];
				if (_k.indexOf && _k.indexOf(key) === 0 && (_k.length === key.length || _k.charAt(key.length) === ".")) {
					clearTimeout(_v);
					delete timeouts[_k];
				}
			}
			if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.blockSweepTimeouts) {
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.blockSweepTimeouts = true;
				setTimeout(sweepTimeouts, 0);
				setTimeout(function() {
					_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.blockSweepTimeouts = false;
				}, 5e3);
			}
		};
		var sweepTimeouts = function sweepTimeouts() {
			for (var namespace in _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts) {
				var timeouts = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[namespace];
				if ((0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.Im)(timeouts)) delete _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._timeouts[namespace];
			}
		};
		var timeoutNamespace = function timeoutNamespace(key) {
			var dotIndex = key.indexOf(".");
			if (dotIndex > 0) return key.substring(0, dotIndex);
			return "__global__";
		};
	},
	3817(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.r(__webpack_exports__);
		__webpack_require__.d(__webpack_exports__, {
			useCallback: () => q,
			useContext: () => x,
			useDebugValue: () => P,
			useEffect: () => y,
			useErrorBoundary: () => b,
			useId: () => g,
			useImperativeHandle: () => F,
			useLayoutEffect: () => _,
			useMemo: () => T,
			useReducer: () => h,
			useRef: () => A,
			useState: () => d
		});
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var t, r, u, i, o = 0, f = [], c = preact__WEBPACK_IMPORTED_MODULE_0__.options, e = c.__b, a = c.__r, v = c.diffed, l = c.__c, m = c.unmount, s = c.__;
		function p(n, t) {
			c.__h && c.__h(r, n, o || t), o = 0;
			var u = r.__H || (r.__H = {
				__: [],
				__h: []
			});
			return n >= u.__.length && u.__.push({}), u.__[n];
		}
		function d(n) {
			return o = 1, h(D, n);
		}
		function h(n, u, i) {
			var o = p(t++, 2);
			if (o.t = n, !o.__c && (o.__ = [i ? i(u) : D(void 0, u), function(n) {
				var t = o.__N ? o.__N[0] : o.__[0], r = o.t(t, n);
				t !== r && (o.__N = [r, o.__[1]], o.__c.setState({}));
			}], o.__c = r, !r.__f)) {
				var f = function(n, t, r) {
					if (!o.__c.__H) return !0;
					var u = o.__c.__H.__.filter(function(n) {
						return n.__c;
					});
					if (u.every(function(n) {
						return !n.__N;
					})) return !c || c.call(this, n, t, r);
					var i = o.__c.props !== n;
					return u.some(function(n) {
						if (n.__N) {
							var t = n.__[0];
							n.__ = n.__N, n.__N = void 0, t !== n.__[0] && (i = !0);
						}
					}), c && c.call(this, n, t, r) || i;
				};
				r.__f = !0;
				var c = r.shouldComponentUpdate, e = r.componentWillUpdate;
				r.componentWillUpdate = function(n, t, r) {
					if (this.__e) {
						var u = c;
						c = void 0, f(n, t, r), c = u;
					}
					e && e.call(this, n, t, r);
				}, r.shouldComponentUpdate = f;
			}
			return o.__N || o.__;
		}
		function y(n, u) {
			var i = p(t++, 3);
			!c.__s && C(i.__H, u) && (i.__ = n, i.u = u, r.__H.__h.push(i));
		}
		function _(n, u) {
			var i = p(t++, 4);
			!c.__s && C(i.__H, u) && (i.__ = n, i.u = u, r.__h.push(i));
		}
		function A(n) {
			return o = 5, T(function() {
				return { current: n };
			}, []);
		}
		function F(n, t, r) {
			o = 6, _(function() {
				if ("function" == typeof n) {
					var r = n(t());
					return function() {
						n(null), r && "function" == typeof r && r();
					};
				}
				if (n) return n.current = t(), function() {
					return n.current = null;
				};
			}, null == r ? r : r.concat(n));
		}
		function T(n, r) {
			var u = p(t++, 7);
			return C(u.__H, r) && (u.__ = n(), u.__H = r, u.__h = n), u.__;
		}
		function q(n, t) {
			return o = 8, T(function() {
				return n;
			}, t);
		}
		function x(n) {
			var u = r.context[n.__c], i = p(t++, 9);
			return i.c = n, u ? (i.__ ?? (i.__ = !0, u.sub(r)), u.props.value) : n.__;
		}
		function P(n, t) {
			c.useDebugValue && c.useDebugValue(t ? t(n) : n);
		}
		function b(n) {
			var u = p(t++, 10), i = d();
			return u.__ = n, r.componentDidCatch || (r.componentDidCatch = function(n, t) {
				u.__ && u.__(n, t), i[1](n);
			}), [i[0], function() {
				i[1](void 0);
			}];
		}
		function g() {
			var n = p(t++, 11);
			if (!n.__) {
				for (var u = r.__v; null !== u && !u.__m && null !== u.__;) u = u.__;
				var i = u.__m || (u.__m = [0, 0]);
				n.__ = "P" + i[0] + "-" + i[1]++;
			}
			return n.__;
		}
		function j() {
			for (var n; n = f.shift();) {
				var t = n.__H;
				if (n.__P && t) try {
					t.__h.some(z), t.__h.some(B), t.__h = [];
				} catch (r) {
					t.__h = [], c.__e(r, n.__v);
				}
			}
		}
		c.__b = function(n) {
			r = null, e && e(n);
		}, c.__ = function(n, t) {
			n && t.__k && t.__k.__m && (n.__m = t.__k.__m), s && s(n, t);
		}, c.__r = function(n) {
			a && a(n), t = 0;
			var i = (r = n.__c).__H;
			i && (u === r ? (i.__h = [], r.__h = [], i.__.some(function(n) {
				n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
			})) : (i.__h.some(z), i.__h.some(B), i.__h = [], t = 0)), u = r;
		}, c.diffed = function(n) {
			v && v(n);
			var t = n.__c;
			t && t.__H && (t.__H.__h.length && (1 !== f.push(t) && i === c.requestAnimationFrame || ((i = c.requestAnimationFrame) || w)(j)), t.__H.__.some(function(n) {
				n.u && (n.__H = n.u), n.u = void 0;
			})), u = r = null;
		}, c.__c = function(n, t) {
			t.some(function(n) {
				try {
					n.__h.some(z), n.__h = n.__h.filter(function(n) {
						return !n.__ || B(n);
					});
				} catch (r) {
					t.some(function(n) {
						n.__h && (n.__h = []);
					}), t = [], c.__e(r, n.__v);
				}
			}), l && l(n, t);
		}, c.unmount = function(n) {
			m && m(n);
			var t, r = n.__c;
			r && r.__H && (r.__H.__.some(function(n) {
				try {
					z(n);
				} catch (n) {
					t = n;
				}
			}), r.__H = void 0, t && c.__e(t, r.__v));
		};
		var k = "function" == typeof requestAnimationFrame;
		function w(n) {
			var t, r = function() {
				clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
			}, u = setTimeout(r, 35);
			k && (t = requestAnimationFrame(r));
		}
		function z(n) {
			var t = r, u = n.__c;
			"function" == typeof u && (n.__c = void 0, u()), r = t;
		}
		function B(n) {
			var t = r;
			n.__c = n.__(), r = t;
		}
		function C(n, t) {
			return !n || n.length !== t.length || t.some(function(t, r) {
				return t !== n[r];
			});
		}
		function D(n, t) {
			return "function" == typeof t ? t(n) : t;
		}
	},
	3832(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { i: () => extractEmailFromParams });
		var _core_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1627);
		var _wlog_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6637);
		/**
		* Extracts the email from the pageUrl and returns it if found
		* @param {string} pageUrl the url of the page
		* @returns {string | null} the email if found, null otherwise
		*/
		var extractEmailFromParams = function extractEmailFromParams(pageUrl) {
			var _exec, _exec2;
			var wemail = (_exec = /wemail=([^&#]+)/.exec(pageUrl)) !== null && _exec !== void 0 ? _exec : null;
			if (wemail) try {
				return decodeURIComponent(wemail[1]);
			} catch (_unused) {
				return wemail[1];
			}
			var wkey = (_exec2 = /wkey=([^&#]+)/.exec(pageUrl)) !== null && _exec2 !== void 0 ? _exec2 : null;
			if (wkey) {
				var base64Email = wkey[1];
				try {
					return (0, _core_js__WEBPACK_IMPORTED_MODULE_0__.u)(base64Email);
				} catch (error) {
					_wlog_js__WEBPACK_IMPORTED_MODULE_1__.ct.info("Failed to decode email from wkey", error);
				}
			}
			return null;
		};
	},
	3917(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { M: () => mediaDataTransforms });
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var utilities_url_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(2671);
		var utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7231);
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(9814);
		var _assets_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(7209);
		function _createForOfIteratorHelper(r, e) {
			var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (!t) {
				if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
					t && (r = t);
					var _n = 0, F = function F() {};
					return {
						s: F,
						n: function n() {
							return _n >= r.length ? { done: !0 } : {
								done: !1,
								value: r[_n++]
							};
						},
						e: function e(r) {
							throw r;
						},
						f: F
					};
				}
				throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
			}
			var o, a = !0, u = !1;
			return {
				s: function s() {
					t = t.call(r);
				},
				n: function n() {
					var r = t.next();
					return a = r.done, r;
				},
				e: function e(r) {
					u = !0, o = r;
				},
				f: function f() {
					try {
						a || null == t.return || t.return();
					} finally {
						if (u) throw o;
					}
				}
			};
		}
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var detect = (0, utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__.o1)();
		var convertStillImageToWebp = function convertStillImageToWebp(media) {
			if (media.assets && detect.webp) media.assets = media.assets.map(function(asset) {
				if (asset.type === "still_image" && Object(asset).url) {
					var url = new utilities_url_js__WEBPACK_IMPORTED_MODULE_1__.s0(asset.url);
					url.ext("webp");
					asset.url = url.absolute();
				}
				return asset;
			});
		};
		var maybeCloneOriginalAsMp4 = function maybeCloneOriginalAsMp4(media) {
			if ((arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}).allowOriginalAsMp4 !== true) return;
			var original = media.assets.filter(function(a) {
				return a.type === "original";
			})[0];
			if ((0, _assets_js__WEBPACK_IMPORTED_MODULE_4__.n9)(media.assets).length > 0) return;
			media.assets = [].concat(_toConsumableArray(media.assets), [(0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.kp)({}, original, {
				display_name: "".concat(original.display_name, " copy"),
				container: "mp4",
				codec: "h264",
				type: "mp4_video"
			})]);
		};
		var maybeAddChannelIdToEmbedOptions = function maybeAddChannelIdToEmbedOptions(media) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_3__.n9)(options.channelId) && media.embedOptions) media.embedOptions.channelId = options.channelId;
		};
		var maybeAddChannelPasswordToEmbedOptions = function maybeAddChannelPasswordToEmbedOptions(media) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_3__.n9)(options.channelPassword) && media.embedOptions) media.embedOptions.channelPassword = options.channelPassword;
		};
		var mergeFormCustomizations = function mergeFormCustomizations(formCustomizations, embedOptions) {
			if (!formCustomizations || !embedOptions) return;
			if (!embedOptions.plugin) embedOptions.plugin = {};
			if (!embedOptions.plugin.form) embedOptions.plugin.form = {};
			var form = embedOptions.plugin.form;
			if (formCustomizations.form_button_text) form.formButtonText = formCustomizations.form_button_text;
			if (formCustomizations.form_lower_text) form.formLowerText = formCustomizations.form_lower_text;
			if (formCustomizations.title) form.title = formCustomizations.title;
		};
		var mergeFormCustomizationsIntoEmbedOptions = function mergeFormCustomizationsIntoEmbedOptions(media) {
			mergeFormCustomizations(media.formCustomizations, media.embedOptions);
			if (Array.isArray(media.translatedMediaData)) {
				var _iterator = _createForOfIteratorHelper(media.translatedMediaData), _step;
				try {
					for (_iterator.s(); !(_step = _iterator.n()).done;) {
						var entry = _step.value;
						mergeFormCustomizations(entry.formCustomizations, entry.embedOptions);
					}
				} catch (err) {
					_iterator.e(err);
				} finally {
					_iterator.f();
				}
			}
		};
		var mediaDataTransforms = function mediaDataTransforms(media) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			maybeCloneOriginalAsMp4(media, options);
			convertStillImageToWebp(media);
			maybeAddChannelIdToEmbedOptions(media, options);
			maybeAddChannelPasswordToEmbedOptions(media, options);
			mergeFormCustomizationsIntoEmbedOptions(media);
			return media;
		};
	},
	3997(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			S: () => wRemoveData,
			m: () => wData
		});
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var wData = function wData(key, val) {
			if (!(0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.cy)(key)) key = key.split(".");
			if (val != null) (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.vd)(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s, ["_data"].concat(key), val);
			return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.b$)(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s, ["_data"].concat(key));
		};
		var wRemoveData = function wRemoveData(key) {
			if (!(0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.cy)(key)) key = key.split(".");
			return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.G0)(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s, ["_data"].concat(key));
		};
	},
	4271(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { mj: () => globalTrigger });
		var utilities_wbindable_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9376);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		(0, utilities_wbindable_js__WEBPACK_IMPORTED_MODULE_0__.R)(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
		var globalBind = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.bind.bind(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
		var globalOn = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.on.bind(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
		var globalOff = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.off.bind(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
		var globalRebind = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.rebind.bind(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
		var globalTrigger = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.trigger.bind(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
		var globalUnbind = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.unbind.bind(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s);
	},
	4309(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { wt: () => controlMultiplierEstimatedByWidth });
		var utilities_elem_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(7715);
		var utilities_timeout_utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3737);
		var utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7231);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(731);
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		var detect = (0, utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__.o1)();
		var scalingOptionsFromVideo = function scalingOptionsFromVideo(video, options) {
			return merge({
				videoWidth: video.videoWidth(),
				videoHeight: video.videoHeight(),
				isInFullscreen: video.inFullscreen(),
				controlScaling: video.controlScaling()
			}, options);
		};
		var controlDimensions = function controlDimensions() {
			var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			var baseWidth = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 40;
			var baseHeight = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 34;
			options = merge({
				videoWidth: 640,
				videoHeight: 360,
				isInFullscreen: false,
				baseWidth: baseWidth != null ? baseWidth : 40,
				baseHeight: baseHeight != null ? baseHeight : 34
			}, options);
			var multiplier = controlMultiplier(options);
			return {
				width: multiplier * options.baseWidth,
				height: multiplier * options.baseHeight
			};
		};
		var bigPlayButtonDimensions = function bigPlayButtonDimensions(options, baseWidth, baseHeight) {
			return controlDimensions(options, baseWidth, baseHeight);
		};
		var fontSizeMultiplier = function fontSizeMultiplier(options) {
			return controlMultiplier(options);
		};
		var allowBigControls = function allowBigControls() {
			var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			var screenHeight = options.screenHeight || window.screen.height;
			var screenWidth = options.screenWidth || window.screen.width;
			return options.controlScaling != "auto" || detect.iphone || detect.android || screenWidth < screenHeight;
		};
		var maxMultiplierForVideo = function maxMultiplierForVideo(options) {
			if (options.controlScaling != "auto") return options.controlScaling;
			if (allowBigControls(options)) return 3.5;
			return 1.4;
		};
		var minMultiplierForVideo = function minMultiplierForVideo(options) {
			if (options.controlScaling != "auto") return options.controlScaling;
			if (allowBigControls(options)) return 1;
			return .75;
		};
		var getZoomMultiplier = function getZoomMultiplier(options) {
			if (!options.isInFullscreen) return 1;
			return Math.max(1, window.innerWidth / Math.max(screen.width, screen.height));
		};
		var getDeviceMultiplier = function getDeviceMultiplier(options) {
			if (allowBigControls(options)) return 1.4;
			return 1;
		};
		var controlMultiplierForVideo = function controlMultiplierForVideo(video, options) {
			return controlMultiplier(scalingOptionsFromVideo(video, options));
		};
		var controlMultiplier = function controlMultiplier(options) {
			if (options.controlScaling != "auto") return options.controlScaling;
			var videoWidth = options.videoWidth, videoHeight = options.videoHeight;
			var zoomMultiplier = getZoomMultiplier(options);
			var largestDimension = Math.max(videoWidth, videoHeight);
			if (largestDimension > 960) {
				var scaleFactor = largestDimension / 960 * getDeviceMultiplier(options);
				return Math.min(maxMultiplierForVideo(options) * zoomMultiplier, scaleFactor * zoomMultiplier);
			}
			if (largestDimension < 640) {
				var _scaleFactor = largestDimension / 640 * getDeviceMultiplier(options);
				return Math.max(minMultiplierForVideo(options) * zoomMultiplier, _scaleFactor * zoomMultiplier);
			}
			return 1 * getDeviceMultiplier(options);
		};
		var menuMultiplier = function menuMultiplier(options) {
			return Math.max(.75, controlMultiplier(options));
		};
		var fitControl = function fitControl(options) {
			var _options = options, controlId = _options.controlId, video = _options.video, controlElem = _options.controlElem;
			options = merge({
				videoWidth: video.videoWidth(),
				videoHeight: video.videoHeight(),
				controlScaling: video.controlScaling(),
				isInFullscreen: video.inFullscreen()
			}, options);
			var _controlDimensions = controlDimensions(options), width = _controlDimensions.width, height = _controlDimensions.height;
			elemStyle(controlElem, {
				height: "".concat(height, "px"),
				width: "".concat(width, "px")
			});
			tapIcon("".concat(video.uuid, ".").concat(controlId), controlElem);
			return {
				width,
				height
			};
		};
		var tapIcon = function tapIcon(timeoutPrefix, controlElem) {
			var svgs = controlElem.getElementsByTagName("svg");
			for (var i = 0; i < svgs.length; i++) (function(svg) {
				doTimeout("".concat(timeoutPrefix, ".tap_icon"), function() {
					elemStyle(svg, { position: "relative" });
					doTimeout("#{timeoutPrefix}.tap_icon", function() {
						elemStyle(svg, { position: "" });
					}, 30);
				}, 30);
			})(svgs[i]);
		};
		var parseMetaViewport = function parseMetaViewport() {
			var metaTag = document.querySelector("meta[name=viewport]");
			var content = metaTag && metaTag.getAttribute("content");
			var result = {};
			if (content) content.split(/[\s,]+/).forEach(function(pair) {
				var keyAndVal = pair.split("=");
				if (keyAndVal.length === 2) result[keyAndVal[0]] = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_3__.wg)(keyAndVal[1]);
			});
			return result;
		};
		var normalScaleWidthRange = function normalScaleWidthRange(media) {
			if (!(detect.iphone || detect.ipad || detect.android)) return [640, 960];
			if (media !== null && media !== void 0 && media.isAudio()) return [500, 960];
			var viewport = parseMetaViewport();
			var screenWidth;
			if (viewport.width) {
				if (typeof viewport.width === "number") screenWidth = 0 + viewport.width;
				else screenWidth = screen.width || window.innerWidth;
				var scale = Math.max(viewport["minimum-scale"] || 0, Math.min(viewport["maximum-scale"] || 10, viewport["initial-scale"] || 1));
				if (scale < 1) screenWidth /= scale;
			} else screenWidth = window.innerWidth;
			return [screenWidth, screenWidth * 2 / 3];
		};
		var normalScaleHeightRange = function normalScaleHeightRange(media) {
			if (!(detect.iphone || detect.ipad || detect.android)) return [340, 860];
			if (media !== null && media !== void 0 && media.isAudio()) return [500, 960];
			var viewport = parseMetaViewport();
			var screenHeight;
			if (viewport.height) {
				if (typeof viewport.height === "number") screenHeight = 0 + viewport.height;
				else screenHeight = screen.height || window.innerHeight;
				var scale = Math.max(viewport["minimum-scale"] || 0, Math.min(viewport["maximum-scale"] || 10, viewport["initial-scale"] || 1));
				if (scale < 1) screenHeight /= scale;
			} else screenHeight = window.innerWidth;
			return [screenHeight, screenHeight * 2 / 1.3];
		};
		var controlMultiplierBasedOnVideo = function controlMultiplierBasedOnVideo(video, normalRange) {
			var vidWidth = video.videoWidth();
			var vidHeight = video.videoHeight();
			if (vidWidth / vidHeight < 1) {
				var _normalScaleHeightRan2 = _slicedToArray(normalScaleHeightRange(video), 2), lowerCutoff = _normalScaleHeightRan2[0], upperCutoff = _normalScaleHeightRan2[1];
				if (vidHeight <= lowerCutoff) return vidHeight / lowerCutoff;
				if (vidHeight > upperCutoff) return vidHeight / upperCutoff;
			} else {
				var _ref2 = _slicedToArray(normalRange || normalScaleWidthRange(video), 2), _lowerCutoff = _ref2[0], _upperCutoff = _ref2[1];
				if (vidWidth <= _lowerCutoff) return vidWidth / _lowerCutoff;
				if (vidWidth > _upperCutoff) return vidWidth / _upperCutoff;
			}
			return 1;
		};
		var controlMultiplierEstimatedByWidth = function controlMultiplierEstimatedByWidth(width, normalRange) {
			var _ref4 = _slicedToArray(normalRange || normalScaleWidthRange(), 2), lowerCutoff = _ref4[0], upperCutoff = _ref4[1];
			if (width <= lowerCutoff) return width / lowerCutoff;
			if (width > upperCutoff) return width / upperCutoff;
			return 1;
		};
	},
	4372(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			qN: () => getCssGradient,
			yz: () => getGradientColor
		});
		var _types_gradient_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(7350);
		var _color_utils_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(998);
		var _color_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5417);
		var _obj_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(731);
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		var DEFAULT_ALPHA = .9;
		var GRADIENT_COLOR_INDEX = 0;
		var GRADIENT_PERCENTAGE_INDEX = 1;
		var DEFAULT_GRADIENT = {
			colors: [[_color_utils_ts__WEBPACK_IMPORTED_MODULE_1__.cO, 0], ["#6A84FF", 1]],
			on: true
		};
		var hexToRGBA = function hexToRGBA(hex) {
			var alpha = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : DEFAULT_ALPHA;
			return new _color_js__WEBPACK_IMPORTED_MODULE_2__.Q1(hex).alpha(alpha).toRgba();
		};
		var decimalToPercentage = function decimalToPercentage(decimal) {
			return decimal * 100;
		};
		var getCssGradient = function getCssGradient(gradient) {
			var alpha = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : DEFAULT_ALPHA;
			if (gradient.colors.length === 0) return null;
			if (!gradient.colors.every(function(gradientColor) {
				return Boolean(gradientColor[GRADIENT_COLOR_INDEX] && gradientColor[GRADIENT_PERCENTAGE_INDEX] >= 0 && gradientColor[GRADIENT_PERCENTAGE_INDEX] <= 1);
			})) return null;
			return "linear-gradient(90deg, ".concat(gradient.colors.map(function(gradientColor) {
				return "".concat(hexToRGBA(gradientColor[0], alpha), " ").concat(decimalToPercentage(gradientColor[1]), "%");
			}).join(", "), ")");
		};
		var getGradientColor = function getGradientColor(gradient) {
			var index = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
			if (!(0, _types_gradient_ts__WEBPACK_IMPORTED_MODULE_0__.b)(gradient)) return null;
			return gradient.colors[index][GRADIENT_COLOR_INDEX];
		};
		var cleanGradient = function cleanGradient(gradient) {
			var casted = cast(clone(gradient));
			return {
				colors: casted.colors.map(function(_ref) {
					var _ref2 = _slicedToArray(_ref, 2), color = _ref2[0], percentage = _ref2[1];
					return [color.toString(), percentage];
				}),
				on: casted.on
			};
		};
		var getPlayerColorOrFirstGradientStop = function getPlayerColorOrFirstGradientStop(playerColor, gradient) {
			var _addHashToHex;
			if (!isGradient(gradient) || !gradient.on) return playerColor !== null && playerColor !== void 0 ? playerColor : DEFAULT_PLAYER_COLOR;
			var firstGradientColorStop = getGradientColor(gradient);
			if (isNil(firstGradientColorStop)) return playerColor !== null && playerColor !== void 0 ? playerColor : DEFAULT_PLAYER_COLOR;
			return (_addHashToHex = addHashToHex(firstGradientColorStop)) !== null && _addHashToHex !== void 0 ? _addHashToHex : DEFAULT_PLAYER_COLOR;
		};
	},
	4400(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { J: () => getPreferredAvailableLanguageIndex });
		function _createForOfIteratorHelper(r, e) {
			var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (!t) {
				if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
					t && (r = t);
					var _n = 0, F = function F() {};
					return {
						s: F,
						n: function n() {
							return _n >= r.length ? { done: !0 } : {
								done: !1,
								value: r[_n++]
							};
						},
						e: function e(r) {
							throw r;
						},
						f: F
					};
				}
				throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
			}
			var o, a = !0, u = !1;
			return {
				s: function s() {
					t = t.call(r);
				},
				n: function n() {
					var r = t.next();
					return a = r.done, r;
				},
				e: function e(r) {
					u = !0, o = r;
				},
				f: function f() {
					try {
						a || null == t.return || t.return();
					} finally {
						if (u) throw o;
					}
				}
			};
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var getAlpha2Code = function getAlpha2Code(iso6392Code) {
			return iso6392Code.split("-")[0];
		};
		var getStack = function getStack() {
			var _err$stack;
			return (_err$stack = (/* @__PURE__ */ new Error()).stack) === null || _err$stack === void 0 ? void 0 : _err$stack.split("\n").slice(2).join("\n");
		};
		/**
		* Finds the index of the preferred language from a list of available languages.
		*
		* This function helps select the best matching language based on user preferences and browser settings.
		* It's designed to work with arrays of ISO 639-2 language codes, optionally with region codes (e.g. 'en' or 'en-US'),
		* but can also be used for matching alpha3 ietf language tags, e.g. "eng".
		*
		* @param availableLanguages - Array of language codes that are available to choose from
		* @param preferredLanguages - Array of language codes to try matching
		* @returns The index of the best matching language in the availableLanguages array, or -1 if no languages are available
		*
		* @example
		* const captions = [
		*   { language: 'en', text: 'Hello' },
		*   { language: 'es', text: 'Hola' }
		* ];
		* const index = getPreferredAvailableLanguageIndex(
		*   captions.map(c => c.language),
		*   ['es']
		* );
		* const preferredCaption = captions[index];
		*/
		var getPreferredAvailableLanguageIndex = function getPreferredAvailableLanguageIndex(availableLanguages, preferredLanguages) {
			if (availableLanguages.some(function(lang) {
				return typeof lang !== "string";
			})) {
				console.error("availableLanguages has non-string values", availableLanguages, getStack());
				availableLanguages = availableLanguages.filter(function(lang) {
					return typeof lang === "string";
				});
			}
			if (preferredLanguages.some(function(lang) {
				return typeof lang !== "string";
			})) {
				console.error("preferredLanguages has non-string values", preferredLanguages, getStack());
				preferredLanguages = preferredLanguages.filter(function(lang) {
					return typeof lang === "string";
				});
			}
			var _iterator = _createForOfIteratorHelper(preferredLanguages), _step;
			try {
				var _loop = function _loop() {
					var preferredLanguage = _step.value;
					if (availableLanguages.includes(preferredLanguage)) return { v: availableLanguages.indexOf(preferredLanguage) };
					var preferredAlpha2 = getAlpha2Code(preferredLanguage);
					if (availableLanguages.some(function(lang) {
						return getAlpha2Code(lang) === preferredAlpha2;
					})) return { v: availableLanguages.findIndex(function(lang) {
						return getAlpha2Code(lang) === preferredAlpha2;
					}) };
				}, _ret;
				for (_iterator.s(); !(_step = _iterator.n()).done;) {
					_ret = _loop();
					if (_ret) return _ret.v;
				}
			} catch (err) {
				_iterator.e(err);
			} finally {
				_iterator.f();
			}
			return -1;
		};
	},
	4635(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			YG: () => blankImage,
			cd: () => bestImage,
			eZ: () => sortedImages
		});
		var utilities_hosts_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5857);
		var utilities_root_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(8176);
		var bestImage = function bestImage(images) {
			var opts = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var _sortedImages = sortedImages(images);
			if (_sortedImages.length === 0) return blankImage(opts.videoWith, opts.videoHeight);
			var currentWidth = opts.videoWidth;
			var desiredWidth = (utilities_root_js__WEBPACK_IMPORTED_MODULE_1__.z.devicePixelRatio || 1) * currentWidth;
			if (desiredWidth <= _sortedImages[0].width) return _sortedImages[0];
			for (var i = 0; i < _sortedImages.length; i++) {
				var image = _sortedImages[i];
				if (image.width >= desiredWidth) return image;
			}
			return _sortedImages[_sortedImages.length - 1];
		};
		var blankImage = function blankImage(videoWidth, videoHeight) {
			return {
				height: videoHeight,
				url: "https://".concat((0, utilities_hosts_js__WEBPACK_IMPORTED_MODULE_0__.aY)(), "/assets/images/blank.gif"),
				width: videoWidth
			};
		};
		var sortedImages = function sortedImages(images) {
			return images.map(function(image) {
				image.aspect = image.width / image.height;
				return image;
			});
		};
	},
	4719(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { e: () => BigPlayButtonLoadingAnim });
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var preact_hooks__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3817);
		var _utilities_elem_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7715);
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		var BigPlayButtonLoadingAnim = function BigPlayButtonLoadingAnim() {
			var svgEl = (0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useRef)(null);
			var _useState2 = _slicedToArray((0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState)(false), 2), isAnimating = _useState2[0], setIsAnimating = _useState2[1];
			(0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useEffect)(function() {
				(0, _utilities_elem_js__WEBPACK_IMPORTED_MODULE_2__.Ev)(svgEl.current, "\n        @keyframes w-loading-pulse {\n          from {\n            stroke-dashoffset: 55;\n          }\n          to {\n            stroke-dashoffset: -175;\n          }\n        }\n        .w-big-play-button-loading-anim {\n          stroke-dasharray: 50 260;\n          stroke-dashoffset: 55;\n          animation: w-loading-pulse 1.2s infinite cubic-bezier(0.65, 0, 0, 1);\n        }\n      ");
				setIsAnimating(true);
			}, []);
			return (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("line", {
				ref: svgEl,
				class: "w-big-play-button-loading-anim",
				x1: "0",
				y1: "78",
				x2: "125",
				y2: "78",
				style: {
					stroke: "currentcolor",
					strokeWidth: 4,
					strokeLinecap: "round",
					opacity: isAnimating ? 1 : 0
				}
			});
		};
	},
	4730(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Oj: () => defineTranslations,
			Z0: () => getLanguage,
			sC: () => getTranslation
		});
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var utilities_dynamicImport_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(7157);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5509);
		var languages = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.languages = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.languages || {};
		var translations = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.translations = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.translations || {};
		if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._translationPromises) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s._translationPromises = {};
		var supportedLanguages = [
			"ar",
			"de",
			"es",
			"en-US",
			"fr",
			"it",
			"ja",
			"ko",
			"pt",
			"ru",
			"zh-CN"
		];
		var ietfLanguageTagToCode = {
			ara: "ar",
			ger: "de",
			spa: "es",
			eng: "en-US",
			fre: "fr",
			ita: "it",
			jpn: "ja",
			kor: "ko",
			por: "pt",
			rus: "ru",
			chi: "zh-CN"
		};
		var normalizeLanguageCode = function normalizeLanguageCode(code) {
			if (code == null) return "en-US";
			code = ietfLanguageTagToCode[code] || code;
			if (!supportedLanguages.includes(code)) {
				var match = matchingLanguages(function() {
					return [code];
				})[0];
				if (match) code = match;
			}
			if (code === "en" || /^en-/.test(code)) code = "en-US";
			if (code === "zh" || /^zh-/.test(code)) code = "zh-CN";
			return code;
		};
		var defineLanguage = function defineLanguage(code, text, translations) {
			languages[code] = {
				code,
				text: decodeEntities(text)
			};
			if (translations) defineTranslations(code, translations);
		};
		var getLanguage = function getLanguage(code) {
			return languages[normalizeLanguageCode(code)];
		};
		var isSupportedPlayerLanguage = function isSupportedPlayerLanguage(code) {
			return supportedLanguages.includes(normalizeLanguageCode(code));
		};
		var defineTranslations = function defineTranslations(code, keyValPairs) {
			if (languages[code] == null) throw new Error("Must define a language with code ".concat(code, " before defining its translations."));
			var translation = translations[code];
			if (translation) (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.h1)(translation, keyValPairs);
			else translations[code] = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.o8)(keyValPairs);
		};
		var withFallbackText = function withFallbackText(text) {
			if (text == null) return "?";
			return text;
		};
		var dummyTextArea;
		var cachedDecodings = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.cachedDecodings = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.cachedDecodings || {};
		var decodeEntities = function decodeEntities(text) {
			if (!dummyTextArea) dummyTextArea = document.createElement("textarea");
			if (cachedDecodings[text] != null) return cachedDecodings[text];
			dummyTextArea.innerHTML = text;
			cachedDecodings[text] = dummyTextArea.value;
			return dummyTextArea.value;
		};
		var getTranslation = function getTranslation(code, key) {
			code = normalizeLanguageCode(code);
			var text;
			if (translations[code] && translations[code][key]) text = translations[code][key];
			else text = translations["en-US"][key];
			return decodeEntities(withFallbackText(text));
		};
		/**
		* Gets translations for the specified language code and keys
		* @param {string} code - The language code to get translations for
		* @param {string[]} [keys=[]] - Array of translation keys to retrieve
		* @returns {Record<string, string>} Object containing the translations with keys as properties
		*/
		var getTranslations = function getTranslations(code) {
			var keys = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : [];
			var translations = {};
			keys.forEach(function(key) {
				translations[key] = getTranslation(code, key);
			});
			return translations;
		};
		var getLanguagePreference = function getLanguagePreference() {
			if (navigator.languages || navigator.language) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.languagePreference = navigator.languages || [navigator.language];
			else _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.languagePreference = ["en-US"];
			return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_2__.s.languagePreference;
		};
		var defaultPromise = Promise.resolve({
			code: "en-US",
			translations: translations["en-US"]
		});
		var loadAndDefineTranslation = function loadAndDefineTranslation(code) {
			code = normalizeLanguageCode(code);
			if (!supportedLanguages.includes(code)) return defaultPromise;
			if (Wistia._translationPromises[code]) return Wistia._translationPromises[code];
			if (code === "en-US") return defaultPromise;
			var result = new Promise(function(resolve, reject) {
				dynamicImport(["assets/external/translations/".concat(code, ".js")]).then(function(moduleClass) {
					var languageCode = moduleClass.languageCode, languageLabel = moduleClass.languageLabel, translations = moduleClass.translations;
					defineLanguage(languageCode, languageLabel, translations);
					resolve({
						code,
						translations: translations[code]
					});
				}).catch(reject);
			});
			Wistia._translationPromises[code] = result;
			return result;
		};
		var matchingLanguages = function matchingLanguages() {
			return (arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getLanguagePreference)().reduce(function(matches, langCode) {
				var isFullMatch = supportedLanguages.indexOf(langCode) !== -1;
				var partialLangCode = langCode.split("-")[0];
				var isPartialMatch = supportedLanguages.indexOf(partialLangCode) !== -1;
				if (isFullMatch) matches.push(langCode);
				else if (isPartialMatch) matches.push(partialLangCode);
				return matches;
			}, []);
		};
		var getDefaultTranslation = function getDefaultTranslation() {
			var matchingLanguage = matchingLanguages()[0];
			if (!matchingLanguage || matchingLanguage === "en") matchingLanguage = "en-US";
			if (translations[matchingLanguage]) return Promise.resolve({
				code: matchingLanguage,
				translations: translations[matchingLanguage]
			});
			return loadAndDefineTranslation(matchingLanguage);
		};
		defineLanguage("en-US", "English");
		defineTranslations("en-US", {
			PAUSE: "Pause",
			PLAY: "Play",
			PLAY_BUTTON_LIVE_NOT_STARTED: "Livestream has not started",
			PLAY_BUTTON_TITLE_WHEN_NOT_PLAYING: "Play Video",
			PLAY_BUTTON_TITLE_WHEN_PLAYING: "Pause Video",
			REWATCH: "Rewatch",
			SKIP: "Skip"
		});
	},
	4755(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { D5: () => isVisitorTrackingEnabled });
		var utilities_globalBindAndTrigger_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(4271);
		var utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(4997);
		var utilities_getApiHandles_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5510);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5509);
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var migrateLegacyVisitorTracking = function migrateLegacyVisitorTracking() {
			var legacyIsEnabled = (0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_1__.y1)().visitorTrackingEnabled;
			if (legacyIsEnabled != null) {
				(0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_1__.$B)(function(ls) {
					return delete ls.visitorTrackingEnabled;
				});
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking = {};
				_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking[_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTrackingDomain] = {
					isEnabled: legacyIsEnabled,
					updatedAt: Date.now()
				};
				(0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_1__.$B)(function(ls) {
					return ls.visitorTracking = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking;
				});
			}
		};
		if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTrackingDomain) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTrackingDomain = location.hostname || "";
		if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking) {
			migrateLegacyVisitorTracking();
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking = (0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_1__.y1)().visitorTracking || {};
		}
		var consent = function consent(val) {
			if (val == null) return isVisitorTrackingEnabled();
			return setVisitorTrackingEnabled(val);
		};
		_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.consent = consent;
		var setVisitorTrackingEnabled = function setVisitorTrackingEnabled(val) {
			var domain = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTrackingDomain;
			if (val === "default") delete _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking[domain];
			else _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking[domain] = {
				isEnabled: "".concat(val) === "true",
				updatedAt: Date.now()
			};
			(0, utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_1__.$B)(function(obj) {
				return obj.visitorTracking = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking;
			});
			(0, utilities_globalBindAndTrigger_js__WEBPACK_IMPORTED_MODULE_0__.mj)("visitortrackingchange", val);
			_toConsumableArray(document.getElementsByTagName("wistia-player")).forEach(function(player) {
				player.dispatchEvent(new CustomEvent("visitor-tracking-change", { detail: { isTrackingEnabled: val } }));
			});
		};
		var isCurrentDomainOrAnyParentDomainsEnabled = function isCurrentDomainOrAnyParentDomainsEnabled() {
			if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTrackingDomain) {
				var domainParts = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTrackingDomain.split(".");
				while (domainParts.length > 0) {
					var entry = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking[domainParts.join(".")];
					var enabledVal = entry && entry.isEnabled;
					if (enabledVal != null) return enabledVal;
					domainParts.shift();
				}
			}
		};
		var isVisitorTrackingEnabled = function isVisitorTrackingEnabled() {
			if (typeof _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking === "boolean") return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking;
			if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s._visitorTracking) {
				var isEnabledVal = isCurrentDomainOrAnyParentDomainsEnabled();
				if (isEnabledVal != null) return Boolean(isEnabledVal);
			}
			var apis = (0, utilities_getApiHandles_ts__WEBPACK_IMPORTED_MODULE_2__.bp)();
			if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.channel && _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.channel.all) try {
				apis.push.apply(apis, _toConsumableArray(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.channel.all()));
			} catch (e) {}
			return !apis.some(function(api) {
				return (api._mediaData || api._galleryData || {}).privacyMode === true;
			});
		};
	},
	4989(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			$: () => camelCaseToKebabCase,
			b: () => kebabCaseToCamelCase
		});
		var camelCaseToKebabCase = function camelCaseToKebabCase(camelCaseString) {
			return camelCaseString.replace(/[A-Z]+(?![a-z])|[A-Z]/g, function(letter, idx) {
				return (idx !== void 0 ? "-" : "") + letter.toLowerCase();
			});
		};
		var kebabCaseToCamelCase = function kebabCaseToCamelCase(kebabCaseString) {
			return kebabCaseString.replace(/-./g, function(word) {
				return word[1].toUpperCase();
			});
		};
	},
	4997(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			$B: () => updateWistiaLocalStorage,
			y1: () => getWistiaLocalStorage
		});
		var utilities_namespacedLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(2917);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var WISTIA_NAMESPACE = "wistia";
		var getWistiaLocalStorage = function getWistiaLocalStorage() {
			return (0, utilities_namespacedLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__.Lg)(WISTIA_NAMESPACE);
		};
		var removeWistiaLocalStorage = function removeWistiaLocalStorage() {
			Wistia._localStorage = removeLocalStorage(WISTIA_NAMESPACE);
			return Wistia._localStorage;
		};
		var setWistiaLocalStorage = function setWistiaLocalStorage(obj) {
			Wistia._localStorage = setLocalStorage(WISTIA_NAMESPACE, obj);
			return Wistia._localStorage;
		};
		var updateWistiaLocalStorage = function updateWistiaLocalStorage(fn) {
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._localStorage = (0, utilities_namespacedLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__.yo)(WISTIA_NAMESPACE, fn);
			return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._localStorage;
		};
	},
	5181(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.r(__webpack_exports__);
		__webpack_require__.d(__webpack_exports__, {
			Component: () => C,
			Fragment: () => S,
			cloneElement: () => W,
			createContext: () => X,
			createElement: () => k,
			createRef: () => M,
			h: () => k,
			hydrate: () => U,
			isValidElement: () => t,
			options: () => l,
			render: () => R,
			toChildArray: () => F
		});
		var n, l, u, t, i, r, o, e, f, c, s, a, h, p, v, y, d = {}, w = [], _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i, g = Array.isArray;
		function m(n, l) {
			for (var u in l) n[u] = l[u];
			return n;
		}
		function b(n) {
			n && n.parentNode && n.parentNode.removeChild(n);
		}
		function k(l, u, t) {
			var i, r, o, e = {};
			for (o in u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : e[o] = u[o];
			if (arguments.length > 2 && (e.children = arguments.length > 3 ? n.call(arguments, 2) : t), "function" == typeof l && null != l.defaultProps) for (o in l.defaultProps) void 0 === e[o] && (e[o] = l.defaultProps[o]);
			return x(l, e, i, r, null);
		}
		function x(n, t, i, r, o) {
			var e = {
				type: n,
				props: t,
				key: i,
				ref: r,
				__k: null,
				__: null,
				__b: 0,
				__e: null,
				__c: null,
				constructor: void 0,
				__v: null == o ? ++u : o,
				__i: -1,
				__u: 0
			};
			return null == o && null != l.vnode && l.vnode(e), e;
		}
		function M() {
			return { current: null };
		}
		function S(n) {
			return n.children;
		}
		function C(n, l) {
			this.props = n, this.context = l;
		}
		function $(n, l) {
			if (null == l) return n.__ ? $(n.__, n.__i + 1) : null;
			for (var u; l < n.__k.length; l++) if (null != (u = n.__k[l]) && null != u.__e) return u.__e;
			return "function" == typeof n.type ? $(n) : null;
		}
		function I(n) {
			if (n.__P && n.__d) {
				var u = n.__v, t = u.__e, i = [], r = [], o = m({}, u);
				o.__v = u.__v + 1, l.vnode && l.vnode(o), q(n.__P, o, u, n.__n, n.__P.namespaceURI, 32 & u.__u ? [t] : null, i, null == t ? $(u) : t, !!(32 & u.__u), r), o.__v = u.__v, o.__.__k[o.__i] = o, D(i, o, r), u.__e = u.__ = null, o.__e != t && P(o);
			}
		}
		function P(n) {
			if (null != (n = n.__) && null != n.__c) return n.__e = n.__c.base = null, n.__k.some(function(l) {
				if (null != l && null != l.__e) return n.__e = n.__c.base = l.__e;
			}), P(n);
		}
		function A(n) {
			(!n.__d && (n.__d = !0) && i.push(n) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
		}
		function H() {
			try {
				for (var n, l = 1; i.length;) i.length > l && i.sort(e), n = i.shift(), l = i.length, I(n);
			} finally {
				i.length = H.__r = 0;
			}
		}
		function L(n, l, u, t, i, r, o, e, f, c, s) {
			var a, h, p, v, y, _, g, m = t && t.__k || w, b = l.length;
			for (f = T(u, l, m, f, b), a = 0; a < b; a++) null != (p = u.__k[a]) && (h = -1 != p.__i && m[p.__i] || d, p.__i = a, _ = q(n, p, h, i, r, o, e, f, c, s), v = p.__e, p.ref && h.ref != p.ref && (h.ref && J(h.ref, null, p), s.push(p.ref, p.__c || v, p)), null == y && null != v && (y = v), (g = !!(4 & p.__u)) || h.__k === p.__k ? (f = j(p, f, n, g), g && h.__e && (h.__e = null)) : "function" == typeof p.type && void 0 !== _ ? f = _ : v && (f = v.nextSibling), p.__u &= -7);
			return u.__e = y, f;
		}
		function T(n, l, u, t, i) {
			var r, o, e, f, c, s = u.length, a = s, h = 0;
			for (n.__k = new Array(i), r = 0; r < i; r++) null != (o = l[r]) && "boolean" != typeof o && "function" != typeof o ? ("string" == typeof o || "number" == typeof o || "bigint" == typeof o || o.constructor == String ? o = n.__k[r] = x(null, o, null, null, null) : g(o) ? o = n.__k[r] = x(S, { children: o }, null, null, null) : void 0 === o.constructor && o.__b > 0 ? o = n.__k[r] = x(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : n.__k[r] = o, f = r + h, o.__ = n, o.__b = n.__b + 1, e = null, -1 != (c = o.__i = O(o, u, f, a)) && (a--, (e = u[c]) && (e.__u |= 2)), null == e || null == e.__v ? (-1 == c && (i > s ? h-- : i < s && h++), "function" != typeof o.type && (o.__u |= 4)) : c != f && (c == f - 1 ? h-- : c == f + 1 ? h++ : (c > f ? h-- : h++, o.__u |= 4))) : n.__k[r] = null;
			if (a) for (r = 0; r < s; r++) null != (e = u[r]) && 0 == (2 & e.__u) && (e.__e == t && (t = $(e)), K(e, e));
			return t;
		}
		function j(n, l, u, t) {
			var i, r;
			if ("function" == typeof n.type) {
				for (i = n.__k, r = 0; i && r < i.length; r++) i[r] && (i[r].__ = n, l = j(i[r], l, u, t));
				return l;
			}
			n.__e != l && (t && (l && n.type && !l.parentNode && (l = $(n)), u.insertBefore(n.__e, l || null)), l = n.__e);
			do
				l = l && l.nextSibling;
			while (null != l && 8 == l.nodeType);
			return l;
		}
		function F(n, l) {
			return l = l || [], null == n || "boolean" == typeof n || (g(n) ? n.some(function(n) {
				F(n, l);
			}) : l.push(n)), l;
		}
		function O(n, l, u, t) {
			var i, r, o, e = n.key, f = n.type, c = l[u], s = null != c && 0 == (2 & c.__u);
			if (null === c && null == e || s && e == c.key && f == c.type) return u;
			if (t > (s ? 1 : 0)) {
				for (i = u - 1, r = u + 1; i >= 0 || r < l.length;) if (null != (c = l[o = i >= 0 ? i-- : r++]) && 0 == (2 & c.__u) && e == c.key && f == c.type) return o;
			}
			return -1;
		}
		function z(n, l, u) {
			"-" == l[0] ? n.setProperty(l, null == u ? "" : u) : n[l] = null == u ? "" : "number" != typeof u || _.test(l) ? u : u + "px";
		}
		function N(n, l, u, t, i) {
			var r, o;
			n: if ("style" == l) if ("string" == typeof u) n.style.cssText = u;
			else {
				if ("string" == typeof t && (n.style.cssText = t = ""), t) for (l in t) u && l in u || z(n.style, l, "");
				if (u) for (l in u) t && u[l] == t[l] || z(n.style, l, u[l]);
			}
			else if ("o" == l[0] && "n" == l[1]) r = l != (l = l.replace(a, "$1")), o = l.toLowerCase(), l = o in n || "onFocusOut" == l || "onFocusIn" == l ? o.slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u, u ? t ? u[s] = t[s] : (u[s] = h, n.addEventListener(l, r ? v : p, r)) : n.removeEventListener(l, r ? v : p, r);
			else {
				if ("http://www.w3.org/2000/svg" == i) l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
				else if ("width" != l && "height" != l && "href" != l && "list" != l && "form" != l && "tabIndex" != l && "download" != l && "rowSpan" != l && "colSpan" != l && "role" != l && "popover" != l && l in n) try {
					n[l] = null == u ? "" : u;
					break n;
				} catch (n) {}
				"function" == typeof u || (null == u || !1 === u && "-" != l[4] ? n.removeAttribute(l) : n.setAttribute(l, "popover" == l && 1 == u ? "" : u));
			}
		}
		function V(n) {
			return function(u) {
				if (this.l) {
					var t = this.l[u.type + n];
					if (null == u[c]) u[c] = h++;
					else if (u[c] < t[s]) return;
					return t(l.event ? l.event(u) : u);
				}
			};
		}
		function q(n, u, t, i, r, o, e, f, c, s) {
			var a, h, p, v, y, d, _, k, x, M, $, I, P, A, H, T = u.type;
			if (void 0 !== u.constructor) return null;
			128 & t.__u && (c = !!(32 & t.__u), o = [f = u.__e = t.__e]), (a = l.__b) && a(u);
			n: if ("function" == typeof T) try {
				if (k = u.props, x = T.prototype && T.prototype.render, M = (a = T.contextType) && i[a.__c], $ = a ? M ? M.props.value : a.__ : i, t.__c ? _ = (h = u.__c = t.__c).__ = h.__E : (x ? u.__c = h = new T(k, $) : (u.__c = h = new C(k, $), h.constructor = T, h.render = Q), M && M.sub(h), h.state || (h.state = {}), h.__n = i, p = h.__d = !0, h.__h = [], h._sb = []), x && null == h.__s && (h.__s = h.state), x && null != T.getDerivedStateFromProps && (h.__s == h.state && (h.__s = m({}, h.__s)), m(h.__s, T.getDerivedStateFromProps(k, h.__s))), v = h.props, y = h.state, h.__v = u, p) x && null == T.getDerivedStateFromProps && null != h.componentWillMount && h.componentWillMount(), x && null != h.componentDidMount && h.__h.push(h.componentDidMount);
				else {
					if (x && null == T.getDerivedStateFromProps && k !== v && null != h.componentWillReceiveProps && h.componentWillReceiveProps(k, $), u.__v == t.__v || !h.__e && null != h.shouldComponentUpdate && !1 === h.shouldComponentUpdate(k, h.__s, $)) {
						u.__v != t.__v && (h.props = k, h.state = h.__s, h.__d = !1), u.__e = t.__e, u.__k = t.__k, u.__k.some(function(n) {
							n && (n.__ = u);
						}), w.push.apply(h.__h, h._sb), h._sb = [], h.__h.length && e.push(h);
						break n;
					}
					null != h.componentWillUpdate && h.componentWillUpdate(k, h.__s, $), x && null != h.componentDidUpdate && h.__h.push(function() {
						h.componentDidUpdate(v, y, d);
					});
				}
				if (h.context = $, h.props = k, h.__P = n, h.__e = !1, I = l.__r, P = 0, x) h.state = h.__s, h.__d = !1, I && I(u), a = h.render(h.props, h.state, h.context), w.push.apply(h.__h, h._sb), h._sb = [];
				else do
					h.__d = !1, I && I(u), a = h.render(h.props, h.state, h.context), h.state = h.__s;
				while (h.__d && ++P < 25);
				h.state = h.__s, null != h.getChildContext && (i = m(m({}, i), h.getChildContext())), x && !p && null != h.getSnapshotBeforeUpdate && (d = h.getSnapshotBeforeUpdate(v, y)), A = null != a && a.type === S && null == a.key ? E(a.props.children) : a, f = L(n, g(A) ? A : [A], u, t, i, r, o, e, f, c, s), h.base = u.__e, u.__u &= -161, h.__h.length && e.push(h), _ && (h.__E = h.__ = null);
			} catch (n) {
				if (u.__v = null, c || null != o) if (n.then) {
					for (u.__u |= c ? 160 : 128; f && 8 == f.nodeType && f.nextSibling;) f = f.nextSibling;
					o[o.indexOf(f)] = null, u.__e = f;
				} else {
					for (H = o.length; H--;) b(o[H]);
					B(u);
				}
				else u.__e = t.__e, u.__k = t.__k, n.then || B(u);
				l.__e(n, u, t);
			}
			else null == o && u.__v == t.__v ? (u.__k = t.__k, u.__e = t.__e) : f = u.__e = G(t.__e, u, t, i, r, o, e, c, s);
			return (a = l.diffed) && a(u), 128 & u.__u ? void 0 : f;
		}
		function B(n) {
			n && (n.__c && (n.__c.__e = !0), n.__k && n.__k.some(B));
		}
		function D(n, u, t) {
			for (var i = 0; i < t.length; i++) J(t[i], t[++i], t[++i]);
			l.__c && l.__c(u, n), n.some(function(u) {
				try {
					n = u.__h, u.__h = [], n.some(function(n) {
						n.call(u);
					});
				} catch (n) {
					l.__e(n, u.__v);
				}
			});
		}
		function E(n) {
			return "object" != typeof n || null == n || n.__b > 0 ? n : g(n) ? n.map(E) : m({}, n);
		}
		function G(u, t, i, r, o, e, f, c, s) {
			var a, h, p, v, y, w, _, m = i.props || d, k = t.props, x = t.type;
			if ("svg" == x ? o = "http://www.w3.org/2000/svg" : "math" == x ? o = "http://www.w3.org/1998/Math/MathML" : o || (o = "http://www.w3.org/1999/xhtml"), null != e) {
				for (a = 0; a < e.length; a++) if ((y = e[a]) && "setAttribute" in y == !!x && (x ? y.localName == x : 3 == y.nodeType)) {
					u = y, e[a] = null;
					break;
				}
			}
			if (null == u) {
				if (null == x) return document.createTextNode(k);
				u = document.createElementNS(o, x, k.is && k), c && (l.__m && l.__m(t, e), c = !1), e = null;
			}
			if (null == x) m === k || c && u.data == k || (u.data = k);
			else {
				if (e = e && n.call(u.childNodes), !c && null != e) for (m = {}, a = 0; a < u.attributes.length; a++) m[(y = u.attributes[a]).name] = y.value;
				for (a in m) y = m[a], "dangerouslySetInnerHTML" == a ? p = y : "children" == a || a in k || "value" == a && "defaultValue" in k || "checked" == a && "defaultChecked" in k || N(u, a, null, y, o);
				for (a in k) y = k[a], "children" == a ? v = y : "dangerouslySetInnerHTML" == a ? h = y : "value" == a ? w = y : "checked" == a ? _ = y : c && "function" != typeof y || m[a] === y || N(u, a, y, m[a], o);
				if (h) c || p && (h.__html == p.__html || h.__html == u.innerHTML) || (u.innerHTML = h.__html), t.__k = [];
				else if (p && (u.innerHTML = ""), L("template" == t.type ? u.content : u, g(v) ? v : [v], t, i, r, "foreignObject" == x ? "http://www.w3.org/1999/xhtml" : o, e, f, e ? e[0] : i.__k && $(i, 0), c, s), null != e) for (a = e.length; a--;) b(e[a]);
				c || (a = "value", "progress" == x && null == w ? u.removeAttribute("value") : null != w && (w !== u[a] || "progress" == x && !w || "option" == x && w != m[a]) && N(u, a, w, m[a], o), a = "checked", null != _ && _ != u[a] && N(u, a, _, m[a], o));
			}
			return u;
		}
		function J(n, u, t) {
			try {
				if ("function" == typeof n) {
					var i = "function" == typeof n.__u;
					i && n.__u(), i && null == u || (n.__u = n(u));
				} else n.current = u;
			} catch (n) {
				l.__e(n, t);
			}
		}
		function K(n, u, t) {
			var i, r;
			if (l.unmount && l.unmount(n), (i = n.ref) && (i.current && i.current != n.__e || J(i, null, u)), null != (i = n.__c)) {
				if (i.componentWillUnmount) try {
					i.componentWillUnmount();
				} catch (n) {
					l.__e(n, u);
				}
				i.base = i.__P = null;
			}
			if (i = n.__k) for (r = 0; r < i.length; r++) i[r] && K(i[r], u, t || "function" != typeof n.type);
			t || b(n.__e), n.__c = n.__ = n.__e = void 0;
		}
		function Q(n, l, u) {
			return this.constructor(n, u);
		}
		function R(u, t, i) {
			var r, o, e, f;
			t == document && (t = document.documentElement), l.__ && l.__(u, t), o = (r = "function" == typeof i) ? null : i && i.__k || t.__k, e = [], f = [], q(t, u = (!r && i || t).__k = k(S, null, [u]), o || d, d, t.namespaceURI, !r && i ? [i] : o ? null : t.firstChild ? n.call(t.childNodes) : null, e, !r && i ? i : o ? o.__e : t.firstChild, r, f), D(e, u, f);
		}
		function U(n, l) {
			R(n, l, U);
		}
		function W(l, u, t) {
			var i, r, o, e, f = m({}, l.props);
			for (o in l.type && l.type.defaultProps && (e = l.type.defaultProps), u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : f[o] = void 0 === u[o] && null != e ? e[o] : u[o];
			return arguments.length > 2 && (f.children = arguments.length > 3 ? n.call(arguments, 2) : t), x(l.type, f, i || l.key, r || l.ref, null);
		}
		function X(n) {
			function l(n) {
				var u, t;
				return this.getChildContext || (u = /* @__PURE__ */ new Set(), (t = {})[l.__c] = this, this.getChildContext = function() {
					return t;
				}, this.componentWillUnmount = function() {
					u = null;
				}, this.shouldComponentUpdate = function(n) {
					this.props.value != n.value && u.forEach(function(n) {
						n.__e = !0, A(n);
					});
				}, this.sub = function(n) {
					u.add(n);
					var l = n.componentWillUnmount;
					n.componentWillUnmount = function() {
						u && u.delete(n), l && l.call(n);
					};
				}), n.children;
			}
			return l.__c = "__cC" + y++, l.__ = n, l.Provider = l.__l = (l.Consumer = function(n, l) {
				return n.children(l);
			}).contextType = l, l;
		}
		n = w.slice, l = { __e: function(n, l, u, t) {
			for (var i, r, o; l = l.__;) if ((i = l.__c) && !i.__) try {
				if ((r = i.constructor) && null != r.getDerivedStateFromError && (i.setState(r.getDerivedStateFromError(n)), o = i.__d), null != i.componentDidCatch && (i.componentDidCatch(n, t || {}), o = i.__d), o) return i.__E = i;
			} catch (l) {
				n = l;
			}
			throw n;
		} }, u = 0, t = function(n) {
			return null != n && void 0 === n.constructor;
		}, C.prototype.setState = function(n, l) {
			var u = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state);
			"function" == typeof n && (n = n(m({}, u), this.props)), n && m(u, n), null != n && this.__v && (l && this._sb.push(l), A(this));
		}, C.prototype.forceUpdate = function(n) {
			this.__v && (this.__e = !0, n && this.__h.push(n), A(this));
		}, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n, l) {
			return n.__v.__b - l.__v.__b;
		}, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, s = "__a" + f, a = /(PointerCapture)$|Capture$/i, h = 0, p = V(!1), v = V(!0), y = 0;
	},
	5393(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { H: () => inferPageUrl });
		/**
		* Infer the url of the page best we can
		* @returns {string} the url of the page
		*/
		var inferPageUrl = function inferPageUrl() {
			var _window$FreshUrl;
			if (((_window$FreshUrl = window.FreshUrl) === null || _window$FreshUrl === void 0 ? void 0 : _window$FreshUrl.originalUrl) != null) return window.FreshUrl.originalUrl;
			if (window.top === window.self) return window.location.href || "";
			return document.referrer || "";
		};
	},
	5417(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { Q1: () => Color });
		var _color_utils_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(998);
		function _classCallCheck(a, n) {
			if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
		}
		function _defineProperties(e, r) {
			for (var t = 0; t < r.length; t++) {
				var o = r[t];
				o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
			}
		}
		function _createClass(e, r, t) {
			return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		var rHex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6,8})$/i;
		var rRgb = /^rgba?\((\d{1,3}(?:\.\d+)?%?),\s*(\d{1,3}(?:\.\d+)?%?),\s*(\d{1,3}(?:\.\d+)?%?)(?:,\s*([01]?\.?\d*))?\)$/;
		var rPercent = /^\d+(\.\d+)*%$/;
		var hexBit = /([0-9a-f])/gi;
		var p2v = function p2v(p) {
			if (rPercent.test(p)) return parseFloat(p) * 2.55;
			return p;
		};
		var hue2rgb = function hue2rgb(a, b, c) {
			if (c < 0) c += 1;
			if (c > 1) c -= 1;
			if (c < 1 / 6) return a + (b - a) * 6 * c;
			if (c < 1 / 2) return b;
			if (c < 2 / 3) return a + (b - a) * (2 / 3 - c) * 6;
			return a;
		};
		var Color = /*#__PURE__*/ function() {
			function Color(input) {
				_classCallCheck(this, Color);
				if (input instanceof Color) {
					this.r = input.r;
					this.g = input.g;
					this.b = input.b;
					this.a = input.a;
				} else if (input) this.parse(input);
				else {
					this.r = this.g = this.b = 0;
					this.a = 1;
				}
			}
			return _createClass(Color, [
				{
					key: "parse",
					value: function parse(input) {
						var parsed = false;
						if (Array.isArray(input)) {
							var _input$;
							this.r = input[0];
							this.g = input[1];
							this.b = input[2];
							this.a = (_input$ = input[3]) !== null && _input$ !== void 0 ? _input$ : 1;
							parsed = true;
						} else {
							var sanitized = String(input).replace(/\s+/g, "");
							if (rHex.test(sanitized)) {
								var stripped = sanitized.replace(/^#/, "");
								if (stripped.length === 3 || stripped.length === 4) stripped = stripped.replace(hexBit, "$1$1");
								this.r = parseInt(stripped.substr(0, 2), 16);
								this.g = parseInt(stripped.substr(2, 2), 16);
								this.b = parseInt(stripped.substr(4, 2), 16);
								if (stripped.length === 8) this.a = parseInt(stripped.substr(6, 2), 16) / 255;
								else this.a = 1;
								parsed = true;
							} else if (rRgb.test(sanitized)) {
								var parts = sanitized.match(rRgb);
								this.r = parseFloat(p2v(parts[1]));
								this.g = parseFloat(p2v(parts[2]));
								this.b = parseFloat(p2v(parts[3]));
								if (parts[4]) this.a = parseFloat(parts[4]);
								else this.a = 1;
								parsed = true;
							}
						}
						if (!parsed || isNaN(this.r) || isNaN(this.g) || isNaN(this.b) || isNaN(this.a) || this.r < 0 || this.g < 0 || this.b < 0 || this.a < 0) {
							this.r = 41;
							this.g = 73;
							this.b = 229;
							this.a = 1;
							console.error("An invalid color was provided, ".concat(input.toString(), ", using default color instead."));
						}
						return this;
					}
				},
				{
					key: "clone",
					value: function clone() {
						return new Color(this);
					}
				},
				{
					key: "_hslFromRgb",
					value: function _hslFromRgb() {
						var _rgbToHsl = (0, _color_utils_ts__WEBPACK_IMPORTED_MODULE_0__.K6)([
							this.r,
							this.g,
							this.b
						]), hue = _rgbToHsl.hue, saturation = _rgbToHsl.saturation, lightness = _rgbToHsl.lightness;
						this._h = hue;
						this._s = saturation;
						this._l = lightness;
						return this;
					}
				},
				{
					key: "_rgbFromHsl",
					value: function _rgbFromHsl() {
						var h = this._h / 360;
						var s = this._s / 100;
						var l = this._l / 100;
						var q = l < .5 ? l * (1 + s) : l + s - l * s;
						var p = 2 * l - q;
						this.r = hue2rgb(p, q, h + 1 / 3) * 255;
						this.g = hue2rgb(p, q, h) * 255;
						this.b = hue2rgb(p, q, h - 1 / 3) * 255;
						return this;
					}
				},
				{
					key: "blendChannel",
					value: function blendChannel(channel, value, alpha, shouldUseLrgb) {
						if (shouldUseLrgb) {
							this[channel] = Math.sqrt(Math.pow(this[channel], 2) * (1 - alpha) + Math.pow(value, 2) * alpha);
							return this;
						}
						this[channel] = alpha * value + (1 - alpha) * this[channel];
						return this;
					}
				},
				{
					key: "blend",
					value: function blend(color, alpha, shouldUseLrgb) {
						color = new Color(color);
						this.blendChannel("r", color.r, alpha, shouldUseLrgb);
						this.blendChannel("g", color.g, alpha, shouldUseLrgb);
						this.blendChannel("b", color.b, alpha, shouldUseLrgb);
						return this;
					}
				},
				{
					key: "getContrastRatio",
					value: function getContrastRatio(backgroundColor) {
						return Number.parseFloat((0, _color_utils_ts__WEBPACK_IMPORTED_MODULE_0__.bJ)(this.toHexWithHash(), new Color(backgroundColor).toHexWithHash()).toFixed(3));
					}
				},
				{
					key: "hasAccessibleContrast",
					value: function hasAccessibleContrast(backgroundColor, shape) {
						return this.getContrastRatio(backgroundColor) >= _color_utils_ts__WEBPACK_IMPORTED_MODULE_0__.s1[shape];
					}
				},
				{
					key: "hue",
					value: function hue() {
						this._hslFromRgb();
						return this._h;
					}
				},
				{
					key: "lightenChannel",
					value: function lightenChannel(channel, steps) {
						this[channel] += steps;
						if (this[channel] < 0) this[channel] = 0;
						else if (this[channel] > 255) this[channel] = 255;
						return this;
					}
				},
				{
					key: "lighten",
					value: function lighten(steps) {
						if (this.looksLikePercent(steps)) this.lightness(this.lightness() + parseFloat(steps));
						else {
							this.lightenChannel("r", steps);
							this.lightenChannel("g", steps);
							this.lightenChannel("b", steps);
						}
						return this;
					}
				},
				{
					key: "darken",
					value: function darken(steps) {
						if (typeof steps === "string") return this.lighten("-".concat(steps));
						return this.lighten(-steps);
					}
				},
				{
					key: "looksLikePercent",
					value: function looksLikePercent(str) {
						return /^-?\d+(\.\d+)?%$/.test(str);
					}
				},
				{
					key: "lightness",
					value: function lightness(l) {
						this._hslFromRgb();
						if (l != null) {
							this._l = Math.max(0, Math.min(100, l));
							this._rgbFromHsl();
							return this;
						}
						return this._l;
					}
				},
				{
					key: "saturation",
					value: function saturation(s) {
						this._hslFromRgb();
						if (s != null) {
							this._s = Math.max(0, Math.min(100, s));
							this._rgbFromHsl();
							return this;
						}
						return this._s;
					}
				},
				{
					key: "setHue",
					value: function setHue(hueValue) {
						this._hslFromRgb();
						if (hueValue != null) {
							this._h = Math.max(0, Math.min(360, hueValue));
							this._rgbFromHsl();
							return this;
						}
					}
				},
				{
					key: "shade",
					value: function shade(percentage, shouldUseLrgb) {
						return this.blend("#000000", percentage, shouldUseLrgb);
					}
				},
				{
					key: "grayLevel",
					value: function grayLevel() {
						return (.299 * this.r + .587 * this.g + .114 * this.b) / 255;
					}
				},
				{
					key: "tint",
					value: function tint(percentage, shouldUseLrgb) {
						return this.blend("#ffffff", percentage, shouldUseLrgb);
					}
				},
				{
					key: "whiteLevel",
					value: function whiteLevel() {
						return Math.min(Math.min(this.r, this.g), this.b);
					}
				},
				{
					key: "getRelativeLuminance",
					value: function getRelativeLuminance() {
						var adjustChannel = function adjustChannel(givenVal) {
							var val = givenVal * .003921569;
							if (val <= .03928) return val / 12.92;
							return Math.pow((val + .055) / 1.055, 2.4);
						};
						var rAdjusted = adjustChannel(this.r);
						var gAdjusted = adjustChannel(this.g);
						var bAdjusted = adjustChannel(this.b);
						return Math.min(.2126 * rAdjusted + .7152 * gAdjusted + .0722 * bAdjusted, 1);
					}
				},
				{
					key: "isDark",
					value: function isDark(shouldUseRL) {
						if (shouldUseRL) return this.getRelativeLuminance() < .15;
						return this.grayLevel() <= .4;
					}
				},
				{
					key: "isLight",
					value: function isLight(shouldUseRL) {
						if (shouldUseRL) return this.getRelativeLuminance() >= .8;
						return this.grayLevel() > .4;
					}
				},
				{
					key: "isGrayscale",
					value: function isGrayscale() {
						return this.r === this.g && this.g === this.b;
					}
				},
				{
					key: "distanceFrom",
					value: function distanceFrom(color) {
						return Math.sqrt(Math.pow(this.r - color.r, 2) + Math.pow(this.g - color.g, 2) + Math.pow(this.b - color.b, 2));
					}
				},
				{
					key: "channelDominance",
					value: function channelDominance() {
						var _this = this;
						return [
							"r",
							"g",
							"b"
						].sort(function(a, b) {
							return _this[b] - _this[a];
						});
					}
				},
				{
					key: "alpha",
					value: function alpha(a) {
						if (a != null) {
							this.a = a;
							return this;
						}
						return this.a;
					}
				},
				{
					key: "red",
					value: function red(r) {
						if (r != null) {
							this.r = r;
							return this;
						}
						return this.r;
					}
				},
				{
					key: "green",
					value: function green(g) {
						if (g != null) {
							this.g = g;
							return this;
						}
						return this.g;
					}
				},
				{
					key: "blue",
					value: function blue(b) {
						if (b != null) {
							this.b = b;
							return this;
						}
						return this.b;
					}
				},
				{
					key: "toHex",
					value: function toHex() {
						var r = Math.round(this.r).toString(16);
						var g = Math.round(this.g).toString(16);
						var b = Math.round(this.b).toString(16);
						if (r.length === 1) r = "0".concat(r);
						if (g.length === 1) g = "0".concat(g);
						if (b.length === 1) b = "0".concat(b);
						return "".concat(r).concat(g).concat(b);
					}
				},
				{
					key: "toHexWithAlpha",
					value: function toHexWithAlpha() {
						var a = Math.round(this.a * 255).toString(16);
						if (a.length === 1) a = "0".concat(a);
						return "".concat(a).concat(this.toHex());
					}
				},
				{
					key: "toHexWithHash",
					value: function toHexWithHash() {
						return "#".concat(this.toHex());
					}
				},
				{
					key: "toRgb",
					value: function toRgb() {
						return "rgb(".concat(Math.round(this.r), ",").concat(Math.round(this.g), ",").concat(Math.round(this.b), ")");
					}
				},
				{
					key: "toRgba",
					value: function toRgba() {
						return "rgba(".concat(Math.round(this.r), ",").concat(Math.round(this.g), ",").concat(Math.round(this.b), ",").concat(this.a, ")");
					}
				},
				{
					key: "toRgbaOrHex",
					value: function toRgbaOrHex() {
						return this.toRgba();
					}
				},
				{
					key: "toPercent",
					value: function toPercent() {
						return "rgba(".concat(this.r / 255 * 100, "%,").concat(this.g / 255 * 100, "%,").concat(this.b / 255 * 100, "%,").concat(this.a, ")");
					}
				},
				{
					key: "toIeGradient",
					value: function toIeGradient() {
						return "progid:DXImageTransform.Microsoft.gradient(startColorStr='#".concat(this.toHexWithAlpha(), "', endColorStr='#").concat(this.toHexWithAlpha(), "')");
					}
				},
				{
					key: "toString",
					value: function toString() {
						return this.toPercent();
					}
				}
			]);
		}();
		var addHashToHex = function addHashToHex(hex) {
			if (isNil(hex)) return;
			var hexGuaranteedToBeString = String(hex);
			if (hexGuaranteedToBeString.charAt(0) === "#") return hexGuaranteedToBeString;
			return "#".concat(hexGuaranteedToBeString);
		};
		var colorWithAlpha = function colorWithAlpha(color, alpha) {
			return new Color(color).alpha(alpha).toRgba();
		};
	},
	5509(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { s: () => Wistia });
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var preact_hooks__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3817);
		var preact_compat__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1525);
		var _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(8176);
		var _root$Wistia, _root$Wistia2, _root$Wistia2$Preact, _root$Wistia3, _root$Wistia3$_destru, _root$Wistia4, _root$Wistia4$_initia, _root$Wistia5, _root$Wistia5$_remote, _root$Wistia6, _root$Wistia6$api, _root$Wistia7, _root$Wistia7$defineC, _root$Wistia8, _root$Wistia8$EventSh, _root$Wistia9, _root$Wistia9$mixin, _root$Wistia0, _root$Wistia0$playlis, _root$Wistia1, _root$Wistia1$PublicA, _root$Wistia10, _root$Wistia10$uncach, _root$Wistia11, _root$Wistia11$Visito, _root$Wistia12, _root$Wistia12$visito, _root$Wistia13, _root$Wistia13$wistia, _root$Wistia14, _root$Wistia14$_liveS, _root$Wistia15, _root$Wistia15$_media, _root$Wistia16, _root$Wistia16$_liveS, _root$Wistia17, _root$Wistia17$first;
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		(_root$Wistia = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia) !== null && _root$Wistia !== void 0 || (_utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia = {});
		(_root$Wistia2$Preact = (_root$Wistia2 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).Preact) !== null && _root$Wistia2$Preact !== void 0 || (_root$Wistia2.Preact = _objectSpread(_objectSpread({}, preact__WEBPACK_IMPORTED_MODULE_0__), {}, {
			hooks: preact_hooks__WEBPACK_IMPORTED_MODULE_1__,
			compat: preact_compat__WEBPACK_IMPORTED_MODULE_2__
		}));
		(_root$Wistia3$_destru = (_root$Wistia3 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia)._destructors) !== null && _root$Wistia3$_destru !== void 0 || (_root$Wistia3._destructors = {});
		(_root$Wistia4$_initia = (_root$Wistia4 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia)._initializers) !== null && _root$Wistia4$_initia !== void 0 || (_root$Wistia4._initializers = {});
		(_root$Wistia5$_remote = (_root$Wistia5 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia)._remoteData) !== null && _root$Wistia5$_remote !== void 0 || (_root$Wistia5._remoteData = /* @__PURE__ */ new Map());
		(_root$Wistia6$api = (_root$Wistia6 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).api) !== null && _root$Wistia6$api !== void 0 || (_root$Wistia6.api = function() {
			console.error("Accessed Wistia.api() before it was initialized");
			return null;
		});
		(_root$Wistia7$defineC = (_root$Wistia7 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).defineControl) !== null && _root$Wistia7$defineC !== void 0 || (_root$Wistia7.defineControl = function() {
			console.error("Accessed Wistia.defineControl() before it was initialized");
			return null;
		});
		(_root$Wistia8$EventSh = (_root$Wistia8 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).EventShepherdManager) !== null && _root$Wistia8$EventSh !== void 0 || (_root$Wistia8.EventShepherdManager = {});
		(_root$Wistia9$mixin = (_root$Wistia9 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).mixin) !== null && _root$Wistia9$mixin !== void 0 || (_root$Wistia9.mixin = function(klass) {
			var obj = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			Object.keys(obj).forEach(function(key) {
				if (_objectHasOwn(obj, key)) klass[key] = obj[key];
			});
		});
		(_root$Wistia0$playlis = (_root$Wistia0 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).playlistMethods) !== null && _root$Wistia0$playlis !== void 0 || (_root$Wistia0.playlistMethods = /* @__PURE__ */ new Map());
		(_root$Wistia1$PublicA = (_root$Wistia1 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).PublicApi) !== null && _root$Wistia1$PublicA !== void 0 || (_root$Wistia1.PublicApi = null);
		(_root$Wistia10$uncach = (_root$Wistia10 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).uncacheMedia) !== null && _root$Wistia10$uncach !== void 0 || (_root$Wistia10.uncacheMedia = function() {
			console.error("Accessed Wistia.uncacheMedia() before it was initialized");
			return null;
		});
		(_root$Wistia11$Visito = (_root$Wistia11 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).VisitorKey) !== null && _root$Wistia11$Visito !== void 0 || (_root$Wistia11.VisitorKey = null);
		(_root$Wistia12$visito = (_root$Wistia12 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).visitorKey) !== null && _root$Wistia12$visito !== void 0 || (_root$Wistia12.visitorKey = null);
		(_root$Wistia13$wistia = (_root$Wistia13 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).wistia) !== null && _root$Wistia13$wistia !== void 0 || (_root$Wistia13.wistia = void 0);
		(_root$Wistia14$_liveS = (_root$Wistia14 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia)._liveStreamEventDataPromises) !== null && _root$Wistia14$_liveS !== void 0 || (_root$Wistia14._liveStreamEventDataPromises = {});
		(_root$Wistia15$_media = (_root$Wistia15 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia)._mediaDataPromises) !== null && _root$Wistia15$_media !== void 0 || (_root$Wistia15._mediaDataPromises = {});
		(_root$Wistia16$_liveS = (_root$Wistia16 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia)._liveStreamPollingPromises) !== null && _root$Wistia16$_liveS !== void 0 || (_root$Wistia16._liveStreamPollingPromises = {});
		(_root$Wistia17$first = (_root$Wistia17 = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia).first) !== null && _root$Wistia17$first !== void 0 || (_root$Wistia17.first = function() {
			var _root$Wistia$api;
			return (_root$Wistia$api = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia.api()) !== null && _root$Wistia$api !== void 0 ? _root$Wistia$api : document.querySelector("wistia-player");
		});
		var Wistia = _utilities_root_js__WEBPACK_IMPORTED_MODULE_3__.z.Wistia;
	},
	5510(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { bp: () => getAllApiHandles });
		var _wlog_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(6637);
		var _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3997);
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		/**
		* Initialized embeds are API embeds that have a wistiaApi property set on the
		* container. container.wistiaApi is set on legacy embeds in _public_api.js
		* @returns {PublicApi[]}
		*/
		var getAllInitializedEmbedApiHandles = function getAllInitializedEmbedApiHandles() {
			if ((0, _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__.m)("video") === void 0) return [];
			return Object.values((0, _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__.m)("video"));
		};
		/**
		* Get all initialized instances of the iframe api
		* @returns {PublicApi[]}
		*/
		var getAllIframeApiHandles = function getAllIframeApiHandles() {
			if ((0, _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__.m)("iframe_api") === void 0) return [];
			return Object.values((0, _wistiaData_js__WEBPACK_IMPORTED_MODULE_1__.m)("iframe_api"));
		};
		/**
		* Get all initialized instances of the API, inclusive of both
		* iframe API and regular embed public API
		* @returns {PublicApi[]}
		*/
		var getAllApiHandles = function getAllApiHandles() {
			return getAllInitializedEmbedApiHandles().concat(getAllIframeApiHandles());
		};
		/**
		* Get a single API handle by matcher
		* @param {Function | HTMLElement | number | string | undefined} matcher - The matcher
		* @returns {PublicApi | null}
		*/
		var getOneApiHandle = function getOneApiHandle(matcher) {
			var _container, _container2;
			if (matcher === void 0) {
				var _getAllApiHandles$;
				return (_getAllApiHandles$ = getAllApiHandles()[0]) !== null && _getAllApiHandles$ !== void 0 ? _getAllApiHandles$ : null;
			}
			var container = null;
			if (typeof matcher === "string") {
				var _document$querySelect;
				var query = matcher;
				container = (_document$querySelect = document.querySelector("[unique-id='".concat(query, "']"))) !== null && _document$querySelect !== void 0 ? _document$querySelect : document.getElementById(query);
				if (container === null) {
					var matchedHandle = getAllApiHandles().find(function(handle) {
						var _handle$hashedId, _handle$container;
						if ((_handle$hashedId = handle.hashedId()) !== null && _handle$hashedId !== void 0 && _handle$hashedId.startsWith(query) || (_handle$container = handle.container) !== null && _handle$container !== void 0 && _handle$container.id.startsWith(query)) return handle;
						if ("mediaLanguages" in handle && "languageToLocalization" in handle) {
							var _handle$_mediaData;
							if (handle.mediaLanguages().some(function(language) {
								var localization = handle.languageToLocalization(language);
								return localization != null && ensureString(localization.hashedId).startsWith(query);
							})) return handle;
							if (ensureString((_handle$_mediaData = handle._mediaData) === null || _handle$_mediaData === void 0 ? void 0 : _handle$_mediaData.sourceHashedId).startsWith(query)) return handle;
						}
						return null;
					});
					if (matchedHandle !== "removed") {
						var _ref;
						container = (_ref = matchedHandle === null || matchedHandle === void 0 ? void 0 : matchedHandle.container) !== null && _ref !== void 0 ? _ref : null;
					}
				}
			} else if (typeof matcher === "number") {
				var index = matcher;
				var _apiHandles = getAllApiHandles();
				if (index < 0) index = _apiHandles.length + index;
				var apiHandle = _apiHandles[index];
				if (apiHandle !== void 0 && apiHandle !== "removed") {
					var _apiHandle$container;
					container = (_apiHandle$container = apiHandle.container) !== null && _apiHandle$container !== void 0 ? _apiHandle$container : null;
				}
			} else if (matcher instanceof HTMLElement) container = matcher;
			else wlog.error("Unrecognized matcher", matcher);
			if (((_container = container) === null || _container === void 0 ? void 0 : _container.tagName) === "WISTIA-PLAYER") return container.deprecatedApiDoNotUse;
			if (((_container2 = container) === null || _container2 === void 0 ? void 0 : _container2.wistiaApi) !== void 0 && container.wistiaApi !== "removed") return container.wistiaApi;
			return null;
		};
		/**
		* Get a single API handle by ONLY hashed id, not by container id
		* @param {number | string | undefined} hashedId
		* @returns {PublicApi | null}
		*/
		var getOneApiHandleFromHashedId = function getOneApiHandleFromHashedId(hashedId) {
			var _container3, _container4;
			var container = null;
			var query = hashedId;
			var matchedHandle = getAllApiHandles().find(function(handle) {
				var _handle$hashedId2;
				if ((_handle$hashedId2 = handle.hashedId()) !== null && _handle$hashedId2 !== void 0 && _handle$hashedId2.startsWith(query)) return handle;
				return null;
			});
			if (matchedHandle !== "removed") {
				var _ref2;
				container = (_ref2 = matchedHandle === null || matchedHandle === void 0 ? void 0 : matchedHandle.container) !== null && _ref2 !== void 0 ? _ref2 : null;
			}
			if (((_container3 = container) === null || _container3 === void 0 ? void 0 : _container3.tagName) === "WISTIA-PLAYER") return container.deprecatedApiDoNotUse;
			if (((_container4 = container) === null || _container4 === void 0 ? void 0 : _container4.wistiaApi) !== void 0 && container.wistiaApi !== "removed") return container.wistiaApi;
			return null;
		};
		/**
		* Get all (non-iframe) API handles in the order they appear in the DOM
		* @returns {PublicApi[]}
		*/
		var getAllApiHandlesByDomOrder = function getAllApiHandlesByDomOrder() {
			var legacyHandles = Array.from(getAllApiEmbedElements("wistia_embed_initialized")).reduce(function(accumulator, legacyContainer) {
				if (legacyContainer.wistiaApi !== void 0 && legacyContainer.wistiaApi !== "removed" && legacyContainer.wistiaApi !== null) accumulator.push(legacyContainer.wistiaApi);
				return accumulator;
			}, []);
			var wistiaPlayerHandles = Array.from(document.querySelectorAll("wistia-player")).reduce(function(accumulator, container) {
				if (container.deprecatedApiDoNotUse !== void 0 && container.deprecatedApiDoNotUse !== "removed" && container.deprecatedApiDoNotUse !== null) accumulator.push(container.deprecatedApiDoNotUse);
				return accumulator;
			}, []);
			return [].concat(_toConsumableArray(legacyHandles), _toConsumableArray(wistiaPlayerHandles));
		};
	},
	5819(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { V: () => Thumbnail });
		var utilities_image_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(4635);
		var preact__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5181);
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(731);
		var utilities_elem_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(7715);
		var _translations_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(4730);
		function _classCallCheck(a, n) {
			if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
		}
		function _defineProperties(e, r) {
			for (var t = 0; t < r.length; t++) {
				var o = r[t];
				o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
			}
		}
		function _createClass(e, r, t) {
			return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		function _callSuper(t, o, e) {
			return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
		}
		function _possibleConstructorReturn(t, e) {
			if (e && ("object" == typeof e || "function" == typeof e)) return e;
			if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
			return _assertThisInitialized(t);
		}
		function _assertThisInitialized(e) {
			if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
			return e;
		}
		function _isNativeReflectConstruct() {
			try {
				var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
			} catch (t) {}
			return (_isNativeReflectConstruct = function _isNativeReflectConstruct() {
				return !!t;
			})();
		}
		function _getPrototypeOf(t) {
			return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t) {
				return t.__proto__ || Object.getPrototypeOf(t);
			}, _getPrototypeOf(t);
		}
		function _inherits(t, e) {
			if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
			t.prototype = Object.create(e && e.prototype, { constructor: {
				value: t,
				writable: !0,
				configurable: !0
			} }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);
		}
		function _setPrototypeOf(t, e) {
			return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t, e) {
				return t.__proto__ = e, t;
			}, _setPrototypeOf(t, e);
		}
		(0, _translations_js__WEBPACK_IMPORTED_MODULE_4__.Oj)("en-US", { THUMBNAIL_VIDEO_THUMBNAIL: "Video Thumbnail" });
		var Thumbnail = /*#__PURE__*/ function(_Component) {
			function Thumbnail(props) {
				var _this;
				_classCallCheck(this, Thumbnail);
				_this = _callSuper(this, Thumbnail, [props]);
				_this.initialState = _this.state = {
					isLoaded: false,
					isDisplaying: false
				};
				_this.onDisplay = _this.props.onDisplay;
				return _this;
			}
			_inherits(Thumbnail, _Component);
			return _createClass(Thumbnail, [
				{
					key: "componentWillReceiveProps",
					value: function componentWillReceiveProps(nextProps) {
						if (nextProps.images !== this.props.images) {
							this._sortedImages = null;
							this.setState({
								isLoaded: false,
								isDisplaying: false
							});
						}
						if (!this.onDisplay && nextProps.onDisplay) this.onDisplay = nextProps.onDisplay;
					}
				},
				{
					key: "render",
					value: function render() {
						var _this2 = this;
						var altText = this.props.thumbnailAltText !== void 0 ? this.props.thumbnailAltText : this.translate("VIDEO_THUMBNAIL");
						return (0, preact__WEBPACK_IMPORTED_MODULE_1__.h)("div", {
							style: this.wrapperStyle(),
							class: "w-css-reset"
						}, (0, preact__WEBPACK_IMPORTED_MODULE_1__.h)("img", {
							class: "w-css-reset",
							srcset: this.props.images.length > 1 ? this.srcSet() : null,
							src: this.bestSrc(),
							style: this.imgStyle(),
							alt: altText,
							ref: function ref(e) {
								return _this2.imgElem = e;
							},
							"aria-hidden": this.props.ariaHidden ? "true" : null
						}));
					}
				},
				{
					key: "translate",
					value: function translate(key) {
						return (0, _translations_js__WEBPACK_IMPORTED_MODULE_4__.sC)(this.props.playerLanguage, "THUMBNAIL_".concat(key));
					}
				},
				{
					key: "componentDidMount",
					value: function componentDidMount() {
						this.setStateBasedOnImgStatus();
						this.maybeCallOnDisplay(this.initialState);
					}
				},
				{
					key: "componentDidUpdate",
					value: function componentDidUpdate(prevProps, prevState) {
						this.setStateBasedOnImgStatus();
						this.maybeCallOnDisplay(prevState);
					}
				},
				{
					key: "maybeCallOnDisplay",
					value: function maybeCallOnDisplay() {
						if (this.onDisplay && this.state.isDisplaying && !this.calledOnDisplay) {
							this.calledOnDisplay = true;
							this.onDisplay();
						}
					}
				},
				{
					key: "setStateBasedOnImgStatus",
					value: function setStateBasedOnImgStatus() {
						var _this3 = this;
						var state = this.state;
						var imgElem = this.imgElem;
						if (state.isLoaded) return;
						if (!imgElem.onload) imgElem.onload = function() {
							if ((0, utilities_elem_js__WEBPACK_IMPORTED_MODULE_3__.lj)(imgElem)) _this3.setState({
								isLoaded: true,
								isDisplaying: true
							});
						};
						if (imgElem.complete) this.setState({
							isLoaded: true,
							isDisplaying: true
						});
					}
				},
				{
					key: "wrapperStyle",
					value: function wrapperStyle() {
						var shouldShow = this.state.isDisplaying && this.props.isVisible;
						return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__.kp)({}, this.props.wrapperStyle, { display: this.state.isLoaded && !shouldShow ? "none" : "block" });
					}
				},
				{
					key: "baseStyle",
					value: function baseStyle() {
						var fitStrategy = this.props.fitStrategy;
						if (fitStrategy === "cover") return this.coverStyle();
						if (fitStrategy === "contain") return this.containStyle();
						if (fitStrategy === "fill") return this.fillStyle();
						if (fitStrategy === "naturalHeight") return this.naturalHeightStyle();
						return this.containStyle();
					}
				},
				{
					key: "imgStyle",
					value: function imgStyle() {
						var shouldShow = this.state.isDisplaying && this.props.isVisible;
						return (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__.kp)(this.baseStyle(), {
							clip: shouldShow ? "auto" : "rect(0,0,0,0)",
							display: this.state.isLoaded && !shouldShow ? "none" : "block",
							borderRadius: "".concat(this.props.playerBorderRadius, "px")
						});
					}
				},
				{
					key: "containStyle",
					value: function containStyle() {
						return {
							backgroundColor: this.props.backgroundColor || "#000",
							height: "100%",
							objectFit: "contain",
							position: "absolute",
							width: "100%",
							top: 0,
							left: 0
						};
					}
				},
				{
					key: "coverStyle",
					value: function coverStyle() {
						return {
							height: "100%",
							objectFit: "cover",
							position: "absolute",
							width: "100%"
						};
					}
				},
				{
					key: "fillStyle",
					value: function fillStyle() {
						return {
							height: "100%",
							objectFit: "fill",
							position: "absolute",
							width: "100%"
						};
					}
				},
				{
					key: "naturalHeightStyle",
					value: function naturalHeightStyle() {
						return {
							width: "100%",
							position: "relative"
						};
					}
				},
				{
					key: "bestSrc",
					value: function bestSrc() {
						return (0, utilities_image_js__WEBPACK_IMPORTED_MODULE_0__.cd)(this.props.images, {
							videoWidth: this.props.videoWidth,
							videoHeight: this.props.videoHeight
						}).url;
					}
				},
				{
					key: "srcSet",
					value: function srcSet() {
						var sortedImages = this.sortedImages();
						if (sortedImages.length === 0) sortedImages = [(0, utilities_image_js__WEBPACK_IMPORTED_MODULE_0__.YG)(this.props.videoWidth, this.props.videoHeight)];
						return sortedImages.map(function(image) {
							return "".concat(image.url, " ").concat(image.width, "w");
						}).join(", ");
					}
				},
				{
					key: "sortedImages",
					value: function sortedImages() {
						if (this._sortedImages) return this._sortedImages;
						this._sortedImages = (0, utilities_image_js__WEBPACK_IMPORTED_MODULE_0__.eZ)(this.props.images);
						return this._sortedImages;
					}
				},
				{
					key: "stretchLimit",
					value: function stretchLimit() {
						var stretchLimit = this.props.stretchLimit;
						if (stretchLimit != null) return stretchLimit;
						return 10;
					}
				}
			]);
		}(preact__WEBPACK_IMPORTED_MODULE_1__.Component);
	},
	5833(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { n: () => getInitialMediaData });
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5509);
		var _utilities_script_utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(159);
		var _utilities_media_data_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1885);
		var _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5857);
		var _utilities_media_data_transforms_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(3917);
		var _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(3411);
		var _utilities_mediaDataError_ts__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(959);
		var _utilities_obj_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(731);
		var _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(3065);
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		function _regenerator() {
			/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag";
			function i(r, n, o, i) {
				var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype);
				return _regeneratorDefine2(u, "_invoke", function(r, n, o) {
					var i, c, u, f = 0, p = o || [], y = !1, G = {
						p: 0,
						n: 0,
						v: e,
						a: d,
						f: d.bind(e, 4),
						d: function d(t, r) {
							return i = t, c = 0, u = e, G.n = r, a;
						}
					};
					function d(r, n) {
						for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) {
							var o, i = p[t], d = G.p, l = i[2];
							r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0));
						}
						if (o || r > 1) return a;
						throw y = !0, n;
					}
					return function(o, p, l) {
						if (f > 1) throw TypeError("Generator is already running");
						for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) {
							i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u);
							try {
								if (f = 2, i) {
									if (c || (o = "next"), t = i[o]) {
										if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object");
										if (!t.done) return t;
										u = t.value, c < 2 && (c = 0);
									} else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1);
									i = e;
								} else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break;
							} catch (t) {
								i = e, c = 1, u = t;
							} finally {
								f = 1;
							}
						}
						return {
							value: t,
							done: y
						};
					};
				}(r, o, i), !0), u;
			}
			var a = {};
			function Generator() {}
			function GeneratorFunction() {}
			function GeneratorFunctionPrototype() {}
			t = Object.getPrototypeOf;
			var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function() {
				return this;
			}), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c);
			function f(e) {
				return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e;
			}
			return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function() {
				return this;
			}), _regeneratorDefine2(u, "toString", function() {
				return "[object Generator]";
			}), (_regenerator = function _regenerator() {
				return {
					w: i,
					m: f
				};
			})();
		}
		function _regeneratorDefine2(e, r, n, t) {
			var i = Object.defineProperty;
			try {
				i({}, "", {});
			} catch (e) {
				i = 0;
			}
			_regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) {
				function o(r, n) {
					_regeneratorDefine2(e, r, function(e) {
						return this._invoke(r, n, e);
					});
				}
				r ? i ? i(e, r, {
					value: n,
					enumerable: !t,
					configurable: !t,
					writable: !t
				}) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2));
			}, _regeneratorDefine2(e, r, n, t);
		}
		function asyncGeneratorStep(n, t, e, r, o, a, c) {
			try {
				var i = n[a](c), u = i.value;
			} catch (n) {
				e(n);
				return;
			}
			i.done ? t(u) : Promise.resolve(u).then(r, o);
		}
		function _asyncToGenerator(n) {
			return function() {
				var t = this, e = arguments;
				return new Promise(function(r, o) {
					var a = n.apply(t, e);
					function _next(n) {
						asyncGeneratorStep(a, r, o, _next, _throw, "next", n);
					}
					function _throw(n) {
						asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);
					}
					_next(void 0);
				});
			};
		}
		var INTERVAL_TIME = 15;
		var JS_LOAD_TIMEOUT = 3e4;
		var SERVER_FETCH_FALLBACK_TIMEOUT = 15e3;
		var doesJsonpExist = function doesJsonpExist(mediaId) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var matchUrl = (0, _utilities_media_data_js__WEBPACK_IMPORTED_MODULE_2__.CC)(mediaId, options).replace(/\.json(?!p)/, ".jsonp").replace(/&$/, "");
			var isJsonpScriptInDom = (0, _utilities_script_utils_js__WEBPACK_IMPORTED_MODULE_1__.Rb)(matchUrl, {
				ignoreProtocol: true,
				scriptRegex: (0, _utilities_media_data_js__WEBPACK_IMPORTED_MODULE_2__.dq)(mediaId)
			});
			return Boolean(isJsonpScriptInDom);
		};
		var jsScriptUrl = function jsScriptUrl(mediaId) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var host = (0, _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.Dd)(options);
			return "".concat((0, _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.v9)(), "//").concat(host, "/embed/").concat(mediaId, ".js");
		};
		var doesJsMediaDataScriptExist = function doesJsMediaDataScriptExist(mediaId) {
			var url = jsScriptUrl(mediaId, arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {});
			var isJsScriptInDom = (0, _utilities_script_utils_js__WEBPACK_IMPORTED_MODULE_1__.Rb)(url, { ignoreProtocol: true });
			return Boolean(isJsScriptInDom);
		};
		var pollForJsonp = /*#__PURE__*/ function() {
			var _ref = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee(mediaId, options) {
				return _regenerator().w(function(_context) {
					while (1) switch (_context.n) {
						case 0: return _context.a(2, new Promise(function(resolve, reject) {
							var pollState = {
								isSettled: false,
								intervalId: -1,
								timeoutId: -1
							};
							var cleanup = function cleanup() {
								pollState.isSettled = true;
								clearInterval(pollState.intervalId);
								clearTimeout(pollState.timeoutId);
							};
							var checkForJsonp = function checkForJsonp() {
								var jsonp = window["wistiajsonp-/embed/medias/".concat(mediaId, ".jsonp")];
								if (jsonp) {
									if (jsonp.media) {
										cleanup();
										(0, _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_5__.ry)(mediaId, jsonp.media);
										(0, _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__.j)(mediaId, options).then(resolve).catch(function() {
											reject(/* @__PURE__ */ new Error("Failed to fetch media data via jsonp"));
										});
										return;
									}
									if ((0, _utilities_mediaDataError_ts__WEBPACK_IMPORTED_MODULE_6__.V)(jsonp)) {
										cleanup();
										resolve(jsonp);
									}
								}
							};
							checkForJsonp();
							if (pollState.isSettled) return;
							pollState.intervalId = window.setInterval(checkForJsonp, INTERVAL_TIME);
							pollState.timeoutId = window.setTimeout(function() {
								cleanup();
								reject(/* @__PURE__ */ new Error("Timeout loading jsonp media data"));
							}, JS_LOAD_TIMEOUT);
						}));
					}
				}, _callee);
			}));
			return function pollForJsonp(_x, _x2) {
				return _ref.apply(this, arguments);
			};
		}();
		var getJsScript = /*#__PURE__*/ function() {
			var _ref2 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee3(mediaId) {
				var options, url, _args3 = arguments;
				return _regenerator().w(function(_context3) {
					while (1) switch (_context3.n) {
						case 0:
							options = _args3.length > 1 && _args3[1] !== void 0 ? _args3[1] : {};
							url = jsScriptUrl(mediaId, options);
							return _context3.a(2, new Promise(function(resolve, reject) {
								setTimeout(function() {
									reject(/* @__PURE__ */ new Error("Timeout loading js media data"));
								}, JS_LOAD_TIMEOUT);
								import(
									/* webpackIgnore: true */
									url
).then(function(module) {
									var mediaData = module.mediaData;
									(0, _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_5__.ry)(mediaId, mediaData);
								}).then(/*#__PURE__*/ _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee2() {
									return _regenerator().w(function(_context2) {
										while (1) switch (_context2.n) {
											case 0: return _context2.a(2, (0, _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__.j)(mediaId, options));
										}
									}, _callee2);
								}))).then(resolve).catch(function(err) {
									reject(err instanceof Error ? err : new Error(String(err)));
								});
							}));
					}
				}, _callee3);
			}));
			return function getJsScript(_x3) {
				return _ref2.apply(this, arguments);
			};
		}();
		var fetchMediaDataDelayed = function fetchMediaDataDelayed(mediaId) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var timeoutRef = { current: -1 };
			return [new Promise(function(resolve, reject) {
				timeoutRef.current = window.setTimeout(function() {
					(0, _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__.j)(mediaId, options).then(resolve).catch(function(err) {
						reject(err instanceof Error ? err : new Error(String(err)));
					});
				}, SERVER_FETCH_FALLBACK_TIMEOUT);
			}), timeoutRef];
		};
		var getInitialMediaData = /*#__PURE__*/ function() {
			var _ref4 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee4(mediaId) {
				var _Wistia$_inlineMediaD;
				var options, mediaDataFromCache, inlineMediaData, clonedInlineMediaData, speedDemonPromises, mediaData, _fetchMediaDataDelaye, _fetchMediaDataDelaye2, delayedMediaDataPromise, delayedFetchTimeoutRef, _args4 = arguments;
				return _regenerator().w(function(_context4) {
					while (1) switch (_context4.n) {
						case 0:
							options = _args4.length > 1 && _args4[1] !== void 0 ? _args4[1] : {};
							mediaDataFromCache = (0, _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_5__.F2)(mediaId);
							if (!(mediaDataFromCache != null && options.skipCache !== true)) {
								_context4.n = 1;
								break;
							}
							return _context4.a(2, (0, _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__.j)(mediaId, options));
						case 1:
							inlineMediaData = (_Wistia$_inlineMediaD = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s._inlineMediaData) === null || _Wistia$_inlineMediaD === void 0 ? void 0 : _Wistia$_inlineMediaD[mediaId];
							if (!(inlineMediaData != null)) {
								_context4.n = 2;
								break;
							}
							clonedInlineMediaData = (0, _utilities_obj_js__WEBPACK_IMPORTED_MODULE_7__.o8)(inlineMediaData);
							(0, _utilities_media_data_transforms_js__WEBPACK_IMPORTED_MODULE_4__.M)(clonedInlineMediaData, options);
							(0, _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_5__.ry)(mediaId, clonedInlineMediaData);
							return _context4.a(2, (0, _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__.j)(mediaId, options));
						case 2:
							speedDemonPromises = [];
							if (doesJsonpExist(mediaId, options)) speedDemonPromises.push(pollForJsonp(mediaId, options));
							if (doesJsMediaDataScriptExist(mediaId, options)) speedDemonPromises.push(getJsScript(mediaId, options));
							if (!(speedDemonPromises.length === 0)) {
								_context4.n = 4;
								break;
							}
							_context4.n = 3;
							return (0, _utilities_fetchMediaData_ts__WEBPACK_IMPORTED_MODULE_8__.j)(mediaId, options);
						case 3:
							mediaData = _context4.v;
							_context4.n = 6;
							break;
						case 4:
							_fetchMediaDataDelaye = fetchMediaDataDelayed(mediaId, options), _fetchMediaDataDelaye2 = _slicedToArray(_fetchMediaDataDelaye, 2), delayedMediaDataPromise = _fetchMediaDataDelaye2[0], delayedFetchTimeoutRef = _fetchMediaDataDelaye2[1];
							_context4.n = 5;
							return Promise.any([].concat(speedDemonPromises, [delayedMediaDataPromise]));
						case 5:
							mediaData = _context4.v;
							clearTimeout(delayedFetchTimeoutRef.current);
						case 6: return _context4.a(2, mediaData);
					}
				}, _callee4);
			}));
			return function getInitialMediaData(_x4) {
				return _ref4.apply(this, arguments);
			};
		}();
	},
	5857(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			CX: () => cdnFastWistiaComHost,
			Dd: () => mediaDataHost,
			KG: () => PROD_FASTLY_SSL_HOST,
			Qz: () => metricsHost,
			U4: () => TAGGED_VERSION,
			aY: () => eV1HostWithPort,
			bC: () => eV1Host,
			bF: () => PROD_FAST_HOSTNAME_NET,
			cu: () => SSL_EMBED_HOST,
			hk: () => PROD_EMBED_HOST,
			iD: () => PROD_SSL_EMBED_HOST,
			kh: () => cdnFastWistiaNetHost,
			lR: () => CURRENT_SHA,
			pK: () => EMBED_HOST,
			pb: () => PROD_FAST_HOSTNAME_COM,
			v9: () => eV1Protocol
		});
		var utilities_root_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(8176);
		var utilities_url_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(2671);
		var _appHostname_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(787);
		var APP_WISTIA_COM = (0, _appHostname_js__WEBPACK_IMPORTED_MODULE_2__.Ni)("app");
		var CDN_FAST_PROTECTED_WISTIA_COM = (0, _appHostname_js__WEBPACK_IMPORTED_MODULE_2__.Ni)("fast-protected");
		var CDN_FAST_WISTIA_COM = (0, _appHostname_js__WEBPACK_IMPORTED_MODULE_2__.Ni)("fast");
		var CDN_FAST_WISTIA_CANARY = "fast-canary.wistia.net";
		var EMBED_HOST = "embed.wistia.com";
		var PROD_FAST_HOSTNAME_NET = "fast.wistia.net";
		var PROD_FAST_HOSTNAME_COM = "fast.wistia.com";
		var PROD_EMBED_HOST = "embed.wistia.com";
		var PROD_SSL_EMBED_HOST = "embed-ssl.wistia.com";
		var PROD_FASTLY_SSL_HOST = "embed-fastly.wistia.com";
		var SSL_EMBED_HOST = "embed-ssl.wistia.com";
		var TAGGED_VERSION = "0.7.12";
		var CURRENT_SHA = "01d97dee6fbb2a9d20e51228ee7b76cd1a281fe6";
		var DEFAULT_PROTOCOL = function() {
			if (typeof window !== "undefined" && utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z === window && utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.location) return utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.location.protocol;
			return "https:";
		}();
		var sslOrNonSsl = function sslOrNonSsl(protocol, sslHost, nonSslHost) {
			return protocol === "https:" ? sslHost : nonSslHost;
		};
		var deliveryHost = function deliveryHost() {
			return sslOrNonSsl(arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : DEFAULT_PROTOCOL, SSL_EMBED_HOST, EMBED_HOST);
		};
		var appHost = function appHost() {
			return APP_WISTIA_COM;
		};
		/**
		* Checks if we're running in a cloud dev environment or exposing a public endpoint
		* via a dev metal tunnel and returns the appropriate fast hostname
		* @returns {string|null} The fast hostname for cloud dev environment, or null if not in cloud dev
		*/
		var getDevFastHostname = function getDevFastHostname() {
			var fastDevHostname = (0, _appHostname_js__WEBPACK_IMPORTED_MODULE_2__.rY)("fast");
			if (fastDevHostname) return fastDevHostname;
			return null;
		};
		/**
		* @param {string} embedHost
		* @returns {string}
		*/
		var cdnFastWistiaComHost = function cdnFastWistiaComHost() {
			var embedHost = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : void 0;
			if (embedHost) return embedHost;
			var devFastHostname = getDevFastHostname();
			if (devFastHostname) return devFastHostname;
			return CDN_FAST_WISTIA_COM;
		};
		var cdnFastProtectedWistiaComHost = function cdnFastProtectedWistiaComHost(assetHost) {
			if (assetHost) return assetHost;
			return CDN_FAST_PROTECTED_WISTIA_COM;
		};
		var cdnFastWistiaNetHost = function cdnFastWistiaNetHost() {
			var devFastHostname = getDevFastHostname();
			if (devFastHostname) return devFastHostname;
			return "fast.".concat("wistia.net");
		};
		var cdnFastWistiaCanaryHost = function cdnFastWistiaCanaryHost() {
			return CDN_FAST_WISTIA_CANARY;
		};
		var eV1Url = function() {
			var scripts = document.getElementsByTagName("script");
			for (var i = 0; i < scripts.length; i++) {
				var s = scripts[i];
				if (s.src) {
					var url = new utilities_url_js__WEBPACK_IMPORTED_MODULE_1__.s0(s.src);
					var pathIsEv1 = /\/assets\/external\/E-v1?\.js$/.test(url.rawPath);
					var hasKnownHost = url.host === cdnFastWistiaComHost() || url.host === cdnFastWistiaNetHost() || url.host === cdnFastWistiaCanaryHost();
					var usesHttpsIfRequired = location.protocol === "https:" && url.protocol === "https:";
					var isProtocolRelative = url.protocol === "" || url.protocol == null;
					var protoIsSane = usesHttpsIfRequired || isProtocolRelative || location.protocol === "http:";
					var scriptHasLoaded = !s.readyState || /loaded|complete/.test(s.readyState);
					if (pathIsEv1 && hasKnownHost && protoIsSane && scriptHasLoaded) return url;
				}
			}
			return new utilities_url_js__WEBPACK_IMPORTED_MODULE_1__.s0("".concat((0, utilities_url_js__WEBPACK_IMPORTED_MODULE_1__.ff)(), "//").concat(cdnFastWistiaNetHost(), "/E-v1.js"));
		}();
		/**
		* @returns { string } string of the host
		*/
		var eV1Host = function eV1Host() {
			return eV1Url.host;
		};
		/**
		* @returns { string } string of the host with port
		*/
		var eV1HostWithPort = function eV1HostWithPort() {
			if (eV1Url.port) return "".concat(eV1Host(), ":").concat(eV1Url.port);
			return eV1Host();
		};
		/**
		* @returns { string } string of the protocol
		*/
		var eV1Protocol = function eV1Protocol() {
			return eV1Url.protocol;
		};
		var mediaDataHost = function mediaDataHost() {
			var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			if (options.embedHost) return forceValidFastWistiaHost(options.embedHost);
			return eV1HostWithPort();
		};
		var metricsHost = function metricsHost() {
			return "pipedream.".concat("wistia.com");
		};
		var VALID_FASTLY_HOSTS = [].concat(["wistia.net", "wistia.com"], [
			"wistia.mx",
			"wistia.dev",
			"wistia.tech",
			"wistia.am",
			"wistia.se",
			"wistia.io",
			"wistia.st"
		]);
		var VALID_FASTLY_HOSTS_R = new RegExp("(".concat(VALID_FASTLY_HOSTS.map(function(h) {
			return "\\.".concat(h.replace(".", "\\."));
		}).join("|"), ")$"));
		var forceValidFastWistiaHost = function forceValidFastWistiaHost(host) {
			if (host && VALID_FASTLY_HOSTS_R.test(host)) return host;
			return eV1HostWithPort();
		};
		/**
		* Checks to see if the window location is a page that's hosted by wistia,
		* e.g., https://app.wistia.com, http://player.wistia.io, https://customer-name.wistia.com
		*
		* If so, return false.
		*
		* @returns boolean
		*/
		var isEmbedOnACustomerPage = function isEmbedOnACustomerPage() {
			return window.location.href.match(/^http(s)?:\/\/(\S)*.wistia.(io|test|st|com)/gi) === null;
		};
	},
	6461(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		var utilities_script_utils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(159);
		var getScriptTags = function getScriptTags(htmlStr) {
			return htmlStr.match(/<script.*?src[^>]*>\s*<\/script>|<script.*?>[\s\S]+?<\/script>/gi) || [];
		};
		var scriptTagsToRunScriptsInput = function scriptTagsToRunScriptsInput(scriptTags) {
			if (!scriptTags) return [];
			if (!(scriptTags instanceof Array)) scriptTags = getScriptTags(scriptTags);
			var hashes = [];
			var _loop = function _loop() {
				var scriptTag = scriptTags[i];
				var hash = {};
				var matches = scriptTag.match(/<script.*?>/i);
				if (matches) {
					matches = matches[0].match(/src="([^"]+)"/i);
					if (matches) {
						hash.src = matches[1];
						hash.async = /async/i.test(scriptTag.replace(hash.src, ""));
					}
				}
				if (!matches) {
					matches = scriptTag.match(/<script>([\s\S]+?)<\/script>/i);
					if (matches) {
						var src = matches[1];
						hash.fn = function() {
							return eval(src);
						};
					}
				}
				hashes.push(hash);
			};
			for (var i = 0; i < scriptTags.length; i++) _loop();
			return hashes;
		};
		var execScriptTags = function execScriptTags(scriptTags, callback) {
			if (!scriptTags) return null;
			var hashes = scriptTagsToRunScriptsInput(scriptTags);
			return runScripts(hashes).then(callback);
		};
		var removeScriptTags = function removeScriptTags(htmlStr) {
			return htmlStr.replace(/<script.*?src[^>]*>\s*<\/script>|<script>[\s\S]+?<\/script>/g, "");
		};
	},
	6462(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { I: () => PlayerDataHandler });
		var lodash_merge__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(8089);
		var lodash_merge__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/ __webpack_require__.n(lodash_merge__WEBPACK_IMPORTED_MODULE_0__);
		var lodash_clonedeep__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(8290);
		var lodash_clonedeep__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/ __webpack_require__.n(lodash_clonedeep__WEBPACK_IMPORTED_MODULE_1__);
		var _utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(731);
		function _classCallCheck(a, n) {
			if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
		}
		function _defineProperties(e, r) {
			for (var t = 0; t < r.length; t++) {
				var o = r[t];
				o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
			}
		}
		function _createClass(e, r, t) {
			return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		function _classPrivateMethodInitSpec(e, a) {
			_checkPrivateRedeclaration(e, a), a.add(e);
		}
		function _classPrivateFieldInitSpec(e, t, a) {
			_checkPrivateRedeclaration(e, t), t.set(e, a);
		}
		function _checkPrivateRedeclaration(e, t) {
			if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object");
		}
		function _classPrivateFieldSet(s, a, r) {
			return s.set(_assertClassBrand(s, a), r), r;
		}
		function _classPrivateFieldGet(s, a) {
			return s.get(_assertClassBrand(s, a));
		}
		function _assertClassBrand(e, t, n) {
			if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n;
			throw new TypeError("Private element is not present on this object");
		}
		var _embedOptionOverrides = /*#__PURE__*/ new WeakMap();
		var _embedOptions = /*#__PURE__*/ new WeakMap();
		var _mediaData = /*#__PURE__*/ new WeakMap();
		var _sourceEmbedOptions = /*#__PURE__*/ new WeakMap();
		var _sourceMediaData = /*#__PURE__*/ new WeakMap();
		var _PlayerDataHandler_brand = /*#__PURE__*/ new WeakSet();
		var PlayerDataHandler = /*#__PURE__*/ function() {
			function PlayerDataHandler() {
				_classCallCheck(this, PlayerDataHandler);
				/**
				* Merge the source embed options together to create a single source of truth of embed options
				* @private
				* @returns {void}
				*/
				_classPrivateMethodInitSpec(this, _PlayerDataHandler_brand);
				_classPrivateFieldInitSpec(this, _embedOptionOverrides, {});
				_classPrivateFieldInitSpec(this, _embedOptions, {});
				_classPrivateFieldInitSpec(this, _mediaData, {});
				_classPrivateFieldInitSpec(this, _sourceEmbedOptions, {
					domOptions: {},
					iframeOptions: {},
					mediaDataOptions: {},
					wistiaWindowOptions: {}
				});
				_classPrivateFieldInitSpec(this, _sourceMediaData, {});
			}
			return _createClass(PlayerDataHandler, [
				{
					key: "embedOptions",
					get: 
					/**
					* Returns the final embed options which are a merge of all the source data and the overrides
					* @returns {EmbedOptions}
					* @readonly
					*/
					function get() {
						return _classPrivateFieldGet(_embedOptions, this);
					}
				},
				{
					key: "mediaData",
					get: function get() {
						_classPrivateFieldGet(_mediaData, this).embedOptions = _classPrivateFieldGet(_embedOptions, this);
						return _classPrivateFieldGet(_mediaData, this);
					}
				},
				{
					key: "setDomEmbedOptionSource",
					value: function setDomEmbedOptionSource(data) {
						_classPrivateFieldGet(_sourceEmbedOptions, this).domOptions = data;
						_assertClassBrand(_PlayerDataHandler_brand, this, _updatePlayerEmbedOptions).call(this);
					}
				},
				{
					key: "setIframeEmbedOptionSource",
					value: function setIframeEmbedOptionSource(data) {
						_classPrivateFieldGet(_sourceEmbedOptions, this).iframeOptions = data;
						_assertClassBrand(_PlayerDataHandler_brand, this, _updatePlayerEmbedOptions).call(this);
					}
				},
				{
					key: "setMediaDataSource",
					value: function setMediaDataSource(data) {
						var _cloneDeep;
						_classPrivateFieldSet(_sourceMediaData, this, data);
						_classPrivateFieldSet(_mediaData, this, (0, _utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__.wg)(lodash_clonedeep__WEBPACK_IMPORTED_MODULE_1___default()(_classPrivateFieldGet(_sourceMediaData, this))));
						if (_classPrivateFieldGet(_mediaData, this).hashedId !== void 0) _classPrivateFieldGet(_mediaData, this).hashedId = _classPrivateFieldGet(_mediaData, this).hashedId.toString();
						_classPrivateFieldGet(_sourceEmbedOptions, this).mediaDataOptions = (_cloneDeep = lodash_clonedeep__WEBPACK_IMPORTED_MODULE_1___default()(_classPrivateFieldGet(_mediaData, this).embedOptions)) !== null && _cloneDeep !== void 0 ? _cloneDeep : {};
						_assertClassBrand(_PlayerDataHandler_brand, this, _updatePlayerEmbedOptions).call(this);
					}
				},
				{
					key: "setWistiaWindowEmbedOptionSource",
					value: function setWistiaWindowEmbedOptionSource(data) {
						_classPrivateFieldGet(_sourceEmbedOptions, this).wistiaWindowOptions = data;
						_assertClassBrand(_PlayerDataHandler_brand, this, _updatePlayerEmbedOptions).call(this);
					}
				},
				{
					key: "updateEmbedOptionOverrides",
					value: function updateEmbedOptionOverrides(data) {
						_classPrivateFieldSet(_embedOptionOverrides, this, lodash_merge__WEBPACK_IMPORTED_MODULE_0___default()(_classPrivateFieldGet(_embedOptionOverrides, this), data));
						_classPrivateFieldSet(_embedOptions, this, lodash_merge__WEBPACK_IMPORTED_MODULE_0___default()(_classPrivateFieldGet(_embedOptions, this), _classPrivateFieldGet(_embedOptionOverrides, this)));
					}
				}
			]);
		}();
		function _updatePlayerEmbedOptions() {
			var _classPrivateFieldGet2 = _classPrivateFieldGet(_sourceEmbedOptions, this), mediaDataOptions = _classPrivateFieldGet2.mediaDataOptions, wistiaWindowOptions = _classPrivateFieldGet2.wistiaWindowOptions, domOptions = _classPrivateFieldGet2.domOptions, iframeOptions = _classPrivateFieldGet2.iframeOptions;
			_classPrivateFieldSet(_embedOptions, this, (0, _utilities_obj_js__WEBPACK_IMPORTED_MODULE_2__.wg)(lodash_merge__WEBPACK_IMPORTED_MODULE_0___default()({}, mediaDataOptions !== null && mediaDataOptions !== void 0 ? mediaDataOptions : {}, wistiaWindowOptions !== null && wistiaWindowOptions !== void 0 ? wistiaWindowOptions : {}, domOptions !== null && domOptions !== void 0 ? domOptions : {}, iframeOptions !== null && iframeOptions !== void 0 ? iframeOptions : {}, _classPrivateFieldGet(_embedOptionOverrides, this))));
			_classPrivateFieldGet(_mediaData, this).embedOptions = _classPrivateFieldGet(_embedOptions, this);
		}
	},
	6633(__unused_webpack_module, exports) {
		var __webpack_unused_export__;
		exports.fP = exports._N = exports.qg = exports.T1 = void 0;
		/**
		* The pattern used for parsing ISO8601 duration (PnYnMnWnDTnHnMnS).
		*/
		var numbers = "\\d+";
		var fractionalNumbers = "".concat(numbers, "(?:[\\.,]").concat(numbers, ")?");
		var datePattern = "(".concat(numbers, "Y)?(").concat(numbers, "M)?(").concat(numbers, "W)?(").concat(numbers, "D)?");
		var timePattern = "T(".concat(fractionalNumbers, "H)?(").concat(fractionalNumbers, "M)?(").concat(fractionalNumbers, "S)?");
		var iso8601 = "P(?:".concat(datePattern, "(?:").concat(timePattern, ")?)");
		var objMap = [
			"years",
			"months",
			"weeks",
			"days",
			"hours",
			"minutes",
			"seconds"
		];
		var defaultDuration = Object.freeze({
			years: 0,
			months: 0,
			weeks: 0,
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0
		});
		/**
		* The ISO8601 regex for matching / testing durations
		*/
		exports.T1 = new RegExp(iso8601);
		/** Parse PnYnMnDTnHnMnS format to object */
		var parse = function(durationString) {
			var matches = durationString.replace(/,/g, ".").match(exports.T1);
			if (!matches) throw new RangeError("invalid duration: ".concat(durationString));
			var slicedMatches = matches.slice(1);
			if (slicedMatches.filter(function(v) {
				return v != null;
			}).length === 0) throw new RangeError("invalid duration: ".concat(durationString));
			if (slicedMatches.filter(function(v) {
				return /\./.test(v || "");
			}).length > 1) throw new RangeError("only the smallest unit can be fractional");
			return slicedMatches.reduce(function(prev, next, idx) {
				prev[objMap[idx]] = parseFloat(next || "0") || 0;
				return prev;
			}, {});
		};
		exports.qg = parse;
		/** Convert ISO8601 duration object to an end Date. */
		var end = function(durationInput, startDate) {
			if (startDate === void 0) startDate = /* @__PURE__ */ new Date();
			var duration = Object.assign({}, defaultDuration, durationInput);
			var timestamp = startDate.getTime();
			var then = new Date(timestamp);
			then.setFullYear(then.getFullYear() + duration.years);
			then.setMonth(then.getMonth() + duration.months);
			then.setDate(then.getDate() + duration.days);
			var hoursInMs = duration.hours * 3600 * 1e3;
			var minutesInMs = duration.minutes * 60 * 1e3;
			then.setMilliseconds(then.getMilliseconds() + duration.seconds * 1e3 + hoursInMs + minutesInMs);
			then.setDate(then.getDate() + duration.weeks * 7);
			return then;
		};
		exports._N = end;
		/** Convert ISO8601 duration object to seconds */
		var toSeconds = function(durationInput, startDate) {
			if (startDate === void 0) startDate = /* @__PURE__ */ new Date();
			var duration = Object.assign({}, defaultDuration, durationInput);
			var timestamp = startDate.getTime();
			var now = new Date(timestamp);
			var then = (0, exports._N)(duration, now);
			var tzOffsetSeconds = (startDate.getTimezoneOffset() - then.getTimezoneOffset()) * 60;
			return (then.getTime() - now.getTime()) / 1e3 + tzOffsetSeconds;
		};
		exports.fP = toSeconds;
		exports._N, exports.fP, exports.T1, exports.qg;
	},
	6637(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { ct: () => wlog });
		var utilities_globalBindAndTrigger_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(4271);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var ERROR = 0;
		var WARNING = 1;
		var NOTICE = 2;
		var INFO = 3;
		var DEBUG = 4;
		var LOG_LEVELS = {
			ERROR,
			WARNING,
			NOTICE,
			INFO,
			DEBUG,
			error: ERROR,
			warning: WARNING,
			notice: NOTICE,
			info: INFO,
			debug: DEBUG
		};
		var NOOP = function NOOP() {};
		var Logger = function Logger(ctx) {
			var self = this;
			if (ctx == null) ctx = {};
			var construct = function construct() {
				self.ctx = ctx;
				if (!self.ctx.initializedAt) self.reset();
			};
			self.error = function() {
				for (var _len = arguments.length, messages = new Array(_len), _key = 0; _key < _len; _key++) messages[_key] = arguments[_key];
				return self.log(ERROR, messages);
			};
			self.warn = function() {
				for (var _len2 = arguments.length, messages = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) messages[_key2] = arguments[_key2];
				return self.log(WARNING, messages);
			};
			self.notice = function() {
				for (var _len3 = arguments.length, messages = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) messages[_key3] = arguments[_key3];
				return self.log(WARNING, messages);
			};
			self.info = function() {
				for (var _len4 = arguments.length, messages = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) messages[_key4] = arguments[_key4];
				return self.log(INFO, messages);
			};
			self.debug = function() {
				for (var _len5 = arguments.length, messages = new Array(_len5), _key5 = 0; _key5 < _len5; _key5++) messages[_key5] = arguments[_key5];
				return self.log(DEBUG, messages);
			};
			construct();
			return self;
		};
		var lproto = Logger.prototype;
		lproto.reset = function() {
			this.ctx.level = ERROR;
			this.ctx.grep = null;
			this.ctx.grepv = null;
			this.ctx.first1000LogLines = [];
			this.ctx.last1000LogLines = [];
			this.ctx.initializedAt = (/* @__PURE__ */ new Date()).getTime();
		};
		lproto.setLevel = function(level) {
			var logFunc = this.logFunc(INFO);
			if (LOG_LEVELS[level] != null) {
				this.ctx.level = LOG_LEVELS[level];
				logFunc("Log level set to \"".concat(level, "\" (").concat(LOG_LEVELS[level], ")"));
			} else logFunc("Unknown log level \"".concat(level, "\""));
		};
		lproto.setGrep = function(grep) {
			this.ctx.grep = grep;
		};
		lproto.setGrepv = function(grepv) {
			this.ctx.grepv = grepv;
		};
		lproto.first1000LogLines = function() {
			return this.ctx.first1000LogLines;
		};
		lproto.last1000LogLines = function() {
			return this.ctx.last1000LogLines;
		};
		lproto.matchedGrep = function(messages) {
			var matched = false;
			if (this.ctx.grep || this.ctx.grepv) {
				var messageStrings = [];
				for (var i = 0; i < messages.length; i++) try {
					var message = messages[i];
					messageStrings.push(message.toString && message.toString());
				} catch (e) {
					messageStrings.push("");
				}
				var fullLine = messageStrings.join(" ");
				var matchesGrep = !this.ctx.grep || fullLine.match(this.ctx.grep);
				var matchesGrepv = !this.ctx.grepv || !fullLine.match(this.ctx.grepv);
				matched = matchesGrep && matchesGrepv;
			} else matched = true;
			return matched;
		};
		lproto.now = function() {
			if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now().toFixed(3);
			if (Date.now) return Date.now() - this.ctx.initializedAt;
			return (/* @__PURE__ */ new Date()).getTime() - this.ctx.initializedAt;
		};
		lproto.messagesToLogLine = function(level, time, messages) {
			var logLine = [level, time];
			logLine = logLine.concat(messages);
			var cappedLine;
			try {
				cappedLine = logLine.join(" ") || "";
				if (cappedLine.length > 200) cappedLine = cappedLine.slice(0, 200);
			} catch (e1) {
				cappedLine = "could not serialize";
			}
			return cappedLine;
		};
		lproto.persistLine = function(logLine) {
			if (this.ctx.first1000LogLines.length < 1e3) this.ctx.first1000LogLines.push(logLine);
			else {
				if (this.ctx.last1000LogLines.length >= 1e3) this.ctx.last1000LogLines.shift();
				this.ctx.last1000LogLines.push(logLine);
			}
		};
		lproto.log = function(level, messages) {
			var withinLevel = level <= this.ctx.level;
			var notDebug = level < DEBUG;
			var matched = (withinLevel || notDebug) && this.matchedGrep(messages);
			if (level === ERROR) (0, utilities_globalBindAndTrigger_js__WEBPACK_IMPORTED_MODULE_0__.mj)("problem", {
				type: "error-logged",
				data: { messages }
			});
			var now;
			if (matched && (withinLevel || notDebug)) now = this.now();
			if (notDebug && matched) {
				var logLine = this.messagesToLogLine(level, now, messages);
				this.persistLine(logLine);
			}
			if (withinLevel && matched) {
				var logFunc = this.logFunc(level);
				var e;
				if (messages.length === 1 && (e = messages[0]) instanceof Error) {
					logFunc(e.message);
					if (e.stack) logFunc(e.stack);
				} else logFunc.apply(void 0, _toConsumableArray(messages));
			}
		};
		var logError = function logError() {
			for (var _len6 = arguments.length, messages = new Array(_len6), _key6 = 0; _key6 < _len6; _key6++) messages[_key6] = arguments[_key6];
			console.error.apply(console, messages);
		};
		var logWarn = function logWarn() {
			for (var _len7 = arguments.length, messages = new Array(_len7), _key7 = 0; _key7 < _len7; _key7++) messages[_key7] = arguments[_key7];
			console.warn.apply(console, messages);
		};
		var logInfo = function logInfo() {
			for (var _len8 = arguments.length, messages = new Array(_len8), _key8 = 0; _key8 < _len8; _key8++) messages[_key8] = arguments[_key8];
			console.info.apply(console, messages);
		};
		var logDebug = function logDebug() {
			for (var _len9 = arguments.length, messages = new Array(_len9), _key9 = 0; _key9 < _len9; _key9++) messages[_key9] = arguments[_key9];
			console.debug.apply(console, messages);
		};
		var logLog = function logLog(messages) {
			console.log.apply(console, messages);
		};
		lproto.logFunc = function(level) {
			if (level == null) level = this.level;
			if (!console) return NOOP;
			var func;
			if (level === ERROR) func = logError;
			else if (level === WARNING) func = logWarn;
			else if (level === INFO) func = logInfo;
			else if (level === DEBUG) func = logDebug;
			if (!func) func = logLog;
			if (typeof func !== "function") {
				this.noConsoleLog = true;
				func = NOOP;
			}
			return func;
		};
		lproto.maybePrefix = function(prefix, messages) {
			if (prefix) {
				if (typeof prefix === "function") try {
					prefix = prefix();
				} catch (e) {
					prefix = "prefix err \"".concat(e.message, "\"");
				}
				if (prefix instanceof Array) return prefix.concat(messages);
				return [prefix].concat(messages);
			}
			return messages;
		};
		lproto.getPrefixedFunctions = function(prefix) {
			var _this = this;
			return {
				log: function log() {
					for (var _len0 = arguments.length, messages = new Array(_len0), _key0 = 0; _key0 < _len0; _key0++) messages[_key0] = arguments[_key0];
					return _this.log(ERROR, _this.maybePrefix(prefix, messages));
				},
				error: function error() {
					for (var _len1 = arguments.length, messages = new Array(_len1), _key1 = 0; _key1 < _len1; _key1++) messages[_key1] = arguments[_key1];
					return _this.log(ERROR, _this.maybePrefix(prefix, messages));
				},
				warn: function warn() {
					for (var _len10 = arguments.length, messages = new Array(_len10), _key10 = 0; _key10 < _len10; _key10++) messages[_key10] = arguments[_key10];
					return _this.log(WARNING, _this.maybePrefix(prefix, messages));
				},
				notice: function notice() {
					for (var _len11 = arguments.length, messages = new Array(_len11), _key11 = 0; _key11 < _len11; _key11++) messages[_key11] = arguments[_key11];
					return _this.log(WARNING, _this.maybePrefix(prefix, messages));
				},
				info: function info() {
					for (var _len12 = arguments.length, messages = new Array(_len12), _key12 = 0; _key12 < _len12; _key12++) messages[_key12] = arguments[_key12];
					return _this.log(INFO, _this.maybePrefix(prefix, messages));
				},
				debug: function debug() {
					for (var _len13 = arguments.length, messages = new Array(_len13), _key13 = 0; _key13 < _len13; _key13++) messages[_key13] = arguments[_key13];
					return _this.log(DEBUG, _this.maybePrefix(prefix, messages));
				}
			};
		};
		if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s && _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.wlogCtx == null) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.wlogCtx = {};
		var wlog = new Logger(_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.wlogCtx);
	},
	6906(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { Fn: () => BigPlayButton });
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var preact_hooks__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3817);
		var _svgs_BigPlayButtonSVG_tsx__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7880);
		var _shared_translations_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(4730);
		var _utilities_color_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(5417);
		var _utilities_core_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(1627);
		var _utilities_detect_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(7231);
		var _utilities_duration_ts__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(1341);
		var _utilities_interFontFamily_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(8213);
		var _utilities_color_utils_ts__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(998);
		function ownKeys(e, r) {
			var t = Object.keys(e);
			if (Object.getOwnPropertySymbols) {
				var o = Object.getOwnPropertySymbols(e);
				r && (o = o.filter(function(r) {
					return Object.getOwnPropertyDescriptor(e, r).enumerable;
				})), t.push.apply(t, o);
			}
			return t;
		}
		function _objectSpread(e) {
			for (var r = 1; r < arguments.length; r++) {
				var t = null != arguments[r] ? arguments[r] : {};
				r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
					_defineProperty(e, r, t[r]);
				}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
					Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
				});
			}
			return e;
		}
		function _defineProperty(e, r, t) {
			return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		function _toPropertyKey(t) {
			var i = _toPrimitive(t, "string");
			return "symbol" == typeof i ? i : i + "";
		}
		function _toPrimitive(t, r) {
			if ("object" != typeof t || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != typeof i) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		var detect = (0, _utilities_detect_js__WEBPACK_IMPORTED_MODULE_6__.o1)();
		var BASE_BUTTON_WIDTH = 125;
		var BASE_BUTTON_HEIGHT = 80;
		var BASE_FONT_SIZE = 18;
		var BASE_LINE_HEIGHT = 30;
		var ALPHA_MIX_BLEND_MODE = .7;
		var ALPHA_NO_MIX_BLEND_MODE = .85;
		var BigPlayButton = function BigPlayButton(_ref) {
			var backgroundGradientCss = _ref.backgroundGradientCss, _ref$baseHeight = _ref.baseHeight, baseHeight = _ref$baseHeight === void 0 ? BASE_BUTTON_HEIGHT : _ref$baseHeight, _ref$baseWidth = _ref.baseWidth, baseWidth = _ref$baseWidth === void 0 ? BASE_BUTTON_WIDTH : _ref$baseWidth, borderRadius = _ref.borderRadius, buttonTabIndex = _ref.buttonTabIndex, color = _ref.color, _ref$controlBarDistan = _ref.controlBarDistance, controlBarDistance = _ref$controlBarDistan === void 0 ? 0 : _ref$controlBarDistan, duration = _ref.duration, elemRef = _ref.elemRef, hasContrastIcons = _ref.hasContrastIcons, isLiveMedia = _ref.isLiveMedia, _ref$isLoading = _ref.isLoading, isLoading = _ref$isLoading === void 0 ? false : _ref$isLoading, _ref$isOpaque = _ref.isOpaque, isOpaque = _ref$isOpaque === void 0 ? false : _ref$isOpaque, isVisible = _ref.isVisible, _ref$leftNudgeFractio = _ref.leftNudgeFraction, leftNudgeFraction = _ref$leftNudgeFractio === void 0 ? 0 : _ref$leftNudgeFractio, _ref$noMixBlendMode = _ref.noMixBlendMode, noMixBlendMode = _ref$noMixBlendMode === void 0 ? false : _ref$noMixBlendMode, onClick = _ref.onClick, playerLanguage = _ref.playerLanguage, scale = _ref.scale, showBpbTime = _ref.showBpbTime, _ref$topNudgeFraction = _ref.topNudgeFraction, topNudgeFraction = _ref$topNudgeFraction === void 0 ? 0 : _ref$topNudgeFraction, videoName = _ref.videoName, videoWidth = _ref.videoWidth;
			var _useState2 = _slicedToArray((0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState)(false), 2), isFocused = _useState2[0], setIsFocused = _useState2[1];
			var scaledWidth = baseWidth * scale;
			var scaledHeight = baseHeight * scale;
			var translate = function translate(key) {
				return (0, _shared_translations_js__WEBPACK_IMPORTED_MODULE_3__.sC)(playerLanguage.code, "PLAY_BUTTON_".concat(key));
			};
			var unescapedVideoName = (0, _utilities_core_js__WEBPACK_IMPORTED_MODULE_5__.Uh)(videoName);
			var ariaLabel = "".concat(translate("TITLE_WHEN_NOT_PLAYING"), ": ").concat(unescapedVideoName);
			var wrapperStyle = {
				borderRadius: "".concat(borderRadius, "px"),
				display: isVisible ? "block" : "none",
				left: "calc(50% + ".concat((leftNudgeFraction || 0) * 100, "%)"),
				marginLeft: "-".concat(scaledWidth / 2, "px"),
				marginTop: "-".concat(scaledHeight / 2, "px"),
				overflow: "hidden",
				position: "absolute",
				top: "calc(50% + ".concat((topNudgeFraction || 0) * 100, "% - ").concat(controlBarDistance, "px)"),
				boxShadow: isOpaque ? "0 3px 5px rgba(0,0,0,0.3)" : void 0
			};
			var shouldMixBlendMode = !detect.edge && !noMixBlendMode;
			var blendStyle = {
				background: new _utilities_color_js__WEBPACK_IMPORTED_MODULE_4__.Q1(color !== null && color !== void 0 ? color : "#000").alpha(1).toRgba(),
				display: shouldMixBlendMode ? "block" : "none",
				left: 0,
				height: "".concat(scaledHeight, "px"),
				mixBlendMode: "darken",
				position: "absolute",
				top: 0,
				width: "".concat(scaledWidth, "px")
			};
			var shouldUseGradient = backgroundGradientCss != null;
			var playerColorObj = new _utilities_color_js__WEBPACK_IMPORTED_MODULE_4__.Q1(color !== null && color !== void 0 ? color : "#000000");
			var hoverButtonColor = (0, _utilities_color_utils_ts__WEBPACK_IMPORTED_MODULE_9__.ui)(playerColorObj, playerColorObj, "nonText");
			var overlayColor = isFocused ? hoverButtonColor : playerColorObj;
			var overlayAlphaValue = shouldMixBlendMode ? ALPHA_MIX_BLEND_MODE : ALPHA_NO_MIX_BLEND_MODE;
			var overlayColorObj = new _utilities_color_js__WEBPACK_IMPORTED_MODULE_4__.Q1(overlayColor);
			var playerIconColor = (0, _utilities_color_utils_ts__WEBPACK_IMPORTED_MODULE_9__.hu)(playerColorObj, hasContrastIcons, shouldUseGradient);
			var hoverIconColor = (0, _utilities_color_utils_ts__WEBPACK_IMPORTED_MODULE_9__.ui)(playerIconColor, hoverButtonColor, "paragraphText");
			overlayColorObj.alpha(isOpaque ? 1 : overlayAlphaValue);
			var gradientStyles = shouldUseGradient ? {
				background: backgroundGradientCss,
				backgroundSize: "".concat(videoWidth, "px 100%"),
				backgroundPositionX: "center"
			} : {};
			if (shouldUseGradient) {
				hoverIconColor = "#ffffff";
				hoverButtonColor = "rgba(0,0,0,0.4)";
			}
			var overlayStyle = _objectSpread(_objectSpread({ backgroundColor: overlayColorObj.toRgba() }, gradientStyles), {}, {
				height: "".concat(scaledHeight, "px"),
				left: 0,
				position: "absolute",
				top: 0,
				transition: "background-color 150ms",
				width: "".concat(scaledWidth, "px")
			});
			var buttonStyle = {
				backgroundColor: "transparent",
				border: 0,
				color: isFocused ? hoverIconColor : playerIconColor,
				cursor: "pointer",
				height: "".concat(scaledHeight, "px"),
				boxShadow: "none",
				width: "".concat(scaledWidth, "px")
			};
			var shouldDisplayDuration = showBpbTime && !isLiveMedia;
			var timeStyle = {
				background: "rgba(0,0,0,.4)",
				color: "#fff",
				fontFamily: _utilities_interFontFamily_js__WEBPACK_IMPORTED_MODULE_8__.w5,
				fontSize: "".concat(BASE_FONT_SIZE * scale, "px"),
				lineHeight: "".concat(BASE_LINE_HEIGHT * scale, "px"),
				pointerEvents: "none",
				textAlign: "center"
			};
			var handleIsFocused = function handleIsFocused() {
				setIsFocused(true);
			};
			var handleNotFocused = function handleNotFocused() {
				setIsFocused(false);
			};
			return (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", {
				class: "w-bpb-wrapper w-css-reset w-css-reset-tree",
				ref: elemRef,
				style: wrapperStyle
			}, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("button", {
				class: "w-big-play-button w-css-reset-button-important w-vulcan-v2-button",
				style: buttonStyle,
				onMouseEnter: handleIsFocused,
				onMouseLeave: handleNotFocused,
				onFocusIn: handleIsFocused,
				onFocusOut: handleNotFocused,
				onClick,
				"aria-label": ariaLabel,
				tabIndex: buttonTabIndex,
				type: "button"
			}, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { style: blendStyle }), (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { style: overlayStyle }), (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(_svgs_BigPlayButtonSVG_tsx__WEBPACK_IMPORTED_MODULE_2__.R, {
				width: baseWidth,
				height: baseHeight,
				scale,
				isLoading,
				overrideFillColor: isFocused ? hoverIconColor : playerIconColor
			})), shouldDisplayDuration ? (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", {
				class: "w-bpb-time",
				style: timeStyle
			}, (0, _utilities_duration_ts__WEBPACK_IMPORTED_MODULE_7__.G5)(duration)) : null);
		};
	},
	7157(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { $: () => dynamicImport });
		var _hosts_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5857);
		var _sentryUtils_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(2621);
		var _simpleMetrics_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1161);
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		function _regenerator() {
			/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag";
			function i(r, n, o, i) {
				var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype);
				return _regeneratorDefine2(u, "_invoke", function(r, n, o) {
					var i, c, u, f = 0, p = o || [], y = !1, G = {
						p: 0,
						n: 0,
						v: e,
						a: d,
						f: d.bind(e, 4),
						d: function d(t, r) {
							return i = t, c = 0, u = e, G.n = r, a;
						}
					};
					function d(r, n) {
						for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) {
							var o, i = p[t], d = G.p, l = i[2];
							r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0));
						}
						if (o || r > 1) return a;
						throw y = !0, n;
					}
					return function(o, p, l) {
						if (f > 1) throw TypeError("Generator is already running");
						for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) {
							i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u);
							try {
								if (f = 2, i) {
									if (c || (o = "next"), t = i[o]) {
										if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object");
										if (!t.done) return t;
										u = t.value, c < 2 && (c = 0);
									} else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1);
									i = e;
								} else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break;
							} catch (t) {
								i = e, c = 1, u = t;
							} finally {
								f = 1;
							}
						}
						return {
							value: t,
							done: y
						};
					};
				}(r, o, i), !0), u;
			}
			var a = {};
			function Generator() {}
			function GeneratorFunction() {}
			function GeneratorFunctionPrototype() {}
			t = Object.getPrototypeOf;
			var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function() {
				return this;
			}), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c);
			function f(e) {
				return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e;
			}
			return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function() {
				return this;
			}), _regeneratorDefine2(u, "toString", function() {
				return "[object Generator]";
			}), (_regenerator = function _regenerator() {
				return {
					w: i,
					m: f
				};
			})();
		}
		function _regeneratorDefine2(e, r, n, t) {
			var i = Object.defineProperty;
			try {
				i({}, "", {});
			} catch (e) {
				i = 0;
			}
			_regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) {
				function o(r, n) {
					_regeneratorDefine2(e, r, function(e) {
						return this._invoke(r, n, e);
					});
				}
				r ? i ? i(e, r, {
					value: n,
					enumerable: !t,
					configurable: !t,
					writable: !t
				}) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2));
			}, _regeneratorDefine2(e, r, n, t);
		}
		function asyncGeneratorStep(n, t, e, r, o, a, c) {
			try {
				var i = n[a](c), u = i.value;
			} catch (n) {
				e(n);
				return;
			}
			i.done ? t(u) : Promise.resolve(u).then(r, o);
		}
		function _asyncToGenerator(n) {
			return function() {
				var t = this, e = arguments;
				return new Promise(function(r, o) {
					var a = n.apply(t, e);
					function _next(n) {
						asyncGeneratorStep(a, r, o, _next, _throw, "next", n);
					}
					function _throw(n) {
						asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);
					}
					_next(void 0);
				});
			};
		}
		var MAX_RETRIES = 3;
		var _importWithRetry = /*#__PURE__*/ function() {
			var _ref = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee(baseUrl) {
				var retries, delay, attempt, url, result, _args = arguments, _t;
				return _regenerator().w(function(_context) {
					while (1) switch (_context.p = _context.n) {
						case 0:
							retries = _args.length > 1 && _args[1] !== void 0 ? _args[1] : MAX_RETRIES;
							delay = _args.length > 2 && _args[2] !== void 0 ? _args[2] : 200;
							attempt = _args.length > 3 && _args[3] !== void 0 ? _args[3] : 0;
							url = attempt === 0 ? baseUrl : "".concat(baseUrl).concat(baseUrl.includes("?") ? "&" : "?", "retry=").concat(attempt);
							_context.p = 1;
							_context.n = 2;
							return import(
								/* webpackIgnore: true */
								url
);
						case 2:
							result = _context.v;
							if (attempt > 0) (0, _simpleMetrics_js__WEBPACK_IMPORTED_MODULE_2__.WO)("dynamic-import/retry-success", 1, {
								attempt: String(attempt),
								url: baseUrl
							});
							return _context.a(2, result);
						case 3:
							_context.p = 3;
							_t = _context.v;
							if (!(retries <= 0)) {
								_context.n = 4;
								break;
							}
							throw _t;
						case 4:
							_context.n = 5;
							return new Promise(function(resolve) {
								setTimeout(resolve, delay);
							});
						case 5: return _context.a(2, _importWithRetry(baseUrl, retries - 1, delay, attempt + 1));
					}
				}, _callee, null, [[1, 3]]);
			}));
			return function importWithRetry(_x) {
				return _ref.apply(this, arguments);
			};
		}();
		var dynamicImport = /*#__PURE__*/ function() {
			var _ref2 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee2(filePath) {
				var options, host, taggedVersion, currentSha, getVersionSuffix, url, reportedError, _args2 = arguments, _t2;
				return _regenerator().w(function(_context2) {
					while (1) switch (_context2.p = _context2.n) {
						case 0:
							options = _args2.length > 1 && _args2[1] !== void 0 ? _args2[1] : {};
							host = _objectHasOwn(options, "host") && options.host != null ? options.host : (0, _hosts_js__WEBPACK_IMPORTED_MODULE_0__.aY)();
							taggedVersion = _hosts_js__WEBPACK_IMPORTED_MODULE_0__.U4;
							currentSha = _hosts_js__WEBPACK_IMPORTED_MODULE_0__.lR;
							getVersionSuffix = function getVersionSuffix() {
								if (taggedVersion !== "" && taggedVersion.length > 0 && options.mediaData !== true) return "@".concat(taggedVersion);
								if (currentSha !== "" && currentSha.length > 0 && options.mediaData !== true) return "@".concat(currentSha);
								return "";
							};
							url = "".concat((0, _hosts_js__WEBPACK_IMPORTED_MODULE_0__.v9)(), "//").concat(host, "/").concat(filePath).concat(getVersionSuffix());
							_context2.p = 1;
							_context2.n = 2;
							return _importWithRetry(url);
						case 2: return _context2.a(2, _context2.v);
						case 3:
							_context2.p = 3;
							_t2 = _context2.v;
							reportedError = _t2 instanceof Error ? _t2 : new Error(String(_t2));
							(0, _sentryUtils_ts__WEBPACK_IMPORTED_MODULE_1__.N7)("dynamicImport", reportedError, { importUrl: url });
							(0, _simpleMetrics_js__WEBPACK_IMPORTED_MODULE_2__.WO)("dynamic-import/failure-after-retry", 1, {
								attempt: String(MAX_RETRIES),
								url
							});
							throw _t2;
						case 4: return _context2.a(2);
					}
				}, _callee2, null, [[1, 3]]);
			}));
			return function dynamicImport(_x2) {
				return _ref2.apply(this, arguments);
			};
		}();
	},
	7209(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Fi: () => readyPublicMp4s,
			Q0: () => thumbnailAssets,
			Wz: () => stillUrl,
			aF: () => nonfailedPublicOver400,
			n9: () => readyPublicOver400,
			o2: () => readyPublicMp3s,
			pb: () => filter,
			tt: () => findClosestAssetByQuality,
			x4: () => readyPublicM3u8s,
			yE: () => READY
		});
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var utilities_url_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(2671);
		var utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7231);
		var utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5857);
		var utilities_wlog_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(6637);
		var _appHostname_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(787);
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		var aps = Array.prototype.slice;
		var FAILED = -1;
		var QUEUED = 0;
		var PROCESSING = 1;
		var READY = 2;
		var FILTER_KEYS = [
			"select",
			"sortFn",
			"sortBy",
			"unique"
		];
		var filter = function filter(assets) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			if (!assets) return [];
			if (assets.assets) assets = assets.assets;
			if (options.qualityMin != null || options.qualityMax != null) {
				assets = withinQualityRange(assets, options.qualityMin, options.qualityMax);
				options = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.iu)(options, ["qualityMin", "qualityMax"]);
			}
			var filterOptions = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.j6)(options, FILTER_KEYS);
			var selectFn = filterOptions.select || (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.iu)(options, FILTER_KEYS);
			if (selectFn) filterOptions.select = selectFn;
			var result = filterOptions.select ? (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.Lt)(assets, filterOptions.select) : (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.o8)(assets);
			if (filterOptions.sortFn || filterOptions.sortBy) result = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.di)(result, filterOptions.sortFn || filterOptions.sortBy);
			if (filterOptions.unique) {
				var uniqHash = {};
				for (var i = 0; i < result.length; i++) {
					var asset = result[i];
					var bucket = asset["".concat(filterOptions.unique)] || "__undefined__";
					if (!uniqHash[bucket]) uniqHash[bucket] = asset;
				}
				result = [];
				for (var k in uniqHash) result.push(uniqHash[k]);
			}
			return result;
		};
		var one = function one(assets, options) {
			return filter(assets, options)[0] || null;
		};
		var readyPublicMp3s = function readyPublicMp3s(assets) {
			return filter(assets, {
				ext: "mp3",
				status: READY,
				public: true
			});
		};
		var readyPublicMp4s = function readyPublicMp4s(assets) {
			return filter(assets, {
				container: "mp4",
				status: READY,
				public: true
			});
		};
		var readyPublicM3u8s = function readyPublicM3u8s(assets) {
			return filter(assets, {
				container: "m3u8",
				status: READY,
				public: true
			});
		};
		var filterOver400 = function filterOver400(assets) {
			var result = [];
			for (var i = 0; i < assets.length; i++) {
				var a = assets[i];
				var vbitrateInRange = a.opt_vbitrate != null && a.opt_vbitrate >= 500 && a.opt_vbitrate <= 1e5;
				var widthInRange = a.width != null && a.width > 400;
				if (vbitrateInRange || widthInRange) result.push(a);
			}
			return result;
		};
		var readyPublicOver400 = function readyPublicOver400(assets) {
			return filterOver400(filter(assets, {
				container: /mp4/,
				public: true,
				status: READY
			}));
		};
		var nonfailedPublicOver400 = function nonfailedPublicOver400(assets) {
			return filterOver400(filter(assets, {
				container: /mp4/,
				public: true,
				status: function status(s) {
					return s !== FAILED;
				}
			}));
		};
		var withinQualityRange = function withinQualityRange(assets) {
			var qualityMin = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 100;
			var qualityMax = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 1e4;
			return filter(assets, { select: function select(asset) {
				var quality = numericSizeSnapped(asset.width, asset.height);
				return qualityMin <= quality && quality <= qualityMax;
			} });
		};
		var numericSizeSnapped = function numericSizeSnapped(width, height) {
			if (height > width) {
				var tmpWidth = width;
				width = height;
				height = tmpWidth;
			}
			if (width / height < 1.05) width = height * (16 / 9);
			if (width >= 3740) return 2160;
			if (width >= 3100) return 1800;
			if (width >= 2460) return 1440;
			if (width >= 1820) return 1080;
			if (width >= 1180) return 720;
			if (width >= 860) return 540;
			if (width >= 540) return 360;
			return height;
		};
		var findClosestAssetByQuality = function findClosestAssetByQuality(assets, quality) {
			var height;
			if (quality === "4k") height = 2160;
			else height = parseInt(quality, 10);
			var exactMatch = withinQualityRange(assets, height, height)[0];
			if (exactMatch) return exactMatch;
			var surroundingAssets = nearestOutsideRange(assets, height, height);
			if (surroundingAssets.length === 1) return surroundingAssets[0];
			var aspect = videoAspect(assets);
			var width = Math.round(aspect * height);
			var _surroundingAssets = _slicedToArray(surroundingAssets, 2), lowerAsset = _surroundingAssets[0], upperAsset = _surroundingAssets[1];
			if (Math.abs(lowerAsset.width - width) < Math.abs(upperAsset.width - width)) return lowerAsset;
			return upperAsset;
		};
		var still = function still(assets) {
			var stillAsset = one(assets, {
				type: /^still_image$/,
				sortBy: "created_at desc"
			});
			if (!stillAsset) stillAsset = channelArtworkStill(assets);
			if (!stillAsset) stillAsset = one(assets, {
				container: /mp4/,
				sortBy: "width desc"
			});
			return stillAsset;
		};
		var channelArtworkStill = function channelArtworkStill(assets) {
			return one(assets, {
				type: /^channel_still_image$/,
				sortBy: "created_at desc"
			});
		};
		var thumbnailAssets = function thumbnailAssets(assets, options) {
			if (options.stillUrl) return [{
				height: null,
				url: options.stillUrl,
				width: null
			}];
			var stillAsset = still(assets);
			if (options.instantHlsStillAsset != null && (!stillAsset || /mp4/.test(stillAsset.container))) return [options.instantHlsStillAsset];
			if (options.originalFileStillAsset != null && (!stillAsset || /mp4/.test(stillAsset.container))) return [options.originalFileStillAsset];
			if (!stillAsset) return [];
			var stillAspect = stillAsset.width / stillAsset.height;
			return [
				320,
				640,
				960,
				1280,
				1920,
				3840
			].map(function(width) {
				var height = Math.round(width / stillAspect);
				return {
					height,
					url: stillUrl(assets, {
						videoWidth: width,
						videoHeight: height,
						playButton: false
					}),
					width
				};
			});
		};
		var FAST_HOSTNAME = (0, _appHostname_js__WEBPACK_IMPORTED_MODULE_5__.Ni)("fast");
		var stillUrl = function stillUrl(assets) {
			var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var stillAsset = still(assets);
			if (!stillAsset) return;
			if (stillAsset.status !== READY) {
				var channelArtwork = channelArtworkStill();
				if (channelArtwork && channelArtwork.status === READY) return channelArtwork.url;
				return "//".concat(FAST_HOSTNAME, "/assets/images/blank.gif");
			}
			options = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.h1)({
				aspect: stillAsset.width / stillAsset.height || 1,
				stillUrl: stillAsset.url,
				playButton: false,
				playerColor: options.playerColor || "636155",
				videoWidth: stillAsset.width || 640,
				videoHeight: stillAsset.height || 360,
				stillSnap: true
			}, options);
			var stillWidth = options.videoWidth;
			var stillHeight = options.videoHeight;
			var result = new utilities_url_js__WEBPACK_IMPORTED_MODULE_1__.s0(options.stillUrl);
			if (options.retina) {
				result.params.image_play_button_size = "2x";
				stillWidth *= 2;
				stillHeight *= 2;
			}
			if (options.stillSnap) {
				stillWidth = getStillWidth({
					videoWidth: stillWidth,
					stillAssetWidth: stillAsset.width || 640
				});
				stillHeight = Math.round(stillWidth / options.aspect);
			}
			if (!isBakeryUrl(options.stillUrl)) return options.stillUrl;
			if (options.protocol === "https:") {
				result.protocol = "https:";
				result.host = options.embedHost === utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.pb || options.embedHost === utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.bF ? utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.iD : utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.cu;
			}
			result.params.image_crop_resized = "".concat(stillWidth, "x").concat(stillHeight);
			if (options.playButton == null || options.playButton) {
				result.params.image_play_button_rounded = 1;
				result.params.image_play_button_color = "".concat("".concat(options.playerColor).replace(/^#+/, ""), "e0");
			}
			if (options.ext) result.ext(options.ext);
			if (result.ext() === "bin") result.ext("jpg");
			return result.absolute();
		};
		var getStillWidth = function getStillWidth(options) {
			var potentialStillWidths = [
				640,
				960,
				1280,
				1920,
				3840
			];
			if (options.stillAssetWidth < 3840) potentialStillWidths.push(options.stillAssetWidth);
			var availableStillWidths = [];
			for (var i = 0; i < potentialStillWidths.length; i++) {
				var width = potentialStillWidths[i];
				if (width <= options.stillAssetWidth) availableStillWidths.push(width);
			}
			availableStillWidths.sort(function(a, b) {
				return a - b;
			});
			for (var _i = 0; _i < availableStillWidths.length; _i++) {
				var _width = availableStillWidths[_i];
				if (options.videoWidth <= _width) return _width;
			}
			return Math.max.apply(Math, availableStillWidths);
		};
		var BAKERY_HOSTS = [
			utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.pK,
			utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.cu,
			(0, _appHostname_js__WEBPACK_IMPORTED_MODULE_5__.Ni)("embed"),
			(0, _appHostname_js__WEBPACK_IMPORTED_MODULE_5__.Ni)("prime"),
			(0, _appHostname_js__WEBPACK_IMPORTED_MODULE_5__.Ni)("mixergy-cdn"),
			(0, _appHostname_js__WEBPACK_IMPORTED_MODULE_5__.Ni)("embed-fastly"),
			utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.hk,
			utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.iD,
			utilities_hosts_js__WEBPACK_IMPORTED_MODULE_3__.KG
		];
		var isBakeryUrl = function isBakeryUrl(rawUrl) {
			if (rawUrl == null) return false;
			var url = new utilities_url_js__WEBPACK_IMPORTED_MODULE_1__.s0(rawUrl);
			if (!url.host) return false;
			return BAKERY_HOSTS.join(",").indexOf(url.host) >= 0;
		};
		var onePublicReadyWithContainer = function onePublicReadyWithContainer(assets, type, options) {
			options = (0, utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__.h1)({
				container: type,
				public: true,
				status: READY
			}, options);
			return one(assets, options);
		};
		var hasAnyReadyHdrAssets = function hasAnyReadyHdrAssets(assets) {
			return assets.some(function(asset) {
				return asset.type === "hdr_video" && asset.status === READY && asset.public && asset.container === "mp4";
			});
		};
		var mp4 = function mp4(assets, options) {
			return onePublicReadyWithContainer(assets, "mp4", options);
		};
		var webm = function webm(assets, options) {
			return onePublicReadyWithContainer(assets, "webm", options);
		};
		var m3u8 = function m3u8(assets, options) {
			return onePublicReadyWithContainer(assets, "m3u8", options);
		};
		var original = function original(assets) {
			return one(assets, { type: "original" });
		};
		var playable = function playable(assets, options) {
			if ((arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : cachedDetect()).video.webm) return webm(assets, options) || mp4(assets, options);
			return mp4(assets, options);
		};
		var videoAspect = function videoAspect(assets) {
			var asset = mp4(assets) || m3u8(assets) || webm(assets) || original(assets);
			if (asset && asset.height) return asset.width / asset.height;
			return 640 / 360;
		};
		var originalAspect = function originalAspect(assets) {
			var derivativeAspect = videoAspect(assets);
			var asset = original(assets);
			if (asset && asset.width && asset.height) {
				var candidateAspect = asset.width / asset.height;
				if (candidateAspect > 1 && derivativeAspect < 1 || candidateAspect < 1 && derivativeAspect > 1) return 1 / candidateAspect;
				return candidateAspect;
			}
			return derivativeAspect;
		};
		var iphone = function iphone(assets, options) {
			if (videoAspect(assets) > 1) {
				options = merge({ width: 640 }, options);
				return mp4(assets, options) || smallestNormalMp4(assets, options);
			}
			var opt1 = merge({ width: 320 }, options);
			var opt2 = merge({ width: 640 }, options);
			return mp4(assets, opt1) || mp4(assets, opt2) || smallestNormalMp4(assets, options);
		};
		var smallestNormalMp4 = function smallestNormalMp4(assets, options) {
			options = merge({
				sortBy: "width asc",
				width: [640, 1920]
			}, options);
			return mp4(assets, options);
		};
		var urlWithCorrectHost = function urlWithCorrectHost(assetUrl) {
			var proto = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Hosts.eV1Protocol();
			var parsedUrl = new Url(assetUrl);
			if (isBakeryUrl(assetUrl)) {
				if (proto === "https:") {
					parsedUrl.host = Hosts.deliveryHost(location.protocol);
					parsedUrl.protocol = "https:";
				} else {
					parsedUrl.host = Hosts.deliveryHost(location.protocol);
					parsedUrl.protocol = "http:";
				}
			}
			return parsedUrl.absolute();
		};
		var nearestOutsideRange = function nearestOutsideRange(assets, lower, upper) {
			if (assets.length === 0) return [];
			var sortedAssets = aps.call(assets).sort(function(a, b) {
				return numericSizeSnapped(a.width, a.height) - numericSizeSnapped(b.width, b.height);
			});
			var lowerAsset;
			var upperAsset;
			for (var i = 0; i < sortedAssets.length; i++) {
				var asset = sortedAssets[i];
				var assetSize = numericSizeSnapped(asset.width, asset.height);
				if (assetSize < lower) lowerAsset = asset;
				if (assetSize >= upper) {
					upperAsset = asset;
					break;
				}
			}
			var result = [];
			if (lowerAsset) result.push(lowerAsset);
			if (upperAsset) result.push(upperAsset);
			if (result.length === 0) {
				utilities_wlog_js__WEBPACK_IMPORTED_MODULE_4__.ct.error("nearestOutsideRange: no nearby assets found, using first in list", sortedAssets[0]);
				result.push(sortedAssets[0]);
			}
			return result;
		};
		var moveToFront = function moveToFront(assets, toFront) {
			if (!toFront) return assets;
			var index = -1;
			for (var i = 0; i < assets.length; i++) if (assets[i].url === toFront.url) {
				index = i;
				break;
			}
			if (index > 0) {
				assets.splice(index, 1);
				assets.unshift(toFront);
			}
			return assets;
		};
	},
	7211(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			J: () => shouldEnableMux,
			_: () => MUX_PERCENTAGE_TO_ENABLE
		});
		var MUX_PERCENTAGE_TO_ENABLE = .1;
		/**
		* Whether the current environment provides the `console` methods that mux-embed
		* relies on at module-evaluation time.
		*
		* mux-embed sets up its logger via `console.trace`/`console.info`/`console.debug`
		* as soon as the module is imported (`var q = kt("[mux]")`). In restricted
		* WebKit environments such as Apple Mail's email preview, those methods are
		* undefined, so simply importing wistia-mux.js throws an error
		* @returns {boolean} True if the console methods mux-embed needs are available.
		*/
		var isMuxEnvironmentSupported = function isMuxEnvironmentSupported() {
			return typeof console !== "undefined" && typeof console.trace === "function" && typeof console.info === "function" && typeof console.debug === "function";
		};
		/**
		* Determines if Mux should be enabled for an embed based on various conditions.
		* @param {PublicApi} video The embed mux should be enabled for.
		* @param {boolean} didWinCoinFlip Whether or not the embed won the coin flip which determines if Mux should be enabled.
		* @returns {boolean} True if Mux should be enabled, false otherwise.
		*/
		var shouldEnableMux = function shouldEnableMux(video, didWinCoinFlip) {
			var _video$_opts, _video$_mediaData;
			var isMuxEnabledInEnvironment = isMuxEnvironmentSupported();
			var isMuxEnabledOnWindow = window.wistiaDisableMux !== true;
			var isMuxEnabledFromOpts = ((_video$_opts = video._opts) === null || _video$_opts === void 0 ? void 0 : _video$_opts.mux) !== false;
			var isMuxEnabledFromStandardEmbed = video.iframe == null;
			var isMuxEnabledFromCoinFlip = didWinCoinFlip;
			var isMuxEnabledFromLiveStream = ((_video$_mediaData = video._mediaData) === null || _video$_mediaData === void 0 ? void 0 : _video$_mediaData.type) === "LiveStream";
			return isMuxEnabledInEnvironment && isMuxEnabledOnWindow && isMuxEnabledFromOpts && isMuxEnabledFromStandardEmbed && (isMuxEnabledFromCoinFlip || isMuxEnabledFromLiveStream);
		};
	},
	7229(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { J: () => secondsToIso8601Duration });
		var _duration_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1341);
		var SECONDS_IN_MINUTE = 60;
		var secondsToIso8601Duration = function secondsToIso8601Duration(totalSeconds) {
			var _secondsConverter = (0, _duration_ts__WEBPACK_IMPORTED_MODULE_0__.ab)(totalSeconds, "hms"), hours = _secondsConverter.hours, minutes = _secondsConverter.minutes, seconds = _secondsConverter.seconds;
			var result = "";
			if (hours) result += "".concat(hours, "H");
			if (minutes || totalSeconds > SECONDS_IN_MINUTE && seconds !== 0) result += "".concat(minutes, "M");
			if (seconds || totalSeconds === 0) result += "".concat(seconds, "S");
			return result;
		};
	},
	7231(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			GS: () => detectIsMobile,
			o1: () => cachedDetect
		});
		var utilities_root_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(8176);
		var _performance_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(267);
		var na = navigator.userAgent;
		var _playerDetectCache = null;
		var rwebkit = /(webkit)[ /]([^\s]+)/i;
		var ropera = /OPR\/([^\s]+)/i;
		var redge = /(edge)\/(\d+(?:\.\d+)?)/i;
		var rmozilla = /(mozilla)(?:.*? rv:([^\s)]+))?/i;
		var randroid = /(android) ([^;]+)/i;
		var riphone = /(iphone)/i;
		var rwinphone = /(Windows Phone OS (\d+(?:\.\d+)?))/;
		var rios = /OS (\d+)_(\d+)/i;
		var rfirefox = /(firefox)/i;
		var rgearvr = /Mobile VR/i;
		var riosVersion = /Version\/([^\s]+)/i;
		var browser = function browser() {
			return (browserMatch()[1] || "webkit").toLowerCase();
		};
		var browserVersion = function browserVersion() {
			return browserMatch()[2];
		};
		var browserMatch = function browserMatch() {
			var match = na.match(redge);
			if (match) return match;
			match = na.match(rwebkit);
			if (match) return match;
			match = na.match(ropera);
			if (match) return match;
			if (match) {
				if (document.documentMode != null) match[2] = document.documentMode;
				return match;
			}
			match = na.match(rmozilla);
			if (match) return match;
			return [];
		};
		var android = function android() {
			var matches = na.match(randroid);
			if (matches == null) return false;
			return { version: matches[2] };
		};
		var oldandroid = function oldandroid() {
			return android() && parseFloat(android().version) < 4.1;
		};
		var iphone = function iphone() {
			return riphone.test(na);
		};
		var touchScreen = function touchScreen() {
			return iosVersion() > 0 || android() || ipad();
		};
		var HDRCodecSupport = function HDRCodecSupport() {
			var _window$MediaSource$i, _window$MediaSource, _window$MediaSource$i2, _window$MediaSource$i3, _window$MediaSource2, _window$MediaSource2$, _window$MediaSource$i4, _window$MediaSource3, _window$MediaSource3$;
			return {
				hevc: (_window$MediaSource$i = (_window$MediaSource = window.MediaSource) === null || _window$MediaSource === void 0 ? void 0 : (_window$MediaSource$i2 = _window$MediaSource.isTypeSupported) === null || _window$MediaSource$i2 === void 0 ? void 0 : _window$MediaSource$i2.call(_window$MediaSource, "video/mp4; codecs=\"hvc1.2.4.L153.B0\"")) !== null && _window$MediaSource$i !== void 0 ? _window$MediaSource$i : false,
				av1: (_window$MediaSource$i3 = (_window$MediaSource2 = window.MediaSource) === null || _window$MediaSource2 === void 0 ? void 0 : (_window$MediaSource2$ = _window$MediaSource2.isTypeSupported) === null || _window$MediaSource2$ === void 0 ? void 0 : _window$MediaSource2$.call(_window$MediaSource2, "video/mp4; codecs=\"av01.0.08M.10.0.110.09.16.09\"")) !== null && _window$MediaSource$i3 !== void 0 ? _window$MediaSource$i3 : false,
				vp92: (_window$MediaSource$i4 = (_window$MediaSource3 = window.MediaSource) === null || _window$MediaSource3 === void 0 ? void 0 : (_window$MediaSource3$ = _window$MediaSource3.isTypeSupported) === null || _window$MediaSource3$ === void 0 ? void 0 : _window$MediaSource3$.call(_window$MediaSource3, "video/mp4; codecs=\"vp09.02.10.10.01.09.16.09\"")) !== null && _window$MediaSource$i4 !== void 0 ? _window$MediaSource$i4 : false
			};
		};
		var HDRSupported = function HDRSupported() {
			var _window$matchMedia, _window;
			if ((_window$matchMedia = (_window = window).matchMedia) !== null && _window$matchMedia !== void 0 && _window$matchMedia.call(_window, "(dynamic-range: high)").matches) return true;
			if (screen.colorDepth && screen.colorDepth >= 30) return true;
			return false;
		};
		var hoverIsNatural = function hoverIsNatural() {
			try {
				var mediaQueryList = matchMedia("(hover:hover)");
				if (mediaQueryList.media !== "not all") return mediaQueryList.matches;
			} catch (err) {}
			return !touchScreen();
		};
		var retina = function retina() {
			return utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.devicePixelRatio != null && utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.devicePixelRatio > 1;
		};
		var ipad = function ipad() {
			return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
		};
		var safari = function safari() {
			return rwebkit.test(na) && !/chrome/i.test(na) && !ipad() && !iphone();
		};
		var chrome = function chrome() {
			if (/Chrome/.test(na) && /Google Inc/.test(navigator.vendor)) return { version: chromeVersion() };
			return false;
		};
		var silkVersion = function silkVersion() {
			var match = na.match(/\bSilk\/([^\s]+)/);
			return match && match[1];
		};
		var chromeVersion = function chromeVersion() {
			var match = na.match(/\bChrome\/([^\s]+)/);
			return match && match[1];
		};
		var opera = function opera() {
			return ropera.test(na);
		};
		var iosVersion = function iosVersion() {
			var iosMatch = na.match(rios);
			var versionMatch = na.match(riosVersion);
			if (iosMatch != null) return parseFloat("".concat(iosMatch[1], ".").concat(iosMatch[2]));
			if (versionMatch != null && versionMatch[1] && ipad()) return parseFloat(versionMatch[1]);
			return 0;
		};
		var windowsPhone = function windowsPhone() {
			return rwinphone.test(na);
		};
		var edge = function edge() {
			return redge.test(na);
		};
		var firefox = function firefox() {
			return rfirefox.test(na);
		};
		var gearvr = function gearvr() {
			return rgearvr.test(na);
		};
		var windows = function windows() {
			return /win/i.test(navigator.platform);
		};
		var mac = function mac() {
			return /mac/i.test(navigator.platform);
		};
		var html5Video = function html5Video() {
			var elem = document.createElement("video");
			var result = false;
			try {
				if (elem.canPlayType) {
					result = {};
					var h264 = "video/mp4; codecs=\"avc1.42E01E";
					result.h264 = !!elem.canPlayType("".concat(h264, "\"")) || !!elem.canPlayType("".concat(h264, ", mp4a.40.2\""));
					result.webm = !!elem.canPlayType("video/webm; codecs=\"vp9, vorbis\"");
					result.nativeHls = !!elem.canPlayType("application/vnd.apple.mpegURL");
				}
			} catch (e) {
				result = {
					ogg: false,
					h264: false,
					webm: false,
					nativeHls: false
				};
			}
			return result;
		};
		var mediaSource = function mediaSource() {
			return utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.MediaSource && utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.MediaSource.isTypeSupported("".concat("video/mp4; codecs=\"avc1.42E01E", ", mp4a.40.2\""));
		};
		var nativeHls = function nativeHls() {
			return (iphone() || ipad() || safari()) && html5Video().nativeHls;
		};
		var localStorage = function localStorage() {
			try {
				return "localStorage" in utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z && utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z.localStorage != null;
			} catch (e) {
				return false;
			}
		};
		var fullscreenEnabled = function fullscreenEnabled() {
			return document.fullscreenEnabled || document.mozFullScreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;
		};
		var managedMediaSource = function managedMediaSource() {
			var _window$ManagedMediaS;
			return "ManagedMediaSource" in window && typeof ((_window$ManagedMediaS = window.ManagedMediaSource) === null || _window$ManagedMediaS === void 0 ? void 0 : _window$ManagedMediaS.isTypeSupported) === "function";
		};
		var browserPrefixes = [
			"WebKit",
			"Moz",
			"O",
			"Ms",
			""
		];
		var mutationObserver = function mutationObserver() {
			for (var i = 0; i < browserPrefixes.length; i++) {
				var prefix = browserPrefixes[i];
				var prop = "".concat(prefix, "MutationObserver");
				if (utilities_root_js__WEBPACK_IMPORTED_MODULE_0__.z[prop]) return prop;
			}
			return null;
		};
		var vulcanV2Support = function vulcanV2Support() {
			var modernBrowser = /webkit|mozilla|edge/.test(browser());
			if (iphone() || ipad() || android()) return true;
			return Boolean(modernBrowser && html5Video().h264 && Object.defineProperties);
		};
		var isPassiveSupported;
		var passiveSupported = function passiveSupported() {
			if (isPassiveSupported != null) return isPassiveSupported;
			try {
				var options = Object.defineProperty({}, "passive", { get: function get() {
					isPassiveSupported = true;
				} });
				window.addEventListener("test", null, options);
			} catch (err) {
				isPassiveSupported = false;
			}
			return isPassiveSupported;
		};
		var callingPlayRequiresEventContext = function callingPlayRequiresEventContext() {
			return iosVersion() > 0 || android() || safari();
		};
		var webp = function webp() {
			var chromeBrowser = chrome();
			var firefoxBrowser = firefox();
			var edgeBrowser = edge();
			var operaBrowser = opera();
			var isChromeDesktopSupported = chromeBrowser && browserVersion() >= 32;
			var isChromeAndroidSupported = chromeBrowser && browserVersion() >= 75 && android();
			var isFirefoxDesktopSupported = firefoxBrowser && browserVersion() >= 65;
			var isFirefoxAndroidSupported = firefoxBrowser && browserVersion() >= 67 && android();
			var isEdgeSupported = edgeBrowser && browserVersion() >= 18;
			var isOperaSupported = operaBrowser && browserVersion() >= 19;
			return isChromeDesktopSupported || isChromeAndroidSupported || isFirefoxDesktopSupported || isFirefoxAndroidSupported || isEdgeSupported || isOperaSupported;
		};
		var cachedDetect = function cachedDetect() {
			if (_playerDetectCache) return _playerDetectCache;
			_playerDetectCache = uncachedDetect();
			return _playerDetectCache;
		};
		var uncachedDetect = function uncachedDetect() {
			var result = {
				browser: { version: browserVersion() },
				edge: edge(),
				firefox: firefox(),
				gearvr: gearvr(),
				hdr: HDRSupported(),
				hdrCodecs: HDRCodecSupport(),
				android: android(),
				oldandroid: oldandroid(),
				iphone: iphone(),
				ipad: ipad(),
				safari: safari(),
				chrome: chrome(),
				winphone: { version: windowsPhone()[2] },
				ios: { version: iosVersion() },
				windows: windows(),
				mac: mac(),
				retina: retina(),
				hoverIsNatural: hoverIsNatural(),
				touchScreen: touchScreen(),
				video: html5Video(),
				managedMediaSource: managedMediaSource(),
				mediaSource: mediaSource(),
				nativeHls: nativeHls(),
				localstorage: localStorage(),
				fullscreenEnabled: fullscreenEnabled(),
				vulcanV2Support: vulcanV2Support(),
				mutationObserver: mutationObserver(),
				callingPlayRequiresEventContext: callingPlayRequiresEventContext(),
				passiveSupported: passiveSupported(),
				webp: webp(),
				performanceMeasure: (0, _performance_ts__WEBPACK_IMPORTED_MODULE_1__.O)()
			};
			result.browser[browser()] = true;
			return result;
		};
		var clearDetectCache = function clearDetectCache() {
			_playerDetectCache = null;
		};
		var detectIsMobile = function detectIsMobile() {
			var isAndroid = android();
			var isIPad = ipad();
			var isIPhone = iphone();
			return isAndroid || isIPad || isIPhone;
		};
	},
	7323(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { k: () => didWinCoinFlip });
		var MAX_RANDOM_VALUE = 4294967295;
		/**
		* Simulates a coin flip with a given percentage to win
		* @param percentToWinCoinFlip - Number between 0 and 1 representing the percentage to win the coin flip
		* @returns boolean - True if the coin flip was won, false otherwise
		*/
		var didWinCoinFlip = function didWinCoinFlip(percentToWinCoinFlip) {
			var cryptoObj = window.crypto;
			if (typeof cryptoObj !== "undefined") return cryptoObj.getRandomValues(/* @__PURE__ */ new Uint32Array(1))[0] / (MAX_RANDOM_VALUE + 1) < percentToWinCoinFlip;
			return Math.random() >= percentToWinCoinFlip;
		};
	},
	7350(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { b: () => isGradient });
		var isGradient = function isGradient(value) {
			if (typeof value !== "object" || value === null) return false;
			var _ref = value, colors = _ref.colors, on = _ref.on;
			if (!on) return true;
			if (!Array.isArray(colors) || typeof on !== "boolean") return false;
			if (colors.length === 0) return false;
			return colors.every(function(color) {
				return typeof color[0] === "string" && typeof color[1] === "number";
			});
		};
	},
	7438(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { hy: () => getViewerPreferences });
		var utilities_namespacedLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(2917);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var deleteViewerPreferences = function deleteViewerPreferences() {
			removeLocalStorage(getLocalStorageKey());
		};
		var getLocalStorageKey = function getLocalStorageKey() {
			return "wistia-viewer-preferences";
		};
		var getViewerPreferences = function getViewerPreferences() {
			if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s._viewerPreferencesEnabled === false) return {};
			return (0, utilities_namespacedLocalStorage_js__WEBPACK_IMPORTED_MODULE_0__.Lg)(getLocalStorageKey());
		};
		var getViewerPreference = function getViewerPreference(preference) {
			var preferences = getViewerPreferences();
			if (!preferences) return null;
			return preferences[preference];
		};
		var setViewerPreference = function setViewerPreference(preference, value) {
			updateLocalStorage(getLocalStorageKey(), function(obj) {
				if (obj.plugin) delete obj.plugin;
				obj[preference] = value;
			});
		};
	},
	7715(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			Ev: () => addInlineCss,
			Rx: () => utilities_pageLoaded_js__WEBPACK_IMPORTED_MODULE_1__.R,
			cG: () => elemWidth,
			lj: () => elemInDom
		});
		var utilities_obj_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(731);
		var utilities_pageLoaded_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(9562);
		var utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7231);
		var utilities_wlog_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(6637);
		var utilities_script_tags_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(6461);
		var utilities_seqid_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(1224);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(5509);
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		var W = null;
		var detect = (0, utilities_detect_js__WEBPACK_IMPORTED_MODULE_2__.o1)();
		var elemHtml = function elemHtml(elem, content) {
			var cssTags = getCssTags(content);
			var scriptTags = getScriptTags(content);
			content = removeCssTags(content);
			content = removeScriptTags(content);
			elem.innerHTML = content;
			execCssTags(cssTags, elem);
			return execScriptTags(scriptTags);
		};
		var getCssTags = function getCssTags(htmlStr) {
			return htmlStr.match(/<link.*?rel=['"]stylesheet['"][^>]*>|<style>[\s\S]+?<\/style>/gi) || [];
		};
		var execCssTags = function execCssTags(cssTags, parentElem) {
			if (!cssTags) return null;
			if (!isArray(cssTags)) cssTags = getCssTags(cssTags);
			var inserted = [];
			for (var i = 0; i < cssTags.length; i++) {
				var cssTag = cssTags[i];
				if (/<link.*?rel=['"]stylesheet['"][^>]*>/.test(cssTag)) {
					var matches = cssTag.match(/href=['"](.*?)['"]/i);
					if (matches) {
						var link = document.createElement("link");
						link.setAttribute("rel", "stylesheet");
						link.setAttribute("href", matches[1]);
						link.className = "wistia_injected_style";
						(parentElem || document.body || document.head).appendChild(link);
						inserted.push(link);
					}
				} else if (/<style>[\s\S]+?<\/style>/gi.test(cssTag)) {
					var _matches = cssTag.match(/<style>([\s\S]+?)<\/style>/i);
					if (_matches) {
						var style = addInlineCss(parentElem || document.body || document.head, _matches[1]);
						inserted.push(style);
					}
				}
			}
			return inserted;
		};
		var removeCssTags = function removeCssTags(htmlStr) {
			return htmlStr.replace(/<link.*?rel=['"]stylesheet['"][^>]*>|<style>[\s\S]+?<\/style>/gi, "");
		};
		var addInlineCss = function addInlineCss(domTarget, css) {
			var target = domTarget || document.body || document.head;
			var styleElem = document.createElement("style");
			styleElem.id = (0, utilities_seqid_js__WEBPACK_IMPORTED_MODULE_5__.h)("wistia_", "_style");
			styleElem.setAttribute("type", "text/css");
			styleElem.className = "wistia_injected_style";
			target.appendChild(styleElem, target.nextSibling);
			if (styleElem.styleSheet) styleElem.styleSheet.cssText = css;
			else styleElem.appendChild(document.createTextNode(css));
			return styleElem;
		};
		var _elemFromObject = function elemFromObject(obj) {
			if (isArray(obj)) {
				var result = [];
				for (var i = 0; i < obj.length; i++) result.push(_elemFromObject(obj[i]));
				return result;
			}
			var tagName = obj.tagName || "div";
			var childNodes = obj.childNodes || [];
			if (!isArray(childNodes)) childNodes = [childNodes];
			var elem = document.createElement(tagName);
			for (var key in obj) if (_objectHasOwn(obj, key)) {
				var val = obj[key];
				if (key !== "childNodes" && key !== "tagName" && key !== "ref") {
					var dashedKey = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
					if (key === "style") {
						if (isObject(val)) for (var p in val) elem.style[p] = val[p];
						else {
							var styles = val.split(";");
							for (var _i = 0; _i < styles.length; _i++) {
								var pair = styles[_i].split(/\s*:\s*/);
								var _p = pair[0];
								var v = pair[1];
								if (_p && v) elem.style[_p] = v;
							}
						}
					} else if (key === "events") for (var evt in val) {
						var callback = val[evt];
						elemBind(elem, evt, callback);
					}
					else if (key === "className" || key === "class") elem.className = val;
					else if (key === "innerHTML") elem.innerHTML = val;
					else if (key === "innerText") elem.innerText = val;
					else if (val != null && typeof val.toString === "function") elem.setAttribute(dashedKey, val.toString());
				}
			}
			for (var _i2 = 0; _i2 < childNodes.length; _i2++) {
				var childObj = childNodes[_i2];
				if (isObject(childObj)) _elemAppend(elem, _elemFromObject(childObj));
				else _elemAppend(elem, document.createTextNode(childObj.toString()));
			}
			if (typeof obj.ref === "function") obj.ref(elem);
			return elem;
		};
		var _elemToObject = function elemToObject(elem) {
			if (isArray(elem)) {
				var _result = [];
				for (var i = 0; i < elem.length; i++) _result.push(_elemToObject(elem[i]));
			}
			var result = {};
			result.tagName = elem.tagName.toLowerCase();
			var elemKeys = Object.keys(elem);
			for (var _i3 = 0; _i3 < elemKeys.length; _i3++) {
				var attr = elemKeys[_i3];
				if (attr !== "tagName" && attr !== "childNodes" && attr !== "nodeType" && attr !== "nodeValue") {
					if (attr === "style") {
						result.style = {};
						var styleKeys = Object.keys(elem.style);
						for (var j = 0; j < styleKeys.length; j++) {
							var prop = styleKeys[j];
							var val = elem.style[prop];
							if (val && !/^\d/.test(prop) && prop !== "length") result.style[prop] = val;
						}
					} else {
						var value = elem.getAttribute(attr);
						if (value != null) result[attr] = value;
					}
				}
			}
			var children = [];
			for (var _i4 = 0; _i4 < elem.childNodes.length; _i4++) {
				var child = elem.childNodes[_i4];
				if (child.nodeType === 1) children.push(_elemToObject(child));
				else if (child.nodeType === 3) children.push(child.nodeValue);
			}
			if (children.length > 0) result.childNodes = children;
			return result;
		};
		var elemClone = function elemClone(elem) {
			return _elemFromObject(_elemToObject(elem));
		};
		var _elemAppend = function elemAppend(par, elem) {
			if (isArray(elem)) {
				for (var i = 0; i < elem.length; i++) _elemAppend(par, elem[i]);
				return;
			}
			if (par.tagName.includes("-")) par.shadowRoot.appendChild(elem, { wistiaGridCaller: true });
			else par.appendChild(elem, { wistiaGridCaller: true });
		};
		var _elemPrepend = function elemPrepend(par, elem) {
			if (isArray(elem)) {
				for (var i = 0; i < elem.length; i++) _elemPrepend(par, elem[i]);
				return;
			}
			if (par.childNodes.length === 0) return _elemAppend(par, elem);
			return par.insertBefore(elem, par.childNodes[0]);
		};
		var _elemBefore = function elemBefore(sibling, elem) {
			if (isArray(elem)) {
				elem = elem.reverse();
				for (var i = 0; i < elem.length; i++) _elemBefore(sibling, elem[i]);
				return;
			}
			return sibling.parentNode.insertBefore(elem, sibling);
		};
		var _elemAfter = function elemAfter(sibling, elem) {
			if (isArray(elem)) {
				elem = elem.reverse();
				for (var i = 0; i < elem.length; i++) _elemAfter(sibling, elem[i]);
				return;
			}
			return sibling.parentNode.insertBefore(elem, sibling.nextSibling);
		};
		var _elemRemove = function elemRemove(elem) {
			if (isArray(elem) || window.NodeList && elem instanceof NodeList) {
				for (var i = 0; i < elem.length; i++) _elemRemove(elem[i]);
				return;
			}
			var par;
			if (elem != null && (elem.nodeType === 1 || elem.nodeType === 3) && (par = elem.parentNode)) {
				par.removeChild(elem);
				elem = null;
			}
		};
		var _elemRemoveClass = function elemRemoveClass(elem, klass) {
			if (isArray(elem) || window.NodeList && elem instanceof NodeList) {
				for (var i = 0; i < elem.length; i++) _elemRemoveClass(elem[i], klass);
				return;
			}
			if (!elemHasClass(elem, klass)) return;
			var className = elem.getAttribute("class");
			if (className) {
				var regexp = new RegExp("\\b".concat(klass, "\\b"), "g");
				var newClassString = normalizeClassName(className.replace(regexp, ""));
				elem.setAttribute("class", newClassString);
			}
		};
		var _elemAddClass = function elemAddClass(elem, klass) {
			if (isArray(elem) || window.NodeList && elem instanceof NodeList) {
				for (var i = 0; i < elem.length; i++) _elemAddClass(elem[i], klass);
				return;
			}
			if (elemHasClass(elem, klass)) return;
			var className = elem.getAttribute("class");
			var newClassString;
			if (className) {
				_elemRemoveClass(elem, klass);
				newClassString = normalizeClassName("".concat(className, " ").concat(klass));
			} else newClassString = klass;
			elem.setAttribute("class", newClassString);
		};
		var elemHasClass = function elemHasClass(elem, klass) {
			var className = elem != null && typeof elem.getAttribute === "function" && elem.getAttribute("class");
			if (!className && elem && typeof elem.className === "string") className = elem.className;
			if (!className) return false;
			var returnValue = false;
			eachIndexOf(className, klass, function(index) {
				var classBeginningFound = index === 0 || className.charAt(index - 1) === " ";
				var endsWidthClass = index + klass.length === className.length;
				var classInMiddle = className.charAt(index + klass.length) === " ";
				if (classBeginningFound && (endsWidthClass || classInMiddle)) {
					returnValue = true;
					return BREAK_IDENTIFIER;
				}
			});
			return returnValue;
		};
		var BREAK_IDENTIFIER = {};
		var eachIndexOf = function eachIndexOf(str, needle, fn) {
			var i = -1;
			while ((i = str.indexOf(needle, i + 1)) != -1) if (fn(i) === BREAK_IDENTIFIER) break;
		};
		var elemClasses = function elemClasses(elem) {
			if (elem && typeof elem.className !== "string") return [""];
			return (elem && elem.className || "").split(/\s+/);
		};
		var normalizeClassName = function normalizeClassName(className) {
			return className.replace(/^\s+/g, "").replace(/\s+$/g, "").replace(/\s+/g, " ");
		};
		var _elemStyle = function elemStyle(elem) {
			for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) args[_key - 1] = arguments[_key];
			if (isArray(elem) || window.NodeList && elem instanceof NodeList) {
				var result = [];
				for (var i = 0; i < elem.length; i++) {
					var node = elem[i];
					if (node.nodeType === 1) result.push(_elemStyle.apply(void 0, [node].concat(args)));
				}
				return result;
			}
			if (args.length === 2) {
				var prop = args[0];
				var val = args[1];
				elem.style[prop] = val;
			} else if (args.length === 1) {
				if (typeof args[0] === "string") {
					var _prop = args[0];
					try {
						if (elem.currentStyle) return elem.currentStyle[_prop];
						if (window.getComputedStyle) return window.getComputedStyle(elem, null).getPropertyValue(_prop);
						return null;
					} catch (e) {
						wlog.notice(e);
					}
				} else {
					var props = propsWithVendorPrefixes(args[0]);
					for (var _prop2 in props) {
						var _val = props[_prop2];
						elem.style[_prop2] = _val;
					}
				}
			} else wlog.apply(void 0, ["Unexpected args", elem].concat(args));
		};
		var VENDORED_PROPERTIES = {
			borderImage: true,
			mixBlendMode: true,
			transform: true,
			transition: true,
			transitionDuration: true
		};
		var VENDOR_PREFIXES = null;
		var propsWithVendorPrefixes = function propsWithVendorPrefixes(props) {
			if (detect.chrome) return props;
			var result = {};
			for (var prop in props) {
				var val = props[prop];
				result[prop] = val;
				if (VENDORED_PROPERTIES[prop]) {
					var prefixes = VENDOR_PREFIXES;
					for (var i = 0; i < prefixes.length; i++) {
						var prefixedProp = prefixes[i] + prop.charAt(0).toUpperCase() + prop.slice(1);
						if (!prop[prefixedProp]) result[prefixedProp] = val;
					}
				}
			}
			return result;
		};
		var getComputedStyle = function getComputedStyle(elem, prop) {
			if (!window.getComputedStyle) return null;
			var computed = window.getComputedStyle(elem, null);
			if (computed == null) return null;
			if (prop != null) return computed[prop];
			return computed;
		};
		var elemWidth = function elemWidth(elem) {
			if (elem === window) {
				if (window.innerWidth) return window.innerWidth;
				if (document.documentElement) return document.documentElement.offsetWidth;
				return document.body.offsetWidth;
			}
			if (elem === document) {
				var body = document.body;
				var html = document.documentElement;
				return Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
			}
			var val;
			if ((val = getComputedStyle(elem, "width")) && val != null) return parseFloat(val);
			if (elem.currentStyle) return elem.offsetWidth;
			return -1;
		};
		var elemHeight = function elemHeight(elem) {
			if (elem === window) {
				if (window.innerHeight) return window.innerHeight;
				if (document.documentElement) return document.documentElement.offsetHeight;
				return document.body.offsetHeight;
			}
			if (elem === document) {
				var body = document.body;
				var html = document.documentElement;
				return Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
			}
			var val;
			if ((val = getComputedStyle(elem, "height")) && val != null) return parseFloat(val);
			if (elem.currentStyle) return elem.offsetHeight;
			return -1;
		};
		var elemContainsOffset = function elemContainsOffset(elem, left, top) {
			var offset = elemOffset(elem);
			offset.right = offset.left + elemWidth(elem);
			offset.bottom = offset.top + elemHeight(elem);
			return offset.left <= left && left < offset.right && offset.top <= top && top < offset.bottom;
		};
		var elemScrollOffset = function elemScrollOffset(elem) {
			var curLeft = 0;
			var curTop = 0;
			if (elem.parentNode) while (elem && elem.offsetParent) {
				curTop += elem.scrollTop;
				curLeft += elem.scrollLeft;
				elem = elem.parentNode;
			}
			return {
				left: curLeft,
				top: curTop
			};
		};
		var elemIsHidden = function elemIsHidden(elem) {
			while (elem && elem.nodeType === 1) {
				if (_elemStyle(elem, "display") === "none") return true;
				elem = elem.parentNode;
			}
			return false;
		};
		var elemInDom = function elemInDom(elem) {
			while (elem) {
				if (elem === document) return true;
				var parent = elem.parentNode;
				if (parent != null) elem = parent;
				else if (typeof elem.getRootNode === "function") {
					var _elem$getRootNode;
					elem = (_elem$getRootNode = elem.getRootNode()) === null || _elem$getRootNode === void 0 ? void 0 : _elem$getRootNode.host;
				} else return false;
			}
			return false;
		};
		var getDeepActiveElement = function getDeepActiveElement() {
			var active = (arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : document).activeElement;
			while ((_active = active) !== null && _active !== void 0 && (_active$shadowRoot = _active.shadowRoot) !== null && _active$shadowRoot !== void 0 && _active$shadowRoot.activeElement) {
				var _active, _active$shadowRoot;
				active = active.shadowRoot.activeElement;
			}
			return active;
		};
		var elemIsDescendantOf = function elemIsDescendantOf(elem, target) {
			var ancestors = elemAncestors(elem);
			for (var i = 0; i < ancestors.length; i++) if (ancestors[i] === target) return true;
			return false;
		};
		var elemAncestorWithClass = function elemAncestorWithClass(elem, klass) {
			var ancestors = elemAncestors(elem);
			for (var i = 0; i < ancestors.length; i++) if (elemHasClass(ancestors[i], klass)) return ancestors[i];
			return null;
		};
		var elemAncestorHasClass = function elemAncestorHasClass(elem, klass) {
			return !!elemAncestorWithClass(elem, klass);
		};
		var elemAncestors = function elemAncestors(elem) {
			var current = elem;
			var result = [];
			while (current = current.parentNode) result.push(current);
			return result;
		};
		var elemIsInside = function elemIsInside(elem, ancestor) {
			return elem === ancestor || elemIsDescendantOf(elem, ancestor);
		};
		var getTransitionProp = function getTransitionProp(props, time, easing) {
			var result = [];
			for (var prop in props) result.push("".concat(prop, " ").concat(time, "ms ").concat(easing));
			return result.join(",");
		};
		var elemAnimate = function elemAnimate(elem) {
			var props = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
			options = merge({
				time: 400,
				easing: "ease"
			}, options);
			_elemStyle(elem, { transition: getTransitionProp(props, options.time, options.easing) });
			safeRequestAnimationFrame(function() {
				_elemStyle(elem, props);
				setTimeout(function() {
					_elemStyle(elem, { transition: "" });
					if (typeof options.callback === "function") options.callback();
				}, options.time);
			});
		};
		var elemBind = function elemBind(elem, event, fn) {
			var useCapture = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : false;
			var eventShim = function eventShim(e) {
				e = e || window.event;
				if (!e.pageX && !e.pageY && (e.clientX || e.clientY)) {
					e.pageX = e.clientX + docScrollLeft();
					e.pageY = e.clientY + docScrollTop();
				}
				if (!e.preventDefault) e.preventDefault = function() {
					e.returnValue = false;
				};
				if (!e.stopPropagation) e.stopPropagation = function() {
					e.cancelBubble = true;
				};
				if (e.which == null) e.which = e.charCode != null ? e.charCode : e.keyCode;
				if (e.which == null && e.button != null) {
					if (e.button & 1) e.which = 1;
					else if (e.button & 2) e.which = 3;
					else if (e.button & 4) e.which = 2;
					else e.which = 0;
				}
				if (e.target) {} else if (e.srcElement) e.target = e.srcElement;
				if (e.target && e.target.nodeType === 3) e.target = e.target.parentNode;
				for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
				var result = fn.apply(e.target, [e].concat(args));
				if (result === elemUnbind) elemUnbind(elem, event, fn);
				return result;
			};
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_6__.s._elemBind = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_6__.s._elemBind || {};
			var key = elemBindKey(elem, event, fn);
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_6__.s._elemBind[key] = eventShim;
			eventShim.elem = elem;
			eventShim.event = event;
			elem.addEventListener(event, eventShim, useCapture);
			return function() {
				elemUnbind(elem, event, fn, useCapture);
			};
		};
		var elemUnbind = function elemUnbind(elem, event, fn) {
			var useCapture = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : false;
			if (!(elem != null && elem._wistiaElemId != null && fn != null && fn._wistiaBindId)) return;
			var key = elemBindKey(elem, event, fn);
			var eventShim = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_6__.s._elemBind[key];
			if (eventShim) {
				elem.removeEventListener(event, eventShim, useCapture);
				eventShim.elem = null;
				eventShim.event = null;
			}
			return delete _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_6__.s._elemBind[key];
		};
		var elemUnbindAll = function elemUnbindAll(elem) {
			for (var key in Wistia._elemBind) {
				var eventShim = Wistia._elemBind[key];
				if (eventShim && elem === eventShim.elem) {
					var event = eventShim.event;
					eventShim.elem.removeEventListener(event, eventShim, false);
					eventShim.elem = null;
					eventShim.event = null;
					delete Wistia._elemBind[key];
				}
			}
		};
		var elemUnbindAllInside = function elemUnbindAllInside(container) {
			var count = 0;
			for (var key in Wistia._elemBind) {
				var eventShim = Wistia._elemBind[key];
				if (eventShim && elemIsInside(eventShim.elem, container)) {
					var event = eventShim.event;
					eventShim.elem.removeEventListener(event, eventShim, false);
					eventShim.elem = null;
					eventShim.event = null;
					delete Wistia._elemBind[key];
					count += 1;
				}
			}
			return count;
		};
		var elemBindKey = function elemBindKey(elem, event, fn) {
			elem._wistiaElemId = elem._wistiaElemId || (0, utilities_seqid_js__WEBPACK_IMPORTED_MODULE_5__.h)("wistia_elem_");
			fn._wistiaBindId = fn._wistiaBindId || (0, utilities_seqid_js__WEBPACK_IMPORTED_MODULE_5__.h)("wistia_bind_");
			return "".concat(elem._wistiaElemId, ".").concat(event, ".").concat(fn._wistiaBindId);
		};
		var elemRebind = function elemRebind(elem, event, fn) {
			if (fn) {
				elemUnbind(elem, event, fn);
				return elemBind(elem, event, fn);
			}
		};
		var elemBindOnce = function elemBindOnce(elem, event, fn) {
			return elemBind(elem, event, function wrap() {
				for (var _len3 = arguments.length, args = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) args[_key3] = arguments[_key3];
				fn.apply(this, args);
				return elemUnbind;
			});
		};
		var elemTrigger = function elemTrigger(elem, event) {
			for (var _len4 = arguments.length, customArguments = new Array(_len4 > 2 ? _len4 - 2 : 0), _key4 = 2; _key4 < _len4; _key4++) customArguments[_key4 - 2] = arguments[_key4];
			if (elem.dispatchEvent) {
				var eventObj = document.createEvent("Events");
				eventObj.initEvent(event, true, false);
				if (event === "click" || event === "doubleclick") eventObj.which = 1;
				else if (event === "rightclick") eventObj.which = 2;
				eventObj.customArguments = customArguments;
				return elem.dispatchEvent(eventObj);
			}
			if (elem.fireEvent) {
				var _eventObj = { customArguments };
				return elem.fireEvent("on".concat(event), _eventObj);
			}
			wlog.error("neither dispatchEvent nor fireEvent is defined for", elem, event);
		};
		var fullscreenElement = function fullscreenElement() {
			return document.fullscreenElement || document.webkitFullscreenElement;
		};
		var elemRequestFullscreen = function elemRequestFullscreen(elem) {
			try {
				if (elem.requestFullscreen && document.fullscreenEnabled) return elem.requestFullscreen().catch(function(error) {
					wlog.notice("requestFullscreen failed", error);
					return Promise.reject(error);
				});
				if (elem.webkitEnterFullscreen) {
					if (elem.readyState !== void 0 && elem.readyState < HTMLMediaElement.HAVE_METADATA) {
						var errorMessage = "webkitEnterFullscreen requires at least HAVE_METADATA readyState";
						wlog.notice(errorMessage);
						return Promise.reject(new Error(errorMessage));
					}
					if (elem.webkitSupportsFullscreen === false) {
						var _errorMessage = "webkitEnterFullscreen is not currently supported for this element";
						wlog.notice(_errorMessage);
						return Promise.reject(new Error(_errorMessage));
					}
					elem.webkitEnterFullscreen();
					return Promise.resolve();
				}
			} catch (error) {
				wlog.notice("requestFullscreen failed", error);
				return Promise.reject(error);
			}
			wlog.notice("no requestFullscreen functionality detected");
			return Promise.resolve();
		};
		var elemCancelFullscreen = function elemCancelFullscreen(elem) {
			if (document.exitFullscreen) return document.exitFullscreen();
			if (elem && elem.webkitExitFullscreen) return new Promise(function(resolve) {
				elem.webkitExitFullscreen();
				resolve();
			});
			wlog.notice("no cancelFullscreen functionality detected");
			return Promise.resolve();
		};
		var _elemStripEventAttributes = function elemStripEventAttributes(elem) {
			var attributes = elem && elem.attributes || [];
			try {
				for (var i = 0; i < attributes.length; i++) {
					var attr = attributes[i];
					if (/^on.+/i.test(attr.name)) {
						elem[attr.name] = null;
						elem.removeAttribute(attr.name);
					}
				}
			} catch (e) {
				wlog.error(e);
			}
			if (elem.childNodes) for (var _i5 = 0; _i5 < elem.childNodes.length; _i5++) {
				var child = elem.childNodes[_i5];
				if (child.nodeType === 1) _elemStripEventAttributes(child);
			}
		};
		var elemMutationObserver = function elemMutationObserver(fn) {
			var klass = detect.mutationObserver;
			if (klass) return new window[klass](fn);
			return null;
		};
		var docScrollTop = function docScrollTop(t) {
			var docBody = document.body;
			var docElem = document.documentElement;
			if (t != null) {
				if (docBody) docBody.scrollTop = t;
				if (docElem) docElem.scrollTop = t;
			} else return docElem && docElem.scrollTop || docBody && docBody.scrollTop || 0;
		};
		var docScrollLeft = function docScrollLeft(t) {
			var docBody = document.body;
			var docElem = document.documentElement;
			if (t != null) {
				if (docBody) docBody.scrollLeft = t;
				if (docElem) docElem.scrollLeft = t;
			} else return docElem && docElem.scrollLeft || docBody && docBody.scrollLeft || 0;
		};
		var safeRequestAnimationFrame = function safeRequestAnimationFrame(fn) {
			return (window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || function(callback) {
				return setTimeout(callback, 1e3 / 60);
			})(fn);
		};
		var formInputIsFocused = function formInputIsFocused() {
			var activeElement = document.activeElement;
			if (document.activeElement.tagName === "WISTIA-PLAYER") activeElement = document.activeElement.shadowRoot.activeElement;
			if (activeElement.tagName === "WISTIA-FORM-EMBED") activeElement = activeElement.shadowRoot.activeElement;
			return /^textarea|input|select$/i.test(activeElement.tagName) || activeElement.isContentEditable;
		};
		var currentEventSource = function currentEventSource() {
			return inUserEventContext() ? "user-event" : "non-user-event";
		};
		var inUserEventContext = function inUserEventContext() {
			return !!activeDOMEvent;
		};
		var getLastActiveEventAt = function getLastActiveEventAt() {
			return lastActiveEventAt;
		};
		var activeDOMEvent;
		var lastActiveEventAt = null;
		[
			"auxclick",
			"click",
			"contextmenu",
			"dblclick",
			"focus",
			"keydown",
			"keypress",
			"keyup",
			"mousedown",
			"mouseup",
			"reset",
			"submit",
			"touchend",
			"touchstart"
		].forEach(function(type) {
			elemBind(document, type, function onEvent(e) {
				activeDOMEvent = e;
				lastActiveEventAt = Date.now();
				setTimeout(function() {
					if (activeDOMEvent === e) activeDOMEvent = void 0;
				}, 0);
			}, detect.passiveSupported ? {
				capture: true,
				passive: true
			} : true);
		});
	},
	7880(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { R: () => BigPlayButtonSVG });
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var _BigPlayButtonLoadingAnim_tsx__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(4719);
		var _utilities_svg_boilerplate_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1919);
		function _extends() {
			return _extends = Object.assign ? Object.assign.bind() : function(n) {
				for (var e = 1; e < arguments.length; e++) {
					var t = arguments[e];
					for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
				}
				return n;
			}, _extends.apply(null, arguments);
		}
		var ICON_WIDTH = 37;
		var ICON_HEIGHT = 36;
		var LOADING_ALPHA = .5;
		var BigPlayButtonSVG = function BigPlayButtonSVG(_ref) {
			var width = _ref.width, height = _ref.height, scale = _ref.scale, _ref$isLoading = _ref.isLoading, isLoading = _ref$isLoading === void 0 ? false : _ref$isLoading, overrideFillColor = _ref.overrideFillColor;
			var scaledHeight = height * scale;
			var svgAttrs = (0, _utilities_svg_boilerplate_ts__WEBPACK_IMPORTED_MODULE_2__.I)({
				width,
				height,
				styleOverride: {
					position: "absolute",
					height: "".concat(scaledHeight, "px"),
					color: overrideFillColor
				},
				ariaHidden: true
			});
			var iconXOffset = -(ICON_WIDTH / 2) + width / 2;
			var iconYOffset = -(ICON_HEIGHT / 2) + height / 2;
			return (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("svg", _extends({}, svgAttrs, { "aria-hidden": "true" }), (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("path", {
				"fill-rule": "evenodd",
				"clip-rule": "evenodd",
				fill: "currentcolor",
				opacity: isLoading ? LOADING_ALPHA : 1,
				transform: "translate(".concat(iconXOffset, ", ").concat(iconYOffset, ")"),
				d: "M12.138 2.173C10.812 1.254 9 2.203 9 3.817v28.366c0 1.613 1.812 2.563 3.138 1.644l20.487-14.183a2 2 0 0 0 0-3.288L12.138 2.173Z"
			}), isLoading && (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(_BigPlayButtonLoadingAnim_tsx__WEBPACK_IMPORTED_MODULE_1__.e, null));
		};
	},
	8089(module, exports, __webpack_require__) {
		module = __webpack_require__.nmd(module);
		/**
		* Lodash (Custom Build) <https://lodash.com/>
		* Build: `lodash modularize exports="npm" -o ./`
		* Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
		* Released under MIT license <https://lodash.com/license>
		* Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
		* Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
		*/
		/** Used as the size to enable large array optimizations. */
		var LARGE_ARRAY_SIZE = 200;
		/** Used to stand-in for `undefined` hash values. */
		var HASH_UNDEFINED = "__lodash_hash_undefined__";
		/** Used to detect hot functions by number of calls within a span of milliseconds. */
		var HOT_COUNT = 800, HOT_SPAN = 16;
		/** Used as references for various `Number` constants. */
		var MAX_SAFE_INTEGER = 9007199254740991;
		/** `Object#toString` result references. */
		var argsTag = "[object Arguments]", arrayTag = "[object Array]", asyncTag = "[object AsyncFunction]", boolTag = "[object Boolean]", dateTag = "[object Date]", errorTag = "[object Error]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", mapTag = "[object Map]", numberTag = "[object Number]", nullTag = "[object Null]", objectTag = "[object Object]", proxyTag = "[object Proxy]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", undefinedTag = "[object Undefined]", weakMapTag = "[object WeakMap]";
		var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
		/**
		* Used to match `RegExp`
		* [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
		*/
		var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
		/** Used to detect host constructors (Safari). */
		var reIsHostCtor = /^\[object .+?Constructor\]$/;
		/** Used to detect unsigned integer values. */
		var reIsUint = /^(?:0|[1-9]\d*)$/;
		/** Used to identify `toStringTag` values of typed arrays. */
		var typedArrayTags = {};
		typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
		typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
		/** Detect free variable `global` from Node.js. */
		var freeGlobal = typeof __webpack_require__.g == "object" && __webpack_require__.g && __webpack_require__.g.Object === Object && __webpack_require__.g;
		/** Detect free variable `self`. */
		var freeSelf = typeof self == "object" && self && self.Object === Object && self;
		/** Used as a reference to the global object. */
		var root = freeGlobal || freeSelf || Function("return this")();
		/** Detect free variable `exports`. */
		var freeExports = exports && !exports.nodeType && exports;
		/** Detect free variable `module`. */
		var freeModule = freeExports && module && !module.nodeType && module;
		/** Detect the popular CommonJS extension `module.exports`. */
		var moduleExports = freeModule && freeModule.exports === freeExports;
		/** Detect free variable `process` from Node.js. */
		var freeProcess = moduleExports && freeGlobal.process;
		/** Used to access faster Node.js helpers. */
		var nodeUtil = function() {
			try {
				var types = freeModule && freeModule.require && freeModule.require("util").types;
				if (types) return types;
				return freeProcess && freeProcess.binding && freeProcess.binding("util");
			} catch (e) {}
		}();
		var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
		/**
		* A faster alternative to `Function#apply`, this function invokes `func`
		* with the `this` binding of `thisArg` and the arguments of `args`.
		*
		* @private
		* @param {Function} func The function to invoke.
		* @param {*} thisArg The `this` binding of `func`.
		* @param {Array} args The arguments to invoke `func` with.
		* @returns {*} Returns the result of `func`.
		*/
		function apply(func, thisArg, args) {
			switch (args.length) {
				case 0: return func.call(thisArg);
				case 1: return func.call(thisArg, args[0]);
				case 2: return func.call(thisArg, args[0], args[1]);
				case 3: return func.call(thisArg, args[0], args[1], args[2]);
			}
			return func.apply(thisArg, args);
		}
		/**
		* The base implementation of `_.times` without support for iteratee shorthands
		* or max array length checks.
		*
		* @private
		* @param {number} n The number of times to invoke `iteratee`.
		* @param {Function} iteratee The function invoked per iteration.
		* @returns {Array} Returns the array of results.
		*/
		function baseTimes(n, iteratee) {
			var index = -1, result = Array(n);
			while (++index < n) result[index] = iteratee(index);
			return result;
		}
		/**
		* The base implementation of `_.unary` without support for storing metadata.
		*
		* @private
		* @param {Function} func The function to cap arguments for.
		* @returns {Function} Returns the new capped function.
		*/
		function baseUnary(func) {
			return function(value) {
				return func(value);
			};
		}
		/**
		* Gets the value at `key` of `object`.
		*
		* @private
		* @param {Object} [object] The object to query.
		* @param {string} key The key of the property to get.
		* @returns {*} Returns the property value.
		*/
		function getValue(object, key) {
			return object == null ? void 0 : object[key];
		}
		/**
		* Creates a unary function that invokes `func` with its argument transformed.
		*
		* @private
		* @param {Function} func The function to wrap.
		* @param {Function} transform The argument transform.
		* @returns {Function} Returns the new function.
		*/
		function overArg(func, transform) {
			return function(arg) {
				return func(transform(arg));
			};
		}
		/** Used for built-in method references. */
		var arrayProto = Array.prototype, funcProto = Function.prototype, objectProto = Object.prototype;
		/** Used to detect overreaching core-js shims. */
		var coreJsData = root["__core-js_shared__"];
		/** Used to resolve the decompiled source of functions. */
		var funcToString = funcProto.toString;
		/** Used to check objects for own properties. */
		var hasOwnProperty = objectProto.hasOwnProperty;
		/** Used to detect methods masquerading as native. */
		var maskSrcKey = function() {
			var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
			return uid ? "Symbol(src)_1." + uid : "";
		}();
		/**
		* Used to resolve the
		* [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
		* of values.
		*/
		var nativeObjectToString = objectProto.toString;
		/** Used to infer the `Object` constructor. */
		var objectCtorString = funcToString.call(Object);
		/** Used to detect if a method is native. */
		var reIsNative = RegExp("^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$");
		/** Built-in value references. */
		var Buffer = moduleExports ? root.Buffer : void 0, Symbol = root.Symbol, Uint8Array = root.Uint8Array, allocUnsafe = Buffer ? Buffer.allocUnsafe : void 0, getPrototype = overArg(Object.getPrototypeOf, Object), objectCreate = Object.create, propertyIsEnumerable = objectProto.propertyIsEnumerable, splice = arrayProto.splice, symToStringTag = Symbol ? Symbol.toStringTag : void 0;
		var defineProperty = function() {
			try {
				var func = getNative(Object, "defineProperty");
				func({}, "", {});
				return func;
			} catch (e) {}
		}();
		var nativeIsBuffer = Buffer ? Buffer.isBuffer : void 0, nativeMax = Math.max, nativeNow = Date.now;
		var Map = getNative(root, "Map"), nativeCreate = getNative(Object, "create");
		/**
		* The base implementation of `_.create` without support for assigning
		* properties to the created object.
		*
		* @private
		* @param {Object} proto The object to inherit from.
		* @returns {Object} Returns the new object.
		*/
		var baseCreate = function() {
			function object() {}
			return function(proto) {
				if (!isObject(proto)) return {};
				if (objectCreate) return objectCreate(proto);
				object.prototype = proto;
				var result = new object();
				object.prototype = void 0;
				return result;
			};
		}();
		/**
		* Creates a hash object.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function Hash(entries) {
			var index = -1, length = entries == null ? 0 : entries.length;
			this.clear();
			while (++index < length) {
				var entry = entries[index];
				this.set(entry[0], entry[1]);
			}
		}
		/**
		* Removes all key-value entries from the hash.
		*
		* @private
		* @name clear
		* @memberOf Hash
		*/
		function hashClear() {
			this.__data__ = nativeCreate ? nativeCreate(null) : {};
			this.size = 0;
		}
		/**
		* Removes `key` and its value from the hash.
		*
		* @private
		* @name delete
		* @memberOf Hash
		* @param {Object} hash The hash to modify.
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function hashDelete(key) {
			var result = this.has(key) && delete this.__data__[key];
			this.size -= result ? 1 : 0;
			return result;
		}
		/**
		* Gets the hash value for `key`.
		*
		* @private
		* @name get
		* @memberOf Hash
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function hashGet(key) {
			var data = this.__data__;
			if (nativeCreate) {
				var result = data[key];
				return result === HASH_UNDEFINED ? void 0 : result;
			}
			return hasOwnProperty.call(data, key) ? data[key] : void 0;
		}
		/**
		* Checks if a hash value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf Hash
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function hashHas(key) {
			var data = this.__data__;
			return nativeCreate ? data[key] !== void 0 : hasOwnProperty.call(data, key);
		}
		/**
		* Sets the hash `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf Hash
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the hash instance.
		*/
		function hashSet(key, value) {
			var data = this.__data__;
			this.size += this.has(key) ? 0 : 1;
			data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
			return this;
		}
		Hash.prototype.clear = hashClear;
		Hash.prototype["delete"] = hashDelete;
		Hash.prototype.get = hashGet;
		Hash.prototype.has = hashHas;
		Hash.prototype.set = hashSet;
		/**
		* Creates an list cache object.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function ListCache(entries) {
			var index = -1, length = entries == null ? 0 : entries.length;
			this.clear();
			while (++index < length) {
				var entry = entries[index];
				this.set(entry[0], entry[1]);
			}
		}
		/**
		* Removes all key-value entries from the list cache.
		*
		* @private
		* @name clear
		* @memberOf ListCache
		*/
		function listCacheClear() {
			this.__data__ = [];
			this.size = 0;
		}
		/**
		* Removes `key` and its value from the list cache.
		*
		* @private
		* @name delete
		* @memberOf ListCache
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function listCacheDelete(key) {
			var data = this.__data__, index = assocIndexOf(data, key);
			if (index < 0) return false;
			if (index == data.length - 1) data.pop();
			else splice.call(data, index, 1);
			--this.size;
			return true;
		}
		/**
		* Gets the list cache value for `key`.
		*
		* @private
		* @name get
		* @memberOf ListCache
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function listCacheGet(key) {
			var data = this.__data__, index = assocIndexOf(data, key);
			return index < 0 ? void 0 : data[index][1];
		}
		/**
		* Checks if a list cache value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf ListCache
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function listCacheHas(key) {
			return assocIndexOf(this.__data__, key) > -1;
		}
		/**
		* Sets the list cache `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf ListCache
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the list cache instance.
		*/
		function listCacheSet(key, value) {
			var data = this.__data__, index = assocIndexOf(data, key);
			if (index < 0) {
				++this.size;
				data.push([key, value]);
			} else data[index][1] = value;
			return this;
		}
		ListCache.prototype.clear = listCacheClear;
		ListCache.prototype["delete"] = listCacheDelete;
		ListCache.prototype.get = listCacheGet;
		ListCache.prototype.has = listCacheHas;
		ListCache.prototype.set = listCacheSet;
		/**
		* Creates a map cache object to store key-value pairs.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function MapCache(entries) {
			var index = -1, length = entries == null ? 0 : entries.length;
			this.clear();
			while (++index < length) {
				var entry = entries[index];
				this.set(entry[0], entry[1]);
			}
		}
		/**
		* Removes all key-value entries from the map.
		*
		* @private
		* @name clear
		* @memberOf MapCache
		*/
		function mapCacheClear() {
			this.size = 0;
			this.__data__ = {
				"hash": new Hash(),
				"map": new (Map || ListCache)(),
				"string": new Hash()
			};
		}
		/**
		* Removes `key` and its value from the map.
		*
		* @private
		* @name delete
		* @memberOf MapCache
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function mapCacheDelete(key) {
			var result = getMapData(this, key)["delete"](key);
			this.size -= result ? 1 : 0;
			return result;
		}
		/**
		* Gets the map value for `key`.
		*
		* @private
		* @name get
		* @memberOf MapCache
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function mapCacheGet(key) {
			return getMapData(this, key).get(key);
		}
		/**
		* Checks if a map value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf MapCache
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function mapCacheHas(key) {
			return getMapData(this, key).has(key);
		}
		/**
		* Sets the map `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf MapCache
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the map cache instance.
		*/
		function mapCacheSet(key, value) {
			var data = getMapData(this, key), size = data.size;
			data.set(key, value);
			this.size += data.size == size ? 0 : 1;
			return this;
		}
		MapCache.prototype.clear = mapCacheClear;
		MapCache.prototype["delete"] = mapCacheDelete;
		MapCache.prototype.get = mapCacheGet;
		MapCache.prototype.has = mapCacheHas;
		MapCache.prototype.set = mapCacheSet;
		/**
		* Creates a stack cache object to store key-value pairs.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function Stack(entries) {
			var data = this.__data__ = new ListCache(entries);
			this.size = data.size;
		}
		/**
		* Removes all key-value entries from the stack.
		*
		* @private
		* @name clear
		* @memberOf Stack
		*/
		function stackClear() {
			this.__data__ = new ListCache();
			this.size = 0;
		}
		/**
		* Removes `key` and its value from the stack.
		*
		* @private
		* @name delete
		* @memberOf Stack
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function stackDelete(key) {
			var data = this.__data__, result = data["delete"](key);
			this.size = data.size;
			return result;
		}
		/**
		* Gets the stack value for `key`.
		*
		* @private
		* @name get
		* @memberOf Stack
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function stackGet(key) {
			return this.__data__.get(key);
		}
		/**
		* Checks if a stack value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf Stack
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function stackHas(key) {
			return this.__data__.has(key);
		}
		/**
		* Sets the stack `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf Stack
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the stack cache instance.
		*/
		function stackSet(key, value) {
			var data = this.__data__;
			if (data instanceof ListCache) {
				var pairs = data.__data__;
				if (!Map || pairs.length < LARGE_ARRAY_SIZE - 1) {
					pairs.push([key, value]);
					this.size = ++data.size;
					return this;
				}
				data = this.__data__ = new MapCache(pairs);
			}
			data.set(key, value);
			this.size = data.size;
			return this;
		}
		Stack.prototype.clear = stackClear;
		Stack.prototype["delete"] = stackDelete;
		Stack.prototype.get = stackGet;
		Stack.prototype.has = stackHas;
		Stack.prototype.set = stackSet;
		/**
		* Creates an array of the enumerable property names of the array-like `value`.
		*
		* @private
		* @param {*} value The value to query.
		* @param {boolean} inherited Specify returning inherited property names.
		* @returns {Array} Returns the array of property names.
		*/
		function arrayLikeKeys(value, inherited) {
			var isArr = isArray(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result = skipIndexes ? baseTimes(value.length, String) : [], length = result.length;
			for (var key in value) if ((inherited || hasOwnProperty.call(value, key)) && !(skipIndexes && (key == "length" || isBuff && (key == "offset" || key == "parent") || isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || isIndex(key, length)))) result.push(key);
			return result;
		}
		/**
		* This function is like `assignValue` except that it doesn't assign
		* `undefined` values.
		*
		* @private
		* @param {Object} object The object to modify.
		* @param {string} key The key of the property to assign.
		* @param {*} value The value to assign.
		*/
		function assignMergeValue(object, key, value) {
			if (value !== void 0 && !eq(object[key], value) || value === void 0 && !(key in object)) baseAssignValue(object, key, value);
		}
		/**
		* Assigns `value` to `key` of `object` if the existing value is not equivalent
		* using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
		* for equality comparisons.
		*
		* @private
		* @param {Object} object The object to modify.
		* @param {string} key The key of the property to assign.
		* @param {*} value The value to assign.
		*/
		function assignValue(object, key, value) {
			var objValue = object[key];
			if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) || value === void 0 && !(key in object)) baseAssignValue(object, key, value);
		}
		/**
		* Gets the index at which the `key` is found in `array` of key-value pairs.
		*
		* @private
		* @param {Array} array The array to inspect.
		* @param {*} key The key to search for.
		* @returns {number} Returns the index of the matched value, else `-1`.
		*/
		function assocIndexOf(array, key) {
			var length = array.length;
			while (length--) if (eq(array[length][0], key)) return length;
			return -1;
		}
		/**
		* The base implementation of `assignValue` and `assignMergeValue` without
		* value checks.
		*
		* @private
		* @param {Object} object The object to modify.
		* @param {string} key The key of the property to assign.
		* @param {*} value The value to assign.
		*/
		function baseAssignValue(object, key, value) {
			if (key == "__proto__" && defineProperty) defineProperty(object, key, {
				"configurable": true,
				"enumerable": true,
				"value": value,
				"writable": true
			});
			else object[key] = value;
		}
		/**
		* The base implementation of `baseForOwn` which iterates over `object`
		* properties returned by `keysFunc` and invokes `iteratee` for each property.
		* Iteratee functions may exit iteration early by explicitly returning `false`.
		*
		* @private
		* @param {Object} object The object to iterate over.
		* @param {Function} iteratee The function invoked per iteration.
		* @param {Function} keysFunc The function to get the keys of `object`.
		* @returns {Object} Returns `object`.
		*/
		var baseFor = createBaseFor();
		/**
		* The base implementation of `getTag` without fallbacks for buggy environments.
		*
		* @private
		* @param {*} value The value to query.
		* @returns {string} Returns the `toStringTag`.
		*/
		function baseGetTag(value) {
			if (value == null) return value === void 0 ? undefinedTag : nullTag;
			return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
		}
		/**
		* The base implementation of `_.isArguments`.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an `arguments` object,
		*/
		function baseIsArguments(value) {
			return isObjectLike(value) && baseGetTag(value) == argsTag;
		}
		/**
		* The base implementation of `_.isNative` without bad shim checks.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a native function,
		*  else `false`.
		*/
		function baseIsNative(value) {
			if (!isObject(value) || isMasked(value)) return false;
			return (isFunction(value) ? reIsNative : reIsHostCtor).test(toSource(value));
		}
		/**
		* The base implementation of `_.isTypedArray` without Node.js optimizations.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
		*/
		function baseIsTypedArray(value) {
			return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
		}
		/**
		* The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
		*
		* @private
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of property names.
		*/
		function baseKeysIn(object) {
			if (!isObject(object)) return nativeKeysIn(object);
			var isProto = isPrototype(object), result = [];
			for (var key in object) if (!(key == "constructor" && (isProto || !hasOwnProperty.call(object, key)))) result.push(key);
			return result;
		}
		/**
		* The base implementation of `_.merge` without support for multiple sources.
		*
		* @private
		* @param {Object} object The destination object.
		* @param {Object} source The source object.
		* @param {number} srcIndex The index of `source`.
		* @param {Function} [customizer] The function to customize merged values.
		* @param {Object} [stack] Tracks traversed source values and their merged
		*  counterparts.
		*/
		function baseMerge(object, source, srcIndex, customizer, stack) {
			if (object === source) return;
			baseFor(source, function(srcValue, key) {
				stack || (stack = new Stack());
				if (isObject(srcValue)) baseMergeDeep(object, source, key, srcIndex, baseMerge, customizer, stack);
				else {
					var newValue = customizer ? customizer(safeGet(object, key), srcValue, key + "", object, source, stack) : void 0;
					if (newValue === void 0) newValue = srcValue;
					assignMergeValue(object, key, newValue);
				}
			}, keysIn);
		}
		/**
		* A specialized version of `baseMerge` for arrays and objects which performs
		* deep merges and tracks traversed objects enabling objects with circular
		* references to be merged.
		*
		* @private
		* @param {Object} object The destination object.
		* @param {Object} source The source object.
		* @param {string} key The key of the value to merge.
		* @param {number} srcIndex The index of `source`.
		* @param {Function} mergeFunc The function to merge values.
		* @param {Function} [customizer] The function to customize assigned values.
		* @param {Object} [stack] Tracks traversed source values and their merged
		*  counterparts.
		*/
		function baseMergeDeep(object, source, key, srcIndex, mergeFunc, customizer, stack) {
			var objValue = safeGet(object, key), srcValue = safeGet(source, key), stacked = stack.get(srcValue);
			if (stacked) {
				assignMergeValue(object, key, stacked);
				return;
			}
			var newValue = customizer ? customizer(objValue, srcValue, key + "", object, source, stack) : void 0;
			var isCommon = newValue === void 0;
			if (isCommon) {
				var isArr = isArray(srcValue), isBuff = !isArr && isBuffer(srcValue), isTyped = !isArr && !isBuff && isTypedArray(srcValue);
				newValue = srcValue;
				if (isArr || isBuff || isTyped) {
					if (isArray(objValue)) newValue = objValue;
					else if (isArrayLikeObject(objValue)) newValue = copyArray(objValue);
					else if (isBuff) {
						isCommon = false;
						newValue = cloneBuffer(srcValue, true);
					} else if (isTyped) {
						isCommon = false;
						newValue = cloneTypedArray(srcValue, true);
					} else newValue = [];
				} else if (isPlainObject(srcValue) || isArguments(srcValue)) {
					newValue = objValue;
					if (isArguments(objValue)) newValue = toPlainObject(objValue);
					else if (!isObject(objValue) || isFunction(objValue)) newValue = initCloneObject(srcValue);
				} else isCommon = false;
			}
			if (isCommon) {
				stack.set(srcValue, newValue);
				mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
				stack["delete"](srcValue);
			}
			assignMergeValue(object, key, newValue);
		}
		/**
		* The base implementation of `_.rest` which doesn't validate or coerce arguments.
		*
		* @private
		* @param {Function} func The function to apply a rest parameter to.
		* @param {number} [start=func.length-1] The start position of the rest parameter.
		* @returns {Function} Returns the new function.
		*/
		function baseRest(func, start) {
			return setToString(overRest(func, start, identity), func + "");
		}
		/**
		* The base implementation of `setToString` without support for hot loop shorting.
		*
		* @private
		* @param {Function} func The function to modify.
		* @param {Function} string The `toString` result.
		* @returns {Function} Returns `func`.
		*/
		var baseSetToString = !defineProperty ? identity : function(func, string) {
			return defineProperty(func, "toString", {
				"configurable": true,
				"enumerable": false,
				"value": constant(string),
				"writable": true
			});
		};
		/**
		* Creates a clone of  `buffer`.
		*
		* @private
		* @param {Buffer} buffer The buffer to clone.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Buffer} Returns the cloned buffer.
		*/
		function cloneBuffer(buffer, isDeep) {
			if (isDeep) return buffer.slice();
			var length = buffer.length, result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);
			buffer.copy(result);
			return result;
		}
		/**
		* Creates a clone of `arrayBuffer`.
		*
		* @private
		* @param {ArrayBuffer} arrayBuffer The array buffer to clone.
		* @returns {ArrayBuffer} Returns the cloned array buffer.
		*/
		function cloneArrayBuffer(arrayBuffer) {
			var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
			new Uint8Array(result).set(new Uint8Array(arrayBuffer));
			return result;
		}
		/**
		* Creates a clone of `typedArray`.
		*
		* @private
		* @param {Object} typedArray The typed array to clone.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Object} Returns the cloned typed array.
		*/
		function cloneTypedArray(typedArray, isDeep) {
			var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
			return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
		}
		/**
		* Copies the values of `source` to `array`.
		*
		* @private
		* @param {Array} source The array to copy values from.
		* @param {Array} [array=[]] The array to copy values to.
		* @returns {Array} Returns `array`.
		*/
		function copyArray(source, array) {
			var index = -1, length = source.length;
			array || (array = Array(length));
			while (++index < length) array[index] = source[index];
			return array;
		}
		/**
		* Copies properties of `source` to `object`.
		*
		* @private
		* @param {Object} source The object to copy properties from.
		* @param {Array} props The property identifiers to copy.
		* @param {Object} [object={}] The object to copy properties to.
		* @param {Function} [customizer] The function to customize copied values.
		* @returns {Object} Returns `object`.
		*/
		function copyObject(source, props, object, customizer) {
			var isNew = !object;
			object || (object = {});
			var index = -1, length = props.length;
			while (++index < length) {
				var key = props[index];
				var newValue = customizer ? customizer(object[key], source[key], key, object, source) : void 0;
				if (newValue === void 0) newValue = source[key];
				if (isNew) baseAssignValue(object, key, newValue);
				else assignValue(object, key, newValue);
			}
			return object;
		}
		/**
		* Creates a function like `_.assign`.
		*
		* @private
		* @param {Function} assigner The function to assign values.
		* @returns {Function} Returns the new assigner function.
		*/
		function createAssigner(assigner) {
			return baseRest(function(object, sources) {
				var index = -1, length = sources.length, customizer = length > 1 ? sources[length - 1] : void 0, guard = length > 2 ? sources[2] : void 0;
				customizer = assigner.length > 3 && typeof customizer == "function" ? (length--, customizer) : void 0;
				if (guard && isIterateeCall(sources[0], sources[1], guard)) {
					customizer = length < 3 ? void 0 : customizer;
					length = 1;
				}
				object = Object(object);
				while (++index < length) {
					var source = sources[index];
					if (source) assigner(object, source, index, customizer);
				}
				return object;
			});
		}
		/**
		* Creates a base function for methods like `_.forIn` and `_.forOwn`.
		*
		* @private
		* @param {boolean} [fromRight] Specify iterating from right to left.
		* @returns {Function} Returns the new base function.
		*/
		function createBaseFor(fromRight) {
			return function(object, iteratee, keysFunc) {
				var index = -1, iterable = Object(object), props = keysFunc(object), length = props.length;
				while (length--) {
					var key = props[fromRight ? length : ++index];
					if (iteratee(iterable[key], key, iterable) === false) break;
				}
				return object;
			};
		}
		/**
		* Gets the data for `map`.
		*
		* @private
		* @param {Object} map The map to query.
		* @param {string} key The reference key.
		* @returns {*} Returns the map data.
		*/
		function getMapData(map, key) {
			var data = map.__data__;
			return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
		}
		/**
		* Gets the native function at `key` of `object`.
		*
		* @private
		* @param {Object} object The object to query.
		* @param {string} key The key of the method to get.
		* @returns {*} Returns the function if it's native, else `undefined`.
		*/
		function getNative(object, key) {
			var value = getValue(object, key);
			return baseIsNative(value) ? value : void 0;
		}
		/**
		* A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
		*
		* @private
		* @param {*} value The value to query.
		* @returns {string} Returns the raw `toStringTag`.
		*/
		function getRawTag(value) {
			var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
			try {
				value[symToStringTag] = void 0;
				var unmasked = true;
			} catch (e) {}
			var result = nativeObjectToString.call(value);
			if (unmasked) {
				if (isOwn) value[symToStringTag] = tag;
				else delete value[symToStringTag];
			}
			return result;
		}
		/**
		* Initializes an object clone.
		*
		* @private
		* @param {Object} object The object to clone.
		* @returns {Object} Returns the initialized clone.
		*/
		function initCloneObject(object) {
			return typeof object.constructor == "function" && !isPrototype(object) ? baseCreate(getPrototype(object)) : {};
		}
		/**
		* Checks if `value` is a valid array-like index.
		*
		* @private
		* @param {*} value The value to check.
		* @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
		* @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
		*/
		function isIndex(value, length) {
			var type = typeof value;
			length = length == null ? MAX_SAFE_INTEGER : length;
			return !!length && (type == "number" || type != "symbol" && reIsUint.test(value)) && value > -1 && value % 1 == 0 && value < length;
		}
		/**
		* Checks if the given arguments are from an iteratee call.
		*
		* @private
		* @param {*} value The potential iteratee value argument.
		* @param {*} index The potential iteratee index or key argument.
		* @param {*} object The potential iteratee object argument.
		* @returns {boolean} Returns `true` if the arguments are from an iteratee call,
		*  else `false`.
		*/
		function isIterateeCall(value, index, object) {
			if (!isObject(object)) return false;
			var type = typeof index;
			if (type == "number" ? isArrayLike(object) && isIndex(index, object.length) : type == "string" && index in object) return eq(object[index], value);
			return false;
		}
		/**
		* Checks if `value` is suitable for use as unique object key.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is suitable, else `false`.
		*/
		function isKeyable(value) {
			var type = typeof value;
			return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
		}
		/**
		* Checks if `func` has its source masked.
		*
		* @private
		* @param {Function} func The function to check.
		* @returns {boolean} Returns `true` if `func` is masked, else `false`.
		*/
		function isMasked(func) {
			return !!maskSrcKey && maskSrcKey in func;
		}
		/**
		* Checks if `value` is likely a prototype object.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
		*/
		function isPrototype(value) {
			var Ctor = value && value.constructor;
			return value === (typeof Ctor == "function" && Ctor.prototype || objectProto);
		}
		/**
		* This function is like
		* [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
		* except that it includes inherited enumerable properties.
		*
		* @private
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of property names.
		*/
		function nativeKeysIn(object) {
			var result = [];
			if (object != null) for (var key in Object(object)) result.push(key);
			return result;
		}
		/**
		* Converts `value` to a string using `Object.prototype.toString`.
		*
		* @private
		* @param {*} value The value to convert.
		* @returns {string} Returns the converted string.
		*/
		function objectToString(value) {
			return nativeObjectToString.call(value);
		}
		/**
		* A specialized version of `baseRest` which transforms the rest array.
		*
		* @private
		* @param {Function} func The function to apply a rest parameter to.
		* @param {number} [start=func.length-1] The start position of the rest parameter.
		* @param {Function} transform The rest array transform.
		* @returns {Function} Returns the new function.
		*/
		function overRest(func, start, transform) {
			start = nativeMax(start === void 0 ? func.length - 1 : start, 0);
			return function() {
				var args = arguments, index = -1, length = nativeMax(args.length - start, 0), array = Array(length);
				while (++index < length) array[index] = args[start + index];
				index = -1;
				var otherArgs = Array(start + 1);
				while (++index < start) otherArgs[index] = args[index];
				otherArgs[start] = transform(array);
				return apply(func, this, otherArgs);
			};
		}
		/**
		* Gets the value at `key`, unless `key` is "__proto__" or "constructor".
		*
		* @private
		* @param {Object} object The object to query.
		* @param {string} key The key of the property to get.
		* @returns {*} Returns the property value.
		*/
		function safeGet(object, key) {
			if (key === "constructor" && typeof object[key] === "function") return;
			if (key == "__proto__") return;
			return object[key];
		}
		/**
		* Sets the `toString` method of `func` to return `string`.
		*
		* @private
		* @param {Function} func The function to modify.
		* @param {Function} string The `toString` result.
		* @returns {Function} Returns `func`.
		*/
		var setToString = shortOut(baseSetToString);
		/**
		* Creates a function that'll short out and invoke `identity` instead
		* of `func` when it's called `HOT_COUNT` or more times in `HOT_SPAN`
		* milliseconds.
		*
		* @private
		* @param {Function} func The function to restrict.
		* @returns {Function} Returns the new shortable function.
		*/
		function shortOut(func) {
			var count = 0, lastCalled = 0;
			return function() {
				var stamp = nativeNow(), remaining = HOT_SPAN - (stamp - lastCalled);
				lastCalled = stamp;
				if (remaining > 0) {
					if (++count >= HOT_COUNT) return arguments[0];
				} else count = 0;
				return func.apply(void 0, arguments);
			};
		}
		/**
		* Converts `func` to its source code.
		*
		* @private
		* @param {Function} func The function to convert.
		* @returns {string} Returns the source code.
		*/
		function toSource(func) {
			if (func != null) {
				try {
					return funcToString.call(func);
				} catch (e) {}
				try {
					return func + "";
				} catch (e) {}
			}
			return "";
		}
		/**
		* Performs a
		* [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
		* comparison between two values to determine if they are equivalent.
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to compare.
		* @param {*} other The other value to compare.
		* @returns {boolean} Returns `true` if the values are equivalent, else `false`.
		* @example
		*
		* var object = { 'a': 1 };
		* var other = { 'a': 1 };
		*
		* _.eq(object, object);
		* // => true
		*
		* _.eq(object, other);
		* // => false
		*
		* _.eq('a', 'a');
		* // => true
		*
		* _.eq('a', Object('a'));
		* // => false
		*
		* _.eq(NaN, NaN);
		* // => true
		*/
		function eq(value, other) {
			return value === other || value !== value && other !== other;
		}
		/**
		* Checks if `value` is likely an `arguments` object.
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an `arguments` object,
		*  else `false`.
		* @example
		*
		* _.isArguments(function() { return arguments; }());
		* // => true
		*
		* _.isArguments([1, 2, 3]);
		* // => false
		*/
		var isArguments = baseIsArguments(function() {
			return arguments;
		}()) ? baseIsArguments : function(value) {
			return isObjectLike(value) && hasOwnProperty.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
		};
		/**
		* Checks if `value` is classified as an `Array` object.
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an array, else `false`.
		* @example
		*
		* _.isArray([1, 2, 3]);
		* // => true
		*
		* _.isArray(document.body.children);
		* // => false
		*
		* _.isArray('abc');
		* // => false
		*
		* _.isArray(_.noop);
		* // => false
		*/
		var isArray = Array.isArray;
		/**
		* Checks if `value` is array-like. A value is considered array-like if it's
		* not a function and has a `value.length` that's an integer greater than or
		* equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is array-like, else `false`.
		* @example
		*
		* _.isArrayLike([1, 2, 3]);
		* // => true
		*
		* _.isArrayLike(document.body.children);
		* // => true
		*
		* _.isArrayLike('abc');
		* // => true
		*
		* _.isArrayLike(_.noop);
		* // => false
		*/
		function isArrayLike(value) {
			return value != null && isLength(value.length) && !isFunction(value);
		}
		/**
		* This method is like `_.isArrayLike` except that it also checks if `value`
		* is an object.
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an array-like object,
		*  else `false`.
		* @example
		*
		* _.isArrayLikeObject([1, 2, 3]);
		* // => true
		*
		* _.isArrayLikeObject(document.body.children);
		* // => true
		*
		* _.isArrayLikeObject('abc');
		* // => false
		*
		* _.isArrayLikeObject(_.noop);
		* // => false
		*/
		function isArrayLikeObject(value) {
			return isObjectLike(value) && isArrayLike(value);
		}
		/**
		* Checks if `value` is a buffer.
		*
		* @static
		* @memberOf _
		* @since 4.3.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
		* @example
		*
		* _.isBuffer(new Buffer(2));
		* // => true
		*
		* _.isBuffer(new Uint8Array(2));
		* // => false
		*/
		var isBuffer = nativeIsBuffer || stubFalse;
		/**
		* Checks if `value` is classified as a `Function` object.
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a function, else `false`.
		* @example
		*
		* _.isFunction(_);
		* // => true
		*
		* _.isFunction(/abc/);
		* // => false
		*/
		function isFunction(value) {
			if (!isObject(value)) return false;
			var tag = baseGetTag(value);
			return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
		}
		/**
		* Checks if `value` is a valid array-like length.
		*
		* **Note:** This method is loosely based on
		* [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
		* @example
		*
		* _.isLength(3);
		* // => true
		*
		* _.isLength(Number.MIN_VALUE);
		* // => false
		*
		* _.isLength(Infinity);
		* // => false
		*
		* _.isLength('3');
		* // => false
		*/
		function isLength(value) {
			return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
		}
		/**
		* Checks if `value` is the
		* [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
		* of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an object, else `false`.
		* @example
		*
		* _.isObject({});
		* // => true
		*
		* _.isObject([1, 2, 3]);
		* // => true
		*
		* _.isObject(_.noop);
		* // => true
		*
		* _.isObject(null);
		* // => false
		*/
		function isObject(value) {
			var type = typeof value;
			return value != null && (type == "object" || type == "function");
		}
		/**
		* Checks if `value` is object-like. A value is object-like if it's not `null`
		* and has a `typeof` result of "object".
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is object-like, else `false`.
		* @example
		*
		* _.isObjectLike({});
		* // => true
		*
		* _.isObjectLike([1, 2, 3]);
		* // => true
		*
		* _.isObjectLike(_.noop);
		* // => false
		*
		* _.isObjectLike(null);
		* // => false
		*/
		function isObjectLike(value) {
			return value != null && typeof value == "object";
		}
		/**
		* Checks if `value` is a plain object, that is, an object created by the
		* `Object` constructor or one with a `[[Prototype]]` of `null`.
		*
		* @static
		* @memberOf _
		* @since 0.8.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
		* @example
		*
		* function Foo() {
		*   this.a = 1;
		* }
		*
		* _.isPlainObject(new Foo);
		* // => false
		*
		* _.isPlainObject([1, 2, 3]);
		* // => false
		*
		* _.isPlainObject({ 'x': 0, 'y': 0 });
		* // => true
		*
		* _.isPlainObject(Object.create(null));
		* // => true
		*/
		function isPlainObject(value) {
			if (!isObjectLike(value) || baseGetTag(value) != objectTag) return false;
			var proto = getPrototype(value);
			if (proto === null) return true;
			var Ctor = hasOwnProperty.call(proto, "constructor") && proto.constructor;
			return typeof Ctor == "function" && Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString;
		}
		/**
		* Checks if `value` is classified as a typed array.
		*
		* @static
		* @memberOf _
		* @since 3.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
		* @example
		*
		* _.isTypedArray(new Uint8Array);
		* // => true
		*
		* _.isTypedArray([]);
		* // => false
		*/
		var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
		/**
		* Converts `value` to a plain object flattening inherited enumerable string
		* keyed properties of `value` to own properties of the plain object.
		*
		* @static
		* @memberOf _
		* @since 3.0.0
		* @category Lang
		* @param {*} value The value to convert.
		* @returns {Object} Returns the converted plain object.
		* @example
		*
		* function Foo() {
		*   this.b = 2;
		* }
		*
		* Foo.prototype.c = 3;
		*
		* _.assign({ 'a': 1 }, new Foo);
		* // => { 'a': 1, 'b': 2 }
		*
		* _.assign({ 'a': 1 }, _.toPlainObject(new Foo));
		* // => { 'a': 1, 'b': 2, 'c': 3 }
		*/
		function toPlainObject(value) {
			return copyObject(value, keysIn(value));
		}
		/**
		* Creates an array of the own and inherited enumerable property names of `object`.
		*
		* **Note:** Non-object values are coerced to objects.
		*
		* @static
		* @memberOf _
		* @since 3.0.0
		* @category Object
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of property names.
		* @example
		*
		* function Foo() {
		*   this.a = 1;
		*   this.b = 2;
		* }
		*
		* Foo.prototype.c = 3;
		*
		* _.keysIn(new Foo);
		* // => ['a', 'b', 'c'] (iteration order is not guaranteed)
		*/
		function keysIn(object) {
			return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
		}
		/**
		* This method is like `_.assign` except that it recursively merges own and
		* inherited enumerable string keyed properties of source objects into the
		* destination object. Source properties that resolve to `undefined` are
		* skipped if a destination value exists. Array and plain object properties
		* are merged recursively. Other objects and value types are overridden by
		* assignment. Source objects are applied from left to right. Subsequent
		* sources overwrite property assignments of previous sources.
		*
		* **Note:** This method mutates `object`.
		*
		* @static
		* @memberOf _
		* @since 0.5.0
		* @category Object
		* @param {Object} object The destination object.
		* @param {...Object} [sources] The source objects.
		* @returns {Object} Returns `object`.
		* @example
		*
		* var object = {
		*   'a': [{ 'b': 2 }, { 'd': 4 }]
		* };
		*
		* var other = {
		*   'a': [{ 'c': 3 }, { 'e': 5 }]
		* };
		*
		* _.merge(object, other);
		* // => { 'a': [{ 'b': 2, 'c': 3 }, { 'd': 4, 'e': 5 }] }
		*/
		var merge = createAssigner(function(object, source, srcIndex) {
			baseMerge(object, source, srcIndex);
		});
		/**
		* Creates a function that returns `value`.
		*
		* @static
		* @memberOf _
		* @since 2.4.0
		* @category Util
		* @param {*} value The value to return from the new function.
		* @returns {Function} Returns the new constant function.
		* @example
		*
		* var objects = _.times(2, _.constant({ 'a': 1 }));
		*
		* console.log(objects);
		* // => [{ 'a': 1 }, { 'a': 1 }]
		*
		* console.log(objects[0] === objects[1]);
		* // => true
		*/
		function constant(value) {
			return function() {
				return value;
			};
		}
		/**
		* This method returns the first argument it receives.
		*
		* @static
		* @since 0.1.0
		* @memberOf _
		* @category Util
		* @param {*} value Any value.
		* @returns {*} Returns `value`.
		* @example
		*
		* var object = { 'a': 1 };
		*
		* console.log(_.identity(object) === object);
		* // => true
		*/
		function identity(value) {
			return value;
		}
		/**
		* This method returns `false`.
		*
		* @static
		* @memberOf _
		* @since 4.13.0
		* @category Util
		* @returns {boolean} Returns `false`.
		* @example
		*
		* _.times(2, _.stubFalse);
		* // => [false, false]
		*/
		function stubFalse() {
			return false;
		}
		module.exports = merge;
	},
	8176(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { z: () => root });
		var rootTest;
		try {
			rootTest = self;
			if (rootTest.self !== rootTest && typeof rootTest.self !== "undefined" && typeof window !== "undefined") rootTest = window;
		} catch (err) {
			if (typeof globalThis !== "undefined") rootTest = globalThis;
			else rootTest = window;
		}
		var root = rootTest;
	},
	8213(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { w5: () => interNumbersSemiBold });
		var interBoldItalicFontFamily = "WistiaPlayerInterBoldItalic, Helvetica, Sans-Serif";
		var interFontFamily = "WistiaPlayerInter, Helvetica, Sans-Serif";
		var interSemiBoldFontFamily = "WistiaPlayerInterSemiBold, Helvetica, Sans-Serif";
		var interNumbersSemiBold = "WistiaPlayerInterNumbersSemiBold, Helvetica, Sans-Serif";
	},
	8290(module, exports, __webpack_require__) {
		module = __webpack_require__.nmd(module);
		/**
		* lodash (Custom Build) <https://lodash.com/>
		* Build: `lodash modularize exports="npm" -o ./`
		* Copyright jQuery Foundation and other contributors <https://jquery.org/>
		* Released under MIT license <https://lodash.com/license>
		* Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
		* Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
		*/
		/** Used as the size to enable large array optimizations. */
		var LARGE_ARRAY_SIZE = 200;
		/** Used to stand-in for `undefined` hash values. */
		var HASH_UNDEFINED = "__lodash_hash_undefined__";
		/** Used as references for various `Number` constants. */
		var MAX_SAFE_INTEGER = 9007199254740991;
		/** `Object#toString` result references. */
		var argsTag = "[object Arguments]", arrayTag = "[object Array]", boolTag = "[object Boolean]", dateTag = "[object Date]", errorTag = "[object Error]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", mapTag = "[object Map]", numberTag = "[object Number]", objectTag = "[object Object]", promiseTag = "[object Promise]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]", weakMapTag = "[object WeakMap]";
		var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
		/**
		* Used to match `RegExp`
		* [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
		*/
		var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
		/** Used to match `RegExp` flags from their coerced string values. */
		var reFlags = /\w*$/;
		/** Used to detect host constructors (Safari). */
		var reIsHostCtor = /^\[object .+?Constructor\]$/;
		/** Used to detect unsigned integer values. */
		var reIsUint = /^(?:0|[1-9]\d*)$/;
		/** Used to identify `toStringTag` values supported by `_.clone`. */
		var cloneableTags = {};
		cloneableTags[argsTag] = cloneableTags[arrayTag] = cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] = cloneableTags[boolTag] = cloneableTags[dateTag] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[mapTag] = cloneableTags[numberTag] = cloneableTags[objectTag] = cloneableTags[regexpTag] = cloneableTags[setTag] = cloneableTags[stringTag] = cloneableTags[symbolTag] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
		cloneableTags[errorTag] = cloneableTags[funcTag] = cloneableTags[weakMapTag] = false;
		/** Detect free variable `global` from Node.js. */
		var freeGlobal = typeof __webpack_require__.g == "object" && __webpack_require__.g && __webpack_require__.g.Object === Object && __webpack_require__.g;
		/** Detect free variable `self`. */
		var freeSelf = typeof self == "object" && self && self.Object === Object && self;
		/** Used as a reference to the global object. */
		var root = freeGlobal || freeSelf || Function("return this")();
		/** Detect free variable `exports`. */
		var freeExports = exports && !exports.nodeType && exports;
		/** Detect free variable `module`. */
		var freeModule = freeExports && module && !module.nodeType && module;
		/** Detect the popular CommonJS extension `module.exports`. */
		var moduleExports = freeModule && freeModule.exports === freeExports;
		/**
		* Adds the key-value `pair` to `map`.
		*
		* @private
		* @param {Object} map The map to modify.
		* @param {Array} pair The key-value pair to add.
		* @returns {Object} Returns `map`.
		*/
		function addMapEntry(map, pair) {
			map.set(pair[0], pair[1]);
			return map;
		}
		/**
		* Adds `value` to `set`.
		*
		* @private
		* @param {Object} set The set to modify.
		* @param {*} value The value to add.
		* @returns {Object} Returns `set`.
		*/
		function addSetEntry(set, value) {
			set.add(value);
			return set;
		}
		/**
		* A specialized version of `_.forEach` for arrays without support for
		* iteratee shorthands.
		*
		* @private
		* @param {Array} [array] The array to iterate over.
		* @param {Function} iteratee The function invoked per iteration.
		* @returns {Array} Returns `array`.
		*/
		function arrayEach(array, iteratee) {
			var index = -1, length = array ? array.length : 0;
			while (++index < length) if (iteratee(array[index], index, array) === false) break;
			return array;
		}
		/**
		* Appends the elements of `values` to `array`.
		*
		* @private
		* @param {Array} array The array to modify.
		* @param {Array} values The values to append.
		* @returns {Array} Returns `array`.
		*/
		function arrayPush(array, values) {
			var index = -1, length = values.length, offset = array.length;
			while (++index < length) array[offset + index] = values[index];
			return array;
		}
		/**
		* A specialized version of `_.reduce` for arrays without support for
		* iteratee shorthands.
		*
		* @private
		* @param {Array} [array] The array to iterate over.
		* @param {Function} iteratee The function invoked per iteration.
		* @param {*} [accumulator] The initial value.
		* @param {boolean} [initAccum] Specify using the first element of `array` as
		*  the initial value.
		* @returns {*} Returns the accumulated value.
		*/
		function arrayReduce(array, iteratee, accumulator, initAccum) {
			var index = -1, length = array ? array.length : 0;
			if (initAccum && length) accumulator = array[++index];
			while (++index < length) accumulator = iteratee(accumulator, array[index], index, array);
			return accumulator;
		}
		/**
		* The base implementation of `_.times` without support for iteratee shorthands
		* or max array length checks.
		*
		* @private
		* @param {number} n The number of times to invoke `iteratee`.
		* @param {Function} iteratee The function invoked per iteration.
		* @returns {Array} Returns the array of results.
		*/
		function baseTimes(n, iteratee) {
			var index = -1, result = Array(n);
			while (++index < n) result[index] = iteratee(index);
			return result;
		}
		/**
		* Gets the value at `key` of `object`.
		*
		* @private
		* @param {Object} [object] The object to query.
		* @param {string} key The key of the property to get.
		* @returns {*} Returns the property value.
		*/
		function getValue(object, key) {
			return object == null ? void 0 : object[key];
		}
		/**
		* Checks if `value` is a host object in IE < 9.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a host object, else `false`.
		*/
		function isHostObject(value) {
			var result = false;
			if (value != null && typeof value.toString != "function") try {
				result = !!(value + "");
			} catch (e) {}
			return result;
		}
		/**
		* Converts `map` to its key-value pairs.
		*
		* @private
		* @param {Object} map The map to convert.
		* @returns {Array} Returns the key-value pairs.
		*/
		function mapToArray(map) {
			var index = -1, result = Array(map.size);
			map.forEach(function(value, key) {
				result[++index] = [key, value];
			});
			return result;
		}
		/**
		* Creates a unary function that invokes `func` with its argument transformed.
		*
		* @private
		* @param {Function} func The function to wrap.
		* @param {Function} transform The argument transform.
		* @returns {Function} Returns the new function.
		*/
		function overArg(func, transform) {
			return function(arg) {
				return func(transform(arg));
			};
		}
		/**
		* Converts `set` to an array of its values.
		*
		* @private
		* @param {Object} set The set to convert.
		* @returns {Array} Returns the values.
		*/
		function setToArray(set) {
			var index = -1, result = Array(set.size);
			set.forEach(function(value) {
				result[++index] = value;
			});
			return result;
		}
		/** Used for built-in method references. */
		var arrayProto = Array.prototype, funcProto = Function.prototype, objectProto = Object.prototype;
		/** Used to detect overreaching core-js shims. */
		var coreJsData = root["__core-js_shared__"];
		/** Used to detect methods masquerading as native. */
		var maskSrcKey = function() {
			var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
			return uid ? "Symbol(src)_1." + uid : "";
		}();
		/** Used to resolve the decompiled source of functions. */
		var funcToString = funcProto.toString;
		/** Used to check objects for own properties. */
		var hasOwnProperty = objectProto.hasOwnProperty;
		/**
		* Used to resolve the
		* [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
		* of values.
		*/
		var objectToString = objectProto.toString;
		/** Used to detect if a method is native. */
		var reIsNative = RegExp("^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$");
		/** Built-in value references. */
		var Buffer = moduleExports ? root.Buffer : void 0, Symbol = root.Symbol, Uint8Array = root.Uint8Array, getPrototype = overArg(Object.getPrototypeOf, Object), objectCreate = Object.create, propertyIsEnumerable = objectProto.propertyIsEnumerable, splice = arrayProto.splice;
		var nativeGetSymbols = Object.getOwnPropertySymbols, nativeIsBuffer = Buffer ? Buffer.isBuffer : void 0, nativeKeys = overArg(Object.keys, Object);
		var DataView = getNative(root, "DataView"), Map = getNative(root, "Map"), Promise = getNative(root, "Promise"), Set = getNative(root, "Set"), WeakMap = getNative(root, "WeakMap"), nativeCreate = getNative(Object, "create");
		/** Used to detect maps, sets, and weakmaps. */
		var dataViewCtorString = toSource(DataView), mapCtorString = toSource(Map), promiseCtorString = toSource(Promise), setCtorString = toSource(Set), weakMapCtorString = toSource(WeakMap);
		/** Used to convert symbols to primitives and strings. */
		var symbolProto = Symbol ? Symbol.prototype : void 0, symbolValueOf = symbolProto ? symbolProto.valueOf : void 0;
		/**
		* Creates a hash object.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function Hash(entries) {
			var index = -1, length = entries ? entries.length : 0;
			this.clear();
			while (++index < length) {
				var entry = entries[index];
				this.set(entry[0], entry[1]);
			}
		}
		/**
		* Removes all key-value entries from the hash.
		*
		* @private
		* @name clear
		* @memberOf Hash
		*/
		function hashClear() {
			this.__data__ = nativeCreate ? nativeCreate(null) : {};
		}
		/**
		* Removes `key` and its value from the hash.
		*
		* @private
		* @name delete
		* @memberOf Hash
		* @param {Object} hash The hash to modify.
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function hashDelete(key) {
			return this.has(key) && delete this.__data__[key];
		}
		/**
		* Gets the hash value for `key`.
		*
		* @private
		* @name get
		* @memberOf Hash
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function hashGet(key) {
			var data = this.__data__;
			if (nativeCreate) {
				var result = data[key];
				return result === HASH_UNDEFINED ? void 0 : result;
			}
			return hasOwnProperty.call(data, key) ? data[key] : void 0;
		}
		/**
		* Checks if a hash value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf Hash
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function hashHas(key) {
			var data = this.__data__;
			return nativeCreate ? data[key] !== void 0 : hasOwnProperty.call(data, key);
		}
		/**
		* Sets the hash `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf Hash
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the hash instance.
		*/
		function hashSet(key, value) {
			var data = this.__data__;
			data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
			return this;
		}
		Hash.prototype.clear = hashClear;
		Hash.prototype["delete"] = hashDelete;
		Hash.prototype.get = hashGet;
		Hash.prototype.has = hashHas;
		Hash.prototype.set = hashSet;
		/**
		* Creates an list cache object.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function ListCache(entries) {
			var index = -1, length = entries ? entries.length : 0;
			this.clear();
			while (++index < length) {
				var entry = entries[index];
				this.set(entry[0], entry[1]);
			}
		}
		/**
		* Removes all key-value entries from the list cache.
		*
		* @private
		* @name clear
		* @memberOf ListCache
		*/
		function listCacheClear() {
			this.__data__ = [];
		}
		/**
		* Removes `key` and its value from the list cache.
		*
		* @private
		* @name delete
		* @memberOf ListCache
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function listCacheDelete(key) {
			var data = this.__data__, index = assocIndexOf(data, key);
			if (index < 0) return false;
			if (index == data.length - 1) data.pop();
			else splice.call(data, index, 1);
			return true;
		}
		/**
		* Gets the list cache value for `key`.
		*
		* @private
		* @name get
		* @memberOf ListCache
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function listCacheGet(key) {
			var data = this.__data__, index = assocIndexOf(data, key);
			return index < 0 ? void 0 : data[index][1];
		}
		/**
		* Checks if a list cache value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf ListCache
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function listCacheHas(key) {
			return assocIndexOf(this.__data__, key) > -1;
		}
		/**
		* Sets the list cache `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf ListCache
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the list cache instance.
		*/
		function listCacheSet(key, value) {
			var data = this.__data__, index = assocIndexOf(data, key);
			if (index < 0) data.push([key, value]);
			else data[index][1] = value;
			return this;
		}
		ListCache.prototype.clear = listCacheClear;
		ListCache.prototype["delete"] = listCacheDelete;
		ListCache.prototype.get = listCacheGet;
		ListCache.prototype.has = listCacheHas;
		ListCache.prototype.set = listCacheSet;
		/**
		* Creates a map cache object to store key-value pairs.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function MapCache(entries) {
			var index = -1, length = entries ? entries.length : 0;
			this.clear();
			while (++index < length) {
				var entry = entries[index];
				this.set(entry[0], entry[1]);
			}
		}
		/**
		* Removes all key-value entries from the map.
		*
		* @private
		* @name clear
		* @memberOf MapCache
		*/
		function mapCacheClear() {
			this.__data__ = {
				"hash": new Hash(),
				"map": new (Map || ListCache)(),
				"string": new Hash()
			};
		}
		/**
		* Removes `key` and its value from the map.
		*
		* @private
		* @name delete
		* @memberOf MapCache
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function mapCacheDelete(key) {
			return getMapData(this, key)["delete"](key);
		}
		/**
		* Gets the map value for `key`.
		*
		* @private
		* @name get
		* @memberOf MapCache
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function mapCacheGet(key) {
			return getMapData(this, key).get(key);
		}
		/**
		* Checks if a map value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf MapCache
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function mapCacheHas(key) {
			return getMapData(this, key).has(key);
		}
		/**
		* Sets the map `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf MapCache
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the map cache instance.
		*/
		function mapCacheSet(key, value) {
			getMapData(this, key).set(key, value);
			return this;
		}
		MapCache.prototype.clear = mapCacheClear;
		MapCache.prototype["delete"] = mapCacheDelete;
		MapCache.prototype.get = mapCacheGet;
		MapCache.prototype.has = mapCacheHas;
		MapCache.prototype.set = mapCacheSet;
		/**
		* Creates a stack cache object to store key-value pairs.
		*
		* @private
		* @constructor
		* @param {Array} [entries] The key-value pairs to cache.
		*/
		function Stack(entries) {
			this.__data__ = new ListCache(entries);
		}
		/**
		* Removes all key-value entries from the stack.
		*
		* @private
		* @name clear
		* @memberOf Stack
		*/
		function stackClear() {
			this.__data__ = new ListCache();
		}
		/**
		* Removes `key` and its value from the stack.
		*
		* @private
		* @name delete
		* @memberOf Stack
		* @param {string} key The key of the value to remove.
		* @returns {boolean} Returns `true` if the entry was removed, else `false`.
		*/
		function stackDelete(key) {
			return this.__data__["delete"](key);
		}
		/**
		* Gets the stack value for `key`.
		*
		* @private
		* @name get
		* @memberOf Stack
		* @param {string} key The key of the value to get.
		* @returns {*} Returns the entry value.
		*/
		function stackGet(key) {
			return this.__data__.get(key);
		}
		/**
		* Checks if a stack value for `key` exists.
		*
		* @private
		* @name has
		* @memberOf Stack
		* @param {string} key The key of the entry to check.
		* @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
		*/
		function stackHas(key) {
			return this.__data__.has(key);
		}
		/**
		* Sets the stack `key` to `value`.
		*
		* @private
		* @name set
		* @memberOf Stack
		* @param {string} key The key of the value to set.
		* @param {*} value The value to set.
		* @returns {Object} Returns the stack cache instance.
		*/
		function stackSet(key, value) {
			var cache = this.__data__;
			if (cache instanceof ListCache) {
				var pairs = cache.__data__;
				if (!Map || pairs.length < LARGE_ARRAY_SIZE - 1) {
					pairs.push([key, value]);
					return this;
				}
				cache = this.__data__ = new MapCache(pairs);
			}
			cache.set(key, value);
			return this;
		}
		Stack.prototype.clear = stackClear;
		Stack.prototype["delete"] = stackDelete;
		Stack.prototype.get = stackGet;
		Stack.prototype.has = stackHas;
		Stack.prototype.set = stackSet;
		/**
		* Creates an array of the enumerable property names of the array-like `value`.
		*
		* @private
		* @param {*} value The value to query.
		* @param {boolean} inherited Specify returning inherited property names.
		* @returns {Array} Returns the array of property names.
		*/
		function arrayLikeKeys(value, inherited) {
			var result = isArray(value) || isArguments(value) ? baseTimes(value.length, String) : [];
			var length = result.length, skipIndexes = !!length;
			for (var key in value) if ((inherited || hasOwnProperty.call(value, key)) && !(skipIndexes && (key == "length" || isIndex(key, length)))) result.push(key);
			return result;
		}
		/**
		* Assigns `value` to `key` of `object` if the existing value is not equivalent
		* using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
		* for equality comparisons.
		*
		* @private
		* @param {Object} object The object to modify.
		* @param {string} key The key of the property to assign.
		* @param {*} value The value to assign.
		*/
		function assignValue(object, key, value) {
			var objValue = object[key];
			if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) || value === void 0 && !(key in object)) object[key] = value;
		}
		/**
		* Gets the index at which the `key` is found in `array` of key-value pairs.
		*
		* @private
		* @param {Array} array The array to inspect.
		* @param {*} key The key to search for.
		* @returns {number} Returns the index of the matched value, else `-1`.
		*/
		function assocIndexOf(array, key) {
			var length = array.length;
			while (length--) if (eq(array[length][0], key)) return length;
			return -1;
		}
		/**
		* The base implementation of `_.assign` without support for multiple sources
		* or `customizer` functions.
		*
		* @private
		* @param {Object} object The destination object.
		* @param {Object} source The source object.
		* @returns {Object} Returns `object`.
		*/
		function baseAssign(object, source) {
			return object && copyObject(source, keys(source), object);
		}
		/**
		* The base implementation of `_.clone` and `_.cloneDeep` which tracks
		* traversed objects.
		*
		* @private
		* @param {*} value The value to clone.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @param {boolean} [isFull] Specify a clone including symbols.
		* @param {Function} [customizer] The function to customize cloning.
		* @param {string} [key] The key of `value`.
		* @param {Object} [object] The parent object of `value`.
		* @param {Object} [stack] Tracks traversed objects and their clone counterparts.
		* @returns {*} Returns the cloned value.
		*/
		function baseClone(value, isDeep, isFull, customizer, key, object, stack) {
			var result;
			if (customizer) result = object ? customizer(value, key, object, stack) : customizer(value);
			if (result !== void 0) return result;
			if (!isObject(value)) return value;
			var isArr = isArray(value);
			if (isArr) {
				result = initCloneArray(value);
				if (!isDeep) return copyArray(value, result);
			} else {
				var tag = getTag(value), isFunc = tag == funcTag || tag == genTag;
				if (isBuffer(value)) return cloneBuffer(value, isDeep);
				if (tag == objectTag || tag == argsTag || isFunc && !object) {
					if (isHostObject(value)) return object ? value : {};
					result = initCloneObject(isFunc ? {} : value);
					if (!isDeep) return copySymbols(value, baseAssign(result, value));
				} else {
					if (!cloneableTags[tag]) return object ? value : {};
					result = initCloneByTag(value, tag, baseClone, isDeep);
				}
			}
			stack || (stack = new Stack());
			var stacked = stack.get(value);
			if (stacked) return stacked;
			stack.set(value, result);
			if (!isArr) var props = isFull ? getAllKeys(value) : keys(value);
			arrayEach(props || value, function(subValue, key) {
				if (props) {
					key = subValue;
					subValue = value[key];
				}
				assignValue(result, key, baseClone(subValue, isDeep, isFull, customizer, key, value, stack));
			});
			return result;
		}
		/**
		* The base implementation of `_.create` without support for assigning
		* properties to the created object.
		*
		* @private
		* @param {Object} prototype The object to inherit from.
		* @returns {Object} Returns the new object.
		*/
		function baseCreate(proto) {
			return isObject(proto) ? objectCreate(proto) : {};
		}
		/**
		* The base implementation of `getAllKeys` and `getAllKeysIn` which uses
		* `keysFunc` and `symbolsFunc` to get the enumerable property names and
		* symbols of `object`.
		*
		* @private
		* @param {Object} object The object to query.
		* @param {Function} keysFunc The function to get the keys of `object`.
		* @param {Function} symbolsFunc The function to get the symbols of `object`.
		* @returns {Array} Returns the array of property names and symbols.
		*/
		function baseGetAllKeys(object, keysFunc, symbolsFunc) {
			var result = keysFunc(object);
			return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
		}
		/**
		* The base implementation of `getTag`.
		*
		* @private
		* @param {*} value The value to query.
		* @returns {string} Returns the `toStringTag`.
		*/
		function baseGetTag(value) {
			return objectToString.call(value);
		}
		/**
		* The base implementation of `_.isNative` without bad shim checks.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a native function,
		*  else `false`.
		*/
		function baseIsNative(value) {
			if (!isObject(value) || isMasked(value)) return false;
			return (isFunction(value) || isHostObject(value) ? reIsNative : reIsHostCtor).test(toSource(value));
		}
		/**
		* The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
		*
		* @private
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of property names.
		*/
		function baseKeys(object) {
			if (!isPrototype(object)) return nativeKeys(object);
			var result = [];
			for (var key in Object(object)) if (hasOwnProperty.call(object, key) && key != "constructor") result.push(key);
			return result;
		}
		/**
		* Creates a clone of  `buffer`.
		*
		* @private
		* @param {Buffer} buffer The buffer to clone.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Buffer} Returns the cloned buffer.
		*/
		function cloneBuffer(buffer, isDeep) {
			if (isDeep) return buffer.slice();
			var result = new buffer.constructor(buffer.length);
			buffer.copy(result);
			return result;
		}
		/**
		* Creates a clone of `arrayBuffer`.
		*
		* @private
		* @param {ArrayBuffer} arrayBuffer The array buffer to clone.
		* @returns {ArrayBuffer} Returns the cloned array buffer.
		*/
		function cloneArrayBuffer(arrayBuffer) {
			var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
			new Uint8Array(result).set(new Uint8Array(arrayBuffer));
			return result;
		}
		/**
		* Creates a clone of `dataView`.
		*
		* @private
		* @param {Object} dataView The data view to clone.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Object} Returns the cloned data view.
		*/
		function cloneDataView(dataView, isDeep) {
			var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
			return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
		}
		/**
		* Creates a clone of `map`.
		*
		* @private
		* @param {Object} map The map to clone.
		* @param {Function} cloneFunc The function to clone values.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Object} Returns the cloned map.
		*/
		function cloneMap(map, isDeep, cloneFunc) {
			return arrayReduce(isDeep ? cloneFunc(mapToArray(map), true) : mapToArray(map), addMapEntry, new map.constructor());
		}
		/**
		* Creates a clone of `regexp`.
		*
		* @private
		* @param {Object} regexp The regexp to clone.
		* @returns {Object} Returns the cloned regexp.
		*/
		function cloneRegExp(regexp) {
			var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
			result.lastIndex = regexp.lastIndex;
			return result;
		}
		/**
		* Creates a clone of `set`.
		*
		* @private
		* @param {Object} set The set to clone.
		* @param {Function} cloneFunc The function to clone values.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Object} Returns the cloned set.
		*/
		function cloneSet(set, isDeep, cloneFunc) {
			return arrayReduce(isDeep ? cloneFunc(setToArray(set), true) : setToArray(set), addSetEntry, new set.constructor());
		}
		/**
		* Creates a clone of the `symbol` object.
		*
		* @private
		* @param {Object} symbol The symbol object to clone.
		* @returns {Object} Returns the cloned symbol object.
		*/
		function cloneSymbol(symbol) {
			return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
		}
		/**
		* Creates a clone of `typedArray`.
		*
		* @private
		* @param {Object} typedArray The typed array to clone.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Object} Returns the cloned typed array.
		*/
		function cloneTypedArray(typedArray, isDeep) {
			var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
			return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
		}
		/**
		* Copies the values of `source` to `array`.
		*
		* @private
		* @param {Array} source The array to copy values from.
		* @param {Array} [array=[]] The array to copy values to.
		* @returns {Array} Returns `array`.
		*/
		function copyArray(source, array) {
			var index = -1, length = source.length;
			array || (array = Array(length));
			while (++index < length) array[index] = source[index];
			return array;
		}
		/**
		* Copies properties of `source` to `object`.
		*
		* @private
		* @param {Object} source The object to copy properties from.
		* @param {Array} props The property identifiers to copy.
		* @param {Object} [object={}] The object to copy properties to.
		* @param {Function} [customizer] The function to customize copied values.
		* @returns {Object} Returns `object`.
		*/
		function copyObject(source, props, object, customizer) {
			object || (object = {});
			var index = -1, length = props.length;
			while (++index < length) {
				var key = props[index];
				var newValue = customizer ? customizer(object[key], source[key], key, object, source) : void 0;
				assignValue(object, key, newValue === void 0 ? source[key] : newValue);
			}
			return object;
		}
		/**
		* Copies own symbol properties of `source` to `object`.
		*
		* @private
		* @param {Object} source The object to copy symbols from.
		* @param {Object} [object={}] The object to copy symbols to.
		* @returns {Object} Returns `object`.
		*/
		function copySymbols(source, object) {
			return copyObject(source, getSymbols(source), object);
		}
		/**
		* Creates an array of own enumerable property names and symbols of `object`.
		*
		* @private
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of property names and symbols.
		*/
		function getAllKeys(object) {
			return baseGetAllKeys(object, keys, getSymbols);
		}
		/**
		* Gets the data for `map`.
		*
		* @private
		* @param {Object} map The map to query.
		* @param {string} key The reference key.
		* @returns {*} Returns the map data.
		*/
		function getMapData(map, key) {
			var data = map.__data__;
			return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
		}
		/**
		* Gets the native function at `key` of `object`.
		*
		* @private
		* @param {Object} object The object to query.
		* @param {string} key The key of the method to get.
		* @returns {*} Returns the function if it's native, else `undefined`.
		*/
		function getNative(object, key) {
			var value = getValue(object, key);
			return baseIsNative(value) ? value : void 0;
		}
		/**
		* Creates an array of the own enumerable symbol properties of `object`.
		*
		* @private
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of symbols.
		*/
		var getSymbols = nativeGetSymbols ? overArg(nativeGetSymbols, Object) : stubArray;
		/**
		* Gets the `toStringTag` of `value`.
		*
		* @private
		* @param {*} value The value to query.
		* @returns {string} Returns the `toStringTag`.
		*/
		var getTag = baseGetTag;
		if (DataView && getTag(new DataView(/* @__PURE__ */ new ArrayBuffer(1))) != dataViewTag || Map && getTag(new Map()) != mapTag || Promise && getTag(Promise.resolve()) != promiseTag || Set && getTag(new Set()) != setTag || WeakMap && getTag(new WeakMap()) != weakMapTag) getTag = function(value) {
			var result = objectToString.call(value), Ctor = result == objectTag ? value.constructor : void 0, ctorString = Ctor ? toSource(Ctor) : void 0;
			if (ctorString) switch (ctorString) {
				case dataViewCtorString: return dataViewTag;
				case mapCtorString: return mapTag;
				case promiseCtorString: return promiseTag;
				case setCtorString: return setTag;
				case weakMapCtorString: return weakMapTag;
			}
			return result;
		};
		/**
		* Initializes an array clone.
		*
		* @private
		* @param {Array} array The array to clone.
		* @returns {Array} Returns the initialized clone.
		*/
		function initCloneArray(array) {
			var length = array.length, result = array.constructor(length);
			if (length && typeof array[0] == "string" && hasOwnProperty.call(array, "index")) {
				result.index = array.index;
				result.input = array.input;
			}
			return result;
		}
		/**
		* Initializes an object clone.
		*
		* @private
		* @param {Object} object The object to clone.
		* @returns {Object} Returns the initialized clone.
		*/
		function initCloneObject(object) {
			return typeof object.constructor == "function" && !isPrototype(object) ? baseCreate(getPrototype(object)) : {};
		}
		/**
		* Initializes an object clone based on its `toStringTag`.
		*
		* **Note:** This function only supports cloning values with tags of
		* `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
		*
		* @private
		* @param {Object} object The object to clone.
		* @param {string} tag The `toStringTag` of the object to clone.
		* @param {Function} cloneFunc The function to clone values.
		* @param {boolean} [isDeep] Specify a deep clone.
		* @returns {Object} Returns the initialized clone.
		*/
		function initCloneByTag(object, tag, cloneFunc, isDeep) {
			var Ctor = object.constructor;
			switch (tag) {
				case arrayBufferTag: return cloneArrayBuffer(object);
				case boolTag:
				case dateTag: return new Ctor(+object);
				case dataViewTag: return cloneDataView(object, isDeep);
				case float32Tag:
				case float64Tag:
				case int8Tag:
				case int16Tag:
				case int32Tag:
				case uint8Tag:
				case uint8ClampedTag:
				case uint16Tag:
				case uint32Tag: return cloneTypedArray(object, isDeep);
				case mapTag: return cloneMap(object, isDeep, cloneFunc);
				case numberTag:
				case stringTag: return new Ctor(object);
				case regexpTag: return cloneRegExp(object);
				case setTag: return cloneSet(object, isDeep, cloneFunc);
				case symbolTag: return cloneSymbol(object);
			}
		}
		/**
		* Checks if `value` is a valid array-like index.
		*
		* @private
		* @param {*} value The value to check.
		* @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
		* @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
		*/
		function isIndex(value, length) {
			length = length == null ? MAX_SAFE_INTEGER : length;
			return !!length && (typeof value == "number" || reIsUint.test(value)) && value > -1 && value % 1 == 0 && value < length;
		}
		/**
		* Checks if `value` is suitable for use as unique object key.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is suitable, else `false`.
		*/
		function isKeyable(value) {
			var type = typeof value;
			return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
		}
		/**
		* Checks if `func` has its source masked.
		*
		* @private
		* @param {Function} func The function to check.
		* @returns {boolean} Returns `true` if `func` is masked, else `false`.
		*/
		function isMasked(func) {
			return !!maskSrcKey && maskSrcKey in func;
		}
		/**
		* Checks if `value` is likely a prototype object.
		*
		* @private
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
		*/
		function isPrototype(value) {
			var Ctor = value && value.constructor;
			return value === (typeof Ctor == "function" && Ctor.prototype || objectProto);
		}
		/**
		* Converts `func` to its source code.
		*
		* @private
		* @param {Function} func The function to process.
		* @returns {string} Returns the source code.
		*/
		function toSource(func) {
			if (func != null) {
				try {
					return funcToString.call(func);
				} catch (e) {}
				try {
					return func + "";
				} catch (e) {}
			}
			return "";
		}
		/**
		* This method is like `_.clone` except that it recursively clones `value`.
		*
		* @static
		* @memberOf _
		* @since 1.0.0
		* @category Lang
		* @param {*} value The value to recursively clone.
		* @returns {*} Returns the deep cloned value.
		* @see _.clone
		* @example
		*
		* var objects = [{ 'a': 1 }, { 'b': 2 }];
		*
		* var deep = _.cloneDeep(objects);
		* console.log(deep[0] === objects[0]);
		* // => false
		*/
		function cloneDeep(value) {
			return baseClone(value, true, true);
		}
		/**
		* Performs a
		* [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
		* comparison between two values to determine if they are equivalent.
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to compare.
		* @param {*} other The other value to compare.
		* @returns {boolean} Returns `true` if the values are equivalent, else `false`.
		* @example
		*
		* var object = { 'a': 1 };
		* var other = { 'a': 1 };
		*
		* _.eq(object, object);
		* // => true
		*
		* _.eq(object, other);
		* // => false
		*
		* _.eq('a', 'a');
		* // => true
		*
		* _.eq('a', Object('a'));
		* // => false
		*
		* _.eq(NaN, NaN);
		* // => true
		*/
		function eq(value, other) {
			return value === other || value !== value && other !== other;
		}
		/**
		* Checks if `value` is likely an `arguments` object.
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an `arguments` object,
		*  else `false`.
		* @example
		*
		* _.isArguments(function() { return arguments; }());
		* // => true
		*
		* _.isArguments([1, 2, 3]);
		* // => false
		*/
		function isArguments(value) {
			return isArrayLikeObject(value) && hasOwnProperty.call(value, "callee") && (!propertyIsEnumerable.call(value, "callee") || objectToString.call(value) == argsTag);
		}
		/**
		* Checks if `value` is classified as an `Array` object.
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an array, else `false`.
		* @example
		*
		* _.isArray([1, 2, 3]);
		* // => true
		*
		* _.isArray(document.body.children);
		* // => false
		*
		* _.isArray('abc');
		* // => false
		*
		* _.isArray(_.noop);
		* // => false
		*/
		var isArray = Array.isArray;
		/**
		* Checks if `value` is array-like. A value is considered array-like if it's
		* not a function and has a `value.length` that's an integer greater than or
		* equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is array-like, else `false`.
		* @example
		*
		* _.isArrayLike([1, 2, 3]);
		* // => true
		*
		* _.isArrayLike(document.body.children);
		* // => true
		*
		* _.isArrayLike('abc');
		* // => true
		*
		* _.isArrayLike(_.noop);
		* // => false
		*/
		function isArrayLike(value) {
			return value != null && isLength(value.length) && !isFunction(value);
		}
		/**
		* This method is like `_.isArrayLike` except that it also checks if `value`
		* is an object.
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an array-like object,
		*  else `false`.
		* @example
		*
		* _.isArrayLikeObject([1, 2, 3]);
		* // => true
		*
		* _.isArrayLikeObject(document.body.children);
		* // => true
		*
		* _.isArrayLikeObject('abc');
		* // => false
		*
		* _.isArrayLikeObject(_.noop);
		* // => false
		*/
		function isArrayLikeObject(value) {
			return isObjectLike(value) && isArrayLike(value);
		}
		/**
		* Checks if `value` is a buffer.
		*
		* @static
		* @memberOf _
		* @since 4.3.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
		* @example
		*
		* _.isBuffer(new Buffer(2));
		* // => true
		*
		* _.isBuffer(new Uint8Array(2));
		* // => false
		*/
		var isBuffer = nativeIsBuffer || stubFalse;
		/**
		* Checks if `value` is classified as a `Function` object.
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a function, else `false`.
		* @example
		*
		* _.isFunction(_);
		* // => true
		*
		* _.isFunction(/abc/);
		* // => false
		*/
		function isFunction(value) {
			var tag = isObject(value) ? objectToString.call(value) : "";
			return tag == funcTag || tag == genTag;
		}
		/**
		* Checks if `value` is a valid array-like length.
		*
		* **Note:** This method is loosely based on
		* [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
		* @example
		*
		* _.isLength(3);
		* // => true
		*
		* _.isLength(Number.MIN_VALUE);
		* // => false
		*
		* _.isLength(Infinity);
		* // => false
		*
		* _.isLength('3');
		* // => false
		*/
		function isLength(value) {
			return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
		}
		/**
		* Checks if `value` is the
		* [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
		* of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
		*
		* @static
		* @memberOf _
		* @since 0.1.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is an object, else `false`.
		* @example
		*
		* _.isObject({});
		* // => true
		*
		* _.isObject([1, 2, 3]);
		* // => true
		*
		* _.isObject(_.noop);
		* // => true
		*
		* _.isObject(null);
		* // => false
		*/
		function isObject(value) {
			var type = typeof value;
			return !!value && (type == "object" || type == "function");
		}
		/**
		* Checks if `value` is object-like. A value is object-like if it's not `null`
		* and has a `typeof` result of "object".
		*
		* @static
		* @memberOf _
		* @since 4.0.0
		* @category Lang
		* @param {*} value The value to check.
		* @returns {boolean} Returns `true` if `value` is object-like, else `false`.
		* @example
		*
		* _.isObjectLike({});
		* // => true
		*
		* _.isObjectLike([1, 2, 3]);
		* // => true
		*
		* _.isObjectLike(_.noop);
		* // => false
		*
		* _.isObjectLike(null);
		* // => false
		*/
		function isObjectLike(value) {
			return !!value && typeof value == "object";
		}
		/**
		* Creates an array of the own enumerable property names of `object`.
		*
		* **Note:** Non-object values are coerced to objects. See the
		* [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
		* for more details.
		*
		* @static
		* @since 0.1.0
		* @memberOf _
		* @category Object
		* @param {Object} object The object to query.
		* @returns {Array} Returns the array of property names.
		* @example
		*
		* function Foo() {
		*   this.a = 1;
		*   this.b = 2;
		* }
		*
		* Foo.prototype.c = 3;
		*
		* _.keys(new Foo);
		* // => ['a', 'b'] (iteration order is not guaranteed)
		*
		* _.keys('hi');
		* // => ['0', '1']
		*/
		function keys(object) {
			return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
		}
		/**
		* This method returns a new empty array.
		*
		* @static
		* @memberOf _
		* @since 4.13.0
		* @category Util
		* @returns {Array} Returns the new empty array.
		* @example
		*
		* var arrays = _.times(2, _.stubArray);
		*
		* console.log(arrays);
		* // => [[], []]
		*
		* console.log(arrays[0] === arrays[1]);
		* // => false
		*/
		function stubArray() {
			return [];
		}
		/**
		* This method returns `false`.
		*
		* @static
		* @memberOf _
		* @since 4.13.0
		* @category Util
		* @returns {boolean} Returns `false`.
		* @example
		*
		* _.times(2, _.stubFalse);
		* // => [false, false]
		*/
		function stubFalse() {
			return false;
		}
		module.exports = cloneDeep;
	},
	9025(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { k: () => assign });
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		var assign = function assign(obj1) {
			for (var _len = arguments.length, objs = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) objs[_key - 1] = arguments[_key];
			if (Object.assign) return Object.assign.apply(Object, [obj1].concat(objs));
			for (var i = 0; i < objs.length; i++) assignOne(obj1, objs[i]);
			return obj1;
		};
		var assignOne = function assignOne(obj1, obj2) {
			for (var k in obj2) if (_objectHasOwn(obj2, k)) obj1[k] = obj2[k];
			return obj1;
		};
	},
	9061(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			E0: () => unbindAllInNamespace,
			Nw: () => unbind,
			RX: () => bindNamed,
			_Z: () => unbindNamed,
			hZ: () => trigger,
			oI: () => bind
		});
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5509);
		var _objectHasOwn = function(object, property) {
			if (typeof object === "undefined" || object === null) throw new TypeError("Cannot convert undefined or null to object");
			return Object.prototype.hasOwnProperty.call(Object(object), property);
		};
		function _toConsumableArray(r) {
			return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
		}
		function _nonIterableSpread() {
			throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _iterableToArray(r) {
			if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
		}
		function _arrayWithoutHoles(r) {
			if (Array.isArray(r)) return _arrayLikeToArray(r);
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		var aps = Array.prototype.slice;
		var bind = function bind(event, fn) {
			var self = this;
			if (!self._bindings) self._bindings = {};
			if (!self._bindings[event]) self._bindings[event] = [];
			self._bindings[event].push(fn);
			return function() {
				self.unbind(event, fn);
			};
		};
		var unbind = function unbind(event, fn) {
			if (!this._bindings) return this;
			if (!this._bindings[event]) return this;
			var bindings = [];
			for (var i = 0; i < this._bindings[event].length; i++) {
				var boundFn = this._bindings[event][i];
				if (boundFn !== fn) bindings.push(boundFn);
			}
			this._bindings[event] = bindings;
		};
		var rebind = function rebind(event, fn) {
			this.unbind(event, fn);
			this.bind(event, fn);
			return {
				event,
				fn
			};
		};
		var trigger = function trigger(event) {
			for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) args[_key - 1] = arguments[_key];
			if (this._bindings && this._bindings.all != null) triggerImpl.apply(this, ["all", event].concat(args));
			return triggerImpl.apply(this, [event].concat(args));
		};
		var triggerImpl = function triggerImpl(event) {
			if (!this._bindings) return this;
			if (!this._bindings[event]) return this;
			var args = aps.call(arguments, 1);
			var unbinds;
			var bindings = _toConsumableArray(this._bindings[event]);
			for (var i = 0; i < bindings.length; i++) {
				var fn = bindings[i];
				try {
					if (fn.apply(this, args) === this.unbind) {
						if (unbinds == null) unbinds = [];
						unbinds.push({
							event,
							fn
						});
					}
				} catch (e) {
					if (this._throwTriggerErrors) throw e;
					else if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s.error) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_0__.s.error(e);
				}
			}
			if (unbinds) for (var _i = 0; _i < unbinds.length; _i++) {
				var _unbind = unbinds[_i];
				this.unbind(_unbind.event, _unbind.fn);
			}
			return this;
		};
		var once = function once(event, fn) {
			return bind(event, function wrappedFn() {
				fn.apply(this, aps.call(arguments, 0));
				return unbind;
			});
		};
		var initNamespace = function initNamespace(ctx, namespace) {
			if (ctx._namedBindings == null) ctx._namedBindings = {};
			if (ctx._namedBindings[namespace] == null) ctx._namedBindings[namespace] = {};
		};
		var getNamedBinding = function getNamedBinding(ctx, namespace, fnKey) {
			initNamespace(ctx, namespace);
			return ctx._namedBindings[namespace][fnKey];
		};
		var setNamedBinding = function setNamedBinding(ctx, namespace, fnKey, event, fn) {
			initNamespace(ctx, namespace);
			ctx._namedBindings[namespace][fnKey] = {
				event,
				fn
			};
		};
		var bindNamed = function bindNamed(namespace, fnKey, event, fn) {
			this.unbindNamed(namespace, fnKey);
			setNamedBinding(this, namespace, fnKey, event, fn);
			this.bind(event, fn);
			return function() {
				this.unbindNamed(namespace, fnKey);
			};
		};
		var unbindNamed = function unbindNamed(namespace, fnKey) {
			initNamespace(this, namespace);
			var entry = getNamedBinding(this, namespace, fnKey);
			if (entry) {
				var event = entry.event, fn = entry.fn;
				this.unbind(event, fn);
			}
			var namedBindings = this._namedBindings;
			delete namedBindings[namespace][fnKey];
			if (isEmpty(namedBindings[namespace])) delete namedBindings[namespace];
			return this;
		};
		var unbindAllInNamespace = function unbindAllInNamespace(namespace) {
			var bindings = this._namedBindings && this._namedBindings[namespace];
			if (bindings == null) return this;
			for (var fnKey in bindings) if (_objectHasOwn(bindings, fnKey)) this.unbindNamed(namespace, fnKey);
		};
		var isEmpty = function isEmpty(obj) {
			for (var k in obj) if (_objectHasOwn(obj, k)) return false;
			return true;
		};
		(function bindify(prototype) {
			prototype.bind = bind;
			prototype.unbind = unbind;
			prototype.on = bind;
			prototype.off = unbind;
			prototype.rebind = rebind;
			prototype.trigger = trigger;
			prototype.bindNamed = bindNamed;
			prototype.unbindNamed = unbindNamed;
			prototype.unbindAllInNamespace = unbindAllInNamespace;
			return prototype;
		})(function Bindings() {}.prototype);
	},
	9128(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { a: () => normalizeChapters });
		var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9814);
		var normalizeChapters = function normalizeChapters(embedOptions) {
			var plugin = embedOptions.plugin, chaptersOn = embedOptions.chaptersOn, chapterList = embedOptions.chapterList;
			if (plugin !== null && plugin !== void 0 && plugin.chapters) return plugin.chapters;
			var areChaptersOn = chaptersOn === true || chaptersOn === "true";
			if ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(chapterList) || areChaptersOn) return {
				on: chaptersOn,
				chapterList: (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_0__.n9)(chapterList) && chapterList.length > 0 ? chapterList : []
			};
		};
	},
	9376(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { R: () => makeWbindable });
		var utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9061);
		var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(5509);
		var _eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(2694);
		if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.bindable) {
			if (!_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager = {};
			_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.bindable = {
				bind: function bind(event, callback) {
					if (event === "crosstime" && this.crossTime) {
						this.crossTime.addBinding(arguments[1], arguments[2]);
						return this;
					}
					if (event === "betweentimes" && this.betweenTimes) {
						this.betweenTimes.addBinding(arguments[1], arguments[2], arguments[3]);
						return this;
					}
					var embedElement = this.embedElement || this.container;
					if (Object.keys(_eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__.h).includes(event) && embedElement) {
						var id = identifierFromEmbedElement(embedElement);
						if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id] === void 0) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id] = new _eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__.S();
						_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id].addListener(event, embedElement, callback);
						return this;
					}
					if (callback) {
						utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.oI.call(this, event, callback);
						return this;
					}
					if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.warn) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.warn(this.constructor.name, "bind", "falsey value passed in as callback:", callback);
				},
				unbind: function unbind(event, callback) {
					if (event === "crosstime" && this.crossTime) {
						if (!callback) this.crossTime.removeAllBindings();
						else this.crossTime.removeBinding(arguments[1], arguments[2]);
						return this;
					}
					if (event === "betweentimes" && this.betweenTimes) {
						if (!callback) this.betweenTimes.removeAllBindings();
						else this.betweenTimes.removeBinding(arguments[1], arguments[2], arguments[3]);
						return this;
					}
					var embedElement = this.embedElement || this.container;
					if (Object.keys(_eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__.h).includes(event) && embedElement) {
						var id = identifierFromEmbedElement(embedElement);
						if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id] === void 0) return this;
						_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id].removeListener(event, embedElement, callback);
						return this;
					}
					if (callback) utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.Nw.call(this, event, callback);
					else if (this._bindings) this._bindings[event] = [];
					if (this._bindings && this._bindings[event] && !this._bindings[event].length) {
						this._bindings[event] = null;
						delete this._bindings[event];
					}
					return this;
				},
				on: function on(event, fn) {
					var _arguments = arguments, _this = this;
					if (event === "crosstime" && this.crossTime) {
						this.crossTime.addBinding(arguments[1], arguments[2]);
						return function() {
							_this.crossTime.removeBinding(_arguments[1], _arguments[2]);
						};
					}
					if (event === "betweentimes" && this.betweenTimes) {
						this.betweenTimes.addBinding(arguments[1], arguments[2], arguments[3]);
						return function() {
							_this.betweenTimes.removeBinding(_arguments[1], _arguments[2], _arguments[3]);
						};
					}
					var embedElement = this.embedElement || this.container;
					if (Object.keys(_eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__.h).includes(event) && embedElement) {
						var id = identifierFromEmbedElement(embedElement);
						if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id] === void 0) _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id] = new _eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__.S(embedElement);
						_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id].addListener(event, embedElement, fn);
						return function() {
							_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id].removeListener(event, embedElement, fn);
						};
					}
					return utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.oI.call(this, event, fn);
				},
				off: function off(event, fn) {
					if (event === "crosstime" && this.crossTime) return this.crossTime.removeBinding(arguments[1], arguments[2]);
					if (event === "betweentimes" && this.betweenTimes) return this.betweenTimes.removeBinding(arguments[1], arguments[2], arguments[3]);
					var embedElement = this.embedElement || this.container;
					if (Object.keys(_eventShepherd_ts__WEBPACK_IMPORTED_MODULE_2__.h).includes(event) && embedElement) {
						var id = identifierFromEmbedElement(embedElement);
						if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id] === void 0) return function() {};
						return _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.EventShepherdManager[id].removeListener(event, embedElement, fn);
					}
					return utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.Nw.call(this, event, fn);
				},
				rebind: function rebind(event, callback) {
					this.unbind(event, callback);
					this.bind(event, callback);
					return this;
				},
				trigger: function trigger(event) {
					var _bindify$trigger;
					for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) args[_key - 1] = arguments[_key];
					(_bindify$trigger = utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.hZ).call.apply(_bindify$trigger, [this, event].concat(args));
					return this;
				},
				bindNamed: function bindNamed() {
					return utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.RX.apply(this, arguments);
				},
				unbindNamed: function unbindNamed() {
					return utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__._Z.apply(this, arguments);
				},
				unbindAllInNamespace: function unbindAllInNamespace() {
					return utilities_bindify_js__WEBPACK_IMPORTED_MODULE_0__.E0.apply(this, arguments);
				}
			};
		}
		var makeWbindable = function makeWbindable(obj) {
			for (var k in _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.bindable) {
				var v = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_1__.s.bindable[k];
				if (!obj[k]) obj[k] = v;
			}
		};
		var identifierFromEmbedElement = function identifierFromEmbedElement(embedElement) {
			if (embedElement !== null && embedElement !== void 0 && embedElement.mediaId) return embedElement.mediaId;
			if (embedElement !== null && embedElement !== void 0 && embedElement.id) return embedElement.id;
		};
	},
	9392(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { C: () => getWistiaOptions });
		var lodash_merge__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(8089);
		var lodash_merge__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/ __webpack_require__.n(lodash_merge__WEBPACK_IMPORTED_MODULE_0__);
		var getWistiaOptions = function getWistiaOptions(mediaId) {
			var _window$wistiaOptions, _window$wistiaOptions2;
			if (!window.wistiaOptions) return {};
			var globalOptions = (_window$wistiaOptions = window.wistiaOptions._all) !== null && _window$wistiaOptions !== void 0 ? _window$wistiaOptions : {};
			var mediaOptions = (_window$wistiaOptions2 = window.wistiaOptions[mediaId]) !== null && _window$wistiaOptions2 !== void 0 ? _window$wistiaOptions2 : {};
			return lodash_merge__WEBPACK_IMPORTED_MODULE_0___default()(globalOptions, mediaOptions);
		};
	},
	9562(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { R: () => pageLoaded });
		var pageLoaded = function pageLoaded(fn) {
			var timeout = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 4e3;
			var doc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : document;
			var win = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : window;
			if (/loaded|complete/.test(doc.readyState)) setTimeout(fn, 0);
			else {
				var unbind = function unbind() {
					win.removeEventListener("load", onPageLoad, false);
				};
				var onPageLoad = function onPageLoad() {
					clearTimeout(onLoadTimeout);
					unbind();
					fn();
				};
				win.addEventListener("load", onPageLoad, false);
				var onLoadTimeout = setTimeout(function() {
					unbind();
					fn();
				}, timeout);
			}
		};
	},
	9804(__unused_webpack_module, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, { u: () => PreloadThumbnail });
		var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
		var preact_hooks__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3817);
		var _hooks_usePlayerData_tsx__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(2721);
		var _utilities_constants_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(1512);
		var _media_players_vulcanV2Player_shared_ui_components_BigPlayButton_tsx__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(6906);
		var _shared_ProgressiveThumbnail_jsx__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(3164);
		var _shared_translations_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(4730);
		var _utilities_assets_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(7209);
		var _utilities_fit_control_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(4309);
		var _utilities_roundedPlayerDefaults_ts__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(3123);
		var _utilities_gradients_ts__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(4372);
		var _types_gradient_ts__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(7350);
		var _utilities_color_utils_ts__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(998);
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		var MAX_SCALE = 1.3;
		var MIN_SCALE = .3;
		var DEFAULT_LOWER_CUTOFF_WIDTH = 640;
		var DEFAULT_UPPER_CUTOFF_WIDTH = 960;
		var PreloadThumbnail = function PreloadThumbnail(_ref) {
			var _ref2, _ref3, _getGradientColor;
			var isPlayPending = _ref.isPlayPending, mediaId = _ref.mediaId, playerType = _ref.playerType, playerWidth = _ref.playerWidth;
			var _useState2 = _slicedToArray((0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useState)(false), 2), isLoading = _useState2[0], setIsLoading = _useState2[1];
			(0, preact_hooks__WEBPACK_IMPORTED_MODULE_1__.useEffect)(function() {
				if (isPlayPending) setIsLoading(true);
			}, [isPlayPending]);
			var _usePlayerData = (0, _hooks_usePlayerData_tsx__WEBPACK_IMPORTED_MODULE_2__.$)(), embedOptions = _usePlayerData.embedOptions, mediaData = _usePlayerData.mediaData;
			var aspect = embedOptions.aspect, bigPlayButton = embedOptions.bigPlayButton, bpbTime = embedOptions.bpbTime, bigPlayButtonBorderRadius = embedOptions.bigPlayButtonBorderRadius, contrastIcons = embedOptions.contrastIcons, controlBarBorderRadius = embedOptions.controlBarBorderRadius, controlsVisibleOnLoad = embedOptions.controlsVisibleOnLoad, floatingControlBar = embedOptions.floatingControlBar, noMixBlendMode = embedOptions.noMixBlendMode, opaqueControls = embedOptions.opaqueControls, playButton = embedOptions.playButton, playerBorderRadius = embedOptions.playerBorderRadius, playerColor = embedOptions.playerColor, playerColorGradient = embedOptions.playerColorGradient, playerLanguage = embedOptions.playerLanguage, roundedPlayer = embedOptions.roundedPlayer, thumbnailAltText = embedOptions.thumbnailAltText, transparentLetterbox = embedOptions.transparentLetterbox;
			var aspectRatio = mediaData.aspectRatio, assets = mediaData.assets, duration = mediaData.duration, mediaType = mediaData.mediaType, name = mediaData.name;
			var height = playerWidth / ((_ref2 = aspect !== null && aspect !== void 0 ? aspect : aspectRatio) !== null && _ref2 !== void 0 ? _ref2 : _utilities_constants_ts__WEBPACK_IMPORTED_MODULE_3__.R7);
			var scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (0, _utilities_fit_control_js__WEBPACK_IMPORTED_MODULE_8__.wt)(playerWidth, [DEFAULT_LOWER_CUTOFF_WIDTH, DEFAULT_UPPER_CUTOFF_WIDTH])));
			var calculatedControlsVisibleOnLoad = controlsVisibleOnLoad && playerType === "vulcan-v2";
			var defaultControlBarDistance = (0, _utilities_roundedPlayerDefaults_ts__WEBPACK_IMPORTED_MODULE_9__.Ru)({
				controlBarBorderRadius,
				floatingControlBar,
				roundedPlayer
			});
			var calculatedControlBarDistance = calculatedControlsVisibleOnLoad ? (_utilities_constants_ts__WEBPACK_IMPORTED_MODULE_3__.EA / 2 + defaultControlBarDistance) * scale : defaultControlBarDistance * scale;
			var calculatedBigPlayButtonBorderRadius = (0, _utilities_roundedPlayerDefaults_ts__WEBPACK_IMPORTED_MODULE_9__.gl)({
				bigPlayButtonBorderRadius,
				roundedPlayer
			}) * scale;
			var calculatedPlayerBorderRadius = (0, _utilities_roundedPlayerDefaults_ts__WEBPACK_IMPORTED_MODULE_9__.JA)({
				playerBorderRadius,
				roundedPlayer
			}) * scale;
			var backgroundColor = transparentLetterbox === true || calculatedPlayerBorderRadius > 0 ? "transparent" : void 0;
			var thumbnailAssets = (0, _utilities_assets_js__WEBPACK_IMPORTED_MODULE_7__.Q0)(assets, {});
			var calculatedPlayerLanguage = (_ref3 = (0, _shared_translations_js__WEBPACK_IMPORTED_MODULE_6__.Z0)(playerLanguage)) !== null && _ref3 !== void 0 ? _ref3 : (0, _shared_translations_js__WEBPACK_IMPORTED_MODULE_6__.Z0)("en-US");
			var shouldShowBigPlayButton = bigPlayButton !== false && playButton !== false;
			var shouldShowBpbTime = bpbTime === true || bpbTime === "true";
			var backgroundGradientCss = playerColorGradient !== null && playerColorGradient !== void 0 && playerColorGradient.on ? (0, _utilities_gradients_ts__WEBPACK_IMPORTED_MODULE_10__.qN)(playerColorGradient) : void 0;
			var playerColorOrGradientColor = playerColorGradient !== null && playerColorGradient !== void 0 && playerColorGradient.on && (0, _types_gradient_ts__WEBPACK_IMPORTED_MODULE_11__.b)(playerColorGradient) ? (_getGradientColor = (0, _utilities_gradients_ts__WEBPACK_IMPORTED_MODULE_10__.yz)(playerColorGradient)) !== null && _getGradientColor !== void 0 ? _getGradientColor : playerColor : playerColor;
			var handleClick = function handleClick() {
				setIsLoading(true);
			};
			return (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { style: { "--wistia-player-icon-color": (0, _utilities_color_utils_ts__WEBPACK_IMPORTED_MODULE_12__.hu)(playerColor !== null && playerColor !== void 0 ? playerColor : "#636155", contrastIcons !== null && contrastIcons !== void 0 ? contrastIcons : false, (playerColorGradient === null || playerColorGradient === void 0 ? void 0 : playerColorGradient.on) === true) } }, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", {
				class: "w-css-reset",
				style: {
					cursor: "pointer",
					width: "100%",
					height: "".concat(height, "px")
				},
				onClick: handleClick,
				tabIndex: shouldShowBigPlayButton ? -1 : 0
			}, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(_shared_ProgressiveThumbnail_jsx__WEBPACK_IMPORTED_MODULE_5__.E, {
				backgroundColor,
				images: thumbnailAssets,
				isVisible: true,
				hashedId: mediaId,
				playerBorderRadius: calculatedPlayerBorderRadius,
				swatchEnabled: false,
				uiHasRendered: false,
				thumbnailAltText: thumbnailAltText !== null && thumbnailAltText !== void 0 ? thumbnailAltText : "",
				height: "".concat(height, "px")
			})), shouldShowBigPlayButton && (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(_media_players_vulcanV2Player_shared_ui_components_BigPlayButton_tsx__WEBPACK_IMPORTED_MODULE_4__.Fn, {
				borderRadius: calculatedBigPlayButtonBorderRadius,
				buttonTabIndex: 0,
				color: playerColorOrGradientColor,
				controlBarDistance: calculatedControlBarDistance,
				duration: duration !== null && duration !== void 0 ? duration : 0,
				hasContrastIcons: contrastIcons !== null && contrastIcons !== void 0 ? contrastIcons : false,
				isLiveMedia: mediaType === "LiveStream",
				isLoading,
				isOpaque: opaqueControls,
				isVisible: true,
				noMixBlendMode,
				onClick: handleClick,
				playerLanguage: calculatedPlayerLanguage,
				scale,
				showBpbTime: shouldShowBpbTime,
				videoName: name !== null && name !== void 0 ? name : "",
				videoWidth: playerWidth,
				backgroundGradientCss
			}));
		};
	},
	9814(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
		__webpack_require__.d(__webpack_exports__, {
			gD: () => isNil,
			jw: () => isEmptyString,
			n9: () => isNotNil,
			uI: () => isNonEmptyString,
			uu: () => isNonEmptyRecord
		});
		/*
		* @license @wistia/type-guards v0.9.3
		*
		* Copyright (c) 2023-2025, Wistia, Inc. and its affiliates.
		*
		* This source code is unlicensed, all rights reserved.
		*/
		var FALSY_VALUES = [
			false,
			0,
			-0,
			0n,
			"",
			null,
			void 0,
			NaN
		];
		var isNull = (value) => value === null;
		var isNotNull = (value) => !isNull(value);
		var isUndefined = (value) => value === void 0;
		var isNotUndefined = (value) => !isUndefined(value);
		var isNil = (value) => isNull(value) || isUndefined(value);
		var isNotNil = (value) => !isNil(value);
		var isString = (value) => typeof value === "string";
		var isNotString = (value) => !isString(value);
		var isEmptyString = (value) => isString(value) && value === "";
		var isNonEmptyString = (value) => isString(value) && !isEmptyString(value);
		var isNumber = (value) => typeof value === "number";
		var isNotNumber = (value) => !isNumber(value);
		var isNaN = (value) => Number.isNaN(value);
		var isInteger = (value) => Number.isInteger(value);
		var isRecord = (value) => isNotNil(value) && typeof value === "object" && !(value instanceof Array);
		var isNotRecord = (value) => !isRecord(value);
		var isEmptyRecord = (value) => isRecord(value) && Object.keys(value).length === 0;
		var isNonEmptyRecord = (value) => isRecord(value) && Object.keys(value).length > 0;
		var isArray = (value) => isNotNil(value) && typeof value === "object" && value instanceof Array;
		var isNotArray = (value) => !isArray(value);
		var isEmptyArray = (value) => isArray(value) && value.length === 0;
		var isNonEmptyArray = (value) => isArray(value) && value.length > 0;
		var isFunction = (value) => isNotNil(value) && typeof value === "function";
		var isNotFunction = (value) => !isFunction(value);
		var isBoolean = (value) => isNotNil(value) && typeof value === "boolean";
		var isNotBoolean = (value) => !isBoolean(value);
		var isVoid = (value) => value === void 0;
		var isNotVoid = (value) => !isVoid(value);
		var isError = (value) => {
			return isNotNil(value) && value instanceof Error;
		};
		var isFalsy = (value) => FALSY_VALUES.includes(value) || Number.isNaN(value);
		var isTruthy = (value) => !FALSY_VALUES.includes(value) && !Number.isNaN(value);
		var hasKey = (value, key) => isNonEmptyRecord(value) && key in value;
	}
};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
	var cachedModule = __webpack_module_cache__[moduleId];
	if (cachedModule !== void 0) return cachedModule.exports;
	var module = __webpack_module_cache__[moduleId] = {
		id: moduleId,
		loaded: false,
		exports: {}
	};
	__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
	module.loaded = true;
	return module.exports;
}
(() => {
	__webpack_require__.n = (module) => {
		var getter = module && module.__esModule ? () => module["default"] : () => module;
		__webpack_require__.d(getter, { a: getter });
		return getter;
	};
})();
(() => {
	__webpack_require__.d = (exports, definition) => {
		for (var key in definition) if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) Object.defineProperty(exports, key, {
			enumerable: true,
			get: definition[key]
		});
	};
})();
(() => {
	__webpack_require__.g = (function() {
		if (typeof globalThis === "object") return globalThis;
		try {
			return this || new Function("return this")();
		} catch (e) {
			if (typeof window === "object") return window;
		}
	})();
})();
(() => {
	__webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
})();
(() => {
	__webpack_require__.r = (exports) => {
		if (typeof Symbol !== "undefined" && Symbol.toStringTag) Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		Object.defineProperty(exports, "__esModule", { value: true });
	};
})();
(() => {
	__webpack_require__.nmd = (module) => {
		module.paths = [];
		if (!module.children) module.children = [];
		return module;
	};
})();
var __webpack_exports__ = {};
__webpack_require__.d(__webpack_exports__, {
	$: () => WistiaPlayer,
	A: () => wistiaSwatchElement
});
var preact__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5181);
var _wistia_type_guards__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(9814);
var _utilities_gradients_ts__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(4372);
var _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5509);
var _components_PreloadThumbnail_tsx__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(9804);
var _hooks_usePlayerData_tsx__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(2721);
var _utilities_constants_ts__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(1512);
var _utilities_PlayerDataHandler_ts__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(6462);
var _appHostname_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(787);
var _utilities_assets_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(7209);
var _utilities_coinFlip_ts__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(7323);
var _utilities_detect_js__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(7231);
var _utilities_dynamicImport_ts__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(7157);
var _utilities_embedOptionStore_ts__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(3280);
var _utilities_elem_js__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(7715);
var _utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__ = __webpack_require__(2760);
var _utilities_extractEmailFromParams_ts__WEBPACK_IMPORTED_MODULE_16__ = __webpack_require__(3832);
var _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_17__ = __webpack_require__(5857);
var _utilities_inferPageUrl_ts__WEBPACK_IMPORTED_MODULE_18__ = __webpack_require__(5393);
var _utilities_judy_js__WEBPACK_IMPORTED_MODULE_19__ = __webpack_require__(438);
var _utilities_roundedPlayerDefaults_ts__WEBPACK_IMPORTED_MODULE_20__ = __webpack_require__(3123);
var _utilities_runScript_js__WEBPACK_IMPORTED_MODULE_21__ = __webpack_require__(1248);
var _utilities_seqid_js__WEBPACK_IMPORTED_MODULE_22__ = __webpack_require__(1224);
var _utilities_shouldEnableMux_ts__WEBPACK_IMPORTED_MODULE_23__ = __webpack_require__(7211);
var _utilities_simpleMetrics_js__WEBPACK_IMPORTED_MODULE_24__ = __webpack_require__(1161);
var _utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_25__ = __webpack_require__(4755);
var _utilities_url_js__WEBPACK_IMPORTED_MODULE_26__ = __webpack_require__(2671);
var _utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_27__ = __webpack_require__(4997);
var _utilities_wistiaOptions_ts__WEBPACK_IMPORTED_MODULE_28__ = __webpack_require__(9392);
var _utilities_wistiaQueue_ts__WEBPACK_IMPORTED_MODULE_29__ = __webpack_require__(541);
var _utilities_wlog_js__WEBPACK_IMPORTED_MODULE_30__ = __webpack_require__(6637);
var _utilities_injectJsonLd_js__WEBPACK_IMPORTED_MODULE_31__ = __webpack_require__(2147);
var _utilities_getInitialMediaData_ts__WEBPACK_IMPORTED_MODULE_32__ = __webpack_require__(5833);
var _utilities_mediaDataError_ts__WEBPACK_IMPORTED_MODULE_33__ = __webpack_require__(959);
var _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_34__ = __webpack_require__(3411);
var _utilities_camelCaseToKebabCase_ts__WEBPACK_IMPORTED_MODULE_35__ = __webpack_require__(4989);
var _types_gradient_ts__WEBPACK_IMPORTED_MODULE_36__ = __webpack_require__(7350);
var _WistiaPlayer;
function _slicedToArray(r, e) {
	return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _nonIterableRest() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray(r, a) {
	if (r) {
		if ("string" == typeof r) return _arrayLikeToArray(r, a);
		var t = {}.toString.call(r).slice(8, -1);
		return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
	}
}
function _arrayLikeToArray(r, a) {
	(null == a || a > r.length) && (a = r.length);
	for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
	return n;
}
function _iterableToArrayLimit(r, l) {
	var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
	if (null != t) {
		var e, n, i, u, a = [], f = !0, o = !1;
		try {
			if (i = (t = t.call(r)).next, 0 === l) {
				if (Object(t) !== t) return;
				f = !1;
			} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
		} catch (r) {
			o = !0, n = r;
		} finally {
			try {
				if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
			} finally {
				if (o) throw n;
			}
		}
		return a;
	}
}
function _arrayWithHoles(r) {
	if (Array.isArray(r)) return r;
}
function _regenerator() {
	/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag";
	function i(r, n, o, i) {
		var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype);
		return _regeneratorDefine2(u, "_invoke", function(r, n, o) {
			var i, c, u, f = 0, p = o || [], y = !1, G = {
				p: 0,
				n: 0,
				v: e,
				a: d,
				f: d.bind(e, 4),
				d: function d(t, r) {
					return i = t, c = 0, u = e, G.n = r, a;
				}
			};
			function d(r, n) {
				for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) {
					var o, i = p[t], d = G.p, l = i[2];
					r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0));
				}
				if (o || r > 1) return a;
				throw y = !0, n;
			}
			return function(o, p, l) {
				if (f > 1) throw TypeError("Generator is already running");
				for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) {
					i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u);
					try {
						if (f = 2, i) {
							if (c || (o = "next"), t = i[o]) {
								if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object");
								if (!t.done) return t;
								u = t.value, c < 2 && (c = 0);
							} else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1);
							i = e;
						} else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break;
					} catch (t) {
						i = e, c = 1, u = t;
					} finally {
						f = 1;
					}
				}
				return {
					value: t,
					done: y
				};
			};
		}(r, o, i), !0), u;
	}
	var a = {};
	function Generator() {}
	function GeneratorFunction() {}
	function GeneratorFunctionPrototype() {}
	t = Object.getPrototypeOf;
	var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function() {
		return this;
	}), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c);
	function f(e) {
		return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e;
	}
	return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function() {
		return this;
	}), _regeneratorDefine2(u, "toString", function() {
		return "[object Generator]";
	}), (_regenerator = function _regenerator() {
		return {
			w: i,
			m: f
		};
	})();
}
function _regeneratorDefine2(e, r, n, t) {
	var i = Object.defineProperty;
	try {
		i({}, "", {});
	} catch (e) {
		i = 0;
	}
	_regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) {
		function o(r, n) {
			_regeneratorDefine2(e, r, function(e) {
				return this._invoke(r, n, e);
			});
		}
		r ? i ? i(e, r, {
			value: n,
			enumerable: !t,
			configurable: !t,
			writable: !t
		}) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2));
	}, _regeneratorDefine2(e, r, n, t);
}
function asyncGeneratorStep(n, t, e, r, o, a, c) {
	try {
		var i = n[a](c), u = i.value;
	} catch (n) {
		e(n);
		return;
	}
	i.done ? t(u) : Promise.resolve(u).then(r, o);
}
function _asyncToGenerator(n) {
	return function() {
		var t = this, e = arguments;
		return new Promise(function(r, o) {
			var a = n.apply(t, e);
			function _next(n) {
				asyncGeneratorStep(a, r, o, _next, _throw, "next", n);
			}
			function _throw(n) {
				asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);
			}
			_next(void 0);
		});
	};
}
function ownKeys(e, r) {
	var t = Object.keys(e);
	if (Object.getOwnPropertySymbols) {
		var o = Object.getOwnPropertySymbols(e);
		r && (o = o.filter(function(r) {
			return Object.getOwnPropertyDescriptor(e, r).enumerable;
		})), t.push.apply(t, o);
	}
	return t;
}
function _objectSpread(e) {
	for (var r = 1; r < arguments.length; r++) {
		var t = null != arguments[r] ? arguments[r] : {};
		r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
			_defineProperty(e, r, t[r]);
		}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
			Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
		});
	}
	return e;
}
function _defineProperty(e, r, t) {
	return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
		value: t,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[r] = t, e;
}
function _classCallCheck(a, n) {
	if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties(e, r) {
	for (var t = 0; t < r.length; t++) {
		var o = r[t];
		o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
	}
}
function _createClass(e, r, t) {
	return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;
}
function _toPropertyKey(t) {
	var i = _toPrimitive(t, "string");
	return "symbol" == typeof i ? i : i + "";
}
function _toPrimitive(t, r) {
	if ("object" != typeof t || !t) return t;
	var e = t[Symbol.toPrimitive];
	if (void 0 !== e) {
		var i = e.call(t, r || "default");
		if ("object" != typeof i) return i;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return ("string" === r ? String : Number)(t);
}
function _callSuper(t, o, e) {
	return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
}
function _possibleConstructorReturn(t, e) {
	if (e && ("object" == typeof e || "function" == typeof e)) return e;
	if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized(t);
}
function _assertThisInitialized(e) {
	if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return e;
}
function _superPropGet(t, o, e, r) {
	var p = _get(_getPrototypeOf(1 & r ? t.prototype : t), o, e);
	return 2 & r && "function" == typeof p ? function(t) {
		return p.apply(e, t);
	} : p;
}
function _get() {
	return _get = "undefined" != typeof Reflect && Reflect.get ? Reflect.get.bind() : function(e, t, r) {
		var p = _superPropBase(e, t);
		if (p) {
			var n = Object.getOwnPropertyDescriptor(p, t);
			return n.get ? n.get.call(arguments.length < 3 ? e : r) : n.value;
		}
	}, _get.apply(null, arguments);
}
function _superPropBase(t, o) {
	for (; !{}.hasOwnProperty.call(t, o) && null !== (t = _getPrototypeOf(t)););
	return t;
}
function _inherits(t, e) {
	if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
	t.prototype = Object.create(e && e.prototype, { constructor: {
		value: t,
		writable: !0,
		configurable: !0
	} }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);
}
function _wrapNativeSuper(t) {
	var r = "function" == typeof Map ? /* @__PURE__ */ new Map() : void 0;
	return _wrapNativeSuper = function _wrapNativeSuper(t) {
		if (null === t || !_isNativeFunction(t)) return t;
		if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function");
		if (void 0 !== r) {
			if (r.has(t)) return r.get(t);
			r.set(t, Wrapper);
		}
		function Wrapper() {
			return _construct(t, arguments, _getPrototypeOf(this).constructor);
		}
		return Wrapper.prototype = Object.create(t.prototype, { constructor: {
			value: Wrapper,
			enumerable: !1,
			writable: !0,
			configurable: !0
		} }), _setPrototypeOf(Wrapper, t);
	}, _wrapNativeSuper(t);
}
function _construct(t, e, r) {
	if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments);
	var o = [null];
	o.push.apply(o, e);
	var p = new (t.bind.apply(t, o))();
	return r && _setPrototypeOf(p, r.prototype), p;
}
function _isNativeReflectConstruct() {
	try {
		var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
	} catch (t) {}
	return (_isNativeReflectConstruct = function _isNativeReflectConstruct() {
		return !!t;
	})();
}
function _isNativeFunction(t) {
	try {
		return -1 !== Function.toString.call(t).indexOf("[native code]");
	} catch (n) {
		return "function" == typeof t;
	}
}
function _setPrototypeOf(t, e) {
	return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t, e) {
		return t.__proto__ = e, t;
	}, _setPrototypeOf(t, e);
}
function _getPrototypeOf(t) {
	return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t) {
		return t.__proto__ || Object.getPrototypeOf(t);
	}, _getPrototypeOf(t);
}
function _classPrivateMethodInitSpec(e, a) {
	_checkPrivateRedeclaration(e, a), a.add(e);
}
function _classPrivateFieldInitSpec(e, t, a) {
	_checkPrivateRedeclaration(e, t), t.set(e, a);
}
function _checkPrivateRedeclaration(e, t) {
	if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object");
}
function _classPrivateGetter(s, r, a) {
	return a(_assertClassBrand(s, r));
}
function _classPrivateFieldGet(s, a) {
	return s.get(_assertClassBrand(s, a));
}
function _classPrivateFieldSet(s, a, r) {
	return s.set(_assertClassBrand(s, a), r), r;
}
function _assertClassBrand(e, t, n) {
	if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n;
	throw new TypeError("Private element is not present on this object");
}
var requiredAttributes = ["media-id"];
var optionalPublicAttributes = [
	"aspect",
	"audio-description-control",
	"autoplay",
	"big-play-button",
	"branding",
	"contrast-icons",
	"controls-visible-on-load",
	"copy-link-and-thumbnail",
	"current-time",
	"do-not-track",
	"email",
	"end-video-behavior",
	"fit-strategy",
	"fullscreen-control",
	"language",
	"muted",
	"opaque-controls",
	"playback-rate-control",
	"play-bar-control",
	"player-color",
	"playlist-links",
	"playlist-loop",
	"play-pause-control",
	"play-pause-notifier",
	"popover-animate-thumbnail",
	"popover-animation",
	"popover-border-color",
	"popover-border-radius",
	"popover-border-width",
	"popover-box-shadow",
	"popover-caption",
	"popover-caption-container",
	"popover-content",
	"popover-disable-autoplay",
	"popover-overlay-color",
	"popover-overlay-opacity",
	"popover-prevent-scroll",
	"popover-show-on-load",
	"poster",
	"preload",
	"quality-control",
	"quality-max",
	"quality-min",
	"resumable",
	"rounded-player",
	"rounded-playlist",
	"rotate-to-fullscreen",
	"seo",
	"settings-control",
	"silent-autoplay",
	"transparent-letterbox",
	"video-quality",
	"volume",
	"volume-control",
	"wistia-popover"
];
var optionalPrivateAttributes = [
	"big-play-button-border-radius",
	"control-bar-border-radius",
	"embed-host",
	"hls",
	"page-url",
	"player-border-radius",
	"player-force",
	"stats-url",
	"swatch",
	"unique-id",
	"use-web-component"
];
var defaultEmbedOptions = {
	audioDescriptionControl: false,
	autoplay: false,
	bigPlayButton: true,
	bigPlayButtonBorderRadius: void 0,
	contrastIcons: false,
	controlBarBorderRadius: void 0,
	controlsVisibleOnLoad: true,
	copyLinkAndThumbnail: true,
	currentTime: 0,
	doNotTrack: false,
	endVideoBehavior: "default",
	fitStrategy: "contain",
	fullscreenControl: true,
	hls: true,
	opaqueControls: false,
	playBarControl: true,
	playerBorderRadius: void 0,
	playerColor: "636155",
	playPauseControl: true,
	playPauseNotifier: true,
	playbackRateControl: true,
	playlistLinks: "",
	playlistLoop: false,
	popoverAnimateThumbnail: false,
	popoverAnimation: "slide",
	popoverBorderColor: "ffffff",
	popoverBorderRadius: 0,
	popoverBorderWidth: 0,
	popoverBoxShadow: true,
	popoverCaption: "",
	popoverCaptionContainer: "",
	popoverContent: void 0,
	popoverDisableAutoplay: false,
	popoverOverlayColor: "000000",
	popoverOverlayOpacity: .5,
	popoverPreventScroll: false,
	popoverShowOnLoad: false,
	poster: "",
	qualityControl: true,
	qualityMax: void 0,
	qualityMin: void 0,
	resumable: "auto",
	rotateToFullscreen: false,
	roundedPlayer: void 0,
	seo: true,
	settingsControl: true,
	silentAutoplay: false,
	state: "beforeplay",
	statsUrl: null,
	transparentLetterbox: false,
	volume: 1,
	volumeControl: true,
	wistiaPopover: false
};
/**
* Returns the swatch url for a given mediaId
* @param {string} mediaId
* @param {string} embedHost
* @returns {string}
*/
var getSwatchUrl = function getSwatchUrl(mediaId) {
	var embedHost = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : "";
	var fastHost = (0, _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_17__.CX)(embedHost);
	return "https://".concat(fastHost, "/embed/medias/").concat(mediaId, "/swatch");
};
var _api = /*#__PURE__*/ new WeakMap();
var _eventListeners = /*#__PURE__*/ new WeakMap();
var _fullscreenState = /*#__PURE__*/ new WeakMap();
var _impl = /*#__PURE__*/ new WeakMap();
var _internals = /*#__PURE__*/ new WeakMap();
var _jsonLdId = /*#__PURE__*/ new WeakMap();
var _judyContext = /*#__PURE__*/ new WeakMap();
var _logger = /*#__PURE__*/ new WeakMap();
var _oldEngine = /*#__PURE__*/ new WeakMap();
var _playerData = /*#__PURE__*/ new WeakMap();
var _playerType = /*#__PURE__*/ new WeakMap();
var _removeEventListeners = /*#__PURE__*/ new WeakMap();
var _cachedRemapTime = /*#__PURE__*/ new WeakMap();
var _hasElementConnectedToDOM = /*#__PURE__*/ new WeakMap();
var _paddingTop = /*#__PURE__*/ new WeakMap();
var _playPending = /*#__PURE__*/ new WeakMap();
var _preactRoot = /*#__PURE__*/ new WeakMap();
var _preloadThumbnailRoot = /*#__PURE__*/ new WeakMap();
var _publicApiScript = /*#__PURE__*/ new WeakMap();
var _resizeObserver = /*#__PURE__*/ new WeakMap();
var _WistiaPlayer_brand = /*#__PURE__*/ new WeakSet();
var _handleAfterReplace = /*#__PURE__*/ new WeakMap();
var _handleBeforeReplace = /*#__PURE__*/ new WeakMap();
var _handlePreloadThumbnailClick = /*#__PURE__*/ new WeakMap();
var WistiaPlayer = /*#__PURE__*/ function(_HTMLElement) {
	/**
	* Represents one embedded Wistia media player.
	* @constructor
	*/
	function WistiaPlayer() {
		var _Wistia$wistia;
		var _this2;
		_classCallCheck(this, WistiaPlayer);
		_this2 = _callSuper(this, WistiaPlayer);
		_classPrivateMethodInitSpec(_this2, _WistiaPlayer_brand);
		_classPrivateFieldInitSpec(_this2, _api, void 0);
		_classPrivateFieldInitSpec(_this2, _eventListeners, {});
		_classPrivateFieldInitSpec(_this2, _fullscreenState, {
			heightBeforeFullscreen: void 0,
			inFullscreen: false,
			nativeFullscreen: false,
			widthBeforeFullscreen: void 0
		});
		_classPrivateFieldInitSpec(_this2, _impl, void 0);
		_classPrivateFieldInitSpec(_this2, _internals, void 0);
		_classPrivateFieldInitSpec(_this2, _jsonLdId, void 0);
		_classPrivateFieldInitSpec(_this2, _judyContext, null);
		_classPrivateFieldInitSpec(_this2, _logger, void 0);
		_classPrivateFieldInitSpec(_this2, _oldEngine, void 0);
		_classPrivateFieldInitSpec(_this2, _playerData, void 0);
		_classPrivateFieldInitSpec(_this2, _playerType, void 0);
		_classPrivateFieldInitSpec(_this2, _removeEventListeners, []);
		_classPrivateFieldInitSpec(_this2, _cachedRemapTime, void 0);
		_classPrivateFieldInitSpec(_this2, _hasElementConnectedToDOM, false);
		_classPrivateFieldInitSpec(_this2, _paddingTop, "0px");
		_classPrivateFieldInitSpec(_this2, _playPending, false);
		_classPrivateFieldInitSpec(_this2, _preactRoot, null);
		_classPrivateFieldInitSpec(_this2, _preloadThumbnailRoot, null);
		_classPrivateFieldInitSpec(_this2, _publicApiScript, (0, _utilities_runScript_js__WEBPACK_IMPORTED_MODULE_21__.j)("".concat((0, _utilities_url_js__WEBPACK_IMPORTED_MODULE_26__.ff)(), "//").concat((0, _appHostname_js__WEBPACK_IMPORTED_MODULE_8__.Ni)("fast"), "/assets/external/publicApi.js")));
		_classPrivateFieldInitSpec(_this2, _resizeObserver, null);
		_classPrivateFieldInitSpec(_this2, _handleAfterReplace, function() {
			_assertClassBrand(_WistiaPlayer_brand, _this2, _maybeInjectJsonLd).call(_this2);
			(0, _utilities_embedOptionStore_ts__WEBPACK_IMPORTED_MODULE_13__.gY)("__".concat(_this2.uniqueId, "_dom_options__"), _classPrivateFieldGet(_playerData, _this2).embedOptions);
		});
		_classPrivateFieldInitSpec(_this2, _handleBeforeReplace, function(event) {
			/**
			* Since the public API reads embed options assigned to the DOM container,
			* we need to make sure the DOM container ID/uniqueId is updated before
			* the public API starts gathering options in replaceWithMediaDataQueuable.
			*/
			_this2.mediaId = event.detail.mediaId;
			_this2.uniqueId = _assertClassBrand(_WistiaPlayer_brand, _this2, _generateUniqueId).call(_this2, event.detail.mediaId);
			_classPrivateFieldSet(_cachedRemapTime, _this2, void 0);
		});
		_classPrivateFieldInitSpec(_this2, _handlePreloadThumbnailClick, function() {
			if (_classPrivateFieldGet(_playerType, _this2) !== "carouselHardWall" && _classPrivateFieldGet(_playerType, _this2) !== "notplayable" && _classPrivateFieldGet(_playerType, _this2) !== "passwordprotected") _classPrivateFieldSet(_playPending, _this2, true);
			_assertClassBrand(_WistiaPlayer_brand, _this2, _renderPreloadThumbnail).call(_this2);
		});
		if ("attachInternals" in HTMLElement.prototype && "states" in ElementInternals.prototype) {
			_classPrivateFieldSet(_internals, _this2, _this2.attachInternals());
			_classPrivateFieldGet(_internals, _this2).states.add("--initializing");
		}
		_this2.attachShadow({ mode: "open" });
		_this2.dispatchEvent(new CustomEvent("load-start"));
		_this2.paddingTop = getComputedStyle(_this2).paddingTop;
		_classPrivateFieldSet(_logger, _this2, _utilities_wlog_js__WEBPACK_IMPORTED_MODULE_30__.ct.getPrefixedFunctions("WistiaPlayer"));
		_classPrivateFieldSet(_playerData, _this2, new _utilities_PlayerDataHandler_ts__WEBPACK_IMPORTED_MODULE_7__.I());
		(_Wistia$wistia = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.wistia) !== null && _Wistia$wistia !== void 0 || (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.wistia = Date.now());
		return _this2;
	}
	/**
	* Return an array of the attributes that we want to observe for changes.
	* If one of these attributes changes, the attributeChangedCallback will be called.
	* @returns {string[]}
	*/
	_inherits(WistiaPlayer, _HTMLElement);
	return _createClass(WistiaPlayer, [
		{
			key: "_fullscreenState",
			get: 
			/**
			* @returns {FullscreenState} private fullscreenState of the video.
			*/
			function get() {
				return _classPrivateFieldGet(_fullscreenState, this);
			},
			set: function set(state) {
				_classPrivateFieldSet(_fullscreenState, this, state);
			}
		},
		{
			key: "_oldEngine",
			get: function get() {
				return _classPrivateFieldGet(_oldEngine, this);
			},
			set: function set(engine) {
				_classPrivateFieldSet(_oldEngine, this, engine);
			}
		},
		{
			key: "aspect",
			get: function get() {
				var _ref, _ref2, _classPrivateFieldGet2, _classPrivateFieldGet3;
				var fallbackAspect = !Number.isNaN(this.offsetWidth / this.offsetHeight) && Number.isFinite(this.offsetWidth / this.offsetHeight) ? this.offsetWidth / this.offsetHeight : _utilities_constants_ts__WEBPACK_IMPORTED_MODULE_6__.R7;
				return (_ref = (_ref2 = (_classPrivateFieldGet2 = (_classPrivateFieldGet3 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet3 === void 0 ? void 0 : _classPrivateFieldGet3.aspect()) !== null && _classPrivateFieldGet2 !== void 0 ? _classPrivateFieldGet2 : this.embedOptions.aspect) !== null && _ref2 !== void 0 ? _ref2 : _assertClassBrand(_WistiaPlayer_brand, this, _getValueFromAttribute).call(this, "aspect")) !== null && _ref !== void 0 ? _ref : fallbackAspect;
			},
			set: function set(newAspect) {
				var _classPrivateFieldGet4;
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "aspect", newAspect);
				(_classPrivateFieldGet4 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet4 === void 0 || _classPrivateFieldGet4.width((0, _utilities_elem_js__WEBPACK_IMPORTED_MODULE_14__.cG)(this), { constrain: true });
			}
		},
		{
			key: "audioDescriptionControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "audioDescriptionControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet5;
				(_classPrivateFieldGet5 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet5 === void 0 || _classPrivateFieldGet5.audioDescriptionControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "audioDescriptionControl", shouldDisplay);
			}
		},
		{
			key: "authorization",
			set: function set(auth) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "authorization", auth);
			}
		},
		{
			key: "autoplay",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "autoplay");
			},
			set: function set(shouldSetAutoplay) {
				if (typeof shouldSetAutoplay !== "boolean") return;
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "autoplay", shouldSetAutoplay);
				if (shouldSetAutoplay) this.setAttribute("autoplay", "");
				else this.removeAttribute("autoplay");
			}
		},
		{
			key: "bigPlayButton",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "bigPlayButton");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet6;
				(_classPrivateFieldGet6 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet6 === void 0 || _classPrivateFieldGet6.bigPlayButtonEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "bigPlayButton", shouldDisplay);
			}
		},
		{
			key: "bigPlayButtonBorderRadius",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "bigPlayButtonBorderRadius");
			},
			set: function set(radius) {
				var _classPrivateFieldGet7;
				(_classPrivateFieldGet7 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet7 === void 0 || _classPrivateFieldGet7.setBigPlayButtonBorderRadius(radius);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "bigPlayButtonBorderRadius", Number(radius));
			}
		},
		{
			key: "branding",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "branding");
			},
			set: function set(value) {
				if (value === "true" || value === true) _assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "branding", true);
			}
		},
		{
			key: "buffered",
			get: function get() {
				var _classPrivateFieldGet8, _classPrivateFieldGet9;
				return (_classPrivateFieldGet8 = (_classPrivateFieldGet9 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet9 === void 0 ? void 0 : _classPrivateFieldGet9.getStandardBuffered()) !== null && _classPrivateFieldGet8 !== void 0 ? _classPrivateFieldGet8 : {};
			}
		},
		{
			key: "captionsEnabled",
			get: function get() {
				var _classPrivateFieldGet0, _classPrivateFieldGet1;
				return (_classPrivateFieldGet0 = (_classPrivateFieldGet1 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet1 === void 0 ? void 0 : _classPrivateFieldGet1.captionsEnabled()) !== null && _classPrivateFieldGet0 !== void 0 ? _classPrivateFieldGet0 : false;
			},
			set: function set(enabled) {
				var _classPrivateFieldGet10;
				(_classPrivateFieldGet10 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet10 === void 0 || _classPrivateFieldGet10.captionsEnabled(enabled);
			}
		},
		{
			key: "captionsLanguage",
			get: function get() {
				var _classPrivateFieldGet11, _classPrivateFieldGet12;
				return (_classPrivateFieldGet11 = (_classPrivateFieldGet12 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet12 === void 0 ? void 0 : _classPrivateFieldGet12.captionsLanguage()) !== null && _classPrivateFieldGet11 !== void 0 ? _classPrivateFieldGet11 : _assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this);
			}
		},
		{
			key: "captionsLanguageCode",
			get: function get() {
				var _classPrivateFieldGet13, _classPrivateFieldGet14;
				return (_classPrivateFieldGet13 = (_classPrivateFieldGet14 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet14 === void 0 ? void 0 : _classPrivateFieldGet14.captionsLanguageCode()) !== null && _classPrivateFieldGet13 !== void 0 ? _classPrivateFieldGet13 : _assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this).wistiaLanguageCode;
			},
			set: function set(languageCode) {
				var _classPrivateFieldGet15;
				(_classPrivateFieldGet15 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet15 === void 0 || _classPrivateFieldGet15.captionsLanguageCode(languageCode);
			}
		},
		{
			key: "captionsLanguages",
			get: function get() {
				var _classPrivateFieldGet16, _classPrivateFieldGet17;
				return (_classPrivateFieldGet16 = (_classPrivateFieldGet17 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet17 === void 0 ? void 0 : _classPrivateFieldGet17.captionsLanguages()) !== null && _classPrivateFieldGet16 !== void 0 ? _classPrivateFieldGet16 : [_assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this)];
			}
		},
		{
			key: "contrastIcons",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "contrastIcons");
			},
			set: function set(contrastIcons) {
				var _classPrivateFieldGet18;
				var valueAsBoolean = Boolean(contrastIcons);
				(_classPrivateFieldGet18 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet18 === void 0 || _classPrivateFieldGet18.contrastIcons(valueAsBoolean);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "contrastIcons", valueAsBoolean);
			}
		},
		{
			key: "controlBarBorderRadius",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "controlBarBorderRadius");
			},
			set: function set(radius) {
				var _classPrivateFieldGet19;
				(_classPrivateFieldGet19 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet19 === void 0 || _classPrivateFieldGet19.setControlBarBorderRadius(radius);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "controlBarBorderRadius", Number(radius));
			}
		},
		{
			key: "controls",
			get: function get() {
				if (_classPrivateFieldGet(_impl, this)) return Object.seal(_objectSpread({}, _classPrivateFieldGet(_impl, this).controls));
				return {};
			}
		},
		{
			key: "controlsVisibleOnLoad",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "controlsVisibleOnLoad");
			},
			set: function set(shouldHide) {
				var _classPrivateFieldGet20;
				(_classPrivateFieldGet20 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet20 === void 0 || _classPrivateFieldGet20.renderUI();
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "controlsVisibleOnLoad", shouldHide);
			}
		},
		{
			key: "copyLinkAndThumbnail",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "copyLinkAndThumbnail");
			},
			set: function set(enabled) {
				var prevVal = this.copyLinkAndThumbnail;
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "copyLinkAndThumbnail", enabled);
				if (prevVal !== enabled) this.dispatchEvent(new CustomEvent("copy-link-and-thumbnail-change", { detail: { copyLinkAndThumbnail: enabled } }));
			}
		},
		{
			key: "currentTime",
			get: function get() {
				var _ref3, _ref4, _classPrivateFieldGet21;
				return (_ref3 = (_ref4 = (_classPrivateFieldGet21 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet21 === void 0 ? void 0 : _classPrivateFieldGet21.time()) !== null && _ref4 !== void 0 ? _ref4 : this.embedOptions.currentTime) !== null && _ref3 !== void 0 ? _ref3 : 0;
			},
			set: function set(newTime) {
				var _classPrivateFieldGet22;
				(_classPrivateFieldGet22 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet22 === void 0 || _classPrivateFieldGet22.time(newTime);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "currentTime", newTime);
			}
		},
		{
			key: "debug",
			get: function get() {
				var _classPrivateFieldGet23;
				return {
					impl: _classPrivateFieldGet(_impl, this),
					engine: (_classPrivateFieldGet23 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet23 === void 0 ? void 0 : _classPrivateFieldGet23.engine
				};
			}
		},
		{
			key: "deprecatedApiDoNotUse",
			get: function get() {
				return _classPrivateFieldGet(_api, this);
			}
		},
		{
			key: "description",
			get: function get() {
				var _ref5, _classPrivateFieldGet24, _classPrivateFieldGet25, _classPrivateFieldGet26;
				return (_ref5 = (_classPrivateFieldGet24 = _classPrivateFieldGet(_playerData, this).mediaData.seoDescription) !== null && _classPrivateFieldGet24 !== void 0 ? _classPrivateFieldGet24 : (_classPrivateFieldGet25 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet25 === void 0 ? void 0 : (_classPrivateFieldGet26 = _classPrivateFieldGet25._mediaData) === null || _classPrivateFieldGet26 === void 0 ? void 0 : _classPrivateFieldGet26.seoDescription) !== null && _ref5 !== void 0 ? _ref5 : "";
			}
		},
		{
			key: "doNotTrack",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "doNotTrack");
			},
			set: function set(dontTrack) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "doNotTrack", dontTrack);
			}
		},
		{
			key: "duration",
			get: function get() {
				var _classPrivateFieldGet27, _classPrivateFieldGet28;
				return (_classPrivateFieldGet27 = (_classPrivateFieldGet28 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet28 === void 0 ? void 0 : _classPrivateFieldGet28.duration()) !== null && _classPrivateFieldGet27 !== void 0 ? _classPrivateFieldGet27 : 0;
			}
		},
		{
			key: "email",
			get: function get() {
				var _ref6, _ref7, _extractEmailFromPara, _classPrivateGetter2;
				return (_ref6 = (_ref7 = (_extractEmailFromPara = (0, _utilities_extractEmailFromParams_ts__WEBPACK_IMPORTED_MODULE_16__.i)(_classPrivateGetter(_WistiaPlayer_brand, this, _get_pageUrl))) !== null && _extractEmailFromPara !== void 0 ? _extractEmailFromPara : (_classPrivateGetter2 = (0, _utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_27__.y1)()[_classPrivateGetter(_WistiaPlayer_brand, this, _get_pageUrl)]) === null || _classPrivateGetter2 === void 0 ? void 0 : _classPrivateGetter2.trackEmail) !== null && _ref7 !== void 0 ? _ref7 : this.embedOptions.email) !== null && _ref6 !== void 0 ? _ref6 : void 0;
			},
			set: function set(newEmail) {
				if (this.email === newEmail) return;
				_assertClassBrand(_WistiaPlayer_brand, this, _updateEmail).call(this, newEmail);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "email", newEmail);
			}
		},
		{
			key: "embedHost",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "embedHost");
			},
			set: function set(newEmbedHost) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "embedHost", newEmbedHost);
			}
		},
		{
			key: "embedOptions",
			get: function get() {
				return _classPrivateFieldGet(_playerData, this).embedOptions;
			}
		},
		{
			key: "ended",
			get: function get() {
				var _classPrivateFieldGet29;
				return ((_classPrivateFieldGet29 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet29 === void 0 ? void 0 : _classPrivateFieldGet29.state()) === "ended";
			}
		},
		{
			key: "endVideoBehavior",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "endVideoBehavior");
			},
			set: function set(behavior) {
				if (behavior === "loop") {
					var _classPrivateFieldGet30;
					(_classPrivateFieldGet30 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet30 === void 0 || _classPrivateFieldGet30.addLoopBehavior();
				} else {
					var _classPrivateFieldGet31;
					(_classPrivateFieldGet31 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet31 === void 0 || _classPrivateFieldGet31.removeLoopBehavior();
				}
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "endVideoBehavior", behavior);
			}
		},
		{
			key: "eventKey",
			get: function get() {
				var _classPrivateFieldGet32;
				return (_classPrivateFieldGet32 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet32 === void 0 ? void 0 : _classPrivateFieldGet32.eventKey();
			}
		},
		{
			key: "fitStrategy",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "fitStrategy");
			},
			set: function set(strategy) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "fitStrategy", strategy);
			}
		},
		{
			key: "fullscreenControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "fullscreenControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet33;
				(_classPrivateFieldGet33 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet33 === void 0 || _classPrivateFieldGet33.fullscreenControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "fullscreenControl", shouldDisplay);
			}
		},
		{
			key: "hls",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "hls");
			},
			set: function set(shouldUseHls) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "hls", shouldUseHls);
			}
		},
		{
			key: "inFullscreen",
			get: function get() {
				var _classPrivateFieldGet34, _classPrivateFieldGet35;
				return (_classPrivateFieldGet34 = (_classPrivateFieldGet35 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet35 === void 0 ? void 0 : _classPrivateFieldGet35.inFullscreen()) !== null && _classPrivateFieldGet34 !== void 0 ? _classPrivateFieldGet34 : false;
			}
		},
		{
			key: "inputContext",
			get: function get() {
				var _classPrivateFieldGet36;
				return (_classPrivateFieldGet36 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet36 === void 0 ? void 0 : _classPrivateFieldGet36.getInputContext();
			}
		},
		{
			key: "instantHls",
			get: function get() {
				var _classPrivateFieldGet37, _classPrivateFieldGet38;
				return (_classPrivateFieldGet37 = (_classPrivateFieldGet38 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet38 === void 0 ? void 0 : _classPrivateFieldGet38.isInstantHls()) !== null && _classPrivateFieldGet37 !== void 0 ? _classPrivateFieldGet37 : false;
			}
		},
		{
			key: "language",
			get: function get() {
				var _classPrivateFieldGet39, _classPrivateFieldGet40;
				return (_classPrivateFieldGet39 = (_classPrivateFieldGet40 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet40 === void 0 ? void 0 : _classPrivateFieldGet40.language()) !== null && _classPrivateFieldGet39 !== void 0 ? _classPrivateFieldGet39 : _assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this);
			},
			set: function set(language) {
				var _classPrivateFieldGet41;
				(_classPrivateFieldGet41 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet41 === void 0 || _classPrivateFieldGet41.language(language);
			}
		},
		{
			key: "languages",
			get: function get() {
				var _classPrivateFieldGet42, _classPrivateFieldGet43;
				return (_classPrivateFieldGet42 = (_classPrivateFieldGet43 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet43 === void 0 ? void 0 : _classPrivateFieldGet43.languages()) !== null && _classPrivateFieldGet42 !== void 0 ? _classPrivateFieldGet42 : [_assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this)];
			}
		},
		{
			key: "mediaData",
			get: function get() {
				return _classPrivateFieldGet(_playerData, this).mediaData;
			}
		},
		{
			key: "mediaId",
			get: function get() {
				var _this$getAttribute;
				return (_this$getAttribute = this.getAttribute("media-id")) !== null && _this$getAttribute !== void 0 ? _this$getAttribute : "";
			},
			set: function set(newMediaId) {
				if (this.mediaId === newMediaId) return;
				_classPrivateFieldGet(_logger, this).info("set mediaId", newMediaId);
				this.setAttribute("media-id", newMediaId);
			}
		},
		{
			key: "mediaLanguage",
			get: function get() {
				var _classPrivateFieldGet44, _classPrivateFieldGet45;
				return (_classPrivateFieldGet44 = (_classPrivateFieldGet45 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet45 === void 0 ? void 0 : _classPrivateFieldGet45.mediaLanguage()) !== null && _classPrivateFieldGet44 !== void 0 ? _classPrivateFieldGet44 : _assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this);
			}
		},
		{
			key: "mediaLanguageCode",
			get: function get() {
				var _classPrivateFieldGet46, _classPrivateFieldGet47;
				return (_classPrivateFieldGet46 = (_classPrivateFieldGet47 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet47 === void 0 ? void 0 : _classPrivateFieldGet47.mediaLanguageCode()) !== null && _classPrivateFieldGet46 !== void 0 ? _classPrivateFieldGet46 : _assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this).wistiaLanguageCode;
			},
			set: function set(languageCode) {
				var _classPrivateFieldGet48;
				(_classPrivateFieldGet48 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet48 === void 0 || _classPrivateFieldGet48.mediaLanguageCode(languageCode);
			}
		},
		{
			key: "mediaLanguages",
			get: function get() {
				var _classPrivateFieldGet49, _classPrivateFieldGet50;
				return (_classPrivateFieldGet49 = (_classPrivateFieldGet50 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet50 === void 0 ? void 0 : _classPrivateFieldGet50.mediaLanguages()) !== null && _classPrivateFieldGet49 !== void 0 ? _classPrivateFieldGet49 : [_assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this)];
			}
		},
		{
			key: "muted",
			get: function get() {
				var _ref8, _classPrivateFieldGet51, _classPrivateFieldGet52;
				return (_ref8 = (_classPrivateFieldGet51 = (_classPrivateFieldGet52 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet52 === void 0 ? void 0 : _classPrivateFieldGet52.isMuted()) !== null && _classPrivateFieldGet51 !== void 0 ? _classPrivateFieldGet51 : this.embedOptions.muted) !== null && _ref8 !== void 0 ? _ref8 : false;
			},
			set: function set(shouldMute) {
				if (_classPrivateFieldGet(_impl, this)) {
					if (shouldMute) _classPrivateFieldGet(_impl, this).mute();
					else _classPrivateFieldGet(_impl, this).unmute();
				}
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "muted", shouldMute);
			}
		},
		{
			key: "name",
			get: function get() {
				var _ref9, _classPrivateFieldGet53, _classPrivateFieldGet54, _classPrivateFieldGet55;
				return (_ref9 = (_classPrivateFieldGet53 = _classPrivateFieldGet(_playerData, this).mediaData.name) !== null && _classPrivateFieldGet53 !== void 0 ? _classPrivateFieldGet53 : (_classPrivateFieldGet54 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet54 === void 0 ? void 0 : (_classPrivateFieldGet55 = _classPrivateFieldGet54._mediaData) === null || _classPrivateFieldGet55 === void 0 ? void 0 : _classPrivateFieldGet55.name) !== null && _ref9 !== void 0 ? _ref9 : void 0;
			}
		},
		{
			key: "opaqueControls",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "opaqueControls");
			},
			set: function set(opaqueControls) {
				var _classPrivateFieldGet56;
				var valueAsBoolean = Boolean(opaqueControls);
				(_classPrivateFieldGet56 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet56 === void 0 || _classPrivateFieldGet56.opaqueControls(valueAsBoolean);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "opaqueControls", valueAsBoolean);
			}
		},
		{
			key: "paddingTop",
			get: function get() {
				return _classPrivateFieldGet(_paddingTop, this);
			},
			set: function set(paddingTop) {
				_classPrivateFieldSet(_paddingTop, this, paddingTop);
			}
		},
		{
			key: "paused",
			get: function get() {
				var _classPrivateFieldGet57;
				return ((_classPrivateFieldGet57 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet57 === void 0 ? void 0 : _classPrivateFieldGet57.state()) === "paused";
			}
		},
		{
			key: "percentWatched",
			get: function get() {
				var _classPrivateFieldGet58, _classPrivateFieldGet59;
				return (_classPrivateFieldGet58 = (_classPrivateFieldGet59 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet59 === void 0 ? void 0 : _classPrivateFieldGet59.percentWatched()) !== null && _classPrivateFieldGet58 !== void 0 ? _classPrivateFieldGet58 : 0;
			}
		},
		{
			key: "playbackRate",
			get: function get() {
				var _ref0, _classPrivateFieldGet60, _classPrivateFieldGet61;
				return (_ref0 = (_classPrivateFieldGet60 = (_classPrivateFieldGet61 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet61 === void 0 ? void 0 : _classPrivateFieldGet61.playbackRate()) !== null && _classPrivateFieldGet60 !== void 0 ? _classPrivateFieldGet60 : this.embedOptions.playbackRate) !== null && _ref0 !== void 0 ? _ref0 : 1;
			},
			set: function set(rate) {
				var _classPrivateFieldGet62;
				(_classPrivateFieldGet62 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet62 === void 0 || _classPrivateFieldGet62.playbackRate(rate);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playbackRate", rate);
			}
		},
		{
			key: "playbackRateControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playbackRateControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet63;
				(_classPrivateFieldGet63 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet63 === void 0 || _classPrivateFieldGet63.playbackRateControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playbackRateControl", shouldDisplay);
			}
		},
		{
			key: "playBarControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playBarControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet64;
				(_classPrivateFieldGet64 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet64 === void 0 || _classPrivateFieldGet64.playbarControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playBarControl", shouldDisplay);
			}
		},
		{
			key: "playerBorderRadius",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playerBorderRadius");
			},
			set: function set(radius) {
				var _classPrivateFieldGet65;
				(_classPrivateFieldGet65 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet65 === void 0 || _classPrivateFieldGet65.setPlayerBorderRadius(Number(radius));
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playerBorderRadius", Number(radius));
			}
		},
		{
			key: "playerColor",
			get: function get() {
				var _this$playerColorGrad;
				if ((_this$playerColorGrad = this.playerColorGradient) !== null && _this$playerColorGrad !== void 0 && _this$playerColorGrad.on) {
					var _getGradientColor;
					return (_getGradientColor = (0, _utilities_gradients_ts__WEBPACK_IMPORTED_MODULE_2__.yz)(this.playerColorGradient)) !== null && _getGradientColor !== void 0 ? _getGradientColor : _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playerColor");
				}
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playerColor");
			},
			set: function set(newColor) {
				var _classPrivateFieldGet66;
				(_classPrivateFieldGet66 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet66 === void 0 || _classPrivateFieldGet66.playerColor(newColor);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playerColor", newColor);
			}
		},
		{
			key: "playerColorGradient",
			get: function get() {
				var value = _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playerColorGradient");
				if ((0, _types_gradient_ts__WEBPACK_IMPORTED_MODULE_36__.b)(value)) return value;
			},
			set: function set(gradient) {
				var _classPrivateFieldGet67;
				if (!(0, _types_gradient_ts__WEBPACK_IMPORTED_MODULE_36__.b)(gradient)) throw new Error("playerColorGradient must be a valid gradient object");
				(_classPrivateFieldGet67 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet67 === void 0 || _classPrivateFieldGet67.playerColorGradient(gradient);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playerColorGradient", gradient);
			}
		},
		{
			key: "playerForce",
			get: function get() {
				var _ref1;
				return (_ref1 = this.getAttribute("player-force")) !== null && _ref1 !== void 0 ? _ref1 : void 0;
			},
			set: function set(newPlayer) {
				_classPrivateFieldGet(_logger, this).info("set playerForce", newPlayer);
				this.setAttribute("player-force", newPlayer);
			}
		},
		{
			key: "playlistLinks",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playlistLinks");
			},
			set: function set(newStrategy) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playlistLinks", newStrategy);
			}
		},
		{
			key: "playlistLoop",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playlistLoop");
			},
			set: function set(shouldLoop) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playlistLoop", shouldLoop);
			}
		},
		{
			key: "playPauseControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playPauseControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet68;
				(_classPrivateFieldGet68 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet68 === void 0 || _classPrivateFieldGet68.playPauseControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playPauseControl", shouldDisplay);
			}
		},
		{
			key: "playPauseNotifier",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "playPauseNotifier");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet69;
				(_classPrivateFieldGet69 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet69 === void 0 || _classPrivateFieldGet69.playPauseNotifierEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "playPauseNotifier", shouldDisplay);
			}
		},
		{
			key: "plugins",
			get: function get() {
				if (_classPrivateFieldGet(_impl, this)) return Object.seal(_objectSpread({}, _classPrivateFieldGet(_impl, this).plugin));
				return {};
			}
		},
		{
			key: "popoverAnimateThumbnail",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverAnimateThumbnail");
			},
			set: function set(shouldAnimate) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverAnimateThumbnail", shouldAnimate);
			}
		},
		{
			key: "popoverAnimation",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverAnimation");
			},
			set: function set(newAnimation) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverAnimation", newAnimation);
			}
		},
		{
			key: "popoverBorderColor",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverBorderColor");
			},
			set: function set(newColor) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverBorderColor", newColor);
			}
		},
		{
			key: "popoverBorderRadius",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverBorderRadius");
			},
			set: function set(newRadius) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverBorderRadius", newRadius);
			}
		},
		{
			key: "popoverBorderWidth",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverBorderWidth");
			},
			set: function set(newWidth) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverBorderWidth", newWidth);
			}
		},
		{
			key: "popoverBoxShadow",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverBoxShadow");
			},
			set: function set(shouldDisplayBoxShadow) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverBoxShadow", shouldDisplayBoxShadow);
			}
		},
		{
			key: "popoverCaption",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverCaption");
			},
			set: function set(newCaption) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverCaption", newCaption);
			}
		},
		{
			key: "popoverCaptionContainer",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverCaptionContainer");
			},
			set: function set(newCaptionContainer) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverCaptionContainer", newCaptionContainer);
			}
		},
		{
			key: "popoverContent",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverContent");
			},
			set: function set(newContentType) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverContent", newContentType);
			}
		},
		{
			key: "popoverDisableAutoplay",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverDisableAutoplay");
			},
			set: function set(shouldDisable) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverDisableAutoplay", shouldDisable);
			}
		},
		{
			key: "popoverOverlayColor",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverOverlayColor");
			},
			set: function set(newColor) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverOverlayColor", newColor);
			}
		},
		{
			key: "popoverOverlayOpacity",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverOverlayOpacity");
			},
			set: function set(newOpacity) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverOverlayOpacity", newOpacity);
			}
		},
		{
			key: "popoverPreventScroll",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverPreventScroll");
			},
			set: function set(shouldPreventScroll) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverPreventScroll", shouldPreventScroll);
			}
		},
		{
			key: "popoverShowOnLoad",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "popoverShowOnLoad");
			},
			set: function set(shouldShow) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "popoverShowOnLoad", shouldShow);
			}
		},
		{
			key: "poster",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "poster");
			},
			set: function set(newUrl) {
				if (this.poster === newUrl) return;
				var prevUrl = this.poster;
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "poster", newUrl);
				this.setAttribute("poster", newUrl);
				if (prevUrl !== newUrl) this.dispatchEvent(new CustomEvent("thumbnailchange"));
			}
		},
		{
			key: "preload",
			get: function get() {
				var _ref10, _classPrivateFieldGet70, _classPrivateFieldGet71;
				return (_ref10 = (_classPrivateFieldGet70 = (_classPrivateFieldGet71 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet71 === void 0 ? void 0 : _classPrivateFieldGet71.preloadValue()) !== null && _classPrivateFieldGet70 !== void 0 ? _classPrivateFieldGet70 : this.embedOptions.preload) !== null && _ref10 !== void 0 ? _ref10 : "metadata";
			},
			set: function set(preloadValue) {
				if (this.preload === preloadValue) return;
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "preload", preloadValue);
				this.setAttribute("preload", preloadValue);
			}
		},
		{
			key: "qualityControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "qualityControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet72;
				(_classPrivateFieldGet72 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet72 === void 0 || _classPrivateFieldGet72.qualityControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "qualityControl", shouldDisplay);
			}
		},
		{
			key: "qualityMax",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "qualityMax");
			},
			set: function set(quality) {
				var _classPrivateFieldGet73;
				(_classPrivateFieldGet73 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet73 === void 0 || _classPrivateFieldGet73.qualityMax(quality);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "qualityMax", quality);
			}
		},
		{
			key: "qualityMin",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "qualityMin");
			},
			set: function set(quality) {
				var _classPrivateFieldGet74;
				(_classPrivateFieldGet74 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet74 === void 0 || _classPrivateFieldGet74.qualityMin(quality);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "qualityMin", quality);
			}
		},
		{
			key: "readyState",
			get: function get() {
				var _classPrivateFieldGet75, _classPrivateFieldGet76;
				return (_classPrivateFieldGet75 = (_classPrivateFieldGet76 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet76 === void 0 ? void 0 : _classPrivateFieldGet76.getReadyState()) !== null && _classPrivateFieldGet75 !== void 0 ? _classPrivateFieldGet75 : 0;
			}
		},
		{
			key: "resumable",
			get: function get() {
				var _assertClassBrand$cal;
				return (_assertClassBrand$cal = _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "resumable")) !== null && _assertClassBrand$cal !== void 0 ? _assertClassBrand$cal : "auto";
			},
			set: function set(resumableState) {
				var _classPrivateFieldGet77;
				(_classPrivateFieldGet77 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet77 === void 0 || _classPrivateFieldGet77.setResumable(resumableState);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "resumable", resumableState);
			}
		},
		{
			key: "rotateToFullscreen",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "rotateToFullscreen");
			},
			set: function set(shouldRotateToFullscreen) {
				var _classPrivateFieldGet78;
				var attrAsBoolean = shouldRotateToFullscreen === "true" || shouldRotateToFullscreen === true;
				(_classPrivateFieldGet78 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet78 === void 0 || _classPrivateFieldGet78.rotateToFullscreen(attrAsBoolean);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "rotateToFullscreen", attrAsBoolean);
			}
		},
		{
			key: "roundedPlayer",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "roundedPlayer");
			},
			set: function set(radius) {
				var _classPrivateFieldGet79;
				(_classPrivateFieldGet79 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet79 === void 0 || _classPrivateFieldGet79.setRoundedPlayer(Number(radius));
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "roundedPlayer", Number(radius));
			}
		},
		{
			key: "secondsWatched",
			get: function get() {
				var _classPrivateFieldGet80, _classPrivateFieldGet81;
				return (_classPrivateFieldGet80 = (_classPrivateFieldGet81 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet81 === void 0 ? void 0 : _classPrivateFieldGet81.secondsWatched()) !== null && _classPrivateFieldGet80 !== void 0 ? _classPrivateFieldGet80 : 0;
			}
		},
		{
			key: "secondsWatchedVector",
			get: function get() {
				var _classPrivateFieldGet82, _classPrivateFieldGet83;
				return (_classPrivateFieldGet82 = (_classPrivateFieldGet83 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet83 === void 0 ? void 0 : _classPrivateFieldGet83.secondsWatchedVector()) !== null && _classPrivateFieldGet82 !== void 0 ? _classPrivateFieldGet82 : [];
			}
		},
		{
			key: "seo",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "seo");
			},
			set: function set(val) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "seo", val);
			}
		},
		{
			key: "settingsControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "settingsControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet84;
				(_classPrivateFieldGet84 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet84 === void 0 || _classPrivateFieldGet84.settingsControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "settingsControl", shouldDisplay);
			}
		},
		{
			key: "silentAutoplay",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "silentAutoplay");
			},
			set: function set(silentAutoplayValue) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "silentAutoplay", silentAutoplayValue);
			}
		},
		{
			key: "sourceLanguage",
			get: function get() {
				var _classPrivateFieldGet85, _classPrivateFieldGet86, _classPrivateFieldGet87;
				return (_classPrivateFieldGet85 = (_classPrivateFieldGet86 = _classPrivateFieldGet(_playerData, this).mediaData.localizations) === null || _classPrivateFieldGet86 === void 0 ? void 0 : _classPrivateFieldGet86.find(function(loc) {
					return loc.isOriginal;
				})) !== null && _classPrivateFieldGet85 !== void 0 ? _classPrivateFieldGet85 : (_classPrivateFieldGet87 = _classPrivateFieldGet(_playerData, this).mediaData.localizations) === null || _classPrivateFieldGet87 === void 0 ? void 0 : _classPrivateFieldGet87[0];
			}
		},
		{
			key: "sourceMediaId",
			get: function get() {
				var _this$mediaData$sourc;
				return (_this$mediaData$sourc = this.mediaData.sourceHashedId) !== null && _this$mediaData$sourc !== void 0 ? _this$mediaData$sourc : this.mediaId;
			}
		},
		{
			key: "state",
			get: function get() {
				var _classPrivateFieldGet88, _classPrivateFieldGet89;
				return (_classPrivateFieldGet88 = (_classPrivateFieldGet89 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet89 === void 0 ? void 0 : _classPrivateFieldGet89.state()) !== null && _classPrivateFieldGet88 !== void 0 ? _classPrivateFieldGet88 : defaultEmbedOptions.state;
			}
		},
		{
			key: "statsUrl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "statsUrl");
			},
			set: function set(url) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "statsUrl", url);
			}
		},
		{
			key: "swatch",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "swatch");
			},
			set: function set(shouldShowSwatch) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "swatch", shouldShowSwatch);
			}
		},
		{
			key: "transparentLetterbox",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "transparentLetterbox");
			},
			set: function set(shouldSetTransparentLetterbox) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "transparentLetterbox", shouldSetTransparentLetterbox);
			}
		},
		{
			key: "uniqueId",
			get: function get() {
				var _this$getAttribute2;
				return (_this$getAttribute2 = this.getAttribute("unique-id")) !== null && _this$getAttribute2 !== void 0 ? _this$getAttribute2 : "";
			},
			set: function set(id) {
				this.setAttribute("unique-id", id);
			}
		},
		{
			key: "useWebComponent",
			get: function get() {
				return this.getAttribute("use-web-component") === "true";
			},
			set: function set(val) {
				if (val) this.setAttribute("use-web-component", String(val));
				else this.removeAttribute("use-web-component");
			}
		},
		{
			key: "videoQuality",
			get: function get() {
				var _ref11, _classPrivateFieldGet90, _classPrivateFieldGet91;
				return (_ref11 = (_classPrivateFieldGet90 = (_classPrivateFieldGet91 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet91 === void 0 ? void 0 : _classPrivateFieldGet91.getVideoQuality()) !== null && _classPrivateFieldGet90 !== void 0 ? _classPrivateFieldGet90 : this.embedOptions.videoQuality) !== null && _ref11 !== void 0 ? _ref11 : "auto";
			},
			set: function set(quality) {
				var _classPrivateFieldGet92;
				(_classPrivateFieldGet92 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet92 === void 0 || _classPrivateFieldGet92.setVideoQuality(quality);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "videoQuality", quality);
			}
		},
		{
			key: "visitorKey",
			get: function get() {
				var _Wistia$visitorKey;
				return (_Wistia$visitorKey = _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.visitorKey) === null || _Wistia$visitorKey === void 0 ? void 0 : _Wistia$visitorKey.value();
			}
		},
		{
			key: "volume",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "volume");
			},
			set: function set(level) {
				var _classPrivateFieldGet93;
				(_classPrivateFieldGet93 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet93 === void 0 || _classPrivateFieldGet93.volume(level);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "volume", level);
			}
		},
		{
			key: "volumeControl",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "volumeControl");
			},
			set: function set(shouldDisplay) {
				var _classPrivateFieldGet94;
				(_classPrivateFieldGet94 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet94 === void 0 || _classPrivateFieldGet94.volumeControlEnabled(shouldDisplay);
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "volumeControl", shouldDisplay);
			}
		},
		{
			key: "wistiaPopover",
			get: function get() {
				return _assertClassBrand(_WistiaPlayer_brand, this, _getSyncedEmbedOption).call(this, "wistiaPopover");
			},
			set: function set(shouldBePopover) {
				_assertClassBrand(_WistiaPlayer_brand, this, _setSyncedEmbedOption).call(this, "wistiaPopover", shouldBePopover);
			}
		},
		{
			key: "addEventListener",
			value: 
			/**
			* Adds an event listener to the player.
			* @param {string} eventName - The name of the event to listen for.
			* @param {EventListenerOrEventListenerObject} listener - The function to call when the event occurs.
			* @param {AddEventListenerOptions | boolean} options - Additional options for the event listener.
			*/
			function addEventListener(eventName, listener, options) {
				if (!Array.isArray(_classPrivateFieldGet(_eventListeners, this)[eventName])) _classPrivateFieldGet(_eventListeners, this)[eventName] = [];
				_classPrivateFieldGet(_eventListeners, this)[eventName].push({
					listener,
					options
				});
				_superPropGet(WistiaPlayer, "addEventListener", this, 3)([
					eventName,
					listener,
					options
				]);
			}
		},
		{
			key: "cancelFullscreen",
			value: function() {
				var _cancelFullscreen = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee() {
					var _classPrivateFieldGet95, _this3 = this;
					return _regenerator().w(function(_context) {
						while (1) switch (_context.n) {
							case 0: return _context.a(2, (_classPrivateFieldGet95 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet95 === void 0 ? void 0 : _classPrivateFieldGet95.cancelFullscreen().then(function() {
								_this3._fullscreenState.heightBeforeFullscreen = void 0;
								_this3._fullscreenState.widthBeforeFullscreen = void 0;
							}));
						}
					}, _callee, this);
				}));
				function cancelFullscreen() {
					return _cancelFullscreen.apply(this, arguments);
				}
				return cancelFullscreen;
			}()
		},
		{
			key: "createOverlay",
			value: function() {
				var _createOverlay = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee2(name, options) {
					var _classPrivateFieldGet96;
					return _regenerator().w(function(_context2) {
						while (1) switch (_context2.n) {
							case 0:
								if (!((_classPrivateFieldGet96 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet96 !== void 0 && _classPrivateFieldGet96.defineOverlay)) {
									_context2.n = 1;
									break;
								}
								return _context2.a(2, _classPrivateFieldGet(_impl, this).defineOverlay(name, options));
							case 1: return _context2.a(2, Promise.reject(new Error("overlay ".concat(name, " cannot be defined at this time"))));
						}
					}, _callee2, this);
				}));
				function createOverlay(_x, _x2) {
					return _createOverlay.apply(this, arguments);
				}
				return createOverlay;
			}()
		},
		{
			key: "definePlugin",
			value: function() {
				var _definePlugin = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee5(name, options) {
					var _this4 = this;
					var addPlugin;
					return _regenerator().w(function(_context5) {
						while (1) switch (_context5.n) {
							case 0:
								addPlugin = /*#__PURE__*/ function() {
									var _ref12 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee3() {
										var _classPrivateFieldGet97, _classPrivateFieldGet98;
										return _regenerator().w(function(_context3) {
											while (1) switch (_context3.n) {
												case 0: return _context3.a(2, (_classPrivateFieldGet97 = (_classPrivateFieldGet98 = _classPrivateFieldGet(_api, _this4)) === null || _classPrivateFieldGet98 === void 0 ? void 0 : _classPrivateFieldGet98.addPlugin(name, options)) !== null && _classPrivateFieldGet97 !== void 0 ? _classPrivateFieldGet97 : Promise.reject(new Error("plugin ".concat(name, " cannot be defined"))));
											}
										}, _callee3);
									}));
									return function addPlugin() {
										return _ref12.apply(this, arguments);
									};
								}();
								if (!_classPrivateFieldGet(_api, this)) {
									_context5.n = 1;
									break;
								}
								return _context5.a(2, addPlugin());
							case 1: return _context5.a(2, new Promise(function(resolve, reject) {
								_this4.whenApiReady().then(/*#__PURE__*/ _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee4() {
									return _regenerator().w(function(_context4) {
										while (1) switch (_context4.n) {
											case 0: return _context4.a(2, addPlugin());
										}
									}, _callee4);
								}))).then(function(plugin) {
									return resolve(plugin);
								}).catch(function(err) {
									if (err instanceof Error) reject(err);
									else reject(/* @__PURE__ */ new Error("Promise rejected with non-Error value"));
								}).catch(function(_error) {});
							}));
						}
					}, _callee5, this);
				}));
				function definePlugin(_x3, _x4) {
					return _definePlugin.apply(this, arguments);
				}
				return definePlugin;
			}()
		},
		{
			key: "deleteOverlay",
			value: function() {
				var _deleteOverlay = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee6(name) {
					var _classPrivateFieldGet99;
					return _regenerator().w(function(_context6) {
						while (1) switch (_context6.n) {
							case 0:
								if (!((_classPrivateFieldGet99 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet99 !== void 0 && _classPrivateFieldGet99.undefineOverlay)) {
									_context6.n = 1;
									break;
								}
								return _context6.a(2, _classPrivateFieldGet(_impl, this).undefineOverlay(name));
							case 1: return _context6.a(2, Promise.reject(new Error("overlay ".concat(name, " cannot be deleted at this time"))));
						}
					}, _callee6, this);
				}));
				function deleteOverlay(_x5) {
					return _deleteOverlay.apply(this, arguments);
				}
				return deleteOverlay;
			}()
		},
		{
			key: "disableControl",
			value: function() {
				var _disableControl = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee7(name) {
					var _classPrivateFieldGet100;
					return _regenerator().w(function(_context7) {
						while (1) switch (_context7.n) {
							case 0:
								if (!((_classPrivateFieldGet100 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet100 !== void 0 && _classPrivateFieldGet100.setControlEnabled)) {
									_context7.n = 1;
									break;
								}
								return _context7.a(2, _classPrivateFieldGet(_impl, this).setControlEnabled(name, false));
							case 1: return _context7.a(2, Promise.reject(new Error("control \"".concat(name, "\" cannot be disabled at this time"))));
						}
					}, _callee7, this);
				}));
				function disableControl(_x6) {
					return _disableControl.apply(this, arguments);
				}
				return disableControl;
			}()
		},
		{
			key: "enableControl",
			value: function() {
				var _enableControl = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee8(name) {
					var _classPrivateFieldGet101;
					return _regenerator().w(function(_context8) {
						while (1) switch (_context8.n) {
							case 0:
								if (!((_classPrivateFieldGet101 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet101 !== void 0 && _classPrivateFieldGet101.setControlEnabled)) {
									_context8.n = 1;
									break;
								}
								return _context8.a(2, _classPrivateFieldGet(_impl, this).setControlEnabled(name, true));
							case 1: return _context8.a(2, Promise.reject(new Error("control \"".concat(name, "\" cannot be enabled at this time"))));
						}
					}, _callee8, this);
				}));
				function enableControl(_x7) {
					return _enableControl.apply(this, arguments);
				}
				return enableControl;
			}()
		},
		{
			key: "enterInputContext",
			value: function() {
				var _enterInputContext = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee9(context) {
					var _classPrivateFieldGet102, _this5 = this;
					return _regenerator().w(function(_context9) {
						while (1) switch (_context9.n) {
							case 0:
								if (!((_classPrivateFieldGet102 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet102 !== void 0 && _classPrivateFieldGet102.enterInputContext)) {
									_context9.n = 1;
									break;
								}
								return _context9.a(2, new Promise(function(resolve) {
									var _classPrivateFieldGet103;
									var _handler = function handler(event) {
										if (event.detail.context === context) resolve();
										_this5.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.ve, _handler);
									};
									_this5.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.ve, _handler);
									(_classPrivateFieldGet103 = _classPrivateFieldGet(_impl, _this5)) === null || _classPrivateFieldGet103 === void 0 || _classPrivateFieldGet103.enterInputContext(context);
								}));
							case 1: return _context9.a(2, Promise.reject(new Error("input context of name \"".concat(context, "\" cannot be enabled at this time"))));
						}
					}, _callee9, this);
				}));
				function enterInputContext(_x8) {
					return _enterInputContext.apply(this, arguments);
				}
				return enterInputContext;
			}()
		},
		{
			key: "exitInputContext",
			value: function() {
				var _exitInputContext = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee0(context) {
					var _classPrivateFieldGet104;
					return _regenerator().w(function(_context0) {
						while (1) switch (_context0.n) {
							case 0:
								if (!((_classPrivateFieldGet104 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet104 !== void 0 && _classPrivateFieldGet104.exitInputContext)) {
									_context0.n = 1;
									break;
								}
								return _context0.a(2, Promise.resolve(_classPrivateFieldGet(_impl, this).exitInputContext(context)));
							case 1: return _context0.a(2, Promise.reject(new Error("control \"".concat(context, "\" cannot be enabled at this time"))));
						}
					}, _callee0, this);
				}));
				function exitInputContext(_x9) {
					return _exitInputContext.apply(this, arguments);
				}
				return exitInputContext;
			}()
		},
		{
			key: "getInitialMediaData",
			value: function() {
				var _getInitialMediaData2 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee1(mediaId, options) {
					return _regenerator().w(function(_context1) {
						while (1) switch (_context1.n) {
							case 0: return _context1.a(2, (0, _utilities_getInitialMediaData_ts__WEBPACK_IMPORTED_MODULE_32__.n)(mediaId, options));
						}
					}, _callee1);
				}));
				function getInitialMediaData(_x0, _x1) {
					return _getInitialMediaData2.apply(this, arguments);
				}
				return getInitialMediaData;
			}()
		},
		{
			key: "getPlugin",
			value: function() {
				var _getPlugin = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee10(name) {
					var _this6 = this;
					return _regenerator().w(function(_context10) {
						while (1) switch (_context10.n) {
							case 0: return _context10.a(2, new Promise(function(resolve, reject) {
								var _classPrivateFieldGet105;
								if ((_classPrivateFieldGet105 = _classPrivateFieldGet(_api, _this6)) !== null && _classPrivateFieldGet105 !== void 0 && _classPrivateFieldGet105.plugin && name in _classPrivateFieldGet(_api, _this6).plugin) resolve(_classPrivateFieldGet(_api, _this6).plugin[name]);
								reject(new Error("plugin ".concat(name, " is not defined")));
							}));
						}
					}, _callee10);
				}));
				function getPlugin(_x10) {
					return _getPlugin.apply(this, arguments);
				}
				return getPlugin;
			}()
		},
		{
			key: "getRemapTime",
			value: function() {
				var _getRemapTime = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee11() {
					var _classPrivateFieldGet106, _this7 = this;
					var _t, _t2, _t3;
					return _regenerator().w(function(_context11) {
						while (1) switch (_context11.n) {
							case 0:
								if (!(_classPrivateFieldGet(_cachedRemapTime, this) != null)) {
									_context11.n = 1;
									break;
								}
								return _context11.a(2, _classPrivateFieldGet(_cachedRemapTime, this));
							case 1:
								if (!(this.languages.length <= 1)) {
									_context11.n = 2;
									break;
								}
								_classPrivateFieldSet(_cachedRemapTime, this, function(_fromLanguage, _toLanguage, fromTime) {
									return fromTime;
								});
								return _context11.a(2, _classPrivateFieldGet(_cachedRemapTime, this));
							case 2:
								if (!((_classPrivateFieldGet106 = _classPrivateFieldGet(_cachedRemapTime, this)) !== null && _classPrivateFieldGet106 !== void 0)) {
									_context11.n = 3;
									break;
								}
								_context11.n = 5;
								break;
							case 3:
								_t = _classPrivateFieldSet;
								_t2 = _cachedRemapTime;
								_t3 = this;
								_context11.n = 4;
								return (0, _utilities_dynamicImport_ts__WEBPACK_IMPORTED_MODULE_12__.$)("assets/external/timeMapping.js").then(function(_ref14) {
									var remapTime = _ref14.remapTime;
									return function(fromLanguage, toLanguage, fromTime) {
										var fromTimeInMilliseconds = fromTime * 1e3;
										var fromLocalization = _assertClassBrand(_WistiaPlayer_brand, _this7, _findLocalizationByLanguage).call(_this7, fromLanguage);
										var sourceLocalization = _this7.sourceLanguage;
										var toLocalization = _assertClassBrand(_WistiaPlayer_brand, _this7, _findLocalizationByLanguage).call(_this7, toLanguage);
										if (fromLocalization == null || toLocalization == null || sourceLocalization == null) return fromTime;
										return remapTime(sourceLocalization, fromLocalization, toLocalization, fromTimeInMilliseconds) / 1e3;
									};
								});
							case 4: _t(_t2, _t3, _context11.v);
							case 5: return _context11.a(2, _classPrivateFieldGet(_cachedRemapTime, this));
						}
					}, _callee11, this);
				}));
				function getRemapTime() {
					return _getRemapTime.apply(this, arguments);
				}
				return getRemapTime;
			}()
		},
		{
			key: "hideOverlay",
			value: function() {
				var _hideOverlay = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee12(name) {
					var _classPrivateFieldGet107;
					return _regenerator().w(function(_context12) {
						while (1) switch (_context12.n) {
							case 0:
								if (!((_classPrivateFieldGet107 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet107 !== void 0 && _classPrivateFieldGet107.cancelOverlay)) {
									_context12.n = 1;
									break;
								}
								return _context12.a(2, _classPrivateFieldGet(_impl, this).cancelOverlay(name));
							case 1: return _context12.a(2, Promise.reject(new Error("overlay ".concat(name, " cannot be cancelled at this time"))));
						}
					}, _callee12, this);
				}));
				function hideOverlay(_x11) {
					return _hideOverlay.apply(this, arguments);
				}
				return hideOverlay;
			}()
		},
		{
			key: "hidePopover",
			value: function() {
				var _hidePopover = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee13() {
					var _this8 = this;
					return _regenerator().w(function(_context13) {
						while (1) switch (_context13.n) {
							case 0: return _context13.a(2, new Promise(function(resolve, reject) {
								var _classPrivateFieldGet108;
								if ((_classPrivateFieldGet108 = _classPrivateFieldGet(_api, _this8)) !== null && _classPrivateFieldGet108 !== void 0 && _classPrivateFieldGet108.popover) {
									_classPrivateFieldGet(_api, _this8).popover.hide();
									resolve();
								}
								reject(/* @__PURE__ */ new Error("Popover cannot be accessed"));
							}));
						}
					}, _callee13);
				}));
				function hidePopover() {
					return _hidePopover.apply(this, arguments);
				}
				return hidePopover;
			}()
		},
		{
			key: "languagesToLocalizations",
			value: function languagesToLocalizations(languages) {
				var _classPrivateFieldGet109, _classPrivateFieldGet110;
				return (_classPrivateFieldGet109 = (_classPrivateFieldGet110 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet110 === void 0 ? void 0 : _classPrivateFieldGet110.languagesToLocalizations(languages)) !== null && _classPrivateFieldGet109 !== void 0 ? _classPrivateFieldGet109 : [];
			}
		},
		{
			key: "languageToLocalization",
			value: function languageToLocalization(language) {
				var _classPrivateFieldGet111, _classPrivateFieldGet112;
				return (_classPrivateFieldGet111 = (_classPrivateFieldGet112 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet112 === void 0 ? void 0 : _classPrivateFieldGet112.languageToLocalization(language)) !== null && _classPrivateFieldGet111 !== void 0 ? _classPrivateFieldGet111 : _assertClassBrand(_WistiaPlayer_brand, this, _defaultLocalization).call(this);
			}
		},
		{
			key: "pause",
			value: function() {
				var _pause = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee14() {
					var _classPrivateFieldGet113;
					return _regenerator().w(function(_context14) {
						while (1) switch (_context14.n) {
							case 0: return _context14.a(2, (_classPrivateFieldGet113 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet113 === void 0 ? void 0 : _classPrivateFieldGet113.pause());
						}
					}, _callee14, this);
				}));
				function pause() {
					return _pause.apply(this, arguments);
				}
				return pause;
			}()
		},
		{
			key: "play",
			value: function() {
				var _play = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee15() {
					var _classPrivateFieldGet114;
					return _regenerator().w(function(_context15) {
						while (1) switch (_context15.n) {
							case 0: return _context15.a(2, (_classPrivateFieldGet114 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet114 === void 0 ? void 0 : _classPrivateFieldGet114.play());
						}
					}, _callee15, this);
				}));
				function play() {
					return _play.apply(this, arguments);
				}
				return play;
			}()
		},
		{
			key: "releaseControls",
			value: function() {
				var _releaseControls = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee16(name) {
					var _classPrivateFieldGet115;
					return _regenerator().w(function(_context16) {
						while (1) switch (_context16.n) {
							case 0: return _context16.a(2, (_classPrivateFieldGet115 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet115 === void 0 ? void 0 : _classPrivateFieldGet115.releaseControls(name));
						}
					}, _callee16, this);
				}));
				function releaseControls(_x12) {
					return _releaseControls.apply(this, arguments);
				}
				return releaseControls;
			}()
		},
		{
			key: "removeAllEventListeners",
			value: function removeAllEventListeners() {
				var _this9 = this;
				Object.entries(_classPrivateFieldGet(_eventListeners, this)).forEach(function(_ref15) {
					var _ref16 = _slicedToArray(_ref15, 2), type = _ref16[0];
					_ref16[1].forEach(function(_ref17) {
						var listener = _ref17.listener, options = _ref17.options;
						_this9.removeEventListener(type, listener, options);
					});
				});
			}
		},
		{
			key: "removeEventListener",
			value: function removeEventListener(type, listener, options) {
				var listeners = _classPrivateFieldGet(_eventListeners, this)[type];
				if (!Array.isArray(listeners)) return;
				var index = listeners.findIndex(function(entry) {
					return entry.listener === listener && JSON.stringify(entry.options) === JSON.stringify(options);
				});
				if (index !== -1) {
					_superPropGet(WistiaPlayer, "removeEventListener", this, 3)([
						type,
						listener,
						options
					]);
					listeners.splice(index, 1);
					if (listeners.length === 0) _classPrivateFieldGet(_eventListeners, this)[type] = [];
				}
			}
		},
		{
			key: "replaceWithMedia",
			value: function() {
				var _replaceWithMedia = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee17(mediaId) {
					var _this0 = this;
					var options, _args17 = arguments;
					return _regenerator().w(function(_context17) {
						while (1) switch (_context17.n) {
							case 0:
								options = _args17.length > 1 && _args17[1] !== void 0 ? _args17[1] : {};
								return _context17.a(2, new Promise(function(resolve, reject) {
									var _classPrivateFieldGet116;
									if (!_classPrivateFieldGet(_api, _this0)) reject(/* @__PURE__ */ new Error("api not ready to replace"));
									(0, _utilities_injectJsonLd_js__WEBPACK_IMPORTED_MODULE_31__.Z)(_classPrivateFieldGet(_jsonLdId, _this0));
									var _handleAfterReplace2 = function handleAfterReplace() {
										_this0.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.$1, _handleAfterReplace2);
										resolve();
									};
									_this0.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.$1, _handleAfterReplace2);
									(_classPrivateFieldGet116 = _classPrivateFieldGet(_api, _this0)) === null || _classPrivateFieldGet116 === void 0 || _classPrivateFieldGet116.replaceWith(mediaId, options);
								}));
						}
					}, _callee17);
				}));
				function replaceWithMedia(_x13) {
					return _replaceWithMedia.apply(this, arguments);
				}
				return replaceWithMedia;
			}()
		},
		{
			key: "requestControls",
			value: function() {
				var _requestControls = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee18(name) {
					var _classPrivateFieldGet117;
					return _regenerator().w(function(_context18) {
						while (1) switch (_context18.n) {
							case 0: return _context18.a(2, (_classPrivateFieldGet117 = _classPrivateFieldGet(_impl, this)) === null || _classPrivateFieldGet117 === void 0 ? void 0 : _classPrivateFieldGet117.requestControls(name));
						}
					}, _callee18, this);
				}));
				function requestControls(_x14) {
					return _requestControls.apply(this, arguments);
				}
				return requestControls;
			}()
		},
		{
			key: "requestFullscreen",
			value: function() {
				var _requestFullscreen = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee19() {
					var _classPrivateFieldGet118;
					return _regenerator().w(function(_context19) {
						while (1) switch (_context19.n) {
							case 0:
								if (!((_classPrivateFieldGet118 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet118 !== void 0 && _classPrivateFieldGet118.requestFullscreen)) {
									_context19.n = 1;
									break;
								}
								return _context19.a(2, _classPrivateFieldGet(_impl, this).requestFullscreen());
							case 1: return _context19.a(2, Promise.reject(/* @__PURE__ */ new Error("Fullscreen cannot be accessed")));
						}
					}, _callee19, this);
				}));
				function requestFullscreen() {
					return _requestFullscreen.apply(this, arguments);
				}
				return requestFullscreen;
			}()
		},
		{
			key: "showOverlay",
			value: function() {
				var _showOverlay = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee20(name) {
					var _classPrivateFieldGet119;
					return _regenerator().w(function(_context20) {
						while (1) switch (_context20.n) {
							case 0:
								if (!((_classPrivateFieldGet119 = _classPrivateFieldGet(_impl, this)) !== null && _classPrivateFieldGet119 !== void 0 && _classPrivateFieldGet119.requestOverlay)) {
									_context20.n = 1;
									break;
								}
								return _context20.a(2, _classPrivateFieldGet(_impl, this).requestOverlay(name));
							case 1: return _context20.a(2, Promise.reject(new Error("overlay ".concat(name, " cannot be requested at this time"))));
						}
					}, _callee20, this);
				}));
				function showOverlay(_x15) {
					return _showOverlay.apply(this, arguments);
				}
				return showOverlay;
			}()
		},
		{
			key: "showPopover",
			value: function() {
				var _showPopover = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee21() {
					var _this1 = this;
					return _regenerator().w(function(_context21) {
						while (1) switch (_context21.n) {
							case 0: return _context21.a(2, new Promise(function(resolve, reject) {
								var _classPrivateFieldGet120;
								if ((_classPrivateFieldGet120 = _classPrivateFieldGet(_api, _this1)) !== null && _classPrivateFieldGet120 !== void 0 && _classPrivateFieldGet120.popover) {
									_classPrivateFieldGet(_api, _this1).popover.show();
									resolve();
								}
								reject(/* @__PURE__ */ new Error("Popover cannot be accessed"));
							}));
						}
					}, _callee21);
				}));
				function showPopover() {
					return _showPopover.apply(this, arguments);
				}
				return showPopover;
			}()
		},
		{
			key: "updateEmbedOptions",
			value: function() {
				var _updateEmbedOptions = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee22(options) {
					var _this10 = this;
					return _regenerator().w(function(_context22) {
						while (1) switch (_context22.n) {
							case 0: return _context22.a(2, new Promise(function(resolve) {
								_assertClassBrand(_WistiaPlayer_brand, _this10, _setMultipleSyncedEmbedOptions).call(_this10, options);
								resolve(_this10.embedOptions);
							}));
						}
					}, _callee22);
				}));
				function updateEmbedOptions(_x16) {
					return _updateEmbedOptions.apply(this, arguments);
				}
				return updateEmbedOptions;
			}()
		},
		{
			key: "whenApiReady",
			value: function() {
				var _whenApiReady = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee23() {
					var _this11 = this;
					return _regenerator().w(function(_context23) {
						while (1) switch (_context23.n) {
							case 0: return _context23.a(2, new Promise(function(resolve) {
								if (_classPrivateFieldGet(_api, _this11)) _classPrivateFieldGet(_api, _this11).ready(function() {
									resolve();
								});
								var _handler2 = function handler() {
									_this11.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.c5, _handler2);
									resolve();
								};
								_this11.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.c5, _handler2);
							}));
						}
					}, _callee23);
				}));
				function whenApiReady() {
					return _whenApiReady.apply(this, arguments);
				}
				return whenApiReady;
			}()
		},
		{
			key: "whenControlMounted",
			value: function() {
				var _whenControlMounted = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee24(handle) {
					var control;
					return _regenerator().w(function(_context24) {
						while (1) switch (_context24.n) {
							case 0:
								_context24.n = 1;
								return this.whenApiReady();
							case 1:
								if (!(_classPrivateFieldGet(_api, this) === null)) {
									_context24.n = 2;
									break;
								}
								throw new Error("Control API not available");
							case 2:
								_context24.n = 3;
								return _classPrivateFieldGet(_api, this).whenControlMounted(handle);
							case 3:
								control = _context24.v;
								if (!(control === null || control === void 0)) {
									_context24.n = 4;
									break;
								}
								throw new Error("Control not found");
							case 4: return _context24.a(2, control);
						}
					}, _callee24, this);
				}));
				function whenControlMounted(_x17) {
					return _whenControlMounted.apply(this, arguments);
				}
				return whenControlMounted;
			}()
		},
		{
			key: "attributeChangedCallback",
			value: function attributeChangedCallback(name, oldValue, newValue) {
				if (!_classPrivateFieldGet(_hasElementConnectedToDOM, this)) return;
				if (oldValue === newValue) return;
				if (oldValue === null && newValue === "") return;
				var finalValue = newValue;
				switch (newValue) {
					case "true":
						finalValue = true;
						break;
					case "false": finalValue = false;
				}
				this[(0, _utilities_camelCaseToKebabCase_ts__WEBPACK_IMPORTED_MODULE_35__.b)(name)] = finalValue;
			}
		},
		{
			key: "connectedCallback",
			value: function connectedCallback() {
				var _window$wistiaOptions, _this12 = this, _this$embedHost;
				if (_classPrivateFieldGet(_hasElementConnectedToDOM, this)) return;
				_classPrivateFieldSet(_hasElementConnectedToDOM, this, true);
				var mediaId = this.getAttribute("media-id");
				if (mediaId == null) {
					(0, _utilities_simpleMetrics_js__WEBPACK_IMPORTED_MODULE_24__.WO)("player/failure/init-failed");
					throw new Error("media-id attribute is required");
				}
				window.wistiaOptions = (_window$wistiaOptions = window.wistiaOptions) !== null && _window$wistiaOptions !== void 0 ? _window$wistiaOptions : {};
				var opts = (0, _utilities_wistiaOptions_ts__WEBPACK_IMPORTED_MODULE_28__.C)(this.mediaId);
				_classPrivateFieldGet(_playerData, this).setWistiaWindowEmbedOptionSource(opts);
				_classPrivateFieldSet(_logger, this, _utilities_wlog_js__WEBPACK_IMPORTED_MODULE_30__.ct.getPrefixedFunctions("WistiaPlayer ".concat(mediaId)));
				_classPrivateFieldSet(_judyContext, this, (0, _utilities_judy_js__WEBPACK_IMPORTED_MODULE_19__.gC)());
				if (this.getAttribute("react") === "true") (0, _utilities_simpleMetrics_js__WEBPACK_IMPORTED_MODULE_24__.WO)("player/initembed.react");
				_assertClassBrand(_WistiaPlayer_brand, this, _setupEventListeners).call(this);
				_classPrivateFieldGet(_logger, this).info("initialize embed");
				if (!this.useWebComponent) (0, _utilities_wistiaQueue_ts__WEBPACK_IMPORTED_MODULE_29__.z)();
				this.uniqueId = _assertClassBrand(_WistiaPlayer_brand, this, _generateUniqueId).call(this, mediaId);
				_assertClassBrand(_WistiaPlayer_brand, this, _maybeSetupEmbedOptionsFromIframe).call(this);
				_assertClassBrand(_WistiaPlayer_brand, this, _runMethodsFromAttributes).call(this);
				_assertClassBrand(_WistiaPlayer_brand, this, _saveInitialAttributesFromDomOptions).call(this);
				_classPrivateFieldSet(_resizeObserver, this, new ResizeObserver(function resizeCallback() {
					_assertClassBrand(_WistiaPlayer_brand, _this12, _renderPreloadThumbnail).call(_this12);
				}));
				_classPrivateFieldGet(_resizeObserver, this).observe(this);
				var optsForFetch = {
					deferFetchingToCarousel: _assertClassBrand(_WistiaPlayer_brand, this, _deferMediaDataFetchingToCarouselEmbed).call(this),
					embedHost: (_this$embedHost = this.embedHost) !== null && _this$embedHost !== void 0 ? _this$embedHost : "",
					overrideMediaLanguage: this.embedOptions.language
				};
				this.getInitialMediaData(mediaId, optsForFetch).then(function(mediaDataOrError) {
					var _mediaData$hashedId;
					if ((0, _utilities_mediaDataError_ts__WEBPACK_IMPORTED_MODULE_33__.V)(mediaDataOrError)) {
						if (mediaDataOrError.iframe === true || mediaDataOrError.iframe === "true") {
							var baseUrl = "".concat((0, _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_17__.v9)(), "//").concat((0, _utilities_hosts_js__WEBPACK_IMPORTED_MODULE_17__.aY)());
							_this12.style.display = "block";
							var computedStyle = getComputedStyle(_this12);
							if (!(computedStyle.width !== "auto" && computedStyle.width !== "0px")) _this12.style.width = "100%";
							_this12.style.aspectRatio = String(_this12.aspect);
							if (_this12.shadowRoot) _this12.shadowRoot.innerHTML = "<iframe src='".concat(baseUrl, "/embed/iframe/").concat(_this12.mediaId, "' aspect='").concat(_this12.aspect, "' style='width: 100%; height: 100%; border: 0;' scrolling='no'></iframe>");
							return;
						}
					}
					var mediaData = mediaDataOrError;
					_this12.mediaId = (_mediaData$hashedId = mediaData.hashedId) !== null && _mediaData$hashedId !== void 0 ? _mediaData$hashedId : _this12.mediaId;
					_classPrivateFieldGet(_playerData, _this12).setMediaDataSource(mediaData);
					_this12.dispatchEvent(new CustomEvent(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.rO, { detail: { mediaData: _classPrivateFieldGet(_playerData, _this12).mediaData } }));
					var bestMatchContainer = document.querySelector("[unique-id='".concat(_this12.uniqueId, "']")) ? _this12.uniqueId : _this12;
					_assertClassBrand(_WistiaPlayer_brand, _this12, _initPlayerEmbed).call(_this12, {
						container: bestMatchContainer,
						mediaData: _classPrivateFieldGet(_playerData, _this12).mediaData
					});
				}).catch(function(error) {
					(0, _utilities_simpleMetrics_js__WEBPACK_IMPORTED_MODULE_24__.WO)("player/failure/init-failed");
					throw new Error(error.message);
				});
				if (this.shadowRoot) {
					if (this.wistiaPopover && this.popoverContent === "link") {
						var slot = document.createElement("slot");
						slot.name = "".concat(this.uniqueId, "-popover-link");
						this.shadowRoot.appendChild(slot);
					}
					_classPrivateFieldSet(_preactRoot, this, document.createElement("div"));
					_assertClassBrand(_WistiaPlayer_brand, this, _renderEmbedTemplate).call(this);
					this.shadowRoot.insertBefore(_classPrivateFieldGet(_preactRoot, this), this.shadowRoot.firstChild);
				}
			}
		},
		{
			key: "disconnectedCallback",
			value: function disconnectedCallback() {
				var _classPrivateFieldGet121, _classPrivateFieldGet122, _this$shadowRoot;
				_classPrivateFieldGet(_removeEventListeners, this).forEach(function(removeListener) {
					return removeListener();
				});
				this.removeAllEventListeners();
				_classPrivateFieldSet(_eventListeners, this, {});
				(0, _utilities_injectJsonLd_js__WEBPACK_IMPORTED_MODULE_31__.Z)(_classPrivateFieldGet(_jsonLdId, this));
				(0, _utilities_remote_data_cache_ts__WEBPACK_IMPORTED_MODULE_34__.s3)(this.mediaId);
				(_classPrivateFieldGet121 = _classPrivateFieldGet(_resizeObserver, this)) === null || _classPrivateFieldGet121 === void 0 || _classPrivateFieldGet121.disconnect();
				_classPrivateFieldSet(_resizeObserver, this, null);
				(0, _utilities_embedOptionStore_ts__WEBPACK_IMPORTED_MODULE_13__.iU)("__".concat(this.uniqueId, "_dom_options__"));
				(_classPrivateFieldGet122 = _classPrivateFieldGet(_api, this)) === null || _classPrivateFieldGet122 === void 0 || _classPrivateFieldGet122.remove();
				_classPrivateFieldSet(_api, this, null);
				_assertClassBrand(_WistiaPlayer_brand, this, _destroyPreloadThumbnailRoot).call(this);
				(_this$shadowRoot = this.shadowRoot) === null || _this$shadowRoot === void 0 || _this$shadowRoot.replaceChildren();
				_classPrivateFieldSet(_preactRoot, this, null);
				_classPrivateFieldSet(_hasElementConnectedToDOM, this, false);
			}
		}
	], [{
		key: "observedAttributes",
		get: function get() {
			return [].concat(requiredAttributes, optionalPublicAttributes, optionalPrivateAttributes);
		}
	}]);
}(/*#__PURE__*/ _wrapNativeSuper(HTMLElement));
/**
* Takes an image url (swatch) and returns the image metadata
* @param {string} url
* @returns {Promise<HTMLImageElement>}
*/
_WistiaPlayer = WistiaPlayer;
function _get_pageUrl(_this) {
	var _this$getAttribute3;
	return (_this$getAttribute3 = _this.getAttribute("page-url")) !== null && _this$getAttribute3 !== void 0 ? _this$getAttribute3 : (0, _utilities_inferPageUrl_ts__WEBPACK_IMPORTED_MODULE_18__.H)();
}
function _defaultLocalization() {
	return {
		bcp47LanguageTag: "en",
		familyName: "English",
		familyNativeName: "English",
		name: "English",
		nativeName: "English",
		wistiaLanguageCode: "eng",
		alpha3Bibliographic: "eng",
		alpha3Terminologic: "eng",
		duration: 0,
		genericName: "English",
		genericNativeName: "English",
		hashedId: this.mediaId,
		ietfLanguageTag: "eng",
		isLocalization: true,
		iso6392LanguageCode: "eng",
		sourceLanguage: true,
		timeMappings: []
	};
}
/**
* Should the player defer fetching media data to a carousel embed?
* Look for a connected carousel embed that is not inside a playlist embed.
* If one is found, return true.
* @returns {boolean}
*/
function _deferMediaDataFetchingToCarouselEmbed() {
	if (!(0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_1__.uI)(this.id)) return false;
	return !!document.querySelector("wistia-channel-carousel[player-dom-id=\"".concat(this.id, "\"]:not([is-inside-playlist-embed=\"true\"][channel-id])"));
}
function _destroyPreloadThumbnailRoot() {
	if (_classPrivateFieldGet(_preloadThumbnailRoot, this)) {
		(0, preact__WEBPACK_IMPORTED_MODULE_0__.render)(null, _classPrivateFieldGet(_preloadThumbnailRoot, this));
		_classPrivateFieldGet(_preloadThumbnailRoot, this).remove();
		_classPrivateFieldSet(_preloadThumbnailRoot, this, null);
	}
}
function _findLocalizationByLanguage(language) {
	var _classPrivateFieldGet123;
	if (language == null) return;
	return (_classPrivateFieldGet123 = _classPrivateFieldGet(_playerData, this).mediaData.localizations) === null || _classPrivateFieldGet123 === void 0 ? void 0 : _classPrivateFieldGet123.find(function(localization) {
		return localization.wistiaLanguageCode === language || localization.bcp47LanguageTag === language;
	});
}
/**
* Generates a unique id for the embed
* @param {number | string} mediaId - The media id
* @returns {string}
*/
function _generateUniqueId(mediaId) {
	var prefix = "wistia-".concat(mediaId, "-");
	return (0, _utilities_seqid_js__WEBPACK_IMPORTED_MODULE_22__.h)(prefix);
}
/**
* Returns either the value of an embed option from the public api
* or the value of an embed option saved on this element.
*
* For now, the public api is the source of truth for embed options.
* However, this will change in the future. We also need a non-public
* api source for embed options so we can use them before the public
* api is ready.
* @param {string} key - Name of the embed option
* @returns {boolean | number | string | null}
*/
function _getSyncedEmbedOption(key) {
	var _ref20, _ref21;
	if (_classPrivateFieldGet(_impl, this) && key in _classPrivateFieldGet(_impl, this)._attrs) return _classPrivateFieldGet(_impl, this)._attrs[key];
	return (_ref20 = (_ref21 = this.embedOptions[key]) !== null && _ref21 !== void 0 ? _ref21 : _assertClassBrand(_WistiaPlayer_brand, this, _getValueFromAttribute).call(this, (0, _utilities_camelCaseToKebabCase_ts__WEBPACK_IMPORTED_MODULE_35__.$)(key))) !== null && _ref20 !== void 0 ? _ref20 : defaultEmbedOptions[key];
}
/**
* Gets the value of an attribute if it exists, returns null if not
* @param {string} name - Name of the attribute
* @returns {boolean | string | null}
*/
function _getValueFromAttribute(name) {
	if (!this.hasAttribute(name)) return null;
	switch (this.getAttribute(name)) {
		case "true": return true;
		case "false": return false;
		case "": return true;
		default: return this.getAttribute(name);
	}
}
/**
* Handles initialization of the player for fresh Aurora embeds
* @returns {void}
*/
function _initPlayerEmbed(_ref22) {
	var container = _ref22.container, mediaData = _ref22.mediaData;
	if (!_classPrivateFieldGet(_hasElementConnectedToDOM, this)) return;
	_classPrivateFieldGet(_playerData, this).updateEmbedOptionOverrides({ videoFoam: true });
	if (mediaData && !(0, _utilities_mediaDataError_ts__WEBPACK_IMPORTED_MODULE_33__.V)(mediaData)) {
		_classPrivateFieldSet(_playerType, this, (0, _utilities_judy_js__WEBPACK_IMPORTED_MODULE_19__.$F)(_classPrivateFieldGet(_judyContext, this), _classPrivateFieldGet(_playerData, this).mediaData, _classPrivateFieldGet(_playerData, this).embedOptions));
		_assertClassBrand(_WistiaPlayer_brand, this, _renderPreloadThumbnail).call(this);
		_assertClassBrand(_WistiaPlayer_brand, this, _maybeInjectJsonLd).call(this);
	}
	if ("attachInternals" in HTMLElement.prototype && "states" in ElementInternals.prototype) {
		var _classPrivateFieldGet124;
		(_classPrivateFieldGet124 = _classPrivateFieldGet(_internals, this)) === null || _classPrivateFieldGet124 === void 0 || _classPrivateFieldGet124.states.delete("--initializing");
	}
	_assertClassBrand(_WistiaPlayer_brand, this, _initPublicApi).call(this, this.mediaId, {
		container,
		mediaData
	});
}
/**
* Initializes the public api instance and sends a ready event
* @param {number | string} mediaId - The media id
* @param {EmbedOptions | PublicApiOptions | undefined} options - The public api options
* @returns {Promise<void>}
*/
function _initPublicApi(_x21, _x22) {
	return _initPublicApi2.apply(this, arguments);
}
function _initPublicApi2() {
	_initPublicApi2 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee27(mediaId, options) {
		var _this19 = this;
		var embeddedCallback;
		return _regenerator().w(function(_context27) {
			while (1) switch (_context27.n) {
				case 0:
					_context27.n = 1;
					return _classPrivateFieldGet(_publicApiScript, this);
				case 1:
					if (_wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.PublicApi) {
						_context27.n = 2;
						break;
					}
					(0, _utilities_simpleMetrics_js__WEBPACK_IMPORTED_MODULE_24__.WO)("player/failure/init-failed");
					throw new Error("Wistia.PublicApi is not defined");
				case 2:
					embeddedCallback = function embeddedCallback() {
						_assertClassBrand(_WistiaPlayer_brand, _this19, _maybeInitializeMux).call(_this19);
						_assertClassBrand(_WistiaPlayer_brand, _this19, _renderEmbedTemplate).call(_this19);
						if (_classPrivateFieldGet(_playPending, _this19)) _this19.play();
					};
					this.addEventListener("embedded", embeddedCallback);
					_classPrivateFieldGet(_removeEventListeners, this).push(function() {
						_this19.removeEventListener("embedded", embeddedCallback);
					});
					_classPrivateFieldSet(_api, this, new _wistia_namespace_ts__WEBPACK_IMPORTED_MODULE_3__.s.PublicApi(mediaId, options));
					this.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.kY, _classPrivateFieldGet(_handleBeforeReplace, this));
					this.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.$1, _classPrivateFieldGet(_handleAfterReplace, this));
					_classPrivateFieldGet(_removeEventListeners, this).push(function() {
						_this19.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.kY, _classPrivateFieldGet(_handleBeforeReplace, _this19));
						_this19.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.$1, _classPrivateFieldGet(_handleAfterReplace, _this19));
					});
					_classPrivateFieldGet(_api, this).ready(function() {
						var _classPrivateFieldGet131;
						(_classPrivateFieldGet131 = _classPrivateFieldGet(_resizeObserver, _this19)) === null || _classPrivateFieldGet131 === void 0 || _classPrivateFieldGet131.disconnect();
						_classPrivateFieldSet(_resizeObserver, _this19, null);
						_assertClassBrand(_WistiaPlayer_brand, _this19, _destroyPreloadThumbnailRoot).call(_this19);
						_this19.removeEventListener("click", _classPrivateFieldGet(_handlePreloadThumbnailClick, _this19));
						_this19.dispatchEvent(new CustomEvent(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.c5, { detail: { mediaId } }));
						_this19.dispatchEvent(new CustomEvent(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.iP, { detail: {
							mediaId,
							api: _classPrivateFieldGet(_api, _this19)
						} }));
						_assertClassBrand(_WistiaPlayer_brand, _this19, _maybeSetupLLMOptimizedEmbed).call(_this19);
						if (_classPrivateFieldGet(_impl, _this19)) Object.entries(_classPrivateFieldGet(_impl, _this19)._attrs).forEach(function(_ref27) {
							var _ref28 = _slicedToArray(_ref27, 2), key = _ref28[0], value = _ref28[1];
							_classPrivateFieldGet(_playerData, _this19).updateEmbedOptionOverrides(_defineProperty({}, key, value));
						});
						_assertClassBrand(_WistiaPlayer_brand, _this19, _renderPreloadThumbnail).call(_this19);
					});
				case 3: return _context27.a(2);
			}
		}, _callee27, this);
	}));
	return _initPublicApi2.apply(this, arguments);
}
/**
* Returns if this player is a popover embed with a thumbnail.
* @returns {boolean}
*/
function _isPopoverWithThumbnail() {
	return this.wistiaPopover && ((0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_1__.gD)(this.popoverContent) || (0, _wistia_type_guards__WEBPACK_IMPORTED_MODULE_1__.jw)(this.popoverContent) || this.popoverContent === "thumbnail");
}
/**
* Do a coin flip to determine if Mux should be enabled
* And enable Mux for the player if the coin flip is a win
* @returns {Promise<void>}
*/
function _maybeInitializeMux() {
	return _maybeInitializeMux2.apply(this, arguments);
}
function _maybeInitializeMux2() {
	_maybeInitializeMux2 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee28() {
		var _this20 = this;
		var shouldRandomEnableMux, shouldEnableMuxForPlayer, embedType, mux, _t4;
		return _regenerator().w(function(_context28) {
			while (1) switch (_context28.p = _context28.n) {
				case 0:
					if (_classPrivateFieldGet(_api, this)) {
						_context28.n = 1;
						break;
					}
					return _context28.a(2);
				case 1:
					shouldRandomEnableMux = (0, _utilities_coinFlip_ts__WEBPACK_IMPORTED_MODULE_10__.k)(_utilities_shouldEnableMux_ts__WEBPACK_IMPORTED_MODULE_23__._);
					shouldEnableMuxForPlayer = (0, _utilities_shouldEnableMux_ts__WEBPACK_IMPORTED_MODULE_23__.J)(_classPrivateFieldGet(_api, this), shouldRandomEnableMux) && (0, _utilities_trackingConsentApi_js__WEBPACK_IMPORTED_MODULE_25__.D5)();
					embedType = this.useWebComponent ? "translated-web-component" : "web-component";
					if (!shouldEnableMuxForPlayer) {
						_context28.n = 6;
						break;
					}
					_context28.p = 2;
					_context28.n = 3;
					return (0, _utilities_dynamicImport_ts__WEBPACK_IMPORTED_MODULE_12__.$)("assets/external/wistia-mux.js");
				case 3:
					mux = _context28.v;
					mux.init(_classPrivateFieldGet(_api, this), { embedType });
					_context28.n = 5;
					break;
				case 4:
					_context28.p = 4;
					_context28.v;
				case 5: this.addEventListener("visitor-tracking-change", function(event) {
					if (!event.detail.isTrackingEnabled) {
						var _classPrivateFieldGet133, _classPrivateFieldGet134;
						(_classPrivateFieldGet133 = _classPrivateFieldGet(_api, _this20)) === null || _classPrivateFieldGet133 === void 0 || (_classPrivateFieldGet134 = _classPrivateFieldGet133.mux) == null || _classPrivateFieldGet134.destroy();
					}
				});
				case 6: return _context28.a(2);
			}
		}, _callee28, this, [[2, 4]]);
	}));
	return _maybeInitializeMux2.apply(this, arguments);
}
function _maybeInjectJsonLd() {
	if (this.seo && _classPrivateFieldGet(_playerType, this) !== "notplayable" && _classPrivateFieldGet(_playerType, this) !== "passwordprotected" && _classPrivateFieldGet(_playerType, this) !== "carouselHardWall") {
		_classPrivateFieldSet(_jsonLdId, this, "w-json-ld-".concat(this.uniqueId));
		(0, _utilities_injectJsonLd_js__WEBPACK_IMPORTED_MODULE_31__.Z)(_classPrivateFieldGet(_jsonLdId, this));
		(0, _utilities_injectJsonLd_js__WEBPACK_IMPORTED_MODULE_31__.g)(_classPrivateFieldGet(_jsonLdId, this), _classPrivateFieldGet(_playerData, this).mediaData, {
			embedOptions: _classPrivateFieldGet(_playerData, this).embedOptions,
			videoHeight: this.offsetHeight,
			videoWidth: this.offsetWidth
		});
	}
}
function _maybeSetupEmbedOptionsFromIframe() {
	if (!window._inWistiaIframe) return;
	var searchParams = new URLSearchParams(window.location.search);
	var iframeEmbedOptions = Object.fromEntries(searchParams.entries());
	iframeEmbedOptions.pageTitle = document.title;
	iframeEmbedOptions._inIframe = true;
	_classPrivateFieldGet(_playerData, this).setIframeEmbedOptionSource(iframeEmbedOptions);
}
function _maybeSetupLLMOptimizedEmbed() {
	var preloadTranscriptForLLMEmbed = this.querySelector(".wistia_preload_transcript_outer_wrapper");
	if (!preloadTranscriptForLLMEmbed) return;
	(0, _utilities_simpleMetrics_js__WEBPACK_IMPORTED_MODULE_24__.WO)("player/initembed.llm-optimized", 1, {
		href: window.location.href,
		mediaId: this.mediaId
	});
	preloadTranscriptForLLMEmbed.remove();
	this.captionsEnabled = true;
}
/**
* Renders a template for the embed code
* @returns {HTMLTemplateElement}
*/
function _renderEmbedTemplate() {
	var _this$embedHost2, _this13 = this;
	if (!_classPrivateFieldGet(_preactRoot, this)) return;
	var mediaType = _classPrivateFieldGet(_playerData, this).mediaData.mediaType;
	var swatchUrl = getSwatchUrl(this.mediaId, (_this$embedHost2 = this.embedHost) !== null && _this$embedHost2 !== void 0 ? _this$embedHost2 : "");
	var swatchHeight = "100%";
	if (parseFloat(_classPrivateFieldGet(_paddingTop, this)) !== 0 && _classPrivateFieldGet(_paddingTop, this) !== "") swatchHeight = "".concat(parseFloat(_classPrivateFieldGet(_paddingTop, this)), "px");
	var playerBorderRadius = (0, _utilities_roundedPlayerDefaults_ts__WEBPACK_IMPORTED_MODULE_20__.JA)({
		playerBorderRadius: this.playerBorderRadius,
		roundedPlayer: this.roundedPlayer
	});
	(0, preact__WEBPACK_IMPORTED_MODULE_0__.render)((0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(preact__WEBPACK_IMPORTED_MODULE_0__.Fragment, null, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("style", null, ":host {\n              display: flex;\n              position: relative;\n              width: 100%;\n              ".concat(mediaType === "Audio" ? "height: ".concat(_utilities_constants_ts__WEBPACK_IMPORTED_MODULE_6__.Lc, "px; min-height: 45px;") : "", "\n            }")), _assertClassBrand(_WistiaPlayer_brand, this, _shouldDisplaySwatch).call(this) && (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", {
		style: {
			height: swatchHeight,
			left: 0,
			position: "absolute",
			top: 0,
			width: "100%"
		},
		class: "wistia_swatch"
	}, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { style: {
		height: "100%",
		position: "relative",
		width: "100%"
	} }, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { style: {
		height: "100%",
		left: 0,
		overflow: "hidden",
		position: "absolute",
		top: 0,
		width: "100%",
		borderRadius: "".concat(playerBorderRadius, "px")
	} }, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("img", {
		src: swatchUrl,
		style: {
			filter: "blur(5px)",
			height: "100%",
			objectFit: "contain",
			width: "100%"
		},
		alt: "",
		"aria-hidden": "true"
	})))), (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { ref: function ref(_ref23) {
		_classPrivateFieldSet(_preloadThumbnailRoot, _this13, _ref23);
	} })), _classPrivateFieldGet(_preactRoot, this));
}
/**
* Renders a progressive thumbnail and a big play button as soon as possible,
* while the rest of the player is loading.
* @returns {void}
*/
function _renderPreloadThumbnail() {
	var _this$playerForce;
	if (!_classPrivateFieldGet(_preloadThumbnailRoot, this)) return;
	var _classPrivateFieldGet125 = _classPrivateFieldGet(_playerData, this).mediaData, assets = _classPrivateFieldGet125.assets, mediaType = _classPrivateFieldGet125.mediaType, carouselHardWall = _classPrivateFieldGet125.carouselHardWall;
	var _classPrivateFieldGet126 = _classPrivateFieldGet(_playerData, this).embedOptions, autoPlay = _classPrivateFieldGet126.autoPlay, plugin = _classPrivateFieldGet126.plugin;
	if (carouselHardWall) return;
	var thumbnailAssets = (0, _utilities_assets_js__WEBPACK_IMPORTED_MODULE_9__.Q0)(assets, {});
	if (!((!this.wistiaPopover || _assertClassBrand(_WistiaPlayer_brand, this, _isPopoverWithThumbnail).call(this)) && mediaType !== "Audio" && thumbnailAssets.length > 0)) return;
	var willAutoplay = this.autoplay || autoPlay;
	var hasVideoThumbnail = (plugin === null || plugin === void 0 ? void 0 : plugin.videoThumbnail) !== void 0;
	if (willAutoplay === true || hasVideoThumbnail) {
		var height = this.offsetWidth / this.aspect;
		(0, preact__WEBPACK_IMPORTED_MODULE_0__.render)((0, preact__WEBPACK_IMPORTED_MODULE_0__.h)("div", { style: {
			width: "100%",
			height: "".concat(height, "px")
		} }), _classPrivateFieldGet(_preloadThumbnailRoot, this));
		return;
	}
	(0, preact__WEBPACK_IMPORTED_MODULE_0__.render)((0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(_hooks_usePlayerData_tsx__WEBPACK_IMPORTED_MODULE_5__.z, {
		embedOptions: _classPrivateFieldGet(_playerData, this).embedOptions,
		mediaData: _classPrivateFieldGet(_playerData, this).mediaData
	}, (0, preact__WEBPACK_IMPORTED_MODULE_0__.h)(_components_PreloadThumbnail_tsx__WEBPACK_IMPORTED_MODULE_4__.u, {
		mediaId: this.mediaId,
		playerType: (_this$playerForce = this.playerForce) !== null && _this$playerForce !== void 0 ? _this$playerForce : _classPrivateFieldGet(_playerType, this),
		playerWidth: this.offsetWidth,
		isPlayPending: _classPrivateFieldGet(_playPending, this)
	})), _classPrivateFieldGet(_preloadThumbnailRoot, this));
}
/**
* Runs any methods associated with set attributes when the element is connected to the DOM
* @returns {void}
* @private
*/
function _runMethodsFromAttributes() {
	var _this14 = this;
	if (_assertClassBrand(_WistiaPlayer_brand, this, _getValueFromAttribute).call(this, "current-time") !== null) this.whenApiReady().then(function() {
		var _ref24, _classPrivateFieldGet127, _classPrivateFieldGet128;
		var newTime = Number(_assertClassBrand(_WistiaPlayer_brand, _this14, _getValueFromAttribute).call(_this14, "current-time"));
		var isClosedPopover = (_ref24 = ((_classPrivateFieldGet127 = _classPrivateFieldGet(_api, _this14)) === null || _classPrivateFieldGet127 === void 0 ? void 0 : _classPrivateFieldGet127.popover) && !_classPrivateFieldGet(_api, _this14).popover.isVisible()) !== null && _ref24 !== void 0 ? _ref24 : false;
		var isMobile = (0, _utilities_detect_js__WEBPACK_IMPORTED_MODULE_11__.GS)();
		var shouldDelayUntilPlay = _this14.state !== "playing" && (isMobile || isClosedPopover);
		(_classPrivateFieldGet128 = _classPrivateFieldGet(_impl, _this14)) === null || _classPrivateFieldGet128 === void 0 || _classPrivateFieldGet128.time(newTime, { lazy: shouldDelayUntilPlay });
		_assertClassBrand(_WistiaPlayer_brand, _this14, _setSyncedEmbedOption).call(_this14, "currentTime", newTime);
	}).catch(function(_error) {});
	if (_assertClassBrand(_WistiaPlayer_brand, this, _getValueFromAttribute).call(this, "email") !== null) _assertClassBrand(_WistiaPlayer_brand, this, _updateEmail).call(this, _assertClassBrand(_WistiaPlayer_brand, this, _getValueFromAttribute).call(this, "email"));
	if (_assertClassBrand(_WistiaPlayer_brand, this, _getValueFromAttribute).call(this, "video-quality") !== null) this.whenApiReady().then(function() {
		var _classPrivateFieldGet129;
		var newQuality = _assertClassBrand(_WistiaPlayer_brand, _this14, _getValueFromAttribute).call(_this14, "video-quality");
		(_classPrivateFieldGet129 = _classPrivateFieldGet(_impl, _this14)) === null || _classPrivateFieldGet129 === void 0 || _classPrivateFieldGet129.setVideoQuality(newQuality);
		_assertClassBrand(_WistiaPlayer_brand, _this14, _setSyncedEmbedOption).call(_this14, "videoQuality", newQuality);
	}).catch(function(_error) {});
}
/**
* Saves the initial attributes from the DOM to a store so the public api can use them
* @returns {void}
* @private
*/
function _saveInitialAttributesFromDomOptions() {
	var _this15 = this;
	var domOptions = Object.fromEntries(Object.entries(this.attributes).map(function(_ref25) {
		var value = _slicedToArray(_ref25, 2)[1];
		return [(0, _utilities_camelCaseToKebabCase_ts__WEBPACK_IMPORTED_MODULE_35__.b)(value.name), _assertClassBrand(_WistiaPlayer_brand, _this15, _getValueFromAttribute).call(_this15, value.name)];
	}));
	_classPrivateFieldGet(_playerData, this).setDomEmbedOptionSource(domOptions);
	(0, _utilities_embedOptionStore_ts__WEBPACK_IMPORTED_MODULE_13__.gY)("__".concat(this.uniqueId, "_dom_options__"), _classPrivateFieldGet(_playerData, this).embedOptions);
}
/**
* Takes an object of embed options and sets both the value of an
* embed option from the public api and the value of an embed option
* saved on this element.
*
* For now, the public api is the source of truth for embed options.
* However, this will change in the future. We also need a non-public
* api source for embed options so we can use them before the public
* api is ready.
* @param {Partial<EmbedOptions>} options - Object of embed options
* @returns {void}
*/
function _setMultipleSyncedEmbedOptions(options) {
	var _this16 = this;
	Object.entries(options).forEach(function(entry) {
		var _Object$getOwnPropert;
		var _entry = _slicedToArray(entry, 2), key = _entry[0], value = _entry[1];
		if (value == null) return;
		if ((_Object$getOwnPropert = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(_this16), key)) !== null && _Object$getOwnPropert !== void 0 && _Object$getOwnPropert.set) _this16[key] = value;
		else _assertClassBrand(_WistiaPlayer_brand, _this16, _setSyncedEmbedOption).call(_this16, key, value);
	});
}
/**
* Sets both the value of an embed option from the public api
* and the value of an embed option saved on this element.
*
* For now, the public api is the source of truth for embed options.
* However, this will change in the future. We also need a non-public
* api source for embed options so we can use them before the public
* api is ready.
* @param {string} key - Name of the embed option
* @param {boolean | number | string} value - Value of the embed option
* @returns {void}
*/
function _setSyncedEmbedOption(key, value) {
	_classPrivateFieldGet(_logger, this).info("set ".concat(key), value.toString());
	if (_classPrivateFieldGet(_impl, this)) _classPrivateFieldGet(_impl, this)._attrs[key] = value;
	_classPrivateFieldGet(_playerData, this).updateEmbedOptionOverrides(_defineProperty({}, key, value));
	_assertClassBrand(_WistiaPlayer_brand, this, _renderPreloadThumbnail).call(this);
}
function _setupEventListeners() {
	var _this17 = this;
	var loadedMediaDataCallback = function loadedMediaDataCallback(event) {
		_assertClassBrand(_WistiaPlayer_brand, _this17, _updateMediaData).call(_this17, event.detail.mediaData);
	};
	var implCreatedCallback = function implCreatedCallback(event) {
		_classPrivateFieldSet(_impl, _this17, event.detail.impl);
	};
	this.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.rO, loadedMediaDataCallback);
	this.addEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.dp, implCreatedCallback);
	_classPrivateFieldGet(_removeEventListeners, this).push(function() {
		_this17.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.rO, loadedMediaDataCallback);
	}, function() {
		_this17.removeEventListener(_utilities_eventConstants_ts__WEBPACK_IMPORTED_MODULE_15__.dp, implCreatedCallback);
	});
	this.addEventListener("click", _classPrivateFieldGet(_handlePreloadThumbnailClick, this), { once: true });
}
/**
* Determines if a swatch should be displayed based on the embed options
* @returns {boolean}
*/
function _shouldDisplaySwatch() {
	return this.swatch !== false && (!this.wistiaPopover || _assertClassBrand(_WistiaPlayer_brand, this, _isPopoverWithThumbnail).call(this));
}
/**
* Saves new email within localstorage and dispatches an emailchange event
* @param {string} email - The new email
* @returns {void}
* @emits {EmailChangeEventData}
* @private
*/
function _updateEmail(email) {
	var _this18 = this;
	(0, _utilities_wistiaLocalStorage_js__WEBPACK_IMPORTED_MODULE_27__.$B)(function(localStorage) {
		localStorage[_classPrivateGetter(_WistiaPlayer_brand, _this18, _get_pageUrl)] = _objectSpread(_objectSpread({}, localStorage[_classPrivateGetter(_WistiaPlayer_brand, _this18, _get_pageUrl)]), {}, { trackEmail: email });
	});
	this.dispatchEvent(new CustomEvent("emailchange", { detail: { email } }));
}
/**
* Called when we have new mediadata for the player
* @param {MediaData} mediaData
* @returns {void}
* @private
*/
function _updateMediaData(mediaData) {
	if ((0, _utilities_mediaDataError_ts__WEBPACK_IMPORTED_MODULE_33__.V)(mediaData)) return;
	_classPrivateFieldGet(_playerData, this).setMediaDataSource(mediaData);
	_classPrivateFieldSet(_playerType, this, (0, _utilities_judy_js__WEBPACK_IMPORTED_MODULE_19__.$F)(_classPrivateFieldGet(_judyContext, this), _classPrivateFieldGet(_playerData, this).mediaData, _classPrivateFieldGet(_playerData, this).embedOptions));
	_assertClassBrand(_WistiaPlayer_brand, this, _renderPreloadThumbnail).call(this);
}
var getSwatchMetaData = /*#__PURE__*/ function() {
	var _ref18 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee25(url) {
		var swatch;
		return _regenerator().w(function(_context25) {
			while (1) switch (_context25.n) {
				case 0:
					swatch = new Image();
					swatch.src = url;
					_context25.n = 1;
					return swatch.decode();
				case 1: return _context25.a(2, swatch);
			}
		}, _callee25);
	}));
	return function getSwatchMetaData(_x18) {
		return _ref18.apply(this, arguments);
	};
}();
/**
* Takes a media id and returns a swatch style element once we
* have the swatch image metadata to calculate the aspect ratio
* @param {string} mediaId
* @returns {Promise<HTMLStyleElement>}
*/
var wistiaSwatchElement = /*#__PURE__*/ function() {
	var _ref19 = _asyncToGenerator(/*#__PURE__*/ _regenerator().m(function _callee26(mediaId, embedHost) {
		var swatchUrl, swatchImg, naturalHeight, naturalWidth, ratio, style;
		return _regenerator().w(function(_context26) {
			while (1) switch (_context26.n) {
				case 0:
					swatchUrl = getSwatchUrl(mediaId, embedHost);
					_context26.n = 1;
					return getSwatchMetaData(swatchUrl);
				case 1:
					swatchImg = _context26.v;
					naturalHeight = swatchImg.naturalHeight, naturalWidth = swatchImg.naturalWidth;
					ratio = naturalHeight / naturalWidth * 100;
					style = document.createElement("style");
					style.innerHTML = "\n    wistia-player[media-id='".concat(mediaId, "']:not(:defined) {\n      padding: ").concat(ratio, "% 0 0 0;\n      background: url(").concat(swatchUrl, ");\n      background-size: contain;\n      filter: blur(5px);\n      display: block;\n    }\n  ");
					return _context26.a(2, style);
			}
		}, _callee26);
	}));
	return function wistiaSwatchElement(_x19, _x20) {
		return _ref19.apply(this, arguments);
	};
}();
if (customElements.get("wistia-player") === void 0) customElements.define("wistia-player", WistiaPlayer);
const __webpack_exports__WistiaPlayer = __webpack_exports__.$;
const __webpack_exports__wistiaSwatchElement = __webpack_exports__.A;

//#endregion
//#region ../adapters/wistia-video/dist/dev/adapter.js
/**
* Wistia is the one media here that ships a web component of its own, so this is that component rather than a wrapper
* around one; the platform packages give it a tag and a player store.
*
* `normalizeWistiaPlayer` gives the player the members and events `HTMLMediaElement` has that Wistia names differently
* or not at all. This class does the rest: the attributes a media element is written with, which Wistia has its own
* names, spellings, and defaults for.
*/
var WistiaAdapter = class extends __webpack_exports__WistiaPlayer {
	static {
		this.defaultProps = {
			src: "",
			autoplay: false,
			defaultMuted: false,
			muted: false,
			loop: false,
			controls: false,
			playsInline: true,
			preload: "metadata",
			poster: "",
			source: null
		};
	}
	static get observedAttributes() {
		return [...__webpack_exports__WistiaPlayer.observedAttributes, ...Object.keys(MEDIA_ATTRIBUTES)];
	}
	constructor() {
		super();
		normalizeWistiaPlayer(this);
	}
	connectedCallback() {
		super.connectedCallback?.();
		applyOptions(this);
	}
	attributeChangedCallback(name, oldValue, newValue) {
		const apply = MEDIA_ATTRIBUTES[name];
		if (!apply) {
			super.attributeChangedCallback(name, oldValue, newValue);
			return;
		}
		if (oldValue !== newValue) apply(this, newValue);
	}
};
/**
* What each attribute a media element is written with does to a Wistia player.
*
* The five that configure the player go through `applyOptions` together, which is what lets `controls` going away put
* the player back the way this media would have had it rather than the way Wistia would. Wistia observes `autoplay`,
* `poster`, and `preload` too, and these readings win. The other three mean something on their own: Wistia has no `src`
* and names its media by id, `muted` is the state to start in rather than the live one a mute button drives, and
* `playsinline` goes no further since Wistia plays inline anyway.
*/
const MEDIA_ATTRIBUTES = {
	autoplay: applyOptions,
	controls: applyOptions,
	loop: applyOptions,
	poster: applyOptions,
	preload: applyOptions,
	muted: (player, value) => {
		player.defaultMuted = value !== null;
	},
	playsinline: (player, value) => {
		player.playsInline = value !== null;
	},
	src: (player, value) => {
		player.src = value ?? "";
	}
};
/** The player's whole configuration, worked out from scratch: cheaper than keeping it up to date piecemeal. */
function applyOptions(player) {
	const controls = player.hasAttribute("controls");
	Object.assign(player, wistiaMediaOptions({
		autoplay: player.hasAttribute("autoplay"),
		controls,
		loop: player.hasAttribute("loop"),
		poster: player.getAttribute("poster") ?? void 0,
		preload: player.getAttribute("preload") ?? void 0
	}));
	if (player.source) Object.assign(player, player.source);
	Object.assign(player.style, wistiaPlayerStyle(controls));
}

//#endregion
//#region ../html/dist/dev/media/wistia-video/adapter.js
/**
* `<wistia-video>` is Wistia's own `<wistia-player>`, normalized into a media by `WistiaAdapter` and attached to the
* player store here. No template and no inner player: the element written is the element that plays.
*/
var WistiaVideo = class extends MediaAttachMixin(WistiaAdapter) {};

//#endregion
//#region ../html/dist/dev/define/media/wistia-video.js
var WistiaVideoElement = class extends WistiaVideo {
	static {
		this.tagName = "wistia-video";
	}
};
safeDefine(WistiaVideoElement);

//#endregion
export { WistiaVideoElement };
//# sourceMappingURL=wistia-video.dev.js.map