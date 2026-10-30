/*! Video.js | https://videojs.org/help */
import { d as isString, f as isUndefined, o as isNull } from "../predicate-3rF1m2uv.js";
import { t as deepEqual } from "../deep-equal-mHeggeG2.js";
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { a as escapeHtml } from "../attributes-CI6LN9fK.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as createPublicPromise, t as MediaPlayedRangesMixin } from "../media-played-ranges-B4JAhSRt.js";
import { t as tryCall } from "../try-call-CA5eo1yN.js";
import { n as EMPTY_TEXT_TRACKS, r as EMPTY_TIME_RANGES } from "../constants-CMPy89v9.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as serializeEmbedParams } from "../embed-params-b1s4s7nw.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../media/dist/dev/core/source/vimeo.js
/**
* Parse a Vimeo source: a numeric id, a `vimeo/<id>` shorthand, `vimeo.com/<id>`, `vimeo.com/video/<id>`,
* `player.vimeo.com/video/<id>`, or `vimeo.com/event/<id>` (live events), plus unlisted/event hashes from `?h=` or a
* `/<hash>` segment. Shorthands also take the hash from `?hash=`.
*
* @internal
*/
function parseVimeoSource(src) {
	if (!src) return null;
	if (/^\d+$/.test(src)) return {
		id: Number(src),
		kind: "video",
		hash: null
	};
	const shorthand = SHORTHAND_SRC.exec(src);
	if (shorthand) return {
		id: Number(shorthand[1]),
		kind: "video",
		hash: shorthand[2] ?? null
	};
	const match = MATCH_SRC.exec(src);
	if (!match) return null;
	const kind = match[1] === "event/" ? "event" : "video";
	let queryHash = null;
	try {
		queryHash = new URL(src).searchParams.get("h");
	} catch {}
	return {
		id: Number(match[2]),
		kind,
		hash: queryHash ?? match[3] ?? null
	};
}
const SHORTHAND_SRC = /^vimeo\/(?:video\/)?(\d+)(?:(?:\?hash=|\?h=|\/)([\w-]+))?$/;
const MATCH_SRC = /vimeo\.com\/(video\/|event\/)?(\d+)(?:\/([\w-]+))?/;

