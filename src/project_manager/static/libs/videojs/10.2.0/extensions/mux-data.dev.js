/*! Video.js | https://videojs.org/help */
import { c as isObject, d as isString, i as isFunction, t as hasMethods } from "../predicate-3rF1m2uv.js";
import { t as listen } from "../listen-CO63BggB.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { _ as isMediaSourceCapable, i as isEngineAdapter } from "../predicate-VHPnHoui.js";
import { n as getMediaAdapter, r as getMediaElement, t as PlayerExtensionElement } from "../player-extension-element-E95ZSTu0.js";

//#region ../extensions/mux-data/dist/dev/engine.js
const warnedEngines = /* @__PURE__ */ new WeakSet();
/**
* Pick the `mux-embed` integration for a media's playback engine.
*
* `mux-embed` monitors the media element on its own, and an engine integration is what adds engine-level data on top:
* rendition switches, request timing and throughput, and engine errors. It ships two — hls.js and dash.js — and each
* one is wired through a different option, so handing a dash.js player to the hls.js option leaves the view with
* element-level data only.
*
* Engines are matched by shape rather than by class so this module imports neither hls.js nor dash.js. Mux Data can be
* registered with any media without pulling an engine it will never touch into the bundle (dash.js in particular reads
* `window` on import), and a media whose engine has no integration — a raw `<video>`, native HLS, or an SPF playback
* engine — is monitored from the element alone instead of through the wrong integration.
*
* @returns Options to spread into a `Mux.monitor()` call. Empty when the engine has no integration, which leaves
*   element-level monitoring intact.
* @internal
*/
function toMuxDataEngineOptions(engine) {
	if (isDashJsEngine(engine)) return { dashjs: engine };
	if (isHlsJsEngine(engine)) {
		const Hls = toHlsJsClass(engine);
		if (Hls) return {
			hlsjs: engine,
			Hls
		};
	}
	if (isObject(engine) && !warnedEngines.has(engine)) {
		warnedEngines.add(engine);
		console.warn("[vjs-mux] Mux Data could not hook this playback engine, so the view is monitored from the media element alone. Engine-level data (rendition switches, request timing, engine errors) will be missing.", engine);
	}
	return {};
}
/** Hls.js: its monitor reads renditions from `levels`. */
function isHlsJsEngine(engine) {
	return hasMethods(engine, ["on", "off"]) && Array.isArray(engine.levels);
}
/** Dash.js: its monitor reads renditions through the track and rendition-list getters. */
function isDashJsEngine(engine) {
	if (!hasMethods(engine, [
		"on",
		"off",
		"getCurrentTrackFor"
	])) return false;
	return hasMethods(engine, ["getRepresentationsByType"]) || hasMethods(engine, ["getBitrateInfoListFor"]);
}
/** Hls.js's own class, the only place its event names and error details are published. */
function toHlsJsClass(engine) {
	const engineClass = engine.constructor;
	if (!isFunction(engineClass)) return void 0;
	const statics = engineClass;
	return isObject(statics.Events) && isObject(statics.ErrorDetails) && isString(statics.version) ? statics : void 0;
}

//#endregion
//#region ../extensions/mux-data/dist/dev/env.js
const getEnvPlayerVersion = () => {
	try {
		return "10.2.0";
	} catch {}
	return "UNKNOWN";
};
const player_version = getEnvPlayerVersion();
const getPlayerVersion = () => player_version;