//#endregion
//#region ../../node_modules/.pnpm/@vimeo+player@2.30.3/node_modules/@vimeo/player/dist/player.es.js
/*! @vimeo/player v2.30.3 | (c) 2026 Vimeo | MIT License | https://github.com/vimeo/player.js */
/**
* @module lib/functions
*/
/**
* Check to see this is a Node environment.
* @type {boolean}
*/
const isNode = typeof global !== "undefined" && {}.toString.call(global) === "[object global]";
/**
* Check to see if this is a Bun environment.
* @see https://bun.sh/guides/util/detect-bun
* @type {boolean}
*/
const isBun = typeof Bun !== "undefined";
/**
* Check to see if this is a Deno environment.
* @see https://docs.deno.com/api/deno/~/Deno
* @type {boolean}
*/
const isDeno = typeof Deno !== "undefined";
/**
* Check to see if this is a Cloudflare Worker environment.
* @see https://community.cloudflare.com/t/how-to-detect-the-cloudflare-worker-runtime/293715
* @type {boolean}
*/
const isCloudflareWorker = typeof WebSocketPair === "function" && typeof caches?.default !== "undefined";
/**
* Check if this is a server runtime
* @type {boolean}
*/
const isServerRuntime = isNode || isBun || isDeno || isCloudflareWorker;
/**
* Get the name of the method for a given getter or setter.
*
* @param {string} prop The name of the property.
* @param {string} type Either “get” or “set”.
* @return {string}
*/
function getMethodName(prop, type) {
	if (prop.indexOf(type.toLowerCase()) === 0) return prop;
	return `${type.toLowerCase()}${prop.substr(0, 1).toUpperCase()}${prop.substr(1)}`;
}
/**
* Check to see if the object is a DOM Element.
*
* @param {*} element The object to check.
* @return {boolean}
*/
function isDomElement(element) {
	return Boolean(element && element.nodeType === 1 && "nodeName" in element && element.ownerDocument && element.ownerDocument.defaultView);
}
/**
* Check to see whether the value is a number.
*
* @see http://dl.dropboxusercontent.com/u/35146/js/tests/isNumber.html
* @param {*} value The value to check.
* @param {boolean} integer Check if the value is an integer.
* @return {boolean}
*/
function isInteger(value) {
	return !isNaN(parseFloat(value)) && isFinite(value) && Math.floor(value) == value;
}
/**
* Check to see if the URL is a Vimeo url.
*
* @param {string} url The url string.
* @return {boolean}
*/
function isVimeoUrl(url) {
	return /^(https?:)?\/\/((((player|www)\.)?vimeo\.com)|((player\.)?[a-zA-Z0-9-]+\.(videoji\.(hk|cn)|vimeo\.work)))(?=$|\/)/.test(url);
}
/**
* Check to see if the URL is for a Vimeo embed.
*
* @param {string} url The url string.
* @return {boolean}
*/
function isVimeoEmbed(url) {
	return /^https:\/\/player\.((vimeo\.com)|([a-zA-Z0-9-]+\.(videoji\.(hk|cn)|vimeo\.work)))\/video\/\d+/.test(url);
}
function getOembedDomain(url) {
	const match = (url || "").match(/^(?:https?:)?(?:\/\/)?([^/?]+)/);
	const domain = (match && match[1] || "").replace("player.", "");
	for (const customDomain of [
		".videoji.hk",
		".vimeo.work",
		".videoji.cn"
	]) if (domain.endsWith(customDomain)) return domain;
	return "vimeo.com";
}
/**
* Get the Vimeo URL from an element.
* The element must have either a data-vimeo-id or data-vimeo-url attribute.
*
* @param {object} oEmbedParameters The oEmbed parameters.
* @return {string}
*/
function getVimeoUrl() {
	let oEmbedParameters = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
	const id = oEmbedParameters.id;
	const url = oEmbedParameters.url;
	const idOrUrl = id || url;
	if (!idOrUrl) throw new Error("An id or url must be passed, either in an options object or as a data-vimeo-id or data-vimeo-url attribute.");
	if (isInteger(idOrUrl)) return `https://vimeo.com/${idOrUrl}`;
	if (isVimeoUrl(idOrUrl)) return idOrUrl.replace("http:", "https:");
	if (id) throw new TypeError(`“${id}” is not a valid video id.`);
	throw new TypeError(`“${idOrUrl}” is not a vimeo.com url.`);
}
/**
* A utility method for attaching and detaching event handlers
*
* @param {EventTarget} target
* @param {string | string[]} eventName
* @param {function} callback
* @param {'addEventListener' | 'on'} onName
* @param {'removeEventListener' | 'off'} offName
* @return {{cancel: (function(): void)}}
*/
const subscribe = function(target, eventName, callback) {
	let onName = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : "addEventListener";
	let offName = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : "removeEventListener";
	const eventNames = typeof eventName === "string" ? [eventName] : eventName;
	eventNames.forEach((evName) => {
		target[onName](evName, callback);
	});
	return { cancel: () => eventNames.forEach((evName) => target[offName](evName, callback)) };
};
/**
* Find the iframe element that contains a specific source window
*
* @param {Window} sourceWindow The source window to find the iframe for
* @param {Document} [doc=document] The document to search within
* @return {HTMLIFrameElement|null} The iframe element if found, otherwise null
*/
function findIframeBySourceWindow(sourceWindow) {
	let doc = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : document;
	if (!sourceWindow || !doc || typeof doc.querySelectorAll !== "function") return null;
	const iframes = doc.querySelectorAll("iframe");
	for (let i = 0; i < iframes.length; i++) if (iframes[i] && iframes[i].contentWindow === sourceWindow) return iframes[i];
	return null;
}
const arrayIndexOfSupport = typeof Array.prototype.indexOf !== "undefined";
const postMessageSupport = typeof window !== "undefined" && typeof window.postMessage !== "undefined";
if (!isServerRuntime && (!arrayIndexOfSupport || !postMessageSupport)) throw new Error("Sorry, the Vimeo Player API is not available in this browser.");
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}
/*!
* weakmap-polyfill v2.0.4 - ECMAScript6 WeakMap polyfill
* https://github.com/polygonplanet/weakmap-polyfill
* Copyright (c) 2015-2021 polygonplanet <polygon.planet.aqua@gmail.com>
* @license MIT
*/
(function(self) {
	if (self.WeakMap) return;
	var hasOwnProperty = Object.prototype.hasOwnProperty;
	var hasDefine = Object.defineProperty && function() {
		try {
			return Object.defineProperty({}, "x", { value: 1 }).x === 1;
		} catch (e) {}
	}();
	var defineProperty = function(object, name, value) {
		if (hasDefine) Object.defineProperty(object, name, {
			configurable: true,
			writable: true,
			value
		});
		else object[name] = value;
	};
	self.WeakMap = function() {
		function WeakMap() {
			if (this === void 0) throw new TypeError("Constructor WeakMap requires 'new'");
			defineProperty(this, "_id", genId("_WeakMap"));
			if (arguments.length > 0) throw new TypeError("WeakMap iterable is not supported");
		}
		defineProperty(WeakMap.prototype, "delete", function(key) {
			checkInstance(this, "delete");
			if (!isObject(key)) return false;
			var entry = key[this._id];
			if (entry && entry[0] === key) {
				delete key[this._id];
				return true;
			}
			return false;
		});
		defineProperty(WeakMap.prototype, "get", function(key) {
			checkInstance(this, "get");
			if (!isObject(key)) return;
			var entry = key[this._id];
			if (entry && entry[0] === key) return entry[1];
		});
		defineProperty(WeakMap.prototype, "has", function(key) {
			checkInstance(this, "has");
			if (!isObject(key)) return false;
			var entry = key[this._id];
			if (entry && entry[0] === key) return true;
			return false;
		});
		defineProperty(WeakMap.prototype, "set", function(key, value) {
			checkInstance(this, "set");
			if (!isObject(key)) throw new TypeError("Invalid value used as weak map key");
			var entry = key[this._id];
			if (entry && entry[0] === key) {
				entry[1] = value;
				return this;
			}
			defineProperty(key, this._id, [key, value]);
			return this;
		});
		function checkInstance(x, methodName) {
			if (!isObject(x) || !hasOwnProperty.call(x, "_id")) throw new TypeError(methodName + " method called on incompatible receiver " + typeof x);
		}
		function genId(prefix) {
			return prefix + "_" + rand() + "." + rand();
		}
		function rand() {
			return Math.random().toString().substring(2);
		}
		defineProperty(WeakMap, "_polyfill", true);
		return WeakMap;
	}();
	function isObject(x) {
		return Object(x) === x;
	}
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof commonjsGlobal !== "undefined" ? commonjsGlobal : commonjsGlobal);
var npo_src = createCommonjsModule(function(module) {
	/*! Native Promise Only
	v0.8.1 (c) Kyle Simpson
	MIT License: http://getify.mit-license.org
	*/
	(function UMD(name, context, definition) {
		context[name] = context[name] || definition();
		if (module.exports) module.exports = context[name];
	})("Promise", typeof commonjsGlobal != "undefined" ? commonjsGlobal : commonjsGlobal, function DEF() {
		var builtInProp, cycle, scheduling_queue, ToString = Object.prototype.toString, timer = typeof setImmediate != "undefined" ? function timer(fn) {
			return setImmediate(fn);
		} : setTimeout;
		try {
			Object.defineProperty({}, "x", {});
			builtInProp = function builtInProp(obj, name, val, config) {
				return Object.defineProperty(obj, name, {
					value: val,
					writable: true,
					configurable: config !== false
				});
			};
		} catch (err) {
			builtInProp = function builtInProp(obj, name, val) {
				obj[name] = val;
				return obj;
			};
		}
		scheduling_queue = function Queue() {
			var first, last, item;
			function Item(fn, self) {
				this.fn = fn;
				this.self = self;
				this.next = void 0;
			}
			return {
				add: function add(fn, self) {
					item = new Item(fn, self);
					if (last) last.next = item;
					else first = item;
					last = item;
					item = void 0;
				},
				drain: function drain() {
					var f = first;
					first = last = cycle = void 0;
					while (f) {
						f.fn.call(f.self);
						f = f.next;
					}
				}
			};
		}();
		function schedule(fn, self) {
			scheduling_queue.add(fn, self);
			if (!cycle) cycle = timer(scheduling_queue.drain);
		}
		function isThenable(o) {
			var _then, o_type = typeof o;
			if (o != null && (o_type == "object" || o_type == "function")) _then = o.then;
			return typeof _then == "function" ? _then : false;
		}
		function notify() {
			for (var i = 0; i < this.chain.length; i++) notifyIsolated(this, this.state === 1 ? this.chain[i].success : this.chain[i].failure, this.chain[i]);
			this.chain.length = 0;
		}
		function notifyIsolated(self, cb, chain) {
			var ret, _then;
			try {
				if (cb === false) chain.reject(self.msg);
				else {
					if (cb === true) ret = self.msg;
					else ret = cb.call(void 0, self.msg);
					if (ret === chain.promise) chain.reject(TypeError("Promise-chain cycle"));
					else if (_then = isThenable(ret)) _then.call(ret, chain.resolve, chain.reject);
					else chain.resolve(ret);
				}
			} catch (err) {
				chain.reject(err);
			}
		}
		function resolve(msg) {
			var _then, self = this;
			if (self.triggered) return;
			self.triggered = true;
			if (self.def) self = self.def;
			try {
				if (_then = isThenable(msg)) schedule(function() {
					var def_wrapper = new MakeDefWrapper(self);
					try {
						_then.call(msg, function $resolve$() {
							resolve.apply(def_wrapper, arguments);
						}, function $reject$() {
							reject.apply(def_wrapper, arguments);
						});
					} catch (err) {
						reject.call(def_wrapper, err);
					}
				});
				else {
					self.msg = msg;
					self.state = 1;
					if (self.chain.length > 0) schedule(notify, self);
				}
			} catch (err) {
				reject.call(new MakeDefWrapper(self), err);
			}
		}
		function reject(msg) {
			var self = this;
			if (self.triggered) return;
			self.triggered = true;
			if (self.def) self = self.def;
			self.msg = msg;
			self.state = 2;
			if (self.chain.length > 0) schedule(notify, self);
		}
		function iteratePromises(Constructor, arr, resolver, rejecter) {
			for (var idx = 0; idx < arr.length; idx++) (function IIFE(idx) {
				Constructor.resolve(arr[idx]).then(function $resolver$(msg) {
					resolver(idx, msg);
				}, rejecter);
			})(idx);
		}
		function MakeDefWrapper(self) {
			this.def = self;
			this.triggered = false;
		}
		function MakeDef(self) {
			this.promise = self;
			this.state = 0;
			this.triggered = false;
			this.chain = [];
			this.msg = void 0;
		}
		function Promise(executor) {
			if (typeof executor != "function") throw TypeError("Not a function");
			if (this.__NPO__ !== 0) throw TypeError("Not a promise");
			this.__NPO__ = 1;
			var def = new MakeDef(this);
			this["then"] = function then(success, failure) {
				var o = {
					success: typeof success == "function" ? success : true,
					failure: typeof failure == "function" ? failure : false
				};
				o.promise = new this.constructor(function extractChain(resolve, reject) {
					if (typeof resolve != "function" || typeof reject != "function") throw TypeError("Not a function");
					o.resolve = resolve;
					o.reject = reject;
				});
				def.chain.push(o);
				if (def.state !== 0) schedule(notify, def);
				return o.promise;
			};
			this["catch"] = function $catch$(failure) {
				return this.then(void 0, failure);
			};
			try {
				executor.call(void 0, function publicResolve(msg) {
					resolve.call(def, msg);
				}, function publicReject(msg) {
					reject.call(def, msg);
				});
			} catch (err) {
				reject.call(def, err);
			}
		}
		var PromisePrototype = builtInProp({}, "constructor", Promise, false);
		Promise.prototype = PromisePrototype;
		builtInProp(PromisePrototype, "__NPO__", 0, false);
		builtInProp(Promise, "resolve", function Promise$resolve(msg) {
			var Constructor = this;
			if (msg && typeof msg == "object" && msg.__NPO__ === 1) return msg;
			return new Constructor(function executor(resolve, reject) {
				if (typeof resolve != "function" || typeof reject != "function") throw TypeError("Not a function");
				resolve(msg);
			});
		});
		builtInProp(Promise, "reject", function Promise$reject(msg) {
			return new this(function executor(resolve, reject) {
				if (typeof resolve != "function" || typeof reject != "function") throw TypeError("Not a function");
				reject(msg);
			});
		});
		builtInProp(Promise, "all", function Promise$all(arr) {
			var Constructor = this;
			if (ToString.call(arr) != "[object Array]") return Constructor.reject(TypeError("Not an array"));
			if (arr.length === 0) return Constructor.resolve([]);
			return new Constructor(function executor(resolve, reject) {
				if (typeof resolve != "function" || typeof reject != "function") throw TypeError("Not a function");
				var len = arr.length, msgs = Array(len), count = 0;
				iteratePromises(Constructor, arr, function resolver(idx, msg) {
					msgs[idx] = msg;
					if (++count === len) resolve(msgs);
				}, reject);
			});
		});
		builtInProp(Promise, "race", function Promise$race(arr) {
			var Constructor = this;
			if (ToString.call(arr) != "[object Array]") return Constructor.reject(TypeError("Not an array"));
			return new Constructor(function executor(resolve, reject) {
				if (typeof resolve != "function" || typeof reject != "function") throw TypeError("Not a function");
				iteratePromises(Constructor, arr, function resolver(idx, msg) {
					resolve(msg);
				}, reject);
			});
		});
		return Promise;
	});
});
/**
* @module lib/callbacks
*/
const callbackMap = /* @__PURE__ */ new WeakMap();
/**
* Store a callback for a method or event for a player.
*
* @param {Player} player The player object.
* @param {string} name The method or event name.
* @param {(function(this:Player, *): void|{resolve: function, reject: function})} callback
*        The callback to call or an object with resolve and reject functions for a promise.
* @return {void}
*/
function storeCallback(player, name, callback) {
	const playerCallbacks = callbackMap.get(player.element) || {};
	if (!(name in playerCallbacks)) playerCallbacks[name] = [];
	playerCallbacks[name].push(callback);
	callbackMap.set(player.element, playerCallbacks);
}
/**
* Get the callbacks for a player and event or method.
*
* @param {Player} player The player object.
* @param {string} name The method or event name
* @return {function[]}
*/
function getCallbacks(player, name) {
	return (callbackMap.get(player.element) || {})[name] || [];
}
/**
* Remove a stored callback for a method or event for a player.
*
* @param {Player} player The player object.
* @param {string} name The method or event name
* @param {function} [callback] The specific callback to remove.
* @return {boolean} Was this the last callback?
*/
function removeCallback(player, name, callback) {
	const playerCallbacks = callbackMap.get(player.element) || {};
	if (!playerCallbacks[name]) return true;
	if (!callback) {
		playerCallbacks[name] = [];
		callbackMap.set(player.element, playerCallbacks);
		return true;
	}
	const index = playerCallbacks[name].indexOf(callback);
	if (index !== -1) playerCallbacks[name].splice(index, 1);
	callbackMap.set(player.element, playerCallbacks);
	return playerCallbacks[name] && playerCallbacks[name].length === 0;
}
/**
* Return the first stored callback for a player and event or method.
*
* @param {Player} player The player object.
* @param {string} name The method or event name.
* @return {function} The callback, or false if there were none
*/
function shiftCallbacks(player, name) {
	const playerCallbacks = getCallbacks(player, name);
	if (playerCallbacks.length < 1) return false;
	const callback = playerCallbacks.shift();
	removeCallback(player, name, callback);
	return callback;
}
/**
* Move callbacks associated with an element to another element.
*
* @param {HTMLElement} oldElement The old element.
* @param {HTMLElement} newElement The new element.
* @return {void}
*/
function swapCallbacks(oldElement, newElement) {
	const playerCallbacks = callbackMap.get(oldElement);
	callbackMap.set(newElement, playerCallbacks);
	callbackMap.delete(oldElement);
}
/**
* @module lib/postmessage
*/
/**
* Parse a message received from postMessage.
*
* @param {*} data The data received from postMessage.
* @return {object}
*/
function parseMessageData(data) {
	if (typeof data === "string") try {
		data = JSON.parse(data);
	} catch (error) {
		console.warn(error);
		return {};
	}
	return data;
}
/**
* Post a message to the specified target.
*
* @param {Player} player The player object to use.
* @param {string} method The API method to call.
* @param {string|number|object|Array|undefined} params The parameters to send to the player.
* @return {void}
*/
function postMessage(player, method, params) {
	if (!player.element.contentWindow || !player.element.contentWindow.postMessage) return;
	let message = { method };
	if (params !== void 0) message.value = params;
	const ieVersion = parseFloat(navigator.userAgent.toLowerCase().replace(/^.*msie (\d+).*$/, "$1"));
	if (ieVersion >= 8 && ieVersion < 10) message = JSON.stringify(message);
	player.element.contentWindow.postMessage(message, player.origin);
}
/**
* Parse the data received from a message event.
*
* @param {Player} player The player that received the message.
* @param {(Object|string)} data The message data. Strings will be parsed into JSON.
* @return {void}
*/
function processData(player, data) {
	data = parseMessageData(data);
	let callbacks = [];
	let param;
	if (data.event) {
		if (data.event === "error") getCallbacks(player, data.data.method).forEach((promise) => {
			const error = new Error(data.data.message);
			error.name = data.data.name;
			promise.reject(error);
			removeCallback(player, data.data.method, promise);
		});
		callbacks = getCallbacks(player, `event:${data.event}`);
		param = data.data;
	} else if (data.method) {
		const callback = shiftCallbacks(player, data.method);
		if (callback) {
			callbacks.push(callback);
			param = data.value;
		}
	}
	callbacks.forEach((callback) => {
		try {
			if (typeof callback === "function") {
				callback.call(player, param);
				return;
			}
			callback.resolve(param);
		} catch (e) {}
	});
}
/**
* @module lib/embed
*/
const oEmbedParameters = [
	"airplay",
	"audio_tracks",
	"audiotrack",
	"autopause",
	"autoplay",
	"background",
	"byline",
	"cc",
	"chapter_id",
	"chapters",
	"chromecast",
	"color",
	"colors",
	"controls",
	"dnt",
	"end_time",
	"fullscreen",
	"height",
	"id",
	"initial_quality",
	"interactive_params",
	"keyboard",
	"loop",
	"maxheight",
	"max_quality",
	"maxwidth",
	"min_quality",
	"muted",
	"play_button_position",
	"playsinline",
	"portrait",
	"preload",
	"progress_bar",
	"quality",
	"quality_selector",
	"responsive",
	"skipping_forward",
	"speed",
	"start_time",
	"texttrack",
	"thumbnail_id",
	"title",
	"transcript",
	"transparent",
	"unmute_button",
	"url",
	"vimeo_logo",
	"volume",
	"watch_full_video",
	"width"
];
/**
* Get the 'data-vimeo'-prefixed attributes from an element as an object.
*
* @param {HTMLElement} element The element.
* @param {Object} [defaults={}] The default values to use.
* @return {Object<string, string>}
*/
function getOEmbedParameters(element) {
	let defaults = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
	return oEmbedParameters.reduce((params, param) => {
		const value = element.getAttribute(`data-vimeo-${param}`);
		if (value || value === "") params[param] = value === "" ? 1 : value;
		return params;
	}, defaults);
}
/**
* Create an embed from oEmbed data inside an element.
*
* @param {object} data The oEmbed data.
* @param {HTMLElement} element The element to put the iframe in.
* @return {HTMLIFrameElement} The iframe embed.
*/
function createEmbed(_ref, element) {
	let { html } = _ref;
	if (!element) throw new TypeError("An element must be provided");
	if (element.getAttribute("data-vimeo-initialized") !== null) return element.querySelector("iframe");
	const div = document.createElement("div");
	div.innerHTML = html;
	element.appendChild(div.firstChild);
	element.setAttribute("data-vimeo-initialized", "true");
	return element.querySelector("iframe");
}
/**
* Make an oEmbed call for the specified URL.
*
* @param {string} videoUrl The vimeo.com url for the video.
* @param {Object} [params] Parameters to pass to oEmbed.
* @param {HTMLElement} element The element.
* @return {Promise}
*/
function getOEmbedData(videoUrl) {
	let params = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
	let element = arguments.length > 2 ? arguments[2] : void 0;
	return new Promise((resolve, reject) => {
		if (!isVimeoUrl(videoUrl)) throw new TypeError(`“${videoUrl}” is not a vimeo.com url.`);
		let url = `https://${getOembedDomain(videoUrl)}/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
		for (const param in params) if (params.hasOwnProperty(param)) url += `&${param}=${encodeURIComponent(params[param])}`;
		const xhr = "XDomainRequest" in window ? new XDomainRequest() : new XMLHttpRequest();
		xhr.open("GET", url, true);
		xhr.onload = function() {
			if (xhr.status === 404) {
				reject(/* @__PURE__ */ new Error(`“${videoUrl}” was not found.`));
				return;
			}
			if (xhr.status === 403) {
				reject(/* @__PURE__ */ new Error(`“${videoUrl}” is not embeddable.`));
				return;
			}
			try {
				const json = JSON.parse(xhr.responseText);
				if (json.domain_status_code === 403) {
					createEmbed(json, element);
					reject(/* @__PURE__ */ new Error(`“${videoUrl}” is not embeddable.`));
					return;
				}
				resolve(json);
			} catch (error) {
				reject(error);
			}
		};
		xhr.onerror = function() {
			const status = xhr.status ? ` (${xhr.status})` : "";
			reject(/* @__PURE__ */ new Error(`There was an error fetching the embed code from Vimeo${status}.`));
		};
		xhr.send();
	});
}
/**
* Initialize all embeds within a specific element
*
* @param {HTMLElement} [parent=document] The parent element.
* @return {void}
*/
function initializeEmbeds() {
	let parent = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : document;
	const elements = [].slice.call(parent.querySelectorAll("[data-vimeo-id], [data-vimeo-url]"));
	const handleError = (error) => {
		if ("console" in window && console.error) console.error(`There was an error creating an embed: ${error}`);
	};
	elements.forEach((element) => {
		try {
			if (element.getAttribute("data-vimeo-defer") !== null) return;
			const params = getOEmbedParameters(element);
			getOEmbedData(getVimeoUrl(params), params, element).then((data) => {
				return createEmbed(data, element);
			}).catch(handleError);
		} catch (error) {
			handleError(error);
		}
	});
}
/**
* Resize embeds when messaged by the player.
*
* @param {HTMLElement} [parent=document] The parent element.
* @return {void}
*/
function resizeEmbeds() {
	let parent = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : document;
	if (window.VimeoPlayerResizeEmbeds_) return;
	window.VimeoPlayerResizeEmbeds_ = true;
	const onMessage = (event) => {
		if (!isVimeoUrl(event.origin)) return;
		if (!event.data || event.data.event !== "spacechange") return;
		const senderIFrame = event.source ? findIframeBySourceWindow(event.source, parent) : null;
		if (senderIFrame) {
			const space = senderIFrame.parentElement;
			space.style.paddingBottom = `${event.data.data[0].bottom}px`;
		}
	};
	window.addEventListener("message", onMessage);
}
/**
* Add chapters to existing metadata for Google SEO
*
* @param {HTMLElement} [parent=document] The parent element.
* @return {void}
*/
function initAppendVideoMetadata() {
	let parent = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : document;
	if (window.VimeoSeoMetadataAppended) return;
	window.VimeoSeoMetadataAppended = true;
	const onMessage = (event) => {
		if (!isVimeoUrl(event.origin)) return;
		const data = parseMessageData(event.data);
		if (!data || data.event !== "ready") return;
		const senderIFrame = event.source ? findIframeBySourceWindow(event.source, parent) : null;
		if (senderIFrame && isVimeoEmbed(senderIFrame.src)) new Player(senderIFrame).callMethod("appendVideoMetadata", window.location.href);
	};
	window.addEventListener("message", onMessage);
}
/**
* Seek to time indicated by vimeo_t query parameter if present in URL
*
* @param {HTMLElement} [parent=document] The parent element.
* @return {void}
*/
function checkUrlTimeParam() {
	let parent = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : document;
	if (window.VimeoCheckedUrlTimeParam) return;
	window.VimeoCheckedUrlTimeParam = true;
	const handleError = (error) => {
		if ("console" in window && console.error) console.error(`There was an error getting video Id: ${error}`);
	};
	const onMessage = (event) => {
		if (!isVimeoUrl(event.origin)) return;
		const data = parseMessageData(event.data);
		if (!data || data.event !== "ready") return;
		const senderIFrame = event.source ? findIframeBySourceWindow(event.source, parent) : null;
		if (senderIFrame && isVimeoEmbed(senderIFrame.src)) {
			const player = new Player(senderIFrame);
			player.getVideoId().then((videoId) => {
				const matches = new RegExp(`[?&]vimeo_t_${videoId}=([^&#]*)`).exec(window.location.href);
				if (matches && matches[1]) {
					const sec = decodeURI(matches[1]);
					player.setCurrentTime(sec);
				}
			}).catch(handleError);
		}
	};
	window.addEventListener("message", onMessage);
}
/**
* Updates iframe embeds to support DRM content playback by adding the 'encrypted-media' permission
* to the iframe's allow attribute when DRM initialization fails. This function acts as a fallback
* mechanism to enable playback of DRM-protected content in embeds that weren't properly configured.
*
* @return {void}
*/
function updateDRMEmbeds() {
	if (window.VimeoDRMEmbedsUpdated) return;
	window.VimeoDRMEmbedsUpdated = true;
	/**
	* Handle message events for DRM initialization failures
	* @param {MessageEvent} event - The message event from the iframe
	*/
	const onMessage = (event) => {
		if (!isVimeoUrl(event.origin)) return;
		const data = parseMessageData(event.data);
		if (!data || data.event !== "drminitfailed") return;
		const senderIFrame = event.source ? findIframeBySourceWindow(event.source) : null;
		if (!senderIFrame) return;
		const currentAllow = senderIFrame.getAttribute("allow") || "";
		if (!currentAllow.includes("encrypted-media")) {
			senderIFrame.setAttribute("allow", `${currentAllow}; encrypted-media`);
			const currentUrl = new URL(senderIFrame.getAttribute("src"));
			currentUrl.searchParams.set("forcereload", "drm");
			senderIFrame.setAttribute("src", currentUrl.toString());
			return;
		}
	};
	window.addEventListener("message", onMessage);
}
function initializeScreenfull() {
	const fn = function() {
		let val;
		const fnMap = [
			[
				"requestFullscreen",
				"exitFullscreen",
				"fullscreenElement",
				"fullscreenEnabled",
				"fullscreenchange",
				"fullscreenerror"
			],
			[
				"webkitRequestFullscreen",
				"webkitExitFullscreen",
				"webkitFullscreenElement",
				"webkitFullscreenEnabled",
				"webkitfullscreenchange",
				"webkitfullscreenerror"
			],
			[
				"webkitRequestFullScreen",
				"webkitCancelFullScreen",
				"webkitCurrentFullScreenElement",
				"webkitCancelFullScreen",
				"webkitfullscreenchange",
				"webkitfullscreenerror"
			],
			[
				"mozRequestFullScreen",
				"mozCancelFullScreen",
				"mozFullScreenElement",
				"mozFullScreenEnabled",
				"mozfullscreenchange",
				"mozfullscreenerror"
			],
			[
				"msRequestFullscreen",
				"msExitFullscreen",
				"msFullscreenElement",
				"msFullscreenEnabled",
				"MSFullscreenChange",
				"MSFullscreenError"
			]
		];
		let i = 0;
		const l = fnMap.length;
		const ret = {};
		for (; i < l; i++) {
			val = fnMap[i];
			if (val && val[1] in document) {
				for (i = 0; i < val.length; i++) ret[fnMap[0][i]] = val[i];
				return ret;
			}
		}
		return false;
	}();
	const eventNameMap = {
		fullscreenchange: fn.fullscreenchange,
		fullscreenerror: fn.fullscreenerror
	};
	const screenfull = {
		request(element) {
			return new Promise((resolve, reject) => {
				const onFullScreenEntered = function() {
					screenfull.off("fullscreenchange", onFullScreenEntered);
					resolve();
				};
				screenfull.on("fullscreenchange", onFullScreenEntered);
				element = element || document.documentElement;
				const returnPromise = element[fn.requestFullscreen]();
				if (returnPromise instanceof Promise) returnPromise.then(onFullScreenEntered).catch(reject);
			});
		},
		exit() {
			return new Promise((resolve, reject) => {
				if (!screenfull.isFullscreen) {
					resolve();
					return;
				}
				const onFullScreenExit = function() {
					screenfull.off("fullscreenchange", onFullScreenExit);
					resolve();
				};
				screenfull.on("fullscreenchange", onFullScreenExit);
				const returnPromise = document[fn.exitFullscreen]();
				if (returnPromise instanceof Promise) returnPromise.then(onFullScreenExit).catch(reject);
			});
		},
		on(event, callback) {
			const eventName = eventNameMap[event];
			if (eventName) document.addEventListener(eventName, callback);
		},
		off(event, callback) {
			const eventName = eventNameMap[event];
			if (eventName) document.removeEventListener(eventName, callback);
		}
	};
	Object.defineProperties(screenfull, {
		isFullscreen: { get() {
			return Boolean(document[fn.fullscreenElement]);
		} },
		element: {
			enumerable: true,
			get() {
				return document[fn.fullscreenElement];
			}
		},
		isEnabled: {
			enumerable: true,
			get() {
				return Boolean(document[fn.fullscreenEnabled]);
			}
		}
	});
	return screenfull;
}
/** @typedef {import('./timing-src-connector.types').PlayerControls} PlayerControls */
/** @typedef {import('timing-object').ITimingObject} TimingObject */
/** @typedef {import('./timing-src-connector.types').TimingSrcConnectorOptions} TimingSrcConnectorOptions */
/** @typedef {(msg: string) => any} Logger */
/** @typedef {import('timing-object').TConnectionState} TConnectionState */
/**
* @type {TimingSrcConnectorOptions}
*
* For details on these properties and their effects, see the typescript definition referenced above.
*/
const defaultOptions = {
	role: "viewer",
	autoPlayMuted: true,
	allowedDrift: .3,
	maxAllowedDrift: 1,
	minCheckInterval: .1,
	maxRateAdjustment: .2,
	maxTimeToCatchUp: 1
};
/**
* There's a proposed W3C spec for the Timing Object which would introduce a new set of APIs that would simplify time-synchronization tasks for browser applications.
*
* Proposed spec: https://webtiming.github.io/timingobject/
* V3 Spec: https://timingsrc.readthedocs.io/en/latest/
* Demuxed talk: https://www.youtube.com/watch?v=cZSjDaGDmX8
*
* This class makes it easy to connect Vimeo.Player to a provided TimingObject via Vimeo.Player.setTimingSrc(myTimingObject, options) and the synchronization will be handled automatically.
*
* There are 5 general responsibilities in TimingSrcConnector:
*
* 1. `updatePlayer()` which sets the player's currentTime, playbackRate and pause/play state based on current state of the TimingObject.
* 2. `updateTimingObject()` which sets the TimingObject's position and velocity from the player's state.
* 3. `playerUpdater` which listens for change events on the TimingObject and will respond by calling updatePlayer.
* 4. `timingObjectUpdater` which listens to the player events of seeked, play and pause and will respond by calling `updateTimingObject()`.
* 5. `maintainPlaybackPosition` this is code that constantly monitors the player to make sure it's always in sync with the TimingObject. This is needed because videos will generally not play with precise time accuracy and there will be some drift which becomes more noticeable over longer periods (as noted in the timing-object spec). More details on this method below.
*/
var TimingSrcConnector = class extends EventTarget {
	logger;
	/**
	* @param {PlayerControls} player
	* @param {TimingObject} timingObject
	* @param {TimingSrcConnectorOptions} options
	* @param {Logger} logger
	*/
	constructor(player, timingObject) {
		let options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
		let logger = arguments.length > 3 ? arguments[3] : void 0;
		super();
		this.logger = logger;
		this.init(timingObject, player, {
			...defaultOptions,
			...options
		});
	}
	disconnect() {
		this.dispatchEvent(new Event("disconnect"));
	}
	/**
	* @param {TimingObject} timingObject
	* @param {PlayerControls} player
	* @param {TimingSrcConnectorOptions} options
	* @return {Promise<void>}
	*/
	async init(timingObject, player, options) {
		await this.waitForTOReadyState(timingObject, "open");
		if (options.role === "viewer") {
			await this.updatePlayer(timingObject, player, options);
			const playerUpdater = subscribe(timingObject, "change", () => this.updatePlayer(timingObject, player, options));
			const positionSync = this.maintainPlaybackPosition(timingObject, player, options);
			this.addEventListener("disconnect", () => {
				positionSync.cancel();
				playerUpdater.cancel();
			});
		} else {
			await this.updateTimingObject(timingObject, player);
			const timingObjectUpdater = subscribe(player, [
				"seeked",
				"play",
				"pause",
				"ratechange"
			], () => this.updateTimingObject(timingObject, player), "on", "off");
			this.addEventListener("disconnect", () => timingObjectUpdater.cancel());
		}
	}
	/**
	* Sets the TimingObject's state to reflect that of the player
	*
	* @param {TimingObject} timingObject
	* @param {PlayerControls} player
	* @return {Promise<void>}
	*/
	async updateTimingObject(timingObject, player) {
		const [position, isPaused, playbackRate] = await Promise.all([
			player.getCurrentTime(),
			player.getPaused(),
			player.getPlaybackRate()
		]);
		timingObject.update({
			position,
			velocity: isPaused ? 0 : playbackRate
		});
	}
	/**
	* Sets the player's timing state to reflect that of the TimingObject
	*
	* @param {TimingObject} timingObject
	* @param {PlayerControls} player
	* @param {TimingSrcConnectorOptions} options
	* @return {Promise<void>}
	*/
	async updatePlayer(timingObject, player, options) {
		const { position, velocity } = timingObject.query();
		if (typeof position === "number") player.setCurrentTime(position);
		if (typeof velocity === "number") {
			if (velocity === 0) {
				if (await player.getPaused() === false) player.pause();
			} else if (velocity > 0) {
				if (await player.getPaused() === true) {
					await player.play().catch(async (err) => {
						if (err.name === "NotAllowedError" && options.autoPlayMuted) {
							await player.setMuted(true);
							await player.play().catch((err2) => console.error("Couldn't play the video from TimingSrcConnector. Error:", err2));
						}
					});
					this.updatePlayer(timingObject, player, options);
				}
				if (await player.getPlaybackRate() !== velocity) player.setPlaybackRate(velocity);
			}
		}
	}
	/**
	* Since video players do not play with 100% time precision, we need to closely monitor
	* our player to be sure it remains in sync with the TimingObject.
	*
	* If out of sync, we use the current conditions and the options provided to determine
	* whether to re-sync via setting currentTime or adjusting the playbackRate
	*
	* @param {TimingObject} timingObject
	* @param {PlayerControls} player
	* @param {TimingSrcConnectorOptions} options
	* @return {{cancel: (function(): void)}}
	*/
	maintainPlaybackPosition(timingObject, player, options) {
		const { allowedDrift, maxAllowedDrift, minCheckInterval, maxRateAdjustment, maxTimeToCatchUp } = options;
		const syncInterval = Math.min(maxTimeToCatchUp, Math.max(minCheckInterval, maxAllowedDrift)) * 1e3;
		const check = async () => {
			if (timingObject.query().velocity === 0 || await player.getPaused() === true) return;
			const diff = timingObject.query().position - await player.getCurrentTime();
			const diffAbs = Math.abs(diff);
			this.log(`Drift: ${diff}`);
			if (diffAbs > maxAllowedDrift) {
				await this.adjustSpeed(player, 0);
				player.setCurrentTime(timingObject.query().position);
				this.log("Resync by currentTime");
			} else if (diffAbs > allowedDrift) {
				const min = diffAbs / maxTimeToCatchUp;
				const max = maxRateAdjustment;
				const adjustment = min < max ? (max - min) / 2 : max;
				await this.adjustSpeed(player, adjustment * Math.sign(diff));
				this.log("Resync by playbackRate");
			}
		};
		const interval = setInterval(() => check(), syncInterval);
		return { cancel: () => clearInterval(interval) };
	}
	/**
	* @param {string} msg
	*/
	log(msg) {
		this.logger?.(`TimingSrcConnector: ${msg}`);
	}
	speedAdjustment = 0;
	/**
	* @param {PlayerControls} player
	* @param {number} newAdjustment
	* @return {Promise<void>}
	*/
	adjustSpeed = async (player, newAdjustment) => {
		if (this.speedAdjustment === newAdjustment) return;
		const newPlaybackRate = await player.getPlaybackRate() - this.speedAdjustment + newAdjustment;
		this.log(`New playbackRate:  ${newPlaybackRate}`);
		await player.setPlaybackRate(newPlaybackRate);
		this.speedAdjustment = newAdjustment;
	};
	/**
	* @param {TimingObject} timingObject
	* @param {TConnectionState} state
	* @return {Promise<void>}
	*/
	waitForTOReadyState(timingObject, state) {
		return new Promise((resolve) => {
			const check = () => {
				if (timingObject.readyState === state) resolve();
				else timingObject.addEventListener("readystatechange", check, { once: true });
			};
			check();
		});
	}
};
const playerMap = /* @__PURE__ */ new WeakMap();
const readyMap = /* @__PURE__ */ new WeakMap();
let screenfull = {};
var Player = class {
	/**
	* Create a Player.
	*
	* @param {(HTMLIFrameElement|HTMLElement|string|jQuery)} element A reference to the Vimeo
	*        player iframe, and id, or a jQuery object.
	* @param {object} [options] oEmbed parameters to use when creating an embed in the element.
	* @return {Player}
	*/
	constructor(element) {
		let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		if (window.jQuery && element instanceof jQuery) {
			if (element.length > 1 && window.console && console.warn) console.warn("A jQuery object with multiple elements was passed, using the first element.");
			element = element[0];
		}
		if (typeof document !== "undefined" && typeof element === "string") element = document.getElementById(element);
		if (!isDomElement(element)) throw new TypeError("You must pass either a valid element or a valid id.");
		if (element.nodeName !== "IFRAME") {
			const iframe = element.querySelector("iframe");
			if (iframe) element = iframe;
		}
		if (element.nodeName === "IFRAME" && !isVimeoUrl(element.getAttribute("src") || "")) throw new Error("The player element passed isn’t a Vimeo embed.");
		if (playerMap.has(element)) return playerMap.get(element);
		this._window = element.ownerDocument.defaultView;
		this.element = element;
		this.origin = "*";
		const readyPromise = new npo_src((resolve, reject) => {
			this._onMessage = (event) => {
				if (!isVimeoUrl(event.origin) || this.element.contentWindow !== event.source) return;
				if (this.origin === "*") this.origin = event.origin;
				const data = parseMessageData(event.data);
				if (data && data.event === "error" && data.data && data.data.method === "ready") {
					const error = new Error(data.data.message);
					error.name = data.data.name;
					reject(error);
					return;
				}
				const isReadyEvent = data && data.event === "ready";
				const isPingResponse = data && data.method === "ping";
				if (isReadyEvent || isPingResponse) {
					this.element.setAttribute("data-ready", "true");
					resolve();
					return;
				}
				processData(this, data);
			};
			this._window.addEventListener("message", this._onMessage);
			if (this.element.nodeName !== "IFRAME") {
				const params = getOEmbedParameters(element, options);
				getOEmbedData(getVimeoUrl(params), params, element).then((data) => {
					const iframe = createEmbed(data, element);
					this.element = iframe;
					this._originalElement = element;
					swapCallbacks(element, iframe);
					playerMap.set(this.element, this);
					return data;
				}).catch(reject);
			}
		});
		readyMap.set(this, readyPromise);
		playerMap.set(this.element, this);
		if (this.element.nodeName === "IFRAME") postMessage(this, "ping");
		if (screenfull.isEnabled) {
			const exitFullscreen = () => screenfull.exit();
			this.fullscreenchangeHandler = () => {
				if (screenfull.isFullscreen) storeCallback(this, "event:exitFullscreen", exitFullscreen);
				else removeCallback(this, "event:exitFullscreen", exitFullscreen);
				this.ready().then(() => {
					postMessage(this, "fullscreenchange", screenfull.isFullscreen);
				});
			};
			screenfull.on("fullscreenchange", this.fullscreenchangeHandler);
		}
		return this;
	}
	/**
	* Check to see if the URL is a Vimeo URL.
	*
	* @param {string} url The URL string.
	* @return {boolean}
	*/
	static isVimeoUrl(url) {
		return isVimeoUrl(url);
	}
	/**
	* Get a promise for a method.
	*
	* @param {string} name The API method to call.
	* @param {...(string|number|object|Array)} args Arguments to send via postMessage.
	* @return {Promise}
	*/
	callMethod(name) {
		for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) args[_key - 1] = arguments[_key];
		if (name === void 0 || name === null) throw new TypeError("You must pass a method name.");
		return new npo_src((resolve, reject) => {
			return this.ready().then(() => {
				storeCallback(this, name, {
					resolve,
					reject
				});
				if (args.length === 0) args = {};
				else if (args.length === 1) args = args[0];
				postMessage(this, name, args);
			}).catch(reject);
		});
	}
	/**
	* Get a promise for the value of a player property.
	*
	* @param {string} name The property name
	* @return {Promise}
	*/
	get(name) {
		return new npo_src((resolve, reject) => {
			name = getMethodName(name, "get");
			return this.ready().then(() => {
				storeCallback(this, name, {
					resolve,
					reject
				});
				postMessage(this, name);
			}).catch(reject);
		});
	}
	/**
	* Get a promise for setting the value of a player property.
	*
	* @param {string} name The API method to call.
	* @param {mixed} value The value to set.
	* @return {Promise}
	*/
	set(name, value) {
		return new npo_src((resolve, reject) => {
			name = getMethodName(name, "set");
			if (value === void 0 || value === null) throw new TypeError("There must be a value to set.");
			return this.ready().then(() => {
				storeCallback(this, name, {
					resolve,
					reject
				});
				postMessage(this, name, value);
			}).catch(reject);
		});
	}
	/**
	* Add an event listener for the specified event. Will call the
	* callback with a single parameter, `data`, that contains the data for
	* that event.
	*
	* @param {string} eventName The name of the event.
	* @param {function(*)} callback The function to call when the event fires.
	* @return {void}
	*/
	on(eventName, callback) {
		if (!eventName) throw new TypeError("You must pass an event name.");
		if (!callback) throw new TypeError("You must pass a callback function.");
		if (typeof callback !== "function") throw new TypeError("The callback must be a function.");
		if (getCallbacks(this, `event:${eventName}`).length === 0) this.callMethod("addEventListener", eventName).catch(() => {});
		storeCallback(this, `event:${eventName}`, callback);
	}
	/**
	* Remove an event listener for the specified event. Will remove all
	* listeners for that event if a `callback` isn’t passed, or only that
	* specific callback if it is passed.
	*
	* @param {string} eventName The name of the event.
	* @param {function} [callback] The specific callback to remove.
	* @return {void}
	*/
	off(eventName, callback) {
		if (!eventName) throw new TypeError("You must pass an event name.");
		if (callback && typeof callback !== "function") throw new TypeError("The callback must be a function.");
		if (removeCallback(this, `event:${eventName}`, callback)) this.callMethod("removeEventListener", eventName).catch((e) => {});
	}
	/**
	* A promise to load a new video.
	*
	* @promise LoadVideoPromise
	* @fulfill {number} The video with this id or url successfully loaded.
	* @reject {TypeError} The id was not a number.
	*/
	/**
	* Load a new video into this embed. The promise will be resolved if
	* the video is successfully loaded, or it will be rejected if it could
	* not be loaded.
	*
	* @param {number|string|object} options The id of the video, the url of the video, or an object with embed options.
	* @return {LoadVideoPromise}
	*/
	loadVideo(options) {
		return this.callMethod("loadVideo", options);
	}
	/**
	* A promise to perform an action when the Player is ready.
	*
	* @todo document errors
	* @promise LoadVideoPromise
	* @fulfill {void}
	*/
	/**
	* Trigger a function when the player iframe has initialized. You do not
	* need to wait for `ready` to trigger to begin adding event listeners
	* or calling other methods.
	*
	* @return {ReadyPromise}
	*/
	ready() {
		const readyPromise = readyMap.get(this) || new npo_src((resolve, reject) => {
			reject(/* @__PURE__ */ new Error("Unknown player. Probably unloaded."));
		});
		return npo_src.resolve(readyPromise);
	}
	/**
	* A promise to add a cue point to the player.
	*
	* @promise AddCuePointPromise
	* @fulfill {string} The id of the cue point to use for removeCuePoint.
	* @reject {RangeError} the time was less than 0 or greater than the
	*         video’s duration.
	* @reject {UnsupportedError} Cue points are not supported with the current
	*         player or browser.
	*/
	/**
	* Add a cue point to the player.
	*
	* @param {number} time The time for the cue point.
	* @param {object} [data] Arbitrary data to be returned with the cue point.
	* @return {AddCuePointPromise}
	*/
	addCuePoint(time) {
		let data = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		return this.callMethod("addCuePoint", {
			time,
			data
		});
	}
	/**
	* A promise to remove a cue point from the player.
	*
	* @promise AddCuePointPromise
	* @fulfill {string} The id of the cue point that was removed.
	* @reject {InvalidCuePoint} The cue point with the specified id was not
	*         found.
	* @reject {UnsupportedError} Cue points are not supported with the current
	*         player or browser.
	*/
	/**
	* Remove a cue point from the video.
	*
	* @param {string} id The id of the cue point to remove.
	* @return {RemoveCuePointPromise}
	*/
	removeCuePoint(id) {
		return this.callMethod("removeCuePoint", id);
	}
	/**
	* A representation of a text track on a video.
	*
	* @typedef {Object} VimeoTextTrack
	* @property {string} language The ISO language code.
	* @property {string} kind The kind of track it is (captions or subtitles).
	* @property {string} label The human‐readable label for the track.
	*/
	/**
	* A promise to enable a text track.
	*
	* @promise EnableTextTrackPromise
	* @fulfill {VimeoTextTrack} The text track that was enabled.
	* @reject {InvalidTrackLanguageError} No track was available with the
	*         specified language.
	* @reject {InvalidTrackError} No track was available with the specified
	*         language and kind.
	*/
	/**
	* Enable the text track with the specified language, and optionally the
	* specified kind (captions or subtitles).
	*
	* When set via the API, the track language will not change the viewer’s
	* stored preference.
	*
	* @param {string} language The two‐letter language code.
	* @param {string} [kind] The kind of track to enable (captions or subtitles).
	* @param {boolean} [showing] Whether to enable display of closed captions for enabled text track within the player.
	* @return {EnableTextTrackPromise}
	*/
	enableTextTrack(language) {
		let kind = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
		let showing = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : true;
		if (!language) throw new TypeError("You must pass a language.");
		return this.callMethod("enableTextTrack", {
			language,
			kind,
			showing
		});
	}
	/**
	* A promise to disable the active text track.
	*
	* @promise DisableTextTrackPromise
	* @fulfill {void} The track was disabled.
	*/
	/**
	* Disable the currently-active text track.
	*
	* @return {DisableTextTrackPromise}
	*/
	disableTextTrack() {
		return this.callMethod("disableTextTrack");
	}
	/** @typedef {import('../types/formats.js').VimeoAudioTrack} VimeoAudioTrack */
	/** @typedef {import('../types/formats.js').AudioLanguage} AudioLanguage */
	/** @typedef {import('../types/formats.js').AudioKind} AudioKind */
	/**
	* A promise to enable an audio track.
	*
	* @promise SelectAudioTrackPromise
	* @fulfill {VimeoAudioTrack} The audio track that was enabled.
	* @reject {NoAudioTracksError} No audio exists for the video.
	* @reject {NoAlternateAudioTracksError} No alternate audio tracks exist for the video.
	* @reject {NoMatchingAudioTrackError} No track was available with the specified
	*         language and kind.
	*/
	/**
	* Enable the audio track with the specified language, and optionally the
	* specified kind (main, translation, descriptions, or commentary).
	*
	* When set via the API, the track language will not change the viewer’s
	* stored preference.
	*
	* @param {AudioLanguage} language The two‐letter language code.
	* @param {AudioKind} [kind] The kind of track to enable (main, translation, descriptions, commentary).
	* @return {SelectAudioTrackPromise}
	*/
	selectAudioTrack(language, kind) {
		if (!language) throw new TypeError("You must pass a language.");
		return this.callMethod("selectAudioTrack", {
			language,
			kind
		});
	}
	/**
	* Enable the main audio track for the video.
	*
	* @return {SelectAudioTrackPromise}
	*/
	selectDefaultAudioTrack() {
		return this.callMethod("selectDefaultAudioTrack");
	}
	/**
	* A promise to pause the video.
	*
	* @promise PausePromise
	* @fulfill {void} The video was paused.
	*/
	/**
	* Pause the video if it’s playing.
	*
	* @return {PausePromise}
	*/
	pause() {
		return this.callMethod("pause");
	}
	/**
	* A promise to play the video.
	*
	* @promise PlayPromise
	* @fulfill {void} The video was played.
	*/
	/**
	* Play the video if it’s paused. **Note:** on iOS and some other
	* mobile devices, you cannot programmatically trigger play. Once the
	* viewer has tapped on the play button in the player, however, you
	* will be able to use this function.
	*
	* @return {PlayPromise}
	*/
	play() {
		return this.callMethod("play");
	}
	/**
	* Request that the player enters fullscreen.
	* @return {Promise}
	*/
	requestFullscreen() {
		if (screenfull.isEnabled) return screenfull.request(this.element);
		return this.callMethod("requestFullscreen");
	}
	/**
	* Request that the player exits fullscreen.
	* @return {Promise}
	*/
	exitFullscreen() {
		if (screenfull.isEnabled) return screenfull.exit();
		return this.callMethod("exitFullscreen");
	}
	/**
	* Returns true if the player is currently fullscreen.
	* @return {Promise}
	*/
	getFullscreen() {
		if (screenfull.isEnabled) return npo_src.resolve(screenfull.isFullscreen);
		return this.get("fullscreen");
	}
	/**
	* Request that the player enters picture-in-picture.
	* @return {Promise}
	*/
	requestPictureInPicture() {
		return this.callMethod("requestPictureInPicture");
	}
	/**
	* Request that the player exits picture-in-picture.
	* @return {Promise}
	*/
	exitPictureInPicture() {
		return this.callMethod("exitPictureInPicture");
	}
	/**
	* Returns true if the player is currently picture-in-picture.
	* @return {Promise}
	*/
	getPictureInPicture() {
		return this.get("pictureInPicture");
	}
	/**
	* A promise to prompt the viewer to initiate remote playback.
	*
	* @promise RemotePlaybackPromptPromise
	* @fulfill {void}
	* @reject {NotFoundError} No remote playback device is available.
	*/
	/**
	* Request to prompt the user to initiate remote playback.
	*
	* @return {RemotePlaybackPromptPromise}
	*/
	remotePlaybackPrompt() {
		return this.callMethod("remotePlaybackPrompt");
	}
	/**
	* A promise to unload the video.
	*
	* @promise UnloadPromise
	* @fulfill {void} The video was unloaded.
	*/
	/**
	* Return the player to its initial state.
	*
	* @return {UnloadPromise}
	*/
	unload() {
		return this.callMethod("unload");
	}
	/**
	* Cleanup the player and remove it from the DOM
	*
	* It won't be usable and a new one should be constructed
	*  in order to do any operations.
	*
	* @return {Promise}
	*/
	destroy() {
		return new npo_src((resolve) => {
			readyMap.delete(this);
			playerMap.delete(this.element);
			if (this._originalElement) {
				playerMap.delete(this._originalElement);
				this._originalElement.removeAttribute("data-vimeo-initialized");
			}
			if (this.element && this.element.nodeName === "IFRAME" && this.element.parentNode) {
				if (this.element.parentNode.parentNode && this._originalElement && this._originalElement !== this.element.parentNode) this.element.parentNode.parentNode.removeChild(this.element.parentNode);
				else this.element.parentNode.removeChild(this.element);
			}
			if (this.element && this.element.nodeName === "DIV" && this.element.parentNode) {
				this.element.removeAttribute("data-vimeo-initialized");
				const iframe = this.element.querySelector("iframe");
				if (iframe && iframe.parentNode) {
					if (iframe.parentNode.parentNode && this._originalElement && this._originalElement !== iframe.parentNode) iframe.parentNode.parentNode.removeChild(iframe.parentNode);
					else iframe.parentNode.removeChild(iframe);
				}
			}
			this._window.removeEventListener("message", this._onMessage);
			if (screenfull.isEnabled) screenfull.off("fullscreenchange", this.fullscreenchangeHandler);
			resolve();
		});
	}
	/**
	* A promise to get the autopause behavior of the video.
	*
	* @promise GetAutopausePromise
	* @fulfill {boolean} Whether autopause is turned on or off.
	* @reject {UnsupportedError} Autopause is not supported with the current
	*         player or browser.
	*/
	/**
	* Get the autopause behavior for this player.
	*
	* @return {GetAutopausePromise}
	*/
	getAutopause() {
		return this.get("autopause");
	}
	/**
	* A promise to set the autopause behavior of the video.
	*
	* @promise SetAutopausePromise
	* @fulfill {boolean} Whether autopause is turned on or off.
	* @reject {UnsupportedError} Autopause is not supported with the current
	*         player or browser.
	*/
	/**
	* Enable or disable the autopause behavior of this player.
	*
	* By default, when another video is played in the same browser, this
	* player will automatically pause. Unless you have a specific reason
	* for doing so, we recommend that you leave autopause set to the
	* default (`true`).
	*
	* @param {boolean} autopause
	* @return {SetAutopausePromise}
	*/
	setAutopause(autopause) {
		return this.set("autopause", autopause);
	}
	/**
	* A promise to get the buffered property of the video.
	*
	* @promise GetBufferedPromise
	* @fulfill {Array} Buffered Timeranges converted to an Array.
	*/
	/**
	* Get the buffered property of the video.
	*
	* @return {GetBufferedPromise}
	*/
	getBuffered() {
		return this.get("buffered");
	}
	/**
	* @typedef {Object} CameraProperties
	* @prop {number} props.yaw - Number between 0 and 360.
	* @prop {number} props.pitch - Number between -90 and 90.
	* @prop {number} props.roll - Number between -180 and 180.
	* @prop {number} props.fov - The field of view in degrees.
	*/
	/**
	* A promise to get the camera properties of the player.
	*
	* @promise GetCameraPromise
	* @fulfill {CameraProperties} The camera properties.
	*/
	/**
	* For 360° videos get the camera properties for this player.
	*
	* @return {GetCameraPromise}
	*/
	getCameraProps() {
		return this.get("cameraProps");
	}
	/**
	* A promise to set the camera properties of the player.
	*
	* @promise SetCameraPromise
	* @fulfill {Object} The camera was successfully set.
	* @reject {RangeError} The range was out of bounds.
	*/
	/**
	* For 360° videos set the camera properties for this player.
	*
	* @param {CameraProperties} camera The camera properties
	* @return {SetCameraPromise}
	*/
	setCameraProps(camera) {
		return this.set("cameraProps", camera);
	}
	/**
	* A representation of a chapter.
	*
	* @typedef {Object} VimeoChapter
	* @property {number} startTime The start time of the chapter.
	* @property {object} title The title of the chapter.
	* @property {number} index The place in the order of Chapters. Starts at 1.
	*/
	/**
	* A promise to get chapters for the video.
	*
	* @promise GetChaptersPromise
	* @fulfill {VimeoChapter[]} The chapters for the video.
	*/
	/**
	* Get an array of all the chapters for the video.
	*
	* @return {GetChaptersPromise}
	*/
	getChapters() {
		return this.get("chapters");
	}
	/**
	* A promise to get the currently active chapter.
	*
	* @promise GetCurrentChaptersPromise
	* @fulfill {VimeoChapter|undefined} The current chapter for the video.
	*/
	/**
	* Get the currently active chapter for the video.
	*
	* @return {GetCurrentChaptersPromise}
	*/
	getCurrentChapter() {
		return this.get("currentChapter");
	}
	/**
	* A promise to get the accent color of the player.
	*
	* @promise GetColorPromise
	* @fulfill {string} The hex color of the player.
	*/
	/**
	* Get the accent color for this player. Note this is deprecated in place of `getColorTwo`.
	*
	* @return {GetColorPromise}
	*/
	getColor() {
		return this.get("color");
	}
	/**
	* A promise to get all colors for the player in an array.
	*
	* @promise GetColorsPromise
	* @fulfill {string[]} The hex colors of the player.
	*/
	/**
	* Get all the colors for this player in an array: [colorOne, colorTwo, colorThree, colorFour]
	*
	* @return {GetColorPromise}
	*/
	getColors() {
		return npo_src.all([
			this.get("colorOne"),
			this.get("colorTwo"),
			this.get("colorThree"),
			this.get("colorFour")
		]);
	}
	/**
	* A promise to set the accent color of the player.
	*
	* @promise SetColorPromise
	* @fulfill {string} The color was successfully set.
	* @reject {TypeError} The string was not a valid hex or rgb color.
	* @reject {ContrastError} The color was set, but the contrast is
	*         outside of the acceptable range.
	* @reject {EmbedSettingsError} The owner of the player has chosen to
	*         use a specific color.
	*/
	/**
	* Set the accent color of this player to a hex or rgb string. Setting the
	* color may fail if the owner of the video has set their embed
	* preferences to force a specific color.
	* Note this is deprecated in place of `setColorTwo`.
	*
	* @param {string} color The hex or rgb color string to set.
	* @return {SetColorPromise}
	*/
	setColor(color) {
		return this.set("color", color);
	}
	/**
	* A promise to set all colors for the player.
	*
	* @promise SetColorsPromise
	* @fulfill {string[]} The colors were successfully set.
	* @reject {TypeError} The string was not a valid hex or rgb color.
	* @reject {ContrastError} The color was set, but the contrast is
	*         outside of the acceptable range.
	* @reject {EmbedSettingsError} The owner of the player has chosen to
	*         use a specific color.
	*/
	/**
	* Set the colors of this player to a hex or rgb string. Setting the
	* color may fail if the owner of the video has set their embed
	* preferences to force a specific color.
	* The colors should be passed in as an array: [colorOne, colorTwo, colorThree, colorFour].
	* If a color should not be set, the index in the array can be left as null.
	*
	* @param {string[]} colors Array of the hex or rgb color strings to set.
	* @return {SetColorsPromise}
	*/
	setColors(colors) {
		if (!Array.isArray(colors)) return new npo_src((resolve, reject) => reject(/* @__PURE__ */ new TypeError("Argument must be an array.")));
		const nullPromise = new npo_src((resolve) => resolve(null));
		const colorPromises = [
			colors[0] ? this.set("colorOne", colors[0]) : nullPromise,
			colors[1] ? this.set("colorTwo", colors[1]) : nullPromise,
			colors[2] ? this.set("colorThree", colors[2]) : nullPromise,
			colors[3] ? this.set("colorFour", colors[3]) : nullPromise
		];
		return npo_src.all(colorPromises);
	}
	/**
	* A representation of a cue point.
	*
	* @typedef {Object} VimeoCuePoint
	* @property {number} time The time of the cue point.
	* @property {object} data The data passed when adding the cue point.
	* @property {string} id The unique id for use with removeCuePoint.
	*/
	/**
	* A promise to get the cue points of a video.
	*
	* @promise GetCuePointsPromise
	* @fulfill {VimeoCuePoint[]} The cue points added to the video.
	* @reject {UnsupportedError} Cue points are not supported with the current
	*         player or browser.
	*/
	/**
	* Get an array of the cue points added to the video.
	*
	* @return {GetCuePointsPromise}
	*/
	getCuePoints() {
		return this.get("cuePoints");
	}
	/**
	* A promise to get the current time of the video.
	*
	* @promise GetCurrentTimePromise
	* @fulfill {number} The current time in seconds.
	*/
	/**
	* Get the current playback position in seconds.
	*
	* @return {GetCurrentTimePromise}
	*/
	getCurrentTime() {
		return this.get("currentTime");
	}
	/**
	* A promise to set the current time of the video.
	*
	* @promise SetCurrentTimePromise
	* @fulfill {number} The actual current time that was set.
	* @reject {RangeError} the time was less than 0 or greater than the
	*         video’s duration.
	*/
	/**
	* Set the current playback position in seconds. If the player was
	* paused, it will remain paused. Likewise, if the player was playing,
	* it will resume playing once the video has buffered.
	*
	* You can provide an accurate time and the player will attempt to seek
	* to as close to that time as possible. The exact time will be the
	* fulfilled value of the promise.
	*
	* @param {number} currentTime
	* @return {SetCurrentTimePromise}
	*/
	setCurrentTime(currentTime) {
		return this.set("currentTime", currentTime);
	}
	/**
	* A promise to get the duration of the video.
	*
	* @promise GetDurationPromise
	* @fulfill {number} The duration in seconds.
	*/
	/**
	* Get the duration of the video in seconds. It will be rounded to the
	* nearest second before playback begins, and to the nearest thousandth
	* of a second after playback begins.
	*
	* @return {GetDurationPromise}
	*/
	getDuration() {
		return this.get("duration");
	}
	/**
	* A promise to get the ended state of the video.
	*
	* @promise GetEndedPromise
	* @fulfill {boolean} Whether or not the video has ended.
	*/
	/**
	* Get the ended state of the video. The video has ended if
	* `currentTime === duration`.
	*
	* @return {GetEndedPromise}
	*/
	getEnded() {
		return this.get("ended");
	}
	/**
	* A promise to get the loop state of the player.
	*
	* @promise GetLoopPromise
	* @fulfill {boolean} Whether or not the player is set to loop.
	*/
	/**
	* Get the loop state of the player.
	*
	* @return {GetLoopPromise}
	*/
	getLoop() {
		return this.get("loop");
	}
	/**
	* A promise to set the loop state of the player.
	*
	* @promise SetLoopPromise
	* @fulfill {boolean} The loop state that was set.
	*/
	/**
	* Set the loop state of the player. When set to `true`, the player
	* will start over immediately once playback ends.
	*
	* @param {boolean} loop
	* @return {SetLoopPromise}
	*/
	setLoop(loop) {
		return this.set("loop", loop);
	}
	/**
	* A promise to set the muted state of the player.
	*
	* @promise SetMutedPromise
	* @fulfill {boolean} The muted state that was set.
	*/
	/**
	* Set the muted state of the player. When set to `true`, the player
	* volume will be muted.
	*
	* @param {boolean} muted
	* @return {SetMutedPromise}
	*/
	setMuted(muted) {
		return this.set("muted", muted);
	}
	/**
	* A promise to get the muted state of the player.
	*
	* @promise GetMutedPromise
	* @fulfill {boolean} Whether or not the player is muted.
	*/
	/**
	* Get the muted state of the player.
	*
	* @return {GetMutedPromise}
	*/
	getMuted() {
		return this.get("muted");
	}
	/**
	* A promise to get the paused state of the player.
	*
	* @promise GetLoopPromise
	* @fulfill {boolean} Whether or not the video is paused.
	*/
	/**
	* Get the paused state of the player.
	*
	* @return {GetLoopPromise}
	*/
	getPaused() {
		return this.get("paused");
	}
	/**
	* A promise to get the playback rate of the player.
	*
	* @promise GetPlaybackRatePromise
	* @fulfill {number} The playback rate of the player on a scale from 0 to 2.
	*/
	/**
	* Get the playback rate of the player on a scale from `0` to `2`.
	*
	* @return {GetPlaybackRatePromise}
	*/
	getPlaybackRate() {
		return this.get("playbackRate");
	}
	/**
	* A promise to set the playbackrate of the player.
	*
	* @promise SetPlaybackRatePromise
	* @fulfill {number} The playback rate was set.
	* @reject {RangeError} The playback rate was less than 0 or greater than 2.
	*/
	/**
	* Set the playback rate of the player on a scale from `0` to `2`. When set
	* via the API, the playback rate will not be synchronized to other
	* players or stored as the viewer's preference.
	*
	* @param {number} playbackRate
	* @return {SetPlaybackRatePromise}
	*/
	setPlaybackRate(playbackRate) {
		return this.set("playbackRate", playbackRate);
	}
	/**
	* A promise to get the played property of the video.
	*
	* @promise GetPlayedPromise
	* @fulfill {Array} Played Timeranges converted to an Array.
	*/
	/**
	* Get the played property of the video.
	*
	* @return {GetPlayedPromise}
	*/
	getPlayed() {
		return this.get("played");
	}
	/**
	* A promise to get the qualities available of the current video.
	*
	* @promise GetQualitiesPromise
	* @fulfill {Array} The qualities of the video.
	*/
	/**
	* Get the qualities of the current video.
	*
	* @return {GetQualitiesPromise}
	*/
	getQualities() {
		return this.get("qualities");
	}
	/**
	* A promise to get the current set quality of the video.
	*
	* @promise GetQualityPromise
	* @fulfill {string} The current set quality.
	*/
	/**
	* Get the current set quality of the video.
	*
	* @return {GetQualityPromise}
	*/
	getQuality() {
		return this.get("quality");
	}
	/**
	* A promise to set the video quality.
	*
	* @promise SetQualityPromise
	* @fulfill {number} The quality was set.
	* @reject {RangeError} The quality is not available.
	*/
	/**
	* Set a video quality.
	*
	* @param {string} quality
	* @return {SetQualityPromise}
	*/
	setQuality(quality) {
		return this.set("quality", quality);
	}
	/**
	* A promise to get the remote playback availability.
	*
	* @promise RemotePlaybackAvailabilityPromise
	* @fulfill {boolean} Whether remote playback is available.
	*/
	/**
	* Get the availability of remote playback.
	*
	* @return {RemotePlaybackAvailabilityPromise}
	*/
	getRemotePlaybackAvailability() {
		return this.get("remotePlaybackAvailability");
	}
	/**
	* A promise to get the current remote playback state.
	*
	* @promise RemotePlaybackStatePromise
	* @fulfill {string} The state of the remote playback: connecting, connected, or disconnected.
	*/
	/**
	* Get the current remote playback state.
	*
	* @return {RemotePlaybackStatePromise}
	*/
	getRemotePlaybackState() {
		return this.get("remotePlaybackState");
	}
	/**
	* A promise to get the seekable property of the video.
	*
	* @promise GetSeekablePromise
	* @fulfill {Array} Seekable Timeranges converted to an Array.
	*/
	/**
	* Get the seekable property of the video.
	*
	* @return {GetSeekablePromise}
	*/
	getSeekable() {
		return this.get("seekable");
	}
	/**
	* A promise to get the seeking property of the player.
	*
	* @promise GetSeekingPromise
	* @fulfill {boolean} Whether or not the player is currently seeking.
	*/
	/**
	* Get if the player is currently seeking.
	*
	* @return {GetSeekingPromise}
	*/
	getSeeking() {
		return this.get("seeking");
	}
	/**
	* A promise to get the text tracks of a video.
	*
	* @promise GetTextTracksPromise
	* @fulfill {VimeoTextTrack[]} The text tracks associated with the video.
	*/
	/**
	* Get an array of the text tracks that exist for the video.
	*
	* @return {GetTextTracksPromise}
	*/
	getTextTracks() {
		return this.get("textTracks");
	}
	/**
	* A promise to get the audio tracks of a video.
	*
	* @promise GetAudioTracksPromise
	* @fulfill {VimeoAudioTrack[]} The audio tracks associated with the video.
	*/
	/**
	* Get an array of the audio tracks that exist for the video.
	*
	* @return {GetAudioTracksPromise}
	*/
	getAudioTracks() {
		return this.get("audioTracks");
	}
	/**
	* A promise to get the enabled audio track of a video.
	*
	* @promise GetAudioTrackPromise
	* @fulfill {VimeoAudioTrack} The enabled audio track.
	*/
	/**
	* Get the enabled audio track for a video.
	*
	* @return {GetAudioTrackPromise}
	*/
	getEnabledAudioTrack() {
		return this.get("enabledAudioTrack");
	}
	/**
	* Get the main audio track for a video.
	*
	* @return {GetAudioTrackPromise}
	*/
	getDefaultAudioTrack() {
		return this.get("defaultAudioTrack");
	}
	/**
	* A promise to get the embed code for the video.
	*
	* @promise GetVideoEmbedCodePromise
	* @fulfill {string} The `<iframe>` embed code for the video.
	*/
	/**
	* Get the `<iframe>` embed code for the video.
	*
	* @return {GetVideoEmbedCodePromise}
	*/
	getVideoEmbedCode() {
		return this.get("videoEmbedCode");
	}
	/**
	* A promise to get the id of the video.
	*
	* @promise GetVideoIdPromise
	* @fulfill {number} The id of the video.
	*/
	/**
	* Get the id of the video.
	*
	* @return {GetVideoIdPromise}
	*/
	getVideoId() {
		return this.get("videoId");
	}
	/**
	* A promise to get the title of the video.
	*
	* @promise GetVideoTitlePromise
	* @fulfill {number} The title of the video.
	*/
	/**
	* Get the title of the video.
	*
	* @return {GetVideoTitlePromise}
	*/
	getVideoTitle() {
		return this.get("videoTitle");
	}
	/**
	* A promise to get the native width of the video.
	*
	* @promise GetVideoWidthPromise
	* @fulfill {number} The native width of the video.
	*/
	/**
	* Get the native width of the currently‐playing video. The width of
	* the highest‐resolution available will be used before playback begins.
	*
	* @return {GetVideoWidthPromise}
	*/
	getVideoWidth() {
		return this.get("videoWidth");
	}
	/**
	* A promise to get the native height of the video.
	*
	* @promise GetVideoHeightPromise
	* @fulfill {number} The native height of the video.
	*/
	/**
	* Get the native height of the currently‐playing video. The height of
	* the highest‐resolution available will be used before playback begins.
	*
	* @return {GetVideoHeightPromise}
	*/
	getVideoHeight() {
		return this.get("videoHeight");
	}
	/**
	* A promise to get the vimeo.com url for the video.
	*
	* @promise GetVideoUrlPromise
	* @fulfill {number} The vimeo.com url for the video.
	* @reject {PrivacyError} The url isn’t available because of the video’s privacy setting.
	*/
	/**
	* Get the vimeo.com url for the video.
	*
	* @return {GetVideoUrlPromise}
	*/
	getVideoUrl() {
		return this.get("videoUrl");
	}
	/**
	* A promise to get the volume level of the player.
	*
	* @promise GetVolumePromise
	* @fulfill {number} The volume level of the player on a scale from 0 to 1.
	*/
	/**
	* Get the current volume level of the player on a scale from `0` to `1`.
	*
	* Most mobile devices do not support an independent volume from the
	* system volume. In those cases, this method will always return `1`.
	*
	* @return {GetVolumePromise}
	*/
	getVolume() {
		return this.get("volume");
	}
	/**
	* A promise to set the volume level of the player.
	*
	* @promise SetVolumePromise
	* @fulfill {number} The volume was set.
	* @reject {RangeError} The volume was less than 0 or greater than 1.
	*/
	/**
	* Set the volume of the player on a scale from `0` to `1`. When set
	* via the API, the volume level will not be synchronized to other
	* players or stored as the viewer’s preference.
	*
	* Most mobile devices do not support setting the volume. An error will
	* *not* be triggered in that situation.
	*
	* @param {number} volume
	* @return {SetVolumePromise}
	*/
	setVolume(volume) {
		return this.set("volume", volume);
	}
	/** @typedef {import('timing-object').ITimingObject} TimingObject */
	/** @typedef {import('./lib/timing-src-connector.types').TimingSrcConnectorOptions} TimingSrcConnectorOptions */
	/** @typedef {import('./lib/timing-src-connector').TimingSrcConnector} TimingSrcConnector */
	/**
	* Connects a TimingObject to the video player (https://webtiming.github.io/timingobject/)
	*
	* @param {TimingObject} timingObject
	* @param {TimingSrcConnectorOptions} options
	*
	* @return {Promise<TimingSrcConnector>}
	*/
	async setTimingSrc(timingObject, options) {
		if (!timingObject) throw new TypeError("A Timing Object must be provided.");
		await this.ready();
		const connector = new TimingSrcConnector(this, timingObject, options);
		postMessage(this, "notifyTimingObjectConnect");
		connector.addEventListener("disconnect", () => postMessage(this, "notifyTimingObjectDisconnect"));
		return connector;
	}
};
if (!isServerRuntime) {
	screenfull = initializeScreenfull();
	initializeEmbeds();
	resizeEmbeds();
	initAppendVideoMetadata();
	checkUrlTimeParam();
	updateDRMEmbeds();
}

//#endregion
//#region ../adapters/vimeo-video/dist/dev/adapter.js
/**
* @fires sourcechange - Fired when `source` changes, either directly or by resolving a new `src`. Read `source` for the
*   new value.
* @fires contentdatachange - Fired when the embed reports a title and when that title is cleared. Read `contentData`
*   for the new value.
*/
var VimeoAdapter = class VimeoAdapter extends MediaPlayedRangesMixin(EventTarget) {
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
	#target = null;
	#player = null;
	#playerEventCleanups = [];
	#loadComplete = createPublicPromise();
	#src = VimeoAdapter.defaultProps.src;
	#autoplay = VimeoAdapter.defaultProps.autoplay;
	#defaultMuted = VimeoAdapter.defaultProps.defaultMuted;
	#loop = VimeoAdapter.defaultProps.loop;
	#controls = VimeoAdapter.defaultProps.controls;
	#playsInline = VimeoAdapter.defaultProps.playsInline;
	#preload = VimeoAdapter.defaultProps.preload;
	#poster = VimeoAdapter.defaultProps.poster;
	#source = VimeoAdapter.defaultProps.source;
	#paused = true;
	#ended = false;
	#seeking = false;
	#currentTime = 0;
	#duration = NaN;
	#volume = 1;
	#muted = false;
	#playbackRate = 1;
	#progress = 0;
	#videoWidth = NaN;
	#videoHeight = NaN;
	#readyState = READY_STATE_HAVE_NOTHING;
	#title = "";
	#contentData = {};
	#error = null;
	#isFullscreen = false;
	#isPictureInPicture = false;
	#disablePictureInPicture = false;
	#textTracksHost = null;
	#textTracksDisconnect = null;
	static {
		this.PLAYER_SOFTWARE_NAME = "vimeo-video";
	}
	/** Underlying `@vimeo/player` instance. Null until an embed URL can be resolved, which may be after `attach()`. */
	get engine() {
		return this.#player;
	}
	get target() {
		return this.#target;
	}
	/** Bind the iframe hosting the embed. The player follows once an embed URL resolves, maybe not until `load()`. */
	attach(target) {
		if (!target || this.#target === target) return;
		if (this.#target) this.detach();
		this.#target = target;
		this.#beginLoad();
		this.#createPlayer();
	}
	detach() {
		const target = this.#target;
		if (!target) return;
		this.#teardownTextTracks();
		for (const cleanup of this.#playerEventCleanups) cleanup();
		this.#playerEventCleanups.length = 0;
		if (this.#player) {
			const parentNodeDescriptor = Object.getOwnPropertyDescriptor(target, "parentNode");
			Object.defineProperty(target, "parentNode", {
				value: null,
				configurable: true
			});
			try {
				this.#player.destroy().catch(() => {});
			} finally {
				if (parentNodeDescriptor) Object.defineProperty(target, "parentNode", parentNodeDescriptor);
				else Reflect.deleteProperty(target, "parentNode");
			}
			target.removeAttribute("src");
		}
		this.#player = null;
		this.#target = null;
		this.#loadComplete.resolve();
		this.#resetState();
	}
	destroy() {
		this.detach();
		super.destroy();
	}
	get src() {
		return this.#src;
	}
	/** Vimeo URL or id. Setting it re-derives `source`, carrying its embed options over. */
	set src(value) {
		const { engine } = this.#source ?? {};
		const next = {
			...engine && { engine },
			...value && { src: value }
		};
		this.source = Object.keys(next).length > 0 ? next : null;
	}
	get currentSrc() {
		return this.#target?.getAttribute("src") ?? "";
	}
	get readyState() {
		return this.#readyState;
	}
	/** Reload the current source via Vimeo's `loadVideo`; no-op until `attach()`. */
	async load() {
		if (!this.#player) {
			if (!this.#target) return;
			const load = this.#beginLoad();
			this.#resetState();
			await Promise.resolve();
			if (load !== this.#loadComplete) return;
			this.#createPlayer();
			return;
		}
		const load = this.#beginLoad();
		this.#resetState();
		this.dispatchEvent(new Event("emptied"));
		if (!this.#src) {
			load.resolve();
			await this.#player.unload().catch(() => {});
			return;
		}
		this.dispatchEvent(new Event("loadstart"));
		const loadOptions = toLoadVideoOptions(this.#src, this.#source?.engine?.vimeo);
		if (!loadOptions) {
			load.resolve();
			return;
		}
		await this.#player.loadVideo(loadOptions).catch(() => {});
	}
	#beginLoad() {
		this.#loadComplete.resolve();
		this.#loadComplete = createPublicPromise();
		return this.#loadComplete;
	}
	#createPlayer() {
		const target = this.#target;
		if (!target || this.#player) return false;
		if (!target.getAttribute("src")) {
			const initialSrc = buildVimeoIframeSrc(this.#src, this.#snapshotProps());
			if (!initialSrc) {
				this.#loadComplete.resolve();
				return false;
			}
			target.src = initialSrc;
		}
		try {
			this.#player = new Player(target);
		} catch {
			this.#error = new MediaError("The attached iframe is not a Vimeo embed.", MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
			this.#loadComplete.resolve();
			return false;
		}
		this.#bindPlayerEvents(this.#player);
		this.#setupTextTracks(this.#player);
		this.dispatchEvent(new Event("loadstart"));
		return true;
	}
	get paused() {
		return this.#paused;
	}
	get ended() {
		return this.#ended;
	}
	get seeking() {
		return this.#seeking;
	}
	async play() {
		await this.#loadComplete;
		await this.#player?.play();
	}
	pause() {
		this.#player?.pause().catch(() => {});
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value) return;
		this.#currentTime = value;
		this.#afterLoad((p) => p.setCurrentTime(value));
	}
	get duration() {
		return this.#duration;
	}
	get volume() {
		return this.#volume;
	}
	set volume(value) {
		if (this.#volume === value) return;
		this.#volume = value;
		this.#afterLoad((p) => p.setVolume(value));
	}
	get muted() {
		return this.#muted;
	}
	set muted(value) {
		if (this.#muted === value) return;
		this.#muted = value;
		this.#afterLoad((p) => p.setMuted(value));
	}
	get playbackRate() {
		return this.#playbackRate;
	}
	set playbackRate(value) {
		if (this.#playbackRate === value) return;
		this.#playbackRate = value;
		this.#afterLoad((p) => p.setPlaybackRate(value));
	}
	get autoplay() {
		return this.#autoplay;
	}
	set autoplay(value) {
		this.#autoplay = value;
	}
	get defaultMuted() {
		return this.#defaultMuted;
	}
	set defaultMuted(value) {
		this.#defaultMuted = value;
	}
	get loop() {
		return this.#loop;
	}
	set loop(value) {
		this.#loop = value;
		this.#afterLoad((p) => p.setLoop(value));
	}
	get controls() {
		return this.#controls;
	}
	set controls(value) {
		this.#controls = value;
	}
	get playsInline() {
		return this.#playsInline;
	}
	set playsInline(value) {
		this.#playsInline = value;
	}
	get preload() {
		return this.#preload;
	}
	set preload(value) {
		this.#preload = value;
	}
	get poster() {
		return this.#poster;
	}
	set poster(value) {
		this.#poster = value;
	}
	/** Structured source: `src` plus embed options under `engine.vimeo`. Replacing it re-derives `src`. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.vimeo ?? null, source?.engine?.vimeo ?? null);
		this.#source = source;
		this.#src = src;
		if (srcChanged || engineChanged) this.load();
		this.dispatchEvent(new Event("sourcechange"));
	}
	/**
	* Metadata Vimeo reports about the loaded video, keyed by what it is — `title` for now. Unlike a Mux source, none of
	* it can be derived from `src`; the embed has to report it, so the key is absent until then and empties again across
	* a source change. `contentdatachange` announces both.
	*/
	get contentData() {
		return this.#contentData;
	}
	/**
	* Store the title the embed reported, reporting whether the content data changed. Announcing is left to the caller,
	* which knows when the rest of what it is writing is in step.
	*
	* Vimeo cannot tell "no title yet" from "the title is blank" — a failed read falls back to the current value — and a
	* blank would read as a deliberate one, stopping a consumer's fallback chain. So an empty title is reported as an
	* absent key rather than an empty string.
	*/
	#setTitle(value) {
		if (this.#title === value) return false;
		this.#title = value;
		this.#contentData = value ? { title: value } : {};
		return true;
	}
	get buffered() {
		return this.#progress > 0 ? createTimeRange(0, this.#progress) : EMPTY_TIME_RANGES;
	}
	get seekable() {
		return this.#duration > 0 && Number.isFinite(this.#duration) ? createTimeRange(0, this.#duration) : EMPTY_TIME_RANGES;
	}
	get error() {
		return this.#error;
	}
	get textTracks() {
		this.#textTracksHost ??= globalThis.document?.createElement("video") ?? null;
		return this.#textTracksHost?.textTracks ?? EMPTY_TEXT_TRACKS;
	}
	get videoWidth() {
		return this.#videoWidth;
	}
	get videoHeight() {
		return this.#videoHeight;
	}
	get isFullscreen() {
		return this.#isFullscreen;
	}
	async requestFullscreen() {
		await this.#loadComplete;
		await this.#player?.requestFullscreen?.();
		this.#isFullscreen = true;
	}
	async exitFullscreen() {
		await this.#loadComplete;
		await this.#player?.exitFullscreen?.();
		this.#isFullscreen = false;
	}
	get isPictureInPicture() {
		return this.#isPictureInPicture;
	}
	get disablePictureInPicture() {
		return this.#disablePictureInPicture;
	}
	set disablePictureInPicture(value) {
		this.#disablePictureInPicture = value;
	}
	async requestPictureInPicture() {
		await this.#loadComplete;
		await this.#player?.requestPictureInPicture?.().then(() => {
			this.#isPictureInPicture = true;
		}, console.error);
	}
	async exitPictureInPicture() {
		await this.#loadComplete;
		await this.#player?.exitPictureInPicture?.().then(() => {
			this.#isPictureInPicture = false;
		}, console.error);
	}
	#afterLoad(fn) {
		this.#loadComplete.then(() => this.#player && void fn(this.#player).catch(() => {}), () => {});
	}
	#snapshotProps() {
		return {
			autoplay: this.#autoplay,
			defaultMuted: this.#defaultMuted,
			loop: this.#loop,
			controls: this.#controls,
			playsInline: this.#playsInline,
			preload: this.#preload || VimeoAdapter.defaultProps.preload,
			source: this.#source
		};
	}
	#resetState() {
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#muted = false;
		this.#paused = !this.#autoplay;
		this.#ended = false;
		this.#playbackRate = 1;
		this.#progress = 0;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#seeking = false;
		this.#volume = 1;
		this.#error = null;
		this.#videoWidth = NaN;
		this.#videoHeight = NaN;
		this.#isFullscreen = false;
		this.#isPictureInPicture = false;
		if (this.#setTitle("")) this.dispatchEvent(new Event("contentdatachange"));
	}
	async #onLoaded() {
		const load = this.#loadComplete;
		this.#readyState = READY_STATE_HAVE_METADATA;
		const player = this.#player;
		let contentDataChanged = false;
		if (player) {
			const [muted, volume, duration, title] = await Promise.all([
				player.getMuted().catch(() => this.#muted),
				player.getVolume().catch(() => this.#volume),
				player.getDuration().catch(() => this.#duration),
				player.getVideoTitle().catch(() => this.#title)
			]);
			if (load !== this.#loadComplete) return;
			this.#muted = muted;
			this.#volume = volume;
			this.#duration = duration;
			contentDataChanged = this.#setTitle(title);
		}
		if (contentDataChanged) this.dispatchEvent(new Event("contentdatachange"));
		for (const type of [
			"loadedmetadata",
			"durationchange",
			"volumechange",
			"loadcomplete"
		]) this.dispatchEvent(new Event(type));
		load.resolve();
	}
	#bindPlayerEvents(player) {
		const emit = (type) => this.dispatchEvent(new Event(type));
		const on = (type, handler) => {
			player.on(type, handler);
			this.#playerEventCleanups.push(() => player.off(type, handler));
		};
		on("loaded", () => this.#onLoaded());
		on("bufferstart", () => emit("waiting"));
		on("play", () => {
			this.#paused = false;
			emit("play");
		});
		on("playing", () => {
			this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
			this.#paused = false;
			emit("playing");
		});
		on("seeking", () => {
			this.#seeking = true;
			emit("seeking");
		});
		on("seeked", () => {
			this.#seeking = false;
			emit("seeked");
		});
		on("pause", () => {
			this.#paused = true;
			emit("pause");
		});
		on("ended", () => {
			this.#paused = true;
			this.#ended = true;
			emit("ended");
		});
		on("playbackratechange", ({ playbackRate }) => {
			this.#playbackRate = playbackRate;
			emit("ratechange");
		});
		on("volumechange", ({ volume }) => {
			this.#volume = volume;
			emit("volumechange");
		});
		on("durationchange", ({ duration }) => {
			this.#duration = duration;
			emit("durationchange");
		});
		on("timeupdate", ({ seconds, duration }) => {
			this.#currentTime = seconds;
			if (Number.isFinite(duration) && duration !== this.#duration) this.#duration = duration;
			emit("timeupdate");
		});
		on("progress", ({ seconds }) => {
			this.#progress = seconds;
			emit("progress");
		});
		on("resize", ({ videoWidth, videoHeight }) => {
			this.#videoWidth = videoWidth;
			this.#videoHeight = videoHeight;
			emit("resize");
		});
		on("fullscreenchange", ({ fullscreen }) => {
			this.#isFullscreen = fullscreen;
			emit("fullscreenchange");
		});
		on("enterpictureinpicture", () => {
			this.#isPictureInPicture = true;
			emit("enterpictureinpicture");
		});
		on("leavepictureinpicture", () => {
			this.#isPictureInPicture = false;
			emit("leavepictureinpicture");
		});
		on("error", () => {
			this.#error = {
				code: 1,
				message: "Vimeo playback error"
			};
			emit("error");
			this.#loadComplete.resolve();
		});
	}
	#setupTextTracks(player) {
		const doc = globalThis.document;
		if (isUndefined(doc)) return;
		this.#teardownTextTracks();
		const host = doc.createElement("video");
		this.#textTracksHost = host;
		player.getTextTracks().then((tracks) => {
			for (const track of tracks) {
				if (!isString(track.kind) || isNull(track.kind)) continue;
				tryCall(() => host.addTextTrack?.(track.kind, track.label ?? "", track.language ?? ""));
			}
		}).catch(() => {});
		this.#textTracksDisconnect = new AbortController();
		host.textTracks?.addEventListener?.("change", () => {
			const showing = Array.from(host.textTracks).find((t) => t.mode === "showing");
			if (showing) player.enableTextTrack(showing.language, showing.kind).catch(() => {});
			else player.disableTextTrack().catch(() => {});
		}, { signal: this.#textTracksDisconnect.signal });
	}
	#teardownTextTracks() {
		this.#textTracksDisconnect?.abort();
		this.#textTracksDisconnect = null;
		this.#textTracksHost = null;
	}
};
/**
* Build the iframe `src` URL for an initial Vimeo embed from the given props.
*
* @internal
*/
function buildVimeoIframeSrc(src, props = {}) {
	const parsed = parseVimeoSource(src);
	if (!parsed) return "";
	const params = {
		controls: props.controls === true ? null : 0,
		autoplay: props.autoplay,
		loop: props.loop,
		muted: props.defaultMuted,
		playsinline: props.playsInline ?? VimeoAdapter.defaultProps.playsInline,
		preload: props.preload ?? VimeoAdapter.defaultProps.preload,
		transparent: false,
		h: parsed.hash,
		...props.source?.engine?.vimeo ?? void 0
	};
	if (parsed.kind === "event") {
		const hashPath = parsed.hash ? `/${parsed.hash}` : "";
		delete params.h;
		return `${EMBED_EVENT_BASE}/${parsed.id}/embed${hashPath}?${serializeEmbedParams(params)}`;
	}
	return `${EMBED_VIDEO_BASE}/${parsed.id}?${serializeEmbedParams(params)}`;
}
const EMBED_VIDEO_BASE = "https://player.vimeo.com/video";
const EMBED_EVENT_BASE = "https://vimeo.com/event";
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_FUTURE_DATA = 3;
function toLoadVideoOptions(src, vimeo) {
	const parsed = parseVimeoSource(src);
	if (!parsed) return null;
	return {
		url: `${parsed.kind === "event" ? `${EMBED_EVENT_BASE}/${parsed.id}/embed` : `${EMBED_VIDEO_BASE}/${parsed.id}`}${parsed.hash ? `?h=${parsed.hash}` : ""}`,
		...vimeo
	};
}

//#endregion
//#region ../html/dist/dev/media/vimeo-video/adapter.js
var VimeoCustomMediaElement = class extends CustomMediaElement("iframe", VimeoAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildVimeoIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
			return `
      <style>
        :host {
          display: inline-block;
          min-width: 300px;
          min-height: 150px;
          position: relative;
        }
        iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
        }
        :host(:not([controls])) {
          pointer-events: none;
        }
      </style>
      <iframe
        part="iframe"
        ${initialSrc ? ` src="${escapeHtml(initialSrc)}"` : ""}
        allow="accelerometer; fullscreen; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        frameborder="0"
        width="100%"
        height="100%"
        referrerpolicy="${escapeHtml(attrs.referrerpolicy ?? "")}"
      ></iframe>
    `;
		};
	}
};
function templateAttrsToEmbedProps(attrs) {
	return {
		autoplay: attrs.autoplay !== void 0,
		defaultMuted: attrs.muted !== void 0,
		loop: attrs.loop !== void 0,
		controls: attrs.controls !== void 0,
		playsInline: attrs.playsinline !== void 0,
		preload: attrs.preload ?? "metadata"
	};
}
var VimeoVideo = class extends MediaAttachMixin(VimeoCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/vimeo-video.js
var VimeoVideoElement = class extends VimeoVideo {
	static {
		this.tagName = "vimeo-video";
	}
};
safeDefine(VimeoVideoElement);

//#endregion
export { VimeoVideoElement };
//# sourceMappingURL=vimeo-video.dev.js.map