//#endregion
//#region ../../node_modules/.pnpm/mux-embed@5.17.10/node_modules/mux-embed/dist/mux.mjs
var ea = Object.create;
var _t = Object.defineProperty;
var ta = Object.getOwnPropertyDescriptor;
var ra = Object.getOwnPropertyNames;
var aa = Object.getPrototypeOf;
var ia = Object.prototype.hasOwnProperty;
var ft = function(r, e) {
	return function() {
		return r && (e = r(r = 0)), e;
	};
};
var B = function(r, e) {
	return function() {
		return e || r((e = { exports: {} }).exports, e), e.exports;
	};
};
var na = function(r, e, t, i) {
	if (e && typeof e == "object" || typeof e == "function") for (var a = ra(e), n = 0, o = a.length, s; n < o; n++) s = a[n], !ia.call(r, s) && s !== t && _t(r, s, {
		get: function(u) {
			return e[u];
		}.bind(null, s),
		enumerable: !(i = ta(e, s)) || i.enumerable
	});
	return r;
};
var G = function(r, e, t) {
	return t = r != null ? ea(aa(r)) : {}, na(e || !r || !r.__esModule ? _t(t, "default", {
		value: r,
		enumerable: !0
	}) : t, r);
};
var Q = B(function(Zi, ht) {
	var xe;
	typeof window != "undefined" ? xe = window : typeof global != "undefined" ? xe = global : typeof self != "undefined" ? xe = self : xe = {};
	ht.exports = xe;
});
function U(r, e) {
	return e != null && typeof Symbol != "undefined" && e[Symbol.hasInstance] ? !!e[Symbol.hasInstance](r) : U(r, e);
}
var te = ft(function() {
	te();
});
function Ne(r) {
	"@swc/helpers - typeof";
	return r && typeof Symbol != "undefined" && r.constructor === Symbol ? "symbol" : typeof r;
}
var Qe = ft(function() {});
var Ye = B(function(qs, cr) {
	var dr = Array.prototype.slice;
	cr.exports = Na;
	function Na(r, e) {
		for (("length" in r) || (r = [r]), r = dr.call(r); r.length;) {
			var t = r.shift(), i = e(t);
			if (i) return i;
			t.childNodes && t.childNodes.length && (r = dr.call(t.childNodes).concat(r));
		}
	}
});
var fr = B(function(Ps, _r) {
	te();
	_r.exports = ve;
	function ve(r, e) {
		if (!U(this, ve)) return new ve(r, e);
		this.data = r, this.nodeValue = r, this.length = r.length, this.ownerDocument = e || null;
	}
	ve.prototype.nodeType = 8;
	ve.prototype.nodeName = "#comment";
	ve.prototype.toString = function() {
		return "[object Comment]";
	};
});
var mr = B(function(Ls, pr) {
	te();
	pr.exports = ae;
	function ae(r, e) {
		if (!U(this, ae)) return new ae(r);
		this.data = r || "", this.length = this.data.length, this.ownerDocument = e || null;
	}
	ae.prototype.type = "DOMTextNode";
	ae.prototype.nodeType = 3;
	ae.prototype.nodeName = "#text";
	ae.prototype.toString = function() {
		return this.data;
	};
	ae.prototype.replaceData = function(e, t, i) {
		var a = this.data, n = a.substring(0, e), o = a.substring(e + t, a.length);
		this.data = n + i + o, this.length = this.data.length;
	};
});
var Xe = B(function(Is, vr) {
	vr.exports = Ca;
	function Ca(r) {
		var e = this, t = r.type;
		r.target || (r.target = e), e.listeners || (e.listeners = {});
		var i = e.listeners[t];
		if (i) return i.forEach(function(a) {
			r.currentTarget = e, typeof a == "function" ? a(r) : a.handleEvent(r);
		});
		e.parentNode && e.parentNode.dispatchEvent(r);
	}
});
var $e = B(function(Ns, hr) {
	hr.exports = Ma;
	function Ma(r, e) {
		var t = this;
		t.listeners || (t.listeners = {}), t.listeners[r] || (t.listeners[r] = []), t.listeners[r].indexOf(e) === -1 && t.listeners[r].push(e);
	}
});
var Ze = B(function(Cs, yr) {
	yr.exports = Ha;
	function Ha(r, e) {
		var t = this;
		if (t.listeners && t.listeners[r]) {
			var i = t.listeners[r], a = i.indexOf(e);
			a !== -1 && i.splice(a, 1);
		}
	}
});
var Tr = B(function(Hs, wr) {
	Qe();
	wr.exports = gr;
	var Ba = [
		"area",
		"base",
		"br",
		"col",
		"embed",
		"hr",
		"img",
		"input",
		"keygen",
		"link",
		"menuitem",
		"meta",
		"param",
		"source",
		"track",
		"wbr"
	];
	function gr(r) {
		switch (r.nodeType) {
			case 3: return et(r.data);
			case 8: return "<!--" + r.data + "-->";
			default: return Ua(r);
		}
	}
	function Ua(r) {
		var e = [], t = r.tagName;
		return r.namespaceURI === "http://www.w3.org/1999/xhtml" && (t = t.toLowerCase()), e.push("<" + t + Wa(r) + ja(r)), Ba.indexOf(t) > -1 ? e.push(" />") : (e.push(">"), r.childNodes.length ? e.push.apply(e, r.childNodes.map(gr)) : r.textContent || r.innerText ? e.push(et(r.textContent || r.innerText)) : r.innerHTML && e.push(r.innerHTML), e.push("</" + t + ">")), e.join("");
	}
	function Fa(r, e) {
		var t = Ne(r[e]);
		return e === "style" && Object.keys(r.style).length > 0 ? !0 : r.hasOwnProperty(e) && (t === "string" || t === "boolean" || t === "number") && e !== "nodeName" && e !== "className" && e !== "tagName" && e !== "textContent" && e !== "innerText" && e !== "namespaceURI" && e !== "innerHTML";
	}
	function Va(r) {
		if (typeof r == "string") return r;
		var e = "";
		return Object.keys(r).forEach(function(t) {
			var i = r[t];
			t = t.replace(/[A-Z]/g, function(a) {
				return "-" + a.toLowerCase();
			}), e += t + ":" + i + ";";
		}), e;
	}
	function ja(r) {
		var e = r.dataset, t = [];
		for (var i in e) t.push({
			name: "data-" + i,
			value: e[i]
		});
		return t.length ? br(t) : "";
	}
	function br(r) {
		var e = [];
		return r.forEach(function(t) {
			var i = t.name, a = t.value;
			i === "style" && (a = Va(a)), e.push(i + "=\"" + Ga(a) + "\"");
		}), e.length ? " " + e.join(" ") : "";
	}
	function Wa(r) {
		var e = [];
		for (var t in r) Fa(r, t) && e.push({
			name: t,
			value: r[t]
		});
		for (var i in r._attributes) for (var a in r._attributes[i]) {
			var n = r._attributes[i][a], o = (n.prefix ? n.prefix + ":" : "") + a;
			e.push({
				name: o,
				value: n.value
			});
		}
		return r.className && e.push({
			name: "class",
			value: r.className
		}), e.length ? br(e) : "";
	}
	function et(r) {
		var e = "";
		return typeof r == "string" ? e = r : r && (e = r.toString()), e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
	function Ga(r) {
		return et(r).replace(/"/g, "&quot;");
	}
});
var rt = B(function(Us, Er) {
	te();
	var tt = Ye(), Ja = Xe(), Qa = $e(), za = Ze(), Ka = Tr(), kr = "http://www.w3.org/1999/xhtml";
	Er.exports = I;
	function I(r, e, t) {
		if (!U(this, I)) return new I(r);
		var i = t === void 0 ? kr : t || null;
		this.tagName = i === kr ? String(r).toUpperCase() : r, this.nodeName = this.tagName, this.className = "", this.dataset = {}, this.childNodes = [], this.parentNode = null, this.style = {}, this.ownerDocument = e || null, this.namespaceURI = i, this._attributes = {}, this.tagName === "INPUT" && (this.type = "text");
	}
	I.prototype.type = "DOMElement";
	I.prototype.nodeType = 1;
	I.prototype.appendChild = function(e) {
		return e.parentNode && e.parentNode.removeChild(e), this.childNodes.push(e), e.parentNode = this, e;
	};
	I.prototype.replaceChild = function(e, t) {
		e.parentNode && e.parentNode.removeChild(e);
		var i = this.childNodes.indexOf(t);
		return t.parentNode = null, this.childNodes[i] = e, e.parentNode = this, t;
	};
	I.prototype.removeChild = function(e) {
		var t = this.childNodes.indexOf(e);
		return this.childNodes.splice(t, 1), e.parentNode = null, e;
	};
	I.prototype.insertBefore = function(e, t) {
		e.parentNode && e.parentNode.removeChild(e);
		var i = t == null ? -1 : this.childNodes.indexOf(t);
		return i > -1 ? this.childNodes.splice(i, 0, e) : this.childNodes.push(e), e.parentNode = this, e;
	};
	I.prototype.setAttributeNS = function(e, t, i) {
		var a = null, n = t, o = t.indexOf(":");
		if (o > -1 && (a = t.substr(0, o), n = t.substr(o + 1)), this.tagName === "INPUT" && t === "type") this.type = i;
		else {
			var s = this._attributes[e] || (this._attributes[e] = {});
			s[n] = {
				value: i,
				prefix: a
			};
		}
	};
	I.prototype.getAttributeNS = function(e, t) {
		var i = this._attributes[e], a = i && i[t] && i[t].value;
		return this.tagName === "INPUT" && t === "type" ? this.type : typeof a != "string" ? null : a;
	};
	I.prototype.removeAttributeNS = function(e, t) {
		var i = this._attributes[e];
		i && delete i[t];
	};
	I.prototype.hasAttributeNS = function(e, t) {
		var i = this._attributes[e];
		return !!i && t in i;
	};
	I.prototype.setAttribute = function(e, t) {
		return this.setAttributeNS(null, e, t);
	};
	I.prototype.getAttribute = function(e) {
		return this.getAttributeNS(null, e);
	};
	I.prototype.removeAttribute = function(e) {
		return this.removeAttributeNS(null, e);
	};
	I.prototype.hasAttribute = function(e) {
		return this.hasAttributeNS(null, e);
	};
	I.prototype.removeEventListener = za;
	I.prototype.addEventListener = Qa;
	I.prototype.dispatchEvent = Ja;
	I.prototype.focus = function() {};
	I.prototype.toString = function() {
		return Ka(this);
	};
	I.prototype.getElementsByClassName = function(e) {
		var t = e.split(" "), i = [];
		return tt(this, function(a) {
			if (a.nodeType === 1) {
				var o = (a.className || "").split(" ");
				t.every(function(s) {
					return o.indexOf(s) !== -1;
				}) && i.push(a);
			}
		}), i;
	};
	I.prototype.getElementsByTagName = function(e) {
		e = e.toLowerCase();
		var t = [];
		return tt(this.childNodes, function(i) {
			i.nodeType === 1 && (e === "*" || i.tagName.toLowerCase() === e) && t.push(i);
		}), t;
	};
	I.prototype.contains = function(e) {
		return tt(this, function(t) {
			return e === t;
		}) || !1;
	};
});
var Sr = B(function(Vs, xr) {
	te();
	var at = rt();
	xr.exports = K;
	function K(r) {
		if (!U(this, K)) return new K();
		this.childNodes = [], this.parentNode = null, this.ownerDocument = r || null;
	}
	K.prototype.type = "DocumentFragment";
	K.prototype.nodeType = 11;
	K.prototype.nodeName = "#document-fragment";
	K.prototype.appendChild = at.prototype.appendChild;
	K.prototype.replaceChild = at.prototype.replaceChild;
	K.prototype.removeChild = at.prototype.removeChild;
	K.prototype.toString = function() {
		return this.childNodes.map(function(e) {
			return String(e);
		}).join("");
	};
});
var Dr = B(function(js, Rr) {
	Rr.exports = it;
	function it(r) {}
	it.prototype.initEvent = function(e, t, i) {
		this.type = e, this.bubbles = t, this.cancelable = i;
	};
	it.prototype.preventDefault = function() {};
});
var Ar = B(function(Gs, qr) {
	te();
	var Ya = Ye(), Xa = fr(), $a = mr(), De = rt(), Za = Sr(), ei = Dr(), ti = Xe(), ri = $e(), ai = Ze();
	qr.exports = Ue;
	function Ue() {
		if (!U(this, Ue)) return new Ue();
		this.head = this.createElement("head"), this.body = this.createElement("body"), this.documentElement = this.createElement("html"), this.documentElement.appendChild(this.head), this.documentElement.appendChild(this.body), this.childNodes = [this.documentElement], this.nodeType = 9;
	}
	var j = Ue.prototype;
	j.createTextNode = function(e) {
		return new $a(e, this);
	};
	j.createElementNS = function(e, t) {
		var i = e === null ? null : String(e);
		return new De(t, this, i);
	};
	j.createElement = function(e) {
		return new De(e, this);
	};
	j.createDocumentFragment = function() {
		return new Za(this);
	};
	j.createEvent = function(e) {
		return new ei(e);
	};
	j.createComment = function(e) {
		return new Xa(e, this);
	};
	j.getElementById = function(e) {
		e = String(e);
		return Ya(this.childNodes, function(i) {
			if (String(i.id) === e) return i;
		}) || null;
	};
	j.getElementsByClassName = De.prototype.getElementsByClassName;
	j.getElementsByTagName = De.prototype.getElementsByTagName;
	j.contains = De.prototype.contains;
	j.removeEventListener = ai;
	j.addEventListener = ri;
	j.dispatchEvent = ti;
});
var Or = B(function(Js, Pr) {
	Pr.exports = new (Ar())();
});
var nt = B(function(Qs, Ir) {
	var Lr = typeof global != "undefined" ? global : typeof window != "undefined" ? window : {}, ni = Or(), qe;
	typeof document != "undefined" ? qe = document : (qe = Lr["__GLOBAL_DOCUMENT_CACHE@4"], qe || (qe = Lr["__GLOBAL_DOCUMENT_CACHE@4"] = ni));
	Ir.exports = qe;
});
function pt(r) {
	if (Array.isArray(r)) return r;
}
function mt(r, e) {
	var t = r == null ? null : typeof Symbol != "undefined" && r[Symbol.iterator] || r["@@iterator"];
	if (t != null) {
		var i = [], a = !0, n = !1, o, s;
		try {
			for (t = t.call(r); !(a = (o = t.next()).done) && (i.push(o.value), !(e && i.length === e)); a = !0);
		} catch (u) {
			n = !0, s = u;
		} finally {
			try {
				!a && t.return != null && t.return();
			} finally {
				if (n) throw s;
			}
		}
		return i;
	}
}
function vt() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function Ee(r, e) {
	(e == null || e > r.length) && (e = r.length);
	for (var t = 0, i = new Array(e); t < e; t++) i[t] = r[t];
	return i;
}
function Pe(r, e) {
	if (r) {
		if (typeof r == "string") return Ee(r, e);
		var t = Object.prototype.toString.call(r).slice(8, -1);
		if (t === "Object" && r.constructor && (t = r.constructor.name), t === "Map" || t === "Set") return Array.from(t);
		if (t === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)) return Ee(r, e);
	}
}
function H(r, e) {
	return pt(r) || mt(r, e) || Pe(r, e) || vt();
}
var be = G(Q());
var Je = G(Q());
var yt = G(Q());
var P = { now: function() {
	var r = yt.default.performance, e = r && r.timing, t = e && e.navigationStart, i = typeof t == "number" && typeof r.now == "function" ? t + r.now() : Date.now();
	return Math.round(i);
} };
var ee = function() {
	var e, t, i;
	if (typeof ((e = Je.default.crypto) === null || e === void 0 ? void 0 : e.getRandomValues) == "function") {
		i = /* @__PURE__ */ new Uint8Array(32), Je.default.crypto.getRandomValues(i);
		for (var a = 0; a < 32; a++) i[a] = i[a] % 16;
	} else {
		i = [];
		for (var n = 0; n < 32; n++) i[n] = Math.random() * 16 | 0;
	}
	var o = 0;
	t = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(f) {
		var h = f === "x" ? i[o] : i[o] & 3 | 8;
		return o++, h.toString(16);
	});
	var s = P.now(), u = s == null ? void 0 : s.toString(16).substring(3);
	return u ? t.substring(0, 28) + u : t;
};
var Oe = function() {
	return ("000000" + (Math.random() * Math.pow(36, 6) << 0).toString(36)).slice(-6);
};
var J = function(e) {
	if (e && typeof e.nodeName != "undefined") return e.muxId || (e.muxId = Oe()), e.muxId;
	var t;
	try {
		t = document.querySelector(e);
	} catch (i) {}
	return t && !t.muxId && (t.muxId = e), (t == null ? void 0 : t.muxId) || e;
};
var se = function(e) {
	var t;
	e && typeof e.nodeName != "undefined" ? (t = e, e = J(t)) : t = document.querySelector(e);
	var i = t && t.nodeName ? t.nodeName.toLowerCase() : "";
	return [
		t,
		e,
		i
	];
};
function gt(r) {
	if (Array.isArray(r)) return Ee(r);
}
function bt(r) {
	if (typeof Symbol != "undefined" && r[Symbol.iterator] != null || r["@@iterator"] != null) return Array.from(r);
}
function wt() {
	throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function V(r) {
	return gt(r) || bt(r) || Pe(r) || wt();
}
var Y = {
	TRACE: 0,
	DEBUG: 1,
	INFO: 2,
	WARN: 3,
	ERROR: 4,
	SILENT: 5
};
var Tt = function(r) {
	var e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 3, t, i, a, n, o, s = r ? [console, r] : [console], u = (t = console.trace).bind.apply(t, V(s)), f = (i = console.info).bind.apply(i, V(s)), h = (a = console.debug).bind.apply(a, V(s)), E = (n = console.warn).bind.apply(n, V(s)), y = (o = console.error).bind.apply(o, V(s)), c = e;
	return {
		trace: function() {
			for (var w = arguments.length, x = new Array(w), v = 0; v < w; v++) x[v] = arguments[v];
			if (!(c > Y.TRACE)) return u.apply(void 0, V(x));
		},
		debug: function() {
			for (var w = arguments.length, x = new Array(w), v = 0; v < w; v++) x[v] = arguments[v];
			if (!(c > Y.DEBUG)) return h.apply(void 0, V(x));
		},
		info: function() {
			for (var w = arguments.length, x = new Array(w), v = 0; v < w; v++) x[v] = arguments[v];
			if (!(c > Y.INFO)) return f.apply(void 0, V(x));
		},
		warn: function() {
			for (var w = arguments.length, x = new Array(w), v = 0; v < w; v++) x[v] = arguments[v];
			if (!(c > Y.WARN)) return E.apply(void 0, V(x));
		},
		error: function() {
			for (var w = arguments.length, x = new Array(w), v = 0; v < w; v++) x[v] = arguments[v];
			if (!(c > Y.ERROR)) return y.apply(void 0, V(x));
		},
		get level() {
			return c;
		},
		set level(p) {
			p !== this.level && (c = p != null ? p : e);
		}
	};
};
var q = Tt("[mux]");
var Le = G(Q());
function ce() {
	return (Le.default.doNotTrack || Le.default.navigator && Le.default.navigator.doNotTrack) === "1";
}
function b(r) {
	if (r === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return r;
}
te();
function S(r, e) {
	if (!U(r, e)) throw new TypeError("Cannot call a class as a function");
}
function kt(r, e) {
	for (var t = 0; t < e.length; t++) {
		var i = e[t];
		i.enumerable = i.enumerable || !1, i.configurable = !0, "value" in i && (i.writable = !0), Object.defineProperty(r, i.key, i);
	}
}
function N(r, e, t) {
	return e && kt(r.prototype, e), t && kt(r, t), r;
}
function l(r, e, t) {
	return e in r ? Object.defineProperty(r, e, {
		value: t,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : r[e] = t, r;
}
function X(r) {
	return X = Object.setPrototypeOf ? Object.getPrototypeOf : function(t) {
		return t.__proto__ || Object.getPrototypeOf(t);
	}, X(r);
}
function Et(r, e) {
	for (; !Object.prototype.hasOwnProperty.call(r, e) && (r = X(r), r !== null););
	return r;
}
function Se(r, e, t) {
	return typeof Reflect != "undefined" && Reflect.get ? Se = Reflect.get : Se = function(a, n, o) {
		var s = Et(a, n);
		if (s) {
			var u = Object.getOwnPropertyDescriptor(s, n);
			return u.get ? u.get.call(o || a) : u.value;
		}
	}, Se(r, e, t || r);
}
function Ie(r, e) {
	return Ie = Object.setPrototypeOf || function(i, a) {
		return i.__proto__ = a, i;
	}, Ie(r, e);
}
function xt(r, e) {
	if (typeof e != "function" && e !== null) throw new TypeError("Super expression must either be null or a function");
	r.prototype = Object.create(e && e.prototype, { constructor: {
		value: r,
		writable: !0,
		configurable: !0
	} }), e && Ie(r, e);
}
function St(r, e) {
	if (r == null) return {};
	var t = {}, i = Object.keys(r), a, n = 0;
	for (; n < i.length; n++) a = i[n], !(e.indexOf(a) >= 0) && (t[a] = r[a]);
	return t;
}
function Rt(r, e) {
	if (r == null) return {};
	var t = St(r, e), i, a;
	if (Object.getOwnPropertySymbols) {
		var n = Object.getOwnPropertySymbols(r);
		for (a = 0; a < n.length; a++) i = n[a], !(e.indexOf(i) >= 0) && Object.prototype.propertyIsEnumerable.call(r, i) && (t[i] = r[i]);
	}
	return t;
}
function Dt() {
	if (typeof Reflect == "undefined" || !Reflect.construct || Reflect.construct.sham) return !1;
	if (typeof Proxy == "function") return !0;
	try {
		return Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {})), !0;
	} catch (r) {
		return !1;
	}
}
Qe();
function qt(r, e) {
	return e && (Ne(e) === "object" || typeof e == "function") ? e : b(r);
}
function At(r) {
	var e = Dt();
	return function() {
		var i = X(r), a;
		if (e) {
			var n = X(this).constructor;
			a = Reflect.construct(i, arguments, n);
		} else a = i.apply(this, arguments);
		return qt(this, a);
	};
}
var F = function(r) {
	return re(r)[0];
};
var re = function(r) {
	if (typeof r != "string" || r === "") return ["localhost"];
	var i = (r.match(/^(([^:\/?#]+):)?(\/\/([^\/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/) || [])[4], a;
	return i && (a = (i.match(/[^\.]+\.[^\.]+$/) || [])[0]), [i, a];
};
var Ce = G(Q());
var _e = {
	exists: function() {
		var r = Ce.default.performance;
		return (r && r.timing) !== void 0;
	},
	domContentLoadedEventEnd: function() {
		var r = Ce.default.performance, e = r && r.timing;
		return e && e.domContentLoadedEventEnd;
	},
	navigationStart: function() {
		var r = Ce.default.performance, e = r && r.timing;
		return e && e.navigationStart;
	}
};
function O(r, e, t) {
	t = t === void 0 ? 1 : t, r[e] = r[e] || 0, r[e] += t;
}
function ue(r) {
	for (var e = 1; e < arguments.length; e++) {
		var t = arguments[e] != null ? arguments[e] : {}, i = Object.keys(t);
		typeof Object.getOwnPropertySymbols == "function" && (i = i.concat(Object.getOwnPropertySymbols(t).filter(function(a) {
			return Object.getOwnPropertyDescriptor(t, a).enumerable;
		}))), i.forEach(function(a) {
			l(r, a, t[a]);
		});
	}
	return r;
}
function ua(r, e) {
	var t = Object.keys(r);
	if (Object.getOwnPropertySymbols) {
		var i = Object.getOwnPropertySymbols(r);
		e && (i = i.filter(function(a) {
			return Object.getOwnPropertyDescriptor(r, a).enumerable;
		})), t.push.apply(t, i);
	}
	return t;
}
function fe(r, e) {
	return e = e != null ? e : {}, Object.getOwnPropertyDescriptors ? Object.defineProperties(r, Object.getOwnPropertyDescriptors(e)) : ua(Object(e)).forEach(function(t) {
		Object.defineProperty(r, t, Object.getOwnPropertyDescriptor(e, t));
	}), r;
}
var la = ["x-cdn", "content-type"];
var Pt = [
	"x-request-id",
	"cf-ray",
	"x-amz-cf-id",
	"x-akamai-request-id"
];
var da = la.concat(Pt);
function pe(r) {
	r = r || "";
	var e = {};
	return r.trim().split(/[\r\n]+/).forEach(function(i) {
		if (i) {
			var a = i.split(": "), n = a.shift();
			n && (da.indexOf(n.toLowerCase()) >= 0 || n.toLowerCase().indexOf("x-litix-") === 0) && (e[n] = a.join(": "));
		}
	}), e;
}
function le(r) {
	if (r) {
		var e = Pt.find(function(t) {
			return r[t] !== void 0;
		});
		return e ? r[e] : void 0;
	}
}
var ca = function(r) {
	var e = {};
	for (var t in r) {
		var i = r[t];
		if (i["DATA-ID"].search("io.litix.data.") !== -1) {
			var n = i["DATA-ID"].replace("io.litix.data.", "");
			e[n] = i.VALUE;
		}
	}
	return e;
};
var Me = ca;
var He = function(r) {
	if (!r) return {};
	var e = _e.navigationStart(), t = r.loading, i = t ? t.start : r.trequest, a = t ? t.first : r.tfirst, n = t ? t.end : r.tload;
	return {
		bytesLoaded: r.total,
		requestStart: Math.round(e + i),
		responseStart: Math.round(e + a),
		responseEnd: Math.round(e + n)
	};
};
var Re = function(r) {
	if (!(!r || typeof r.getAllResponseHeaders != "function")) return pe(r.getAllResponseHeaders());
};
var Ot = function(r, e, t) {
	arguments.length > 3 && arguments[3] !== void 0 && arguments[3];
	var a = arguments.length > 4 ? arguments[4] : void 0, n = r.log, o = r.utils.secondsToMs, s = function(v) {
		var m = parseInt(a.version), _;
		return m === 1 && v.programDateTime !== null && (_ = v.programDateTime), m === 0 && v.pdt !== null && (_ = v.pdt), _;
	};
	if (!_e.exists()) {
		n.warn("performance timing not supported. Not tracking HLS.js.");
		return;
	}
	var u = function(v, m) {
		return r.emit(e, v, m);
	}, f = function(v, m) {
		var _ = m.levels, d = m.audioTracks, g = m.url, T = m.stats, k = m.networkDetails, D = m.sessionData, L = {}, C = {};
		_.forEach(function(W, oe) {
			L[oe] = {
				width: W.width,
				height: W.height,
				bitrate: W.bitrate,
				attrs: W.attrs
			};
		}), d.forEach(function(W, oe) {
			C[oe] = {
				name: W.name,
				language: W.lang,
				bitrate: W.bitrate
			};
		});
		var A = He(T), R = A.bytesLoaded, Z = A.requestStart, we = A.responseStart, Te = A.responseEnd;
		u("requestcompleted", fe(ue({}, Me(D)), {
			request_event_type: v,
			request_bytes_loaded: R,
			request_start: Z,
			request_response_start: we,
			request_response_end: Te,
			request_type: "manifest",
			request_hostname: F(g),
			request_response_headers: Re(k),
			request_rendition_lists: {
				media: L,
				audio: C,
				video: {}
			}
		}));
	};
	t.on(a.Events.MANIFEST_LOADED, f);
	var h = function(v, m) {
		var _ = m.details, d = m.level, g = m.networkDetails, T = m.stats, k = He(T), D = k.bytesLoaded, L = k.requestStart, C = k.responseStart, A = k.responseEnd, R = _.fragments[_.fragments.length - 1], Z = s(R) + o(R.duration);
		u("requestcompleted", {
			request_event_type: v,
			request_bytes_loaded: D,
			request_start: L,
			request_response_start: C,
			request_response_end: A,
			request_current_level: d,
			request_type: "manifest",
			request_hostname: F(_.url),
			request_response_headers: Re(g),
			video_holdback: _.holdBack && o(_.holdBack),
			video_part_holdback: _.partHoldBack && o(_.partHoldBack),
			video_part_target_duration: _.partTarget && o(_.partTarget),
			video_target_duration: _.targetduration && o(_.targetduration),
			video_source_is_live: _.live,
			player_manifest_newest_program_time: isNaN(Z) ? void 0 : Z
		});
	};
	t.on(a.Events.LEVEL_LOADED, h);
	var E = function(v, m) {
		var _ = m.details, d = m.networkDetails, g = m.stats, T = He(g), k = T.bytesLoaded, D = T.requestStart, L = T.responseStart, C = T.responseEnd;
		u("requestcompleted", {
			request_event_type: v,
			request_bytes_loaded: k,
			request_start: D,
			request_response_start: L,
			request_response_end: C,
			request_type: "manifest",
			request_hostname: F(_.url),
			request_response_headers: Re(d)
		});
	};
	t.on(a.Events.AUDIO_TRACK_LOADED, E);
	var y = function(v, m) {
		var _ = m.stats, d = m.networkDetails, g = m.frag;
		_ = _ || g.stats;
		var T = He(_), k = T.bytesLoaded, D = T.requestStart, L = T.responseStart, C = T.responseEnd, A = d ? Re(d) : void 0, R = {
			request_event_type: v,
			request_bytes_loaded: k,
			request_start: D,
			request_response_start: L,
			request_response_end: C,
			request_hostname: d ? F(d.responseURL) : void 0,
			request_id: A ? le(A) : void 0,
			request_response_headers: A,
			request_media_duration: g.duration,
			request_url: d == null ? void 0 : d.responseURL
		};
		g.type === "main" ? (R.request_type = "media", R.request_current_level = g.level, R.request_video_width = (t.levels[g.level] || {}).width, R.request_video_height = (t.levels[g.level] || {}).height, R.request_labeled_bitrate = (t.levels[g.level] || {}).bitrate) : R.request_type = g.type, u("requestcompleted", R);
	};
	t.on(a.Events.FRAG_LOADED, y);
	var c = function(v, m) {
		var _ = m.frag, d = _.start;
		u("fragmentchange", {
			currentFragmentPDT: s(_),
			currentFragmentStart: o(d)
		});
	};
	t.on(a.Events.FRAG_CHANGED, c);
	var p = function(v, m) {
		var _ = m.type, d = m.details, g = m.response, T = m.fatal, k = m.frag, D = m.networkDetails, L = (k == null ? void 0 : k.url) || m.url || "", C = D ? Re(D) : void 0;
		if ((d === a.ErrorDetails.MANIFEST_LOAD_ERROR || d === a.ErrorDetails.MANIFEST_LOAD_TIMEOUT || d === a.ErrorDetails.FRAG_LOAD_ERROR || d === a.ErrorDetails.FRAG_LOAD_TIMEOUT || d === a.ErrorDetails.LEVEL_LOAD_ERROR || d === a.ErrorDetails.LEVEL_LOAD_TIMEOUT || d === a.ErrorDetails.AUDIO_TRACK_LOAD_ERROR || d === a.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT || d === a.ErrorDetails.SUBTITLE_LOAD_ERROR || d === a.ErrorDetails.SUBTITLE_LOAD_TIMEOUT || d === a.ErrorDetails.KEY_LOAD_ERROR || d === a.ErrorDetails.KEY_LOAD_TIMEOUT) && u("requestfailed", {
			request_error: d,
			request_url: L,
			request_hostname: F(L),
			request_id: C ? le(C) : void 0,
			request_type: d === a.ErrorDetails.FRAG_LOAD_ERROR || d === a.ErrorDetails.FRAG_LOAD_TIMEOUT ? "media" : d === a.ErrorDetails.AUDIO_TRACK_LOAD_ERROR || d === a.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT ? "audio" : d === a.ErrorDetails.SUBTITLE_LOAD_ERROR || d === a.ErrorDetails.SUBTITLE_LOAD_TIMEOUT ? "subtitle" : d === a.ErrorDetails.KEY_LOAD_ERROR || d === a.ErrorDetails.KEY_LOAD_TIMEOUT ? "encryption" : "manifest",
			request_error_code: g == null ? void 0 : g.code,
			request_error_text: g == null ? void 0 : g.text
		}), T) {
			var A;
			u("error", {
				player_error_code: _,
				player_error_message: d,
				player_error_context: "".concat(L ? "url: ".concat(L, "\n") : "") + "".concat(g && (g.code || g.text) ? "response: ".concat(g.code, ", ").concat(g.text, "\n") : "") + "".concat(m.reason ? "failure reason: ".concat(m.reason, "\n") : "") + "".concat(m.level ? "level: ".concat(m.level, "\n") : "") + "".concat(m.parent ? "parent stream controller: ".concat(m.parent, "\n") : "") + "".concat(m.buffer ? "buffer length: ".concat(m.buffer, "\n") : "") + "".concat(m.error ? "error: ".concat(m.error, "\n") : "") + "".concat(m.event ? "event: ".concat(m.event, "\n") : "") + "".concat(m.err ? "error message: ".concat((A = m.err) === null || A === void 0 ? void 0 : A.message, "\n") : "")
			});
		}
	};
	t.on(a.Events.ERROR, p);
	var w = function(v, m) {
		var _ = m.frag, d = _ && _._url || "";
		u("requestcanceled", {
			request_event_type: v,
			request_url: d,
			request_type: "media",
			request_hostname: F(d)
		});
	};
	t.on(a.Events.FRAG_LOAD_EMERGENCY_ABORTED, w);
	var x = function(v, m) {
		var _ = m.level, d = t.levels[_];
		if (d && d.attrs && d.attrs.BANDWIDTH) {
			var g = d.attrs.BANDWIDTH, T, k = parseFloat(d.attrs["FRAME-RATE"]);
			isNaN(k) || (T = k), g ? u("renditionchange", {
				video_source_fps: T,
				video_source_bitrate: g,
				video_source_width: d.width,
				video_source_height: d.height,
				video_source_rendition_name: d.name,
				video_source_codec: d == null ? void 0 : d.videoCodec
			}) : n.warn("missing BANDWIDTH from HLS manifest parsed by HLS.js");
		}
	};
	t.on(a.Events.LEVEL_SWITCHED, x), t._stopMuxMonitor = function() {
		t.off(a.Events.MANIFEST_LOADED, f), t.off(a.Events.LEVEL_LOADED, h), t.off(a.Events.AUDIO_TRACK_LOADED, E), t.off(a.Events.FRAG_LOADED, y), t.off(a.Events.FRAG_CHANGED, c), t.off(a.Events.ERROR, p), t.off(a.Events.FRAG_LOAD_EMERGENCY_ABORTED, w), t.off(a.Events.LEVEL_SWITCHED, x), t.off(a.Events.DESTROYING, t._stopMuxMonitor), delete t._stopMuxMonitor;
	}, t.on(a.Events.DESTROYING, t._stopMuxMonitor);
};
var Lt = function(r) {
	r && typeof r._stopMuxMonitor == "function" && r._stopMuxMonitor();
};
var It = function(r, e) {
	if (!r || !r.requestEndDate) return {};
	var t = F(r.url), i = r.url, a = r.bytesLoaded, n = new Date(r.requestStartDate).getTime(), o = new Date(r.firstByteDate).getTime(), s = new Date(r.requestEndDate).getTime(), u = isNaN(r.duration) ? 0 : r.duration, f = typeof e.getMetricsFor == "function" ? e.getMetricsFor(r.mediaType).HttpList : e.getDashMetrics().getHttpRequests(r.mediaType), h;
	f.length > 0 && (h = pe(f[f.length - 1]._responseHeaders || ""));
	var E = h ? le(h) : void 0;
	return {
		requestStart: n,
		requestResponseStart: o,
		requestResponseEnd: s,
		requestBytesLoaded: a,
		requestResponseHeaders: h,
		requestMediaDuration: u,
		requestHostname: t,
		requestUrl: i,
		requestId: E
	};
};
var _a = function(r, e) {
	if (typeof e.getCurrentRepresentationForType == "function") {
		var t = e.getCurrentRepresentationForType(r);
		return t ? {
			currentLevel: t.absoluteIndex,
			renditionWidth: t.width || null,
			renditionHeight: t.height || null,
			renditionBitrate: t.bandwidth
		} : {};
	}
	var i = e.getQualityFor(r), a = e.getCurrentTrackFor(r).bitrateList;
	return a ? {
		currentLevel: i,
		renditionWidth: a[i].width || null,
		renditionHeight: a[i].height || null,
		renditionBitrate: a[i].bandwidth
	} : {};
};
var fa = function(r) {
	var e;
	return (e = r.match(/.*codecs\*?="(.*)"/)) === null || e === void 0 ? void 0 : e[1];
};
var pa = function(e) {
	try {
		var t, i;
		return (i = e.getVersion) === null || i === void 0 || (t = i.call(e)) === null || t === void 0 ? void 0 : t.split(".").map(function(n) {
			return parseInt(n);
		})[0];
	} catch (n) {
		return !1;
	}
};
var Nt = function(r, e, t) {
	arguments.length > 3 && arguments[3] !== void 0 && arguments[3];
	var a = r.log;
	if (!t || !t.on) {
		a.warn("Invalid dash.js player reference. Monitoring blocked.");
		return;
	}
	var n = pa(t), o = function(_, d) {
		return r.emit(e, _, d);
	}, s = function(_) {
		var d = _.type, T = (_.data || {}).url;
		o("requestcompleted", {
			request_event_type: d,
			request_start: 0,
			request_response_start: 0,
			request_response_end: 0,
			request_bytes_loaded: -1,
			request_type: "manifest",
			request_hostname: F(T),
			request_url: T
		});
	};
	t.on("manifestLoaded", s);
	var u = {}, f = function(_) {
		if (typeof _.getRequests != "function") return null;
		var d = _.getRequests({ state: "executed" });
		return d.length === 0 ? null : d[d.length - 1];
	}, h = function(_) {
		var d = _.type, g = _.fragmentModel, T = _.chunk;
		E({
			type: d,
			request: f(g),
			chunk: T
		});
	}, E = function(_) {
		var d = _.type, g = _.chunk, T = _.request, D = (g || {}).mediaInfo || {}, L = D.type, C = D.bitrateList;
		C = C || [];
		var A = {};
		C.forEach(function(ke, z) {
			A[z] = {}, A[z].width = ke.width, A[z].height = ke.height, A[z].bitrate = ke.bandwidth, A[z].attrs = {};
		}), L === "video" ? u.video = A : L === "audio" ? u.audio = A : u.media = A;
		var R = It(T, t), Z = R.requestStart, we = R.requestResponseStart, Te = R.requestResponseEnd, W = R.requestResponseHeaders, oe = R.requestMediaDuration, je = R.requestHostname, We = R.requestUrl, Ge = R.requestId;
		o("requestcompleted", {
			request_event_type: d,
			request_start: Z,
			request_response_start: we,
			request_response_end: Te,
			request_bytes_loaded: -1,
			request_type: L + "_init",
			request_response_headers: W,
			request_hostname: je,
			request_id: Ge,
			request_url: We,
			request_media_duration: oe,
			request_rendition_lists: u
		});
	};
	n >= 4 ? t.on("initFragmentLoaded", E) : t.on("initFragmentLoaded", h);
	var y = function(_) {
		var d = _.type, g = _.fragmentModel, T = _.chunk;
		c({
			type: d,
			request: f(g),
			chunk: T
		});
	}, c = function(_) {
		var d = _.type, g = _.chunk, T = _.request, k = g || {}, D = k.mediaInfo, L = k.start, A = (D || {}).type, R = It(T, t), Z = R.requestStart, we = R.requestResponseStart, Te = R.requestResponseEnd, W = R.requestBytesLoaded, oe = R.requestResponseHeaders, je = R.requestMediaDuration, We = R.requestHostname, Ge = R.requestUrl, ke = R.requestId, z = _a(A, t), Yr = z.currentLevel, Xr = z.renditionWidth, $r = z.renditionHeight, Zr = z.renditionBitrate;
		o("requestcompleted", {
			request_event_type: d,
			request_start: Z,
			request_response_start: we,
			request_response_end: Te,
			request_bytes_loaded: W,
			request_type: A,
			request_response_headers: oe,
			request_hostname: We,
			request_id: ke,
			request_url: Ge,
			request_media_start_time: L,
			request_media_duration: je,
			request_current_level: Yr,
			request_labeled_bitrate: Zr,
			request_video_width: Xr,
			request_video_height: $r
		});
	};
	n >= 4 ? t.on("mediaFragmentLoaded", c) : t.on("mediaFragmentLoaded", y);
	var p = {
		video: void 0,
		audio: void 0,
		totalBitrate: void 0
	}, w = function() {
		if (p.video && typeof p.video.bitrate == "number") {
			if (!(p.video.width && p.video.height)) {
				a.warn("have bitrate info for video but missing width/height");
				return;
			}
			var _ = p.video.bitrate;
			if (p.audio && typeof p.audio.bitrate == "number" && (_ += p.audio.bitrate), _ !== p.totalBitrate) return p.totalBitrate = _, {
				video_source_bitrate: _,
				video_source_height: p.video.height,
				video_source_width: p.video.width,
				video_source_codec: fa(p.video.codec)
			};
		}
	}, x = function(_, d, g) {
		var T = _.mediaType;
		if (T === "audio" || T === "video") {
			var k;
			if (typeof t.getRepresentationsByType == "function") if (_.newRepresentation) k = {
				bitrate: _.newRepresentation.bandwidth,
				width: _.newRepresentation.width,
				height: _.newRepresentation.height,
				qualityIndex: _.newRepresentation.absoluteIndex
			};
			else {
				var D = t.getRepresentationsByType(T);
				if (D && typeof _.newQuality == "number") {
					var L = D.find(function(A) {
						return A.absoluteIndex === _.newQuality || A.index === _.newQuality;
					});
					L && (k = {
						bitrate: L.bandwidth,
						width: L.width,
						height: L.height,
						qualityIndex: _.newQuality
					});
				}
			}
			else {
				if (typeof _.newQuality != "number") {
					a.warn("missing evt.newQuality in qualityChangeRendered event", _);
					return;
				}
				k = t.getBitrateInfoListFor(T).find(function(A) {
					return A.qualityIndex === _.newQuality;
				});
			}
			if (!(k && typeof k.bitrate == "number")) {
				a.warn("missing bitrate info for ".concat(T));
				return;
			}
			p[T] = fe(ue({}, k), { codec: t.getCurrentTrackFor(T).codec });
			var C = w();
			C && o("renditionchange", C);
		}
	};
	t.on("qualityChangeRendered", x);
	var v = function(_) {
		var d = _.request, g = _.mediaType;
		d = d || {}, o("requestcanceled", {
			request_event_type: d.type + "_" + d.action,
			request_url: d.url,
			request_type: g,
			request_hostname: F(d.url)
		});
	};
	t.on("fragmentLoadingAbandoned", v);
	var m = function(_) {
		var d = _.error, g, T, k = (d == null || (g = d.data) === null || g === void 0 ? void 0 : g.request) || {}, D = (d == null || (T = d.data) === null || T === void 0 ? void 0 : T.response) || {};
		(d == null ? void 0 : d.code) === 27 && o("requestfailed", {
			request_error: k.type + "_" + k.action,
			request_url: k.url,
			request_hostname: F(k.url),
			request_type: k.mediaType,
			request_error_code: D.status,
			request_error_text: D.statusText
		});
		var L = "".concat(k != null && k.url ? "url: ".concat(k.url, "\n") : "") + "".concat(D != null && D.status || D != null && D.statusText ? "response: ".concat(D == null ? void 0 : D.status, ", ").concat(D == null ? void 0 : D.statusText, "\n") : "");
		o("error", {
			player_error_code: d == null ? void 0 : d.code,
			player_error_message: d == null ? void 0 : d.message,
			player_error_context: L
		});
	};
	t.on("error", m), t._stopMuxMonitor = function() {
		t.off("manifestLoaded", s), t.off("initFragmentLoaded", E), t.off("mediaFragmentLoaded", c), t.off("qualityChangeRendered", x), t.off("error", m), t.off("fragmentLoadingAbandoned", v), delete t._stopMuxMonitor;
	};
};
var Ct = function(r) {
	r && typeof r._stopMuxMonitor == "function" && r._stopMuxMonitor();
};
var Mt = 0;
var Ht = function() {
	"use strict";
	function r() {
		S(this, r), l(this, "_listeners", void 0);
	}
	return N(r, [
		{
			key: "on",
			value: function(t, i, a) {
				return i._eventEmitterGuid = i._eventEmitterGuid || ++Mt, this._listeners = this._listeners || {}, this._listeners[t] = this._listeners[t] || [], a && (i = i.bind(a)), this._listeners[t].push(i), i;
			}
		},
		{
			key: "off",
			value: function(t, i) {
				var a = this._listeners && this._listeners[t];
				a && a.forEach(function(n, o) {
					n._eventEmitterGuid === i._eventEmitterGuid && a.splice(o, 1);
				});
			}
		},
		{
			key: "one",
			value: function(t, i, a) {
				var n = this;
				i._eventEmitterGuid = i._eventEmitterGuid || ++Mt;
				var o = function() {
					n.off(t, o), i.apply(a || this, arguments);
				};
				o._eventEmitterGuid = i._eventEmitterGuid, this.on(t, o);
			}
		},
		{
			key: "emit",
			value: function(t, i) {
				var a = this;
				if (this._listeners) {
					i = i || {};
					var n = this._listeners["before" + t] || [], o = this._listeners["before*"] || [], s = this._listeners[t] || [], u = this._listeners["after" + t] || [], f = function(h, E) {
						h = h.slice(), h.forEach(function(y) {
							y.call(a, { type: t }, E);
						});
					};
					f(n, i), f(o, i), f(s, i), f(u, i);
				}
			}
		}
	]), r;
}();
var Be = G(Q());
var Bt = function() {
	"use strict";
	function r(e) {
		var t = this;
		S(this, r), l(this, "_playbackHeartbeatInterval", void 0), l(this, "_playheadShouldBeProgressing", void 0), l(this, "pm", void 0), this.pm = e, this._playbackHeartbeatInterval = null, this._playheadShouldBeProgressing = !1, e.on("playing", function() {
			t._playheadShouldBeProgressing = !0;
		}), e.on("play", this._startPlaybackHeartbeatInterval.bind(this)), e.on("playing", this._startPlaybackHeartbeatInterval.bind(this)), e.on("adbreakstart", this._startPlaybackHeartbeatInterval.bind(this)), e.on("adplay", this._startPlaybackHeartbeatInterval.bind(this)), e.on("adplaying", this._startPlaybackHeartbeatInterval.bind(this)), e.on("devicewake", this._startPlaybackHeartbeatInterval.bind(this)), e.on("viewstart", this._startPlaybackHeartbeatInterval.bind(this)), e.on("rebufferstart", this._startPlaybackHeartbeatInterval.bind(this)), e.on("pause", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("ended", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("viewend", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("error", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("aderror", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("adpause", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("adended", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("adbreakend", this._stopPlaybackHeartbeatInterval.bind(this)), e.on("seeked", function() {
			e.data.player_is_paused ? t._stopPlaybackHeartbeatInterval() : t._startPlaybackHeartbeatInterval();
		}), e.on("timeupdate", function() {
			t._playbackHeartbeatInterval !== null && e.emit("playbackheartbeat");
		}), e.on("devicesleep", function(i, a) {
			t._playbackHeartbeatInterval !== null && (Be.default.clearInterval(t._playbackHeartbeatInterval), e.emit("playbackheartbeatend", { viewer_time: a.viewer_time }), t._playbackHeartbeatInterval = null);
		});
	}
	return N(r, [{
		key: "_startPlaybackHeartbeatInterval",
		value: function() {
			var t = this;
			this._playbackHeartbeatInterval === null && (this.pm.emit("playbackheartbeat"), this._playbackHeartbeatInterval = Be.default.setInterval(function() {
				t.pm.emit("playbackheartbeat");
			}, this.pm.playbackHeartbeatTime));
		}
	}, {
		key: "_stopPlaybackHeartbeatInterval",
		value: function() {
			this._playheadShouldBeProgressing = !1, this._playbackHeartbeatInterval !== null && (Be.default.clearInterval(this._playbackHeartbeatInterval), this.pm.emit("playbackheartbeatend"), this._playbackHeartbeatInterval = null);
		}
	}]), r;
}();
var Ut = function r(e) {
	"use strict";
	var t = this;
	S(this, r), l(this, "viewErrored", void 0), e.on("viewinit", function() {
		t.viewErrored = !1;
	}), e.on("error", function(i, a) {
		try {
			var n = e.errorTranslator({
				player_error_code: a.player_error_code,
				player_error_message: a.player_error_message,
				player_error_context: a.player_error_context,
				player_error_severity: a.player_error_severity,
				player_error_business_exception: a.player_error_business_exception
			});
			n && (e.data.player_error_code = n.player_error_code || a.player_error_code, e.data.player_error_message = n.player_error_message || a.player_error_message, e.data.player_error_context = n.player_error_context || a.player_error_context, e.data.player_error_severity = n.player_error_severity || a.player_error_severity, e.data.player_error_business_exception = n.player_error_business_exception || a.player_error_business_exception, t.viewErrored = !0);
		} catch (o) {
			e.mux.log.warn("Exception in error translator callback.", o), t.viewErrored = !0;
		}
	}), e.on("aftererror", function() {
		var i, a, n, o, s;
		(i = e.data) === null || i === void 0 || delete i.player_error_code, (a = e.data) === null || a === void 0 || delete a.player_error_message, (n = e.data) === null || n === void 0 || delete n.player_error_context, (o = e.data) === null || o === void 0 || delete o.player_error_severity, (s = e.data) === null || s === void 0 || delete s.player_error_business_exception;
	});
};
var Ft = function() {
	"use strict";
	function r(e) {
		S(this, r), l(this, "_watchTimeTrackerLastCheckedTime", void 0), l(this, "pm", void 0), this.pm = e, this._watchTimeTrackerLastCheckedTime = null, e.on("playbackheartbeat", this._updateWatchTime.bind(this)), e.on("playbackheartbeatend", this._clearWatchTimeState.bind(this));
	}
	return N(r, [{
		key: "_updateWatchTime",
		value: function(t, i) {
			var a = i.viewer_time;
			this._watchTimeTrackerLastCheckedTime === null && (this._watchTimeTrackerLastCheckedTime = a), O(this.pm.data, "view_watch_time", a - this._watchTimeTrackerLastCheckedTime), this._watchTimeTrackerLastCheckedTime = a;
		}
	}, {
		key: "_clearWatchTimeState",
		value: function(t, i) {
			this._updateWatchTime(t, i), this._watchTimeTrackerLastCheckedTime = null;
		}
	}]), r;
}();
var Vt = function() {
	"use strict";
	function r(e) {
		var t = this;
		S(this, r), l(this, "_playbackTimeTrackerLastPlayheadPosition", void 0), l(this, "_lastTime", void 0), l(this, "_isAdPlaying", void 0), l(this, "_callbackUpdatePlaybackTime", void 0), l(this, "pm", void 0), this.pm = e, this._playbackTimeTrackerLastPlayheadPosition = -1, this._lastTime = P.now(), this._isAdPlaying = !1, this._callbackUpdatePlaybackTime = null, e.on("viewinit", function() {
			t.pm.data.view_playing_time_ms_cumulative = 0;
		});
		var i = this._startPlaybackTimeTracking.bind(this);
		e.on("playing", i), e.on("adplaying", i);
		var a = function() {
			t.pm.data.player_is_paused || i();
		};
		e.on("seeked", a), e.on("rebufferend", a);
		var n = this._stopPlaybackTimeTracking.bind(this);
		e.on("playbackheartbeatend", n), e.on("seeking", n), e.on("rebufferstart", n), e.on("adplaying", function() {
			t._isAdPlaying = !0;
		}), e.on("adended", function() {
			t._isAdPlaying = !1;
		}), e.on("adpause", function() {
			t._isAdPlaying = !1;
		}), e.on("adbreakstart", function() {
			t._isAdPlaying = !1;
		}), e.on("adbreakend", function() {
			t._isAdPlaying = !1;
		}), e.on("adplay", function() {
			t._isAdPlaying = !1;
		}), e.on("viewinit", function() {
			t._playbackTimeTrackerLastPlayheadPosition = -1, t._lastTime = P.now(), t._isAdPlaying = !1, t._callbackUpdatePlaybackTime = null;
		});
	}
	return N(r, [
		{
			key: "_startPlaybackTimeTracking",
			value: function() {
				this._callbackUpdatePlaybackTime === null && (this._callbackUpdatePlaybackTime = this._updatePlaybackTime.bind(this), this._playbackTimeTrackerLastPlayheadPosition = this.pm.data.player_playhead_time, this._lastTime = P.now(), this.pm.on("playbackheartbeat", this._callbackUpdatePlaybackTime));
			}
		},
		{
			key: "_stopPlaybackTimeTracking",
			value: function() {
				this._callbackUpdatePlaybackTime && (this._updatePlaybackTime(), this.pm.off("playbackheartbeat", this._callbackUpdatePlaybackTime), this._callbackUpdatePlaybackTime = null, this._playbackTimeTrackerLastPlayheadPosition = -1);
			}
		},
		{
			key: "_updatePlaybackTime",
			value: function() {
				var t = this.pm.data.player_playhead_time || 0, i = P.now(), a = i - this._lastTime, n = -1;
				this._playbackTimeTrackerLastPlayheadPosition >= 0 && t > this._playbackTimeTrackerLastPlayheadPosition ? n = t - this._playbackTimeTrackerLastPlayheadPosition : this._isAdPlaying && (n = a), n > 0 && n <= 1e3 && O(this.pm.data, "view_content_playback_time", n), this._callbackUpdatePlaybackTime !== null && a > 0 && a <= 1e3 && (this._isAdPlaying && O(this.pm.data, "ad_playing_time_ms_cumulative", a), O(this.pm.data, "view_playing_time_ms_cumulative", a)), this._playbackTimeTrackerLastPlayheadPosition = t, this._lastTime = i;
			}
		}
	]), r;
}();
var jt = function() {
	"use strict";
	function r(e) {
		S(this, r), l(this, "pm", void 0), this.pm = e;
		var t = this._updatePlayheadTime.bind(this);
		e.on("playbackheartbeat", t), e.on("playbackheartbeatend", t), e.on("timeupdate", t), e.on("destroy", function() {
			e.off("timeupdate", t);
		});
	}
	return N(r, [{
		key: "_updateMaxPlayheadPosition",
		value: function() {
			this.pm.data.view_max_playhead_position = typeof this.pm.data.view_max_playhead_position == "undefined" ? this.pm.data.player_playhead_time : Math.max(this.pm.data.view_max_playhead_position, this.pm.data.player_playhead_time);
		}
	}, {
		key: "_updatePlayheadTime",
		value: function(t, i) {
			var a = this, n = function() {
				a.pm.currentFragmentPDT && a.pm.currentFragmentStart && (a.pm.data.player_program_time = a.pm.currentFragmentPDT + a.pm.data.player_playhead_time - a.pm.currentFragmentStart);
			};
			if (i && i.player_playhead_time) this.pm.data.player_playhead_time = i.player_playhead_time, n(), this._updateMaxPlayheadPosition();
			else if (this.pm.getPlayheadTime) {
				var o = this.pm.getPlayheadTime();
				typeof o != "undefined" && (this.pm.data.player_playhead_time = o, n(), this._updateMaxPlayheadPosition());
			}
		}
	}]), r;
}();
var Wt = 3e5;
var Gt = function r(e) {
	"use strict";
	if (S(this, r), !e.disableRebufferTracking) {
		var t, i = function(n, o) {
			a(o), t = void 0;
		}, a = function(n) {
			if (t) {
				var o = n.viewer_time - t;
				O(e.data, "view_rebuffer_duration", o), t = n.viewer_time, e.data.view_rebuffer_duration > Wt && (e.emit("viewend"), e.send("viewend"), e.mux.log.warn("Ending view after rebuffering for longer than ".concat(Wt, "ms, future events will be ignored unless a programchange or videochange occurs.")));
			}
			e.data.view_watch_time >= 0 && e.data.view_rebuffer_count > 0 && (e.data.view_rebuffer_frequency = e.data.view_rebuffer_count / e.data.view_watch_time, e.data.view_rebuffer_percentage = e.data.view_rebuffer_duration / e.data.view_watch_time);
		};
		e.on("playbackheartbeat", function(n, o) {
			return a(o);
		}), e.on("rebufferstart", function(n, o) {
			t || (O(e.data, "view_rebuffer_count", 1), t = o.viewer_time, e.one("rebufferend", i));
		}), e.on("viewinit", function() {
			t = void 0, e.off("rebufferend", i);
		});
	}
};
var Jt = function() {
	"use strict";
	function r(e) {
		var t = this;
		S(this, r), l(this, "_lastCheckedTime", void 0), l(this, "_lastPlayheadTime", void 0), l(this, "_lastPlayheadTimeUpdatedTime", void 0), l(this, "_rebuffering", void 0), l(this, "pm", void 0), this.pm = e, !(e.disableRebufferTracking || e.disablePlayheadRebufferTracking) && (this._lastCheckedTime = null, this._lastPlayheadTime = null, this._lastPlayheadTimeUpdatedTime = null, e.on("playbackheartbeat", this._checkIfRebuffering.bind(this)), e.on("playbackheartbeatend", this._cleanupRebufferTracker.bind(this)), e.on("seeking", function() {
			t._cleanupRebufferTracker(null, { viewer_time: P.now() });
		}));
	}
	return N(r, [
		{
			key: "_checkIfRebuffering",
			value: function(t, i) {
				if (this.pm.seekingTracker.isSeeking || this.pm.adTracker.isAdBreak || !this.pm.playbackHeartbeat._playheadShouldBeProgressing) {
					this._cleanupRebufferTracker(t, i);
					return;
				}
				if (this._lastCheckedTime === null) {
					this._prepareRebufferTrackerState(i.viewer_time);
					return;
				}
				if (this._lastPlayheadTime !== this.pm.data.player_playhead_time) {
					this._cleanupRebufferTracker(t, i, !0);
					return;
				}
				var a = i.viewer_time - this._lastPlayheadTimeUpdatedTime;
				typeof this.pm.sustainedRebufferThreshold == "number" && a >= this.pm.sustainedRebufferThreshold && (this._rebuffering || (this._rebuffering = !0, this.pm.emit("rebufferstart", { viewer_time: this._lastPlayheadTimeUpdatedTime }))), this._lastCheckedTime = i.viewer_time;
			}
		},
		{
			key: "_clearRebufferTrackerState",
			value: function() {
				this._lastCheckedTime = null, this._lastPlayheadTime = null, this._lastPlayheadTimeUpdatedTime = null;
			}
		},
		{
			key: "_prepareRebufferTrackerState",
			value: function(t) {
				this._lastCheckedTime = t, this._lastPlayheadTime = this.pm.data.player_playhead_time, this._lastPlayheadTimeUpdatedTime = t;
			}
		},
		{
			key: "_cleanupRebufferTracker",
			value: function(t, i) {
				var a = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1;
				if (this._rebuffering) this._rebuffering = !1, this.pm.emit("rebufferend", { viewer_time: i.viewer_time });
				else {
					if (this._lastCheckedTime === null) return;
					var n = this.pm.data.player_playhead_time - this._lastPlayheadTime, o = i.viewer_time - this._lastPlayheadTimeUpdatedTime;
					typeof this.pm.minimumRebufferDuration == "number" && n > 0 && o - n > this.pm.minimumRebufferDuration && (this._lastCheckedTime = null, this.pm.emit("rebufferstart", { viewer_time: this._lastPlayheadTimeUpdatedTime }), this.pm.emit("rebufferend", { viewer_time: this._lastPlayheadTimeUpdatedTime + o - n }));
				}
				a ? this._prepareRebufferTrackerState(i.viewer_time) : this._clearRebufferTrackerState();
			}
		}
	]), r;
}();
var Qt = function() {
	"use strict";
	function r(e) {
		var t = this;
		S(this, r), l(this, "pm", void 0), this.pm = e, e.on("viewinit", function() {
			var i = e.data, a = i.view_id;
			if (!i.view_program_changed) {
				var n = function(o, s) {
					var u = s.viewer_time;
					o.type === "playing" && typeof e.data.view_time_to_first_frame == "undefined" ? t.calculateTimeToFirstFrame(u || P.now(), a) : o.type === "adplaying" && (typeof e.data.view_time_to_first_frame == "undefined" || t._inPrerollPosition()) && t.calculateTimeToFirstFrame(u || P.now(), a);
				};
				e.one("playing", n), e.one("adplaying", n), e.one("viewend", function() {
					e.off("playing", n), e.off("adplaying", n);
				});
			}
		});
	}
	return N(r, [{
		key: "_inPrerollPosition",
		value: function() {
			return typeof this.pm.data.view_content_playback_time == "undefined" || this.pm.data.view_content_playback_time <= 1e3;
		}
	}, {
		key: "calculateTimeToFirstFrame",
		value: function(t, i) {
			i === this.pm.data.view_id && (this.pm.watchTimeTracker._updateWatchTime(null, { viewer_time: t }), this.pm.data.view_time_to_first_frame = this.pm.data.view_watch_time, (this.pm.data.player_autoplay_on || this.pm.data.video_is_autoplay) && this.pm.pageLoadInitTime && (this.pm.data.view_aggregate_startup_time = this.pm.data.view_start + this.pm.data.view_watch_time - this.pm.pageLoadInitTime));
		}
	}]), r;
}();
var zt = function r(e) {
	"use strict";
	var t = this;
	S(this, r), l(this, "_lastPlayerHeight", void 0), l(this, "_lastPlayerWidth", void 0), l(this, "_lastPlayheadPosition", void 0), l(this, "_lastSourceHeight", void 0), l(this, "_lastSourceWidth", void 0), e.on("viewinit", function() {
		t._lastPlayheadPosition = -1;
	});
	[
		"pause",
		"rebufferstart",
		"seeking",
		"error",
		"adbreakstart",
		"hb",
		"renditionchange",
		"orientationchange",
		"viewend",
		"playbackmodechange"
	].forEach(function(n) {
		e.on(n, function() {
			if (t._lastPlayheadPosition >= 0 && e.data.player_playhead_time >= 0 && t._lastPlayerWidth >= 0 && t._lastSourceWidth > 0 && t._lastPlayerHeight >= 0 && t._lastSourceHeight > 0) {
				var o = e.data.player_playhead_time - t._lastPlayheadPosition;
				if (o < 0) {
					t._lastPlayheadPosition = -1;
					return;
				}
				var s = Math.min(t._lastPlayerWidth / t._lastSourceWidth, t._lastPlayerHeight / t._lastSourceHeight), u = Math.max(0, s - 1), f = Math.max(0, 1 - s);
				e.data.view_max_upscale_percentage = Math.max(e.data.view_max_upscale_percentage || 0, u), e.data.view_max_downscale_percentage = Math.max(e.data.view_max_downscale_percentage || 0, f), O(e.data, "view_total_content_playback_time", o), O(e.data, "view_total_upscaling", u * o), O(e.data, "view_total_downscaling", f * o);
			}
			t._lastPlayheadPosition = -1;
		});
	}), [
		"playing",
		"hb",
		"renditionchange",
		"orientationchange",
		"playbackmodechange"
	].forEach(function(n) {
		e.on(n, function() {
			t._lastPlayheadPosition = e.data.player_playhead_time, t._lastPlayerWidth = e.data.player_width, t._lastPlayerHeight = e.data.player_height, t._lastSourceWidth = e.data.video_source_width, t._lastSourceHeight = e.data.video_source_height;
		});
	});
};
var xa = 2e3;
var Kt = function r(e) {
	"use strict";
	var t = this;
	S(this, r), l(this, "isSeeking", void 0), this.isSeeking = !1;
	var i = -1, a = function() {
		var n = P.now(), o = (e.data.viewer_time || n) - (i || n);
		O(e.data, "view_seek_duration", o), e.data.view_max_seek_time = Math.max(e.data.view_max_seek_time || 0, o), t.isSeeking = !1, i = -1;
	};
	e.on("seeking", function(n, o) {
		if (Object.assign(e.data, o), t.isSeeking && o.viewer_time - i <= xa) {
			i = o.viewer_time;
			return;
		}
		t.isSeeking && a(), t.isSeeking = !0, i = o.viewer_time, O(e.data, "view_seek_count", 1), e.send("seeking");
	}), e.on("seeked", function() {
		a();
	}), e.on("viewend", function() {
		t.isSeeking && (a(), e.send("seeked")), t.isSeeking = !1, i = -1;
	});
};
var Yt = function(e, t) {
	e.push(t), e.sort(function(i, a) {
		return i.viewer_time - a.viewer_time;
	});
};
var Ra = [
	"adbreakstart",
	"adrequest",
	"adresponse",
	"adplay",
	"adplaying",
	"adpause",
	"adended",
	"adbreakend",
	"aderror",
	"adclicked",
	"adskipped"
];
var Xt = function() {
	"use strict";
	function r(e) {
		var t = this;
		S(this, r), l(this, "_adHasPlayed", void 0), l(this, "_adRequests", void 0), l(this, "_adResponses", void 0), l(this, "_currentAdRequestNumber", void 0), l(this, "_currentAdResponseNumber", void 0), l(this, "_prerollPlayTime", void 0), l(this, "_wouldBeNewAdPlay", void 0), l(this, "isAdBreak", void 0), l(this, "pm", void 0), this.pm = e, e.on("viewinit", function() {
			t.isAdBreak = !1, t._currentAdRequestNumber = 0, t._currentAdResponseNumber = 0, t._adRequests = [], t._adResponses = [], t._adHasPlayed = !1, t._wouldBeNewAdPlay = !0, t._prerollPlayTime = void 0;
		}), Ra.forEach(function(a) {
			return e.on(a, t._updateAdData.bind(t));
		});
		var i = function() {
			t.isAdBreak = !1;
		};
		e.on("adbreakstart", function() {
			t.isAdBreak = !0;
		}), e.on("play", i), e.on("playing", i), e.on("viewend", i), e.on("adrequest", function(a, n) {
			n = Object.assign({ ad_request_id: "generatedAdRequestId" + t._currentAdRequestNumber++ }, n), Yt(t._adRequests, n), O(e.data, "view_ad_request_count"), t.inPrerollPosition() && (e.data.view_preroll_requested = !0, t._adHasPlayed || O(e.data, "view_preroll_request_count"));
		}), e.on("adresponse", function(a, n) {
			n = Object.assign({ ad_request_id: "generatedAdRequestId" + t._currentAdResponseNumber++ }, n), Yt(t._adResponses, n);
			var o = t.findAdRequest(n.ad_request_id);
			o && O(e.data, "view_ad_request_time", Math.max(0, n.viewer_time - o.viewer_time));
		}), e.on("adplay", function(a, n) {
			t._adHasPlayed = !0, t._wouldBeNewAdPlay && (t._wouldBeNewAdPlay = !1, O(e.data, "view_ad_played_count")), t.inPrerollPosition() && !e.data.view_preroll_played && (e.data.view_preroll_played = !0, t._adRequests.length > 0 && (e.data.view_preroll_request_time = Math.max(0, n.viewer_time - t._adRequests[0].viewer_time)), e.data.view_start && (e.data.view_startup_preroll_request_time = Math.max(0, n.viewer_time - e.data.view_start)), t._prerollPlayTime = n.viewer_time);
		}), e.on("adplaying", function(a, n) {
			t.inPrerollPosition() && typeof e.data.view_preroll_load_time == "undefined" && typeof t._prerollPlayTime != "undefined" && (e.data.view_preroll_load_time = n.viewer_time - t._prerollPlayTime, e.data.view_startup_preroll_load_time = n.viewer_time - t._prerollPlayTime);
		}), e.on("adclicked", function(a, n) {
			t._wouldBeNewAdPlay || O(e.data, "view_ad_clicked_count");
		}), e.on("adskipped", function(a, n) {
			t._wouldBeNewAdPlay || O(e.data, "view_ad_skipped_count");
		}), e.on("adended", function() {
			t._wouldBeNewAdPlay = !0;
		}), e.on("aderror", function() {
			t._wouldBeNewAdPlay = !0;
		});
	}
	return N(r, [
		{
			key: "inPrerollPosition",
			value: function() {
				return typeof this.pm.data.view_content_playback_time == "undefined" || this.pm.data.view_content_playback_time <= 1e3;
			}
		},
		{
			key: "findAdRequest",
			value: function(t) {
				for (var i = 0; i < this._adRequests.length; i++) if (this._adRequests[i].ad_request_id === t) return this._adRequests[i];
			}
		},
		{
			key: "_updateAdData",
			value: function(t, i) {
				if (this.inPrerollPosition()) {
					if (!this.pm.data.view_preroll_ad_tag_hostname && i.ad_tag_url) {
						var a = H(re(i.ad_tag_url), 2), n = a[0], o = a[1];
						this.pm.data.view_preroll_ad_tag_domain = o, this.pm.data.view_preroll_ad_tag_hostname = n;
					}
					if (!this.pm.data.view_preroll_ad_asset_hostname && i.ad_asset_url) {
						var s = H(re(i.ad_asset_url), 2), u = s[0], f = s[1];
						this.pm.data.view_preroll_ad_asset_domain = f, this.pm.data.view_preroll_ad_asset_hostname = u;
					}
					this.pm.data.ad_type = "preroll";
				}
				this.pm.data.ad_asset_url = i == null ? void 0 : i.ad_asset_url, this.pm.data.ad_tag_url = i == null ? void 0 : i.ad_tag_url, this.pm.data.ad_creative_id = i == null ? void 0 : i.ad_creative_id, this.pm.data.ad_id = i == null ? void 0 : i.ad_id, this.pm.data.ad_universal_id = i == null ? void 0 : i.ad_universal_id, i != null && i.ad_type && (this.pm.data.ad_type = i == null ? void 0 : i.ad_type);
			}
		}
	]), r;
}();
var $t = function r(e) {
	"use strict";
	var t = this;
	S(this, r), l(this, "lastWallClockTime", void 0);
	var i = function() {
		t.lastWallClockTime = P.now(), e.on("before*", a);
	}, a = function(n) {
		var o = P.now(), s = t.lastWallClockTime;
		t.lastWallClockTime = o, o - s > 3e4 && (e.emit("devicesleep", { viewer_time: s }), Object.assign(e.data, { viewer_time: s }), e.send("devicesleep"), e.emit("devicewake", { viewer_time: o }), Object.assign(e.data, { viewer_time: o }), e.send("devicewake"));
	};
	e.one("playbackheartbeat", i), e.on("playbackheartbeatend", function() {
		e.off("before*", a), e.one("playbackheartbeat", i);
	});
};
var Fe = G(Q());
var ze = function(r) {
	return r();
}(function() {
	var r = function() {
		for (var i = 0, a = {}; i < arguments.length; i++) {
			var n = arguments[i];
			for (var o in n) a[o] = n[o];
		}
		return a;
	};
	function e(t) {
		function i(a, n, o) {
			var s;
			if (typeof document != "undefined") {
				if (arguments.length > 1) {
					if (o = r({ path: "/" }, i.defaults, o), typeof o.expires == "number") {
						var u = /* @__PURE__ */ new Date();
						u.setMilliseconds(u.getMilliseconds() + o.expires * 864e5), o.expires = u;
					}
					try {
						s = JSON.stringify(n), /^[\{\[]/.test(s) && (n = s);
					} catch (w) {}
					return t.write ? n = t.write(n, a) : n = encodeURIComponent(String(n)).replace(/%(23|24|26|2B|3A|3C|3E|3D|2F|3F|40|5B|5D|5E|60|7B|7D|7C)/g, decodeURIComponent), a = encodeURIComponent(String(a)), a = a.replace(/%(23|24|26|2B|5E|60|7C)/g, decodeURIComponent), a = a.replace(/[\(\)]/g, escape), document.cookie = [
						a,
						"=",
						n,
						o.expires ? "; expires=" + o.expires.toUTCString() : "",
						o.path ? "; path=" + o.path : "",
						o.domain ? "; domain=" + o.domain : "",
						o.secure ? "; secure" : ""
					].join("");
				}
				a || (s = {});
				for (var f = document.cookie ? document.cookie.split("; ") : [], h = /(%[0-9A-Z]{2})+/g, E = 0; E < f.length; E++) {
					var y = f[E].split("="), c = y.slice(1).join("=");
					c.charAt(0) === "\"" && (c = c.slice(1, -1));
					try {
						var p = y[0].replace(h, decodeURIComponent);
						if (c = t.read ? t.read(c, p) : t(c, p) || c.replace(h, decodeURIComponent), this.json) try {
							c = JSON.parse(c);
						} catch (w) {}
						if (a === p) {
							s = c;
							break;
						}
						a || (s[p] = c);
					} catch (w) {}
				}
				return s;
			}
		}
		return i.set = i, i.get = function(a) {
			return i.call(i, a);
		}, i.getJSON = function() {
			return i.apply({ json: !0 }, [].slice.call(arguments));
		}, i.defaults = {}, i.remove = function(a, n) {
			i(a, "", r(n, { expires: -1 }));
		}, i.withConverter = e, i;
	}
	return e(function() {});
});
var Zt = "muxData";
var Aa = function(r) {
	return Object.entries(r).map(function(e) {
		var t = H(e, 2), i = t[0], a = t[1];
		return "".concat(i, "=").concat(a);
	}).join("&");
};
var Pa = function(r) {
	return r.split("&").reduce(function(e, t) {
		var i = H(t.split("="), 2), a = i[0], n = i[1], o = +n;
		return e[a] = n && o == n ? o : n, e;
	}, {});
};
var er = function() {
	var e;
	try {
		e = Pa(ze.get(Zt) || "");
	} catch (t) {
		e = {};
	}
	return e;
};
var tr = function(e) {
	try {
		ze.set(Zt, Aa(e), { expires: 365 });
	} catch (t) {}
};
var rr = function() {
	var e = er();
	return e.mux_viewer_id = e.mux_viewer_id || ee(), e.msn = e.msn || Math.random(), tr(e), {
		mux_viewer_id: e.mux_viewer_id,
		mux_sample_number: e.msn
	};
};
var ar = function() {
	var e = er(), t = P.now();
	return e.session_start && (e.sst = e.session_start, delete e.session_start), e.session_id && (e.sid = e.session_id, delete e.session_id), e.session_expires && (e.sex = e.session_expires, delete e.session_expires), (!e.sex || e.sex < t) && (e.sid = ee(), e.sst = t), e.sex = t + 15e5, tr(e), {
		session_id: e.sid,
		session_start: e.sst,
		session_expires: e.sex
	};
};
function Ke(r, e) {
	var t = e.beaconCollectionDomain, i = e.beaconDomain;
	if (t) return "https://" + t;
	r = r || "inferred";
	var a = i || "litix.io";
	return r.match(/^[a-z0-9]+$/) ? "https://" + r + "." + a : "https://img.litix.io/a.gif";
}
var ir = G(Q());
var nr = function() {
	var e;
	switch (or()) {
		case "cellular":
			e = "cellular";
			break;
		case "ethernet":
			e = "wired";
			break;
		case "wifi":
			e = "wifi";
			break;
		case void 0: break;
		default: e = "other";
	}
	return e;
};
var or = function() {
	var e = ir.default.navigator, t = e && (e.connection || e.mozConnection || e.webkitConnection);
	return t && t.type;
};
nr.getConnectionFromAPI = or;
var sr = nr;
var La = lr({
	a: "env",
	b: "beacon",
	c: "custom",
	d: "ad",
	e: "event",
	f: "experiment",
	i: "internal",
	m: "mux",
	n: "response",
	p: "player",
	q: "request",
	r: "retry",
	s: "session",
	t: "timestamp",
	u: "viewer",
	v: "video",
	w: "page",
	x: "view",
	y: "sub"
});
var ur = lr({
	ad: "ad",
	af: "affiliate",
	ag: "aggregate",
	ap: "api",
	al: "application",
	ao: "audio",
	ar: "architecture",
	as: "asset",
	au: "autoplay",
	av: "average",
	bi: "bitrate",
	bn: "brand",
	br: "break",
	bw: "browser",
	by: "bytes",
	bz: "business",
	ca: "cached",
	cb: "cancel",
	cc: "codec",
	cd: "code",
	cg: "category",
	ch: "changed",
	ci: "client",
	ck: "clicked",
	cl: "canceled",
	cm: "cmcd",
	cn: "config",
	co: "count",
	ce: "counter",
	cp: "complete",
	cq: "creator",
	cr: "creative",
	cs: "captions",
	ct: "content",
	cu: "current",
	cv: "cumulative",
	cx: "connection",
	cz: "context",
	da: "data",
	dg: "downscaling",
	dm: "domain",
	dn: "cdn",
	do: "downscale",
	dr: "drm",
	dp: "dropped",
	du: "duration",
	dv: "device",
	dy: "dynamic",
	eb: "enabled",
	ec: "encoding",
	ed: "edge",
	en: "end",
	eg: "engine",
	em: "embed",
	er: "error",
	ep: "experiments",
	es: "errorcode",
	et: "errortext",
	ee: "event",
	ev: "events",
	ex: "expires",
	ez: "exception",
	fa: "failed",
	fi: "first",
	fm: "family",
	ft: "format",
	fp: "fps",
	fq: "frequency",
	fr: "frame",
	fs: "fullscreen",
	ha: "has",
	hb: "holdback",
	he: "headers",
	ho: "host",
	hn: "hostname",
	ht: "height",
	id: "id",
	ii: "init",
	in: "instance",
	ip: "ip",
	is: "is",
	ke: "key",
	la: "language",
	lb: "labeled",
	le: "level",
	li: "live",
	ld: "loaded",
	lo: "load",
	ls: "lists",
	lt: "latency",
	ma: "max",
	md: "media",
	me: "message",
	mf: "manifest",
	mi: "mime",
	ml: "midroll",
	mm: "min",
	mn: "manufacturer",
	mo: "model",
	mp: "mode",
	ms: "ms",
	mx: "mux",
	ne: "newest",
	nm: "name",
	no: "number",
	on: "on",
	or: "origin",
	os: "os",
	pa: "paused",
	pb: "playback",
	pd: "producer",
	pe: "percentage",
	pf: "played",
	pg: "program",
	ph: "playhead",
	pi: "plugin",
	pl: "preroll",
	pn: "playing",
	po: "poster",
	pp: "pip",
	pr: "preload",
	ps: "position",
	pt: "part",
	pv: "previous",
	py: "property",
	px: "pop",
	pz: "plan",
	ra: "rate",
	rd: "requested",
	re: "rebuffer",
	rf: "rendition",
	rg: "range",
	rm: "remote",
	ro: "ratio",
	rp: "response",
	rq: "request",
	rs: "requests",
	sa: "sample",
	sd: "skipped",
	se: "session",
	sh: "shift",
	sk: "seek",
	sm: "stream",
	so: "source",
	sq: "sequence",
	sr: "series",
	ss: "status",
	st: "start",
	su: "startup",
	sv: "server",
	sw: "software",
	sy: "severity",
	ta: "tag",
	tc: "tech",
	te: "text",
	tg: "target",
	th: "throughput",
	ti: "time",
	tl: "total",
	to: "to",
	tt: "title",
	ty: "type",
	ug: "upscaling",
	un: "universal",
	up: "upscale",
	ur: "url",
	us: "user",
	va: "variant",
	vd: "viewed",
	vi: "video",
	ve: "version",
	vw: "view",
	vr: "viewer",
	wd: "width",
	wa: "watch",
	wt: "waiting"
});
function lr(r) {
	var e = {};
	for (var t in r) r.hasOwnProperty(t) && (e[r[t]] = t);
	return e;
}
function me(r) {
	var e = {}, t = {};
	return Object.keys(r).forEach(function(i) {
		var a = !1;
		if (r.hasOwnProperty(i) && r[i] !== void 0) {
			var n = i.split("_"), o = n[0], s = La[o];
			s || (q.info("Data key word `" + n[0] + "` not expected in " + i), s = o + "_"), n.splice(1).forEach(function(u) {
				u === "url" && (a = !0), ur[u] ? s += ur[u] : Number.isInteger(Number(u)) ? s += u : (q.info("Data key word `" + u + "` not expected in " + i), s += "_" + u + "_");
			}), a ? t[s] = r[i] : e[s] = r[i];
		}
	}), Object.assign(e, t);
}
var ie = G(Q());
var Nr = G(nt());
var oi = {
	maxBeaconSize: 300,
	maxQueueLength: 3600,
	baseTimeBetweenBeacons: 1e4,
	maxPayloadKBSize: 500
};
var si = 57344;
var ui = [
	"hb",
	"requestcompleted",
	"requestfailed",
	"requestcanceled"
];
var li = "https://img.litix.io";
var $ = function(e) {
	var t = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
	this._beaconUrl = e || li, this._eventQueue = [], this._postInFlight = !1, this._resendAfterPost = !1, this._failureCount = 0, this._sendTimeout = !1, this._options = Object.assign({}, oi, t);
};
$.prototype.queueEvent = function(r, e) {
	var t = Object.assign({}, e);
	return this._eventQueue.length <= this._options.maxQueueLength || r === "eventrateexceeded" ? (this._eventQueue.push(t), this._sendTimeout || this._startBeaconSending(), this._eventQueue.length <= this._options.maxQueueLength) : !1;
};
$.prototype.flushEvents = function() {
	if ((arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : !1) && this._eventQueue.length === 1) {
		this._eventQueue.pop();
		return;
	}
	this._eventQueue.length && this._sendBeaconQueue(), this._startBeaconSending();
};
$.prototype.destroy = function() {
	var r = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : !1;
	this.destroyed = !0, r ? this._clearBeaconQueue() : this.flushEvents(), ie.default.clearTimeout(this._sendTimeout);
};
$.prototype._clearBeaconQueue = function() {
	var r = this._eventQueue.length > this._options.maxBeaconSize ? this._eventQueue.length - this._options.maxBeaconSize : 0, e = this._eventQueue.slice(r);
	r > 0 && Object.assign(e[e.length - 1], me({ mux_view_message: "event queue truncated" }));
	var t = this._createPayload(e);
	Cr(this._beaconUrl, t, !0, function() {});
};
$.prototype._sendBeaconQueue = function() {
	var r = this;
	if (this._postInFlight) {
		this._resendAfterPost = !0;
		return;
	}
	var e = this._eventQueue.slice(0, this._options.maxBeaconSize);
	this._eventQueue = this._eventQueue.slice(this._options.maxBeaconSize), this._postInFlight = !0;
	var t = this._createPayload(e), i = P.now();
	Cr(this._beaconUrl, t, !1, function(a, n) {
		n ? (r._eventQueue = e.concat(r._eventQueue), r._failureCount += 1, q.info("Error sending beacon: " + n)) : r._failureCount = 0, r._roundTripTime = P.now() - i, r._postInFlight = !1, r._resendAfterPost && (r._resendAfterPost = !1, r._eventQueue.length > 0 && r._sendBeaconQueue());
	});
};
$.prototype._getNextBeaconTime = function() {
	if (!this._failureCount) return this._options.baseTimeBetweenBeacons;
	var r = Math.pow(2, this._failureCount - 1);
	return r = r * Math.random(), (1 + r) * this._options.baseTimeBetweenBeacons;
};
$.prototype._startBeaconSending = function() {
	var r = this;
	ie.default.clearTimeout(this._sendTimeout), !this.destroyed && (this._sendTimeout = ie.default.setTimeout(function() {
		r._eventQueue.length && r._sendBeaconQueue(), r._startBeaconSending();
	}, this._getNextBeaconTime()));
};
$.prototype._createPayload = function(r) {
	var e = this, t = { transmission_timestamp: Math.round(P.now()) };
	this._roundTripTime && (t.rtt_ms = Math.round(this._roundTripTime));
	var i, a, n, o = function() {
		i = JSON.stringify({
			metadata: t,
			events: a || r
		}), n = i.length / 1024;
	}, s = function() {
		return n <= e._options.maxPayloadKBSize;
	};
	return o(), s() || (q.info("Payload size is too big (" + n + " kb). Removing unnecessary events."), a = r.filter(function(u) {
		return ui.indexOf(u.e) === -1;
	}), o()), s() || (q.info("Payload size still too big (" + n + " kb). Cropping fields.."), a.forEach(function(u) {
		for (var f in u) {
			var h = u[f], E = 51200;
			typeof h == "string" && h.length > E && (u[f] = h.substring(0, E));
		}
	}), o()), i;
};
var di = typeof Nr.default.exitPictureInPicture == "function" ? function(r) {
	return r.length <= si;
} : function(r) {
	return !1;
};
var Cr = function(r, e, t, i) {
	if (t && navigator && navigator.sendBeacon && navigator.sendBeacon(r, e)) {
		i();
		return;
	}
	if (ie.default.fetch) {
		ie.default.fetch(r, {
			method: "POST",
			body: e,
			headers: { "Content-Type": "text/plain" },
			keepalive: di(e)
		}).then(function(n) {
			return i(null, n.ok ? null : "Error");
		}).catch(function(n) {
			return i(null, n);
		});
		return;
	}
	if (ie.default.XMLHttpRequest) {
		var a = new ie.default.XMLHttpRequest();
		a.onreadystatechange = function() {
			if (a.readyState === 4) return i(null, a.status !== 200 ? "error" : void 0);
		}, a.open("POST", r), a.setRequestHeader("Content-Type", "text/plain"), a.send(e);
		return;
	}
	i();
};
var Mr = $;
var ci = [
	"env_key",
	"view_id",
	"view_sequence_number",
	"player_sequence_number",
	"beacon_domain",
	"player_playhead_time",
	"viewer_time",
	"mux_api_version",
	"event",
	"video_id",
	"player_instance_id",
	"player_error_code",
	"player_error_message",
	"player_error_context",
	"player_error_severity",
	"player_error_business_exception",
	"view_playing_time_ms_cumulative",
	"ad_playing_time_ms_cumulative"
];
var _i = [
	"adplay",
	"adplaying",
	"adpause",
	"adfirstquartile",
	"admidpoint",
	"adthirdquartile",
	"adended",
	"adresponse",
	"adrequest"
];
var fi = [
	"ad_id",
	"ad_creative_id",
	"ad_universal_id"
];
var pi = [
	"viewstart",
	"error",
	"ended",
	"viewend"
];
var mi = 6e5;
var Hr = function() {
	"use strict";
	function r(e, t) {
		var i = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
		S(this, r);
		var a, n, o, s, u, f, h, E, y, c, p, w;
		l(this, "mux", void 0), l(this, "envKey", void 0), l(this, "options", void 0), l(this, "eventQueue", void 0), l(this, "sampleRate", void 0), l(this, "disableCookies", void 0), l(this, "respectDoNotTrack", void 0), l(this, "previousBeaconData", void 0), l(this, "lastEventTime", void 0), l(this, "rateLimited", void 0), l(this, "pageLevelData", void 0), l(this, "viewerData", void 0), this.mux = e, this.envKey = t, this.options = i, this.previousBeaconData = null, this.lastEventTime = 0, this.rateLimited = !1, this.eventQueue = new Mr(Ke(this.envKey, this.options));
		var x;
		this.sampleRate = (x = this.options.sampleRate) !== null && x !== void 0 ? x : 1;
		var v;
		this.disableCookies = (v = this.options.disableCookies) !== null && v !== void 0 ? v : !1;
		var m;
		this.respectDoNotTrack = (m = this.options.respectDoNotTrack) !== null && m !== void 0 ? m : !1, this.previousBeaconData = null, this.lastEventTime = 0, this.rateLimited = !1, this.pageLevelData = {
			mux_api_version: this.mux.API_VERSION,
			mux_embed: this.mux.NAME,
			mux_embed_version: this.mux.VERSION,
			viewer_application_name: (a = this.options.platform) === null || a === void 0 ? void 0 : a.name,
			viewer_application_version: (n = this.options.platform) === null || n === void 0 ? void 0 : n.version,
			viewer_application_engine: (o = this.options.platform) === null || o === void 0 ? void 0 : o.layout,
			viewer_device_name: (s = this.options.platform) === null || s === void 0 ? void 0 : s.product,
			viewer_device_category: "",
			viewer_device_manufacturer: (u = this.options.platform) === null || u === void 0 ? void 0 : u.manufacturer,
			viewer_os_family: (h = this.options.platform) === null || h === void 0 || (f = h.os) === null || f === void 0 ? void 0 : f.family,
			viewer_os_architecture: (y = this.options.platform) === null || y === void 0 || (E = y.os) === null || E === void 0 ? void 0 : E.architecture,
			viewer_os_version: (p = this.options.platform) === null || p === void 0 || (c = p.os) === null || c === void 0 ? void 0 : c.version,
			viewer_connection_type: sr(),
			page_url: Fe.default === null || Fe.default === void 0 || (w = Fe.default.location) === null || w === void 0 ? void 0 : w.href
		}, this.viewerData = this.disableCookies ? {} : rr();
	}
	return N(r, [
		{
			key: "send",
			value: function(t, i) {
				if (!(!t || !(i != null && i.view_id))) {
					if (this.respectDoNotTrack && ce()) return q.info("Not sending `" + t + "` because Do Not Track is enabled");
					if (!i || typeof i != "object") return q.error("A data object was expected in send() but was not provided");
					var a = this.disableCookies ? {} : ar(), n = fe(ue({}, this.pageLevelData, i, a, this.viewerData), {
						event: t,
						env_key: this.envKey
					});
					n.user_id && (n.viewer_user_id = n.user_id, delete n.user_id);
					var o, s = ((o = n.mux_sample_number) !== null && o !== void 0 ? o : 0) >= this.sampleRate, f = me(this._deduplicateBeaconData(t, n));
					if (this.lastEventTime = this.mux.utils.now(), s) return q.info("Not sending event due to sample rate restriction", t, n, f);
					if (this.envKey || q.info("Missing environment key (envKey) - beacons will be dropped if the video source is not a valid mux video URL", t, n, f), !this.rateLimited) if (q.info("Sending event", t, n, f), this.rateLimited = !this.eventQueue.queueEvent(t, f), this.mux.WINDOW_UNLOADING && t === "viewend") this.eventQueue.destroy(!0);
					else {
						if (this.mux.WINDOW_HIDDEN && t === "hb") this.eventQueue.flushEvents(!0);
						else if (pi.indexOf(t) >= 0) {
							if (t === "error" && i.player_error_severity === "warning") return;
							this.eventQueue.flushEvents();
						}
						if (this.rateLimited) return n.event = "eventrateexceeded", f = me(n), this.eventQueue.queueEvent(n.event, f), q.error("Beaconing disabled due to rate limit.");
					}
				}
			}
		},
		{
			key: "destroy",
			value: function() {
				this.eventQueue.destroy(!1);
			}
		},
		{
			key: "_deduplicateBeaconData",
			value: function(t, i) {
				var a = this, n = {}, o = i.view_id;
				if (o === "-1" || t === "viewstart" || t === "viewend" || !this.previousBeaconData || this.mux.utils.now() - this.lastEventTime >= mi) n = ue({}, i), o && (this.previousBeaconData = n), o && t === "viewend" && (this.previousBeaconData = null);
				else {
					var s = t.indexOf("request") === 0;
					Object.entries(i).forEach(function(u) {
						var f = H(u, 2), h = f[0], E = f[1];
						a.previousBeaconData && (E !== a.previousBeaconData[h] || ci.indexOf(h) > -1 || a.objectHasChanged(s, h, E, a.previousBeaconData[h]) || a.eventRequiresKey(t, h)) && (n[h] = E, a.previousBeaconData[h] = E);
					});
				}
				return n;
			}
		},
		{
			key: "objectHasChanged",
			value: function(t, i, a, n) {
				return !t || i.indexOf("request_") !== 0 ? !1 : i === "request_response_headers" || typeof a != "object" || typeof n != "object" ? !0 : Object.keys(a || {}).length !== Object.keys(n || {}).length;
			}
		},
		{
			key: "eventRequiresKey",
			value: function(t, i) {
				return !!(t === "renditionchange" && i.indexOf("video_source_") === 0 || fi.includes(i) && _i.includes(t) || t === "playbackmodechange" && i.indexOf("player_playback_mode") === 0);
			}
		}
	]), r;
}();
var Br = function r(e) {
	"use strict";
	S(this, r);
	var t = 0, i = 0, a = 0, n = 0, o = 0, s = 0, u = 0, f = function(y, c) {
		var p = c.request_start, w = c.request_response_start, x = c.request_response_end, v = c.request_bytes_loaded;
		n++;
		var m, _;
		if (w ? (m = w - (p != null ? p : 0), _ = (x != null ? x : 0) - w) : _ = (x != null ? x : 0) - (p != null ? p : 0), _ > 0 && v && v > 0) {
			var d = v / _ * 8e3;
			o++, i += v, a += _, e.data.view_min_request_throughput = Math.min(e.data.view_min_request_throughput || 1 / 0, d), e.data.view_average_request_throughput = i / a * 8e3, e.data.view_request_count = n, m > 0 && (t += m, e.data.view_max_request_latency = Math.max(e.data.view_max_request_latency || 0, m), e.data.view_average_request_latency = t / o);
		}
	}, h = function(y, c) {
		n++, s++, e.data.view_request_count = n, e.data.view_request_failed_count = s;
	}, E = function(y, c) {
		n++, u++, e.data.view_request_count = n, e.data.view_request_canceled_count = u;
	};
	e.on("requestcompleted", f), e.on("requestfailed", h), e.on("requestcanceled", E);
};
var hi = 36e5;
var Ur = function r(e) {
	"use strict";
	var t = this;
	S(this, r), l(this, "_lastEventTime", void 0), e.on("before*", function(i, a) {
		var n = a.viewer_time, o = P.now(), s = t._lastEventTime;
		if (t._lastEventTime = o, s && o - s > hi) {
			var u = Object.keys(e.data).reduce(function(h, E) {
				return E.indexOf("video_") === 0 ? Object.assign(h, l({}, E, e.data[E])) : h;
			}, {});
			e.mux.log.info("Received event after at least an hour inactivity, creating a new view");
			var f = e.playbackHeartbeat._playheadShouldBeProgressing;
			e._resetView(Object.assign({ viewer_time: n }, u)), e.playbackHeartbeat._playheadShouldBeProgressing = f, e.playbackHeartbeat._playheadShouldBeProgressing && i.type !== "play" && i.type !== "adbreakstart" && (e.emit("play", { viewer_time: n }), i.type !== "playing" && e.emit("playing", { viewer_time: n }));
		}
	});
};
var gi = function r(e) {
	"use strict";
	S(this, r);
	var t = function(u) {
		var f = bi(u), h = wi(u);
		if (f != null && !Fr(f, n) && o <= h) {
			n = f, o = h;
			var E = { video_cdn: f };
			e.emit("cdnchange", E);
		}
	}, i = null, a = null, n = null, o = 0;
	e.on("viewinit", function() {
		i = null, a = null, n = null, o = 0;
	}), e.on("beforecdnchange", function(s, u) {
		var f = u == null ? void 0 : u.video_cdn;
		f && (typeof u.video_previous_cdn == "undefined" || u.video_previous_cdn === null) && (Fr(f, a) ? u.video_previous_cdn = i != null ? i : void 0 : (u.video_previous_cdn = a != null ? a : void 0, i = a, a = f));
	}), e.on("requestcompleted", function(s, u) {
		t(u);
	});
};
function Fr(r, e) {
	return (r == null ? void 0 : r.toLowerCase()) === (e == null ? void 0 : e.toLowerCase());
}
function bi(r) {
	var e;
	return r != null && r.request_type && (r.request_type === "media" || r.request_type === "video") && !((e = r.request_response_headers) === null || e === void 0) && e["x-cdn"] ? r.request_response_headers["x-cdn"] : r != null && r.video_cdn ? r.video_cdn : null;
}
function wi(r) {
	return r != null && r.request_start ? r.request_start : r != null && r.viewer_time ? r.viewer_time : Date.now();
}
var Vr = gi;
var Ti = function(r) {
	try {
		return JSON.parse(r), !0;
	} catch (e) {
		return !1;
	}
};
var jr = function r(e) {
	"use strict";
	var t = this;
	S(this, r), l(this, "_emittingAutomaticEvent", !1), l(this, "_hasInitialized", !1), l(this, "_currentMode", "standard"), e.on("viewstart", function() {
		t._hasInitialized || (t._hasInitialized = !0, t._currentMode = e.data.player_playback_mode || "standard", t._emittingAutomaticEvent = !0, e.emit("playbackmodechange", {
			player_playback_mode: t._currentMode,
			player_playback_mode_data: "{}"
		}), t._emittingAutomaticEvent = !1);
	}), e.on("viewend", function() {
		t._hasInitialized = !1;
	}), e.on("playbackmodechange", function(i, a) {
		t._emittingAutomaticEvent || (a.player_playback_mode_data ? Ti(a.player_playback_mode_data) || (e.mux.log.warn("Invalid JSON string for player_playback_mode_data"), a.player_playback_mode_data = "{}") : a.player_playback_mode_data = "{}", e.data.player_playback_mode_data = a.player_playback_mode_data, e.data.player_playback_mode = a.player_playback_mode, t._currentMode = a.player_playback_mode);
	});
};
var Wr = function() {
	"use strict";
	function r(e) {
		S(this, r), l(this, "pm", void 0), l(this, "_currentRangeStart", void 0), l(this, "_lastPlayheadTime", void 0), this.pm = e, this._currentRangeStart = null, this._lastPlayheadTime = null, e.on("playbackheartbeat", this._updatePlaybackRange.bind(this)), e.on("playbackheartbeatend", this._endPlaybackRange.bind(this));
	}
	return N(r, [
		{
			key: "_updateLastRangeEnd",
			value: function() {
				var t = this.pm.data.video_playback_ranges;
				if (t && t.length > 0) {
					var i = this.pm.data.player_playhead_time || 0;
					t[t.length - 1][1] = i;
				}
			}
		},
		{
			key: "_updatePlaybackRange",
			value: function() {
				var t, i = this.pm.data.player_playhead_time || 0;
				if (!(!this.pm.disableAdPlaybackRangeFiltering && !((t = this.pm.adTracker) === null || t === void 0) && t.isAdBreak && this._lastPlayheadTime !== null && i < this._lastPlayheadTime)) {
					if (this._lastPlayheadTime !== null && this._currentRangeStart !== null) {
						if (Math.abs(i - this._lastPlayheadTime) > 1e3) {
							var n = this.pm.data.video_playback_ranges;
							n && n.length > 0 && (n[n.length - 1][1] = this._lastPlayheadTime), this._currentRangeStart = null;
						}
					}
					if (this._currentRangeStart === null) {
						var o = this.pm.data.video_playback_ranges || [];
						o.length > 0 && o[o.length - 1][1] === i ? this._currentRangeStart = o[o.length - 1][0] : (this._currentRangeStart = i, o.push([i, i])), this.pm.data.video_playback_ranges = o;
					} else this._updateLastRangeEnd();
					this._lastPlayheadTime = i;
				}
			}
		},
		{
			key: "_endPlaybackRange",
			value: function() {
				this._currentRangeStart !== null && (this._updateLastRangeEnd(), this._currentRangeStart = null, this._lastPlayheadTime = null);
			}
		}
	]), r;
}();
var xi = [
	"viewstart",
	"ended",
	"loadstart",
	"pause",
	"play",
	"playing",
	"ratechange",
	"waiting",
	"adplay",
	"adpause",
	"adended",
	"aderror",
	"adplaying",
	"adrequest",
	"adresponse",
	"adbreakstart",
	"adbreakend",
	"adfirstquartile",
	"admidpoint",
	"adthirdquartile",
	"rebufferstart",
	"rebufferend",
	"seeked",
	"error",
	"hb",
	"requestcompleted",
	"requestfailed",
	"requestcanceled",
	"renditionchange",
	"cdnchange",
	"playbackmodechange"
];
var Si = /* @__PURE__ */ new Set([
	"requestcompleted",
	"requestfailed",
	"requestcanceled"
]);
var Gr = function(r) {
	"use strict";
	xt(t, r);
	var e = At(t);
	function t(i, a, n) {
		S(this, t);
		var o = e.call(this);
		l(b(o), "pageLoadEndTime", void 0), l(b(o), "pageLoadInitTime", void 0), l(b(o), "_destroyed", void 0), l(b(o), "_heartBeatTimeout", void 0), l(b(o), "adTracker", void 0), l(b(o), "dashjs", void 0), l(b(o), "data", void 0), l(b(o), "disablePlayheadRebufferTracking", void 0), l(b(o), "disableRebufferTracking", void 0), l(b(o), "disableAdPlaybackRangeFiltering", void 0), l(b(o), "errorTracker", void 0), l(b(o), "errorTranslator", void 0), l(b(o), "emitTranslator", void 0), l(b(o), "getAdData", void 0), l(b(o), "getPlayheadTime", void 0), l(b(o), "getStateData", void 0), l(b(o), "stateDataTranslator", void 0), l(b(o), "hlsjs", void 0), l(b(o), "id", void 0), l(b(o), "longResumeTracker", void 0), l(b(o), "minimumRebufferDuration", void 0), l(b(o), "mux", void 0), l(b(o), "playbackEventDispatcher", void 0), l(b(o), "playbackHeartbeat", void 0), l(b(o), "playbackHeartbeatTime", void 0), l(b(o), "playheadTime", void 0), l(b(o), "seekingTracker", void 0), l(b(o), "sustainedRebufferThreshold", void 0), l(b(o), "watchTimeTracker", void 0), l(b(o), "currentFragmentPDT", void 0), l(b(o), "currentFragmentStart", void 0), o.pageLoadInitTime = _e.navigationStart(), o.pageLoadEndTime = _e.domContentLoadedEventEnd();
		o.mux = i, o.id = a, n != null && n.beaconDomain && o.mux.log.warn("The `beaconDomain` setting has been deprecated in favor of `beaconCollectionDomain`. Please change your integration to use `beaconCollectionDomain` instead of `beaconDomain`."), n = Object.assign({
			debug: !1,
			minimumRebufferDuration: 250,
			sustainedRebufferThreshold: 1e3,
			playbackHeartbeatTime: 25,
			beaconDomain: "litix.io",
			sampleRate: 1,
			disableCookies: !1,
			respectDoNotTrack: !1,
			disableRebufferTracking: !1,
			disablePlayheadRebufferTracking: !1,
			disableAdPlaybackRangeFiltering: !1,
			errorTranslator: function(y) {
				return y;
			},
			emitTranslator: function() {
				for (var y = arguments.length, c = new Array(y), p = 0; p < y; p++) c[p] = arguments[p];
				return c;
			},
			stateDataTranslator: function(y) {
				return y;
			}
		}, n), n.data = n.data || {}, n.data.property_key && (n.data.env_key = n.data.property_key, delete n.data.property_key), q.level = n.debug ? Y.DEBUG : Y.WARN, o.getPlayheadTime = n.getPlayheadTime, o.getStateData = n.getStateData || function() {
			return {};
		}, o.getAdData = n.getAdData || function() {}, o.minimumRebufferDuration = n.minimumRebufferDuration, o.sustainedRebufferThreshold = n.sustainedRebufferThreshold, o.playbackHeartbeatTime = n.playbackHeartbeatTime, o.disableRebufferTracking = n.disableRebufferTracking, o.disableRebufferTracking && o.mux.log.warn("Disabling rebuffer tracking. This should only be used in specific circumstances as a last resort when your player is known to unreliably track rebuffering."), o.disablePlayheadRebufferTracking = n.disablePlayheadRebufferTracking, o.disableAdPlaybackRangeFiltering = n.disableAdPlaybackRangeFiltering, o.errorTranslator = n.errorTranslator, o.emitTranslator = n.emitTranslator, o.stateDataTranslator = n.stateDataTranslator, o.playbackEventDispatcher = new Hr(i, n.data.env_key, n), o.data = {
			player_instance_id: ee(),
			mux_sample_rate: n.sampleRate,
			beacon_domain: n.beaconCollectionDomain || n.beaconDomain
		}, o.data.view_sequence_number = 1, o.data.player_sequence_number = 1;
		var u = function() {
			typeof this.data.view_start == "undefined" && (this.data.view_start = this.mux.utils.now(), this.emit("viewstart"), this.emit("renditionchange"));
		}.bind(b(o));
		if (o.on("viewinit", function(y, c) {
			this._resetVideoData(), this._resetViewData(), this._resetErrorData(), this._updateStateData(), Object.assign(this.data, c), this._initializeViewData(), this.one("play", u), this.one("adbreakstart", u);
		}), o.on("videochange", function(y, c) {
			this._resetView(c);
		}), o.on("programchange", function(y, c) {
			this.data.player_is_paused && this.mux.log.warn("The `programchange` event is intended to be used when the content changes mid playback without the video source changing, however the video is not currently playing. If the video source is changing please use the videochange event otherwise you will lose startup time information."), this._resetView(Object.assign(c, { view_program_changed: !0 })), u(), this.emit("play"), this.emit("playing");
		}), o.on("fragmentchange", function(y, c) {
			this.currentFragmentPDT = c.currentFragmentPDT, this.currentFragmentStart = c.currentFragmentStart;
		}), o.on("destroy", o.destroy), typeof window != "undefined" && typeof window.addEventListener == "function" && typeof window.removeEventListener == "function") {
			var f = function() {
				var y = typeof o.data.view_start != "undefined";
				o.mux.WINDOW_HIDDEN = document.visibilityState === "hidden", y && o.mux.WINDOW_HIDDEN && (o.data.player_is_paused || o.emit("hb"));
			};
			window.addEventListener("visibilitychange", f, !1);
			var h = function(y) {
				y.persisted || o.destroy();
			};
			window.addEventListener("pagehide", h, !1), o.on("destroy", function() {
				window.removeEventListener("visibilitychange", f), window.removeEventListener("pagehide", h);
			});
		}
		o.on("playerready", function(y, c) {
			Object.assign(this.data, c);
		}), xi.forEach(function(y) {
			o.on(y, function(c, p) {
				y.indexOf("ad") !== 0 && this._updateStateData(), Object.assign(this.data, p), this._sanitizeData();
			}), o.on("after" + y, function() {
				(y !== "error" || this.errorTracker.viewErrored) && this.send(y);
			});
		}), o.on("viewend", function(y, c) {
			Object.assign(o.data, c);
		});
		var E = function(c) {
			var p = this.mux.utils.now();
			this.data.player_init_time && (this.data.player_startup_time = p - this.data.player_init_time), this.pageLoadInitTime = this.data.page_load_init_time || this.pageLoadInitTime, this.pageLoadEndTime = this.data.page_load_end_time || this.pageLoadEndTime, !this.mux.PLAYER_TRACKED && this.pageLoadInitTime && (this.mux.PLAYER_TRACKED = !0, (this.data.player_init_time || this.pageLoadEndTime) && (this.data.page_load_time = Math.min(this.data.player_init_time || 1 / 0, this.pageLoadEndTime || 1 / 0) - this.pageLoadInitTime)), this.send("playerready"), delete this.data.player_startup_time, delete this.data.page_load_time;
		};
		return o.one("playerready", E), o.longResumeTracker = new Ur(b(o)), o.errorTracker = new Ut(b(o)), new $t(b(o)), o.seekingTracker = new Kt(b(o)), o.playheadTime = new jt(b(o)), o.playbackHeartbeat = new Bt(b(o)), new zt(b(o)), o.watchTimeTracker = new Ft(b(o)), new Vt(b(o)), new Wr(b(o)), o.adTracker = new Xt(b(o)), new Jt(b(o)), new Gt(b(o)), new Qt(b(o)), new Br(b(o)), new Vr(b(o)), new jr(b(o)), n.hlsjs && o.addHLSJS(n), n.dashjs && o.addDashJS(n), o.emit("viewinit", n.data), o;
	}
	return N(t, [
		{
			key: "emit",
			value: function(a, n) {
				var o, s = Object.assign({ viewer_time: this.mux.utils.now() }, n), u = [a, s];
				if (this.emitTranslator) try {
					u = this.emitTranslator(a, s);
				} catch (f) {
					this.mux.log.warn("Exception in emit translator callback.", f);
				}
				u != null && u.length && (o = Se(X(t.prototype), "emit", this)).call.apply(o, [this].concat(V(u)));
			}
		},
		{
			key: "destroy",
			value: function() {
				this._destroyed || (this._destroyed = !0, typeof this.data.view_start != "undefined" && (this.emit("viewend"), this.send("viewend")), this.playbackEventDispatcher.destroy(), this.removeHLSJS(), this.removeDashJS(), window.clearTimeout(this._heartBeatTimeout));
			}
		},
		{
			key: "send",
			value: function(a) {
				if (this.data.view_id) {
					var n = Object.assign({}, this.data);
					if (n.video_source_is_live === void 0 && (n.player_source_duration === 1 / 0 || n.video_source_duration === 1 / 0 ? n.video_source_is_live = !0 : (n.player_source_duration > 0 || n.video_source_duration > 0) && (n.video_source_is_live = !1)), n.video_source_is_live || [
						"player_program_time",
						"player_manifest_newest_program_time",
						"player_live_edge_program_time",
						"player_program_time",
						"video_holdback",
						"video_part_holdback",
						"video_target_duration",
						"video_part_target_duration"
					].forEach(function(h) {
						n[h] = void 0;
					}), n.video_source_url = n.video_source_url || n.player_source_url, n.video_source_url) {
						var s = H(re(n.video_source_url), 2), u = s[0];
						n.video_source_domain = s[1], n.video_source_hostname = u;
					}
					delete n.ad_request_id, n.video_playback_ranges && (n.video_playback_range = JSON.stringify(n.video_playback_ranges.filter(function(h) {
						return h[0] !== h[1];
					}).map(function(h) {
						return "".concat(h[0], ":").concat(h[1]);
					})), delete n.video_playback_ranges), this.playbackEventDispatcher.send(a, n), this.data.view_sequence_number++, this.data.player_sequence_number++, Si.has(a) || this._restartHeartBeat(), a === "viewend" && delete this.data.view_id;
				}
			}
		},
		{
			key: "_resetView",
			value: function(a) {
				this.emit("viewend"), this.send("viewend"), this.emit("viewinit", a);
			}
		},
		{
			key: "_updateStateData",
			value: function() {
				var a, n = this.getStateData();
				if (typeof this.stateDataTranslator == "function") try {
					n = this.stateDataTranslator(n);
				} catch (u) {
					this.mux.log.warn("Exception in stateDataTranslator translator callback.", u);
				}
				if (!((a = this.data) === null || a === void 0) && a.video_cdn && n != null && n.video_cdn) {
					n.video_cdn;
					n = Rt(n, ["video_cdn"]);
				}
				Object.assign(this.data, n), this.playheadTime._updatePlayheadTime(), this._sanitizeData();
			}
		},
		{
			key: "_sanitizeData",
			value: function() {
				var a = this;
				[
					"player_width",
					"player_height",
					"video_source_width",
					"video_source_height",
					"player_playhead_time",
					"video_source_bitrate"
				].forEach(function(s) {
					var u = parseInt(a.data[s], 10);
					a.data[s] = isNaN(u) ? void 0 : u;
				});
				["player_source_url", "video_source_url"].forEach(function(s) {
					if (a.data[s]) {
						var u = a.data[s].toLowerCase();
						(u.indexOf("data:") === 0 || u.indexOf("blob:") === 0) && (a.data[s] = "MSE style URL");
					}
				});
			}
		},
		{
			key: "_resetVideoData",
			value: function() {
				var a = this;
				Object.keys(this.data).forEach(function(n) {
					n.indexOf("video_") === 0 && delete a.data[n];
				});
			}
		},
		{
			key: "_resetViewData",
			value: function() {
				var a = this;
				Object.keys(this.data).forEach(function(n) {
					n.indexOf("view_") === 0 && delete a.data[n];
				}), this.data.view_sequence_number = 1;
			}
		},
		{
			key: "_resetErrorData",
			value: function() {
				delete this.data.player_error_code, delete this.data.player_error_message, delete this.data.player_error_context, delete this.data.player_error_severity, delete this.data.player_error_business_exception;
			}
		},
		{
			key: "_initializeViewData",
			value: function() {
				var a = this, n = this.data.view_id = ee(), o = function() {
					n === a.data.view_id && O(a.data, "player_view_count", 1);
				};
				this.data.player_is_paused ? this.one("play", o) : o();
			}
		},
		{
			key: "_restartHeartBeat",
			value: function() {
				var a = this;
				window.clearTimeout(this._heartBeatTimeout), this._heartBeatTimeout = window.setTimeout(function() {
					a.data.player_is_paused || a.emit("hb");
				}, 1e4);
			}
		},
		{
			key: "addHLSJS",
			value: function(a) {
				if (!a.hlsjs) {
					this.mux.log.warn("You must pass a valid hlsjs instance in order to track it.");
					return;
				}
				if (this.hlsjs) {
					this.mux.log.warn("An instance of HLS.js is already being monitored for this player.");
					return;
				}
				this.hlsjs = a.hlsjs, Ot(this.mux, this.id, a.hlsjs, {}, a.Hls || window.Hls);
			}
		},
		{
			key: "removeHLSJS",
			value: function() {
				this.hlsjs && (Lt(this.hlsjs), this.hlsjs = void 0);
			}
		},
		{
			key: "addDashJS",
			value: function(a) {
				if (!a.dashjs) {
					this.mux.log.warn("You must pass a valid dashjs instance in order to track it.");
					return;
				}
				if (this.dashjs) {
					this.mux.log.warn("An instance of Dash.js is already being monitored for this player.");
					return;
				}
				this.dashjs = a.dashjs, Nt(this.mux, this.id, a.dashjs);
			}
		},
		{
			key: "removeDashJS",
			value: function() {
				this.dashjs && (Ct(this.dashjs), this.dashjs = void 0);
			}
		}
	]), t;
}(Ht);
var he = G(nt());
function Ae() {
	return he.default && !!(he.default.fullscreenElement || he.default.webkitFullscreenElement || he.default.mozFullScreenElement || he.default.msFullscreenElement);
}
var Di = [
	"loadstart",
	"pause",
	"play",
	"playing",
	"seeking",
	"seeked",
	"timeupdate",
	"ratechange",
	"stalled",
	"waiting",
	"error",
	"ended"
];
var qi = {
	1: "MEDIA_ERR_ABORTED",
	2: "MEDIA_ERR_NETWORK",
	3: "MEDIA_ERR_DECODE",
	4: "MEDIA_ERR_SRC_NOT_SUPPORTED"
};
function ot(r, e, t) {
	var i = H(se(e), 3), a = i[0], n = i[1], o = i[2], s = r.log, u = r.utils.getComputedStyle, f = r.utils.secondsToMs, h = { automaticErrorTracking: !0 };
	if (a) {
		if (o !== "video" && o !== "audio") return s.error("The element of `" + n + "` was not a media element.");
	} else return s.error("No element was found with the `" + n + "` query selector.");
	a.mux && (a.mux.destroy(), delete a.mux, s.warn("Already monitoring this video element, replacing existing event listeners"));
	t = Object.assign(h, t, {
		getPlayheadTime: function() {
			return f(a.currentTime);
		},
		getStateData: function() {
			var p, w, x, v = ((p = (w = this).getPlayheadTime) === null || p === void 0 ? void 0 : p.call(w)) || f(a.currentTime), m = this.hlsjs && this.hlsjs.url, _ = this.dashjs && typeof this.dashjs.getSource == "function" && this.dashjs.getSource(), d = {
				player_is_paused: a.paused,
				player_width: parseInt(u(a, "width")),
				player_height: parseInt(u(a, "height")),
				player_autoplay_on: a.autoplay,
				player_preload_on: a.preload,
				player_language_code: a.lang,
				player_is_fullscreen: Ae(),
				video_poster_url: a.poster,
				video_source_url: m || _ || a.currentSrc,
				video_source_duration: f(a.duration),
				video_source_height: a.videoHeight,
				video_source_width: a.videoWidth,
				view_dropped_frame_count: a == null || (x = a.getVideoPlaybackQuality) === null || x === void 0 ? void 0 : x.call(a).droppedVideoFrames
			};
			if (a.getStartDate && v > 0) {
				var g = a.getStartDate();
				if (g && typeof g.getTime == "function" && g.getTime()) {
					var T = g.getTime();
					if (d.player_program_time = T + v, a.seekable.length > 0) d.player_live_edge_program_time = T + a.seekable.end(a.seekable.length - 1);
				}
			}
			return d;
		}
	}), t.data = Object.assign({
		player_software: "HTML5 Video Element",
		player_mux_plugin_name: "VideoElementMonitor",
		player_mux_plugin_version: r.VERSION
	}, t.data), a.mux = a.mux || {}, a.mux.deleted = !1, a.mux.emit = function(c, p) {
		r.emit(n, c, p);
	}, a.mux.updateData = function(c) {
		a.mux.emit("hb", c);
	};
	var y = function() {
		s.error("The monitor for this video element has already been destroyed.");
	};
	a.mux.destroy = function() {
		Object.keys(a.mux.listeners).forEach(function(c) {
			a.removeEventListener(c, a.mux.listeners[c], !1);
		}), delete a.mux.listeners, a.mux.fullscreenChangeListener && (document.removeEventListener("fullscreenchange", a.mux.fullscreenChangeListener, !1), delete a.mux.fullscreenChangeListener), a.mux.destroy = y, a.mux.swapElement = y, a.mux.emit = y, a.mux.addHLSJS = y, a.mux.addDashJS = y, a.mux.removeHLSJS = y, a.mux.removeDashJS = y, a.mux.updateData = y, a.mux.setEmitTranslator = y, a.mux.setStateDataTranslator = y, a.mux.setGetPlayheadTime = y, a.mux.deleted = !0, r.emit(n, "destroy");
	}, a.mux.swapElement = function(c) {
		var p = H(se(c), 3), w = p[0], x = p[1], v = p[2];
		if (w) {
			if (v !== "video" && v !== "audio") return r.log.error("The element of `" + x + "` was not a media element.");
		} else return r.log.error("No element was found with the `" + x + "` query selector.");
		w.muxId = a.muxId, delete a.muxId, w.mux = w.mux || {}, w.mux.listeners = Object.assign({}, a.mux.listeners), delete a.mux.listeners, Object.keys(w.mux.listeners).forEach(function(m) {
			a.removeEventListener(m, w.mux.listeners[m], !1), w.addEventListener(m, w.mux.listeners[m], !1);
		}), w.mux.fullscreenChangeListener = a.mux.fullscreenChangeListener, delete a.mux.fullscreenChangeListener, w.mux.swapElement = a.mux.swapElement, w.mux.destroy = a.mux.destroy, delete a.mux, a = w;
	}, a.mux.addHLSJS = function(c) {
		r.addHLSJS(n, c);
	}, a.mux.addDashJS = function(c) {
		r.addDashJS(n, c);
	}, a.mux.removeHLSJS = function() {
		r.removeHLSJS(n);
	}, a.mux.removeDashJS = function() {
		r.removeDashJS(n);
	}, a.mux.setEmitTranslator = function(c) {
		r.setEmitTranslator(n, c);
	}, a.mux.setStateDataTranslator = function(c) {
		r.setStateDataTranslator(n, c);
	}, a.mux.setGetPlayheadTime = function(c) {
		c || (c = t.getPlayheadTime), r.setGetPlayheadTime(n, c);
	}, r.init(n, t), r.emit(n, "playerready"), a.paused || (r.emit(n, "play"), a.readyState > 2 && r.emit(n, "playing")), a.mux.listeners = {}, Di.forEach(function(c) {
		c === "error" && !t.automaticErrorTracking || (a.mux.listeners[c] = function() {
			var p = {};
			if (c === "error") {
				if (!a.error || a.error.code === 1) return;
				p.player_error_code = a.error.code, p.player_error_message = qi[a.error.code] || a.error.message;
			}
			r.emit(n, c, p);
		}, a.addEventListener(c, a.mux.listeners[c], !1));
	}), a.mux.listeners.enterpictureinpicture = function() {
		r.emit(n, "playbackmodechange", {
			player_playback_mode: "pip",
			player_playback_mode_data: "{}"
		});
	}, a.mux.listeners.leavepictureinpicture = function() {
		var c = Ae() ? "fullscreen" : "standard";
		r.emit(n, "playbackmodechange", {
			player_playback_mode: c,
			player_playback_mode_data: "{}"
		});
	}, a.addEventListener("enterpictureinpicture", a.mux.listeners.enterpictureinpicture, !1), a.addEventListener("leavepictureinpicture", a.mux.listeners.leavepictureinpicture, !1), a.mux.fullscreenChangeListener = function() {
		var c = Ae(), p = document.fullscreenElement;
		if (c && (p === a || p != null && p.contains(a))) r.emit(n, "playbackmodechange", {
			player_playback_mode: "fullscreen",
			player_playback_mode_data: "{}"
		});
		else if (!c) {
			var x = document.pictureInPictureElement === a ? "pip" : "standard";
			r.emit(n, "playbackmodechange", {
				player_playback_mode: x,
				player_playback_mode_data: "{}"
			});
		}
	}, document.addEventListener("fullscreenchange", a.mux.fullscreenChangeListener, !1);
}
function st(r, e, t, i) {
	var a = i;
	if (r && typeof r[e] == "function") try {
		a = r[e].apply(r, t);
	} catch (n) {
		q.info("safeCall error", n);
	}
	return a;
}
var ge = G(Q());
var ye;
ge.default && ge.default.WeakMap && (ye = /* @__PURE__ */ new WeakMap());
function ut(r, e) {
	if (!r || !e || !ge.default || typeof ge.default.getComputedStyle != "function") return "";
	var t;
	return ye && ye.has(r) && (t = ye.get(r)), t || (t = ge.default.getComputedStyle(r, null), ye && ye.set(r, t)), t.getPropertyValue(e);
}
function lt(r) {
	return Math.floor(r * 1e3);
}
var de = {
	TARGET_DURATION: "#EXT-X-TARGETDURATION",
	PART_INF: "#EXT-X-PART-INF",
	SERVER_CONTROL: "#EXT-X-SERVER-CONTROL",
	INF: "#EXTINF",
	PROGRAM_DATE_TIME: "#EXT-X-PROGRAM-DATE-TIME",
	VERSION: "#EXT-X-VERSION",
	SESSION_DATA: "#EXT-X-SESSION-DATA"
};
var Ve = function(e) {
	return this.buffer = "", this.manifest = {
		segments: [],
		serverControl: {},
		sessionData: {}
	}, this.currentUri = {}, this.process(e), this.manifest;
};
Ve.prototype.process = function(r) {
	var e;
	for (this.buffer += r, e = this.buffer.indexOf("\n"); e > -1; e = this.buffer.indexOf("\n")) this.processLine(this.buffer.substring(0, e)), this.buffer = this.buffer.substring(e + 1);
};
Ve.prototype.processLine = function(r) {
	var t = Li(r, r.indexOf(":")), i = t[0], a = t.length === 2 ? ct(t[1]) : void 0;
	if (i[0] !== "#") this.currentUri.uri = i, this.manifest.segments.push(this.currentUri), this.manifest.targetDuration && !("duration" in this.currentUri) && (this.currentUri.duration = this.manifest.targetDuration), this.currentUri = {};
	else switch (i) {
		case de.TARGET_DURATION:
			if (!isFinite(a) || a < 0) return;
			this.manifest.targetDuration = a, this.setHoldBack();
			break;
		case de.PART_INF:
			dt(this.manifest, t), this.manifest.partInf.partTarget && (this.manifest.partTargetDuration = this.manifest.partInf.partTarget), this.setHoldBack();
			break;
		case de.SERVER_CONTROL:
			dt(this.manifest, t), this.setHoldBack();
			break;
		case de.INF:
			a === 0 ? this.currentUri.duration = .01 : a > 0 && (this.currentUri.duration = a);
			break;
		case de.PROGRAM_DATE_TIME:
			var n = a, o = new Date(n);
			this.manifest.dateTimeString || (this.manifest.dateTimeString = n, this.manifest.dateTimeObject = o), this.currentUri.dateTimeString = n, this.currentUri.dateTimeObject = o;
			break;
		case de.VERSION:
			dt(this.manifest, t);
			break;
		case de.SESSION_DATA:
			var u = Me(Ii(t[1]));
			Object.assign(this.manifest.sessionData, u);
	}
};
Ve.prototype.setHoldBack = function() {
	var r = this.manifest, e = r.serverControl, t = r.targetDuration, i = r.partTargetDuration;
	if (e) {
		var a = "holdBack", n = "partHoldBack", o = t && t * 3, s = i && i * 2;
		t && !e.hasOwnProperty(a) && (e[a] = o), o && e[a] < o && (e[a] = o), i && !e.hasOwnProperty(n) && (e[n] = i * 3), i && e[n] < s && (e[n] = s);
	}
};
var dt = function(r, e) {
	var t = Jr(e[0].replace("#EXT-X-", "")), i;
	Oi(e[1]) ? (i = {}, i = Object.assign(Pi(e[1]), i)) : i = ct(e[1]), r[t] = i;
};
var Jr = function(r) {
	return r.toLowerCase().replace(/-(\w)/g, function(e) {
		return e[1].toUpperCase();
	});
};
var ct = function(r) {
	if (r.toLowerCase() === "yes" || r.toLowerCase() === "no") return r.toLowerCase() === "yes";
	var e = r.indexOf(":") !== -1 ? r : parseFloat(r);
	return isNaN(e) ? r : e;
};
var Ai = function(r) {
	var e = {}, t = r.split("=");
	if (t.length > 1) {
		var i = Jr(t[0]);
		e[i] = ct(t[1]);
	}
	return e;
};
var Pi = function(r) {
	for (var e = r.split(","), t = {}, i = 0; e.length > i; i++) {
		var a = e[i], n = Ai(a);
		t = Object.assign(n, t);
	}
	return t;
};
var Oi = function(r) {
	return r.indexOf("=") > -1;
};
var Li = function(r, e) {
	return e === -1 ? [r] : [r.substring(0, e), r.substring(e + 1)];
};
var Ii = function(r) {
	var e = {};
	if (r) {
		var t = r.search(",");
		return [r.slice(0, t), r.slice(t + 1)].forEach(function(o, s) {
			for (var u = o.replace(/['"]+/g, "").split("="), f = 0; f < u.length; f++) u[f] === "DATA-ID" && (e["DATA-ID"] = u[1 - f]), u[f] === "VALUE" && (e.VALUE = u[1 - f]);
		}), { data: e };
	}
};
var zr = {
	safeCall: st,
	safeIncrement: O,
	getComputedStyle: ut,
	secondsToMs: lt,
	assign: Object.assign,
	headersStringToObject: pe,
	cdnHeadersToRequestId: le,
	extractHostnameAndDomain: re,
	extractHostname: F,
	manifestParser: Ve,
	generateShortID: Oe,
	generateUUID: ee,
	now: P.now,
	findMediaElement: se
};
var Kr = {
	PLAYER_READY: "playerready",
	VIEW_INIT: "viewinit",
	VIDEO_CHANGE: "videochange",
	PLAY: "play",
	PAUSE: "pause",
	PLAYING: "playing",
	TIME_UPDATE: "timeupdate",
	SEEKING: "seeking",
	SEEKED: "seeked",
	REBUFFER_START: "rebufferstart",
	REBUFFER_END: "rebufferend",
	ERROR: "error",
	ENDED: "ended",
	RENDITION_CHANGE: "renditionchange",
	ORIENTATION_CHANGE: "orientationchange",
	PLAYBACK_MODE_CHANGE: "playbackmodechange",
	AD_REQUEST: "adrequest",
	AD_RESPONSE: "adresponse",
	AD_BREAK_START: "adbreakstart",
	AD_PLAY: "adplay",
	AD_PLAYING: "adplaying",
	AD_PAUSE: "adpause",
	AD_FIRST_QUARTILE: "adfirstquartile",
	AD_MID_POINT: "admidpoint",
	AD_THIRD_QUARTILE: "adthirdquartile",
	AD_ENDED: "adended",
	AD_BREAK_END: "adbreakend",
	AD_ERROR: "aderror",
	REQUEST_COMPLETED: "requestcompleted",
	REQUEST_FAILED: "requestfailed",
	REQUEST_CANCELLED: "requestcanceled",
	HEARTBEAT: "hb",
	DESTROY: "destroy"
};
var Mi = "mux-embed";
var Hi = "5.17.10";
var Bi = "2.1";
var M = {};
var ne = function(e) {
	var t = arguments;
	typeof e == "string" ? ne.hasOwnProperty(e) ? be.default.setTimeout(function() {
		t = Array.prototype.splice.call(t, 1), ne[e].apply(null, t);
	}, 0) : q.warn("`" + e + "` is an unknown task") : typeof e == "function" ? be.default.setTimeout(function() {
		e(ne);
	}, 0) : q.warn("`" + e + "` is invalid.");
};
var Ui = {
	loaded: P.now(),
	NAME: Mi,
	VERSION: Hi,
	API_VERSION: Bi,
	PLAYER_TRACKED: !1,
	monitor: function(e, t) {
		return ot(ne, e, t);
	},
	destroyMonitor: function(e) {
		var i = H(se(e), 1)[0];
		i && i.mux && typeof i.mux.destroy == "function" ? i.mux.destroy() : q.error("A video element monitor for `" + e + "` has not been initialized via `mux.monitor`.");
	},
	addHLSJS: function(e, t) {
		var i = J(e);
		M[i] ? M[i].addHLSJS(t) : q.error("A monitor for `" + i + "` has not been initialized.");
	},
	addDashJS: function(e, t) {
		var i = J(e);
		M[i] ? M[i].addDashJS(t) : q.error("A monitor for `" + i + "` has not been initialized.");
	},
	removeHLSJS: function(e) {
		var t = J(e);
		M[t] ? M[t].removeHLSJS() : q.error("A monitor for `" + t + "` has not been initialized.");
	},
	removeDashJS: function(e) {
		var t = J(e);
		M[t] ? M[t].removeDashJS() : q.error("A monitor for `" + t + "` has not been initialized.");
	},
	init: function(e, t) {
		ce() && t && t.respectDoNotTrack && q.info("The browser's Do Not Track flag is enabled - Mux beaconing is disabled.");
		var i = J(e);
		M[i] = new Gr(ne, i, t);
	},
	emit: function(e, t, i) {
		var a = J(e);
		M[a] ? (M[a].emit(t, i), t === "destroy" && delete M[a]) : q.error("A monitor for `" + a + "` has not been initialized.");
	},
	updateData: function(e, t) {
		var i = J(e);
		M[i] ? M[i].emit("hb", t) : q.error("A monitor for `" + i + "` has not been initialized.");
	},
	setEmitTranslator: function(e, t) {
		var i = J(e);
		M[i] ? M[i].emitTranslator = t : q.error("A monitor for `" + i + "` has not been initialized.");
	},
	setStateDataTranslator: function(e, t) {
		var i = J(e);
		M[i] ? M[i].stateDataTranslator = t : q.error("A monitor for `" + i + "` has not been initialized.");
	},
	setGetPlayheadTime: function(e, t) {
		var i = J(e);
		M[i] ? M[i].getPlayheadTime = t : q.error("A monitor for `" + i + "` has not been initialized.");
	},
	checkDoNotTrack: ce,
	log: q,
	utils: zr,
	events: Kr,
	WINDOW_HIDDEN: !1,
	WINDOW_UNLOADING: !1
};
Object.assign(ne, Ui);
typeof be.default != "undefined" && typeof be.default.addEventListener == "function" && be.default.addEventListener("pagehide", function(r) {
	r.persisted || (ne.WINDOW_UNLOADING = !0);
}, !1);
var jl = ne;
/*!
* JavaScript Cookie v2.1.3
* https://github.com/js-cookie/js-cookie
*
* Copyright 2006, 2015 Klaus Hartl & Fagner Brack
* Released under the MIT license
*/

//#endregion
//#region ../extensions/mux-data/dist/dev/extension.js
const MUX_VIDEO_DOMAIN = "mux.com";
/**
* Identifies this extension as the Mux Data integration, so its views can be told apart from other integrations that
* also report `player_software_name: 'Video.js'`, such as `videojs-mux` for Video.js 8. Without it the SDK reports its
* plain `<video>` monitor. The extension ships in lockstep with the player, so the player version is its version.
*/
const MUX_PLUGIN_DATA = {
	player_mux_plugin_name: "@videojs/mux-data",
	player_mux_plugin_version: getPlayerVersion()
};
/**
* The JS engine behind `media`, if it (or the adapter it fronts) drives one. Engines are unrelated types (an hls.js
* instance, a dash.js player, an SPF composition); which of them Mux Data can hook is decided by
* {@link toMuxDataEngineOptions}, not here.
*/
function engineOf(media) {
	const adapter = getMediaAdapter(media) ?? media;
	return isEngineAdapter(adapter) ? adapter.engine : null;
}
/**
* The media's source URL as the player sees it. An adapter reports the URL it plays on `src`, not the `blob:` it feeds
* the element. A plain `<video>` that picks from `<source>` children leaves `src` empty and reports the pick on
* `currentSrc`; a `blob:` there is a MediaSource handle, not a video, so it does not count.
*/
function srcOf(media) {
	if (!isMediaSourceCapable(media)) return "";
	if (media.src) return media.src;
	return media.currentSrc.startsWith("blob:") ? "" : media.currentSrc;
}
/**
* Player extension that monitors the player's media with the Mux Data SDK.
*
* The SDK needs the native element, so a media component or adapter is resolved to the `<video>` it fronts; a plain
* `<video>` is monitored directly. Source and engine changes are read from the media the player attached.
*
* Its `PlayerExtension` members are internal: the player drives them, and the element and hook that register it check
* that it conforms.
*/
var MuxDataExtension = class MuxDataExtension {
	static defaultProps = {
		MuxDataSdk: jl,
		beaconCollectionDomain: void 0,
		debug: false,
		disableCookies: false,
		envKey: void 0,
		playerSoftwareName: "Video.js",
		playerSoftwareVersion: getPlayerVersion(),
		playerInitTime: void 0,
		metadata: void 0
	};
	#MuxDataSdk = MuxDataExtension.defaultProps.MuxDataSdk;
	#pendingSync = null;
	#beaconCollectionDomain = MuxDataExtension.defaultProps.beaconCollectionDomain;
	#debug = MuxDataExtension.defaultProps.debug;
	#disableCookies = MuxDataExtension.defaultProps.disableCookies;
	#metadata = MuxDataExtension.defaultProps.metadata;
	#envKey = MuxDataExtension.defaultProps.envKey;
	#playerSoftwareName = MuxDataExtension.defaultProps.playerSoftwareName;
	#playerSoftwareVersion = MuxDataExtension.defaultProps.playerSoftwareVersion;
	#playerInitTime = MuxDataExtension.defaultProps.playerInitTime;
	#playerCreatedAt;
	#constructedAt = this.#generatePlayerInitTime();
	#media = null;
	#stopListening = null;
	#target = null;
	#monitoredSrc = null;
	#monitoredEngine = null;
	#engineHook = null;
	#viewSessionId;
	constructor(props = {}) {
		Object.assign(this, props);
	}
	/** @internal Player lifecycle; the player calls it. */
	connect(player) {
		this.#playerCreatedAt = player.initTime;
	}
	/** @internal Player lifecycle; the player calls it. */
	disconnect() {
		this.#playerCreatedAt = void 0;
	}
	/** @internal Player lifecycle; the player calls it. */
	attach({ media }) {
		if (this.#media === media) return;
		this.detach();
		this.#media = media;
		this.#stopListening = listen(media, "loadstart", this.#syncMonitor);
		this.#syncMonitor();
	}
	/** @internal Player lifecycle; the player calls it. */
	detach() {
		this.#destroyMonitor();
		this.#stopListening?.();
		this.#stopListening = null;
		this.#media = null;
		this.#target = null;
	}
	destroy() {
		this.detach();
	}
	get MuxDataSdk() {
		return this.#MuxDataSdk;
	}
	set MuxDataSdk(value) {
		if (this.#MuxDataSdk === value) return;
		this.#MuxDataSdk = value;
		this.#reinitialize();
	}
	get beaconCollectionDomain() {
		return this.#beaconCollectionDomain;
	}
	set beaconCollectionDomain(value) {
		if (this.#beaconCollectionDomain === value) return;
		this.#beaconCollectionDomain = value;
		this.#reinitialize();
	}
	get debug() {
		return this.#debug;
	}
	set debug(value) {
		if (this.#debug === value) return;
		this.#debug = value;
		this.#reinitialize();
	}
	get disableCookies() {
		return this.#disableCookies;
	}
	set disableCookies(value) {
		if (this.#disableCookies === value) return;
		this.#disableCookies = value;
		this.#reinitialize();
	}
	/**
	* Mux Data environment key. Omitted from the beacon when unset, which is the norm for Mux-hosted playback: the view
	* reports the Mux playback ID as its `video_id` (see {@link toVideoId}) and Mux attributes it to the owning
	* environment. Set this to monitor sources Mux doesn't host.
	*/
	get envKey() {
		return this.#envKey;
	}
	set envKey(value) {
		if (this.#envKey === value) return;
		this.#envKey = value;
		this.#target?.mux?.updateData(value ? { env_key: value } : {});
	}
	/**
	* Player name reported to Mux Data. Defaults to `Video.js`; players built on Video.js, such as `mux-video`, set their
	* own.
	*/
	get playerSoftwareName() {
		return this.#playerSoftwareName;
	}
	set playerSoftwareName(value) {
		if (this.#playerSoftwareName === value) return;
		this.#playerSoftwareName = value;
		this.#target?.mux?.updateData(value ? {
			player_software_name: value,
			player_software: value
		} : {});
	}
	get playerSoftwareVersion() {
		return this.#playerSoftwareVersion;
	}
	set playerSoftwareVersion(value) {
		if (this.#playerSoftwareVersion === value) return;
		this.#playerSoftwareVersion = value;
		this.#target?.mux?.updateData(value ? { player_software_version: value } : {});
	}
	/** Epoch milliseconds the player was initialized. Defaults to when the player was created. */
	get playerInitTime() {
		return this.#playerInitTime ?? this.#playerCreatedAt ?? this.#constructedAt;
	}
	set playerInitTime(value) {
		if (this.#playerInitTime === value) return;
		this.#playerInitTime = value;
		const initTime = this.playerInitTime;
		this.#target?.mux?.updateData(initTime ? { player_init_time: initTime } : {});
	}
	get metadata() {
		return this.#metadata;
	}
	set metadata(value) {
		if (this.#metadata === value) return;
		this.#metadata = value;
		this.#target?.mux?.updateData(value ? { ...value } : {});
	}
	#destroyMonitor() {
		if (this.#target?.mux) {
			this.#target.mux.destroy();
			delete this.#target.mux;
		}
		this.#monitoredSrc = null;
		this.#monitoredEngine = null;
		this.#engineHook = null;
	}
	/**
	* Full re-monitor, reserved for options that are baked into `monitor()` itself (the SDK, beacon routing, debug,
	* cookies). Source and engine changes go through {@link #syncMonitor} instead, which keeps the monitor — and its view
	* — alive.
	*/
	#reinitialize = () => {
		this.#destroyMonitor();
		this.#syncMonitor();
	};
	/**
	* Reconcile the monitor with the media's current state. Called on every `loadstart`, but the event is only a hint:
	* the media's element, `src`, and `engine` are compared against what the monitor already reflects, so a same-video
	* `load()` (remote playback engaging, an engine rebuild, a MediaSource re-attach) is a no-op, a video change becomes
	* a `videochange` on the live monitor, and only a missing monitor — or a new element behind the media — starts a new
	* one.
	*/
	#syncMonitor = () => {
		this.#sync();
	};
	async #sync() {
		if (this.#pendingSync) return;
		await (this.#pendingSync = Promise.resolve());
		this.#pendingSync = null;
		const media = this.#media;
		if (!media) return;
		const target = getMediaElement(media);
		if (target !== this.#target) {
			this.#destroyMonitor();
			this.#target = target;
		}
		if (!this.MuxDataSdk || !target) return;
		const mux = target.mux;
		if (!mux || mux.deleted) {
			this.#monitor(target, media);
			return;
		}
		this.#syncEngineHook(mux, engineOf(media));
		const src = srcOf(media);
		if (src === this.#monitoredSrc) return;
		if (!src) return;
		const isFirstSource = !this.#monitoredSrc;
		this.#monitoredSrc = src;
		if (isFirstSource) {
			mux.updateData(this.#videoData(media));
			return;
		}
		mux.emit("videochange", this.#videoData(media));
	}
	/** Keep engine telemetry hooked to the engine actually playing, without restarting the monitor. */
	#syncEngineHook(mux, engine) {
		if (engine === this.#monitoredEngine) return;
		if (this.#engineHook === "hlsjs") mux.removeHLSJS();
		if (this.#engineHook === "dashjs") mux.removeDashJS();
		const options = toMuxDataEngineOptions(engine);
		if (options.hlsjs && options.Hls) mux.addHLSJS({
			hlsjs: options.hlsjs,
			Hls: options.Hls
		});
		if (options.dashjs) mux.addDashJS({ dashjs: options.dashjs });
		this.#trackEngine(engine, options);
	}
	/** Record which engine the monitor reflects and which telemetry hook carries it. */
	#trackEngine(engine, options) {
		this.#monitoredEngine = engine ?? null;
		this.#engineHook = options.hlsjs ? "hlsjs" : options.dashjs ? "dashjs" : null;
	}
	#monitor(target, media) {
		const { debug, beaconCollectionDomain, disableCookies, envKey: env_key, playerSoftwareName: player_software_name, playerSoftwareVersion: player_software_version, playerInitTime: player_init_time } = this;
		const engine = engineOf(media);
		const engineOptions = toMuxDataEngineOptions(engine);
		this.#monitoredSrc = srcOf(media);
		this.#trackEngine(engine, engineOptions);
		this.MuxDataSdk?.monitor(target, {
			debug,
			...beaconCollectionDomain ? { beaconCollectionDomain } : {},
			...disableCookies ? { disableCookies } : {},
			...engineOptions,
			data: {
				...MUX_PLUGIN_DATA,
				...env_key ? { env_key } : {},
				...player_software_name ? { player_software_name } : {},
				...player_software_name ? { player_software: player_software_name } : {},
				...player_software_version ? { player_software_version } : {},
				...player_init_time ? { player_init_time } : {},
				...this.#videoData(media)
			}
		});
	}
	/**
	* The video-scoped beacon data: the session id, the derived `video_id`, and the caller's metadata, which may override
	* both. Built fresh per use — the caller's `metadata` object is never mutated.
	*/
	#videoData(media) {
		const metadata = this.metadata ?? {};
		const view_session_id = metadata.view_session_id ?? (this.#viewSessionId ??= this.MuxDataSdk?.utils.generateUUID());
		const video_id = toVideoId({
			metadata,
			src: srcOf(media)
		});
		const derived = {};
		if (view_session_id) derived.view_session_id = view_session_id;
		if (video_id) derived.video_id = video_id;
		return {
			...derived,
			...metadata
		};
	}
	#generatePlayerInitTime() {
		if (!this.MuxDataSdk) return void 0;
		return this.MuxDataSdk.utils.now();
	}
};
function toVideoId(props) {
	if (props.metadata?.video_id) return props.metadata.video_id;
	if (!isMuxVideoSrc(props)) return props.src;
	return toPlaybackIdFromSrc(props.src) ?? props.src;
}
function toPlaybackIdFromSrc(src) {
	if (!src?.startsWith("https://stream.")) return void 0;
	const [playbackId] = new URL(src).pathname.slice(1).split(/\.m3u8|\//);
	return playbackId || void 0;
}
function isMuxVideoSrc({ src }) {
	if (typeof src !== "string") return false;
	const base = window?.location.href;
	return new URL(src, base).hostname.toLocaleLowerCase().includes(MUX_VIDEO_DOMAIN);
}

//#endregion
//#region ../html/dist/dev/extensions/mux-data/extension.js
/**
* Adds the [Mux Data](https://www.mux.com/data) extension to the surrounding player.
*
* Renders nothing — place it inside the player and it follows whatever media the player attaches.
*
* Mux-hosted playback needs no `env-key`: the view reports the Mux playback ID as its `video_id`, which Mux attributes
* to the owning environment. Set `env-key` to monitor sources Mux doesn't host.
*
* Any media component works. When the media plays through an hls.js or dash.js engine, that engine is handed to the Mux
* Data SDK so the view also carries stream-level detail such as rendition switches and request timing.
*
* @example
*   ```html
*   <video-player>
*   <mux-video src="https://stream.mux.com/abc123.m3u8"></mux-video>
*   <mux-data player-software-name="mux-video"></mux-data>
*   </video-player>
*   ```;
*/
var MuxDataExtension$1 = class extends PlayerExtensionElement {
	static {
		this.tagName = "mux-data";
	}
	static {
		this.properties = {
			envKey: {
				type: String,
				attribute: "env-key"
			},
			beaconCollectionDomain: {
				type: String,
				attribute: "beacon-collection-domain"
			},
			debug: { type: Boolean },
			disableCookies: {
				type: Boolean,
				attribute: "disable-cookies"
			},
			playerSoftwareName: {
				type: String,
				attribute: "player-software-name"
			},
			playerSoftwareVersion: {
				type: String,
				attribute: "player-software-version"
			},
			playerInitTime: {
				type: Number,
				attribute: "player-init-time"
			}
		};
	}
	createExtension() {
		return new MuxDataExtension();
	}
	/** Mux Data environment key for the beacons. Optional for Mux-hosted playback. */
	get envKey() {
		return this.extension.envKey;
	}
	set envKey(value) {
		this.extension.envKey = value ?? void 0;
	}
	/** Custom domain beacons are sent to. */
	get beaconCollectionDomain() {
		return this.extension.beaconCollectionDomain;
	}
	set beaconCollectionDomain(value) {
		this.extension.beaconCollectionDomain = value ?? void 0;
	}
	/** Enables Mux Data SDK debug logging. */
	get debug() {
		return this.extension.debug;
	}
	set debug(value) {
		this.extension.debug = value;
	}
	/** Disables Mux Data SDK cookies. */
	get disableCookies() {
		return this.extension.disableCookies;
	}
	set disableCookies(value) {
		this.extension.disableCookies = value;
	}
	/** Player software name reported to Mux Data (e.g. `mux-video`). Defaults to `Video.js`. */
	get playerSoftwareName() {
		return this.extension.playerSoftwareName;
	}
	set playerSoftwareName(value) {
		this.extension.playerSoftwareName = value ?? void 0;
	}
	/** Player software version reported to Mux Data. Defaults to the Video.js version. */
	get playerSoftwareVersion() {
		return this.extension.playerSoftwareVersion;
	}
	set playerSoftwareVersion(value) {
		this.extension.playerSoftwareVersion = value ?? void 0;
	}
	/** Epoch milliseconds the player was initialized. Defaults to when the player was created. */
	get playerInitTime() {
		return this.extension.playerInitTime;
	}
	set playerInitTime(value) {
		this.extension.playerInitTime = value ?? void 0;
	}
	/** Custom view metadata forwarded to the Mux Data SDK. */
	get metadata() {
		return this.extension.metadata;
	}
	set metadata(value) {
		this.extension.metadata = value;
	}
	/** Mux Data SDK used for monitoring. Set to `undefined` to disable monitoring. */
	get MuxDataSdk() {
		return this.extension.MuxDataSdk;
	}
	set MuxDataSdk(value) {
		this.extension.MuxDataSdk = value;
	}
};

//#endregion
//#region ../html/dist/dev/define/extensions/mux-data.js
safeDefine(MuxDataExtension$1);

//#endregion
export { MuxDataExtension$1 as MuxDataExtension };
//# sourceMappingURL=mux-data.dev.js.map