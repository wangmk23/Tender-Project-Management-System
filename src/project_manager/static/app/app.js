var Ic = { exports: {} }, bn = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var id;
function Wm() {
  if (id) return bn;
  id = 1;
  var r = Symbol.for("react.transitional.element"), d = Symbol.for("react.fragment");
  function m(f, E, z) {
    var j = null;
    if (z !== void 0 && (j = "" + z), E.key !== void 0 && (j = "" + E.key), "key" in E) {
      z = {};
      for (var U in E)
        U !== "key" && (z[U] = E[U]);
    } else z = E;
    return E = z.ref, {
      $$typeof: r,
      type: f,
      key: j,
      ref: E !== void 0 ? E : null,
      props: z
    };
  }
  return bn.Fragment = d, bn.jsx = m, bn.jsxs = m, bn;
}
var cd;
function Fm() {
  return cd || (cd = 1, Ic.exports = Wm()), Ic.exports;
}
var i = Fm(), es = { exports: {} }, ne = {};
/**
 * @license React
 * react.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var sd;
function Pm() {
  if (sd) return ne;
  sd = 1;
  var r = Symbol.for("react.transitional.element"), d = Symbol.for("react.portal"), m = Symbol.for("react.fragment"), f = Symbol.for("react.strict_mode"), E = Symbol.for("react.profiler"), z = Symbol.for("react.consumer"), j = Symbol.for("react.context"), U = Symbol.for("react.forward_ref"), T = Symbol.for("react.suspense"), p = Symbol.for("react.memo"), A = Symbol.for("react.lazy"), _ = Symbol.iterator;
  function q(o) {
    return o === null || typeof o != "object" ? null : (o = _ && o[_] || o["@@iterator"], typeof o == "function" ? o : null);
  }
  var le = {
    isMounted: function() {
      return !1;
    },
    enqueueForceUpdate: function() {
    },
    enqueueReplaceState: function() {
    },
    enqueueSetState: function() {
    }
  }, B = Object.assign, I = {};
  function L(o, N, C) {
    this.props = o, this.context = N, this.refs = I, this.updater = C || le;
  }
  L.prototype.isReactComponent = {}, L.prototype.setState = function(o, N) {
    if (typeof o != "object" && typeof o != "function" && o != null)
      throw Error(
        "takes an object of state variables to update or a function which returns an object of state variables."
      );
    this.updater.enqueueSetState(this, o, N, "setState");
  }, L.prototype.forceUpdate = function(o) {
    this.updater.enqueueForceUpdate(this, o, "forceUpdate");
  };
  function Q() {
  }
  Q.prototype = L.prototype;
  function P(o, N, C) {
    this.props = o, this.context = N, this.refs = I, this.updater = C || le;
  }
  var V = P.prototype = new Q();
  V.constructor = P, B(V, L.prototype), V.isPureReactComponent = !0;
  var de = Array.isArray, ae = { H: null, A: null, T: null, S: null, V: null }, Oe = Object.prototype.hasOwnProperty;
  function te(o, N, C, H, Z, k) {
    return C = k.ref, {
      $$typeof: r,
      type: o,
      key: N,
      ref: C !== void 0 ? C : null,
      props: k
    };
  }
  function Se(o, N) {
    return te(
      o.type,
      N,
      void 0,
      void 0,
      void 0,
      o.props
    );
  }
  function st(o) {
    return typeof o == "object" && o !== null && o.$$typeof === r;
  }
  function Vt(o) {
    var N = { "=": "=0", ":": "=2" };
    return "$" + o.replace(/[=:]/g, function(C) {
      return N[C];
    });
  }
  var Je = /\/+/g;
  function Re(o, N) {
    return typeof o == "object" && o !== null && o.key != null ? Vt("" + o.key) : N.toString(36);
  }
  function zt() {
  }
  function Dt(o) {
    switch (o.status) {
      case "fulfilled":
        return o.value;
      case "rejected":
        throw o.reason;
      default:
        switch (typeof o.status == "string" ? o.then(zt, zt) : (o.status = "pending", o.then(
          function(N) {
            o.status === "pending" && (o.status = "fulfilled", o.value = N);
          },
          function(N) {
            o.status === "pending" && (o.status = "rejected", o.reason = N);
          }
        )), o.status) {
          case "fulfilled":
            return o.value;
          case "rejected":
            throw o.reason;
        }
    }
    throw o;
  }
  function we(o, N, C, H, Z) {
    var k = typeof o;
    (k === "undefined" || k === "boolean") && (o = null);
    var K = !1;
    if (o === null) K = !0;
    else
      switch (k) {
        case "bigint":
        case "string":
        case "number":
          K = !0;
          break;
        case "object":
          switch (o.$$typeof) {
            case r:
            case d:
              K = !0;
              break;
            case A:
              return K = o._init, we(
                K(o._payload),
                N,
                C,
                H,
                Z
              );
          }
      }
    if (K)
      return Z = Z(o), K = H === "" ? "." + Re(o, 0) : H, de(Z) ? (C = "", K != null && (C = K.replace(Je, "$&/") + "/"), we(Z, N, C, "", function(xt) {
        return xt;
      })) : Z != null && (st(Z) && (Z = Se(
        Z,
        C + (Z.key == null || o && o.key === Z.key ? "" : ("" + Z.key).replace(
          Je,
          "$&/"
        ) + "/") + K
      )), N.push(Z)), 1;
    K = 0;
    var Ye = H === "" ? "." : H + ":";
    if (de(o))
      for (var ve = 0; ve < o.length; ve++)
        H = o[ve], k = Ye + Re(H, ve), K += we(
          H,
          N,
          C,
          k,
          Z
        );
    else if (ve = q(o), typeof ve == "function")
      for (o = ve.call(o), ve = 0; !(H = o.next()).done; )
        H = H.value, k = Ye + Re(H, ve++), K += we(
          H,
          N,
          C,
          k,
          Z
        );
    else if (k === "object") {
      if (typeof o.then == "function")
        return we(
          Dt(o),
          N,
          C,
          H,
          Z
        );
      throw N = String(o), Error(
        "Objects are not valid as a React child (found: " + (N === "[object Object]" ? "object with keys {" + Object.keys(o).join(", ") + "}" : N) + "). If you meant to render a collection of children, use an array instead."
      );
    }
    return K;
  }
  function D(o, N, C) {
    if (o == null) return o;
    var H = [], Z = 0;
    return we(o, H, "", "", function(k) {
      return N.call(C, k, Z++);
    }), H;
  }
  function Y(o) {
    if (o._status === -1) {
      var N = o._result;
      N = N(), N.then(
        function(C) {
          (o._status === 0 || o._status === -1) && (o._status = 1, o._result = C);
        },
        function(C) {
          (o._status === 0 || o._status === -1) && (o._status = 2, o._result = C);
        }
      ), o._status === -1 && (o._status = 0, o._result = N);
    }
    if (o._status === 1) return o._result.default;
    throw o._result;
  }
  var $ = typeof reportError == "function" ? reportError : function(o) {
    if (typeof window == "object" && typeof window.ErrorEvent == "function") {
      var N = new window.ErrorEvent("error", {
        bubbles: !0,
        cancelable: !0,
        message: typeof o == "object" && o !== null && typeof o.message == "string" ? String(o.message) : String(o),
        error: o
      });
      if (!window.dispatchEvent(N)) return;
    } else if (typeof process == "object" && typeof process.emit == "function") {
      process.emit("uncaughtException", o);
      return;
    }
    console.error(o);
  };
  function w() {
  }
  return ne.Children = {
    map: D,
    forEach: function(o, N, C) {
      D(
        o,
        function() {
          N.apply(this, arguments);
        },
        C
      );
    },
    count: function(o) {
      var N = 0;
      return D(o, function() {
        N++;
      }), N;
    },
    toArray: function(o) {
      return D(o, function(N) {
        return N;
      }) || [];
    },
    only: function(o) {
      if (!st(o))
        throw Error(
          "React.Children.only expected to receive a single React element child."
        );
      return o;
    }
  }, ne.Component = L, ne.Fragment = m, ne.Profiler = E, ne.PureComponent = P, ne.StrictMode = f, ne.Suspense = T, ne.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ae, ne.__COMPILER_RUNTIME = {
    __proto__: null,
    c: function(o) {
      return ae.H.useMemoCache(o);
    }
  }, ne.cache = function(o) {
    return function() {
      return o.apply(null, arguments);
    };
  }, ne.cloneElement = function(o, N, C) {
    if (o == null)
      throw Error(
        "The argument must be a React element, but you passed " + o + "."
      );
    var H = B({}, o.props), Z = o.key, k = void 0;
    if (N != null)
      for (K in N.ref !== void 0 && (k = void 0), N.key !== void 0 && (Z = "" + N.key), N)
        !Oe.call(N, K) || K === "key" || K === "__self" || K === "__source" || K === "ref" && N.ref === void 0 || (H[K] = N[K]);
    var K = arguments.length - 2;
    if (K === 1) H.children = C;
    else if (1 < K) {
      for (var Ye = Array(K), ve = 0; ve < K; ve++)
        Ye[ve] = arguments[ve + 2];
      H.children = Ye;
    }
    return te(o.type, Z, void 0, void 0, k, H);
  }, ne.createContext = function(o) {
    return o = {
      $$typeof: j,
      _currentValue: o,
      _currentValue2: o,
      _threadCount: 0,
      Provider: null,
      Consumer: null
    }, o.Provider = o, o.Consumer = {
      $$typeof: z,
      _context: o
    }, o;
  }, ne.createElement = function(o, N, C) {
    var H, Z = {}, k = null;
    if (N != null)
      for (H in N.key !== void 0 && (k = "" + N.key), N)
        Oe.call(N, H) && H !== "key" && H !== "__self" && H !== "__source" && (Z[H] = N[H]);
    var K = arguments.length - 2;
    if (K === 1) Z.children = C;
    else if (1 < K) {
      for (var Ye = Array(K), ve = 0; ve < K; ve++)
        Ye[ve] = arguments[ve + 2];
      Z.children = Ye;
    }
    if (o && o.defaultProps)
      for (H in K = o.defaultProps, K)
        Z[H] === void 0 && (Z[H] = K[H]);
    return te(o, k, void 0, void 0, null, Z);
  }, ne.createRef = function() {
    return { current: null };
  }, ne.forwardRef = function(o) {
    return { $$typeof: U, render: o };
  }, ne.isValidElement = st, ne.lazy = function(o) {
    return {
      $$typeof: A,
      _payload: { _status: -1, _result: o },
      _init: Y
    };
  }, ne.memo = function(o, N) {
    return {
      $$typeof: p,
      type: o,
      compare: N === void 0 ? null : N
    };
  }, ne.startTransition = function(o) {
    var N = ae.T, C = {};
    ae.T = C;
    try {
      var H = o(), Z = ae.S;
      Z !== null && Z(C, H), typeof H == "object" && H !== null && typeof H.then == "function" && H.then(w, $);
    } catch (k) {
      $(k);
    } finally {
      ae.T = N;
    }
  }, ne.unstable_useCacheRefresh = function() {
    return ae.H.useCacheRefresh();
  }, ne.use = function(o) {
    return ae.H.use(o);
  }, ne.useActionState = function(o, N, C) {
    return ae.H.useActionState(o, N, C);
  }, ne.useCallback = function(o, N) {
    return ae.H.useCallback(o, N);
  }, ne.useContext = function(o) {
    return ae.H.useContext(o);
  }, ne.useDebugValue = function() {
  }, ne.useDeferredValue = function(o, N) {
    return ae.H.useDeferredValue(o, N);
  }, ne.useEffect = function(o, N, C) {
    var H = ae.H;
    if (typeof C == "function")
      throw Error(
        "useEffect CRUD overload is not enabled in this build of React."
      );
    return H.useEffect(o, N);
  }, ne.useId = function() {
    return ae.H.useId();
  }, ne.useImperativeHandle = function(o, N, C) {
    return ae.H.useImperativeHandle(o, N, C);
  }, ne.useInsertionEffect = function(o, N) {
    return ae.H.useInsertionEffect(o, N);
  }, ne.useLayoutEffect = function(o, N) {
    return ae.H.useLayoutEffect(o, N);
  }, ne.useMemo = function(o, N) {
    return ae.H.useMemo(o, N);
  }, ne.useOptimistic = function(o, N) {
    return ae.H.useOptimistic(o, N);
  }, ne.useReducer = function(o, N, C) {
    return ae.H.useReducer(o, N, C);
  }, ne.useRef = function(o) {
    return ae.H.useRef(o);
  }, ne.useState = function(o) {
    return ae.H.useState(o);
  }, ne.useSyncExternalStore = function(o, N, C) {
    return ae.H.useSyncExternalStore(
      o,
      N,
      C
    );
  }, ne.useTransition = function() {
    return ae.H.useTransition();
  }, ne.version = "19.1.1", ne;
}
var rd;
function os() {
  return rd || (rd = 1, es.exports = Pm()), es.exports;
}
var G = os(), ts = { exports: {} }, pn = {}, ls = { exports: {} }, as = {};
/**
 * @license React
 * scheduler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var fd;
function Im() {
  return fd || (fd = 1, (function(r) {
    function d(D, Y) {
      var $ = D.length;
      D.push(Y);
      e: for (; 0 < $; ) {
        var w = $ - 1 >>> 1, o = D[w];
        if (0 < E(o, Y))
          D[w] = Y, D[$] = o, $ = w;
        else break e;
      }
    }
    function m(D) {
      return D.length === 0 ? null : D[0];
    }
    function f(D) {
      if (D.length === 0) return null;
      var Y = D[0], $ = D.pop();
      if ($ !== Y) {
        D[0] = $;
        e: for (var w = 0, o = D.length, N = o >>> 1; w < N; ) {
          var C = 2 * (w + 1) - 1, H = D[C], Z = C + 1, k = D[Z];
          if (0 > E(H, $))
            Z < o && 0 > E(k, H) ? (D[w] = k, D[Z] = $, w = Z) : (D[w] = H, D[C] = $, w = C);
          else if (Z < o && 0 > E(k, $))
            D[w] = k, D[Z] = $, w = Z;
          else break e;
        }
      }
      return Y;
    }
    function E(D, Y) {
      var $ = D.sortIndex - Y.sortIndex;
      return $ !== 0 ? $ : D.id - Y.id;
    }
    if (r.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
      var z = performance;
      r.unstable_now = function() {
        return z.now();
      };
    } else {
      var j = Date, U = j.now();
      r.unstable_now = function() {
        return j.now() - U;
      };
    }
    var T = [], p = [], A = 1, _ = null, q = 3, le = !1, B = !1, I = !1, L = !1, Q = typeof setTimeout == "function" ? setTimeout : null, P = typeof clearTimeout == "function" ? clearTimeout : null, V = typeof setImmediate < "u" ? setImmediate : null;
    function de(D) {
      for (var Y = m(p); Y !== null; ) {
        if (Y.callback === null) f(p);
        else if (Y.startTime <= D)
          f(p), Y.sortIndex = Y.expirationTime, d(T, Y);
        else break;
        Y = m(p);
      }
    }
    function ae(D) {
      if (I = !1, de(D), !B)
        if (m(T) !== null)
          B = !0, Oe || (Oe = !0, Re());
        else {
          var Y = m(p);
          Y !== null && we(ae, Y.startTime - D);
        }
    }
    var Oe = !1, te = -1, Se = 5, st = -1;
    function Vt() {
      return L ? !0 : !(r.unstable_now() - st < Se);
    }
    function Je() {
      if (L = !1, Oe) {
        var D = r.unstable_now();
        st = D;
        var Y = !0;
        try {
          e: {
            B = !1, I && (I = !1, P(te), te = -1), le = !0;
            var $ = q;
            try {
              t: {
                for (de(D), _ = m(T); _ !== null && !(_.expirationTime > D && Vt()); ) {
                  var w = _.callback;
                  if (typeof w == "function") {
                    _.callback = null, q = _.priorityLevel;
                    var o = w(
                      _.expirationTime <= D
                    );
                    if (D = r.unstable_now(), typeof o == "function") {
                      _.callback = o, de(D), Y = !0;
                      break t;
                    }
                    _ === m(T) && f(T), de(D);
                  } else f(T);
                  _ = m(T);
                }
                if (_ !== null) Y = !0;
                else {
                  var N = m(p);
                  N !== null && we(
                    ae,
                    N.startTime - D
                  ), Y = !1;
                }
              }
              break e;
            } finally {
              _ = null, q = $, le = !1;
            }
            Y = void 0;
          }
        } finally {
          Y ? Re() : Oe = !1;
        }
      }
    }
    var Re;
    if (typeof V == "function")
      Re = function() {
        V(Je);
      };
    else if (typeof MessageChannel < "u") {
      var zt = new MessageChannel(), Dt = zt.port2;
      zt.port1.onmessage = Je, Re = function() {
        Dt.postMessage(null);
      };
    } else
      Re = function() {
        Q(Je, 0);
      };
    function we(D, Y) {
      te = Q(function() {
        D(r.unstable_now());
      }, Y);
    }
    r.unstable_IdlePriority = 5, r.unstable_ImmediatePriority = 1, r.unstable_LowPriority = 4, r.unstable_NormalPriority = 3, r.unstable_Profiling = null, r.unstable_UserBlockingPriority = 2, r.unstable_cancelCallback = function(D) {
      D.callback = null;
    }, r.unstable_forceFrameRate = function(D) {
      0 > D || 125 < D ? console.error(
        "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"
      ) : Se = 0 < D ? Math.floor(1e3 / D) : 5;
    }, r.unstable_getCurrentPriorityLevel = function() {
      return q;
    }, r.unstable_next = function(D) {
      switch (q) {
        case 1:
        case 2:
        case 3:
          var Y = 3;
          break;
        default:
          Y = q;
      }
      var $ = q;
      q = Y;
      try {
        return D();
      } finally {
        q = $;
      }
    }, r.unstable_requestPaint = function() {
      L = !0;
    }, r.unstable_runWithPriority = function(D, Y) {
      switch (D) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          D = 3;
      }
      var $ = q;
      q = D;
      try {
        return Y();
      } finally {
        q = $;
      }
    }, r.unstable_scheduleCallback = function(D, Y, $) {
      var w = r.unstable_now();
      switch (typeof $ == "object" && $ !== null ? ($ = $.delay, $ = typeof $ == "number" && 0 < $ ? w + $ : w) : $ = w, D) {
        case 1:
          var o = -1;
          break;
        case 2:
          o = 250;
          break;
        case 5:
          o = 1073741823;
          break;
        case 4:
          o = 1e4;
          break;
        default:
          o = 5e3;
      }
      return o = $ + o, D = {
        id: A++,
        callback: Y,
        priorityLevel: D,
        startTime: $,
        expirationTime: o,
        sortIndex: -1
      }, $ > w ? (D.sortIndex = $, d(p, D), m(T) === null && D === m(p) && (I ? (P(te), te = -1) : I = !0, we(ae, $ - w))) : (D.sortIndex = o, d(T, D), B || le || (B = !0, Oe || (Oe = !0, Re()))), D;
    }, r.unstable_shouldYield = Vt, r.unstable_wrapCallback = function(D) {
      var Y = q;
      return function() {
        var $ = q;
        q = Y;
        try {
          return D.apply(this, arguments);
        } finally {
          q = $;
        }
      };
    };
  })(as)), as;
}
var od;
function ev() {
  return od || (od = 1, ls.exports = Im()), ls.exports;
}
var ns = { exports: {} }, Ve = {};
/**
 * @license React
 * react-dom.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var dd;
function tv() {
  if (dd) return Ve;
  dd = 1;
  var r = os();
  function d(T) {
    var p = "https://react.dev/errors/" + T;
    if (1 < arguments.length) {
      p += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var A = 2; A < arguments.length; A++)
        p += "&args[]=" + encodeURIComponent(arguments[A]);
    }
    return "Minified React error #" + T + "; visit " + p + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  function m() {
  }
  var f = {
    d: {
      f: m,
      r: function() {
        throw Error(d(522));
      },
      D: m,
      C: m,
      L: m,
      m,
      X: m,
      S: m,
      M: m
    },
    p: 0,
    findDOMNode: null
  }, E = Symbol.for("react.portal");
  function z(T, p, A) {
    var _ = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: E,
      key: _ == null ? null : "" + _,
      children: T,
      containerInfo: p,
      implementation: A
    };
  }
  var j = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function U(T, p) {
    if (T === "font") return "";
    if (typeof p == "string")
      return p === "use-credentials" ? p : "";
  }
  return Ve.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = f, Ve.createPortal = function(T, p) {
    var A = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
    if (!p || p.nodeType !== 1 && p.nodeType !== 9 && p.nodeType !== 11)
      throw Error(d(299));
    return z(T, p, null, A);
  }, Ve.flushSync = function(T) {
    var p = j.T, A = f.p;
    try {
      if (j.T = null, f.p = 2, T) return T();
    } finally {
      j.T = p, f.p = A, f.d.f();
    }
  }, Ve.preconnect = function(T, p) {
    typeof T == "string" && (p ? (p = p.crossOrigin, p = typeof p == "string" ? p === "use-credentials" ? p : "" : void 0) : p = null, f.d.C(T, p));
  }, Ve.prefetchDNS = function(T) {
    typeof T == "string" && f.d.D(T);
  }, Ve.preinit = function(T, p) {
    if (typeof T == "string" && p && typeof p.as == "string") {
      var A = p.as, _ = U(A, p.crossOrigin), q = typeof p.integrity == "string" ? p.integrity : void 0, le = typeof p.fetchPriority == "string" ? p.fetchPriority : void 0;
      A === "style" ? f.d.S(
        T,
        typeof p.precedence == "string" ? p.precedence : void 0,
        {
          crossOrigin: _,
          integrity: q,
          fetchPriority: le
        }
      ) : A === "script" && f.d.X(T, {
        crossOrigin: _,
        integrity: q,
        fetchPriority: le,
        nonce: typeof p.nonce == "string" ? p.nonce : void 0
      });
    }
  }, Ve.preinitModule = function(T, p) {
    if (typeof T == "string")
      if (typeof p == "object" && p !== null) {
        if (p.as == null || p.as === "script") {
          var A = U(
            p.as,
            p.crossOrigin
          );
          f.d.M(T, {
            crossOrigin: A,
            integrity: typeof p.integrity == "string" ? p.integrity : void 0,
            nonce: typeof p.nonce == "string" ? p.nonce : void 0
          });
        }
      } else p == null && f.d.M(T);
  }, Ve.preload = function(T, p) {
    if (typeof T == "string" && typeof p == "object" && p !== null && typeof p.as == "string") {
      var A = p.as, _ = U(A, p.crossOrigin);
      f.d.L(T, A, {
        crossOrigin: _,
        integrity: typeof p.integrity == "string" ? p.integrity : void 0,
        nonce: typeof p.nonce == "string" ? p.nonce : void 0,
        type: typeof p.type == "string" ? p.type : void 0,
        fetchPriority: typeof p.fetchPriority == "string" ? p.fetchPriority : void 0,
        referrerPolicy: typeof p.referrerPolicy == "string" ? p.referrerPolicy : void 0,
        imageSrcSet: typeof p.imageSrcSet == "string" ? p.imageSrcSet : void 0,
        imageSizes: typeof p.imageSizes == "string" ? p.imageSizes : void 0,
        media: typeof p.media == "string" ? p.media : void 0
      });
    }
  }, Ve.preloadModule = function(T, p) {
    if (typeof T == "string")
      if (p) {
        var A = U(p.as, p.crossOrigin);
        f.d.m(T, {
          as: typeof p.as == "string" && p.as !== "script" ? p.as : void 0,
          crossOrigin: A,
          integrity: typeof p.integrity == "string" ? p.integrity : void 0
        });
      } else f.d.m(T);
  }, Ve.requestFormReset = function(T) {
    f.d.r(T);
  }, Ve.unstable_batchedUpdates = function(T, p) {
    return T(p);
  }, Ve.useFormState = function(T, p, A) {
    return j.H.useFormState(T, p, A);
  }, Ve.useFormStatus = function() {
    return j.H.useHostTransitionStatus();
  }, Ve.version = "19.1.1", Ve;
}
var hd;
function lv() {
  if (hd) return ns.exports;
  hd = 1;
  function r() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(r);
      } catch (d) {
        console.error(d);
      }
  }
  return r(), ns.exports = tv(), ns.exports;
}
/**
 * @license React
 * react-dom-client.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var md;
function av() {
  if (md) return pn;
  md = 1;
  var r = ev(), d = os(), m = lv();
  function f(e) {
    var t = "https://react.dev/errors/" + e;
    if (1 < arguments.length) {
      t += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var l = 2; l < arguments.length; l++)
        t += "&args[]=" + encodeURIComponent(arguments[l]);
    }
    return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  function E(e) {
    return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11);
  }
  function z(e) {
    var t = e, l = e;
    if (e.alternate) for (; t.return; ) t = t.return;
    else {
      e = t;
      do
        t = e, (t.flags & 4098) !== 0 && (l = t.return), e = t.return;
      while (e);
    }
    return t.tag === 3 ? l : null;
  }
  function j(e) {
    if (e.tag === 13) {
      var t = e.memoizedState;
      if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
    }
    return null;
  }
  function U(e) {
    if (z(e) !== e)
      throw Error(f(188));
  }
  function T(e) {
    var t = e.alternate;
    if (!t) {
      if (t = z(e), t === null) throw Error(f(188));
      return t !== e ? null : e;
    }
    for (var l = e, a = t; ; ) {
      var n = l.return;
      if (n === null) break;
      var u = n.alternate;
      if (u === null) {
        if (a = n.return, a !== null) {
          l = a;
          continue;
        }
        break;
      }
      if (n.child === u.child) {
        for (u = n.child; u; ) {
          if (u === l) return U(n), e;
          if (u === a) return U(n), t;
          u = u.sibling;
        }
        throw Error(f(188));
      }
      if (l.return !== a.return) l = n, a = u;
      else {
        for (var c = !1, s = n.child; s; ) {
          if (s === l) {
            c = !0, l = n, a = u;
            break;
          }
          if (s === a) {
            c = !0, a = n, l = u;
            break;
          }
          s = s.sibling;
        }
        if (!c) {
          for (s = u.child; s; ) {
            if (s === l) {
              c = !0, l = u, a = n;
              break;
            }
            if (s === a) {
              c = !0, a = u, l = n;
              break;
            }
            s = s.sibling;
          }
          if (!c) throw Error(f(189));
        }
      }
      if (l.alternate !== a) throw Error(f(190));
    }
    if (l.tag !== 3) throw Error(f(188));
    return l.stateNode.current === l ? e : t;
  }
  function p(e) {
    var t = e.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return e;
    for (e = e.child; e !== null; ) {
      if (t = p(e), t !== null) return t;
      e = e.sibling;
    }
    return null;
  }
  var A = Object.assign, _ = Symbol.for("react.element"), q = Symbol.for("react.transitional.element"), le = Symbol.for("react.portal"), B = Symbol.for("react.fragment"), I = Symbol.for("react.strict_mode"), L = Symbol.for("react.profiler"), Q = Symbol.for("react.provider"), P = Symbol.for("react.consumer"), V = Symbol.for("react.context"), de = Symbol.for("react.forward_ref"), ae = Symbol.for("react.suspense"), Oe = Symbol.for("react.suspense_list"), te = Symbol.for("react.memo"), Se = Symbol.for("react.lazy"), st = Symbol.for("react.activity"), Vt = Symbol.for("react.memo_cache_sentinel"), Je = Symbol.iterator;
  function Re(e) {
    return e === null || typeof e != "object" ? null : (e = Je && e[Je] || e["@@iterator"], typeof e == "function" ? e : null);
  }
  var zt = Symbol.for("react.client.reference");
  function Dt(e) {
    if (e == null) return null;
    if (typeof e == "function")
      return e.$$typeof === zt ? null : e.displayName || e.name || null;
    if (typeof e == "string") return e;
    switch (e) {
      case B:
        return "Fragment";
      case L:
        return "Profiler";
      case I:
        return "StrictMode";
      case ae:
        return "Suspense";
      case Oe:
        return "SuspenseList";
      case st:
        return "Activity";
    }
    if (typeof e == "object")
      switch (e.$$typeof) {
        case le:
          return "Portal";
        case V:
          return (e.displayName || "Context") + ".Provider";
        case P:
          return (e._context.displayName || "Context") + ".Consumer";
        case de:
          var t = e.render;
          return e = e.displayName, e || (e = t.displayName || t.name || "", e = e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef"), e;
        case te:
          return t = e.displayName || null, t !== null ? t : Dt(e.type) || "Memo";
        case Se:
          t = e._payload, e = e._init;
          try {
            return Dt(e(t));
          } catch {
          }
      }
    return null;
  }
  var we = Array.isArray, D = d.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Y = m.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, $ = {
    pending: !1,
    data: null,
    method: null,
    action: null
  }, w = [], o = -1;
  function N(e) {
    return { current: e };
  }
  function C(e) {
    0 > o || (e.current = w[o], w[o] = null, o--);
  }
  function H(e, t) {
    o++, w[o] = e.current, e.current = t;
  }
  var Z = N(null), k = N(null), K = N(null), Ye = N(null);
  function ve(e, t) {
    switch (H(K, t), H(k, e), H(Z, null), t.nodeType) {
      case 9:
      case 11:
        e = (e = t.documentElement) && (e = e.namespaceURI) ? wo(e) : 0;
        break;
      default:
        if (e = t.tagName, t = t.namespaceURI)
          t = wo(t), e = Co(t, e);
        else
          switch (e) {
            case "svg":
              e = 1;
              break;
            case "math":
              e = 2;
              break;
            default:
              e = 0;
          }
    }
    C(Z), H(Z, e);
  }
  function xt() {
    C(Z), C(k), C(K);
  }
  function Bu(e) {
    e.memoizedState !== null && H(Ye, e);
    var t = Z.current, l = Co(t, e.type);
    t !== l && (H(k, e), H(Z, l));
  }
  function xn(e) {
    k.current === e && (C(Z), C(k)), Ye.current === e && (C(Ye), hn._currentValue = $);
  }
  var Yu = Object.prototype.hasOwnProperty, Gu = r.unstable_scheduleCallback, Xu = r.unstable_cancelCallback, zd = r.unstable_shouldYield, Dd = r.unstable_requestPaint, St = r.unstable_now, Od = r.unstable_getCurrentPriorityLevel, ds = r.unstable_ImmediatePriority, hs = r.unstable_UserBlockingPriority, Sn = r.unstable_NormalPriority, Md = r.unstable_LowPriority, ms = r.unstable_IdlePriority, Ud = r.log, Rd = r.unstable_setDisableYieldValue, ja = null, Ie = null;
  function Kt(e) {
    if (typeof Ud == "function" && Rd(e), Ie && typeof Ie.setStrictMode == "function")
      try {
        Ie.setStrictMode(ja, e);
      } catch {
      }
  }
  var et = Math.clz32 ? Math.clz32 : qd, wd = Math.log, Cd = Math.LN2;
  function qd(e) {
    return e >>>= 0, e === 0 ? 32 : 31 - (wd(e) / Cd | 0) | 0;
  }
  var _n = 256, En = 4194304;
  function yl(e) {
    var t = e & 42;
    if (t !== 0) return t;
    switch (e & -e) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return e & 4194048;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return e & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return e;
    }
  }
  function Tn(e, t, l) {
    var a = e.pendingLanes;
    if (a === 0) return 0;
    var n = 0, u = e.suspendedLanes, c = e.pingedLanes;
    e = e.warmLanes;
    var s = a & 134217727;
    return s !== 0 ? (a = s & ~u, a !== 0 ? n = yl(a) : (c &= s, c !== 0 ? n = yl(c) : l || (l = s & ~e, l !== 0 && (n = yl(l))))) : (s = a & ~u, s !== 0 ? n = yl(s) : c !== 0 ? n = yl(c) : l || (l = a & ~e, l !== 0 && (n = yl(l)))), n === 0 ? 0 : t !== 0 && t !== n && (t & u) === 0 && (u = n & -n, l = t & -t, u >= l || u === 32 && (l & 4194048) !== 0) ? t : n;
  }
  function xa(e, t) {
    return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
  }
  function Hd(e, t) {
    switch (e) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return t + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function vs() {
    var e = _n;
    return _n <<= 1, (_n & 4194048) === 0 && (_n = 256), e;
  }
  function ys() {
    var e = En;
    return En <<= 1, (En & 62914560) === 0 && (En = 4194304), e;
  }
  function Qu(e) {
    for (var t = [], l = 0; 31 > l; l++) t.push(e);
    return t;
  }
  function Sa(e, t) {
    e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
  }
  function Bd(e, t, l, a, n, u) {
    var c = e.pendingLanes;
    e.pendingLanes = l, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= l, e.entangledLanes &= l, e.errorRecoveryDisabledLanes &= l, e.shellSuspendCounter = 0;
    var s = e.entanglements, h = e.expirationTimes, b = e.hiddenUpdates;
    for (l = c & ~l; 0 < l; ) {
      var O = 31 - et(l), R = 1 << O;
      s[O] = 0, h[O] = -1;
      var x = b[O];
      if (x !== null)
        for (b[O] = null, O = 0; O < x.length; O++) {
          var S = x[O];
          S !== null && (S.lane &= -536870913);
        }
      l &= ~R;
    }
    a !== 0 && gs(e, a, 0), u !== 0 && n === 0 && e.tag !== 0 && (e.suspendedLanes |= u & ~(c & ~t));
  }
  function gs(e, t, l) {
    e.pendingLanes |= t, e.suspendedLanes &= ~t;
    var a = 31 - et(t);
    e.entangledLanes |= t, e.entanglements[a] = e.entanglements[a] | 1073741824 | l & 4194090;
  }
  function bs(e, t) {
    var l = e.entangledLanes |= t;
    for (e = e.entanglements; l; ) {
      var a = 31 - et(l), n = 1 << a;
      n & t | e[a] & t && (e[a] |= t), l &= ~n;
    }
  }
  function Zu(e) {
    switch (e) {
      case 2:
        e = 1;
        break;
      case 8:
        e = 4;
        break;
      case 32:
        e = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        e = 128;
        break;
      case 268435456:
        e = 134217728;
        break;
      default:
        e = 0;
    }
    return e;
  }
  function Lu(e) {
    return e &= -e, 2 < e ? 8 < e ? (e & 134217727) !== 0 ? 32 : 268435456 : 8 : 2;
  }
  function ps() {
    var e = Y.p;
    return e !== 0 ? e : (e = window.event, e === void 0 ? 32 : ed(e.type));
  }
  function Yd(e, t) {
    var l = Y.p;
    try {
      return Y.p = e, t();
    } finally {
      Y.p = l;
    }
  }
  var Jt = Math.random().toString(36).slice(2), Ze = "__reactFiber$" + Jt, ke = "__reactProps$" + Jt, wl = "__reactContainer$" + Jt, Vu = "__reactEvents$" + Jt, Gd = "__reactListeners$" + Jt, Xd = "__reactHandles$" + Jt, js = "__reactResources$" + Jt, _a = "__reactMarker$" + Jt;
  function Ku(e) {
    delete e[Ze], delete e[ke], delete e[Vu], delete e[Gd], delete e[Xd];
  }
  function Cl(e) {
    var t = e[Ze];
    if (t) return t;
    for (var l = e.parentNode; l; ) {
      if (t = l[wl] || l[Ze]) {
        if (l = t.alternate, t.child !== null || l !== null && l.child !== null)
          for (e = Yo(e); e !== null; ) {
            if (l = e[Ze]) return l;
            e = Yo(e);
          }
        return t;
      }
      e = l, l = e.parentNode;
    }
    return null;
  }
  function ql(e) {
    if (e = e[Ze] || e[wl]) {
      var t = e.tag;
      if (t === 5 || t === 6 || t === 13 || t === 26 || t === 27 || t === 3)
        return e;
    }
    return null;
  }
  function Ea(e) {
    var t = e.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
    throw Error(f(33));
  }
  function Hl(e) {
    var t = e[js];
    return t || (t = e[js] = { hoistableStyles: /* @__PURE__ */ new Map(), hoistableScripts: /* @__PURE__ */ new Map() }), t;
  }
  function Ce(e) {
    e[_a] = !0;
  }
  var xs = /* @__PURE__ */ new Set(), Ss = {};
  function gl(e, t) {
    Bl(e, t), Bl(e + "Capture", t);
  }
  function Bl(e, t) {
    for (Ss[e] = t, e = 0; e < t.length; e++)
      xs.add(t[e]);
  }
  var Qd = RegExp(
    "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"
  ), _s = {}, Es = {};
  function Zd(e) {
    return Yu.call(Es, e) ? !0 : Yu.call(_s, e) ? !1 : Qd.test(e) ? Es[e] = !0 : (_s[e] = !0, !1);
  }
  function Nn(e, t, l) {
    if (Zd(t))
      if (l === null) e.removeAttribute(t);
      else {
        switch (typeof l) {
          case "undefined":
          case "function":
          case "symbol":
            e.removeAttribute(t);
            return;
          case "boolean":
            var a = t.toLowerCase().slice(0, 5);
            if (a !== "data-" && a !== "aria-") {
              e.removeAttribute(t);
              return;
            }
        }
        e.setAttribute(t, "" + l);
      }
  }
  function An(e, t, l) {
    if (l === null) e.removeAttribute(t);
    else {
      switch (typeof l) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          e.removeAttribute(t);
          return;
      }
      e.setAttribute(t, "" + l);
    }
  }
  function Ot(e, t, l, a) {
    if (a === null) e.removeAttribute(l);
    else {
      switch (typeof a) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          e.removeAttribute(l);
          return;
      }
      e.setAttributeNS(t, l, "" + a);
    }
  }
  var Ju, Ts;
  function Yl(e) {
    if (Ju === void 0)
      try {
        throw Error();
      } catch (l) {
        var t = l.stack.trim().match(/\n( *(at )?)/);
        Ju = t && t[1] || "", Ts = -1 < l.stack.indexOf(`
    at`) ? " (<anonymous>)" : -1 < l.stack.indexOf("@") ? "@unknown:0:0" : "";
      }
    return `
` + Ju + e + Ts;
  }
  var ku = !1;
  function $u(e, t) {
    if (!e || ku) return "";
    ku = !0;
    var l = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var a = {
        DetermineComponentFrameRoot: function() {
          try {
            if (t) {
              var R = function() {
                throw Error();
              };
              if (Object.defineProperty(R.prototype, "props", {
                set: function() {
                  throw Error();
                }
              }), typeof Reflect == "object" && Reflect.construct) {
                try {
                  Reflect.construct(R, []);
                } catch (S) {
                  var x = S;
                }
                Reflect.construct(e, [], R);
              } else {
                try {
                  R.call();
                } catch (S) {
                  x = S;
                }
                e.call(R.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (S) {
                x = S;
              }
              (R = e()) && typeof R.catch == "function" && R.catch(function() {
              });
            }
          } catch (S) {
            if (S && x && typeof S.stack == "string")
              return [S.stack, x.stack];
          }
          return [null, null];
        }
      };
      a.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
      var n = Object.getOwnPropertyDescriptor(
        a.DetermineComponentFrameRoot,
        "name"
      );
      n && n.configurable && Object.defineProperty(
        a.DetermineComponentFrameRoot,
        "name",
        { value: "DetermineComponentFrameRoot" }
      );
      var u = a.DetermineComponentFrameRoot(), c = u[0], s = u[1];
      if (c && s) {
        var h = c.split(`
`), b = s.split(`
`);
        for (n = a = 0; a < h.length && !h[a].includes("DetermineComponentFrameRoot"); )
          a++;
        for (; n < b.length && !b[n].includes(
          "DetermineComponentFrameRoot"
        ); )
          n++;
        if (a === h.length || n === b.length)
          for (a = h.length - 1, n = b.length - 1; 1 <= a && 0 <= n && h[a] !== b[n]; )
            n--;
        for (; 1 <= a && 0 <= n; a--, n--)
          if (h[a] !== b[n]) {
            if (a !== 1 || n !== 1)
              do
                if (a--, n--, 0 > n || h[a] !== b[n]) {
                  var O = `
` + h[a].replace(" at new ", " at ");
                  return e.displayName && O.includes("<anonymous>") && (O = O.replace("<anonymous>", e.displayName)), O;
                }
              while (1 <= a && 0 <= n);
            break;
          }
      }
    } finally {
      ku = !1, Error.prepareStackTrace = l;
    }
    return (l = e ? e.displayName || e.name : "") ? Yl(l) : "";
  }
  function Ld(e) {
    switch (e.tag) {
      case 26:
      case 27:
      case 5:
        return Yl(e.type);
      case 16:
        return Yl("Lazy");
      case 13:
        return Yl("Suspense");
      case 19:
        return Yl("SuspenseList");
      case 0:
      case 15:
        return $u(e.type, !1);
      case 11:
        return $u(e.type.render, !1);
      case 1:
        return $u(e.type, !0);
      case 31:
        return Yl("Activity");
      default:
        return "";
    }
  }
  function Ns(e) {
    try {
      var t = "";
      do
        t += Ld(e), e = e.return;
      while (e);
      return t;
    } catch (l) {
      return `
Error generating stack: ` + l.message + `
` + l.stack;
    }
  }
  function rt(e) {
    switch (typeof e) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return e;
      case "object":
        return e;
      default:
        return "";
    }
  }
  function As(e) {
    var t = e.type;
    return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
  }
  function Vd(e) {
    var t = As(e) ? "checked" : "value", l = Object.getOwnPropertyDescriptor(
      e.constructor.prototype,
      t
    ), a = "" + e[t];
    if (!e.hasOwnProperty(t) && typeof l < "u" && typeof l.get == "function" && typeof l.set == "function") {
      var n = l.get, u = l.set;
      return Object.defineProperty(e, t, {
        configurable: !0,
        get: function() {
          return n.call(this);
        },
        set: function(c) {
          a = "" + c, u.call(this, c);
        }
      }), Object.defineProperty(e, t, {
        enumerable: l.enumerable
      }), {
        getValue: function() {
          return a;
        },
        setValue: function(c) {
          a = "" + c;
        },
        stopTracking: function() {
          e._valueTracker = null, delete e[t];
        }
      };
    }
  }
  function zn(e) {
    e._valueTracker || (e._valueTracker = Vd(e));
  }
  function zs(e) {
    if (!e) return !1;
    var t = e._valueTracker;
    if (!t) return !0;
    var l = t.getValue(), a = "";
    return e && (a = As(e) ? e.checked ? "true" : "false" : e.value), e = a, e !== l ? (t.setValue(e), !0) : !1;
  }
  function Dn(e) {
    if (e = e || (typeof document < "u" ? document : void 0), typeof e > "u") return null;
    try {
      return e.activeElement || e.body;
    } catch {
      return e.body;
    }
  }
  var Kd = /[\n"\\]/g;
  function ft(e) {
    return e.replace(
      Kd,
      function(t) {
        return "\\" + t.charCodeAt(0).toString(16) + " ";
      }
    );
  }
  function Wu(e, t, l, a, n, u, c, s) {
    e.name = "", c != null && typeof c != "function" && typeof c != "symbol" && typeof c != "boolean" ? e.type = c : e.removeAttribute("type"), t != null ? c === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + rt(t)) : e.value !== "" + rt(t) && (e.value = "" + rt(t)) : c !== "submit" && c !== "reset" || e.removeAttribute("value"), t != null ? Fu(e, c, rt(t)) : l != null ? Fu(e, c, rt(l)) : a != null && e.removeAttribute("value"), n == null && u != null && (e.defaultChecked = !!u), n != null && (e.checked = n && typeof n != "function" && typeof n != "symbol"), s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" ? e.name = "" + rt(s) : e.removeAttribute("name");
  }
  function Ds(e, t, l, a, n, u, c, s) {
    if (u != null && typeof u != "function" && typeof u != "symbol" && typeof u != "boolean" && (e.type = u), t != null || l != null) {
      if (!(u !== "submit" && u !== "reset" || t != null))
        return;
      l = l != null ? "" + rt(l) : "", t = t != null ? "" + rt(t) : l, s || t === e.value || (e.value = t), e.defaultValue = t;
    }
    a = a ?? n, a = typeof a != "function" && typeof a != "symbol" && !!a, e.checked = s ? e.checked : !!a, e.defaultChecked = !!a, c != null && typeof c != "function" && typeof c != "symbol" && typeof c != "boolean" && (e.name = c);
  }
  function Fu(e, t, l) {
    t === "number" && Dn(e.ownerDocument) === e || e.defaultValue === "" + l || (e.defaultValue = "" + l);
  }
  function Gl(e, t, l, a) {
    if (e = e.options, t) {
      t = {};
      for (var n = 0; n < l.length; n++)
        t["$" + l[n]] = !0;
      for (l = 0; l < e.length; l++)
        n = t.hasOwnProperty("$" + e[l].value), e[l].selected !== n && (e[l].selected = n), n && a && (e[l].defaultSelected = !0);
    } else {
      for (l = "" + rt(l), t = null, n = 0; n < e.length; n++) {
        if (e[n].value === l) {
          e[n].selected = !0, a && (e[n].defaultSelected = !0);
          return;
        }
        t !== null || e[n].disabled || (t = e[n]);
      }
      t !== null && (t.selected = !0);
    }
  }
  function Os(e, t, l) {
    if (t != null && (t = "" + rt(t), t !== e.value && (e.value = t), l == null)) {
      e.defaultValue !== t && (e.defaultValue = t);
      return;
    }
    e.defaultValue = l != null ? "" + rt(l) : "";
  }
  function Ms(e, t, l, a) {
    if (t == null) {
      if (a != null) {
        if (l != null) throw Error(f(92));
        if (we(a)) {
          if (1 < a.length) throw Error(f(93));
          a = a[0];
        }
        l = a;
      }
      l == null && (l = ""), t = l;
    }
    l = rt(t), e.defaultValue = l, a = e.textContent, a === l && a !== "" && a !== null && (e.value = a);
  }
  function Xl(e, t) {
    if (t) {
      var l = e.firstChild;
      if (l && l === e.lastChild && l.nodeType === 3) {
        l.nodeValue = t;
        return;
      }
    }
    e.textContent = t;
  }
  var Jd = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " "
    )
  );
  function Us(e, t, l) {
    var a = t.indexOf("--") === 0;
    l == null || typeof l == "boolean" || l === "" ? a ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : a ? e.setProperty(t, l) : typeof l != "number" || l === 0 || Jd.has(t) ? t === "float" ? e.cssFloat = l : e[t] = ("" + l).trim() : e[t] = l + "px";
  }
  function Rs(e, t, l) {
    if (t != null && typeof t != "object")
      throw Error(f(62));
    if (e = e.style, l != null) {
      for (var a in l)
        !l.hasOwnProperty(a) || t != null && t.hasOwnProperty(a) || (a.indexOf("--") === 0 ? e.setProperty(a, "") : a === "float" ? e.cssFloat = "" : e[a] = "");
      for (var n in t)
        a = t[n], t.hasOwnProperty(n) && l[n] !== a && Us(e, n, a);
    } else
      for (var u in t)
        t.hasOwnProperty(u) && Us(e, u, t[u]);
  }
  function Pu(e) {
    if (e.indexOf("-") === -1) return !1;
    switch (e) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var kd = /* @__PURE__ */ new Map([
    ["acceptCharset", "accept-charset"],
    ["htmlFor", "for"],
    ["httpEquiv", "http-equiv"],
    ["crossOrigin", "crossorigin"],
    ["accentHeight", "accent-height"],
    ["alignmentBaseline", "alignment-baseline"],
    ["arabicForm", "arabic-form"],
    ["baselineShift", "baseline-shift"],
    ["capHeight", "cap-height"],
    ["clipPath", "clip-path"],
    ["clipRule", "clip-rule"],
    ["colorInterpolation", "color-interpolation"],
    ["colorInterpolationFilters", "color-interpolation-filters"],
    ["colorProfile", "color-profile"],
    ["colorRendering", "color-rendering"],
    ["dominantBaseline", "dominant-baseline"],
    ["enableBackground", "enable-background"],
    ["fillOpacity", "fill-opacity"],
    ["fillRule", "fill-rule"],
    ["floodColor", "flood-color"],
    ["floodOpacity", "flood-opacity"],
    ["fontFamily", "font-family"],
    ["fontSize", "font-size"],
    ["fontSizeAdjust", "font-size-adjust"],
    ["fontStretch", "font-stretch"],
    ["fontStyle", "font-style"],
    ["fontVariant", "font-variant"],
    ["fontWeight", "font-weight"],
    ["glyphName", "glyph-name"],
    ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
    ["glyphOrientationVertical", "glyph-orientation-vertical"],
    ["horizAdvX", "horiz-adv-x"],
    ["horizOriginX", "horiz-origin-x"],
    ["imageRendering", "image-rendering"],
    ["letterSpacing", "letter-spacing"],
    ["lightingColor", "lighting-color"],
    ["markerEnd", "marker-end"],
    ["markerMid", "marker-mid"],
    ["markerStart", "marker-start"],
    ["overlinePosition", "overline-position"],
    ["overlineThickness", "overline-thickness"],
    ["paintOrder", "paint-order"],
    ["panose-1", "panose-1"],
    ["pointerEvents", "pointer-events"],
    ["renderingIntent", "rendering-intent"],
    ["shapeRendering", "shape-rendering"],
    ["stopColor", "stop-color"],
    ["stopOpacity", "stop-opacity"],
    ["strikethroughPosition", "strikethrough-position"],
    ["strikethroughThickness", "strikethrough-thickness"],
    ["strokeDasharray", "stroke-dasharray"],
    ["strokeDashoffset", "stroke-dashoffset"],
    ["strokeLinecap", "stroke-linecap"],
    ["strokeLinejoin", "stroke-linejoin"],
    ["strokeMiterlimit", "stroke-miterlimit"],
    ["strokeOpacity", "stroke-opacity"],
    ["strokeWidth", "stroke-width"],
    ["textAnchor", "text-anchor"],
    ["textDecoration", "text-decoration"],
    ["textRendering", "text-rendering"],
    ["transformOrigin", "transform-origin"],
    ["underlinePosition", "underline-position"],
    ["underlineThickness", "underline-thickness"],
    ["unicodeBidi", "unicode-bidi"],
    ["unicodeRange", "unicode-range"],
    ["unitsPerEm", "units-per-em"],
    ["vAlphabetic", "v-alphabetic"],
    ["vHanging", "v-hanging"],
    ["vIdeographic", "v-ideographic"],
    ["vMathematical", "v-mathematical"],
    ["vectorEffect", "vector-effect"],
    ["vertAdvY", "vert-adv-y"],
    ["vertOriginX", "vert-origin-x"],
    ["vertOriginY", "vert-origin-y"],
    ["wordSpacing", "word-spacing"],
    ["writingMode", "writing-mode"],
    ["xmlnsXlink", "xmlns:xlink"],
    ["xHeight", "x-height"]
  ]), $d = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function On(e) {
    return $d.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
  }
  var Iu = null;
  function ei(e) {
    return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
  }
  var Ql = null, Zl = null;
  function ws(e) {
    var t = ql(e);
    if (t && (e = t.stateNode)) {
      var l = e[ke] || null;
      e: switch (e = t.stateNode, t.type) {
        case "input":
          if (Wu(
            e,
            l.value,
            l.defaultValue,
            l.defaultValue,
            l.checked,
            l.defaultChecked,
            l.type,
            l.name
          ), t = l.name, l.type === "radio" && t != null) {
            for (l = e; l.parentNode; ) l = l.parentNode;
            for (l = l.querySelectorAll(
              'input[name="' + ft(
                "" + t
              ) + '"][type="radio"]'
            ), t = 0; t < l.length; t++) {
              var a = l[t];
              if (a !== e && a.form === e.form) {
                var n = a[ke] || null;
                if (!n) throw Error(f(90));
                Wu(
                  a,
                  n.value,
                  n.defaultValue,
                  n.defaultValue,
                  n.checked,
                  n.defaultChecked,
                  n.type,
                  n.name
                );
              }
            }
            for (t = 0; t < l.length; t++)
              a = l[t], a.form === e.form && zs(a);
          }
          break e;
        case "textarea":
          Os(e, l.value, l.defaultValue);
          break e;
        case "select":
          t = l.value, t != null && Gl(e, !!l.multiple, t, !1);
      }
    }
  }
  var ti = !1;
  function Cs(e, t, l) {
    if (ti) return e(t, l);
    ti = !0;
    try {
      var a = e(t);
      return a;
    } finally {
      if (ti = !1, (Ql !== null || Zl !== null) && (vu(), Ql && (t = Ql, e = Zl, Zl = Ql = null, ws(t), e)))
        for (t = 0; t < e.length; t++) ws(e[t]);
    }
  }
  function Ta(e, t) {
    var l = e.stateNode;
    if (l === null) return null;
    var a = l[ke] || null;
    if (a === null) return null;
    l = a[t];
    e: switch (t) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        (a = !a.disabled) || (e = e.type, a = !(e === "button" || e === "input" || e === "select" || e === "textarea")), e = !a;
        break e;
      default:
        e = !1;
    }
    if (e) return null;
    if (l && typeof l != "function")
      throw Error(
        f(231, t, typeof l)
      );
    return l;
  }
  var Mt = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u"), li = !1;
  if (Mt)
    try {
      var Na = {};
      Object.defineProperty(Na, "passive", {
        get: function() {
          li = !0;
        }
      }), window.addEventListener("test", Na, Na), window.removeEventListener("test", Na, Na);
    } catch {
      li = !1;
    }
  var kt = null, ai = null, Mn = null;
  function qs() {
    if (Mn) return Mn;
    var e, t = ai, l = t.length, a, n = "value" in kt ? kt.value : kt.textContent, u = n.length;
    for (e = 0; e < l && t[e] === n[e]; e++) ;
    var c = l - e;
    for (a = 1; a <= c && t[l - a] === n[u - a]; a++) ;
    return Mn = n.slice(e, 1 < a ? 1 - a : void 0);
  }
  function Un(e) {
    var t = e.keyCode;
    return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
  }
  function Rn() {
    return !0;
  }
  function Hs() {
    return !1;
  }
  function $e(e) {
    function t(l, a, n, u, c) {
      this._reactName = l, this._targetInst = n, this.type = a, this.nativeEvent = u, this.target = c, this.currentTarget = null;
      for (var s in e)
        e.hasOwnProperty(s) && (l = e[s], this[s] = l ? l(u) : u[s]);
      return this.isDefaultPrevented = (u.defaultPrevented != null ? u.defaultPrevented : u.returnValue === !1) ? Rn : Hs, this.isPropagationStopped = Hs, this;
    }
    return A(t.prototype, {
      preventDefault: function() {
        this.defaultPrevented = !0;
        var l = this.nativeEvent;
        l && (l.preventDefault ? l.preventDefault() : typeof l.returnValue != "unknown" && (l.returnValue = !1), this.isDefaultPrevented = Rn);
      },
      stopPropagation: function() {
        var l = this.nativeEvent;
        l && (l.stopPropagation ? l.stopPropagation() : typeof l.cancelBubble != "unknown" && (l.cancelBubble = !0), this.isPropagationStopped = Rn);
      },
      persist: function() {
      },
      isPersistent: Rn
    }), t;
  }
  var bl = {
    eventPhase: 0,
    bubbles: 0,
    cancelable: 0,
    timeStamp: function(e) {
      return e.timeStamp || Date.now();
    },
    defaultPrevented: 0,
    isTrusted: 0
  }, wn = $e(bl), Aa = A({}, bl, { view: 0, detail: 0 }), Wd = $e(Aa), ni, ui, za, Cn = A({}, Aa, {
    screenX: 0,
    screenY: 0,
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    getModifierState: ci,
    button: 0,
    buttons: 0,
    relatedTarget: function(e) {
      return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
    },
    movementX: function(e) {
      return "movementX" in e ? e.movementX : (e !== za && (za && e.type === "mousemove" ? (ni = e.screenX - za.screenX, ui = e.screenY - za.screenY) : ui = ni = 0, za = e), ni);
    },
    movementY: function(e) {
      return "movementY" in e ? e.movementY : ui;
    }
  }), Bs = $e(Cn), Fd = A({}, Cn, { dataTransfer: 0 }), Pd = $e(Fd), Id = A({}, Aa, { relatedTarget: 0 }), ii = $e(Id), eh = A({}, bl, {
    animationName: 0,
    elapsedTime: 0,
    pseudoElement: 0
  }), th = $e(eh), lh = A({}, bl, {
    clipboardData: function(e) {
      return "clipboardData" in e ? e.clipboardData : window.clipboardData;
    }
  }), ah = $e(lh), nh = A({}, bl, { data: 0 }), Ys = $e(nh), uh = {
    Esc: "Escape",
    Spacebar: " ",
    Left: "ArrowLeft",
    Up: "ArrowUp",
    Right: "ArrowRight",
    Down: "ArrowDown",
    Del: "Delete",
    Win: "OS",
    Menu: "ContextMenu",
    Apps: "ContextMenu",
    Scroll: "ScrollLock",
    MozPrintableKey: "Unidentified"
  }, ih = {
    8: "Backspace",
    9: "Tab",
    12: "Clear",
    13: "Enter",
    16: "Shift",
    17: "Control",
    18: "Alt",
    19: "Pause",
    20: "CapsLock",
    27: "Escape",
    32: " ",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    45: "Insert",
    46: "Delete",
    112: "F1",
    113: "F2",
    114: "F3",
    115: "F4",
    116: "F5",
    117: "F6",
    118: "F7",
    119: "F8",
    120: "F9",
    121: "F10",
    122: "F11",
    123: "F12",
    144: "NumLock",
    145: "ScrollLock",
    224: "Meta"
  }, ch = {
    Alt: "altKey",
    Control: "ctrlKey",
    Meta: "metaKey",
    Shift: "shiftKey"
  };
  function sh(e) {
    var t = this.nativeEvent;
    return t.getModifierState ? t.getModifierState(e) : (e = ch[e]) ? !!t[e] : !1;
  }
  function ci() {
    return sh;
  }
  var rh = A({}, Aa, {
    key: function(e) {
      if (e.key) {
        var t = uh[e.key] || e.key;
        if (t !== "Unidentified") return t;
      }
      return e.type === "keypress" ? (e = Un(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? ih[e.keyCode] || "Unidentified" : "";
    },
    code: 0,
    location: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    repeat: 0,
    locale: 0,
    getModifierState: ci,
    charCode: function(e) {
      return e.type === "keypress" ? Un(e) : 0;
    },
    keyCode: function(e) {
      return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
    },
    which: function(e) {
      return e.type === "keypress" ? Un(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
    }
  }), fh = $e(rh), oh = A({}, Cn, {
    pointerId: 0,
    width: 0,
    height: 0,
    pressure: 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 0,
    isPrimary: 0
  }), Gs = $e(oh), dh = A({}, Aa, {
    touches: 0,
    targetTouches: 0,
    changedTouches: 0,
    altKey: 0,
    metaKey: 0,
    ctrlKey: 0,
    shiftKey: 0,
    getModifierState: ci
  }), hh = $e(dh), mh = A({}, bl, {
    propertyName: 0,
    elapsedTime: 0,
    pseudoElement: 0
  }), vh = $e(mh), yh = A({}, Cn, {
    deltaX: function(e) {
      return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
    },
    deltaY: function(e) {
      return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
    },
    deltaZ: 0,
    deltaMode: 0
  }), gh = $e(yh), bh = A({}, bl, {
    newState: 0,
    oldState: 0
  }), ph = $e(bh), jh = [9, 13, 27, 32], si = Mt && "CompositionEvent" in window, Da = null;
  Mt && "documentMode" in document && (Da = document.documentMode);
  var xh = Mt && "TextEvent" in window && !Da, Xs = Mt && (!si || Da && 8 < Da && 11 >= Da), Qs = " ", Zs = !1;
  function Ls(e, t) {
    switch (e) {
      case "keyup":
        return jh.indexOf(t.keyCode) !== -1;
      case "keydown":
        return t.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function Vs(e) {
    return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
  }
  var Ll = !1;
  function Sh(e, t) {
    switch (e) {
      case "compositionend":
        return Vs(t);
      case "keypress":
        return t.which !== 32 ? null : (Zs = !0, Qs);
      case "textInput":
        return e = t.data, e === Qs && Zs ? null : e;
      default:
        return null;
    }
  }
  function _h(e, t) {
    if (Ll)
      return e === "compositionend" || !si && Ls(e, t) ? (e = qs(), Mn = ai = kt = null, Ll = !1, e) : null;
    switch (e) {
      case "paste":
        return null;
      case "keypress":
        if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
          if (t.char && 1 < t.char.length)
            return t.char;
          if (t.which) return String.fromCharCode(t.which);
        }
        return null;
      case "compositionend":
        return Xs && t.locale !== "ko" ? null : t.data;
      default:
        return null;
    }
  }
  var Eh = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0
  };
  function Ks(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return t === "input" ? !!Eh[e.type] : t === "textarea";
  }
  function Js(e, t, l, a) {
    Ql ? Zl ? Zl.push(a) : Zl = [a] : Ql = a, t = xu(t, "onChange"), 0 < t.length && (l = new wn(
      "onChange",
      "change",
      null,
      l,
      a
    ), e.push({ event: l, listeners: t }));
  }
  var Oa = null, Ma = null;
  function Th(e) {
    Do(e, 0);
  }
  function qn(e) {
    var t = Ea(e);
    if (zs(t)) return e;
  }
  function ks(e, t) {
    if (e === "change") return t;
  }
  var $s = !1;
  if (Mt) {
    var ri;
    if (Mt) {
      var fi = "oninput" in document;
      if (!fi) {
        var Ws = document.createElement("div");
        Ws.setAttribute("oninput", "return;"), fi = typeof Ws.oninput == "function";
      }
      ri = fi;
    } else ri = !1;
    $s = ri && (!document.documentMode || 9 < document.documentMode);
  }
  function Fs() {
    Oa && (Oa.detachEvent("onpropertychange", Ps), Ma = Oa = null);
  }
  function Ps(e) {
    if (e.propertyName === "value" && qn(Ma)) {
      var t = [];
      Js(
        t,
        Ma,
        e,
        ei(e)
      ), Cs(Th, t);
    }
  }
  function Nh(e, t, l) {
    e === "focusin" ? (Fs(), Oa = t, Ma = l, Oa.attachEvent("onpropertychange", Ps)) : e === "focusout" && Fs();
  }
  function Ah(e) {
    if (e === "selectionchange" || e === "keyup" || e === "keydown")
      return qn(Ma);
  }
  function zh(e, t) {
    if (e === "click") return qn(t);
  }
  function Dh(e, t) {
    if (e === "input" || e === "change")
      return qn(t);
  }
  function Oh(e, t) {
    return e === t && (e !== 0 || 1 / e === 1 / t) || e !== e && t !== t;
  }
  var tt = typeof Object.is == "function" ? Object.is : Oh;
  function Ua(e, t) {
    if (tt(e, t)) return !0;
    if (typeof e != "object" || e === null || typeof t != "object" || t === null)
      return !1;
    var l = Object.keys(e), a = Object.keys(t);
    if (l.length !== a.length) return !1;
    for (a = 0; a < l.length; a++) {
      var n = l[a];
      if (!Yu.call(t, n) || !tt(e[n], t[n]))
        return !1;
    }
    return !0;
  }
  function Is(e) {
    for (; e && e.firstChild; ) e = e.firstChild;
    return e;
  }
  function er(e, t) {
    var l = Is(e);
    e = 0;
    for (var a; l; ) {
      if (l.nodeType === 3) {
        if (a = e + l.textContent.length, e <= t && a >= t)
          return { node: l, offset: t - e };
        e = a;
      }
      e: {
        for (; l; ) {
          if (l.nextSibling) {
            l = l.nextSibling;
            break e;
          }
          l = l.parentNode;
        }
        l = void 0;
      }
      l = Is(l);
    }
  }
  function tr(e, t) {
    return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? tr(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
  }
  function lr(e) {
    e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
    for (var t = Dn(e.document); t instanceof e.HTMLIFrameElement; ) {
      try {
        var l = typeof t.contentWindow.location.href == "string";
      } catch {
        l = !1;
      }
      if (l) e = t.contentWindow;
      else break;
      t = Dn(e.document);
    }
    return t;
  }
  function oi(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
  }
  var Mh = Mt && "documentMode" in document && 11 >= document.documentMode, Vl = null, di = null, Ra = null, hi = !1;
  function ar(e, t, l) {
    var a = l.window === l ? l.document : l.nodeType === 9 ? l : l.ownerDocument;
    hi || Vl == null || Vl !== Dn(a) || (a = Vl, "selectionStart" in a && oi(a) ? a = { start: a.selectionStart, end: a.selectionEnd } : (a = (a.ownerDocument && a.ownerDocument.defaultView || window).getSelection(), a = {
      anchorNode: a.anchorNode,
      anchorOffset: a.anchorOffset,
      focusNode: a.focusNode,
      focusOffset: a.focusOffset
    }), Ra && Ua(Ra, a) || (Ra = a, a = xu(di, "onSelect"), 0 < a.length && (t = new wn(
      "onSelect",
      "select",
      null,
      t,
      l
    ), e.push({ event: t, listeners: a }), t.target = Vl)));
  }
  function pl(e, t) {
    var l = {};
    return l[e.toLowerCase()] = t.toLowerCase(), l["Webkit" + e] = "webkit" + t, l["Moz" + e] = "moz" + t, l;
  }
  var Kl = {
    animationend: pl("Animation", "AnimationEnd"),
    animationiteration: pl("Animation", "AnimationIteration"),
    animationstart: pl("Animation", "AnimationStart"),
    transitionrun: pl("Transition", "TransitionRun"),
    transitionstart: pl("Transition", "TransitionStart"),
    transitioncancel: pl("Transition", "TransitionCancel"),
    transitionend: pl("Transition", "TransitionEnd")
  }, mi = {}, nr = {};
  Mt && (nr = document.createElement("div").style, "AnimationEvent" in window || (delete Kl.animationend.animation, delete Kl.animationiteration.animation, delete Kl.animationstart.animation), "TransitionEvent" in window || delete Kl.transitionend.transition);
  function jl(e) {
    if (mi[e]) return mi[e];
    if (!Kl[e]) return e;
    var t = Kl[e], l;
    for (l in t)
      if (t.hasOwnProperty(l) && l in nr)
        return mi[e] = t[l];
    return e;
  }
  var ur = jl("animationend"), ir = jl("animationiteration"), cr = jl("animationstart"), Uh = jl("transitionrun"), Rh = jl("transitionstart"), wh = jl("transitioncancel"), sr = jl("transitionend"), rr = /* @__PURE__ */ new Map(), vi = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
    " "
  );
  vi.push("scrollEnd");
  function bt(e, t) {
    rr.set(e, t), gl(t, [e]);
  }
  var fr = /* @__PURE__ */ new WeakMap();
  function ot(e, t) {
    if (typeof e == "object" && e !== null) {
      var l = fr.get(e);
      return l !== void 0 ? l : (t = {
        value: e,
        source: t,
        stack: Ns(t)
      }, fr.set(e, t), t);
    }
    return {
      value: e,
      source: t,
      stack: Ns(t)
    };
  }
  var dt = [], Jl = 0, yi = 0;
  function Hn() {
    for (var e = Jl, t = yi = Jl = 0; t < e; ) {
      var l = dt[t];
      dt[t++] = null;
      var a = dt[t];
      dt[t++] = null;
      var n = dt[t];
      dt[t++] = null;
      var u = dt[t];
      if (dt[t++] = null, a !== null && n !== null) {
        var c = a.pending;
        c === null ? n.next = n : (n.next = c.next, c.next = n), a.pending = n;
      }
      u !== 0 && or(l, n, u);
    }
  }
  function Bn(e, t, l, a) {
    dt[Jl++] = e, dt[Jl++] = t, dt[Jl++] = l, dt[Jl++] = a, yi |= a, e.lanes |= a, e = e.alternate, e !== null && (e.lanes |= a);
  }
  function gi(e, t, l, a) {
    return Bn(e, t, l, a), Yn(e);
  }
  function kl(e, t) {
    return Bn(e, null, null, t), Yn(e);
  }
  function or(e, t, l) {
    e.lanes |= l;
    var a = e.alternate;
    a !== null && (a.lanes |= l);
    for (var n = !1, u = e.return; u !== null; )
      u.childLanes |= l, a = u.alternate, a !== null && (a.childLanes |= l), u.tag === 22 && (e = u.stateNode, e === null || e._visibility & 1 || (n = !0)), e = u, u = u.return;
    return e.tag === 3 ? (u = e.stateNode, n && t !== null && (n = 31 - et(l), e = u.hiddenUpdates, a = e[n], a === null ? e[n] = [t] : a.push(t), t.lane = l | 536870912), u) : null;
  }
  function Yn(e) {
    if (50 < nn)
      throw nn = 0, _c = null, Error(f(185));
    for (var t = e.return; t !== null; )
      e = t, t = e.return;
    return e.tag === 3 ? e.stateNode : null;
  }
  var $l = {};
  function Ch(e, t, l, a) {
    this.tag = e, this.key = l, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = a, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
  }
  function lt(e, t, l, a) {
    return new Ch(e, t, l, a);
  }
  function bi(e) {
    return e = e.prototype, !(!e || !e.isReactComponent);
  }
  function Ut(e, t) {
    var l = e.alternate;
    return l === null ? (l = lt(
      e.tag,
      t,
      e.key,
      e.mode
    ), l.elementType = e.elementType, l.type = e.type, l.stateNode = e.stateNode, l.alternate = e, e.alternate = l) : (l.pendingProps = t, l.type = e.type, l.flags = 0, l.subtreeFlags = 0, l.deletions = null), l.flags = e.flags & 65011712, l.childLanes = e.childLanes, l.lanes = e.lanes, l.child = e.child, l.memoizedProps = e.memoizedProps, l.memoizedState = e.memoizedState, l.updateQueue = e.updateQueue, t = e.dependencies, l.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }, l.sibling = e.sibling, l.index = e.index, l.ref = e.ref, l.refCleanup = e.refCleanup, l;
  }
  function dr(e, t) {
    e.flags &= 65011714;
    var l = e.alternate;
    return l === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = l.childLanes, e.lanes = l.lanes, e.child = l.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = l.memoizedProps, e.memoizedState = l.memoizedState, e.updateQueue = l.updateQueue, e.type = l.type, t = l.dependencies, e.dependencies = t === null ? null : {
      lanes: t.lanes,
      firstContext: t.firstContext
    }), e;
  }
  function Gn(e, t, l, a, n, u) {
    var c = 0;
    if (a = e, typeof e == "function") bi(e) && (c = 1);
    else if (typeof e == "string")
      c = Hm(
        e,
        l,
        Z.current
      ) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
    else
      e: switch (e) {
        case st:
          return e = lt(31, l, t, n), e.elementType = st, e.lanes = u, e;
        case B:
          return xl(l.children, n, u, t);
        case I:
          c = 8, n |= 24;
          break;
        case L:
          return e = lt(12, l, t, n | 2), e.elementType = L, e.lanes = u, e;
        case ae:
          return e = lt(13, l, t, n), e.elementType = ae, e.lanes = u, e;
        case Oe:
          return e = lt(19, l, t, n), e.elementType = Oe, e.lanes = u, e;
        default:
          if (typeof e == "object" && e !== null)
            switch (e.$$typeof) {
              case Q:
              case V:
                c = 10;
                break e;
              case P:
                c = 9;
                break e;
              case de:
                c = 11;
                break e;
              case te:
                c = 14;
                break e;
              case Se:
                c = 16, a = null;
                break e;
            }
          c = 29, l = Error(
            f(130, e === null ? "null" : typeof e, "")
          ), a = null;
      }
    return t = lt(c, l, t, n), t.elementType = e, t.type = a, t.lanes = u, t;
  }
  function xl(e, t, l, a) {
    return e = lt(7, e, a, t), e.lanes = l, e;
  }
  function pi(e, t, l) {
    return e = lt(6, e, null, t), e.lanes = l, e;
  }
  function ji(e, t, l) {
    return t = lt(
      4,
      e.children !== null ? e.children : [],
      e.key,
      t
    ), t.lanes = l, t.stateNode = {
      containerInfo: e.containerInfo,
      pendingChildren: null,
      implementation: e.implementation
    }, t;
  }
  var Wl = [], Fl = 0, Xn = null, Qn = 0, ht = [], mt = 0, Sl = null, Rt = 1, wt = "";
  function _l(e, t) {
    Wl[Fl++] = Qn, Wl[Fl++] = Xn, Xn = e, Qn = t;
  }
  function hr(e, t, l) {
    ht[mt++] = Rt, ht[mt++] = wt, ht[mt++] = Sl, Sl = e;
    var a = Rt;
    e = wt;
    var n = 32 - et(a) - 1;
    a &= ~(1 << n), l += 1;
    var u = 32 - et(t) + n;
    if (30 < u) {
      var c = n - n % 5;
      u = (a & (1 << c) - 1).toString(32), a >>= c, n -= c, Rt = 1 << 32 - et(t) + n | l << n | a, wt = u + e;
    } else
      Rt = 1 << u | l << n | a, wt = e;
  }
  function xi(e) {
    e.return !== null && (_l(e, 1), hr(e, 1, 0));
  }
  function Si(e) {
    for (; e === Xn; )
      Xn = Wl[--Fl], Wl[Fl] = null, Qn = Wl[--Fl], Wl[Fl] = null;
    for (; e === Sl; )
      Sl = ht[--mt], ht[mt] = null, wt = ht[--mt], ht[mt] = null, Rt = ht[--mt], ht[mt] = null;
  }
  var Ke = null, Ee = null, oe = !1, El = null, _t = !1, _i = Error(f(519));
  function Tl(e) {
    var t = Error(f(418, ""));
    throw qa(ot(t, e)), _i;
  }
  function mr(e) {
    var t = e.stateNode, l = e.type, a = e.memoizedProps;
    switch (t[Ze] = e, t[ke] = a, l) {
      case "dialog":
        se("cancel", t), se("close", t);
        break;
      case "iframe":
      case "object":
      case "embed":
        se("load", t);
        break;
      case "video":
      case "audio":
        for (l = 0; l < cn.length; l++)
          se(cn[l], t);
        break;
      case "source":
        se("error", t);
        break;
      case "img":
      case "image":
      case "link":
        se("error", t), se("load", t);
        break;
      case "details":
        se("toggle", t);
        break;
      case "input":
        se("invalid", t), Ds(
          t,
          a.value,
          a.defaultValue,
          a.checked,
          a.defaultChecked,
          a.type,
          a.name,
          !0
        ), zn(t);
        break;
      case "select":
        se("invalid", t);
        break;
      case "textarea":
        se("invalid", t), Ms(t, a.value, a.defaultValue, a.children), zn(t);
    }
    l = a.children, typeof l != "string" && typeof l != "number" && typeof l != "bigint" || t.textContent === "" + l || a.suppressHydrationWarning === !0 || Ro(t.textContent, l) ? (a.popover != null && (se("beforetoggle", t), se("toggle", t)), a.onScroll != null && se("scroll", t), a.onScrollEnd != null && se("scrollend", t), a.onClick != null && (t.onclick = Su), t = !0) : t = !1, t || Tl(e);
  }
  function vr(e) {
    for (Ke = e.return; Ke; )
      switch (Ke.tag) {
        case 5:
        case 13:
          _t = !1;
          return;
        case 27:
        case 3:
          _t = !0;
          return;
        default:
          Ke = Ke.return;
      }
  }
  function wa(e) {
    if (e !== Ke) return !1;
    if (!oe) return vr(e), oe = !0, !1;
    var t = e.tag, l;
    if ((l = t !== 3 && t !== 27) && ((l = t === 5) && (l = e.type, l = !(l !== "form" && l !== "button") || Yc(e.type, e.memoizedProps)), l = !l), l && Ee && Tl(e), vr(e), t === 13) {
      if (e = e.memoizedState, e = e !== null ? e.dehydrated : null, !e) throw Error(f(317));
      e: {
        for (e = e.nextSibling, t = 0; e; ) {
          if (e.nodeType === 8)
            if (l = e.data, l === "/$") {
              if (t === 0) {
                Ee = jt(e.nextSibling);
                break e;
              }
              t--;
            } else
              l !== "$" && l !== "$!" && l !== "$?" || t++;
          e = e.nextSibling;
        }
        Ee = null;
      }
    } else
      t === 27 ? (t = Ee, fl(e.type) ? (e = Zc, Zc = null, Ee = e) : Ee = t) : Ee = Ke ? jt(e.stateNode.nextSibling) : null;
    return !0;
  }
  function Ca() {
    Ee = Ke = null, oe = !1;
  }
  function yr() {
    var e = El;
    return e !== null && (Pe === null ? Pe = e : Pe.push.apply(
      Pe,
      e
    ), El = null), e;
  }
  function qa(e) {
    El === null ? El = [e] : El.push(e);
  }
  var Ei = N(null), Nl = null, Ct = null;
  function $t(e, t, l) {
    H(Ei, t._currentValue), t._currentValue = l;
  }
  function qt(e) {
    e._currentValue = Ei.current, C(Ei);
  }
  function Ti(e, t, l) {
    for (; e !== null; ) {
      var a = e.alternate;
      if ((e.childLanes & t) !== t ? (e.childLanes |= t, a !== null && (a.childLanes |= t)) : a !== null && (a.childLanes & t) !== t && (a.childLanes |= t), e === l) break;
      e = e.return;
    }
  }
  function Ni(e, t, l, a) {
    var n = e.child;
    for (n !== null && (n.return = e); n !== null; ) {
      var u = n.dependencies;
      if (u !== null) {
        var c = n.child;
        u = u.firstContext;
        e: for (; u !== null; ) {
          var s = u;
          u = n;
          for (var h = 0; h < t.length; h++)
            if (s.context === t[h]) {
              u.lanes |= l, s = u.alternate, s !== null && (s.lanes |= l), Ti(
                u.return,
                l,
                e
              ), a || (c = null);
              break e;
            }
          u = s.next;
        }
      } else if (n.tag === 18) {
        if (c = n.return, c === null) throw Error(f(341));
        c.lanes |= l, u = c.alternate, u !== null && (u.lanes |= l), Ti(c, l, e), c = null;
      } else c = n.child;
      if (c !== null) c.return = n;
      else
        for (c = n; c !== null; ) {
          if (c === e) {
            c = null;
            break;
          }
          if (n = c.sibling, n !== null) {
            n.return = c.return, c = n;
            break;
          }
          c = c.return;
        }
      n = c;
    }
  }
  function Ha(e, t, l, a) {
    e = null;
    for (var n = t, u = !1; n !== null; ) {
      if (!u) {
        if ((n.flags & 524288) !== 0) u = !0;
        else if ((n.flags & 262144) !== 0) break;
      }
      if (n.tag === 10) {
        var c = n.alternate;
        if (c === null) throw Error(f(387));
        if (c = c.memoizedProps, c !== null) {
          var s = n.type;
          tt(n.pendingProps.value, c.value) || (e !== null ? e.push(s) : e = [s]);
        }
      } else if (n === Ye.current) {
        if (c = n.alternate, c === null) throw Error(f(387));
        c.memoizedState.memoizedState !== n.memoizedState.memoizedState && (e !== null ? e.push(hn) : e = [hn]);
      }
      n = n.return;
    }
    e !== null && Ni(
      t,
      e,
      l,
      a
    ), t.flags |= 262144;
  }
  function Zn(e) {
    for (e = e.firstContext; e !== null; ) {
      if (!tt(
        e.context._currentValue,
        e.memoizedValue
      ))
        return !0;
      e = e.next;
    }
    return !1;
  }
  function Al(e) {
    Nl = e, Ct = null, e = e.dependencies, e !== null && (e.firstContext = null);
  }
  function Le(e) {
    return gr(Nl, e);
  }
  function Ln(e, t) {
    return Nl === null && Al(e), gr(e, t);
  }
  function gr(e, t) {
    var l = t._currentValue;
    if (t = { context: t, memoizedValue: l, next: null }, Ct === null) {
      if (e === null) throw Error(f(308));
      Ct = t, e.dependencies = { lanes: 0, firstContext: t }, e.flags |= 524288;
    } else Ct = Ct.next = t;
    return l;
  }
  var qh = typeof AbortController < "u" ? AbortController : function() {
    var e = [], t = this.signal = {
      aborted: !1,
      addEventListener: function(l, a) {
        e.push(a);
      }
    };
    this.abort = function() {
      t.aborted = !0, e.forEach(function(l) {
        return l();
      });
    };
  }, Hh = r.unstable_scheduleCallback, Bh = r.unstable_NormalPriority, Me = {
    $$typeof: V,
    Consumer: null,
    Provider: null,
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0
  };
  function Ai() {
    return {
      controller: new qh(),
      data: /* @__PURE__ */ new Map(),
      refCount: 0
    };
  }
  function Ba(e) {
    e.refCount--, e.refCount === 0 && Hh(Bh, function() {
      e.controller.abort();
    });
  }
  var Ya = null, zi = 0, Pl = 0, Il = null;
  function Yh(e, t) {
    if (Ya === null) {
      var l = Ya = [];
      zi = 0, Pl = Oc(), Il = {
        status: "pending",
        value: void 0,
        then: function(a) {
          l.push(a);
        }
      };
    }
    return zi++, t.then(br, br), t;
  }
  function br() {
    if (--zi === 0 && Ya !== null) {
      Il !== null && (Il.status = "fulfilled");
      var e = Ya;
      Ya = null, Pl = 0, Il = null;
      for (var t = 0; t < e.length; t++) (0, e[t])();
    }
  }
  function Gh(e, t) {
    var l = [], a = {
      status: "pending",
      value: null,
      reason: null,
      then: function(n) {
        l.push(n);
      }
    };
    return e.then(
      function() {
        a.status = "fulfilled", a.value = t;
        for (var n = 0; n < l.length; n++) (0, l[n])(t);
      },
      function(n) {
        for (a.status = "rejected", a.reason = n, n = 0; n < l.length; n++)
          (0, l[n])(void 0);
      }
    ), a;
  }
  var pr = D.S;
  D.S = function(e, t) {
    typeof t == "object" && t !== null && typeof t.then == "function" && Yh(e, t), pr !== null && pr(e, t);
  };
  var zl = N(null);
  function Di() {
    var e = zl.current;
    return e !== null ? e : je.pooledCache;
  }
  function Vn(e, t) {
    t === null ? H(zl, zl.current) : H(zl, t.pool);
  }
  function jr() {
    var e = Di();
    return e === null ? null : { parent: Me._currentValue, pool: e };
  }
  var Ga = Error(f(460)), xr = Error(f(474)), Kn = Error(f(542)), Oi = { then: function() {
  } };
  function Sr(e) {
    return e = e.status, e === "fulfilled" || e === "rejected";
  }
  function Jn() {
  }
  function _r(e, t, l) {
    switch (l = e[l], l === void 0 ? e.push(t) : l !== t && (t.then(Jn, Jn), t = l), t.status) {
      case "fulfilled":
        return t.value;
      case "rejected":
        throw e = t.reason, Tr(e), e;
      default:
        if (typeof t.status == "string") t.then(Jn, Jn);
        else {
          if (e = je, e !== null && 100 < e.shellSuspendCounter)
            throw Error(f(482));
          e = t, e.status = "pending", e.then(
            function(a) {
              if (t.status === "pending") {
                var n = t;
                n.status = "fulfilled", n.value = a;
              }
            },
            function(a) {
              if (t.status === "pending") {
                var n = t;
                n.status = "rejected", n.reason = a;
              }
            }
          );
        }
        switch (t.status) {
          case "fulfilled":
            return t.value;
          case "rejected":
            throw e = t.reason, Tr(e), e;
        }
        throw Xa = t, Ga;
    }
  }
  var Xa = null;
  function Er() {
    if (Xa === null) throw Error(f(459));
    var e = Xa;
    return Xa = null, e;
  }
  function Tr(e) {
    if (e === Ga || e === Kn)
      throw Error(f(483));
  }
  var Wt = !1;
  function Mi(e) {
    e.updateQueue = {
      baseState: e.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null
    };
  }
  function Ui(e, t) {
    e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
      baseState: e.baseState,
      firstBaseUpdate: e.firstBaseUpdate,
      lastBaseUpdate: e.lastBaseUpdate,
      shared: e.shared,
      callbacks: null
    });
  }
  function Ft(e) {
    return { lane: e, tag: 0, payload: null, callback: null, next: null };
  }
  function Pt(e, t, l) {
    var a = e.updateQueue;
    if (a === null) return null;
    if (a = a.shared, (he & 2) !== 0) {
      var n = a.pending;
      return n === null ? t.next = t : (t.next = n.next, n.next = t), a.pending = t, t = Yn(e), or(e, null, l), t;
    }
    return Bn(e, a, t, l), Yn(e);
  }
  function Qa(e, t, l) {
    if (t = t.updateQueue, t !== null && (t = t.shared, (l & 4194048) !== 0)) {
      var a = t.lanes;
      a &= e.pendingLanes, l |= a, t.lanes = l, bs(e, l);
    }
  }
  function Ri(e, t) {
    var l = e.updateQueue, a = e.alternate;
    if (a !== null && (a = a.updateQueue, l === a)) {
      var n = null, u = null;
      if (l = l.firstBaseUpdate, l !== null) {
        do {
          var c = {
            lane: l.lane,
            tag: l.tag,
            payload: l.payload,
            callback: null,
            next: null
          };
          u === null ? n = u = c : u = u.next = c, l = l.next;
        } while (l !== null);
        u === null ? n = u = t : u = u.next = t;
      } else n = u = t;
      l = {
        baseState: a.baseState,
        firstBaseUpdate: n,
        lastBaseUpdate: u,
        shared: a.shared,
        callbacks: a.callbacks
      }, e.updateQueue = l;
      return;
    }
    e = l.lastBaseUpdate, e === null ? l.firstBaseUpdate = t : e.next = t, l.lastBaseUpdate = t;
  }
  var wi = !1;
  function Za() {
    if (wi) {
      var e = Il;
      if (e !== null) throw e;
    }
  }
  function La(e, t, l, a) {
    wi = !1;
    var n = e.updateQueue;
    Wt = !1;
    var u = n.firstBaseUpdate, c = n.lastBaseUpdate, s = n.shared.pending;
    if (s !== null) {
      n.shared.pending = null;
      var h = s, b = h.next;
      h.next = null, c === null ? u = b : c.next = b, c = h;
      var O = e.alternate;
      O !== null && (O = O.updateQueue, s = O.lastBaseUpdate, s !== c && (s === null ? O.firstBaseUpdate = b : s.next = b, O.lastBaseUpdate = h));
    }
    if (u !== null) {
      var R = n.baseState;
      c = 0, O = b = h = null, s = u;
      do {
        var x = s.lane & -536870913, S = x !== s.lane;
        if (S ? (re & x) === x : (a & x) === x) {
          x !== 0 && x === Pl && (wi = !0), O !== null && (O = O.next = {
            lane: 0,
            tag: s.tag,
            payload: s.payload,
            callback: null,
            next: null
          });
          e: {
            var ee = e, W = s;
            x = t;
            var be = l;
            switch (W.tag) {
              case 1:
                if (ee = W.payload, typeof ee == "function") {
                  R = ee.call(be, R, x);
                  break e;
                }
                R = ee;
                break e;
              case 3:
                ee.flags = ee.flags & -65537 | 128;
              case 0:
                if (ee = W.payload, x = typeof ee == "function" ? ee.call(be, R, x) : ee, x == null) break e;
                R = A({}, R, x);
                break e;
              case 2:
                Wt = !0;
            }
          }
          x = s.callback, x !== null && (e.flags |= 64, S && (e.flags |= 8192), S = n.callbacks, S === null ? n.callbacks = [x] : S.push(x));
        } else
          S = {
            lane: x,
            tag: s.tag,
            payload: s.payload,
            callback: s.callback,
            next: null
          }, O === null ? (b = O = S, h = R) : O = O.next = S, c |= x;
        if (s = s.next, s === null) {
          if (s = n.shared.pending, s === null)
            break;
          S = s, s = S.next, S.next = null, n.lastBaseUpdate = S, n.shared.pending = null;
        }
      } while (!0);
      O === null && (h = R), n.baseState = h, n.firstBaseUpdate = b, n.lastBaseUpdate = O, u === null && (n.shared.lanes = 0), il |= c, e.lanes = c, e.memoizedState = R;
    }
  }
  function Nr(e, t) {
    if (typeof e != "function")
      throw Error(f(191, e));
    e.call(t);
  }
  function Ar(e, t) {
    var l = e.callbacks;
    if (l !== null)
      for (e.callbacks = null, e = 0; e < l.length; e++)
        Nr(l[e], t);
  }
  var ea = N(null), kn = N(0);
  function zr(e, t) {
    e = Zt, H(kn, e), H(ea, t), Zt = e | t.baseLanes;
  }
  function Ci() {
    H(kn, Zt), H(ea, ea.current);
  }
  function qi() {
    Zt = kn.current, C(ea), C(kn);
  }
  var It = 0, ue = null, ye = null, ze = null, $n = !1, ta = !1, Dl = !1, Wn = 0, Va = 0, la = null, Xh = 0;
  function Ne() {
    throw Error(f(321));
  }
  function Hi(e, t) {
    if (t === null) return !1;
    for (var l = 0; l < t.length && l < e.length; l++)
      if (!tt(e[l], t[l])) return !1;
    return !0;
  }
  function Bi(e, t, l, a, n, u) {
    return It = u, ue = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, D.H = e === null || e.memoizedState === null ? df : hf, Dl = !1, u = l(a, n), Dl = !1, ta && (u = Or(
      t,
      l,
      a,
      n
    )), Dr(e), u;
  }
  function Dr(e) {
    D.H = lu;
    var t = ye !== null && ye.next !== null;
    if (It = 0, ze = ye = ue = null, $n = !1, Va = 0, la = null, t) throw Error(f(300));
    e === null || qe || (e = e.dependencies, e !== null && Zn(e) && (qe = !0));
  }
  function Or(e, t, l, a) {
    ue = e;
    var n = 0;
    do {
      if (ta && (la = null), Va = 0, ta = !1, 25 <= n) throw Error(f(301));
      if (n += 1, ze = ye = null, e.updateQueue != null) {
        var u = e.updateQueue;
        u.lastEffect = null, u.events = null, u.stores = null, u.memoCache != null && (u.memoCache.index = 0);
      }
      D.H = kh, u = t(l, a);
    } while (ta);
    return u;
  }
  function Qh() {
    var e = D.H, t = e.useState()[0];
    return t = typeof t.then == "function" ? Ka(t) : t, e = e.useState()[0], (ye !== null ? ye.memoizedState : null) !== e && (ue.flags |= 1024), t;
  }
  function Yi() {
    var e = Wn !== 0;
    return Wn = 0, e;
  }
  function Gi(e, t, l) {
    t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~l;
  }
  function Xi(e) {
    if ($n) {
      for (e = e.memoizedState; e !== null; ) {
        var t = e.queue;
        t !== null && (t.pending = null), e = e.next;
      }
      $n = !1;
    }
    It = 0, ze = ye = ue = null, ta = !1, Va = Wn = 0, la = null;
  }
  function We() {
    var e = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null
    };
    return ze === null ? ue.memoizedState = ze = e : ze = ze.next = e, ze;
  }
  function De() {
    if (ye === null) {
      var e = ue.alternate;
      e = e !== null ? e.memoizedState : null;
    } else e = ye.next;
    var t = ze === null ? ue.memoizedState : ze.next;
    if (t !== null)
      ze = t, ye = e;
    else {
      if (e === null)
        throw ue.alternate === null ? Error(f(467)) : Error(f(310));
      ye = e, e = {
        memoizedState: ye.memoizedState,
        baseState: ye.baseState,
        baseQueue: ye.baseQueue,
        queue: ye.queue,
        next: null
      }, ze === null ? ue.memoizedState = ze = e : ze = ze.next = e;
    }
    return ze;
  }
  function Qi() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function Ka(e) {
    var t = Va;
    return Va += 1, la === null && (la = []), e = _r(la, e, t), t = ue, (ze === null ? t.memoizedState : ze.next) === null && (t = t.alternate, D.H = t === null || t.memoizedState === null ? df : hf), e;
  }
  function Fn(e) {
    if (e !== null && typeof e == "object") {
      if (typeof e.then == "function") return Ka(e);
      if (e.$$typeof === V) return Le(e);
    }
    throw Error(f(438, String(e)));
  }
  function Zi(e) {
    var t = null, l = ue.updateQueue;
    if (l !== null && (t = l.memoCache), t == null) {
      var a = ue.alternate;
      a !== null && (a = a.updateQueue, a !== null && (a = a.memoCache, a != null && (t = {
        data: a.data.map(function(n) {
          return n.slice();
        }),
        index: 0
      })));
    }
    if (t == null && (t = { data: [], index: 0 }), l === null && (l = Qi(), ue.updateQueue = l), l.memoCache = t, l = t.data[t.index], l === void 0)
      for (l = t.data[t.index] = Array(e), a = 0; a < e; a++)
        l[a] = Vt;
    return t.index++, l;
  }
  function Ht(e, t) {
    return typeof t == "function" ? t(e) : t;
  }
  function Pn(e) {
    var t = De();
    return Li(t, ye, e);
  }
  function Li(e, t, l) {
    var a = e.queue;
    if (a === null) throw Error(f(311));
    a.lastRenderedReducer = l;
    var n = e.baseQueue, u = a.pending;
    if (u !== null) {
      if (n !== null) {
        var c = n.next;
        n.next = u.next, u.next = c;
      }
      t.baseQueue = n = u, a.pending = null;
    }
    if (u = e.baseState, n === null) e.memoizedState = u;
    else {
      t = n.next;
      var s = c = null, h = null, b = t, O = !1;
      do {
        var R = b.lane & -536870913;
        if (R !== b.lane ? (re & R) === R : (It & R) === R) {
          var x = b.revertLane;
          if (x === 0)
            h !== null && (h = h.next = {
              lane: 0,
              revertLane: 0,
              action: b.action,
              hasEagerState: b.hasEagerState,
              eagerState: b.eagerState,
              next: null
            }), R === Pl && (O = !0);
          else if ((It & x) === x) {
            b = b.next, x === Pl && (O = !0);
            continue;
          } else
            R = {
              lane: 0,
              revertLane: b.revertLane,
              action: b.action,
              hasEagerState: b.hasEagerState,
              eagerState: b.eagerState,
              next: null
            }, h === null ? (s = h = R, c = u) : h = h.next = R, ue.lanes |= x, il |= x;
          R = b.action, Dl && l(u, R), u = b.hasEagerState ? b.eagerState : l(u, R);
        } else
          x = {
            lane: R,
            revertLane: b.revertLane,
            action: b.action,
            hasEagerState: b.hasEagerState,
            eagerState: b.eagerState,
            next: null
          }, h === null ? (s = h = x, c = u) : h = h.next = x, ue.lanes |= R, il |= R;
        b = b.next;
      } while (b !== null && b !== t);
      if (h === null ? c = u : h.next = s, !tt(u, e.memoizedState) && (qe = !0, O && (l = Il, l !== null)))
        throw l;
      e.memoizedState = u, e.baseState = c, e.baseQueue = h, a.lastRenderedState = u;
    }
    return n === null && (a.lanes = 0), [e.memoizedState, a.dispatch];
  }
  function Vi(e) {
    var t = De(), l = t.queue;
    if (l === null) throw Error(f(311));
    l.lastRenderedReducer = e;
    var a = l.dispatch, n = l.pending, u = t.memoizedState;
    if (n !== null) {
      l.pending = null;
      var c = n = n.next;
      do
        u = e(u, c.action), c = c.next;
      while (c !== n);
      tt(u, t.memoizedState) || (qe = !0), t.memoizedState = u, t.baseQueue === null && (t.baseState = u), l.lastRenderedState = u;
    }
    return [u, a];
  }
  function Mr(e, t, l) {
    var a = ue, n = De(), u = oe;
    if (u) {
      if (l === void 0) throw Error(f(407));
      l = l();
    } else l = t();
    var c = !tt(
      (ye || n).memoizedState,
      l
    );
    c && (n.memoizedState = l, qe = !0), n = n.queue;
    var s = wr.bind(null, a, n, e);
    if (Ja(2048, 8, s, [e]), n.getSnapshot !== t || c || ze !== null && ze.memoizedState.tag & 1) {
      if (a.flags |= 2048, aa(
        9,
        In(),
        Rr.bind(
          null,
          a,
          n,
          l,
          t
        ),
        null
      ), je === null) throw Error(f(349));
      u || (It & 124) !== 0 || Ur(a, t, l);
    }
    return l;
  }
  function Ur(e, t, l) {
    e.flags |= 16384, e = { getSnapshot: t, value: l }, t = ue.updateQueue, t === null ? (t = Qi(), ue.updateQueue = t, t.stores = [e]) : (l = t.stores, l === null ? t.stores = [e] : l.push(e));
  }
  function Rr(e, t, l, a) {
    t.value = l, t.getSnapshot = a, Cr(t) && qr(e);
  }
  function wr(e, t, l) {
    return l(function() {
      Cr(t) && qr(e);
    });
  }
  function Cr(e) {
    var t = e.getSnapshot;
    e = e.value;
    try {
      var l = t();
      return !tt(e, l);
    } catch {
      return !0;
    }
  }
  function qr(e) {
    var t = kl(e, 2);
    t !== null && ct(t, e, 2);
  }
  function Ki(e) {
    var t = We();
    if (typeof e == "function") {
      var l = e;
      if (e = l(), Dl) {
        Kt(!0);
        try {
          l();
        } finally {
          Kt(!1);
        }
      }
    }
    return t.memoizedState = t.baseState = e, t.queue = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: Ht,
      lastRenderedState: e
    }, t;
  }
  function Hr(e, t, l, a) {
    return e.baseState = l, Li(
      e,
      ye,
      typeof a == "function" ? a : Ht
    );
  }
  function Zh(e, t, l, a, n) {
    if (tu(e)) throw Error(f(485));
    if (e = t.action, e !== null) {
      var u = {
        payload: n,
        action: e,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function(c) {
          u.listeners.push(c);
        }
      };
      D.T !== null ? l(!0) : u.isTransition = !1, a(u), l = t.pending, l === null ? (u.next = t.pending = u, Br(t, u)) : (u.next = l.next, t.pending = l.next = u);
    }
  }
  function Br(e, t) {
    var l = t.action, a = t.payload, n = e.state;
    if (t.isTransition) {
      var u = D.T, c = {};
      D.T = c;
      try {
        var s = l(n, a), h = D.S;
        h !== null && h(c, s), Yr(e, t, s);
      } catch (b) {
        Ji(e, t, b);
      } finally {
        D.T = u;
      }
    } else
      try {
        u = l(n, a), Yr(e, t, u);
      } catch (b) {
        Ji(e, t, b);
      }
  }
  function Yr(e, t, l) {
    l !== null && typeof l == "object" && typeof l.then == "function" ? l.then(
      function(a) {
        Gr(e, t, a);
      },
      function(a) {
        return Ji(e, t, a);
      }
    ) : Gr(e, t, l);
  }
  function Gr(e, t, l) {
    t.status = "fulfilled", t.value = l, Xr(t), e.state = l, t = e.pending, t !== null && (l = t.next, l === t ? e.pending = null : (l = l.next, t.next = l, Br(e, l)));
  }
  function Ji(e, t, l) {
    var a = e.pending;
    if (e.pending = null, a !== null) {
      a = a.next;
      do
        t.status = "rejected", t.reason = l, Xr(t), t = t.next;
      while (t !== a);
    }
    e.action = null;
  }
  function Xr(e) {
    e = e.listeners;
    for (var t = 0; t < e.length; t++) (0, e[t])();
  }
  function Qr(e, t) {
    return t;
  }
  function Zr(e, t) {
    if (oe) {
      var l = je.formState;
      if (l !== null) {
        e: {
          var a = ue;
          if (oe) {
            if (Ee) {
              t: {
                for (var n = Ee, u = _t; n.nodeType !== 8; ) {
                  if (!u) {
                    n = null;
                    break t;
                  }
                  if (n = jt(
                    n.nextSibling
                  ), n === null) {
                    n = null;
                    break t;
                  }
                }
                u = n.data, n = u === "F!" || u === "F" ? n : null;
              }
              if (n) {
                Ee = jt(
                  n.nextSibling
                ), a = n.data === "F!";
                break e;
              }
            }
            Tl(a);
          }
          a = !1;
        }
        a && (t = l[0]);
      }
    }
    return l = We(), l.memoizedState = l.baseState = t, a = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: Qr,
      lastRenderedState: t
    }, l.queue = a, l = rf.bind(
      null,
      ue,
      a
    ), a.dispatch = l, a = Ki(!1), u = Pi.bind(
      null,
      ue,
      !1,
      a.queue
    ), a = We(), n = {
      state: t,
      dispatch: null,
      action: e,
      pending: null
    }, a.queue = n, l = Zh.bind(
      null,
      ue,
      n,
      u,
      l
    ), n.dispatch = l, a.memoizedState = e, [t, l, !1];
  }
  function Lr(e) {
    var t = De();
    return Vr(t, ye, e);
  }
  function Vr(e, t, l) {
    if (t = Li(
      e,
      t,
      Qr
    )[0], e = Pn(Ht)[0], typeof t == "object" && t !== null && typeof t.then == "function")
      try {
        var a = Ka(t);
      } catch (c) {
        throw c === Ga ? Kn : c;
      }
    else a = t;
    t = De();
    var n = t.queue, u = n.dispatch;
    return l !== t.memoizedState && (ue.flags |= 2048, aa(
      9,
      In(),
      Lh.bind(null, n, l),
      null
    )), [a, u, e];
  }
  function Lh(e, t) {
    e.action = t;
  }
  function Kr(e) {
    var t = De(), l = ye;
    if (l !== null)
      return Vr(t, l, e);
    De(), t = t.memoizedState, l = De();
    var a = l.queue.dispatch;
    return l.memoizedState = e, [t, a, !1];
  }
  function aa(e, t, l, a) {
    return e = { tag: e, create: l, deps: a, inst: t, next: null }, t = ue.updateQueue, t === null && (t = Qi(), ue.updateQueue = t), l = t.lastEffect, l === null ? t.lastEffect = e.next = e : (a = l.next, l.next = e, e.next = a, t.lastEffect = e), e;
  }
  function In() {
    return { destroy: void 0, resource: void 0 };
  }
  function Jr() {
    return De().memoizedState;
  }
  function eu(e, t, l, a) {
    var n = We();
    a = a === void 0 ? null : a, ue.flags |= e, n.memoizedState = aa(
      1 | t,
      In(),
      l,
      a
    );
  }
  function Ja(e, t, l, a) {
    var n = De();
    a = a === void 0 ? null : a;
    var u = n.memoizedState.inst;
    ye !== null && a !== null && Hi(a, ye.memoizedState.deps) ? n.memoizedState = aa(t, u, l, a) : (ue.flags |= e, n.memoizedState = aa(
      1 | t,
      u,
      l,
      a
    ));
  }
  function kr(e, t) {
    eu(8390656, 8, e, t);
  }
  function $r(e, t) {
    Ja(2048, 8, e, t);
  }
  function Wr(e, t) {
    return Ja(4, 2, e, t);
  }
  function Fr(e, t) {
    return Ja(4, 4, e, t);
  }
  function Pr(e, t) {
    if (typeof t == "function") {
      e = e();
      var l = t(e);
      return function() {
        typeof l == "function" ? l() : t(null);
      };
    }
    if (t != null)
      return e = e(), t.current = e, function() {
        t.current = null;
      };
  }
  function Ir(e, t, l) {
    l = l != null ? l.concat([e]) : null, Ja(4, 4, Pr.bind(null, t, e), l);
  }
  function ki() {
  }
  function ef(e, t) {
    var l = De();
    t = t === void 0 ? null : t;
    var a = l.memoizedState;
    return t !== null && Hi(t, a[1]) ? a[0] : (l.memoizedState = [e, t], e);
  }
  function tf(e, t) {
    var l = De();
    t = t === void 0 ? null : t;
    var a = l.memoizedState;
    if (t !== null && Hi(t, a[1]))
      return a[0];
    if (a = e(), Dl) {
      Kt(!0);
      try {
        e();
      } finally {
        Kt(!1);
      }
    }
    return l.memoizedState = [a, t], a;
  }
  function $i(e, t, l) {
    return l === void 0 || (It & 1073741824) !== 0 ? e.memoizedState = t : (e.memoizedState = l, e = uo(), ue.lanes |= e, il |= e, l);
  }
  function lf(e, t, l, a) {
    return tt(l, t) ? l : ea.current !== null ? (e = $i(e, l, a), tt(e, t) || (qe = !0), e) : (It & 42) === 0 ? (qe = !0, e.memoizedState = l) : (e = uo(), ue.lanes |= e, il |= e, t);
  }
  function af(e, t, l, a, n) {
    var u = Y.p;
    Y.p = u !== 0 && 8 > u ? u : 8;
    var c = D.T, s = {};
    D.T = s, Pi(e, !1, t, l);
    try {
      var h = n(), b = D.S;
      if (b !== null && b(s, h), h !== null && typeof h == "object" && typeof h.then == "function") {
        var O = Gh(
          h,
          a
        );
        ka(
          e,
          t,
          O,
          it(e)
        );
      } else
        ka(
          e,
          t,
          a,
          it(e)
        );
    } catch (R) {
      ka(
        e,
        t,
        { then: function() {
        }, status: "rejected", reason: R },
        it()
      );
    } finally {
      Y.p = u, D.T = c;
    }
  }
  function Vh() {
  }
  function Wi(e, t, l, a) {
    if (e.tag !== 5) throw Error(f(476));
    var n = nf(e).queue;
    af(
      e,
      n,
      t,
      $,
      l === null ? Vh : function() {
        return uf(e), l(a);
      }
    );
  }
  function nf(e) {
    var t = e.memoizedState;
    if (t !== null) return t;
    t = {
      memoizedState: $,
      baseState: $,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Ht,
        lastRenderedState: $
      },
      next: null
    };
    var l = {};
    return t.next = {
      memoizedState: l,
      baseState: l,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Ht,
        lastRenderedState: l
      },
      next: null
    }, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
  }
  function uf(e) {
    var t = nf(e).next.queue;
    ka(e, t, {}, it());
  }
  function Fi() {
    return Le(hn);
  }
  function cf() {
    return De().memoizedState;
  }
  function sf() {
    return De().memoizedState;
  }
  function Kh(e) {
    for (var t = e.return; t !== null; ) {
      switch (t.tag) {
        case 24:
        case 3:
          var l = it();
          e = Ft(l);
          var a = Pt(t, e, l);
          a !== null && (ct(a, t, l), Qa(a, t, l)), t = { cache: Ai() }, e.payload = t;
          return;
      }
      t = t.return;
    }
  }
  function Jh(e, t, l) {
    var a = it();
    l = {
      lane: a,
      revertLane: 0,
      action: l,
      hasEagerState: !1,
      eagerState: null,
      next: null
    }, tu(e) ? ff(t, l) : (l = gi(e, t, l, a), l !== null && (ct(l, e, a), of(l, t, a)));
  }
  function rf(e, t, l) {
    var a = it();
    ka(e, t, l, a);
  }
  function ka(e, t, l, a) {
    var n = {
      lane: a,
      revertLane: 0,
      action: l,
      hasEagerState: !1,
      eagerState: null,
      next: null
    };
    if (tu(e)) ff(t, n);
    else {
      var u = e.alternate;
      if (e.lanes === 0 && (u === null || u.lanes === 0) && (u = t.lastRenderedReducer, u !== null))
        try {
          var c = t.lastRenderedState, s = u(c, l);
          if (n.hasEagerState = !0, n.eagerState = s, tt(s, c))
            return Bn(e, t, n, 0), je === null && Hn(), !1;
        } catch {
        } finally {
        }
      if (l = gi(e, t, n, a), l !== null)
        return ct(l, e, a), of(l, t, a), !0;
    }
    return !1;
  }
  function Pi(e, t, l, a) {
    if (a = {
      lane: 2,
      revertLane: Oc(),
      action: a,
      hasEagerState: !1,
      eagerState: null,
      next: null
    }, tu(e)) {
      if (t) throw Error(f(479));
    } else
      t = gi(
        e,
        l,
        a,
        2
      ), t !== null && ct(t, e, 2);
  }
  function tu(e) {
    var t = e.alternate;
    return e === ue || t !== null && t === ue;
  }
  function ff(e, t) {
    ta = $n = !0;
    var l = e.pending;
    l === null ? t.next = t : (t.next = l.next, l.next = t), e.pending = t;
  }
  function of(e, t, l) {
    if ((l & 4194048) !== 0) {
      var a = t.lanes;
      a &= e.pendingLanes, l |= a, t.lanes = l, bs(e, l);
    }
  }
  var lu = {
    readContext: Le,
    use: Fn,
    useCallback: Ne,
    useContext: Ne,
    useEffect: Ne,
    useImperativeHandle: Ne,
    useLayoutEffect: Ne,
    useInsertionEffect: Ne,
    useMemo: Ne,
    useReducer: Ne,
    useRef: Ne,
    useState: Ne,
    useDebugValue: Ne,
    useDeferredValue: Ne,
    useTransition: Ne,
    useSyncExternalStore: Ne,
    useId: Ne,
    useHostTransitionStatus: Ne,
    useFormState: Ne,
    useActionState: Ne,
    useOptimistic: Ne,
    useMemoCache: Ne,
    useCacheRefresh: Ne
  }, df = {
    readContext: Le,
    use: Fn,
    useCallback: function(e, t) {
      return We().memoizedState = [
        e,
        t === void 0 ? null : t
      ], e;
    },
    useContext: Le,
    useEffect: kr,
    useImperativeHandle: function(e, t, l) {
      l = l != null ? l.concat([e]) : null, eu(
        4194308,
        4,
        Pr.bind(null, t, e),
        l
      );
    },
    useLayoutEffect: function(e, t) {
      return eu(4194308, 4, e, t);
    },
    useInsertionEffect: function(e, t) {
      eu(4, 2, e, t);
    },
    useMemo: function(e, t) {
      var l = We();
      t = t === void 0 ? null : t;
      var a = e();
      if (Dl) {
        Kt(!0);
        try {
          e();
        } finally {
          Kt(!1);
        }
      }
      return l.memoizedState = [a, t], a;
    },
    useReducer: function(e, t, l) {
      var a = We();
      if (l !== void 0) {
        var n = l(t);
        if (Dl) {
          Kt(!0);
          try {
            l(t);
          } finally {
            Kt(!1);
          }
        }
      } else n = t;
      return a.memoizedState = a.baseState = n, e = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: e,
        lastRenderedState: n
      }, a.queue = e, e = e.dispatch = Jh.bind(
        null,
        ue,
        e
      ), [a.memoizedState, e];
    },
    useRef: function(e) {
      var t = We();
      return e = { current: e }, t.memoizedState = e;
    },
    useState: function(e) {
      e = Ki(e);
      var t = e.queue, l = rf.bind(null, ue, t);
      return t.dispatch = l, [e.memoizedState, l];
    },
    useDebugValue: ki,
    useDeferredValue: function(e, t) {
      var l = We();
      return $i(l, e, t);
    },
    useTransition: function() {
      var e = Ki(!1);
      return e = af.bind(
        null,
        ue,
        e.queue,
        !0,
        !1
      ), We().memoizedState = e, [!1, e];
    },
    useSyncExternalStore: function(e, t, l) {
      var a = ue, n = We();
      if (oe) {
        if (l === void 0)
          throw Error(f(407));
        l = l();
      } else {
        if (l = t(), je === null)
          throw Error(f(349));
        (re & 124) !== 0 || Ur(a, t, l);
      }
      n.memoizedState = l;
      var u = { value: l, getSnapshot: t };
      return n.queue = u, kr(wr.bind(null, a, u, e), [
        e
      ]), a.flags |= 2048, aa(
        9,
        In(),
        Rr.bind(
          null,
          a,
          u,
          l,
          t
        ),
        null
      ), l;
    },
    useId: function() {
      var e = We(), t = je.identifierPrefix;
      if (oe) {
        var l = wt, a = Rt;
        l = (a & ~(1 << 32 - et(a) - 1)).toString(32) + l, t = "«" + t + "R" + l, l = Wn++, 0 < l && (t += "H" + l.toString(32)), t += "»";
      } else
        l = Xh++, t = "«" + t + "r" + l.toString(32) + "»";
      return e.memoizedState = t;
    },
    useHostTransitionStatus: Fi,
    useFormState: Zr,
    useActionState: Zr,
    useOptimistic: function(e) {
      var t = We();
      t.memoizedState = t.baseState = e;
      var l = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: null,
        lastRenderedState: null
      };
      return t.queue = l, t = Pi.bind(
        null,
        ue,
        !0,
        l
      ), l.dispatch = t, [e, t];
    },
    useMemoCache: Zi,
    useCacheRefresh: function() {
      return We().memoizedState = Kh.bind(
        null,
        ue
      );
    }
  }, hf = {
    readContext: Le,
    use: Fn,
    useCallback: ef,
    useContext: Le,
    useEffect: $r,
    useImperativeHandle: Ir,
    useInsertionEffect: Wr,
    useLayoutEffect: Fr,
    useMemo: tf,
    useReducer: Pn,
    useRef: Jr,
    useState: function() {
      return Pn(Ht);
    },
    useDebugValue: ki,
    useDeferredValue: function(e, t) {
      var l = De();
      return lf(
        l,
        ye.memoizedState,
        e,
        t
      );
    },
    useTransition: function() {
      var e = Pn(Ht)[0], t = De().memoizedState;
      return [
        typeof e == "boolean" ? e : Ka(e),
        t
      ];
    },
    useSyncExternalStore: Mr,
    useId: cf,
    useHostTransitionStatus: Fi,
    useFormState: Lr,
    useActionState: Lr,
    useOptimistic: function(e, t) {
      var l = De();
      return Hr(l, ye, e, t);
    },
    useMemoCache: Zi,
    useCacheRefresh: sf
  }, kh = {
    readContext: Le,
    use: Fn,
    useCallback: ef,
    useContext: Le,
    useEffect: $r,
    useImperativeHandle: Ir,
    useInsertionEffect: Wr,
    useLayoutEffect: Fr,
    useMemo: tf,
    useReducer: Vi,
    useRef: Jr,
    useState: function() {
      return Vi(Ht);
    },
    useDebugValue: ki,
    useDeferredValue: function(e, t) {
      var l = De();
      return ye === null ? $i(l, e, t) : lf(
        l,
        ye.memoizedState,
        e,
        t
      );
    },
    useTransition: function() {
      var e = Vi(Ht)[0], t = De().memoizedState;
      return [
        typeof e == "boolean" ? e : Ka(e),
        t
      ];
    },
    useSyncExternalStore: Mr,
    useId: cf,
    useHostTransitionStatus: Fi,
    useFormState: Kr,
    useActionState: Kr,
    useOptimistic: function(e, t) {
      var l = De();
      return ye !== null ? Hr(l, ye, e, t) : (l.baseState = e, [e, l.queue.dispatch]);
    },
    useMemoCache: Zi,
    useCacheRefresh: sf
  }, na = null, $a = 0;
  function au(e) {
    var t = $a;
    return $a += 1, na === null && (na = []), _r(na, e, t);
  }
  function Wa(e, t) {
    t = t.props.ref, e.ref = t !== void 0 ? t : null;
  }
  function nu(e, t) {
    throw t.$$typeof === _ ? Error(f(525)) : (e = Object.prototype.toString.call(t), Error(
      f(
        31,
        e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e
      )
    ));
  }
  function mf(e) {
    var t = e._init;
    return t(e._payload);
  }
  function vf(e) {
    function t(y, v) {
      if (e) {
        var g = y.deletions;
        g === null ? (y.deletions = [v], y.flags |= 16) : g.push(v);
      }
    }
    function l(y, v) {
      if (!e) return null;
      for (; v !== null; )
        t(y, v), v = v.sibling;
      return null;
    }
    function a(y) {
      for (var v = /* @__PURE__ */ new Map(); y !== null; )
        y.key !== null ? v.set(y.key, y) : v.set(y.index, y), y = y.sibling;
      return v;
    }
    function n(y, v) {
      return y = Ut(y, v), y.index = 0, y.sibling = null, y;
    }
    function u(y, v, g) {
      return y.index = g, e ? (g = y.alternate, g !== null ? (g = g.index, g < v ? (y.flags |= 67108866, v) : g) : (y.flags |= 67108866, v)) : (y.flags |= 1048576, v);
    }
    function c(y) {
      return e && y.alternate === null && (y.flags |= 67108866), y;
    }
    function s(y, v, g, M) {
      return v === null || v.tag !== 6 ? (v = pi(g, y.mode, M), v.return = y, v) : (v = n(v, g), v.return = y, v);
    }
    function h(y, v, g, M) {
      var X = g.type;
      return X === B ? O(
        y,
        v,
        g.props.children,
        M,
        g.key
      ) : v !== null && (v.elementType === X || typeof X == "object" && X !== null && X.$$typeof === Se && mf(X) === v.type) ? (v = n(v, g.props), Wa(v, g), v.return = y, v) : (v = Gn(
        g.type,
        g.key,
        g.props,
        null,
        y.mode,
        M
      ), Wa(v, g), v.return = y, v);
    }
    function b(y, v, g, M) {
      return v === null || v.tag !== 4 || v.stateNode.containerInfo !== g.containerInfo || v.stateNode.implementation !== g.implementation ? (v = ji(g, y.mode, M), v.return = y, v) : (v = n(v, g.children || []), v.return = y, v);
    }
    function O(y, v, g, M, X) {
      return v === null || v.tag !== 7 ? (v = xl(
        g,
        y.mode,
        M,
        X
      ), v.return = y, v) : (v = n(v, g), v.return = y, v);
    }
    function R(y, v, g) {
      if (typeof v == "string" && v !== "" || typeof v == "number" || typeof v == "bigint")
        return v = pi(
          "" + v,
          y.mode,
          g
        ), v.return = y, v;
      if (typeof v == "object" && v !== null) {
        switch (v.$$typeof) {
          case q:
            return g = Gn(
              v.type,
              v.key,
              v.props,
              null,
              y.mode,
              g
            ), Wa(g, v), g.return = y, g;
          case le:
            return v = ji(
              v,
              y.mode,
              g
            ), v.return = y, v;
          case Se:
            var M = v._init;
            return v = M(v._payload), R(y, v, g);
        }
        if (we(v) || Re(v))
          return v = xl(
            v,
            y.mode,
            g,
            null
          ), v.return = y, v;
        if (typeof v.then == "function")
          return R(y, au(v), g);
        if (v.$$typeof === V)
          return R(
            y,
            Ln(y, v),
            g
          );
        nu(y, v);
      }
      return null;
    }
    function x(y, v, g, M) {
      var X = v !== null ? v.key : null;
      if (typeof g == "string" && g !== "" || typeof g == "number" || typeof g == "bigint")
        return X !== null ? null : s(y, v, "" + g, M);
      if (typeof g == "object" && g !== null) {
        switch (g.$$typeof) {
          case q:
            return g.key === X ? h(y, v, g, M) : null;
          case le:
            return g.key === X ? b(y, v, g, M) : null;
          case Se:
            return X = g._init, g = X(g._payload), x(y, v, g, M);
        }
        if (we(g) || Re(g))
          return X !== null ? null : O(y, v, g, M, null);
        if (typeof g.then == "function")
          return x(
            y,
            v,
            au(g),
            M
          );
        if (g.$$typeof === V)
          return x(
            y,
            v,
            Ln(y, g),
            M
          );
        nu(y, g);
      }
      return null;
    }
    function S(y, v, g, M, X) {
      if (typeof M == "string" && M !== "" || typeof M == "number" || typeof M == "bigint")
        return y = y.get(g) || null, s(v, y, "" + M, X);
      if (typeof M == "object" && M !== null) {
        switch (M.$$typeof) {
          case q:
            return y = y.get(
              M.key === null ? g : M.key
            ) || null, h(v, y, M, X);
          case le:
            return y = y.get(
              M.key === null ? g : M.key
            ) || null, b(v, y, M, X);
          case Se:
            var ie = M._init;
            return M = ie(M._payload), S(
              y,
              v,
              g,
              M,
              X
            );
        }
        if (we(M) || Re(M))
          return y = y.get(g) || null, O(v, y, M, X, null);
        if (typeof M.then == "function")
          return S(
            y,
            v,
            g,
            au(M),
            X
          );
        if (M.$$typeof === V)
          return S(
            y,
            v,
            g,
            Ln(v, M),
            X
          );
        nu(v, M);
      }
      return null;
    }
    function ee(y, v, g, M) {
      for (var X = null, ie = null, J = v, F = v = 0, Be = null; J !== null && F < g.length; F++) {
        J.index > F ? (Be = J, J = null) : Be = J.sibling;
        var fe = x(
          y,
          J,
          g[F],
          M
        );
        if (fe === null) {
          J === null && (J = Be);
          break;
        }
        e && J && fe.alternate === null && t(y, J), v = u(fe, v, F), ie === null ? X = fe : ie.sibling = fe, ie = fe, J = Be;
      }
      if (F === g.length)
        return l(y, J), oe && _l(y, F), X;
      if (J === null) {
        for (; F < g.length; F++)
          J = R(y, g[F], M), J !== null && (v = u(
            J,
            v,
            F
          ), ie === null ? X = J : ie.sibling = J, ie = J);
        return oe && _l(y, F), X;
      }
      for (J = a(J); F < g.length; F++)
        Be = S(
          J,
          y,
          F,
          g[F],
          M
        ), Be !== null && (e && Be.alternate !== null && J.delete(
          Be.key === null ? F : Be.key
        ), v = u(
          Be,
          v,
          F
        ), ie === null ? X = Be : ie.sibling = Be, ie = Be);
      return e && J.forEach(function(vl) {
        return t(y, vl);
      }), oe && _l(y, F), X;
    }
    function W(y, v, g, M) {
      if (g == null) throw Error(f(151));
      for (var X = null, ie = null, J = v, F = v = 0, Be = null, fe = g.next(); J !== null && !fe.done; F++, fe = g.next()) {
        J.index > F ? (Be = J, J = null) : Be = J.sibling;
        var vl = x(y, J, fe.value, M);
        if (vl === null) {
          J === null && (J = Be);
          break;
        }
        e && J && vl.alternate === null && t(y, J), v = u(vl, v, F), ie === null ? X = vl : ie.sibling = vl, ie = vl, J = Be;
      }
      if (fe.done)
        return l(y, J), oe && _l(y, F), X;
      if (J === null) {
        for (; !fe.done; F++, fe = g.next())
          fe = R(y, fe.value, M), fe !== null && (v = u(fe, v, F), ie === null ? X = fe : ie.sibling = fe, ie = fe);
        return oe && _l(y, F), X;
      }
      for (J = a(J); !fe.done; F++, fe = g.next())
        fe = S(J, y, F, fe.value, M), fe !== null && (e && fe.alternate !== null && J.delete(fe.key === null ? F : fe.key), v = u(fe, v, F), ie === null ? X = fe : ie.sibling = fe, ie = fe);
      return e && J.forEach(function($m) {
        return t(y, $m);
      }), oe && _l(y, F), X;
    }
    function be(y, v, g, M) {
      if (typeof g == "object" && g !== null && g.type === B && g.key === null && (g = g.props.children), typeof g == "object" && g !== null) {
        switch (g.$$typeof) {
          case q:
            e: {
              for (var X = g.key; v !== null; ) {
                if (v.key === X) {
                  if (X = g.type, X === B) {
                    if (v.tag === 7) {
                      l(
                        y,
                        v.sibling
                      ), M = n(
                        v,
                        g.props.children
                      ), M.return = y, y = M;
                      break e;
                    }
                  } else if (v.elementType === X || typeof X == "object" && X !== null && X.$$typeof === Se && mf(X) === v.type) {
                    l(
                      y,
                      v.sibling
                    ), M = n(v, g.props), Wa(M, g), M.return = y, y = M;
                    break e;
                  }
                  l(y, v);
                  break;
                } else t(y, v);
                v = v.sibling;
              }
              g.type === B ? (M = xl(
                g.props.children,
                y.mode,
                M,
                g.key
              ), M.return = y, y = M) : (M = Gn(
                g.type,
                g.key,
                g.props,
                null,
                y.mode,
                M
              ), Wa(M, g), M.return = y, y = M);
            }
            return c(y);
          case le:
            e: {
              for (X = g.key; v !== null; ) {
                if (v.key === X)
                  if (v.tag === 4 && v.stateNode.containerInfo === g.containerInfo && v.stateNode.implementation === g.implementation) {
                    l(
                      y,
                      v.sibling
                    ), M = n(v, g.children || []), M.return = y, y = M;
                    break e;
                  } else {
                    l(y, v);
                    break;
                  }
                else t(y, v);
                v = v.sibling;
              }
              M = ji(g, y.mode, M), M.return = y, y = M;
            }
            return c(y);
          case Se:
            return X = g._init, g = X(g._payload), be(
              y,
              v,
              g,
              M
            );
        }
        if (we(g))
          return ee(
            y,
            v,
            g,
            M
          );
        if (Re(g)) {
          if (X = Re(g), typeof X != "function") throw Error(f(150));
          return g = X.call(g), W(
            y,
            v,
            g,
            M
          );
        }
        if (typeof g.then == "function")
          return be(
            y,
            v,
            au(g),
            M
          );
        if (g.$$typeof === V)
          return be(
            y,
            v,
            Ln(y, g),
            M
          );
        nu(y, g);
      }
      return typeof g == "string" && g !== "" || typeof g == "number" || typeof g == "bigint" ? (g = "" + g, v !== null && v.tag === 6 ? (l(y, v.sibling), M = n(v, g), M.return = y, y = M) : (l(y, v), M = pi(g, y.mode, M), M.return = y, y = M), c(y)) : l(y, v);
    }
    return function(y, v, g, M) {
      try {
        $a = 0;
        var X = be(
          y,
          v,
          g,
          M
        );
        return na = null, X;
      } catch (J) {
        if (J === Ga || J === Kn) throw J;
        var ie = lt(29, J, null, y.mode);
        return ie.lanes = M, ie.return = y, ie;
      } finally {
      }
    };
  }
  var ua = vf(!0), yf = vf(!1), vt = N(null), Et = null;
  function el(e) {
    var t = e.alternate;
    H(Ue, Ue.current & 1), H(vt, e), Et === null && (t === null || ea.current !== null || t.memoizedState !== null) && (Et = e);
  }
  function gf(e) {
    if (e.tag === 22) {
      if (H(Ue, Ue.current), H(vt, e), Et === null) {
        var t = e.alternate;
        t !== null && t.memoizedState !== null && (Et = e);
      }
    } else tl();
  }
  function tl() {
    H(Ue, Ue.current), H(vt, vt.current);
  }
  function Bt(e) {
    C(vt), Et === e && (Et = null), C(Ue);
  }
  var Ue = N(0);
  function uu(e) {
    for (var t = e; t !== null; ) {
      if (t.tag === 13) {
        var l = t.memoizedState;
        if (l !== null && (l = l.dehydrated, l === null || l.data === "$?" || Qc(l)))
          return t;
      } else if (t.tag === 19 && t.memoizedProps.revealOrder !== void 0) {
        if ((t.flags & 128) !== 0) return t;
      } else if (t.child !== null) {
        t.child.return = t, t = t.child;
        continue;
      }
      if (t === e) break;
      for (; t.sibling === null; ) {
        if (t.return === null || t.return === e) return null;
        t = t.return;
      }
      t.sibling.return = t.return, t = t.sibling;
    }
    return null;
  }
  function Ii(e, t, l, a) {
    t = e.memoizedState, l = l(a, t), l = l == null ? t : A({}, t, l), e.memoizedState = l, e.lanes === 0 && (e.updateQueue.baseState = l);
  }
  var ec = {
    enqueueSetState: function(e, t, l) {
      e = e._reactInternals;
      var a = it(), n = Ft(a);
      n.payload = t, l != null && (n.callback = l), t = Pt(e, n, a), t !== null && (ct(t, e, a), Qa(t, e, a));
    },
    enqueueReplaceState: function(e, t, l) {
      e = e._reactInternals;
      var a = it(), n = Ft(a);
      n.tag = 1, n.payload = t, l != null && (n.callback = l), t = Pt(e, n, a), t !== null && (ct(t, e, a), Qa(t, e, a));
    },
    enqueueForceUpdate: function(e, t) {
      e = e._reactInternals;
      var l = it(), a = Ft(l);
      a.tag = 2, t != null && (a.callback = t), t = Pt(e, a, l), t !== null && (ct(t, e, l), Qa(t, e, l));
    }
  };
  function bf(e, t, l, a, n, u, c) {
    return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(a, u, c) : t.prototype && t.prototype.isPureReactComponent ? !Ua(l, a) || !Ua(n, u) : !0;
  }
  function pf(e, t, l, a) {
    e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(l, a), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(l, a), t.state !== e && ec.enqueueReplaceState(t, t.state, null);
  }
  function Ol(e, t) {
    var l = t;
    if ("ref" in t) {
      l = {};
      for (var a in t)
        a !== "ref" && (l[a] = t[a]);
    }
    if (e = e.defaultProps) {
      l === t && (l = A({}, l));
      for (var n in e)
        l[n] === void 0 && (l[n] = e[n]);
    }
    return l;
  }
  var iu = typeof reportError == "function" ? reportError : function(e) {
    if (typeof window == "object" && typeof window.ErrorEvent == "function") {
      var t = new window.ErrorEvent("error", {
        bubbles: !0,
        cancelable: !0,
        message: typeof e == "object" && e !== null && typeof e.message == "string" ? String(e.message) : String(e),
        error: e
      });
      if (!window.dispatchEvent(t)) return;
    } else if (typeof process == "object" && typeof process.emit == "function") {
      process.emit("uncaughtException", e);
      return;
    }
    console.error(e);
  };
  function jf(e) {
    iu(e);
  }
  function xf(e) {
    console.error(e);
  }
  function Sf(e) {
    iu(e);
  }
  function cu(e, t) {
    try {
      var l = e.onUncaughtError;
      l(t.value, { componentStack: t.stack });
    } catch (a) {
      setTimeout(function() {
        throw a;
      });
    }
  }
  function _f(e, t, l) {
    try {
      var a = e.onCaughtError;
      a(l.value, {
        componentStack: l.stack,
        errorBoundary: t.tag === 1 ? t.stateNode : null
      });
    } catch (n) {
      setTimeout(function() {
        throw n;
      });
    }
  }
  function tc(e, t, l) {
    return l = Ft(l), l.tag = 3, l.payload = { element: null }, l.callback = function() {
      cu(e, t);
    }, l;
  }
  function Ef(e) {
    return e = Ft(e), e.tag = 3, e;
  }
  function Tf(e, t, l, a) {
    var n = l.type.getDerivedStateFromError;
    if (typeof n == "function") {
      var u = a.value;
      e.payload = function() {
        return n(u);
      }, e.callback = function() {
        _f(t, l, a);
      };
    }
    var c = l.stateNode;
    c !== null && typeof c.componentDidCatch == "function" && (e.callback = function() {
      _f(t, l, a), typeof n != "function" && (cl === null ? cl = /* @__PURE__ */ new Set([this]) : cl.add(this));
      var s = a.stack;
      this.componentDidCatch(a.value, {
        componentStack: s !== null ? s : ""
      });
    });
  }
  function $h(e, t, l, a, n) {
    if (l.flags |= 32768, a !== null && typeof a == "object" && typeof a.then == "function") {
      if (t = l.alternate, t !== null && Ha(
        t,
        l,
        n,
        !0
      ), l = vt.current, l !== null) {
        switch (l.tag) {
          case 13:
            return Et === null ? Tc() : l.alternate === null && Te === 0 && (Te = 3), l.flags &= -257, l.flags |= 65536, l.lanes = n, a === Oi ? l.flags |= 16384 : (t = l.updateQueue, t === null ? l.updateQueue = /* @__PURE__ */ new Set([a]) : t.add(a), Ac(e, a, n)), !1;
          case 22:
            return l.flags |= 65536, a === Oi ? l.flags |= 16384 : (t = l.updateQueue, t === null ? (t = {
              transitions: null,
              markerInstances: null,
              retryQueue: /* @__PURE__ */ new Set([a])
            }, l.updateQueue = t) : (l = t.retryQueue, l === null ? t.retryQueue = /* @__PURE__ */ new Set([a]) : l.add(a)), Ac(e, a, n)), !1;
        }
        throw Error(f(435, l.tag));
      }
      return Ac(e, a, n), Tc(), !1;
    }
    if (oe)
      return t = vt.current, t !== null ? ((t.flags & 65536) === 0 && (t.flags |= 256), t.flags |= 65536, t.lanes = n, a !== _i && (e = Error(f(422), { cause: a }), qa(ot(e, l)))) : (a !== _i && (t = Error(f(423), {
        cause: a
      }), qa(
        ot(t, l)
      )), e = e.current.alternate, e.flags |= 65536, n &= -n, e.lanes |= n, a = ot(a, l), n = tc(
        e.stateNode,
        a,
        n
      ), Ri(e, n), Te !== 4 && (Te = 2)), !1;
    var u = Error(f(520), { cause: a });
    if (u = ot(u, l), an === null ? an = [u] : an.push(u), Te !== 4 && (Te = 2), t === null) return !0;
    a = ot(a, l), l = t;
    do {
      switch (l.tag) {
        case 3:
          return l.flags |= 65536, e = n & -n, l.lanes |= e, e = tc(l.stateNode, a, e), Ri(l, e), !1;
        case 1:
          if (t = l.type, u = l.stateNode, (l.flags & 128) === 0 && (typeof t.getDerivedStateFromError == "function" || u !== null && typeof u.componentDidCatch == "function" && (cl === null || !cl.has(u))))
            return l.flags |= 65536, n &= -n, l.lanes |= n, n = Ef(n), Tf(
              n,
              e,
              l,
              a
            ), Ri(l, n), !1;
      }
      l = l.return;
    } while (l !== null);
    return !1;
  }
  var Nf = Error(f(461)), qe = !1;
  function Ge(e, t, l, a) {
    t.child = e === null ? yf(t, null, l, a) : ua(
      t,
      e.child,
      l,
      a
    );
  }
  function Af(e, t, l, a, n) {
    l = l.render;
    var u = t.ref;
    if ("ref" in a) {
      var c = {};
      for (var s in a)
        s !== "ref" && (c[s] = a[s]);
    } else c = a;
    return Al(t), a = Bi(
      e,
      t,
      l,
      c,
      u,
      n
    ), s = Yi(), e !== null && !qe ? (Gi(e, t, n), Yt(e, t, n)) : (oe && s && xi(t), t.flags |= 1, Ge(e, t, a, n), t.child);
  }
  function zf(e, t, l, a, n) {
    if (e === null) {
      var u = l.type;
      return typeof u == "function" && !bi(u) && u.defaultProps === void 0 && l.compare === null ? (t.tag = 15, t.type = u, Df(
        e,
        t,
        u,
        a,
        n
      )) : (e = Gn(
        l.type,
        null,
        a,
        t,
        t.mode,
        n
      ), e.ref = t.ref, e.return = t, t.child = e);
    }
    if (u = e.child, !rc(e, n)) {
      var c = u.memoizedProps;
      if (l = l.compare, l = l !== null ? l : Ua, l(c, a) && e.ref === t.ref)
        return Yt(e, t, n);
    }
    return t.flags |= 1, e = Ut(u, a), e.ref = t.ref, e.return = t, t.child = e;
  }
  function Df(e, t, l, a, n) {
    if (e !== null) {
      var u = e.memoizedProps;
      if (Ua(u, a) && e.ref === t.ref)
        if (qe = !1, t.pendingProps = a = u, rc(e, n))
          (e.flags & 131072) !== 0 && (qe = !0);
        else
          return t.lanes = e.lanes, Yt(e, t, n);
    }
    return lc(
      e,
      t,
      l,
      a,
      n
    );
  }
  function Of(e, t, l) {
    var a = t.pendingProps, n = a.children, u = e !== null ? e.memoizedState : null;
    if (a.mode === "hidden") {
      if ((t.flags & 128) !== 0) {
        if (a = u !== null ? u.baseLanes | l : l, e !== null) {
          for (n = t.child = e.child, u = 0; n !== null; )
            u = u | n.lanes | n.childLanes, n = n.sibling;
          t.childLanes = u & ~a;
        } else t.childLanes = 0, t.child = null;
        return Mf(
          e,
          t,
          a,
          l
        );
      }
      if ((l & 536870912) !== 0)
        t.memoizedState = { baseLanes: 0, cachePool: null }, e !== null && Vn(
          t,
          u !== null ? u.cachePool : null
        ), u !== null ? zr(t, u) : Ci(), gf(t);
      else
        return t.lanes = t.childLanes = 536870912, Mf(
          e,
          t,
          u !== null ? u.baseLanes | l : l,
          l
        );
    } else
      u !== null ? (Vn(t, u.cachePool), zr(t, u), tl(), t.memoizedState = null) : (e !== null && Vn(t, null), Ci(), tl());
    return Ge(e, t, n, l), t.child;
  }
  function Mf(e, t, l, a) {
    var n = Di();
    return n = n === null ? null : { parent: Me._currentValue, pool: n }, t.memoizedState = {
      baseLanes: l,
      cachePool: n
    }, e !== null && Vn(t, null), Ci(), gf(t), e !== null && Ha(e, t, a, !0), null;
  }
  function su(e, t) {
    var l = t.ref;
    if (l === null)
      e !== null && e.ref !== null && (t.flags |= 4194816);
    else {
      if (typeof l != "function" && typeof l != "object")
        throw Error(f(284));
      (e === null || e.ref !== l) && (t.flags |= 4194816);
    }
  }
  function lc(e, t, l, a, n) {
    return Al(t), l = Bi(
      e,
      t,
      l,
      a,
      void 0,
      n
    ), a = Yi(), e !== null && !qe ? (Gi(e, t, n), Yt(e, t, n)) : (oe && a && xi(t), t.flags |= 1, Ge(e, t, l, n), t.child);
  }
  function Uf(e, t, l, a, n, u) {
    return Al(t), t.updateQueue = null, l = Or(
      t,
      a,
      l,
      n
    ), Dr(e), a = Yi(), e !== null && !qe ? (Gi(e, t, u), Yt(e, t, u)) : (oe && a && xi(t), t.flags |= 1, Ge(e, t, l, u), t.child);
  }
  function Rf(e, t, l, a, n) {
    if (Al(t), t.stateNode === null) {
      var u = $l, c = l.contextType;
      typeof c == "object" && c !== null && (u = Le(c)), u = new l(a, u), t.memoizedState = u.state !== null && u.state !== void 0 ? u.state : null, u.updater = ec, t.stateNode = u, u._reactInternals = t, u = t.stateNode, u.props = a, u.state = t.memoizedState, u.refs = {}, Mi(t), c = l.contextType, u.context = typeof c == "object" && c !== null ? Le(c) : $l, u.state = t.memoizedState, c = l.getDerivedStateFromProps, typeof c == "function" && (Ii(
        t,
        l,
        c,
        a
      ), u.state = t.memoizedState), typeof l.getDerivedStateFromProps == "function" || typeof u.getSnapshotBeforeUpdate == "function" || typeof u.UNSAFE_componentWillMount != "function" && typeof u.componentWillMount != "function" || (c = u.state, typeof u.componentWillMount == "function" && u.componentWillMount(), typeof u.UNSAFE_componentWillMount == "function" && u.UNSAFE_componentWillMount(), c !== u.state && ec.enqueueReplaceState(u, u.state, null), La(t, a, u, n), Za(), u.state = t.memoizedState), typeof u.componentDidMount == "function" && (t.flags |= 4194308), a = !0;
    } else if (e === null) {
      u = t.stateNode;
      var s = t.memoizedProps, h = Ol(l, s);
      u.props = h;
      var b = u.context, O = l.contextType;
      c = $l, typeof O == "object" && O !== null && (c = Le(O));
      var R = l.getDerivedStateFromProps;
      O = typeof R == "function" || typeof u.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, O || typeof u.UNSAFE_componentWillReceiveProps != "function" && typeof u.componentWillReceiveProps != "function" || (s || b !== c) && pf(
        t,
        u,
        a,
        c
      ), Wt = !1;
      var x = t.memoizedState;
      u.state = x, La(t, a, u, n), Za(), b = t.memoizedState, s || x !== b || Wt ? (typeof R == "function" && (Ii(
        t,
        l,
        R,
        a
      ), b = t.memoizedState), (h = Wt || bf(
        t,
        l,
        h,
        a,
        x,
        b,
        c
      )) ? (O || typeof u.UNSAFE_componentWillMount != "function" && typeof u.componentWillMount != "function" || (typeof u.componentWillMount == "function" && u.componentWillMount(), typeof u.UNSAFE_componentWillMount == "function" && u.UNSAFE_componentWillMount()), typeof u.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof u.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = a, t.memoizedState = b), u.props = a, u.state = b, u.context = c, a = h) : (typeof u.componentDidMount == "function" && (t.flags |= 4194308), a = !1);
    } else {
      u = t.stateNode, Ui(e, t), c = t.memoizedProps, O = Ol(l, c), u.props = O, R = t.pendingProps, x = u.context, b = l.contextType, h = $l, typeof b == "object" && b !== null && (h = Le(b)), s = l.getDerivedStateFromProps, (b = typeof s == "function" || typeof u.getSnapshotBeforeUpdate == "function") || typeof u.UNSAFE_componentWillReceiveProps != "function" && typeof u.componentWillReceiveProps != "function" || (c !== R || x !== h) && pf(
        t,
        u,
        a,
        h
      ), Wt = !1, x = t.memoizedState, u.state = x, La(t, a, u, n), Za();
      var S = t.memoizedState;
      c !== R || x !== S || Wt || e !== null && e.dependencies !== null && Zn(e.dependencies) ? (typeof s == "function" && (Ii(
        t,
        l,
        s,
        a
      ), S = t.memoizedState), (O = Wt || bf(
        t,
        l,
        O,
        a,
        x,
        S,
        h
      ) || e !== null && e.dependencies !== null && Zn(e.dependencies)) ? (b || typeof u.UNSAFE_componentWillUpdate != "function" && typeof u.componentWillUpdate != "function" || (typeof u.componentWillUpdate == "function" && u.componentWillUpdate(a, S, h), typeof u.UNSAFE_componentWillUpdate == "function" && u.UNSAFE_componentWillUpdate(
        a,
        S,
        h
      )), typeof u.componentDidUpdate == "function" && (t.flags |= 4), typeof u.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof u.componentDidUpdate != "function" || c === e.memoizedProps && x === e.memoizedState || (t.flags |= 4), typeof u.getSnapshotBeforeUpdate != "function" || c === e.memoizedProps && x === e.memoizedState || (t.flags |= 1024), t.memoizedProps = a, t.memoizedState = S), u.props = a, u.state = S, u.context = h, a = O) : (typeof u.componentDidUpdate != "function" || c === e.memoizedProps && x === e.memoizedState || (t.flags |= 4), typeof u.getSnapshotBeforeUpdate != "function" || c === e.memoizedProps && x === e.memoizedState || (t.flags |= 1024), a = !1);
    }
    return u = a, su(e, t), a = (t.flags & 128) !== 0, u || a ? (u = t.stateNode, l = a && typeof l.getDerivedStateFromError != "function" ? null : u.render(), t.flags |= 1, e !== null && a ? (t.child = ua(
      t,
      e.child,
      null,
      n
    ), t.child = ua(
      t,
      null,
      l,
      n
    )) : Ge(e, t, l, n), t.memoizedState = u.state, e = t.child) : e = Yt(
      e,
      t,
      n
    ), e;
  }
  function wf(e, t, l, a) {
    return Ca(), t.flags |= 256, Ge(e, t, l, a), t.child;
  }
  var ac = {
    dehydrated: null,
    treeContext: null,
    retryLane: 0,
    hydrationErrors: null
  };
  function nc(e) {
    return { baseLanes: e, cachePool: jr() };
  }
  function uc(e, t, l) {
    return e = e !== null ? e.childLanes & ~l : 0, t && (e |= yt), e;
  }
  function Cf(e, t, l) {
    var a = t.pendingProps, n = !1, u = (t.flags & 128) !== 0, c;
    if ((c = u) || (c = e !== null && e.memoizedState === null ? !1 : (Ue.current & 2) !== 0), c && (n = !0, t.flags &= -129), c = (t.flags & 32) !== 0, t.flags &= -33, e === null) {
      if (oe) {
        if (n ? el(t) : tl(), oe) {
          var s = Ee, h;
          if (h = s) {
            e: {
              for (h = s, s = _t; h.nodeType !== 8; ) {
                if (!s) {
                  s = null;
                  break e;
                }
                if (h = jt(
                  h.nextSibling
                ), h === null) {
                  s = null;
                  break e;
                }
              }
              s = h;
            }
            s !== null ? (t.memoizedState = {
              dehydrated: s,
              treeContext: Sl !== null ? { id: Rt, overflow: wt } : null,
              retryLane: 536870912,
              hydrationErrors: null
            }, h = lt(
              18,
              null,
              null,
              0
            ), h.stateNode = s, h.return = t, t.child = h, Ke = t, Ee = null, h = !0) : h = !1;
          }
          h || Tl(t);
        }
        if (s = t.memoizedState, s !== null && (s = s.dehydrated, s !== null))
          return Qc(s) ? t.lanes = 32 : t.lanes = 536870912, null;
        Bt(t);
      }
      return s = a.children, a = a.fallback, n ? (tl(), n = t.mode, s = ru(
        { mode: "hidden", children: s },
        n
      ), a = xl(
        a,
        n,
        l,
        null
      ), s.return = t, a.return = t, s.sibling = a, t.child = s, n = t.child, n.memoizedState = nc(l), n.childLanes = uc(
        e,
        c,
        l
      ), t.memoizedState = ac, a) : (el(t), ic(t, s));
    }
    if (h = e.memoizedState, h !== null && (s = h.dehydrated, s !== null)) {
      if (u)
        t.flags & 256 ? (el(t), t.flags &= -257, t = cc(
          e,
          t,
          l
        )) : t.memoizedState !== null ? (tl(), t.child = e.child, t.flags |= 128, t = null) : (tl(), n = a.fallback, s = t.mode, a = ru(
          { mode: "visible", children: a.children },
          s
        ), n = xl(
          n,
          s,
          l,
          null
        ), n.flags |= 2, a.return = t, n.return = t, a.sibling = n, t.child = a, ua(
          t,
          e.child,
          null,
          l
        ), a = t.child, a.memoizedState = nc(l), a.childLanes = uc(
          e,
          c,
          l
        ), t.memoizedState = ac, t = n);
      else if (el(t), Qc(s)) {
        if (c = s.nextSibling && s.nextSibling.dataset, c) var b = c.dgst;
        c = b, a = Error(f(419)), a.stack = "", a.digest = c, qa({ value: a, source: null, stack: null }), t = cc(
          e,
          t,
          l
        );
      } else if (qe || Ha(e, t, l, !1), c = (l & e.childLanes) !== 0, qe || c) {
        if (c = je, c !== null && (a = l & -l, a = (a & 42) !== 0 ? 1 : Zu(a), a = (a & (c.suspendedLanes | l)) !== 0 ? 0 : a, a !== 0 && a !== h.retryLane))
          throw h.retryLane = a, kl(e, a), ct(c, e, a), Nf;
        s.data === "$?" || Tc(), t = cc(
          e,
          t,
          l
        );
      } else
        s.data === "$?" ? (t.flags |= 192, t.child = e.child, t = null) : (e = h.treeContext, Ee = jt(
          s.nextSibling
        ), Ke = t, oe = !0, El = null, _t = !1, e !== null && (ht[mt++] = Rt, ht[mt++] = wt, ht[mt++] = Sl, Rt = e.id, wt = e.overflow, Sl = t), t = ic(
          t,
          a.children
        ), t.flags |= 4096);
      return t;
    }
    return n ? (tl(), n = a.fallback, s = t.mode, h = e.child, b = h.sibling, a = Ut(h, {
      mode: "hidden",
      children: a.children
    }), a.subtreeFlags = h.subtreeFlags & 65011712, b !== null ? n = Ut(b, n) : (n = xl(
      n,
      s,
      l,
      null
    ), n.flags |= 2), n.return = t, a.return = t, a.sibling = n, t.child = a, a = n, n = t.child, s = e.child.memoizedState, s === null ? s = nc(l) : (h = s.cachePool, h !== null ? (b = Me._currentValue, h = h.parent !== b ? { parent: b, pool: b } : h) : h = jr(), s = {
      baseLanes: s.baseLanes | l,
      cachePool: h
    }), n.memoizedState = s, n.childLanes = uc(
      e,
      c,
      l
    ), t.memoizedState = ac, a) : (el(t), l = e.child, e = l.sibling, l = Ut(l, {
      mode: "visible",
      children: a.children
    }), l.return = t, l.sibling = null, e !== null && (c = t.deletions, c === null ? (t.deletions = [e], t.flags |= 16) : c.push(e)), t.child = l, t.memoizedState = null, l);
  }
  function ic(e, t) {
    return t = ru(
      { mode: "visible", children: t },
      e.mode
    ), t.return = e, e.child = t;
  }
  function ru(e, t) {
    return e = lt(22, e, null, t), e.lanes = 0, e.stateNode = {
      _visibility: 1,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null
    }, e;
  }
  function cc(e, t, l) {
    return ua(t, e.child, null, l), e = ic(
      t,
      t.pendingProps.children
    ), e.flags |= 2, t.memoizedState = null, e;
  }
  function qf(e, t, l) {
    e.lanes |= t;
    var a = e.alternate;
    a !== null && (a.lanes |= t), Ti(e.return, t, l);
  }
  function sc(e, t, l, a, n) {
    var u = e.memoizedState;
    u === null ? e.memoizedState = {
      isBackwards: t,
      rendering: null,
      renderingStartTime: 0,
      last: a,
      tail: l,
      tailMode: n
    } : (u.isBackwards = t, u.rendering = null, u.renderingStartTime = 0, u.last = a, u.tail = l, u.tailMode = n);
  }
  function Hf(e, t, l) {
    var a = t.pendingProps, n = a.revealOrder, u = a.tail;
    if (Ge(e, t, a.children, l), a = Ue.current, (a & 2) !== 0)
      a = a & 1 | 2, t.flags |= 128;
    else {
      if (e !== null && (e.flags & 128) !== 0)
        e: for (e = t.child; e !== null; ) {
          if (e.tag === 13)
            e.memoizedState !== null && qf(e, l, t);
          else if (e.tag === 19)
            qf(e, l, t);
          else if (e.child !== null) {
            e.child.return = e, e = e.child;
            continue;
          }
          if (e === t) break e;
          for (; e.sibling === null; ) {
            if (e.return === null || e.return === t)
              break e;
            e = e.return;
          }
          e.sibling.return = e.return, e = e.sibling;
        }
      a &= 1;
    }
    switch (H(Ue, a), n) {
      case "forwards":
        for (l = t.child, n = null; l !== null; )
          e = l.alternate, e !== null && uu(e) === null && (n = l), l = l.sibling;
        l = n, l === null ? (n = t.child, t.child = null) : (n = l.sibling, l.sibling = null), sc(
          t,
          !1,
          n,
          l,
          u
        );
        break;
      case "backwards":
        for (l = null, n = t.child, t.child = null; n !== null; ) {
          if (e = n.alternate, e !== null && uu(e) === null) {
            t.child = n;
            break;
          }
          e = n.sibling, n.sibling = l, l = n, n = e;
        }
        sc(
          t,
          !0,
          l,
          null,
          u
        );
        break;
      case "together":
        sc(t, !1, null, null, void 0);
        break;
      default:
        t.memoizedState = null;
    }
    return t.child;
  }
  function Yt(e, t, l) {
    if (e !== null && (t.dependencies = e.dependencies), il |= t.lanes, (l & t.childLanes) === 0)
      if (e !== null) {
        if (Ha(
          e,
          t,
          l,
          !1
        ), (l & t.childLanes) === 0)
          return null;
      } else return null;
    if (e !== null && t.child !== e.child)
      throw Error(f(153));
    if (t.child !== null) {
      for (e = t.child, l = Ut(e, e.pendingProps), t.child = l, l.return = t; e.sibling !== null; )
        e = e.sibling, l = l.sibling = Ut(e, e.pendingProps), l.return = t;
      l.sibling = null;
    }
    return t.child;
  }
  function rc(e, t) {
    return (e.lanes & t) !== 0 ? !0 : (e = e.dependencies, !!(e !== null && Zn(e)));
  }
  function Wh(e, t, l) {
    switch (t.tag) {
      case 3:
        ve(t, t.stateNode.containerInfo), $t(t, Me, e.memoizedState.cache), Ca();
        break;
      case 27:
      case 5:
        Bu(t);
        break;
      case 4:
        ve(t, t.stateNode.containerInfo);
        break;
      case 10:
        $t(
          t,
          t.type,
          t.memoizedProps.value
        );
        break;
      case 13:
        var a = t.memoizedState;
        if (a !== null)
          return a.dehydrated !== null ? (el(t), t.flags |= 128, null) : (l & t.child.childLanes) !== 0 ? Cf(e, t, l) : (el(t), e = Yt(
            e,
            t,
            l
          ), e !== null ? e.sibling : null);
        el(t);
        break;
      case 19:
        var n = (e.flags & 128) !== 0;
        if (a = (l & t.childLanes) !== 0, a || (Ha(
          e,
          t,
          l,
          !1
        ), a = (l & t.childLanes) !== 0), n) {
          if (a)
            return Hf(
              e,
              t,
              l
            );
          t.flags |= 128;
        }
        if (n = t.memoizedState, n !== null && (n.rendering = null, n.tail = null, n.lastEffect = null), H(Ue, Ue.current), a) break;
        return null;
      case 22:
      case 23:
        return t.lanes = 0, Of(e, t, l);
      case 24:
        $t(t, Me, e.memoizedState.cache);
    }
    return Yt(e, t, l);
  }
  function Bf(e, t, l) {
    if (e !== null)
      if (e.memoizedProps !== t.pendingProps)
        qe = !0;
      else {
        if (!rc(e, l) && (t.flags & 128) === 0)
          return qe = !1, Wh(
            e,
            t,
            l
          );
        qe = (e.flags & 131072) !== 0;
      }
    else
      qe = !1, oe && (t.flags & 1048576) !== 0 && hr(t, Qn, t.index);
    switch (t.lanes = 0, t.tag) {
      case 16:
        e: {
          e = t.pendingProps;
          var a = t.elementType, n = a._init;
          if (a = n(a._payload), t.type = a, typeof a == "function")
            bi(a) ? (e = Ol(a, e), t.tag = 1, t = Rf(
              null,
              t,
              a,
              e,
              l
            )) : (t.tag = 0, t = lc(
              null,
              t,
              a,
              e,
              l
            ));
          else {
            if (a != null) {
              if (n = a.$$typeof, n === de) {
                t.tag = 11, t = Af(
                  null,
                  t,
                  a,
                  e,
                  l
                );
                break e;
              } else if (n === te) {
                t.tag = 14, t = zf(
                  null,
                  t,
                  a,
                  e,
                  l
                );
                break e;
              }
            }
            throw t = Dt(a) || a, Error(f(306, t, ""));
          }
        }
        return t;
      case 0:
        return lc(
          e,
          t,
          t.type,
          t.pendingProps,
          l
        );
      case 1:
        return a = t.type, n = Ol(
          a,
          t.pendingProps
        ), Rf(
          e,
          t,
          a,
          n,
          l
        );
      case 3:
        e: {
          if (ve(
            t,
            t.stateNode.containerInfo
          ), e === null) throw Error(f(387));
          a = t.pendingProps;
          var u = t.memoizedState;
          n = u.element, Ui(e, t), La(t, a, null, l);
          var c = t.memoizedState;
          if (a = c.cache, $t(t, Me, a), a !== u.cache && Ni(
            t,
            [Me],
            l,
            !0
          ), Za(), a = c.element, u.isDehydrated)
            if (u = {
              element: a,
              isDehydrated: !1,
              cache: c.cache
            }, t.updateQueue.baseState = u, t.memoizedState = u, t.flags & 256) {
              t = wf(
                e,
                t,
                a,
                l
              );
              break e;
            } else if (a !== n) {
              n = ot(
                Error(f(424)),
                t
              ), qa(n), t = wf(
                e,
                t,
                a,
                l
              );
              break e;
            } else {
              switch (e = t.stateNode.containerInfo, e.nodeType) {
                case 9:
                  e = e.body;
                  break;
                default:
                  e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
              }
              for (Ee = jt(e.firstChild), Ke = t, oe = !0, El = null, _t = !0, l = yf(
                t,
                null,
                a,
                l
              ), t.child = l; l; )
                l.flags = l.flags & -3 | 4096, l = l.sibling;
            }
          else {
            if (Ca(), a === n) {
              t = Yt(
                e,
                t,
                l
              );
              break e;
            }
            Ge(
              e,
              t,
              a,
              l
            );
          }
          t = t.child;
        }
        return t;
      case 26:
        return su(e, t), e === null ? (l = Zo(
          t.type,
          null,
          t.pendingProps,
          null
        )) ? t.memoizedState = l : oe || (l = t.type, e = t.pendingProps, a = _u(
          K.current
        ).createElement(l), a[Ze] = t, a[ke] = e, Qe(a, l, e), Ce(a), t.stateNode = a) : t.memoizedState = Zo(
          t.type,
          e.memoizedProps,
          t.pendingProps,
          e.memoizedState
        ), null;
      case 27:
        return Bu(t), e === null && oe && (a = t.stateNode = Go(
          t.type,
          t.pendingProps,
          K.current
        ), Ke = t, _t = !0, n = Ee, fl(t.type) ? (Zc = n, Ee = jt(
          a.firstChild
        )) : Ee = n), Ge(
          e,
          t,
          t.pendingProps.children,
          l
        ), su(e, t), e === null && (t.flags |= 4194304), t.child;
      case 5:
        return e === null && oe && ((n = a = Ee) && (a = Em(
          a,
          t.type,
          t.pendingProps,
          _t
        ), a !== null ? (t.stateNode = a, Ke = t, Ee = jt(
          a.firstChild
        ), _t = !1, n = !0) : n = !1), n || Tl(t)), Bu(t), n = t.type, u = t.pendingProps, c = e !== null ? e.memoizedProps : null, a = u.children, Yc(n, u) ? a = null : c !== null && Yc(n, c) && (t.flags |= 32), t.memoizedState !== null && (n = Bi(
          e,
          t,
          Qh,
          null,
          null,
          l
        ), hn._currentValue = n), su(e, t), Ge(e, t, a, l), t.child;
      case 6:
        return e === null && oe && ((e = l = Ee) && (l = Tm(
          l,
          t.pendingProps,
          _t
        ), l !== null ? (t.stateNode = l, Ke = t, Ee = null, e = !0) : e = !1), e || Tl(t)), null;
      case 13:
        return Cf(e, t, l);
      case 4:
        return ve(
          t,
          t.stateNode.containerInfo
        ), a = t.pendingProps, e === null ? t.child = ua(
          t,
          null,
          a,
          l
        ) : Ge(
          e,
          t,
          a,
          l
        ), t.child;
      case 11:
        return Af(
          e,
          t,
          t.type,
          t.pendingProps,
          l
        );
      case 7:
        return Ge(
          e,
          t,
          t.pendingProps,
          l
        ), t.child;
      case 8:
        return Ge(
          e,
          t,
          t.pendingProps.children,
          l
        ), t.child;
      case 12:
        return Ge(
          e,
          t,
          t.pendingProps.children,
          l
        ), t.child;
      case 10:
        return a = t.pendingProps, $t(t, t.type, a.value), Ge(
          e,
          t,
          a.children,
          l
        ), t.child;
      case 9:
        return n = t.type._context, a = t.pendingProps.children, Al(t), n = Le(n), a = a(n), t.flags |= 1, Ge(e, t, a, l), t.child;
      case 14:
        return zf(
          e,
          t,
          t.type,
          t.pendingProps,
          l
        );
      case 15:
        return Df(
          e,
          t,
          t.type,
          t.pendingProps,
          l
        );
      case 19:
        return Hf(e, t, l);
      case 31:
        return a = t.pendingProps, l = t.mode, a = {
          mode: a.mode,
          children: a.children
        }, e === null ? (l = ru(
          a,
          l
        ), l.ref = t.ref, t.child = l, l.return = t, t = l) : (l = Ut(e.child, a), l.ref = t.ref, t.child = l, l.return = t, t = l), t;
      case 22:
        return Of(e, t, l);
      case 24:
        return Al(t), a = Le(Me), e === null ? (n = Di(), n === null && (n = je, u = Ai(), n.pooledCache = u, u.refCount++, u !== null && (n.pooledCacheLanes |= l), n = u), t.memoizedState = {
          parent: a,
          cache: n
        }, Mi(t), $t(t, Me, n)) : ((e.lanes & l) !== 0 && (Ui(e, t), La(t, null, null, l), Za()), n = e.memoizedState, u = t.memoizedState, n.parent !== a ? (n = { parent: a, cache: a }, t.memoizedState = n, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = n), $t(t, Me, a)) : (a = u.cache, $t(t, Me, a), a !== n.cache && Ni(
          t,
          [Me],
          l,
          !0
        ))), Ge(
          e,
          t,
          t.pendingProps.children,
          l
        ), t.child;
      case 29:
        throw t.pendingProps;
    }
    throw Error(f(156, t.tag));
  }
  function Gt(e) {
    e.flags |= 4;
  }
  function Yf(e, t) {
    if (t.type !== "stylesheet" || (t.state.loading & 4) !== 0)
      e.flags &= -16777217;
    else if (e.flags |= 16777216, !ko(t)) {
      if (t = vt.current, t !== null && ((re & 4194048) === re ? Et !== null : (re & 62914560) !== re && (re & 536870912) === 0 || t !== Et))
        throw Xa = Oi, xr;
      e.flags |= 8192;
    }
  }
  function fu(e, t) {
    t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag !== 22 ? ys() : 536870912, e.lanes |= t, ra |= t);
  }
  function Fa(e, t) {
    if (!oe)
      switch (e.tailMode) {
        case "hidden":
          t = e.tail;
          for (var l = null; t !== null; )
            t.alternate !== null && (l = t), t = t.sibling;
          l === null ? e.tail = null : l.sibling = null;
          break;
        case "collapsed":
          l = e.tail;
          for (var a = null; l !== null; )
            l.alternate !== null && (a = l), l = l.sibling;
          a === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : a.sibling = null;
      }
  }
  function _e(e) {
    var t = e.alternate !== null && e.alternate.child === e.child, l = 0, a = 0;
    if (t)
      for (var n = e.child; n !== null; )
        l |= n.lanes | n.childLanes, a |= n.subtreeFlags & 65011712, a |= n.flags & 65011712, n.return = e, n = n.sibling;
    else
      for (n = e.child; n !== null; )
        l |= n.lanes | n.childLanes, a |= n.subtreeFlags, a |= n.flags, n.return = e, n = n.sibling;
    return e.subtreeFlags |= a, e.childLanes = l, t;
  }
  function Fh(e, t, l) {
    var a = t.pendingProps;
    switch (Si(t), t.tag) {
      case 31:
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return _e(t), null;
      case 1:
        return _e(t), null;
      case 3:
        return l = t.stateNode, a = null, e !== null && (a = e.memoizedState.cache), t.memoizedState.cache !== a && (t.flags |= 2048), qt(Me), xt(), l.pendingContext && (l.context = l.pendingContext, l.pendingContext = null), (e === null || e.child === null) && (wa(t) ? Gt(t) : e === null || e.memoizedState.isDehydrated && (t.flags & 256) === 0 || (t.flags |= 1024, yr())), _e(t), null;
      case 26:
        return l = t.memoizedState, e === null ? (Gt(t), l !== null ? (_e(t), Yf(t, l)) : (_e(t), t.flags &= -16777217)) : l ? l !== e.memoizedState ? (Gt(t), _e(t), Yf(t, l)) : (_e(t), t.flags &= -16777217) : (e.memoizedProps !== a && Gt(t), _e(t), t.flags &= -16777217), null;
      case 27:
        xn(t), l = K.current;
        var n = t.type;
        if (e !== null && t.stateNode != null)
          e.memoizedProps !== a && Gt(t);
        else {
          if (!a) {
            if (t.stateNode === null)
              throw Error(f(166));
            return _e(t), null;
          }
          e = Z.current, wa(t) ? mr(t) : (e = Go(n, a, l), t.stateNode = e, Gt(t));
        }
        return _e(t), null;
      case 5:
        if (xn(t), l = t.type, e !== null && t.stateNode != null)
          e.memoizedProps !== a && Gt(t);
        else {
          if (!a) {
            if (t.stateNode === null)
              throw Error(f(166));
            return _e(t), null;
          }
          if (e = Z.current, wa(t))
            mr(t);
          else {
            switch (n = _u(
              K.current
            ), e) {
              case 1:
                e = n.createElementNS(
                  "http://www.w3.org/2000/svg",
                  l
                );
                break;
              case 2:
                e = n.createElementNS(
                  "http://www.w3.org/1998/Math/MathML",
                  l
                );
                break;
              default:
                switch (l) {
                  case "svg":
                    e = n.createElementNS(
                      "http://www.w3.org/2000/svg",
                      l
                    );
                    break;
                  case "math":
                    e = n.createElementNS(
                      "http://www.w3.org/1998/Math/MathML",
                      l
                    );
                    break;
                  case "script":
                    e = n.createElement("div"), e.innerHTML = "<script><\/script>", e = e.removeChild(e.firstChild);
                    break;
                  case "select":
                    e = typeof a.is == "string" ? n.createElement("select", { is: a.is }) : n.createElement("select"), a.multiple ? e.multiple = !0 : a.size && (e.size = a.size);
                    break;
                  default:
                    e = typeof a.is == "string" ? n.createElement(l, { is: a.is }) : n.createElement(l);
                }
            }
            e[Ze] = t, e[ke] = a;
            e: for (n = t.child; n !== null; ) {
              if (n.tag === 5 || n.tag === 6)
                e.appendChild(n.stateNode);
              else if (n.tag !== 4 && n.tag !== 27 && n.child !== null) {
                n.child.return = n, n = n.child;
                continue;
              }
              if (n === t) break e;
              for (; n.sibling === null; ) {
                if (n.return === null || n.return === t)
                  break e;
                n = n.return;
              }
              n.sibling.return = n.return, n = n.sibling;
            }
            t.stateNode = e;
            e: switch (Qe(e, l, a), l) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                e = !!a.autoFocus;
                break e;
              case "img":
                e = !0;
                break e;
              default:
                e = !1;
            }
            e && Gt(t);
          }
        }
        return _e(t), t.flags &= -16777217, null;
      case 6:
        if (e && t.stateNode != null)
          e.memoizedProps !== a && Gt(t);
        else {
          if (typeof a != "string" && t.stateNode === null)
            throw Error(f(166));
          if (e = K.current, wa(t)) {
            if (e = t.stateNode, l = t.memoizedProps, a = null, n = Ke, n !== null)
              switch (n.tag) {
                case 27:
                case 5:
                  a = n.memoizedProps;
              }
            e[Ze] = t, e = !!(e.nodeValue === l || a !== null && a.suppressHydrationWarning === !0 || Ro(e.nodeValue, l)), e || Tl(t);
          } else
            e = _u(e).createTextNode(
              a
            ), e[Ze] = t, t.stateNode = e;
        }
        return _e(t), null;
      case 13:
        if (a = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
          if (n = wa(t), a !== null && a.dehydrated !== null) {
            if (e === null) {
              if (!n) throw Error(f(318));
              if (n = t.memoizedState, n = n !== null ? n.dehydrated : null, !n) throw Error(f(317));
              n[Ze] = t;
            } else
              Ca(), (t.flags & 128) === 0 && (t.memoizedState = null), t.flags |= 4;
            _e(t), n = !1;
          } else
            n = yr(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), n = !0;
          if (!n)
            return t.flags & 256 ? (Bt(t), t) : (Bt(t), null);
        }
        if (Bt(t), (t.flags & 128) !== 0)
          return t.lanes = l, t;
        if (l = a !== null, e = e !== null && e.memoizedState !== null, l) {
          a = t.child, n = null, a.alternate !== null && a.alternate.memoizedState !== null && a.alternate.memoizedState.cachePool !== null && (n = a.alternate.memoizedState.cachePool.pool);
          var u = null;
          a.memoizedState !== null && a.memoizedState.cachePool !== null && (u = a.memoizedState.cachePool.pool), u !== n && (a.flags |= 2048);
        }
        return l !== e && l && (t.child.flags |= 8192), fu(t, t.updateQueue), _e(t), null;
      case 4:
        return xt(), e === null && wc(t.stateNode.containerInfo), _e(t), null;
      case 10:
        return qt(t.type), _e(t), null;
      case 19:
        if (C(Ue), n = t.memoizedState, n === null) return _e(t), null;
        if (a = (t.flags & 128) !== 0, u = n.rendering, u === null)
          if (a) Fa(n, !1);
          else {
            if (Te !== 0 || e !== null && (e.flags & 128) !== 0)
              for (e = t.child; e !== null; ) {
                if (u = uu(e), u !== null) {
                  for (t.flags |= 128, Fa(n, !1), e = u.updateQueue, t.updateQueue = e, fu(t, e), t.subtreeFlags = 0, e = l, l = t.child; l !== null; )
                    dr(l, e), l = l.sibling;
                  return H(
                    Ue,
                    Ue.current & 1 | 2
                  ), t.child;
                }
                e = e.sibling;
              }
            n.tail !== null && St() > hu && (t.flags |= 128, a = !0, Fa(n, !1), t.lanes = 4194304);
          }
        else {
          if (!a)
            if (e = uu(u), e !== null) {
              if (t.flags |= 128, a = !0, e = e.updateQueue, t.updateQueue = e, fu(t, e), Fa(n, !0), n.tail === null && n.tailMode === "hidden" && !u.alternate && !oe)
                return _e(t), null;
            } else
              2 * St() - n.renderingStartTime > hu && l !== 536870912 && (t.flags |= 128, a = !0, Fa(n, !1), t.lanes = 4194304);
          n.isBackwards ? (u.sibling = t.child, t.child = u) : (e = n.last, e !== null ? e.sibling = u : t.child = u, n.last = u);
        }
        return n.tail !== null ? (t = n.tail, n.rendering = t, n.tail = t.sibling, n.renderingStartTime = St(), t.sibling = null, e = Ue.current, H(Ue, a ? e & 1 | 2 : e & 1), t) : (_e(t), null);
      case 22:
      case 23:
        return Bt(t), qi(), a = t.memoizedState !== null, e !== null ? e.memoizedState !== null !== a && (t.flags |= 8192) : a && (t.flags |= 8192), a ? (l & 536870912) !== 0 && (t.flags & 128) === 0 && (_e(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : _e(t), l = t.updateQueue, l !== null && fu(t, l.retryQueue), l = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (l = e.memoizedState.cachePool.pool), a = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (a = t.memoizedState.cachePool.pool), a !== l && (t.flags |= 2048), e !== null && C(zl), null;
      case 24:
        return l = null, e !== null && (l = e.memoizedState.cache), t.memoizedState.cache !== l && (t.flags |= 2048), qt(Me), _e(t), null;
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(f(156, t.tag));
  }
  function Ph(e, t) {
    switch (Si(t), t.tag) {
      case 1:
        return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 3:
        return qt(Me), xt(), e = t.flags, (e & 65536) !== 0 && (e & 128) === 0 ? (t.flags = e & -65537 | 128, t) : null;
      case 26:
      case 27:
      case 5:
        return xn(t), null;
      case 13:
        if (Bt(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
          if (t.alternate === null)
            throw Error(f(340));
          Ca();
        }
        return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 19:
        return C(Ue), null;
      case 4:
        return xt(), null;
      case 10:
        return qt(t.type), null;
      case 22:
      case 23:
        return Bt(t), qi(), e !== null && C(zl), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 24:
        return qt(Me), null;
      case 25:
        return null;
      default:
        return null;
    }
  }
  function Gf(e, t) {
    switch (Si(t), t.tag) {
      case 3:
        qt(Me), xt();
        break;
      case 26:
      case 27:
      case 5:
        xn(t);
        break;
      case 4:
        xt();
        break;
      case 13:
        Bt(t);
        break;
      case 19:
        C(Ue);
        break;
      case 10:
        qt(t.type);
        break;
      case 22:
      case 23:
        Bt(t), qi(), e !== null && C(zl);
        break;
      case 24:
        qt(Me);
    }
  }
  function Pa(e, t) {
    try {
      var l = t.updateQueue, a = l !== null ? l.lastEffect : null;
      if (a !== null) {
        var n = a.next;
        l = n;
        do {
          if ((l.tag & e) === e) {
            a = void 0;
            var u = l.create, c = l.inst;
            a = u(), c.destroy = a;
          }
          l = l.next;
        } while (l !== n);
      }
    } catch (s) {
      pe(t, t.return, s);
    }
  }
  function ll(e, t, l) {
    try {
      var a = t.updateQueue, n = a !== null ? a.lastEffect : null;
      if (n !== null) {
        var u = n.next;
        a = u;
        do {
          if ((a.tag & e) === e) {
            var c = a.inst, s = c.destroy;
            if (s !== void 0) {
              c.destroy = void 0, n = t;
              var h = l, b = s;
              try {
                b();
              } catch (O) {
                pe(
                  n,
                  h,
                  O
                );
              }
            }
          }
          a = a.next;
        } while (a !== u);
      }
    } catch (O) {
      pe(t, t.return, O);
    }
  }
  function Xf(e) {
    var t = e.updateQueue;
    if (t !== null) {
      var l = e.stateNode;
      try {
        Ar(t, l);
      } catch (a) {
        pe(e, e.return, a);
      }
    }
  }
  function Qf(e, t, l) {
    l.props = Ol(
      e.type,
      e.memoizedProps
    ), l.state = e.memoizedState;
    try {
      l.componentWillUnmount();
    } catch (a) {
      pe(e, t, a);
    }
  }
  function Ia(e, t) {
    try {
      var l = e.ref;
      if (l !== null) {
        switch (e.tag) {
          case 26:
          case 27:
          case 5:
            var a = e.stateNode;
            break;
          case 30:
            a = e.stateNode;
            break;
          default:
            a = e.stateNode;
        }
        typeof l == "function" ? e.refCleanup = l(a) : l.current = a;
      }
    } catch (n) {
      pe(e, t, n);
    }
  }
  function Tt(e, t) {
    var l = e.ref, a = e.refCleanup;
    if (l !== null)
      if (typeof a == "function")
        try {
          a();
        } catch (n) {
          pe(e, t, n);
        } finally {
          e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
        }
      else if (typeof l == "function")
        try {
          l(null);
        } catch (n) {
          pe(e, t, n);
        }
      else l.current = null;
  }
  function Zf(e) {
    var t = e.type, l = e.memoizedProps, a = e.stateNode;
    try {
      e: switch (t) {
        case "button":
        case "input":
        case "select":
        case "textarea":
          l.autoFocus && a.focus();
          break e;
        case "img":
          l.src ? a.src = l.src : l.srcSet && (a.srcset = l.srcSet);
      }
    } catch (n) {
      pe(e, e.return, n);
    }
  }
  function fc(e, t, l) {
    try {
      var a = e.stateNode;
      pm(a, e.type, l, t), a[ke] = t;
    } catch (n) {
      pe(e, e.return, n);
    }
  }
  function Lf(e) {
    return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && fl(e.type) || e.tag === 4;
  }
  function oc(e) {
    e: for (; ; ) {
      for (; e.sibling === null; ) {
        if (e.return === null || Lf(e.return)) return null;
        e = e.return;
      }
      for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18; ) {
        if (e.tag === 27 && fl(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue e;
        e.child.return = e, e = e.child;
      }
      if (!(e.flags & 2)) return e.stateNode;
    }
  }
  function dc(e, t, l) {
    var a = e.tag;
    if (a === 5 || a === 6)
      e = e.stateNode, t ? (l.nodeType === 9 ? l.body : l.nodeName === "HTML" ? l.ownerDocument.body : l).insertBefore(e, t) : (t = l.nodeType === 9 ? l.body : l.nodeName === "HTML" ? l.ownerDocument.body : l, t.appendChild(e), l = l._reactRootContainer, l != null || t.onclick !== null || (t.onclick = Su));
    else if (a !== 4 && (a === 27 && fl(e.type) && (l = e.stateNode, t = null), e = e.child, e !== null))
      for (dc(e, t, l), e = e.sibling; e !== null; )
        dc(e, t, l), e = e.sibling;
  }
  function ou(e, t, l) {
    var a = e.tag;
    if (a === 5 || a === 6)
      e = e.stateNode, t ? l.insertBefore(e, t) : l.appendChild(e);
    else if (a !== 4 && (a === 27 && fl(e.type) && (l = e.stateNode), e = e.child, e !== null))
      for (ou(e, t, l), e = e.sibling; e !== null; )
        ou(e, t, l), e = e.sibling;
  }
  function Vf(e) {
    var t = e.stateNode, l = e.memoizedProps;
    try {
      for (var a = e.type, n = t.attributes; n.length; )
        t.removeAttributeNode(n[0]);
      Qe(t, a, l), t[Ze] = e, t[ke] = l;
    } catch (u) {
      pe(e, e.return, u);
    }
  }
  var Xt = !1, Ae = !1, hc = !1, Kf = typeof WeakSet == "function" ? WeakSet : Set, He = null;
  function Ih(e, t) {
    if (e = e.containerInfo, Hc = Du, e = lr(e), oi(e)) {
      if ("selectionStart" in e)
        var l = {
          start: e.selectionStart,
          end: e.selectionEnd
        };
      else
        e: {
          l = (l = e.ownerDocument) && l.defaultView || window;
          var a = l.getSelection && l.getSelection();
          if (a && a.rangeCount !== 0) {
            l = a.anchorNode;
            var n = a.anchorOffset, u = a.focusNode;
            a = a.focusOffset;
            try {
              l.nodeType, u.nodeType;
            } catch {
              l = null;
              break e;
            }
            var c = 0, s = -1, h = -1, b = 0, O = 0, R = e, x = null;
            t: for (; ; ) {
              for (var S; R !== l || n !== 0 && R.nodeType !== 3 || (s = c + n), R !== u || a !== 0 && R.nodeType !== 3 || (h = c + a), R.nodeType === 3 && (c += R.nodeValue.length), (S = R.firstChild) !== null; )
                x = R, R = S;
              for (; ; ) {
                if (R === e) break t;
                if (x === l && ++b === n && (s = c), x === u && ++O === a && (h = c), (S = R.nextSibling) !== null) break;
                R = x, x = R.parentNode;
              }
              R = S;
            }
            l = s === -1 || h === -1 ? null : { start: s, end: h };
          } else l = null;
        }
      l = l || { start: 0, end: 0 };
    } else l = null;
    for (Bc = { focusedElem: e, selectionRange: l }, Du = !1, He = t; He !== null; )
      if (t = He, e = t.child, (t.subtreeFlags & 1024) !== 0 && e !== null)
        e.return = t, He = e;
      else
        for (; He !== null; ) {
          switch (t = He, u = t.alternate, e = t.flags, t.tag) {
            case 0:
              break;
            case 11:
            case 15:
              break;
            case 1:
              if ((e & 1024) !== 0 && u !== null) {
                e = void 0, l = t, n = u.memoizedProps, u = u.memoizedState, a = l.stateNode;
                try {
                  var ee = Ol(
                    l.type,
                    n,
                    l.elementType === l.type
                  );
                  e = a.getSnapshotBeforeUpdate(
                    ee,
                    u
                  ), a.__reactInternalSnapshotBeforeUpdate = e;
                } catch (W) {
                  pe(
                    l,
                    l.return,
                    W
                  );
                }
              }
              break;
            case 3:
              if ((e & 1024) !== 0) {
                if (e = t.stateNode.containerInfo, l = e.nodeType, l === 9)
                  Xc(e);
                else if (l === 1)
                  switch (e.nodeName) {
                    case "HEAD":
                    case "HTML":
                    case "BODY":
                      Xc(e);
                      break;
                    default:
                      e.textContent = "";
                  }
              }
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            default:
              if ((e & 1024) !== 0) throw Error(f(163));
          }
          if (e = t.sibling, e !== null) {
            e.return = t.return, He = e;
            break;
          }
          He = t.return;
        }
  }
  function Jf(e, t, l) {
    var a = l.flags;
    switch (l.tag) {
      case 0:
      case 11:
      case 15:
        al(e, l), a & 4 && Pa(5, l);
        break;
      case 1:
        if (al(e, l), a & 4)
          if (e = l.stateNode, t === null)
            try {
              e.componentDidMount();
            } catch (c) {
              pe(l, l.return, c);
            }
          else {
            var n = Ol(
              l.type,
              t.memoizedProps
            );
            t = t.memoizedState;
            try {
              e.componentDidUpdate(
                n,
                t,
                e.__reactInternalSnapshotBeforeUpdate
              );
            } catch (c) {
              pe(
                l,
                l.return,
                c
              );
            }
          }
        a & 64 && Xf(l), a & 512 && Ia(l, l.return);
        break;
      case 3:
        if (al(e, l), a & 64 && (e = l.updateQueue, e !== null)) {
          if (t = null, l.child !== null)
            switch (l.child.tag) {
              case 27:
              case 5:
                t = l.child.stateNode;
                break;
              case 1:
                t = l.child.stateNode;
            }
          try {
            Ar(e, t);
          } catch (c) {
            pe(l, l.return, c);
          }
        }
        break;
      case 27:
        t === null && a & 4 && Vf(l);
      case 26:
      case 5:
        al(e, l), t === null && a & 4 && Zf(l), a & 512 && Ia(l, l.return);
        break;
      case 12:
        al(e, l);
        break;
      case 13:
        al(e, l), a & 4 && Wf(e, l), a & 64 && (e = l.memoizedState, e !== null && (e = e.dehydrated, e !== null && (l = sm.bind(
          null,
          l
        ), Nm(e, l))));
        break;
      case 22:
        if (a = l.memoizedState !== null || Xt, !a) {
          t = t !== null && t.memoizedState !== null || Ae, n = Xt;
          var u = Ae;
          Xt = a, (Ae = t) && !u ? nl(
            e,
            l,
            (l.subtreeFlags & 8772) !== 0
          ) : al(e, l), Xt = n, Ae = u;
        }
        break;
      case 30:
        break;
      default:
        al(e, l);
    }
  }
  function kf(e) {
    var t = e.alternate;
    t !== null && (e.alternate = null, kf(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && Ku(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
  }
  var xe = null, Fe = !1;
  function Qt(e, t, l) {
    for (l = l.child; l !== null; )
      $f(e, t, l), l = l.sibling;
  }
  function $f(e, t, l) {
    if (Ie && typeof Ie.onCommitFiberUnmount == "function")
      try {
        Ie.onCommitFiberUnmount(ja, l);
      } catch {
      }
    switch (l.tag) {
      case 26:
        Ae || Tt(l, t), Qt(
          e,
          t,
          l
        ), l.memoizedState ? l.memoizedState.count-- : l.stateNode && (l = l.stateNode, l.parentNode.removeChild(l));
        break;
      case 27:
        Ae || Tt(l, t);
        var a = xe, n = Fe;
        fl(l.type) && (xe = l.stateNode, Fe = !1), Qt(
          e,
          t,
          l
        ), rn(l.stateNode), xe = a, Fe = n;
        break;
      case 5:
        Ae || Tt(l, t);
      case 6:
        if (a = xe, n = Fe, xe = null, Qt(
          e,
          t,
          l
        ), xe = a, Fe = n, xe !== null)
          if (Fe)
            try {
              (xe.nodeType === 9 ? xe.body : xe.nodeName === "HTML" ? xe.ownerDocument.body : xe).removeChild(l.stateNode);
            } catch (u) {
              pe(
                l,
                t,
                u
              );
            }
          else
            try {
              xe.removeChild(l.stateNode);
            } catch (u) {
              pe(
                l,
                t,
                u
              );
            }
        break;
      case 18:
        xe !== null && (Fe ? (e = xe, Bo(
          e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e,
          l.stateNode
        ), gn(e)) : Bo(xe, l.stateNode));
        break;
      case 4:
        a = xe, n = Fe, xe = l.stateNode.containerInfo, Fe = !0, Qt(
          e,
          t,
          l
        ), xe = a, Fe = n;
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        Ae || ll(2, l, t), Ae || ll(4, l, t), Qt(
          e,
          t,
          l
        );
        break;
      case 1:
        Ae || (Tt(l, t), a = l.stateNode, typeof a.componentWillUnmount == "function" && Qf(
          l,
          t,
          a
        )), Qt(
          e,
          t,
          l
        );
        break;
      case 21:
        Qt(
          e,
          t,
          l
        );
        break;
      case 22:
        Ae = (a = Ae) || l.memoizedState !== null, Qt(
          e,
          t,
          l
        ), Ae = a;
        break;
      default:
        Qt(
          e,
          t,
          l
        );
    }
  }
  function Wf(e, t) {
    if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null))))
      try {
        gn(e);
      } catch (l) {
        pe(t, t.return, l);
      }
  }
  function em(e) {
    switch (e.tag) {
      case 13:
      case 19:
        var t = e.stateNode;
        return t === null && (t = e.stateNode = new Kf()), t;
      case 22:
        return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new Kf()), t;
      default:
        throw Error(f(435, e.tag));
    }
  }
  function mc(e, t) {
    var l = em(e);
    t.forEach(function(a) {
      var n = rm.bind(null, e, a);
      l.has(a) || (l.add(a), a.then(n, n));
    });
  }
  function at(e, t) {
    var l = t.deletions;
    if (l !== null)
      for (var a = 0; a < l.length; a++) {
        var n = l[a], u = e, c = t, s = c;
        e: for (; s !== null; ) {
          switch (s.tag) {
            case 27:
              if (fl(s.type)) {
                xe = s.stateNode, Fe = !1;
                break e;
              }
              break;
            case 5:
              xe = s.stateNode, Fe = !1;
              break e;
            case 3:
            case 4:
              xe = s.stateNode.containerInfo, Fe = !0;
              break e;
          }
          s = s.return;
        }
        if (xe === null) throw Error(f(160));
        $f(u, c, n), xe = null, Fe = !1, u = n.alternate, u !== null && (u.return = null), n.return = null;
      }
    if (t.subtreeFlags & 13878)
      for (t = t.child; t !== null; )
        Ff(t, e), t = t.sibling;
  }
  var pt = null;
  function Ff(e, t) {
    var l = e.alternate, a = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        at(t, e), nt(e), a & 4 && (ll(3, e, e.return), Pa(3, e), ll(5, e, e.return));
        break;
      case 1:
        at(t, e), nt(e), a & 512 && (Ae || l === null || Tt(l, l.return)), a & 64 && Xt && (e = e.updateQueue, e !== null && (a = e.callbacks, a !== null && (l = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = l === null ? a : l.concat(a))));
        break;
      case 26:
        var n = pt;
        if (at(t, e), nt(e), a & 512 && (Ae || l === null || Tt(l, l.return)), a & 4) {
          var u = l !== null ? l.memoizedState : null;
          if (a = e.memoizedState, l === null)
            if (a === null)
              if (e.stateNode === null) {
                e: {
                  a = e.type, l = e.memoizedProps, n = n.ownerDocument || n;
                  t: switch (a) {
                    case "title":
                      u = n.getElementsByTagName("title")[0], (!u || u[_a] || u[Ze] || u.namespaceURI === "http://www.w3.org/2000/svg" || u.hasAttribute("itemprop")) && (u = n.createElement(a), n.head.insertBefore(
                        u,
                        n.querySelector("head > title")
                      )), Qe(u, a, l), u[Ze] = e, Ce(u), a = u;
                      break e;
                    case "link":
                      var c = Ko(
                        "link",
                        "href",
                        n
                      ).get(a + (l.href || ""));
                      if (c) {
                        for (var s = 0; s < c.length; s++)
                          if (u = c[s], u.getAttribute("href") === (l.href == null || l.href === "" ? null : l.href) && u.getAttribute("rel") === (l.rel == null ? null : l.rel) && u.getAttribute("title") === (l.title == null ? null : l.title) && u.getAttribute("crossorigin") === (l.crossOrigin == null ? null : l.crossOrigin)) {
                            c.splice(s, 1);
                            break t;
                          }
                      }
                      u = n.createElement(a), Qe(u, a, l), n.head.appendChild(u);
                      break;
                    case "meta":
                      if (c = Ko(
                        "meta",
                        "content",
                        n
                      ).get(a + (l.content || ""))) {
                        for (s = 0; s < c.length; s++)
                          if (u = c[s], u.getAttribute("content") === (l.content == null ? null : "" + l.content) && u.getAttribute("name") === (l.name == null ? null : l.name) && u.getAttribute("property") === (l.property == null ? null : l.property) && u.getAttribute("http-equiv") === (l.httpEquiv == null ? null : l.httpEquiv) && u.getAttribute("charset") === (l.charSet == null ? null : l.charSet)) {
                            c.splice(s, 1);
                            break t;
                          }
                      }
                      u = n.createElement(a), Qe(u, a, l), n.head.appendChild(u);
                      break;
                    default:
                      throw Error(f(468, a));
                  }
                  u[Ze] = e, Ce(u), a = u;
                }
                e.stateNode = a;
              } else
                Jo(
                  n,
                  e.type,
                  e.stateNode
                );
            else
              e.stateNode = Vo(
                n,
                a,
                e.memoizedProps
              );
          else
            u !== a ? (u === null ? l.stateNode !== null && (l = l.stateNode, l.parentNode.removeChild(l)) : u.count--, a === null ? Jo(
              n,
              e.type,
              e.stateNode
            ) : Vo(
              n,
              a,
              e.memoizedProps
            )) : a === null && e.stateNode !== null && fc(
              e,
              e.memoizedProps,
              l.memoizedProps
            );
        }
        break;
      case 27:
        at(t, e), nt(e), a & 512 && (Ae || l === null || Tt(l, l.return)), l !== null && a & 4 && fc(
          e,
          e.memoizedProps,
          l.memoizedProps
        );
        break;
      case 5:
        if (at(t, e), nt(e), a & 512 && (Ae || l === null || Tt(l, l.return)), e.flags & 32) {
          n = e.stateNode;
          try {
            Xl(n, "");
          } catch (S) {
            pe(e, e.return, S);
          }
        }
        a & 4 && e.stateNode != null && (n = e.memoizedProps, fc(
          e,
          n,
          l !== null ? l.memoizedProps : n
        )), a & 1024 && (hc = !0);
        break;
      case 6:
        if (at(t, e), nt(e), a & 4) {
          if (e.stateNode === null)
            throw Error(f(162));
          a = e.memoizedProps, l = e.stateNode;
          try {
            l.nodeValue = a;
          } catch (S) {
            pe(e, e.return, S);
          }
        }
        break;
      case 3:
        if (Nu = null, n = pt, pt = Eu(t.containerInfo), at(t, e), pt = n, nt(e), a & 4 && l !== null && l.memoizedState.isDehydrated)
          try {
            gn(t.containerInfo);
          } catch (S) {
            pe(e, e.return, S);
          }
        hc && (hc = !1, Pf(e));
        break;
      case 4:
        a = pt, pt = Eu(
          e.stateNode.containerInfo
        ), at(t, e), nt(e), pt = a;
        break;
      case 12:
        at(t, e), nt(e);
        break;
      case 13:
        at(t, e), nt(e), e.child.flags & 8192 && e.memoizedState !== null != (l !== null && l.memoizedState !== null) && (jc = St()), a & 4 && (a = e.updateQueue, a !== null && (e.updateQueue = null, mc(e, a)));
        break;
      case 22:
        n = e.memoizedState !== null;
        var h = l !== null && l.memoizedState !== null, b = Xt, O = Ae;
        if (Xt = b || n, Ae = O || h, at(t, e), Ae = O, Xt = b, nt(e), a & 8192)
          e: for (t = e.stateNode, t._visibility = n ? t._visibility & -2 : t._visibility | 1, n && (l === null || h || Xt || Ae || Ml(e)), l = null, t = e; ; ) {
            if (t.tag === 5 || t.tag === 26) {
              if (l === null) {
                h = l = t;
                try {
                  if (u = h.stateNode, n)
                    c = u.style, typeof c.setProperty == "function" ? c.setProperty("display", "none", "important") : c.display = "none";
                  else {
                    s = h.stateNode;
                    var R = h.memoizedProps.style, x = R != null && R.hasOwnProperty("display") ? R.display : null;
                    s.style.display = x == null || typeof x == "boolean" ? "" : ("" + x).trim();
                  }
                } catch (S) {
                  pe(h, h.return, S);
                }
              }
            } else if (t.tag === 6) {
              if (l === null) {
                h = t;
                try {
                  h.stateNode.nodeValue = n ? "" : h.memoizedProps;
                } catch (S) {
                  pe(h, h.return, S);
                }
              }
            } else if ((t.tag !== 22 && t.tag !== 23 || t.memoizedState === null || t === e) && t.child !== null) {
              t.child.return = t, t = t.child;
              continue;
            }
            if (t === e) break e;
            for (; t.sibling === null; ) {
              if (t.return === null || t.return === e) break e;
              l === t && (l = null), t = t.return;
            }
            l === t && (l = null), t.sibling.return = t.return, t = t.sibling;
          }
        a & 4 && (a = e.updateQueue, a !== null && (l = a.retryQueue, l !== null && (a.retryQueue = null, mc(e, l))));
        break;
      case 19:
        at(t, e), nt(e), a & 4 && (a = e.updateQueue, a !== null && (e.updateQueue = null, mc(e, a)));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        at(t, e), nt(e);
    }
  }
  function nt(e) {
    var t = e.flags;
    if (t & 2) {
      try {
        for (var l, a = e.return; a !== null; ) {
          if (Lf(a)) {
            l = a;
            break;
          }
          a = a.return;
        }
        if (l == null) throw Error(f(160));
        switch (l.tag) {
          case 27:
            var n = l.stateNode, u = oc(e);
            ou(e, u, n);
            break;
          case 5:
            var c = l.stateNode;
            l.flags & 32 && (Xl(c, ""), l.flags &= -33);
            var s = oc(e);
            ou(e, s, c);
            break;
          case 3:
          case 4:
            var h = l.stateNode.containerInfo, b = oc(e);
            dc(
              e,
              b,
              h
            );
            break;
          default:
            throw Error(f(161));
        }
      } catch (O) {
        pe(e, e.return, O);
      }
      e.flags &= -3;
    }
    t & 4096 && (e.flags &= -4097);
  }
  function Pf(e) {
    if (e.subtreeFlags & 1024)
      for (e = e.child; e !== null; ) {
        var t = e;
        Pf(t), t.tag === 5 && t.flags & 1024 && t.stateNode.reset(), e = e.sibling;
      }
  }
  function al(e, t) {
    if (t.subtreeFlags & 8772)
      for (t = t.child; t !== null; )
        Jf(e, t.alternate, t), t = t.sibling;
  }
  function Ml(e) {
    for (e = e.child; e !== null; ) {
      var t = e;
      switch (t.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          ll(4, t, t.return), Ml(t);
          break;
        case 1:
          Tt(t, t.return);
          var l = t.stateNode;
          typeof l.componentWillUnmount == "function" && Qf(
            t,
            t.return,
            l
          ), Ml(t);
          break;
        case 27:
          rn(t.stateNode);
        case 26:
        case 5:
          Tt(t, t.return), Ml(t);
          break;
        case 22:
          t.memoizedState === null && Ml(t);
          break;
        case 30:
          Ml(t);
          break;
        default:
          Ml(t);
      }
      e = e.sibling;
    }
  }
  function nl(e, t, l) {
    for (l = l && (t.subtreeFlags & 8772) !== 0, t = t.child; t !== null; ) {
      var a = t.alternate, n = e, u = t, c = u.flags;
      switch (u.tag) {
        case 0:
        case 11:
        case 15:
          nl(
            n,
            u,
            l
          ), Pa(4, u);
          break;
        case 1:
          if (nl(
            n,
            u,
            l
          ), a = u, n = a.stateNode, typeof n.componentDidMount == "function")
            try {
              n.componentDidMount();
            } catch (b) {
              pe(a, a.return, b);
            }
          if (a = u, n = a.updateQueue, n !== null) {
            var s = a.stateNode;
            try {
              var h = n.shared.hiddenCallbacks;
              if (h !== null)
                for (n.shared.hiddenCallbacks = null, n = 0; n < h.length; n++)
                  Nr(h[n], s);
            } catch (b) {
              pe(a, a.return, b);
            }
          }
          l && c & 64 && Xf(u), Ia(u, u.return);
          break;
        case 27:
          Vf(u);
        case 26:
        case 5:
          nl(
            n,
            u,
            l
          ), l && a === null && c & 4 && Zf(u), Ia(u, u.return);
          break;
        case 12:
          nl(
            n,
            u,
            l
          );
          break;
        case 13:
          nl(
            n,
            u,
            l
          ), l && c & 4 && Wf(n, u);
          break;
        case 22:
          u.memoizedState === null && nl(
            n,
            u,
            l
          ), Ia(u, u.return);
          break;
        case 30:
          break;
        default:
          nl(
            n,
            u,
            l
          );
      }
      t = t.sibling;
    }
  }
  function vc(e, t) {
    var l = null;
    e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (l = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== l && (e != null && e.refCount++, l != null && Ba(l));
  }
  function yc(e, t) {
    e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && Ba(e));
  }
  function Nt(e, t, l, a) {
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; )
        If(
          e,
          t,
          l,
          a
        ), t = t.sibling;
  }
  function If(e, t, l, a) {
    var n = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        Nt(
          e,
          t,
          l,
          a
        ), n & 2048 && Pa(9, t);
        break;
      case 1:
        Nt(
          e,
          t,
          l,
          a
        );
        break;
      case 3:
        Nt(
          e,
          t,
          l,
          a
        ), n & 2048 && (e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && Ba(e)));
        break;
      case 12:
        if (n & 2048) {
          Nt(
            e,
            t,
            l,
            a
          ), e = t.stateNode;
          try {
            var u = t.memoizedProps, c = u.id, s = u.onPostCommit;
            typeof s == "function" && s(
              c,
              t.alternate === null ? "mount" : "update",
              e.passiveEffectDuration,
              -0
            );
          } catch (h) {
            pe(t, t.return, h);
          }
        } else
          Nt(
            e,
            t,
            l,
            a
          );
        break;
      case 13:
        Nt(
          e,
          t,
          l,
          a
        );
        break;
      case 23:
        break;
      case 22:
        u = t.stateNode, c = t.alternate, t.memoizedState !== null ? u._visibility & 2 ? Nt(
          e,
          t,
          l,
          a
        ) : en(e, t) : u._visibility & 2 ? Nt(
          e,
          t,
          l,
          a
        ) : (u._visibility |= 2, ia(
          e,
          t,
          l,
          a,
          (t.subtreeFlags & 10256) !== 0
        )), n & 2048 && vc(c, t);
        break;
      case 24:
        Nt(
          e,
          t,
          l,
          a
        ), n & 2048 && yc(t.alternate, t);
        break;
      default:
        Nt(
          e,
          t,
          l,
          a
        );
    }
  }
  function ia(e, t, l, a, n) {
    for (n = n && (t.subtreeFlags & 10256) !== 0, t = t.child; t !== null; ) {
      var u = e, c = t, s = l, h = a, b = c.flags;
      switch (c.tag) {
        case 0:
        case 11:
        case 15:
          ia(
            u,
            c,
            s,
            h,
            n
          ), Pa(8, c);
          break;
        case 23:
          break;
        case 22:
          var O = c.stateNode;
          c.memoizedState !== null ? O._visibility & 2 ? ia(
            u,
            c,
            s,
            h,
            n
          ) : en(
            u,
            c
          ) : (O._visibility |= 2, ia(
            u,
            c,
            s,
            h,
            n
          )), n && b & 2048 && vc(
            c.alternate,
            c
          );
          break;
        case 24:
          ia(
            u,
            c,
            s,
            h,
            n
          ), n && b & 2048 && yc(c.alternate, c);
          break;
        default:
          ia(
            u,
            c,
            s,
            h,
            n
          );
      }
      t = t.sibling;
    }
  }
  function en(e, t) {
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; ) {
        var l = e, a = t, n = a.flags;
        switch (a.tag) {
          case 22:
            en(l, a), n & 2048 && vc(
              a.alternate,
              a
            );
            break;
          case 24:
            en(l, a), n & 2048 && yc(a.alternate, a);
            break;
          default:
            en(l, a);
        }
        t = t.sibling;
      }
  }
  var tn = 8192;
  function ca(e) {
    if (e.subtreeFlags & tn)
      for (e = e.child; e !== null; )
        eo(e), e = e.sibling;
  }
  function eo(e) {
    switch (e.tag) {
      case 26:
        ca(e), e.flags & tn && e.memoizedState !== null && Ym(
          pt,
          e.memoizedState,
          e.memoizedProps
        );
        break;
      case 5:
        ca(e);
        break;
      case 3:
      case 4:
        var t = pt;
        pt = Eu(e.stateNode.containerInfo), ca(e), pt = t;
        break;
      case 22:
        e.memoizedState === null && (t = e.alternate, t !== null && t.memoizedState !== null ? (t = tn, tn = 16777216, ca(e), tn = t) : ca(e));
        break;
      default:
        ca(e);
    }
  }
  function to(e) {
    var t = e.alternate;
    if (t !== null && (e = t.child, e !== null)) {
      t.child = null;
      do
        t = e.sibling, e.sibling = null, e = t;
      while (e !== null);
    }
  }
  function ln(e) {
    var t = e.deletions;
    if ((e.flags & 16) !== 0) {
      if (t !== null)
        for (var l = 0; l < t.length; l++) {
          var a = t[l];
          He = a, ao(
            a,
            e
          );
        }
      to(e);
    }
    if (e.subtreeFlags & 10256)
      for (e = e.child; e !== null; )
        lo(e), e = e.sibling;
  }
  function lo(e) {
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        ln(e), e.flags & 2048 && ll(9, e, e.return);
        break;
      case 3:
        ln(e);
        break;
      case 12:
        ln(e);
        break;
      case 22:
        var t = e.stateNode;
        e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, du(e)) : ln(e);
        break;
      default:
        ln(e);
    }
  }
  function du(e) {
    var t = e.deletions;
    if ((e.flags & 16) !== 0) {
      if (t !== null)
        for (var l = 0; l < t.length; l++) {
          var a = t[l];
          He = a, ao(
            a,
            e
          );
        }
      to(e);
    }
    for (e = e.child; e !== null; ) {
      switch (t = e, t.tag) {
        case 0:
        case 11:
        case 15:
          ll(8, t, t.return), du(t);
          break;
        case 22:
          l = t.stateNode, l._visibility & 2 && (l._visibility &= -3, du(t));
          break;
        default:
          du(t);
      }
      e = e.sibling;
    }
  }
  function ao(e, t) {
    for (; He !== null; ) {
      var l = He;
      switch (l.tag) {
        case 0:
        case 11:
        case 15:
          ll(8, l, t);
          break;
        case 23:
        case 22:
          if (l.memoizedState !== null && l.memoizedState.cachePool !== null) {
            var a = l.memoizedState.cachePool.pool;
            a != null && a.refCount++;
          }
          break;
        case 24:
          Ba(l.memoizedState.cache);
      }
      if (a = l.child, a !== null) a.return = l, He = a;
      else
        e: for (l = e; He !== null; ) {
          a = He;
          var n = a.sibling, u = a.return;
          if (kf(a), a === l) {
            He = null;
            break e;
          }
          if (n !== null) {
            n.return = u, He = n;
            break e;
          }
          He = u;
        }
    }
  }
  var tm = {
    getCacheForType: function(e) {
      var t = Le(Me), l = t.data.get(e);
      return l === void 0 && (l = e(), t.data.set(e, l)), l;
    }
  }, lm = typeof WeakMap == "function" ? WeakMap : Map, he = 0, je = null, ce = null, re = 0, me = 0, ut = null, ul = !1, sa = !1, gc = !1, Zt = 0, Te = 0, il = 0, Ul = 0, bc = 0, yt = 0, ra = 0, an = null, Pe = null, pc = !1, jc = 0, hu = 1 / 0, mu = null, cl = null, Xe = 0, sl = null, fa = null, oa = 0, xc = 0, Sc = null, no = null, nn = 0, _c = null;
  function it() {
    if ((he & 2) !== 0 && re !== 0)
      return re & -re;
    if (D.T !== null) {
      var e = Pl;
      return e !== 0 ? e : Oc();
    }
    return ps();
  }
  function uo() {
    yt === 0 && (yt = (re & 536870912) === 0 || oe ? vs() : 536870912);
    var e = vt.current;
    return e !== null && (e.flags |= 32), yt;
  }
  function ct(e, t, l) {
    (e === je && (me === 2 || me === 9) || e.cancelPendingCommit !== null) && (da(e, 0), rl(
      e,
      re,
      yt,
      !1
    )), Sa(e, l), ((he & 2) === 0 || e !== je) && (e === je && ((he & 2) === 0 && (Ul |= l), Te === 4 && rl(
      e,
      re,
      yt,
      !1
    )), At(e));
  }
  function io(e, t, l) {
    if ((he & 6) !== 0) throw Error(f(327));
    var a = !l && (t & 124) === 0 && (t & e.expiredLanes) === 0 || xa(e, t), n = a ? um(e, t) : Nc(e, t, !0), u = a;
    do {
      if (n === 0) {
        sa && !a && rl(e, t, 0, !1);
        break;
      } else {
        if (l = e.current.alternate, u && !am(l)) {
          n = Nc(e, t, !1), u = !1;
          continue;
        }
        if (n === 2) {
          if (u = t, e.errorRecoveryDisabledLanes & u)
            var c = 0;
          else
            c = e.pendingLanes & -536870913, c = c !== 0 ? c : c & 536870912 ? 536870912 : 0;
          if (c !== 0) {
            t = c;
            e: {
              var s = e;
              n = an;
              var h = s.current.memoizedState.isDehydrated;
              if (h && (da(s, c).flags |= 256), c = Nc(
                s,
                c,
                !1
              ), c !== 2) {
                if (gc && !h) {
                  s.errorRecoveryDisabledLanes |= u, Ul |= u, n = 4;
                  break e;
                }
                u = Pe, Pe = n, u !== null && (Pe === null ? Pe = u : Pe.push.apply(
                  Pe,
                  u
                ));
              }
              n = c;
            }
            if (u = !1, n !== 2) continue;
          }
        }
        if (n === 1) {
          da(e, 0), rl(e, t, 0, !0);
          break;
        }
        e: {
          switch (a = e, u = n, u) {
            case 0:
            case 1:
              throw Error(f(345));
            case 4:
              if ((t & 4194048) !== t) break;
            case 6:
              rl(
                a,
                t,
                yt,
                !ul
              );
              break e;
            case 2:
              Pe = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(f(329));
          }
          if ((t & 62914560) === t && (n = jc + 300 - St(), 10 < n)) {
            if (rl(
              a,
              t,
              yt,
              !ul
            ), Tn(a, 0, !0) !== 0) break e;
            a.timeoutHandle = qo(
              co.bind(
                null,
                a,
                l,
                Pe,
                mu,
                pc,
                t,
                yt,
                Ul,
                ra,
                ul,
                u,
                2,
                -0,
                0
              ),
              n
            );
            break e;
          }
          co(
            a,
            l,
            Pe,
            mu,
            pc,
            t,
            yt,
            Ul,
            ra,
            ul,
            u,
            0,
            -0,
            0
          );
        }
      }
      break;
    } while (!0);
    At(e);
  }
  function co(e, t, l, a, n, u, c, s, h, b, O, R, x, S) {
    if (e.timeoutHandle = -1, R = t.subtreeFlags, (R & 8192 || (R & 16785408) === 16785408) && (dn = { stylesheets: null, count: 0, unsuspend: Bm }, eo(t), R = Gm(), R !== null)) {
      e.cancelPendingCommit = R(
        vo.bind(
          null,
          e,
          t,
          u,
          l,
          a,
          n,
          c,
          s,
          h,
          O,
          1,
          x,
          S
        )
      ), rl(e, u, c, !b);
      return;
    }
    vo(
      e,
      t,
      u,
      l,
      a,
      n,
      c,
      s,
      h
    );
  }
  function am(e) {
    for (var t = e; ; ) {
      var l = t.tag;
      if ((l === 0 || l === 11 || l === 15) && t.flags & 16384 && (l = t.updateQueue, l !== null && (l = l.stores, l !== null)))
        for (var a = 0; a < l.length; a++) {
          var n = l[a], u = n.getSnapshot;
          n = n.value;
          try {
            if (!tt(u(), n)) return !1;
          } catch {
            return !1;
          }
        }
      if (l = t.child, t.subtreeFlags & 16384 && l !== null)
        l.return = t, t = l;
      else {
        if (t === e) break;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === e) return !0;
          t = t.return;
        }
        t.sibling.return = t.return, t = t.sibling;
      }
    }
    return !0;
  }
  function rl(e, t, l, a) {
    t &= ~bc, t &= ~Ul, e.suspendedLanes |= t, e.pingedLanes &= ~t, a && (e.warmLanes |= t), a = e.expirationTimes;
    for (var n = t; 0 < n; ) {
      var u = 31 - et(n), c = 1 << u;
      a[u] = -1, n &= ~c;
    }
    l !== 0 && gs(e, l, t);
  }
  function vu() {
    return (he & 6) === 0 ? (un(0), !1) : !0;
  }
  function Ec() {
    if (ce !== null) {
      if (me === 0)
        var e = ce.return;
      else
        e = ce, Ct = Nl = null, Xi(e), na = null, $a = 0, e = ce;
      for (; e !== null; )
        Gf(e.alternate, e), e = e.return;
      ce = null;
    }
  }
  function da(e, t) {
    var l = e.timeoutHandle;
    l !== -1 && (e.timeoutHandle = -1, xm(l)), l = e.cancelPendingCommit, l !== null && (e.cancelPendingCommit = null, l()), Ec(), je = e, ce = l = Ut(e.current, null), re = t, me = 0, ut = null, ul = !1, sa = xa(e, t), gc = !1, ra = yt = bc = Ul = il = Te = 0, Pe = an = null, pc = !1, (t & 8) !== 0 && (t |= t & 32);
    var a = e.entangledLanes;
    if (a !== 0)
      for (e = e.entanglements, a &= t; 0 < a; ) {
        var n = 31 - et(a), u = 1 << n;
        t |= e[n], a &= ~u;
      }
    return Zt = t, Hn(), l;
  }
  function so(e, t) {
    ue = null, D.H = lu, t === Ga || t === Kn ? (t = Er(), me = 3) : t === xr ? (t = Er(), me = 4) : me = t === Nf ? 8 : t !== null && typeof t == "object" && typeof t.then == "function" ? 6 : 1, ut = t, ce === null && (Te = 1, cu(
      e,
      ot(t, e.current)
    ));
  }
  function ro() {
    var e = D.H;
    return D.H = lu, e === null ? lu : e;
  }
  function fo() {
    var e = D.A;
    return D.A = tm, e;
  }
  function Tc() {
    Te = 4, ul || (re & 4194048) !== re && vt.current !== null || (sa = !0), (il & 134217727) === 0 && (Ul & 134217727) === 0 || je === null || rl(
      je,
      re,
      yt,
      !1
    );
  }
  function Nc(e, t, l) {
    var a = he;
    he |= 2;
    var n = ro(), u = fo();
    (je !== e || re !== t) && (mu = null, da(e, t)), t = !1;
    var c = Te;
    e: do
      try {
        if (me !== 0 && ce !== null) {
          var s = ce, h = ut;
          switch (me) {
            case 8:
              Ec(), c = 6;
              break e;
            case 3:
            case 2:
            case 9:
            case 6:
              vt.current === null && (t = !0);
              var b = me;
              if (me = 0, ut = null, ha(e, s, h, b), l && sa) {
                c = 0;
                break e;
              }
              break;
            default:
              b = me, me = 0, ut = null, ha(e, s, h, b);
          }
        }
        nm(), c = Te;
        break;
      } catch (O) {
        so(e, O);
      }
    while (!0);
    return t && e.shellSuspendCounter++, Ct = Nl = null, he = a, D.H = n, D.A = u, ce === null && (je = null, re = 0, Hn()), c;
  }
  function nm() {
    for (; ce !== null; ) oo(ce);
  }
  function um(e, t) {
    var l = he;
    he |= 2;
    var a = ro(), n = fo();
    je !== e || re !== t ? (mu = null, hu = St() + 500, da(e, t)) : sa = xa(
      e,
      t
    );
    e: do
      try {
        if (me !== 0 && ce !== null) {
          t = ce;
          var u = ut;
          t: switch (me) {
            case 1:
              me = 0, ut = null, ha(e, t, u, 1);
              break;
            case 2:
            case 9:
              if (Sr(u)) {
                me = 0, ut = null, ho(t);
                break;
              }
              t = function() {
                me !== 2 && me !== 9 || je !== e || (me = 7), At(e);
              }, u.then(t, t);
              break e;
            case 3:
              me = 7;
              break e;
            case 4:
              me = 5;
              break e;
            case 7:
              Sr(u) ? (me = 0, ut = null, ho(t)) : (me = 0, ut = null, ha(e, t, u, 7));
              break;
            case 5:
              var c = null;
              switch (ce.tag) {
                case 26:
                  c = ce.memoizedState;
                case 5:
                case 27:
                  var s = ce;
                  if (!c || ko(c)) {
                    me = 0, ut = null;
                    var h = s.sibling;
                    if (h !== null) ce = h;
                    else {
                      var b = s.return;
                      b !== null ? (ce = b, yu(b)) : ce = null;
                    }
                    break t;
                  }
              }
              me = 0, ut = null, ha(e, t, u, 5);
              break;
            case 6:
              me = 0, ut = null, ha(e, t, u, 6);
              break;
            case 8:
              Ec(), Te = 6;
              break e;
            default:
              throw Error(f(462));
          }
        }
        im();
        break;
      } catch (O) {
        so(e, O);
      }
    while (!0);
    return Ct = Nl = null, D.H = a, D.A = n, he = l, ce !== null ? 0 : (je = null, re = 0, Hn(), Te);
  }
  function im() {
    for (; ce !== null && !zd(); )
      oo(ce);
  }
  function oo(e) {
    var t = Bf(e.alternate, e, Zt);
    e.memoizedProps = e.pendingProps, t === null ? yu(e) : ce = t;
  }
  function ho(e) {
    var t = e, l = t.alternate;
    switch (t.tag) {
      case 15:
      case 0:
        t = Uf(
          l,
          t,
          t.pendingProps,
          t.type,
          void 0,
          re
        );
        break;
      case 11:
        t = Uf(
          l,
          t,
          t.pendingProps,
          t.type.render,
          t.ref,
          re
        );
        break;
      case 5:
        Xi(t);
      default:
        Gf(l, t), t = ce = dr(t, Zt), t = Bf(l, t, Zt);
    }
    e.memoizedProps = e.pendingProps, t === null ? yu(e) : ce = t;
  }
  function ha(e, t, l, a) {
    Ct = Nl = null, Xi(t), na = null, $a = 0;
    var n = t.return;
    try {
      if ($h(
        e,
        n,
        t,
        l,
        re
      )) {
        Te = 1, cu(
          e,
          ot(l, e.current)
        ), ce = null;
        return;
      }
    } catch (u) {
      if (n !== null) throw ce = n, u;
      Te = 1, cu(
        e,
        ot(l, e.current)
      ), ce = null;
      return;
    }
    t.flags & 32768 ? (oe || a === 1 ? e = !0 : sa || (re & 536870912) !== 0 ? e = !1 : (ul = e = !0, (a === 2 || a === 9 || a === 3 || a === 6) && (a = vt.current, a !== null && a.tag === 13 && (a.flags |= 16384))), mo(t, e)) : yu(t);
  }
  function yu(e) {
    var t = e;
    do {
      if ((t.flags & 32768) !== 0) {
        mo(
          t,
          ul
        );
        return;
      }
      e = t.return;
      var l = Fh(
        t.alternate,
        t,
        Zt
      );
      if (l !== null) {
        ce = l;
        return;
      }
      if (t = t.sibling, t !== null) {
        ce = t;
        return;
      }
      ce = t = e;
    } while (t !== null);
    Te === 0 && (Te = 5);
  }
  function mo(e, t) {
    do {
      var l = Ph(e.alternate, e);
      if (l !== null) {
        l.flags &= 32767, ce = l;
        return;
      }
      if (l = e.return, l !== null && (l.flags |= 32768, l.subtreeFlags = 0, l.deletions = null), !t && (e = e.sibling, e !== null)) {
        ce = e;
        return;
      }
      ce = e = l;
    } while (e !== null);
    Te = 6, ce = null;
  }
  function vo(e, t, l, a, n, u, c, s, h) {
    e.cancelPendingCommit = null;
    do
      gu();
    while (Xe !== 0);
    if ((he & 6) !== 0) throw Error(f(327));
    if (t !== null) {
      if (t === e.current) throw Error(f(177));
      if (u = t.lanes | t.childLanes, u |= yi, Bd(
        e,
        l,
        u,
        c,
        s,
        h
      ), e === je && (ce = je = null, re = 0), fa = t, sl = e, oa = l, xc = u, Sc = n, no = a, (t.subtreeFlags & 10256) !== 0 || (t.flags & 10256) !== 0 ? (e.callbackNode = null, e.callbackPriority = 0, fm(Sn, function() {
        return jo(), null;
      })) : (e.callbackNode = null, e.callbackPriority = 0), a = (t.flags & 13878) !== 0, (t.subtreeFlags & 13878) !== 0 || a) {
        a = D.T, D.T = null, n = Y.p, Y.p = 2, c = he, he |= 4;
        try {
          Ih(e, t, l);
        } finally {
          he = c, Y.p = n, D.T = a;
        }
      }
      Xe = 1, yo(), go(), bo();
    }
  }
  function yo() {
    if (Xe === 1) {
      Xe = 0;
      var e = sl, t = fa, l = (t.flags & 13878) !== 0;
      if ((t.subtreeFlags & 13878) !== 0 || l) {
        l = D.T, D.T = null;
        var a = Y.p;
        Y.p = 2;
        var n = he;
        he |= 4;
        try {
          Ff(t, e);
          var u = Bc, c = lr(e.containerInfo), s = u.focusedElem, h = u.selectionRange;
          if (c !== s && s && s.ownerDocument && tr(
            s.ownerDocument.documentElement,
            s
          )) {
            if (h !== null && oi(s)) {
              var b = h.start, O = h.end;
              if (O === void 0 && (O = b), "selectionStart" in s)
                s.selectionStart = b, s.selectionEnd = Math.min(
                  O,
                  s.value.length
                );
              else {
                var R = s.ownerDocument || document, x = R && R.defaultView || window;
                if (x.getSelection) {
                  var S = x.getSelection(), ee = s.textContent.length, W = Math.min(h.start, ee), be = h.end === void 0 ? W : Math.min(h.end, ee);
                  !S.extend && W > be && (c = be, be = W, W = c);
                  var y = er(
                    s,
                    W
                  ), v = er(
                    s,
                    be
                  );
                  if (y && v && (S.rangeCount !== 1 || S.anchorNode !== y.node || S.anchorOffset !== y.offset || S.focusNode !== v.node || S.focusOffset !== v.offset)) {
                    var g = R.createRange();
                    g.setStart(y.node, y.offset), S.removeAllRanges(), W > be ? (S.addRange(g), S.extend(v.node, v.offset)) : (g.setEnd(v.node, v.offset), S.addRange(g));
                  }
                }
              }
            }
            for (R = [], S = s; S = S.parentNode; )
              S.nodeType === 1 && R.push({
                element: S,
                left: S.scrollLeft,
                top: S.scrollTop
              });
            for (typeof s.focus == "function" && s.focus(), s = 0; s < R.length; s++) {
              var M = R[s];
              M.element.scrollLeft = M.left, M.element.scrollTop = M.top;
            }
          }
          Du = !!Hc, Bc = Hc = null;
        } finally {
          he = n, Y.p = a, D.T = l;
        }
      }
      e.current = t, Xe = 2;
    }
  }
  function go() {
    if (Xe === 2) {
      Xe = 0;
      var e = sl, t = fa, l = (t.flags & 8772) !== 0;
      if ((t.subtreeFlags & 8772) !== 0 || l) {
        l = D.T, D.T = null;
        var a = Y.p;
        Y.p = 2;
        var n = he;
        he |= 4;
        try {
          Jf(e, t.alternate, t);
        } finally {
          he = n, Y.p = a, D.T = l;
        }
      }
      Xe = 3;
    }
  }
  function bo() {
    if (Xe === 4 || Xe === 3) {
      Xe = 0, Dd();
      var e = sl, t = fa, l = oa, a = no;
      (t.subtreeFlags & 10256) !== 0 || (t.flags & 10256) !== 0 ? Xe = 5 : (Xe = 0, fa = sl = null, po(e, e.pendingLanes));
      var n = e.pendingLanes;
      if (n === 0 && (cl = null), Lu(l), t = t.stateNode, Ie && typeof Ie.onCommitFiberRoot == "function")
        try {
          Ie.onCommitFiberRoot(
            ja,
            t,
            void 0,
            (t.current.flags & 128) === 128
          );
        } catch {
        }
      if (a !== null) {
        t = D.T, n = Y.p, Y.p = 2, D.T = null;
        try {
          for (var u = e.onRecoverableError, c = 0; c < a.length; c++) {
            var s = a[c];
            u(s.value, {
              componentStack: s.stack
            });
          }
        } finally {
          D.T = t, Y.p = n;
        }
      }
      (oa & 3) !== 0 && gu(), At(e), n = e.pendingLanes, (l & 4194090) !== 0 && (n & 42) !== 0 ? e === _c ? nn++ : (nn = 0, _c = e) : nn = 0, un(0);
    }
  }
  function po(e, t) {
    (e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, Ba(t)));
  }
  function gu(e) {
    return yo(), go(), bo(), jo();
  }
  function jo() {
    if (Xe !== 5) return !1;
    var e = sl, t = xc;
    xc = 0;
    var l = Lu(oa), a = D.T, n = Y.p;
    try {
      Y.p = 32 > l ? 32 : l, D.T = null, l = Sc, Sc = null;
      var u = sl, c = oa;
      if (Xe = 0, fa = sl = null, oa = 0, (he & 6) !== 0) throw Error(f(331));
      var s = he;
      if (he |= 4, lo(u.current), If(
        u,
        u.current,
        c,
        l
      ), he = s, un(0, !1), Ie && typeof Ie.onPostCommitFiberRoot == "function")
        try {
          Ie.onPostCommitFiberRoot(ja, u);
        } catch {
        }
      return !0;
    } finally {
      Y.p = n, D.T = a, po(e, t);
    }
  }
  function xo(e, t, l) {
    t = ot(l, t), t = tc(e.stateNode, t, 2), e = Pt(e, t, 2), e !== null && (Sa(e, 2), At(e));
  }
  function pe(e, t, l) {
    if (e.tag === 3)
      xo(e, e, l);
    else
      for (; t !== null; ) {
        if (t.tag === 3) {
          xo(
            t,
            e,
            l
          );
          break;
        } else if (t.tag === 1) {
          var a = t.stateNode;
          if (typeof t.type.getDerivedStateFromError == "function" || typeof a.componentDidCatch == "function" && (cl === null || !cl.has(a))) {
            e = ot(l, e), l = Ef(2), a = Pt(t, l, 2), a !== null && (Tf(
              l,
              a,
              t,
              e
            ), Sa(a, 2), At(a));
            break;
          }
        }
        t = t.return;
      }
  }
  function Ac(e, t, l) {
    var a = e.pingCache;
    if (a === null) {
      a = e.pingCache = new lm();
      var n = /* @__PURE__ */ new Set();
      a.set(t, n);
    } else
      n = a.get(t), n === void 0 && (n = /* @__PURE__ */ new Set(), a.set(t, n));
    n.has(l) || (gc = !0, n.add(l), e = cm.bind(null, e, t, l), t.then(e, e));
  }
  function cm(e, t, l) {
    var a = e.pingCache;
    a !== null && a.delete(t), e.pingedLanes |= e.suspendedLanes & l, e.warmLanes &= ~l, je === e && (re & l) === l && (Te === 4 || Te === 3 && (re & 62914560) === re && 300 > St() - jc ? (he & 2) === 0 && da(e, 0) : bc |= l, ra === re && (ra = 0)), At(e);
  }
  function So(e, t) {
    t === 0 && (t = ys()), e = kl(e, t), e !== null && (Sa(e, t), At(e));
  }
  function sm(e) {
    var t = e.memoizedState, l = 0;
    t !== null && (l = t.retryLane), So(e, l);
  }
  function rm(e, t) {
    var l = 0;
    switch (e.tag) {
      case 13:
        var a = e.stateNode, n = e.memoizedState;
        n !== null && (l = n.retryLane);
        break;
      case 19:
        a = e.stateNode;
        break;
      case 22:
        a = e.stateNode._retryCache;
        break;
      default:
        throw Error(f(314));
    }
    a !== null && a.delete(t), So(e, l);
  }
  function fm(e, t) {
    return Gu(e, t);
  }
  var bu = null, ma = null, zc = !1, pu = !1, Dc = !1, Rl = 0;
  function At(e) {
    e !== ma && e.next === null && (ma === null ? bu = ma = e : ma = ma.next = e), pu = !0, zc || (zc = !0, dm());
  }
  function un(e, t) {
    if (!Dc && pu) {
      Dc = !0;
      do
        for (var l = !1, a = bu; a !== null; ) {
          if (e !== 0) {
            var n = a.pendingLanes;
            if (n === 0) var u = 0;
            else {
              var c = a.suspendedLanes, s = a.pingedLanes;
              u = (1 << 31 - et(42 | e) + 1) - 1, u &= n & ~(c & ~s), u = u & 201326741 ? u & 201326741 | 1 : u ? u | 2 : 0;
            }
            u !== 0 && (l = !0, No(a, u));
          } else
            u = re, u = Tn(
              a,
              a === je ? u : 0,
              a.cancelPendingCommit !== null || a.timeoutHandle !== -1
            ), (u & 3) === 0 || xa(a, u) || (l = !0, No(a, u));
          a = a.next;
        }
      while (l);
      Dc = !1;
    }
  }
  function om() {
    _o();
  }
  function _o() {
    pu = zc = !1;
    var e = 0;
    Rl !== 0 && (jm() && (e = Rl), Rl = 0);
    for (var t = St(), l = null, a = bu; a !== null; ) {
      var n = a.next, u = Eo(a, t);
      u === 0 ? (a.next = null, l === null ? bu = n : l.next = n, n === null && (ma = l)) : (l = a, (e !== 0 || (u & 3) !== 0) && (pu = !0)), a = n;
    }
    un(e);
  }
  function Eo(e, t) {
    for (var l = e.suspendedLanes, a = e.pingedLanes, n = e.expirationTimes, u = e.pendingLanes & -62914561; 0 < u; ) {
      var c = 31 - et(u), s = 1 << c, h = n[c];
      h === -1 ? ((s & l) === 0 || (s & a) !== 0) && (n[c] = Hd(s, t)) : h <= t && (e.expiredLanes |= s), u &= ~s;
    }
    if (t = je, l = re, l = Tn(
      e,
      e === t ? l : 0,
      e.cancelPendingCommit !== null || e.timeoutHandle !== -1
    ), a = e.callbackNode, l === 0 || e === t && (me === 2 || me === 9) || e.cancelPendingCommit !== null)
      return a !== null && a !== null && Xu(a), e.callbackNode = null, e.callbackPriority = 0;
    if ((l & 3) === 0 || xa(e, l)) {
      if (t = l & -l, t === e.callbackPriority) return t;
      switch (a !== null && Xu(a), Lu(l)) {
        case 2:
        case 8:
          l = hs;
          break;
        case 32:
          l = Sn;
          break;
        case 268435456:
          l = ms;
          break;
        default:
          l = Sn;
      }
      return a = To.bind(null, e), l = Gu(l, a), e.callbackPriority = t, e.callbackNode = l, t;
    }
    return a !== null && a !== null && Xu(a), e.callbackPriority = 2, e.callbackNode = null, 2;
  }
  function To(e, t) {
    if (Xe !== 0 && Xe !== 5)
      return e.callbackNode = null, e.callbackPriority = 0, null;
    var l = e.callbackNode;
    if (gu() && e.callbackNode !== l)
      return null;
    var a = re;
    return a = Tn(
      e,
      e === je ? a : 0,
      e.cancelPendingCommit !== null || e.timeoutHandle !== -1
    ), a === 0 ? null : (io(e, a, t), Eo(e, St()), e.callbackNode != null && e.callbackNode === l ? To.bind(null, e) : null);
  }
  function No(e, t) {
    if (gu()) return null;
    io(e, t, !0);
  }
  function dm() {
    Sm(function() {
      (he & 6) !== 0 ? Gu(
        ds,
        om
      ) : _o();
    });
  }
  function Oc() {
    return Rl === 0 && (Rl = vs()), Rl;
  }
  function Ao(e) {
    return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : On("" + e);
  }
  function zo(e, t) {
    var l = t.ownerDocument.createElement("input");
    return l.name = t.name, l.value = t.value, e.id && l.setAttribute("form", e.id), t.parentNode.insertBefore(l, t), e = new FormData(e), l.parentNode.removeChild(l), e;
  }
  function hm(e, t, l, a, n) {
    if (t === "submit" && l && l.stateNode === n) {
      var u = Ao(
        (n[ke] || null).action
      ), c = a.submitter;
      c && (t = (t = c[ke] || null) ? Ao(t.formAction) : c.getAttribute("formAction"), t !== null && (u = t, c = null));
      var s = new wn(
        "action",
        "action",
        null,
        a,
        n
      );
      e.push({
        event: s,
        listeners: [
          {
            instance: null,
            listener: function() {
              if (a.defaultPrevented) {
                if (Rl !== 0) {
                  var h = c ? zo(n, c) : new FormData(n);
                  Wi(
                    l,
                    {
                      pending: !0,
                      data: h,
                      method: n.method,
                      action: u
                    },
                    null,
                    h
                  );
                }
              } else
                typeof u == "function" && (s.preventDefault(), h = c ? zo(n, c) : new FormData(n), Wi(
                  l,
                  {
                    pending: !0,
                    data: h,
                    method: n.method,
                    action: u
                  },
                  u,
                  h
                ));
            },
            currentTarget: n
          }
        ]
      });
    }
  }
  for (var Mc = 0; Mc < vi.length; Mc++) {
    var Uc = vi[Mc], mm = Uc.toLowerCase(), vm = Uc[0].toUpperCase() + Uc.slice(1);
    bt(
      mm,
      "on" + vm
    );
  }
  bt(ur, "onAnimationEnd"), bt(ir, "onAnimationIteration"), bt(cr, "onAnimationStart"), bt("dblclick", "onDoubleClick"), bt("focusin", "onFocus"), bt("focusout", "onBlur"), bt(Uh, "onTransitionRun"), bt(Rh, "onTransitionStart"), bt(wh, "onTransitionCancel"), bt(sr, "onTransitionEnd"), Bl("onMouseEnter", ["mouseout", "mouseover"]), Bl("onMouseLeave", ["mouseout", "mouseover"]), Bl("onPointerEnter", ["pointerout", "pointerover"]), Bl("onPointerLeave", ["pointerout", "pointerover"]), gl(
    "onChange",
    "change click focusin focusout input keydown keyup selectionchange".split(" ")
  ), gl(
    "onSelect",
    "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
      " "
    )
  ), gl("onBeforeInput", [
    "compositionend",
    "keypress",
    "textInput",
    "paste"
  ]), gl(
    "onCompositionEnd",
    "compositionend focusout keydown keypress keyup mousedown".split(" ")
  ), gl(
    "onCompositionStart",
    "compositionstart focusout keydown keypress keyup mousedown".split(" ")
  ), gl(
    "onCompositionUpdate",
    "compositionupdate focusout keydown keypress keyup mousedown".split(" ")
  );
  var cn = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
    " "
  ), ym = new Set(
    "beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(cn)
  );
  function Do(e, t) {
    t = (t & 4) !== 0;
    for (var l = 0; l < e.length; l++) {
      var a = e[l], n = a.event;
      a = a.listeners;
      e: {
        var u = void 0;
        if (t)
          for (var c = a.length - 1; 0 <= c; c--) {
            var s = a[c], h = s.instance, b = s.currentTarget;
            if (s = s.listener, h !== u && n.isPropagationStopped())
              break e;
            u = s, n.currentTarget = b;
            try {
              u(n);
            } catch (O) {
              iu(O);
            }
            n.currentTarget = null, u = h;
          }
        else
          for (c = 0; c < a.length; c++) {
            if (s = a[c], h = s.instance, b = s.currentTarget, s = s.listener, h !== u && n.isPropagationStopped())
              break e;
            u = s, n.currentTarget = b;
            try {
              u(n);
            } catch (O) {
              iu(O);
            }
            n.currentTarget = null, u = h;
          }
      }
    }
  }
  function se(e, t) {
    var l = t[Vu];
    l === void 0 && (l = t[Vu] = /* @__PURE__ */ new Set());
    var a = e + "__bubble";
    l.has(a) || (Oo(t, e, 2, !1), l.add(a));
  }
  function Rc(e, t, l) {
    var a = 0;
    t && (a |= 4), Oo(
      l,
      e,
      a,
      t
    );
  }
  var ju = "_reactListening" + Math.random().toString(36).slice(2);
  function wc(e) {
    if (!e[ju]) {
      e[ju] = !0, xs.forEach(function(l) {
        l !== "selectionchange" && (ym.has(l) || Rc(l, !1, e), Rc(l, !0, e));
      });
      var t = e.nodeType === 9 ? e : e.ownerDocument;
      t === null || t[ju] || (t[ju] = !0, Rc("selectionchange", !1, t));
    }
  }
  function Oo(e, t, l, a) {
    switch (ed(t)) {
      case 2:
        var n = Zm;
        break;
      case 8:
        n = Lm;
        break;
      default:
        n = kc;
    }
    l = n.bind(
      null,
      t,
      l,
      e
    ), n = void 0, !li || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (n = !0), a ? n !== void 0 ? e.addEventListener(t, l, {
      capture: !0,
      passive: n
    }) : e.addEventListener(t, l, !0) : n !== void 0 ? e.addEventListener(t, l, {
      passive: n
    }) : e.addEventListener(t, l, !1);
  }
  function Cc(e, t, l, a, n) {
    var u = a;
    if ((t & 1) === 0 && (t & 2) === 0 && a !== null)
      e: for (; ; ) {
        if (a === null) return;
        var c = a.tag;
        if (c === 3 || c === 4) {
          var s = a.stateNode.containerInfo;
          if (s === n) break;
          if (c === 4)
            for (c = a.return; c !== null; ) {
              var h = c.tag;
              if ((h === 3 || h === 4) && c.stateNode.containerInfo === n)
                return;
              c = c.return;
            }
          for (; s !== null; ) {
            if (c = Cl(s), c === null) return;
            if (h = c.tag, h === 5 || h === 6 || h === 26 || h === 27) {
              a = u = c;
              continue e;
            }
            s = s.parentNode;
          }
        }
        a = a.return;
      }
    Cs(function() {
      var b = u, O = ei(l), R = [];
      e: {
        var x = rr.get(e);
        if (x !== void 0) {
          var S = wn, ee = e;
          switch (e) {
            case "keypress":
              if (Un(l) === 0) break e;
            case "keydown":
            case "keyup":
              S = fh;
              break;
            case "focusin":
              ee = "focus", S = ii;
              break;
            case "focusout":
              ee = "blur", S = ii;
              break;
            case "beforeblur":
            case "afterblur":
              S = ii;
              break;
            case "click":
              if (l.button === 2) break e;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              S = Bs;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              S = Pd;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              S = hh;
              break;
            case ur:
            case ir:
            case cr:
              S = th;
              break;
            case sr:
              S = vh;
              break;
            case "scroll":
            case "scrollend":
              S = Wd;
              break;
            case "wheel":
              S = gh;
              break;
            case "copy":
            case "cut":
            case "paste":
              S = ah;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              S = Gs;
              break;
            case "toggle":
            case "beforetoggle":
              S = ph;
          }
          var W = (t & 4) !== 0, be = !W && (e === "scroll" || e === "scrollend"), y = W ? x !== null ? x + "Capture" : null : x;
          W = [];
          for (var v = b, g; v !== null; ) {
            var M = v;
            if (g = M.stateNode, M = M.tag, M !== 5 && M !== 26 && M !== 27 || g === null || y === null || (M = Ta(v, y), M != null && W.push(
              sn(v, M, g)
            )), be) break;
            v = v.return;
          }
          0 < W.length && (x = new S(
            x,
            ee,
            null,
            l,
            O
          ), R.push({ event: x, listeners: W }));
        }
      }
      if ((t & 7) === 0) {
        e: {
          if (x = e === "mouseover" || e === "pointerover", S = e === "mouseout" || e === "pointerout", x && l !== Iu && (ee = l.relatedTarget || l.fromElement) && (Cl(ee) || ee[wl]))
            break e;
          if ((S || x) && (x = O.window === O ? O : (x = O.ownerDocument) ? x.defaultView || x.parentWindow : window, S ? (ee = l.relatedTarget || l.toElement, S = b, ee = ee ? Cl(ee) : null, ee !== null && (be = z(ee), W = ee.tag, ee !== be || W !== 5 && W !== 27 && W !== 6) && (ee = null)) : (S = null, ee = b), S !== ee)) {
            if (W = Bs, M = "onMouseLeave", y = "onMouseEnter", v = "mouse", (e === "pointerout" || e === "pointerover") && (W = Gs, M = "onPointerLeave", y = "onPointerEnter", v = "pointer"), be = S == null ? x : Ea(S), g = ee == null ? x : Ea(ee), x = new W(
              M,
              v + "leave",
              S,
              l,
              O
            ), x.target = be, x.relatedTarget = g, M = null, Cl(O) === b && (W = new W(
              y,
              v + "enter",
              ee,
              l,
              O
            ), W.target = g, W.relatedTarget = be, M = W), be = M, S && ee)
              t: {
                for (W = S, y = ee, v = 0, g = W; g; g = va(g))
                  v++;
                for (g = 0, M = y; M; M = va(M))
                  g++;
                for (; 0 < v - g; )
                  W = va(W), v--;
                for (; 0 < g - v; )
                  y = va(y), g--;
                for (; v--; ) {
                  if (W === y || y !== null && W === y.alternate)
                    break t;
                  W = va(W), y = va(y);
                }
                W = null;
              }
            else W = null;
            S !== null && Mo(
              R,
              x,
              S,
              W,
              !1
            ), ee !== null && be !== null && Mo(
              R,
              be,
              ee,
              W,
              !0
            );
          }
        }
        e: {
          if (x = b ? Ea(b) : window, S = x.nodeName && x.nodeName.toLowerCase(), S === "select" || S === "input" && x.type === "file")
            var X = ks;
          else if (Ks(x))
            if ($s)
              X = Dh;
            else {
              X = Ah;
              var ie = Nh;
            }
          else
            S = x.nodeName, !S || S.toLowerCase() !== "input" || x.type !== "checkbox" && x.type !== "radio" ? b && Pu(b.elementType) && (X = ks) : X = zh;
          if (X && (X = X(e, b))) {
            Js(
              R,
              X,
              l,
              O
            );
            break e;
          }
          ie && ie(e, x, b), e === "focusout" && b && x.type === "number" && b.memoizedProps.value != null && Fu(x, "number", x.value);
        }
        switch (ie = b ? Ea(b) : window, e) {
          case "focusin":
            (Ks(ie) || ie.contentEditable === "true") && (Vl = ie, di = b, Ra = null);
            break;
          case "focusout":
            Ra = di = Vl = null;
            break;
          case "mousedown":
            hi = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            hi = !1, ar(R, l, O);
            break;
          case "selectionchange":
            if (Mh) break;
          case "keydown":
          case "keyup":
            ar(R, l, O);
        }
        var J;
        if (si)
          e: {
            switch (e) {
              case "compositionstart":
                var F = "onCompositionStart";
                break e;
              case "compositionend":
                F = "onCompositionEnd";
                break e;
              case "compositionupdate":
                F = "onCompositionUpdate";
                break e;
            }
            F = void 0;
          }
        else
          Ll ? Ls(e, l) && (F = "onCompositionEnd") : e === "keydown" && l.keyCode === 229 && (F = "onCompositionStart");
        F && (Xs && l.locale !== "ko" && (Ll || F !== "onCompositionStart" ? F === "onCompositionEnd" && Ll && (J = qs()) : (kt = O, ai = "value" in kt ? kt.value : kt.textContent, Ll = !0)), ie = xu(b, F), 0 < ie.length && (F = new Ys(
          F,
          e,
          null,
          l,
          O
        ), R.push({ event: F, listeners: ie }), J ? F.data = J : (J = Vs(l), J !== null && (F.data = J)))), (J = xh ? Sh(e, l) : _h(e, l)) && (F = xu(b, "onBeforeInput"), 0 < F.length && (ie = new Ys(
          "onBeforeInput",
          "beforeinput",
          null,
          l,
          O
        ), R.push({
          event: ie,
          listeners: F
        }), ie.data = J)), hm(
          R,
          e,
          b,
          l,
          O
        );
      }
      Do(R, t);
    });
  }
  function sn(e, t, l) {
    return {
      instance: e,
      listener: t,
      currentTarget: l
    };
  }
  function xu(e, t) {
    for (var l = t + "Capture", a = []; e !== null; ) {
      var n = e, u = n.stateNode;
      if (n = n.tag, n !== 5 && n !== 26 && n !== 27 || u === null || (n = Ta(e, l), n != null && a.unshift(
        sn(e, n, u)
      ), n = Ta(e, t), n != null && a.push(
        sn(e, n, u)
      )), e.tag === 3) return a;
      e = e.return;
    }
    return [];
  }
  function va(e) {
    if (e === null) return null;
    do
      e = e.return;
    while (e && e.tag !== 5 && e.tag !== 27);
    return e || null;
  }
  function Mo(e, t, l, a, n) {
    for (var u = t._reactName, c = []; l !== null && l !== a; ) {
      var s = l, h = s.alternate, b = s.stateNode;
      if (s = s.tag, h !== null && h === a) break;
      s !== 5 && s !== 26 && s !== 27 || b === null || (h = b, n ? (b = Ta(l, u), b != null && c.unshift(
        sn(l, b, h)
      )) : n || (b = Ta(l, u), b != null && c.push(
        sn(l, b, h)
      ))), l = l.return;
    }
    c.length !== 0 && e.push({ event: t, listeners: c });
  }
  var gm = /\r\n?/g, bm = /\u0000|\uFFFD/g;
  function Uo(e) {
    return (typeof e == "string" ? e : "" + e).replace(gm, `
`).replace(bm, "");
  }
  function Ro(e, t) {
    return t = Uo(t), Uo(e) === t;
  }
  function Su() {
  }
  function ge(e, t, l, a, n, u) {
    switch (l) {
      case "children":
        typeof a == "string" ? t === "body" || t === "textarea" && a === "" || Xl(e, a) : (typeof a == "number" || typeof a == "bigint") && t !== "body" && Xl(e, "" + a);
        break;
      case "className":
        An(e, "class", a);
        break;
      case "tabIndex":
        An(e, "tabindex", a);
        break;
      case "dir":
      case "role":
      case "viewBox":
      case "width":
      case "height":
        An(e, l, a);
        break;
      case "style":
        Rs(e, a, u);
        break;
      case "data":
        if (t !== "object") {
          An(e, "data", a);
          break;
        }
      case "src":
      case "href":
        if (a === "" && (t !== "a" || l !== "href")) {
          e.removeAttribute(l);
          break;
        }
        if (a == null || typeof a == "function" || typeof a == "symbol" || typeof a == "boolean") {
          e.removeAttribute(l);
          break;
        }
        a = On("" + a), e.setAttribute(l, a);
        break;
      case "action":
      case "formAction":
        if (typeof a == "function") {
          e.setAttribute(
            l,
            "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')"
          );
          break;
        } else
          typeof u == "function" && (l === "formAction" ? (t !== "input" && ge(e, t, "name", n.name, n, null), ge(
            e,
            t,
            "formEncType",
            n.formEncType,
            n,
            null
          ), ge(
            e,
            t,
            "formMethod",
            n.formMethod,
            n,
            null
          ), ge(
            e,
            t,
            "formTarget",
            n.formTarget,
            n,
            null
          )) : (ge(e, t, "encType", n.encType, n, null), ge(e, t, "method", n.method, n, null), ge(e, t, "target", n.target, n, null)));
        if (a == null || typeof a == "symbol" || typeof a == "boolean") {
          e.removeAttribute(l);
          break;
        }
        a = On("" + a), e.setAttribute(l, a);
        break;
      case "onClick":
        a != null && (e.onclick = Su);
        break;
      case "onScroll":
        a != null && se("scroll", e);
        break;
      case "onScrollEnd":
        a != null && se("scrollend", e);
        break;
      case "dangerouslySetInnerHTML":
        if (a != null) {
          if (typeof a != "object" || !("__html" in a))
            throw Error(f(61));
          if (l = a.__html, l != null) {
            if (n.children != null) throw Error(f(60));
            e.innerHTML = l;
          }
        }
        break;
      case "multiple":
        e.multiple = a && typeof a != "function" && typeof a != "symbol";
        break;
      case "muted":
        e.muted = a && typeof a != "function" && typeof a != "symbol";
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "ref":
        break;
      case "autoFocus":
        break;
      case "xlinkHref":
        if (a == null || typeof a == "function" || typeof a == "boolean" || typeof a == "symbol") {
          e.removeAttribute("xlink:href");
          break;
        }
        l = On("" + a), e.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          "xlink:href",
          l
        );
        break;
      case "contentEditable":
      case "spellCheck":
      case "draggable":
      case "value":
      case "autoReverse":
      case "externalResourcesRequired":
      case "focusable":
      case "preserveAlpha":
        a != null && typeof a != "function" && typeof a != "symbol" ? e.setAttribute(l, "" + a) : e.removeAttribute(l);
        break;
      case "inert":
      case "allowFullScreen":
      case "async":
      case "autoPlay":
      case "controls":
      case "default":
      case "defer":
      case "disabled":
      case "disablePictureInPicture":
      case "disableRemotePlayback":
      case "formNoValidate":
      case "hidden":
      case "loop":
      case "noModule":
      case "noValidate":
      case "open":
      case "playsInline":
      case "readOnly":
      case "required":
      case "reversed":
      case "scoped":
      case "seamless":
      case "itemScope":
        a && typeof a != "function" && typeof a != "symbol" ? e.setAttribute(l, "") : e.removeAttribute(l);
        break;
      case "capture":
      case "download":
        a === !0 ? e.setAttribute(l, "") : a !== !1 && a != null && typeof a != "function" && typeof a != "symbol" ? e.setAttribute(l, a) : e.removeAttribute(l);
        break;
      case "cols":
      case "rows":
      case "size":
      case "span":
        a != null && typeof a != "function" && typeof a != "symbol" && !isNaN(a) && 1 <= a ? e.setAttribute(l, a) : e.removeAttribute(l);
        break;
      case "rowSpan":
      case "start":
        a == null || typeof a == "function" || typeof a == "symbol" || isNaN(a) ? e.removeAttribute(l) : e.setAttribute(l, a);
        break;
      case "popover":
        se("beforetoggle", e), se("toggle", e), Nn(e, "popover", a);
        break;
      case "xlinkActuate":
        Ot(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:actuate",
          a
        );
        break;
      case "xlinkArcrole":
        Ot(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:arcrole",
          a
        );
        break;
      case "xlinkRole":
        Ot(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:role",
          a
        );
        break;
      case "xlinkShow":
        Ot(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:show",
          a
        );
        break;
      case "xlinkTitle":
        Ot(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:title",
          a
        );
        break;
      case "xlinkType":
        Ot(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:type",
          a
        );
        break;
      case "xmlBase":
        Ot(
          e,
          "http://www.w3.org/XML/1998/namespace",
          "xml:base",
          a
        );
        break;
      case "xmlLang":
        Ot(
          e,
          "http://www.w3.org/XML/1998/namespace",
          "xml:lang",
          a
        );
        break;
      case "xmlSpace":
        Ot(
          e,
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          a
        );
        break;
      case "is":
        Nn(e, "is", a);
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        (!(2 < l.length) || l[0] !== "o" && l[0] !== "O" || l[1] !== "n" && l[1] !== "N") && (l = kd.get(l) || l, Nn(e, l, a));
    }
  }
  function qc(e, t, l, a, n, u) {
    switch (l) {
      case "style":
        Rs(e, a, u);
        break;
      case "dangerouslySetInnerHTML":
        if (a != null) {
          if (typeof a != "object" || !("__html" in a))
            throw Error(f(61));
          if (l = a.__html, l != null) {
            if (n.children != null) throw Error(f(60));
            e.innerHTML = l;
          }
        }
        break;
      case "children":
        typeof a == "string" ? Xl(e, a) : (typeof a == "number" || typeof a == "bigint") && Xl(e, "" + a);
        break;
      case "onScroll":
        a != null && se("scroll", e);
        break;
      case "onScrollEnd":
        a != null && se("scrollend", e);
        break;
      case "onClick":
        a != null && (e.onclick = Su);
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "innerHTML":
      case "ref":
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        if (!Ss.hasOwnProperty(l))
          e: {
            if (l[0] === "o" && l[1] === "n" && (n = l.endsWith("Capture"), t = l.slice(2, n ? l.length - 7 : void 0), u = e[ke] || null, u = u != null ? u[l] : null, typeof u == "function" && e.removeEventListener(t, u, n), typeof a == "function")) {
              typeof u != "function" && u !== null && (l in e ? e[l] = null : e.hasAttribute(l) && e.removeAttribute(l)), e.addEventListener(t, a, n);
              break e;
            }
            l in e ? e[l] = a : a === !0 ? e.setAttribute(l, "") : Nn(e, l, a);
          }
    }
  }
  function Qe(e, t, l) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "img":
        se("error", e), se("load", e);
        var a = !1, n = !1, u;
        for (u in l)
          if (l.hasOwnProperty(u)) {
            var c = l[u];
            if (c != null)
              switch (u) {
                case "src":
                  a = !0;
                  break;
                case "srcSet":
                  n = !0;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(f(137, t));
                default:
                  ge(e, t, u, c, l, null);
              }
          }
        n && ge(e, t, "srcSet", l.srcSet, l, null), a && ge(e, t, "src", l.src, l, null);
        return;
      case "input":
        se("invalid", e);
        var s = u = c = n = null, h = null, b = null;
        for (a in l)
          if (l.hasOwnProperty(a)) {
            var O = l[a];
            if (O != null)
              switch (a) {
                case "name":
                  n = O;
                  break;
                case "type":
                  c = O;
                  break;
                case "checked":
                  h = O;
                  break;
                case "defaultChecked":
                  b = O;
                  break;
                case "value":
                  u = O;
                  break;
                case "defaultValue":
                  s = O;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (O != null)
                    throw Error(f(137, t));
                  break;
                default:
                  ge(e, t, a, O, l, null);
              }
          }
        Ds(
          e,
          u,
          s,
          h,
          b,
          c,
          n,
          !1
        ), zn(e);
        return;
      case "select":
        se("invalid", e), a = c = u = null;
        for (n in l)
          if (l.hasOwnProperty(n) && (s = l[n], s != null))
            switch (n) {
              case "value":
                u = s;
                break;
              case "defaultValue":
                c = s;
                break;
              case "multiple":
                a = s;
              default:
                ge(e, t, n, s, l, null);
            }
        t = u, l = c, e.multiple = !!a, t != null ? Gl(e, !!a, t, !1) : l != null && Gl(e, !!a, l, !0);
        return;
      case "textarea":
        se("invalid", e), u = n = a = null;
        for (c in l)
          if (l.hasOwnProperty(c) && (s = l[c], s != null))
            switch (c) {
              case "value":
                a = s;
                break;
              case "defaultValue":
                n = s;
                break;
              case "children":
                u = s;
                break;
              case "dangerouslySetInnerHTML":
                if (s != null) throw Error(f(91));
                break;
              default:
                ge(e, t, c, s, l, null);
            }
        Ms(e, a, n, u), zn(e);
        return;
      case "option":
        for (h in l)
          if (l.hasOwnProperty(h) && (a = l[h], a != null))
            switch (h) {
              case "selected":
                e.selected = a && typeof a != "function" && typeof a != "symbol";
                break;
              default:
                ge(e, t, h, a, l, null);
            }
        return;
      case "dialog":
        se("beforetoggle", e), se("toggle", e), se("cancel", e), se("close", e);
        break;
      case "iframe":
      case "object":
        se("load", e);
        break;
      case "video":
      case "audio":
        for (a = 0; a < cn.length; a++)
          se(cn[a], e);
        break;
      case "image":
        se("error", e), se("load", e);
        break;
      case "details":
        se("toggle", e);
        break;
      case "embed":
      case "source":
      case "link":
        se("error", e), se("load", e);
      case "area":
      case "base":
      case "br":
      case "col":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "track":
      case "wbr":
      case "menuitem":
        for (b in l)
          if (l.hasOwnProperty(b) && (a = l[b], a != null))
            switch (b) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(f(137, t));
              default:
                ge(e, t, b, a, l, null);
            }
        return;
      default:
        if (Pu(t)) {
          for (O in l)
            l.hasOwnProperty(O) && (a = l[O], a !== void 0 && qc(
              e,
              t,
              O,
              a,
              l,
              void 0
            ));
          return;
        }
    }
    for (s in l)
      l.hasOwnProperty(s) && (a = l[s], a != null && ge(e, t, s, a, l, null));
  }
  function pm(e, t, l, a) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "input":
        var n = null, u = null, c = null, s = null, h = null, b = null, O = null;
        for (S in l) {
          var R = l[S];
          if (l.hasOwnProperty(S) && R != null)
            switch (S) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                h = R;
              default:
                a.hasOwnProperty(S) || ge(e, t, S, null, a, R);
            }
        }
        for (var x in a) {
          var S = a[x];
          if (R = l[x], a.hasOwnProperty(x) && (S != null || R != null))
            switch (x) {
              case "type":
                u = S;
                break;
              case "name":
                n = S;
                break;
              case "checked":
                b = S;
                break;
              case "defaultChecked":
                O = S;
                break;
              case "value":
                c = S;
                break;
              case "defaultValue":
                s = S;
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (S != null)
                  throw Error(f(137, t));
                break;
              default:
                S !== R && ge(
                  e,
                  t,
                  x,
                  S,
                  a,
                  R
                );
            }
        }
        Wu(
          e,
          c,
          s,
          h,
          b,
          O,
          u,
          n
        );
        return;
      case "select":
        S = c = s = x = null;
        for (u in l)
          if (h = l[u], l.hasOwnProperty(u) && h != null)
            switch (u) {
              case "value":
                break;
              case "multiple":
                S = h;
              default:
                a.hasOwnProperty(u) || ge(
                  e,
                  t,
                  u,
                  null,
                  a,
                  h
                );
            }
        for (n in a)
          if (u = a[n], h = l[n], a.hasOwnProperty(n) && (u != null || h != null))
            switch (n) {
              case "value":
                x = u;
                break;
              case "defaultValue":
                s = u;
                break;
              case "multiple":
                c = u;
              default:
                u !== h && ge(
                  e,
                  t,
                  n,
                  u,
                  a,
                  h
                );
            }
        t = s, l = c, a = S, x != null ? Gl(e, !!l, x, !1) : !!a != !!l && (t != null ? Gl(e, !!l, t, !0) : Gl(e, !!l, l ? [] : "", !1));
        return;
      case "textarea":
        S = x = null;
        for (s in l)
          if (n = l[s], l.hasOwnProperty(s) && n != null && !a.hasOwnProperty(s))
            switch (s) {
              case "value":
                break;
              case "children":
                break;
              default:
                ge(e, t, s, null, a, n);
            }
        for (c in a)
          if (n = a[c], u = l[c], a.hasOwnProperty(c) && (n != null || u != null))
            switch (c) {
              case "value":
                x = n;
                break;
              case "defaultValue":
                S = n;
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (n != null) throw Error(f(91));
                break;
              default:
                n !== u && ge(e, t, c, n, a, u);
            }
        Os(e, x, S);
        return;
      case "option":
        for (var ee in l)
          if (x = l[ee], l.hasOwnProperty(ee) && x != null && !a.hasOwnProperty(ee))
            switch (ee) {
              case "selected":
                e.selected = !1;
                break;
              default:
                ge(
                  e,
                  t,
                  ee,
                  null,
                  a,
                  x
                );
            }
        for (h in a)
          if (x = a[h], S = l[h], a.hasOwnProperty(h) && x !== S && (x != null || S != null))
            switch (h) {
              case "selected":
                e.selected = x && typeof x != "function" && typeof x != "symbol";
                break;
              default:
                ge(
                  e,
                  t,
                  h,
                  x,
                  a,
                  S
                );
            }
        return;
      case "img":
      case "link":
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
      case "menuitem":
        for (var W in l)
          x = l[W], l.hasOwnProperty(W) && x != null && !a.hasOwnProperty(W) && ge(e, t, W, null, a, x);
        for (b in a)
          if (x = a[b], S = l[b], a.hasOwnProperty(b) && x !== S && (x != null || S != null))
            switch (b) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (x != null)
                  throw Error(f(137, t));
                break;
              default:
                ge(
                  e,
                  t,
                  b,
                  x,
                  a,
                  S
                );
            }
        return;
      default:
        if (Pu(t)) {
          for (var be in l)
            x = l[be], l.hasOwnProperty(be) && x !== void 0 && !a.hasOwnProperty(be) && qc(
              e,
              t,
              be,
              void 0,
              a,
              x
            );
          for (O in a)
            x = a[O], S = l[O], !a.hasOwnProperty(O) || x === S || x === void 0 && S === void 0 || qc(
              e,
              t,
              O,
              x,
              a,
              S
            );
          return;
        }
    }
    for (var y in l)
      x = l[y], l.hasOwnProperty(y) && x != null && !a.hasOwnProperty(y) && ge(e, t, y, null, a, x);
    for (R in a)
      x = a[R], S = l[R], !a.hasOwnProperty(R) || x === S || x == null && S == null || ge(e, t, R, x, a, S);
  }
  var Hc = null, Bc = null;
  function _u(e) {
    return e.nodeType === 9 ? e : e.ownerDocument;
  }
  function wo(e) {
    switch (e) {
      case "http://www.w3.org/2000/svg":
        return 1;
      case "http://www.w3.org/1998/Math/MathML":
        return 2;
      default:
        return 0;
    }
  }
  function Co(e, t) {
    if (e === 0)
      switch (t) {
        case "svg":
          return 1;
        case "math":
          return 2;
        default:
          return 0;
      }
    return e === 1 && t === "foreignObject" ? 0 : e;
  }
  function Yc(e, t) {
    return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
  }
  var Gc = null;
  function jm() {
    var e = window.event;
    return e && e.type === "popstate" ? e === Gc ? !1 : (Gc = e, !0) : (Gc = null, !1);
  }
  var qo = typeof setTimeout == "function" ? setTimeout : void 0, xm = typeof clearTimeout == "function" ? clearTimeout : void 0, Ho = typeof Promise == "function" ? Promise : void 0, Sm = typeof queueMicrotask == "function" ? queueMicrotask : typeof Ho < "u" ? function(e) {
    return Ho.resolve(null).then(e).catch(_m);
  } : qo;
  function _m(e) {
    setTimeout(function() {
      throw e;
    });
  }
  function fl(e) {
    return e === "head";
  }
  function Bo(e, t) {
    var l = t, a = 0, n = 0;
    do {
      var u = l.nextSibling;
      if (e.removeChild(l), u && u.nodeType === 8)
        if (l = u.data, l === "/$") {
          if (0 < a && 8 > a) {
            l = a;
            var c = e.ownerDocument;
            if (l & 1 && rn(c.documentElement), l & 2 && rn(c.body), l & 4)
              for (l = c.head, rn(l), c = l.firstChild; c; ) {
                var s = c.nextSibling, h = c.nodeName;
                c[_a] || h === "SCRIPT" || h === "STYLE" || h === "LINK" && c.rel.toLowerCase() === "stylesheet" || l.removeChild(c), c = s;
              }
          }
          if (n === 0) {
            e.removeChild(u), gn(t);
            return;
          }
          n--;
        } else
          l === "$" || l === "$?" || l === "$!" ? n++ : a = l.charCodeAt(0) - 48;
      else a = 0;
      l = u;
    } while (l);
    gn(t);
  }
  function Xc(e) {
    var t = e.firstChild;
    for (t && t.nodeType === 10 && (t = t.nextSibling); t; ) {
      var l = t;
      switch (t = t.nextSibling, l.nodeName) {
        case "HTML":
        case "HEAD":
        case "BODY":
          Xc(l), Ku(l);
          continue;
        case "SCRIPT":
        case "STYLE":
          continue;
        case "LINK":
          if (l.rel.toLowerCase() === "stylesheet") continue;
      }
      e.removeChild(l);
    }
  }
  function Em(e, t, l, a) {
    for (; e.nodeType === 1; ) {
      var n = l;
      if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
        if (!a && (e.nodeName !== "INPUT" || e.type !== "hidden"))
          break;
      } else if (a) {
        if (!e[_a])
          switch (t) {
            case "meta":
              if (!e.hasAttribute("itemprop")) break;
              return e;
            case "link":
              if (u = e.getAttribute("rel"), u === "stylesheet" && e.hasAttribute("data-precedence"))
                break;
              if (u !== n.rel || e.getAttribute("href") !== (n.href == null || n.href === "" ? null : n.href) || e.getAttribute("crossorigin") !== (n.crossOrigin == null ? null : n.crossOrigin) || e.getAttribute("title") !== (n.title == null ? null : n.title))
                break;
              return e;
            case "style":
              if (e.hasAttribute("data-precedence")) break;
              return e;
            case "script":
              if (u = e.getAttribute("src"), (u !== (n.src == null ? null : n.src) || e.getAttribute("type") !== (n.type == null ? null : n.type) || e.getAttribute("crossorigin") !== (n.crossOrigin == null ? null : n.crossOrigin)) && u && e.hasAttribute("async") && !e.hasAttribute("itemprop"))
                break;
              return e;
            default:
              return e;
          }
      } else if (t === "input" && e.type === "hidden") {
        var u = n.name == null ? null : "" + n.name;
        if (n.type === "hidden" && e.getAttribute("name") === u)
          return e;
      } else return e;
      if (e = jt(e.nextSibling), e === null) break;
    }
    return null;
  }
  function Tm(e, t, l) {
    if (t === "") return null;
    for (; e.nodeType !== 3; )
      if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !l || (e = jt(e.nextSibling), e === null)) return null;
    return e;
  }
  function Qc(e) {
    return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState === "complete";
  }
  function Nm(e, t) {
    var l = e.ownerDocument;
    if (e.data !== "$?" || l.readyState === "complete")
      t();
    else {
      var a = function() {
        t(), l.removeEventListener("DOMContentLoaded", a);
      };
      l.addEventListener("DOMContentLoaded", a), e._reactRetry = a;
    }
  }
  function jt(e) {
    for (; e != null; e = e.nextSibling) {
      var t = e.nodeType;
      if (t === 1 || t === 3) break;
      if (t === 8) {
        if (t = e.data, t === "$" || t === "$!" || t === "$?" || t === "F!" || t === "F")
          break;
        if (t === "/$") return null;
      }
    }
    return e;
  }
  var Zc = null;
  function Yo(e) {
    e = e.previousSibling;
    for (var t = 0; e; ) {
      if (e.nodeType === 8) {
        var l = e.data;
        if (l === "$" || l === "$!" || l === "$?") {
          if (t === 0) return e;
          t--;
        } else l === "/$" && t++;
      }
      e = e.previousSibling;
    }
    return null;
  }
  function Go(e, t, l) {
    switch (t = _u(l), e) {
      case "html":
        if (e = t.documentElement, !e) throw Error(f(452));
        return e;
      case "head":
        if (e = t.head, !e) throw Error(f(453));
        return e;
      case "body":
        if (e = t.body, !e) throw Error(f(454));
        return e;
      default:
        throw Error(f(451));
    }
  }
  function rn(e) {
    for (var t = e.attributes; t.length; )
      e.removeAttributeNode(t[0]);
    Ku(e);
  }
  var gt = /* @__PURE__ */ new Map(), Xo = /* @__PURE__ */ new Set();
  function Eu(e) {
    return typeof e.getRootNode == "function" ? e.getRootNode() : e.nodeType === 9 ? e : e.ownerDocument;
  }
  var Lt = Y.d;
  Y.d = {
    f: Am,
    r: zm,
    D: Dm,
    C: Om,
    L: Mm,
    m: Um,
    X: wm,
    S: Rm,
    M: Cm
  };
  function Am() {
    var e = Lt.f(), t = vu();
    return e || t;
  }
  function zm(e) {
    var t = ql(e);
    t !== null && t.tag === 5 && t.type === "form" ? uf(t) : Lt.r(e);
  }
  var ya = typeof document > "u" ? null : document;
  function Qo(e, t, l) {
    var a = ya;
    if (a && typeof t == "string" && t) {
      var n = ft(t);
      n = 'link[rel="' + e + '"][href="' + n + '"]', typeof l == "string" && (n += '[crossorigin="' + l + '"]'), Xo.has(n) || (Xo.add(n), e = { rel: e, crossOrigin: l, href: t }, a.querySelector(n) === null && (t = a.createElement("link"), Qe(t, "link", e), Ce(t), a.head.appendChild(t)));
    }
  }
  function Dm(e) {
    Lt.D(e), Qo("dns-prefetch", e, null);
  }
  function Om(e, t) {
    Lt.C(e, t), Qo("preconnect", e, t);
  }
  function Mm(e, t, l) {
    Lt.L(e, t, l);
    var a = ya;
    if (a && e && t) {
      var n = 'link[rel="preload"][as="' + ft(t) + '"]';
      t === "image" && l && l.imageSrcSet ? (n += '[imagesrcset="' + ft(
        l.imageSrcSet
      ) + '"]', typeof l.imageSizes == "string" && (n += '[imagesizes="' + ft(
        l.imageSizes
      ) + '"]')) : n += '[href="' + ft(e) + '"]';
      var u = n;
      switch (t) {
        case "style":
          u = ga(e);
          break;
        case "script":
          u = ba(e);
      }
      gt.has(u) || (e = A(
        {
          rel: "preload",
          href: t === "image" && l && l.imageSrcSet ? void 0 : e,
          as: t
        },
        l
      ), gt.set(u, e), a.querySelector(n) !== null || t === "style" && a.querySelector(fn(u)) || t === "script" && a.querySelector(on(u)) || (t = a.createElement("link"), Qe(t, "link", e), Ce(t), a.head.appendChild(t)));
    }
  }
  function Um(e, t) {
    Lt.m(e, t);
    var l = ya;
    if (l && e) {
      var a = t && typeof t.as == "string" ? t.as : "script", n = 'link[rel="modulepreload"][as="' + ft(a) + '"][href="' + ft(e) + '"]', u = n;
      switch (a) {
        case "audioworklet":
        case "paintworklet":
        case "serviceworker":
        case "sharedworker":
        case "worker":
        case "script":
          u = ba(e);
      }
      if (!gt.has(u) && (e = A({ rel: "modulepreload", href: e }, t), gt.set(u, e), l.querySelector(n) === null)) {
        switch (a) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            if (l.querySelector(on(u)))
              return;
        }
        a = l.createElement("link"), Qe(a, "link", e), Ce(a), l.head.appendChild(a);
      }
    }
  }
  function Rm(e, t, l) {
    Lt.S(e, t, l);
    var a = ya;
    if (a && e) {
      var n = Hl(a).hoistableStyles, u = ga(e);
      t = t || "default";
      var c = n.get(u);
      if (!c) {
        var s = { loading: 0, preload: null };
        if (c = a.querySelector(
          fn(u)
        ))
          s.loading = 5;
        else {
          e = A(
            { rel: "stylesheet", href: e, "data-precedence": t },
            l
          ), (l = gt.get(u)) && Lc(e, l);
          var h = c = a.createElement("link");
          Ce(h), Qe(h, "link", e), h._p = new Promise(function(b, O) {
            h.onload = b, h.onerror = O;
          }), h.addEventListener("load", function() {
            s.loading |= 1;
          }), h.addEventListener("error", function() {
            s.loading |= 2;
          }), s.loading |= 4, Tu(c, t, a);
        }
        c = {
          type: "stylesheet",
          instance: c,
          count: 1,
          state: s
        }, n.set(u, c);
      }
    }
  }
  function wm(e, t) {
    Lt.X(e, t);
    var l = ya;
    if (l && e) {
      var a = Hl(l).hoistableScripts, n = ba(e), u = a.get(n);
      u || (u = l.querySelector(on(n)), u || (e = A({ src: e, async: !0 }, t), (t = gt.get(n)) && Vc(e, t), u = l.createElement("script"), Ce(u), Qe(u, "link", e), l.head.appendChild(u)), u = {
        type: "script",
        instance: u,
        count: 1,
        state: null
      }, a.set(n, u));
    }
  }
  function Cm(e, t) {
    Lt.M(e, t);
    var l = ya;
    if (l && e) {
      var a = Hl(l).hoistableScripts, n = ba(e), u = a.get(n);
      u || (u = l.querySelector(on(n)), u || (e = A({ src: e, async: !0, type: "module" }, t), (t = gt.get(n)) && Vc(e, t), u = l.createElement("script"), Ce(u), Qe(u, "link", e), l.head.appendChild(u)), u = {
        type: "script",
        instance: u,
        count: 1,
        state: null
      }, a.set(n, u));
    }
  }
  function Zo(e, t, l, a) {
    var n = (n = K.current) ? Eu(n) : null;
    if (!n) throw Error(f(446));
    switch (e) {
      case "meta":
      case "title":
        return null;
      case "style":
        return typeof l.precedence == "string" && typeof l.href == "string" ? (t = ga(l.href), l = Hl(
          n
        ).hoistableStyles, a = l.get(t), a || (a = {
          type: "style",
          instance: null,
          count: 0,
          state: null
        }, l.set(t, a)), a) : { type: "void", instance: null, count: 0, state: null };
      case "link":
        if (l.rel === "stylesheet" && typeof l.href == "string" && typeof l.precedence == "string") {
          e = ga(l.href);
          var u = Hl(
            n
          ).hoistableStyles, c = u.get(e);
          if (c || (n = n.ownerDocument || n, c = {
            type: "stylesheet",
            instance: null,
            count: 0,
            state: { loading: 0, preload: null }
          }, u.set(e, c), (u = n.querySelector(
            fn(e)
          )) && !u._p && (c.instance = u, c.state.loading = 5), gt.has(e) || (l = {
            rel: "preload",
            as: "style",
            href: l.href,
            crossOrigin: l.crossOrigin,
            integrity: l.integrity,
            media: l.media,
            hrefLang: l.hrefLang,
            referrerPolicy: l.referrerPolicy
          }, gt.set(e, l), u || qm(
            n,
            e,
            l,
            c.state
          ))), t && a === null)
            throw Error(f(528, ""));
          return c;
        }
        if (t && a !== null)
          throw Error(f(529, ""));
        return null;
      case "script":
        return t = l.async, l = l.src, typeof l == "string" && t && typeof t != "function" && typeof t != "symbol" ? (t = ba(l), l = Hl(
          n
        ).hoistableScripts, a = l.get(t), a || (a = {
          type: "script",
          instance: null,
          count: 0,
          state: null
        }, l.set(t, a)), a) : { type: "void", instance: null, count: 0, state: null };
      default:
        throw Error(f(444, e));
    }
  }
  function ga(e) {
    return 'href="' + ft(e) + '"';
  }
  function fn(e) {
    return 'link[rel="stylesheet"][' + e + "]";
  }
  function Lo(e) {
    return A({}, e, {
      "data-precedence": e.precedence,
      precedence: null
    });
  }
  function qm(e, t, l, a) {
    e.querySelector('link[rel="preload"][as="style"][' + t + "]") ? a.loading = 1 : (t = e.createElement("link"), a.preload = t, t.addEventListener("load", function() {
      return a.loading |= 1;
    }), t.addEventListener("error", function() {
      return a.loading |= 2;
    }), Qe(t, "link", l), Ce(t), e.head.appendChild(t));
  }
  function ba(e) {
    return '[src="' + ft(e) + '"]';
  }
  function on(e) {
    return "script[async]" + e;
  }
  function Vo(e, t, l) {
    if (t.count++, t.instance === null)
      switch (t.type) {
        case "style":
          var a = e.querySelector(
            'style[data-href~="' + ft(l.href) + '"]'
          );
          if (a)
            return t.instance = a, Ce(a), a;
          var n = A({}, l, {
            "data-href": l.href,
            "data-precedence": l.precedence,
            href: null,
            precedence: null
          });
          return a = (e.ownerDocument || e).createElement(
            "style"
          ), Ce(a), Qe(a, "style", n), Tu(a, l.precedence, e), t.instance = a;
        case "stylesheet":
          n = ga(l.href);
          var u = e.querySelector(
            fn(n)
          );
          if (u)
            return t.state.loading |= 4, t.instance = u, Ce(u), u;
          a = Lo(l), (n = gt.get(n)) && Lc(a, n), u = (e.ownerDocument || e).createElement("link"), Ce(u);
          var c = u;
          return c._p = new Promise(function(s, h) {
            c.onload = s, c.onerror = h;
          }), Qe(u, "link", a), t.state.loading |= 4, Tu(u, l.precedence, e), t.instance = u;
        case "script":
          return u = ba(l.src), (n = e.querySelector(
            on(u)
          )) ? (t.instance = n, Ce(n), n) : (a = l, (n = gt.get(u)) && (a = A({}, l), Vc(a, n)), e = e.ownerDocument || e, n = e.createElement("script"), Ce(n), Qe(n, "link", a), e.head.appendChild(n), t.instance = n);
        case "void":
          return null;
        default:
          throw Error(f(443, t.type));
      }
    else
      t.type === "stylesheet" && (t.state.loading & 4) === 0 && (a = t.instance, t.state.loading |= 4, Tu(a, l.precedence, e));
    return t.instance;
  }
  function Tu(e, t, l) {
    for (var a = l.querySelectorAll(
      'link[rel="stylesheet"][data-precedence],style[data-precedence]'
    ), n = a.length ? a[a.length - 1] : null, u = n, c = 0; c < a.length; c++) {
      var s = a[c];
      if (s.dataset.precedence === t) u = s;
      else if (u !== n) break;
    }
    u ? u.parentNode.insertBefore(e, u.nextSibling) : (t = l.nodeType === 9 ? l.head : l, t.insertBefore(e, t.firstChild));
  }
  function Lc(e, t) {
    e.crossOrigin == null && (e.crossOrigin = t.crossOrigin), e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy), e.title == null && (e.title = t.title);
  }
  function Vc(e, t) {
    e.crossOrigin == null && (e.crossOrigin = t.crossOrigin), e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy), e.integrity == null && (e.integrity = t.integrity);
  }
  var Nu = null;
  function Ko(e, t, l) {
    if (Nu === null) {
      var a = /* @__PURE__ */ new Map(), n = Nu = /* @__PURE__ */ new Map();
      n.set(l, a);
    } else
      n = Nu, a = n.get(l), a || (a = /* @__PURE__ */ new Map(), n.set(l, a));
    if (a.has(e)) return a;
    for (a.set(e, null), l = l.getElementsByTagName(e), n = 0; n < l.length; n++) {
      var u = l[n];
      if (!(u[_a] || u[Ze] || e === "link" && u.getAttribute("rel") === "stylesheet") && u.namespaceURI !== "http://www.w3.org/2000/svg") {
        var c = u.getAttribute(t) || "";
        c = e + c;
        var s = a.get(c);
        s ? s.push(u) : a.set(c, [u]);
      }
    }
    return a;
  }
  function Jo(e, t, l) {
    e = e.ownerDocument || e, e.head.insertBefore(
      l,
      t === "title" ? e.querySelector("head > title") : null
    );
  }
  function Hm(e, t, l) {
    if (l === 1 || t.itemProp != null) return !1;
    switch (e) {
      case "meta":
      case "title":
        return !0;
      case "style":
        if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "")
          break;
        return !0;
      case "link":
        if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError)
          break;
        switch (t.rel) {
          case "stylesheet":
            return e = t.disabled, typeof t.precedence == "string" && e == null;
          default:
            return !0;
        }
      case "script":
        if (t.async && typeof t.async != "function" && typeof t.async != "symbol" && !t.onLoad && !t.onError && t.src && typeof t.src == "string")
          return !0;
    }
    return !1;
  }
  function ko(e) {
    return !(e.type === "stylesheet" && (e.state.loading & 3) === 0);
  }
  var dn = null;
  function Bm() {
  }
  function Ym(e, t, l) {
    if (dn === null) throw Error(f(475));
    var a = dn;
    if (t.type === "stylesheet" && (typeof l.media != "string" || matchMedia(l.media).matches !== !1) && (t.state.loading & 4) === 0) {
      if (t.instance === null) {
        var n = ga(l.href), u = e.querySelector(
          fn(n)
        );
        if (u) {
          e = u._p, e !== null && typeof e == "object" && typeof e.then == "function" && (a.count++, a = Au.bind(a), e.then(a, a)), t.state.loading |= 4, t.instance = u, Ce(u);
          return;
        }
        u = e.ownerDocument || e, l = Lo(l), (n = gt.get(n)) && Lc(l, n), u = u.createElement("link"), Ce(u);
        var c = u;
        c._p = new Promise(function(s, h) {
          c.onload = s, c.onerror = h;
        }), Qe(u, "link", l), t.instance = u;
      }
      a.stylesheets === null && (a.stylesheets = /* @__PURE__ */ new Map()), a.stylesheets.set(t, e), (e = t.state.preload) && (t.state.loading & 3) === 0 && (a.count++, t = Au.bind(a), e.addEventListener("load", t), e.addEventListener("error", t));
    }
  }
  function Gm() {
    if (dn === null) throw Error(f(475));
    var e = dn;
    return e.stylesheets && e.count === 0 && Kc(e, e.stylesheets), 0 < e.count ? function(t) {
      var l = setTimeout(function() {
        if (e.stylesheets && Kc(e, e.stylesheets), e.unsuspend) {
          var a = e.unsuspend;
          e.unsuspend = null, a();
        }
      }, 6e4);
      return e.unsuspend = t, function() {
        e.unsuspend = null, clearTimeout(l);
      };
    } : null;
  }
  function Au() {
    if (this.count--, this.count === 0) {
      if (this.stylesheets) Kc(this, this.stylesheets);
      else if (this.unsuspend) {
        var e = this.unsuspend;
        this.unsuspend = null, e();
      }
    }
  }
  var zu = null;
  function Kc(e, t) {
    e.stylesheets = null, e.unsuspend !== null && (e.count++, zu = /* @__PURE__ */ new Map(), t.forEach(Xm, e), zu = null, Au.call(e));
  }
  function Xm(e, t) {
    if (!(t.state.loading & 4)) {
      var l = zu.get(e);
      if (l) var a = l.get(null);
      else {
        l = /* @__PURE__ */ new Map(), zu.set(e, l);
        for (var n = e.querySelectorAll(
          "link[data-precedence],style[data-precedence]"
        ), u = 0; u < n.length; u++) {
          var c = n[u];
          (c.nodeName === "LINK" || c.getAttribute("media") !== "not all") && (l.set(c.dataset.precedence, c), a = c);
        }
        a && l.set(null, a);
      }
      n = t.instance, c = n.getAttribute("data-precedence"), u = l.get(c) || a, u === a && l.set(null, n), l.set(c, n), this.count++, a = Au.bind(this), n.addEventListener("load", a), n.addEventListener("error", a), u ? u.parentNode.insertBefore(n, u.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(n, e.firstChild)), t.state.loading |= 4;
    }
  }
  var hn = {
    $$typeof: V,
    Provider: null,
    Consumer: null,
    _currentValue: $,
    _currentValue2: $,
    _threadCount: 0
  };
  function Qm(e, t, l, a, n, u, c, s) {
    this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = Qu(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Qu(0), this.hiddenUpdates = Qu(null), this.identifierPrefix = a, this.onUncaughtError = n, this.onCaughtError = u, this.onRecoverableError = c, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = s, this.incompleteTransitions = /* @__PURE__ */ new Map();
  }
  function $o(e, t, l, a, n, u, c, s, h, b, O, R) {
    return e = new Qm(
      e,
      t,
      l,
      c,
      s,
      h,
      b,
      R
    ), t = 1, u === !0 && (t |= 24), u = lt(3, null, null, t), e.current = u, u.stateNode = e, t = Ai(), t.refCount++, e.pooledCache = t, t.refCount++, u.memoizedState = {
      element: a,
      isDehydrated: l,
      cache: t
    }, Mi(u), e;
  }
  function Wo(e) {
    return e ? (e = $l, e) : $l;
  }
  function Fo(e, t, l, a, n, u) {
    n = Wo(n), a.context === null ? a.context = n : a.pendingContext = n, a = Ft(t), a.payload = { element: l }, u = u === void 0 ? null : u, u !== null && (a.callback = u), l = Pt(e, a, t), l !== null && (ct(l, e, t), Qa(l, e, t));
  }
  function Po(e, t) {
    if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
      var l = e.retryLane;
      e.retryLane = l !== 0 && l < t ? l : t;
    }
  }
  function Jc(e, t) {
    Po(e, t), (e = e.alternate) && Po(e, t);
  }
  function Io(e) {
    if (e.tag === 13) {
      var t = kl(e, 67108864);
      t !== null && ct(t, e, 67108864), Jc(e, 67108864);
    }
  }
  var Du = !0;
  function Zm(e, t, l, a) {
    var n = D.T;
    D.T = null;
    var u = Y.p;
    try {
      Y.p = 2, kc(e, t, l, a);
    } finally {
      Y.p = u, D.T = n;
    }
  }
  function Lm(e, t, l, a) {
    var n = D.T;
    D.T = null;
    var u = Y.p;
    try {
      Y.p = 8, kc(e, t, l, a);
    } finally {
      Y.p = u, D.T = n;
    }
  }
  function kc(e, t, l, a) {
    if (Du) {
      var n = $c(a);
      if (n === null)
        Cc(
          e,
          t,
          a,
          Ou,
          l
        ), td(e, a);
      else if (Km(
        n,
        e,
        t,
        l,
        a
      ))
        a.stopPropagation();
      else if (td(e, a), t & 4 && -1 < Vm.indexOf(e)) {
        for (; n !== null; ) {
          var u = ql(n);
          if (u !== null)
            switch (u.tag) {
              case 3:
                if (u = u.stateNode, u.current.memoizedState.isDehydrated) {
                  var c = yl(u.pendingLanes);
                  if (c !== 0) {
                    var s = u;
                    for (s.pendingLanes |= 2, s.entangledLanes |= 2; c; ) {
                      var h = 1 << 31 - et(c);
                      s.entanglements[1] |= h, c &= ~h;
                    }
                    At(u), (he & 6) === 0 && (hu = St() + 500, un(0));
                  }
                }
                break;
              case 13:
                s = kl(u, 2), s !== null && ct(s, u, 2), vu(), Jc(u, 2);
            }
          if (u = $c(a), u === null && Cc(
            e,
            t,
            a,
            Ou,
            l
          ), u === n) break;
          n = u;
        }
        n !== null && a.stopPropagation();
      } else
        Cc(
          e,
          t,
          a,
          null,
          l
        );
    }
  }
  function $c(e) {
    return e = ei(e), Wc(e);
  }
  var Ou = null;
  function Wc(e) {
    if (Ou = null, e = Cl(e), e !== null) {
      var t = z(e);
      if (t === null) e = null;
      else {
        var l = t.tag;
        if (l === 13) {
          if (e = j(t), e !== null) return e;
          e = null;
        } else if (l === 3) {
          if (t.stateNode.current.memoizedState.isDehydrated)
            return t.tag === 3 ? t.stateNode.containerInfo : null;
          e = null;
        } else t !== e && (e = null);
      }
    }
    return Ou = e, null;
  }
  function ed(e) {
    switch (e) {
      case "beforetoggle":
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "toggle":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 2;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 8;
      case "message":
        switch (Od()) {
          case ds:
            return 2;
          case hs:
            return 8;
          case Sn:
          case Md:
            return 32;
          case ms:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var Fc = !1, ol = null, dl = null, hl = null, mn = /* @__PURE__ */ new Map(), vn = /* @__PURE__ */ new Map(), ml = [], Vm = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
    " "
  );
  function td(e, t) {
    switch (e) {
      case "focusin":
      case "focusout":
        ol = null;
        break;
      case "dragenter":
      case "dragleave":
        dl = null;
        break;
      case "mouseover":
      case "mouseout":
        hl = null;
        break;
      case "pointerover":
      case "pointerout":
        mn.delete(t.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        vn.delete(t.pointerId);
    }
  }
  function yn(e, t, l, a, n, u) {
    return e === null || e.nativeEvent !== u ? (e = {
      blockedOn: t,
      domEventName: l,
      eventSystemFlags: a,
      nativeEvent: u,
      targetContainers: [n]
    }, t !== null && (t = ql(t), t !== null && Io(t)), e) : (e.eventSystemFlags |= a, t = e.targetContainers, n !== null && t.indexOf(n) === -1 && t.push(n), e);
  }
  function Km(e, t, l, a, n) {
    switch (t) {
      case "focusin":
        return ol = yn(
          ol,
          e,
          t,
          l,
          a,
          n
        ), !0;
      case "dragenter":
        return dl = yn(
          dl,
          e,
          t,
          l,
          a,
          n
        ), !0;
      case "mouseover":
        return hl = yn(
          hl,
          e,
          t,
          l,
          a,
          n
        ), !0;
      case "pointerover":
        var u = n.pointerId;
        return mn.set(
          u,
          yn(
            mn.get(u) || null,
            e,
            t,
            l,
            a,
            n
          )
        ), !0;
      case "gotpointercapture":
        return u = n.pointerId, vn.set(
          u,
          yn(
            vn.get(u) || null,
            e,
            t,
            l,
            a,
            n
          )
        ), !0;
    }
    return !1;
  }
  function ld(e) {
    var t = Cl(e.target);
    if (t !== null) {
      var l = z(t);
      if (l !== null) {
        if (t = l.tag, t === 13) {
          if (t = j(l), t !== null) {
            e.blockedOn = t, Yd(e.priority, function() {
              if (l.tag === 13) {
                var a = it();
                a = Zu(a);
                var n = kl(l, a);
                n !== null && ct(n, l, a), Jc(l, a);
              }
            });
            return;
          }
        } else if (t === 3 && l.stateNode.current.memoizedState.isDehydrated) {
          e.blockedOn = l.tag === 3 ? l.stateNode.containerInfo : null;
          return;
        }
      }
    }
    e.blockedOn = null;
  }
  function Mu(e) {
    if (e.blockedOn !== null) return !1;
    for (var t = e.targetContainers; 0 < t.length; ) {
      var l = $c(e.nativeEvent);
      if (l === null) {
        l = e.nativeEvent;
        var a = new l.constructor(
          l.type,
          l
        );
        Iu = a, l.target.dispatchEvent(a), Iu = null;
      } else
        return t = ql(l), t !== null && Io(t), e.blockedOn = l, !1;
      t.shift();
    }
    return !0;
  }
  function ad(e, t, l) {
    Mu(e) && l.delete(t);
  }
  function Jm() {
    Fc = !1, ol !== null && Mu(ol) && (ol = null), dl !== null && Mu(dl) && (dl = null), hl !== null && Mu(hl) && (hl = null), mn.forEach(ad), vn.forEach(ad);
  }
  function Uu(e, t) {
    e.blockedOn === t && (e.blockedOn = null, Fc || (Fc = !0, r.unstable_scheduleCallback(
      r.unstable_NormalPriority,
      Jm
    )));
  }
  var Ru = null;
  function nd(e) {
    Ru !== e && (Ru = e, r.unstable_scheduleCallback(
      r.unstable_NormalPriority,
      function() {
        Ru === e && (Ru = null);
        for (var t = 0; t < e.length; t += 3) {
          var l = e[t], a = e[t + 1], n = e[t + 2];
          if (typeof a != "function") {
            if (Wc(a || l) === null)
              continue;
            break;
          }
          var u = ql(l);
          u !== null && (e.splice(t, 3), t -= 3, Wi(
            u,
            {
              pending: !0,
              data: n,
              method: l.method,
              action: a
            },
            a,
            n
          ));
        }
      }
    ));
  }
  function gn(e) {
    function t(h) {
      return Uu(h, e);
    }
    ol !== null && Uu(ol, e), dl !== null && Uu(dl, e), hl !== null && Uu(hl, e), mn.forEach(t), vn.forEach(t);
    for (var l = 0; l < ml.length; l++) {
      var a = ml[l];
      a.blockedOn === e && (a.blockedOn = null);
    }
    for (; 0 < ml.length && (l = ml[0], l.blockedOn === null); )
      ld(l), l.blockedOn === null && ml.shift();
    if (l = (e.ownerDocument || e).$$reactFormReplay, l != null)
      for (a = 0; a < l.length; a += 3) {
        var n = l[a], u = l[a + 1], c = n[ke] || null;
        if (typeof u == "function")
          c || nd(l);
        else if (c) {
          var s = null;
          if (u && u.hasAttribute("formAction")) {
            if (n = u, c = u[ke] || null)
              s = c.formAction;
            else if (Wc(n) !== null) continue;
          } else s = c.action;
          typeof s == "function" ? l[a + 1] = s : (l.splice(a, 3), a -= 3), nd(l);
        }
      }
  }
  function Pc(e) {
    this._internalRoot = e;
  }
  wu.prototype.render = Pc.prototype.render = function(e) {
    var t = this._internalRoot;
    if (t === null) throw Error(f(409));
    var l = t.current, a = it();
    Fo(l, a, e, t, null, null);
  }, wu.prototype.unmount = Pc.prototype.unmount = function() {
    var e = this._internalRoot;
    if (e !== null) {
      this._internalRoot = null;
      var t = e.containerInfo;
      Fo(e.current, 2, null, e, null, null), vu(), t[wl] = null;
    }
  };
  function wu(e) {
    this._internalRoot = e;
  }
  wu.prototype.unstable_scheduleHydration = function(e) {
    if (e) {
      var t = ps();
      e = { blockedOn: null, target: e, priority: t };
      for (var l = 0; l < ml.length && t !== 0 && t < ml[l].priority; l++) ;
      ml.splice(l, 0, e), l === 0 && ld(e);
    }
  };
  var ud = d.version;
  if (ud !== "19.1.1")
    throw Error(
      f(
        527,
        ud,
        "19.1.1"
      )
    );
  Y.findDOMNode = function(e) {
    var t = e._reactInternals;
    if (t === void 0)
      throw typeof e.render == "function" ? Error(f(188)) : (e = Object.keys(e).join(","), Error(f(268, e)));
    return e = T(t), e = e !== null ? p(e) : null, e = e === null ? null : e.stateNode, e;
  };
  var km = {
    bundleType: 0,
    version: "19.1.1",
    rendererPackageName: "react-dom",
    currentDispatcherRef: D,
    reconcilerVersion: "19.1.1"
  };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var Cu = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!Cu.isDisabled && Cu.supportsFiber)
      try {
        ja = Cu.inject(
          km
        ), Ie = Cu;
      } catch {
      }
  }
  return pn.createRoot = function(e, t) {
    if (!E(e)) throw Error(f(299));
    var l = !1, a = "", n = jf, u = xf, c = Sf, s = null;
    return t != null && (t.unstable_strictMode === !0 && (l = !0), t.identifierPrefix !== void 0 && (a = t.identifierPrefix), t.onUncaughtError !== void 0 && (n = t.onUncaughtError), t.onCaughtError !== void 0 && (u = t.onCaughtError), t.onRecoverableError !== void 0 && (c = t.onRecoverableError), t.unstable_transitionCallbacks !== void 0 && (s = t.unstable_transitionCallbacks)), t = $o(
      e,
      1,
      !1,
      null,
      null,
      l,
      a,
      n,
      u,
      c,
      s,
      null
    ), e[wl] = t.current, wc(e), new Pc(t);
  }, pn.hydrateRoot = function(e, t, l) {
    if (!E(e)) throw Error(f(299));
    var a = !1, n = "", u = jf, c = xf, s = Sf, h = null, b = null;
    return l != null && (l.unstable_strictMode === !0 && (a = !0), l.identifierPrefix !== void 0 && (n = l.identifierPrefix), l.onUncaughtError !== void 0 && (u = l.onUncaughtError), l.onCaughtError !== void 0 && (c = l.onCaughtError), l.onRecoverableError !== void 0 && (s = l.onRecoverableError), l.unstable_transitionCallbacks !== void 0 && (h = l.unstable_transitionCallbacks), l.formState !== void 0 && (b = l.formState)), t = $o(
      e,
      1,
      !0,
      t,
      l ?? null,
      a,
      n,
      u,
      c,
      s,
      h,
      b
    ), t.context = Wo(null), l = t.current, a = it(), a = Zu(a), n = Ft(a), n.callback = null, Pt(l, n, a), l = a, t.current.lanes = l, Sa(t, l), At(t), e[wl] = t.current, wc(e), new wu(t);
  }, pn.version = "19.1.1", pn;
}
var vd;
function nv() {
  if (vd) return ts.exports;
  vd = 1;
  function r() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(r);
      } catch (d) {
        console.error(d);
      }
  }
  return r(), ts.exports = av(), ts.exports;
}
var uv = nv();
const us = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
function yd(r) {
  if (!r || typeof r != "object") return { error: "请求失败", error_code: "request_failed" };
  const d = r;
  return {
    error: typeof d.error == "string" ? d.error : "请求失败",
    ...typeof d.error_code == "string" ? { error_code: d.error_code } : typeof d.code == "string" ? { error_code: d.code } : {},
    ...d.details && typeof d.details == "object" ? { details: d.details } : {},
    ...typeof d.request_id == "string" ? { request_id: d.request_id } : {}
  };
}
function iv(r) {
  let d = r.csrfToken;
  const m = /* @__PURE__ */ new Map(), f = (j, U) => {
    if (!j) return () => {
    };
    const T = m.get(j) ?? /* @__PURE__ */ new Set();
    return T.add(U), m.set(j, T), () => {
      T.delete(U), T.size || m.delete(j);
    };
  };
  async function E() {
    try {
      const j = await fetch("/api/csrf-refresh", { credentials: "same-origin" });
      if (!j.ok || !j.headers.get("content-type")?.includes("application/json")) return !1;
      const U = await j.json();
      return typeof U.csrf_token != "string" || !U.csrf_token ? !1 : (d = U.csrf_token, r.onCsrfToken?.(d), !0);
    } catch {
      return !1;
    }
  }
  async function z(j, U = {}) {
    const T = (U.method ?? "GET").toUpperCase(), p = new AbortController(), A = f(U.scope, p), _ = U.signal, q = () => p.abort();
    _?.addEventListener("abort", q, { once: !0 });
    const le = async () => {
      const B = new Headers(U.headers);
      B.set("Accept", "application/json"), us.has(T) || B.set("X-CSRFToken", d), U.idempotencyKey && B.set("Idempotency-Key", U.idempotencyKey);
      let I = U.body;
      return U.json !== void 0 && (B.set("Content-Type", "application/json"), I = JSON.stringify(U.json)), fetch(j, {
        ...U,
        method: T,
        headers: B,
        body: I,
        signal: p.signal,
        credentials: "same-origin"
      });
    };
    try {
      let B;
      try {
        B = await le();
      } catch (V) {
        if (p.signal.aborted || !us.has(T)) throw V;
        B = await le();
      }
      if (B.ok && B.status === 204)
        return { ok: !0, data: void 0 };
      const I = B.headers.get("content-type") ?? "", L = I.includes("application/json") ? await B.json() : void 0, Q = B.ok ? void 0 : yd(L);
      if (!B.ok && Q?.error_code === "csrf_required" && !us.has(T) && await E()) {
        if (B = await le(), B.ok && B.status === 204) return { ok: !0, data: void 0 };
        if (!(B.headers.get("content-type") ?? "").includes("application/json"))
          return { ok: !1, status: B.status, error: { error: "服务器返回了无法识别的响应", error_code: "invalid_response" } };
        const de = await B.json();
        return B.ok ? { ok: !0, data: de, ...B.headers.get("x-request-id") ? { requestId: B.headers.get("x-request-id") } : {} } : { ok: !1, status: B.status, error: yd(de) };
      }
      if (!I.includes("application/json"))
        return { ok: !1, status: B.status, error: { error: "服务器返回了无法识别的响应", error_code: "invalid_response" } };
      if (!B.ok) return { ok: !1, status: B.status, error: Q };
      const P = B.headers.get("x-request-id") ?? void 0;
      return { ok: !0, data: L, ...P ? { requestId: P } : {} };
    } catch (B) {
      return {
        ok: !1,
        status: 0,
        error: p.signal.aborted || B instanceof DOMException && B.name === "AbortError" ? { error: "请求已取消", error_code: "request_cancelled" } : { error: "网络连接失败", error_code: "network_error" }
      };
    } finally {
      _?.removeEventListener("abort", q), A();
    }
  }
  return {
    request: z,
    abortScope(j) {
      for (const U of m.get(j) ?? []) U.abort();
      m.delete(j);
    }
  };
}
const cv = new Intl.Collator("zh-CN", { numeric: !0, sensitivity: "base" });
function sv(r) {
  const d = String(r ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!d) return null;
  const m = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])), f = /* @__PURE__ */ new Date();
  return f.setHours(0, 0, 0, 0), Math.round((m.getTime() - f.getTime()) / 864e5);
}
function rs(r) {
  const d = (r.stages ?? []).filter((m) => !m.completed && !m.skipped).map((m) => sv(m.planned_at)).filter((m) => m !== null);
  return { overdue: d.some((m) => m < 0), soon: d.some((m) => m >= 0 && m <= 7) };
}
function rv(r, d, m) {
  const f = m.trim().toLocaleLowerCase();
  return r.filter((E) => {
    if (!(!f || [E.number, E.name, E.purchaser, E.method].some((T) => String(T ?? "").toLocaleLowerCase().includes(f)))) return !1;
    const j = Number(E.progress ?? 0), U = rs(E);
    return d === "all" || d === "active" && !E.is_terminated && j < 100 || d === "done" && !E.is_terminated && j >= 100 || d === "terminated" && !!E.is_terminated || d === "liubiao" && E.terminated_type === "liubiao" || d === "feibiao" && E.terminated_type === "feibiao" || d === "overdue" && U.overdue || d === "soon" && U.soon;
  });
}
function fv(r, d) {
  return r.map((m, f) => ({ project: m, index: f })).sort((m, f) => {
    const E = String(m.project.number ?? "").trim(), z = String(f.project.number ?? "").trim(), j = /\d/.test(E), U = /\d/.test(z);
    if (j !== U) return j ? -1 : 1;
    if (!j) return m.index - f.index;
    const T = cv.compare(E, z);
    return T ? d === "desc" ? -T : T : m.index - f.index;
  }).map(({ project: m }) => m);
}
const ov = [["all", "全部"], ["active", "进行中"], ["overdue", "逾期"], ["soon", "7天内"], ["done", "完成"], ["liubiao", "流标"], ["feibiao", "废标"], ["terminated", "终止"]];
function dv({ state: r, currentId: d, onOpen: m }) {
  const [f, E] = G.useState("all"), [z, j] = G.useState(""), [U, T] = G.useState(() => localStorage.getItem("projectSidebarSortDirection") === "desc" ? "desc" : "asc"), p = G.useMemo(() => fv(rv(r.data ?? [], f, z), U), [r.data, f, z, U]), A = (_) => {
    T(_), localStorage.setItem("projectSidebarSortDirection", _);
  };
  return /* @__PURE__ */ i.jsxs(i.Fragment, { children: [
    /* @__PURE__ */ i.jsxs("label", { className: "project-search", children: [
      /* @__PURE__ */ i.jsx("span", { "aria-hidden": "true", children: "⌕" }),
      /* @__PURE__ */ i.jsx("input", { value: z, onChange: (_) => j(_.target.value), type: "search", "aria-label": "搜索项目", placeholder: "搜索项目、编号或单位" }),
      /* @__PURE__ */ i.jsx("kbd", { children: "Ctrl K" })
    ] }),
    /* @__PURE__ */ i.jsxs("div", { className: "sidebar-section-head", children: [
      /* @__PURE__ */ i.jsx("span", { children: "项目" }),
      /* @__PURE__ */ i.jsxs("select", { "aria-label": "项目编号排序", value: U, onChange: (_) => A(_.target.value), children: [
        /* @__PURE__ */ i.jsx("option", { value: "asc", children: "编号升序" }),
        /* @__PURE__ */ i.jsx("option", { value: "desc", children: "编号降序" })
      ] })
    ] }),
    /* @__PURE__ */ i.jsx("div", { className: "filter-strip", "aria-label": "项目状态筛选", children: ov.map(([_, q]) => /* @__PURE__ */ i.jsx("button", { type: "button", className: f === _ ? "active" : "", onClick: () => E(_), children: q }, _)) }),
    /* @__PURE__ */ i.jsxs("div", { className: "project-list", "aria-live": "polite", children: [
      r.status === "loading" && /* @__PURE__ */ i.jsxs("div", { className: "project-list-empty", children: [
        /* @__PURE__ */ i.jsx("span", { children: "◇" }),
        /* @__PURE__ */ i.jsx("strong", { children: "正在载入项目" })
      ] }),
      r.status === "error" && /* @__PURE__ */ i.jsxs("div", { className: "project-list-empty", role: "alert", children: [
        /* @__PURE__ */ i.jsx("strong", { children: "项目载入失败" }),
        /* @__PURE__ */ i.jsx("small", { children: r.error })
      ] }),
      r.status === "success" && !p.length && /* @__PURE__ */ i.jsxs("div", { className: "project-list-empty", children: [
        /* @__PURE__ */ i.jsx("span", { children: "◇" }),
        /* @__PURE__ */ i.jsx("strong", { children: "没有符合条件的项目" })
      ] }),
      p.map((_) => /* @__PURE__ */ i.jsxs("button", { type: "button", className: `project-list-item${_.id === d ? " active" : ""}`, onClick: () => m(_.id), children: [
        /* @__PURE__ */ i.jsx("span", { className: "project-dot" }),
        /* @__PURE__ */ i.jsxs("span", { children: [
          /* @__PURE__ */ i.jsx("small", { children: _.number }),
          /* @__PURE__ */ i.jsx("strong", { children: _.name }),
          /* @__PURE__ */ i.jsx("em", { children: _.current_stage_key ?? "已完成" })
        ] }),
        /* @__PURE__ */ i.jsxs("b", { children: [
          _.progress,
          "%"
        ] })
      ] }, _.id))
    ] })
  ] });
}
function gd({ current: r, projects: d = { status: "loading" }, onNavigate: m, onNewProject: f }) {
  return /* @__PURE__ */ i.jsxs("div", { className: "sidebar-content", children: [
    /* @__PURE__ */ i.jsxs("div", { className: "brand-row", children: [
      /* @__PURE__ */ i.jsx("img", { src: "/static/app-logo.svg", alt: "" }),
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: "项目管理系统" }),
        /* @__PURE__ */ i.jsx("span", { children: "团队工作台" })
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("nav", { className: "primary-nav", "aria-label": "主要功能", children: [
      /* @__PURE__ */ i.jsxs("button", { className: r.view === "dashboard" ? "active" : "", onClick: () => m({ view: "dashboard" }), children: [
        /* @__PURE__ */ i.jsx("span", { children: "⌂" }),
        "总览"
      ] }),
      /* @__PURE__ */ i.jsxs("button", { className: r.view === "calendar" ? "active" : "", onClick: () => m({ view: "calendar" }), children: [
        /* @__PURE__ */ i.jsx("span", { children: "▦" }),
        "日历"
      ] }),
      /* @__PURE__ */ i.jsxs("button", { className: r.view === "procurement" ? "active" : "", onClick: () => m({ view: "procurement" }), children: [
        /* @__PURE__ */ i.jsx("span", { children: "◫" }),
        "采购看板"
      ] }),
      /* @__PURE__ */ i.jsxs("button", { className: r.view === "settings" ? "active" : "", onClick: () => m({ view: "settings" }), children: [
        /* @__PURE__ */ i.jsx("span", { children: "⚙" }),
        "系统设置"
      ] })
    ] }),
    /* @__PURE__ */ i.jsx(dv, { state: d, currentId: r.view === "project" ? r.projectId : void 0, onOpen: (E) => m({ view: "project", projectId: E }) }),
    /* @__PURE__ */ i.jsx("div", { className: "sidebar-footer", children: /* @__PURE__ */ i.jsxs("button", { className: "new-project", type: "button", onClick: f, children: [
      /* @__PURE__ */ i.jsx("span", { children: "＋" }),
      "新建项目"
    ] }) })
  ] });
}
function hv() {
  let r = 1, d = [];
  const m = /* @__PURE__ */ new Set(), f = () => m.forEach((z) => z()), E = (z) => {
    const j = d.filter((U) => U.id !== z);
    j.length !== d.length && (d = j, f());
  };
  return {
    getSnapshot: () => d,
    subscribe(z) {
      return m.add(z), () => m.delete(z);
    },
    push(z) {
      const j = { ...z, id: r++ };
      return d = [...d, j], f(), z.timeoutMs !== 0 && window.setTimeout(() => E(j.id), z.timeoutMs ?? 6e3), j.id;
    },
    remove: E
  };
}
const Ed = G.createContext(null);
function mv({ children: r }) {
  const d = G.useRef(null);
  return d.current === null && (d.current = hv()), /* @__PURE__ */ i.jsx(Ed.Provider, { value: d.current, children: r });
}
function Td() {
  const r = G.useContext(Ed);
  if (r === null) throw new Error("useToasts must be used inside ToastProvider");
  return { toasts: G.useSyncExternalStore(r.subscribe, r.getSnapshot, r.getSnapshot), push: r.push, remove: r.remove };
}
function vv() {
  const { toasts: r, remove: d } = Td();
  return /* @__PURE__ */ i.jsx("div", { className: "toast-region", role: "status", "aria-live": "polite", "aria-atomic": "true", children: r.map((m) => /* @__PURE__ */ i.jsxs("article", { className: `toast toast-${m.tone}`, children: [
    /* @__PURE__ */ i.jsxs("div", { children: [
      /* @__PURE__ */ i.jsx("strong", { children: m.title }),
      m.message && /* @__PURE__ */ i.jsx("p", { children: m.message })
    ] }),
    /* @__PURE__ */ i.jsx("button", { type: "button", "aria-label": "关闭通知", onClick: () => d(m.id), children: "×" })
  ] }, m.id)) });
}
function yv({ username: r, theme: d, onThemeChange: m, onOpenSidebar: f, onLogout: E, onChangePassword: z }) {
  const [j, U] = G.useState(!1), [T, p] = G.useState(!1), [A, _] = G.useState(""), [q, le] = G.useState(""), [B, I] = G.useState(""), L = async () => {
    I("");
    try {
      await z(A, q), p(!1), _(""), le("");
    } catch (Q) {
      I(Q instanceof Error ? Q.message : "修改密码失败");
    }
  };
  return /* @__PURE__ */ i.jsxs("header", { className: "top-bar", children: [
    /* @__PURE__ */ i.jsx("button", { className: "mobile-menu", "aria-label": "打开项目导航", onClick: f, children: "☰" }),
    /* @__PURE__ */ i.jsxs("div", { className: "top-bar-context", children: [
      /* @__PURE__ */ i.jsx("span", { children: "工作台" }),
      /* @__PURE__ */ i.jsx("strong", { children: "项目总览" })
    ] }),
    /* @__PURE__ */ i.jsxs("div", { className: "top-bar-actions", children: [
      /* @__PURE__ */ i.jsxs("label", { className: "theme-control", children: [
        /* @__PURE__ */ i.jsx("span", { className: "sr-only", children: "界面主题" }),
        /* @__PURE__ */ i.jsxs("select", { "aria-label": "界面主题", value: d, onChange: (Q) => m(Q.target.value), children: [
          /* @__PURE__ */ i.jsx("option", { value: "system", children: "跟随系统" }),
          /* @__PURE__ */ i.jsx("option", { value: "light", children: "浅色" }),
          /* @__PURE__ */ i.jsx("option", { value: "dark", children: "深色" })
        ] })
      ] }),
      /* @__PURE__ */ i.jsx("button", { className: "icon-button", "aria-label": "通知", children: "◌" }),
      /* @__PURE__ */ i.jsxs("div", { className: "account-menu-wrap", children: [
        /* @__PURE__ */ i.jsxs("button", { className: "account-button", "aria-label": `账号 ${r}`, "aria-expanded": j, onClick: () => U(!j), children: [
          /* @__PURE__ */ i.jsx("span", { children: r.slice(0, 1).toUpperCase() }),
          /* @__PURE__ */ i.jsx("strong", { children: r })
        ] }),
        j && /* @__PURE__ */ i.jsxs("div", { className: "account-menu", role: "menu", children: [
          /* @__PURE__ */ i.jsx("button", { role: "menuitem", onClick: () => {
            U(!1), p(!0);
          }, children: "修改密码" }),
          /* @__PURE__ */ i.jsx("button", { role: "menuitem", onClick: E, children: "退出登录" })
        ] })
      ] })
    ] }),
    T && /* @__PURE__ */ i.jsxs("div", { className: "drawer-layer", children: [
      /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭修改密码", onClick: () => p(!1) }),
      /* @__PURE__ */ i.jsxs("aside", { className: "edit-drawer", role: "dialog", "aria-modal": "true", "aria-label": "修改密码", children: [
        /* @__PURE__ */ i.jsxs("header", { children: [
          /* @__PURE__ */ i.jsx("h2", { children: "修改密码" }),
          /* @__PURE__ */ i.jsx("button", { "aria-label": "关闭修改密码窗口", onClick: () => p(!1), children: "×" })
        ] }),
        /* @__PURE__ */ i.jsxs("form", { onSubmit: (Q) => {
          Q.preventDefault(), L();
        }, children: [
          /* @__PURE__ */ i.jsxs("label", { children: [
            "原密码",
            /* @__PURE__ */ i.jsx("input", { required: !0, type: "password", "aria-label": "原密码", value: A, onChange: (Q) => _(Q.target.value) })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "新密码",
            /* @__PURE__ */ i.jsx("input", { required: !0, type: "password", "aria-label": "新密码", value: q, onChange: (Q) => le(Q.target.value) })
          ] }),
          B && /* @__PURE__ */ i.jsx("p", { role: "alert", children: B }),
          /* @__PURE__ */ i.jsx("button", { type: "submit", className: "primary-action", children: "确认修改" })
        ] })
      ] })
    ] })
  ] });
}
const is = (r) => r ? decodeURIComponent(r).replace(/[^a-z0-9-]/gi, "") : void 0;
function bd(r) {
  const d = r.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (d[0] === "calendar") return { view: "calendar", month: is(d[1]) };
  if (d[0] === "procurement") return { view: "procurement" };
  if (d[0] === "settings") return { view: "settings", section: is(d[1]) };
  if (d[0] === "project") {
    const m = Number(d[1]);
    if (Number.isInteger(m) && m > 0)
      return { view: "project", projectId: m, anchor: is(d[2]) };
  }
  return { view: "dashboard" };
}
function gv(r) {
  return r.view === "dashboard" ? "#/dashboard" : r.view === "calendar" ? `#/calendar${r.month ? `/${r.month}` : ""}` : r.view === "procurement" ? "#/procurement" : r.view === "settings" ? `#/settings${r.section ? `/${r.section}` : ""}` : `#/project/${r.projectId}${r.anchor ? `/${r.anchor}` : ""}`;
}
const fs = "hpm.theme";
function bv() {
  const r = localStorage.getItem(fs);
  return r === "light" || r === "dark" ? r : "system";
}
function pv(r) {
  r === "system" ? localStorage.removeItem(fs) : localStorage.setItem(fs, r);
}
function jv(r) {
  r === "system" ? delete document.documentElement.dataset.theme : document.documentElement.dataset.theme = r;
}
function pa({ as: r = "div", level: d = "base", className: m = "", children: f, ...E }) {
  return /* @__PURE__ */ i.jsx(r, { ...E, "data-testid": "glass-surface", "data-glass-level": d, className: `glass-surface glass-${d} ${m}`.trim(), children: f });
}
function xv({ state: r, projects: d, onOpenProject: m }) {
  if (r.status === "loading" || r.status === "idle") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message", children: "正在载入总览" }) });
  if (r.status === "error") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { role: "alert", className: "state-message error", children: r.error }) });
  const f = d.filter((z) => {
    const j = rs(z);
    return j.overdue || j.soon;
  }), E = [["项目总数", r.data.total], ["进行中", r.data.in_progress], ["已完成", r.data.completed], ["流标 / 废标", r.data.liubiao + r.data.feibiao]];
  return /* @__PURE__ */ i.jsxs("section", { className: "feature-page", children: [
    /* @__PURE__ */ i.jsxs("header", { className: "page-heading", children: [
      /* @__PURE__ */ i.jsx("span", { children: "今日工作台" }),
      /* @__PURE__ */ i.jsx("h1", { children: "总览" }),
      /* @__PURE__ */ i.jsx("p", { children: "先处理逾期和即将到期的项目节点。" })
    ] }),
    /* @__PURE__ */ i.jsx("div", { className: "metric-grid", children: E.map(([z, j]) => /* @__PURE__ */ i.jsxs(pa, { as: "article", level: "raised", className: "metric-card", children: [
      /* @__PURE__ */ i.jsx("span", { children: z }),
      /* @__PURE__ */ i.jsx("strong", { children: j })
    ] }, z)) }),
    /* @__PURE__ */ i.jsxs(pa, { as: "section", level: "base", className: "action-panel", children: [
      /* @__PURE__ */ i.jsxs("div", { className: "section-title", children: [
        /* @__PURE__ */ i.jsxs("div", { children: [
          /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "优先队列" }),
          /* @__PURE__ */ i.jsx("h2", { children: "需要处理" })
        ] }),
        /* @__PURE__ */ i.jsx("b", { children: f.length })
      ] }),
      f.length ? /* @__PURE__ */ i.jsx("div", { className: "action-list", children: f.map((z) => /* @__PURE__ */ i.jsxs("button", { onClick: () => m(z.id), children: [
        /* @__PURE__ */ i.jsxs("span", { children: [
          /* @__PURE__ */ i.jsx("strong", { children: z.name }),
          /* @__PURE__ */ i.jsx("small", { children: z.number })
        ] }),
        /* @__PURE__ */ i.jsx("em", { children: rs(z).overdue ? "已逾期" : "7天内" })
      ] }, z.id)) }) : /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "目前没有逾期或七天内到期的节点。" })
    ] })
  ] });
}
function Sv({ cells: r, onOpenProject: d }) {
  const m = r.filter((f) => !f.empty && (f.events?.length ?? 0) > 0);
  return /* @__PURE__ */ i.jsx("div", { className: "agenda-list", children: m.length ? m.map((f) => /* @__PURE__ */ i.jsxs("section", { children: [
    /* @__PURE__ */ i.jsx("time", { children: f.date_str }),
    f.events.map((E) => /* @__PURE__ */ i.jsxs("button", { "aria-label": `在议程中打开${E.name}`, onClick: () => d(E.project_id), children: [
      /* @__PURE__ */ i.jsx("strong", { children: E.name }),
      /* @__PURE__ */ i.jsxs("span", { children: [
        E.number,
        " · ",
        E.stage_name
      ] })
    ] }, `${f.date_str}-${E.project_id}-${E.stage_name}`))
  ] }, f.date_str)) : /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "本月没有已计划的项目节点。" }) });
}
const pd = (r, d, m) => {
  const f = new Date(r, d - 1 + m, 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
};
function _v({ state: r, onMonth: d, onOpenProject: m }) {
  if (r.status === "loading" || r.status === "idle") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message", children: "正在载入日历" }) });
  if (r.status === "error") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { role: "alert", className: "state-message error", children: r.error }) });
  const f = r.data;
  return /* @__PURE__ */ i.jsxs("section", { className: "feature-page", children: [
    /* @__PURE__ */ i.jsxs("header", { className: "calendar-header", children: [
      /* @__PURE__ */ i.jsxs("div", { className: "page-heading", children: [
        /* @__PURE__ */ i.jsx("span", { children: "时间视图" }),
        /* @__PURE__ */ i.jsxs("h1", { children: [
          f.year,
          "年 ",
          f.month_name
        ] }),
        /* @__PURE__ */ i.jsx("p", { children: "按计划日期查看阶段与待办。" })
      ] }),
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("button", { "aria-label": "上个月", onClick: () => d(pd(f.year, f.month, -1)), children: "←" }),
        /* @__PURE__ */ i.jsx("button", { "aria-label": "下个月", onClick: () => d(pd(f.year, f.month, 1)), children: "→" })
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("section", { className: "glass-card calendar-card", children: [
      /* @__PURE__ */ i.jsx("div", { className: "calendar-weekdays", children: f.weekday_names.map((E) => /* @__PURE__ */ i.jsx("span", { children: E }, E)) }),
      /* @__PURE__ */ i.jsx("div", { className: "calendar-grid", children: f.cells.map((E, z) => /* @__PURE__ */ i.jsxs("article", { className: E.empty ? "empty" : "", children: [
        /* @__PURE__ */ i.jsx("b", { children: E.day }),
        E.events?.map((j) => /* @__PURE__ */ i.jsxs("button", { "aria-label": `在日历中打开${j.name}`, onClick: () => m(j.project_id), children: [
          j.name,
          /* @__PURE__ */ i.jsx("small", { children: j.stage_name })
        ] }, `${j.project_id}-${j.stage_name}`))
      ] }, E.date_str ?? `empty-${z}`)) })
    ] }),
    /* @__PURE__ */ i.jsxs("section", { className: "glass-card agenda-card", children: [
      /* @__PURE__ */ i.jsx("h2", { children: "本月议程" }),
      /* @__PURE__ */ i.jsx(Sv, { cells: f.cells, onOpenProject: m })
    ] })
  ] });
}
function Ev({ state: r, isAdmin: d, onOpenProject: m }) {
  return r.status === "loading" || r.status === "idle" ? /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message", children: "正在载入采购看板" }) }) : r.status === "error" ? /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { role: "alert", className: "state-message error", children: r.error }) }) : /* @__PURE__ */ i.jsxs("section", { className: "feature-page", children: [
    /* @__PURE__ */ i.jsxs("header", { className: "board-header", children: [
      /* @__PURE__ */ i.jsxs("div", { className: "page-heading", children: [
        /* @__PURE__ */ i.jsx("span", { children: "采购人视图" }),
        /* @__PURE__ */ i.jsx("h1", { children: "采购看板" }),
        /* @__PURE__ */ i.jsxs("p", { children: [
          r.data.unit_total,
          " 个采购人单位，按现有分类规则展示。"
        ] })
      ] }),
      d && /* @__PURE__ */ i.jsx("button", { className: "primary-action", children: "分类管理" })
    ] }),
    /* @__PURE__ */ i.jsx("div", { className: "procurement-columns", children: r.data.groups.map((f) => /* @__PURE__ */ i.jsxs("section", { className: "glass-card procurement-group", children: [
      /* @__PURE__ */ i.jsxs("header", { children: [
        /* @__PURE__ */ i.jsx("i", { style: { background: f.category?.color ?? "var(--text-faint)" } }),
        /* @__PURE__ */ i.jsx("h2", { children: f.name }),
        /* @__PURE__ */ i.jsx("span", { children: f.units.length })
      ] }),
      /* @__PURE__ */ i.jsx("div", { children: f.units.map((E) => /* @__PURE__ */ i.jsxs("article", { className: "purchaser-card", children: [
        /* @__PURE__ */ i.jsxs("button", { onClick: () => E.project_ids[0] && m(E.project_ids[0]), children: [
          /* @__PURE__ */ i.jsx("strong", { children: E.name }),
          /* @__PURE__ */ i.jsxs("span", { children: [
            E.project_count,
            " 个项目"
          ] }),
          /* @__PURE__ */ i.jsx("small", { children: E.recent_project ? `最近 ${E.recent_project}` : "查看项目" })
        ] }),
        d && /* @__PURE__ */ i.jsx("button", { className: "move-unit", children: "移动分类" })
      ] }, E.name)) })
    ] }, f.name)) })
  ] });
}
function Tv({ project: r }) {
  return /* @__PURE__ */ i.jsxs("section", { id: "activity", className: "glass-card workspace-section", children: [
    /* @__PURE__ */ i.jsx("div", { className: "workspace-section-title", children: /* @__PURE__ */ i.jsxs("div", { children: [
      /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "可追溯记录" }),
      /* @__PURE__ */ i.jsx("h2", { children: "项目动态" })
    ] }) }),
    /* @__PURE__ */ i.jsxs("div", { className: "activity-row", children: [
      /* @__PURE__ */ i.jsx("span", { children: "●" }),
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsxs("strong", { children: [
          "当前进度 ",
          r.progress,
          "%"
        ] }),
        /* @__PURE__ */ i.jsx("p", { children: "阶段状态和业务修改由服务端审计记录。" })
      ] })
    ] })
  ] });
}
const Nv = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
function Av({ project: r, onUpdate: d }) {
  const m = r.stages.find((T) => T.key === r.current_stage_key) ?? r.stages.find((T) => !T.completed && !T.skipped), [f, E] = G.useState(Nv()), [z, j] = G.useState(!1);
  if (!m) return /* @__PURE__ */ i.jsxs(pa, { as: "section", level: "floating", id: "current-stage", className: "workspace-section current-stage", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "当前阶段" }),
    /* @__PURE__ */ i.jsx("h2", { children: "项目流程已完成" })
  ] });
  const U = async () => {
    j(!0);
    try {
      await d(m.key, { command: "complete", completed: !0, completed_date: f, record_version: m.record_version });
    } finally {
      j(!1);
    }
  };
  return /* @__PURE__ */ i.jsxs(pa, { as: "section", level: "floating", id: "current-stage", className: "workspace-section current-stage", children: [
    /* @__PURE__ */ i.jsxs("div", { children: [
      /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "当前阶段" }),
      /* @__PURE__ */ i.jsxs("h2", { children: [
        /* @__PURE__ */ i.jsx("i", { children: m.icon }),
        m.name
      ] }),
      /* @__PURE__ */ i.jsxs("p", { children: [
        m.responsible_person ? `负责人：${m.responsible_person}` : "尚未指定负责人",
        m.planned_at ? ` · 计划 ${String(m.planned_at).slice(0, 10)}` : ""
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("div", { className: "stage-action", children: [
      /* @__PURE__ */ i.jsxs("label", { children: [
        "完成日期",
        /* @__PURE__ */ i.jsx("input", { type: "date", value: f, onChange: (T) => E(T.target.value) })
      ] }),
      /* @__PURE__ */ i.jsx("button", { disabled: z, onClick: U, "aria-label": `完成${m.name}`, children: z ? "正在保存" : "完成当前阶段" })
    ] })
  ] });
}
function zv({ project: r, canEdit: d, onSave: m, onDelete: f }) {
  const [E, z] = G.useState(!1), [j, U] = G.useState({ number: r.number, name: r.name, purchaser: r.purchaser ?? "", method: r.method ?? "", budget: r.budget ?? "", year: r.year ?? (/* @__PURE__ */ new Date()).getFullYear(), prepare_owner: r.prepare_owner ?? "", review_owner: r.review_owner ?? "", notes: r.notes ?? "" }), [T, p] = G.useState(!1), [A, _] = G.useState(""), q = (I) => (L) => U((Q) => ({ ...Q, [I]: I === "year" ? Number(L.target.value) : L.target.value })), le = async () => {
    p(!0), _("");
    try {
      await m?.({ ...j, record_version: r.record_version }), z(!1);
    } catch (I) {
      _(I instanceof Error ? I.message : "保存失败");
    } finally {
      p(!1);
    }
  }, B = async () => {
    if (window.confirm("删除后项目将进入回收站，确定继续吗？")) {
      p(!0);
      try {
        await f?.(), z(!1);
      } catch (I) {
        _(I instanceof Error ? I.message : "删除失败");
      } finally {
        p(!1);
      }
    }
  };
  return /* @__PURE__ */ i.jsxs(pa, { as: "section", level: "raised", id: "summary", className: "project-hero workspace-section", children: [
    /* @__PURE__ */ i.jsxs("div", { className: "hero-main", children: [
      /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: r.number }),
      /* @__PURE__ */ i.jsx("h1", { children: r.name }),
      /* @__PURE__ */ i.jsxs("p", { children: [
        r.purchaser || "未设置采购人",
        " · ",
        r.method || "未设置采购方式",
        " · ",
        r.year || "未设置年度"
      ] }),
      /* @__PURE__ */ i.jsxs("div", { className: "hero-tags", children: [
        /* @__PURE__ */ i.jsxs("span", { children: [
          "预算 ",
          r.budget || "—"
        ] }),
        /* @__PURE__ */ i.jsxs("span", { children: [
          "负责人 ",
          r.prepare_owner || "未指定"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("div", { className: "progress-orbit", "aria-label": `项目进度 ${r.progress}%`, children: [
      /* @__PURE__ */ i.jsxs("strong", { children: [
        r.progress,
        "%"
      ] }),
      /* @__PURE__ */ i.jsx("span", { children: "总进度" })
    ] }),
    d && /* @__PURE__ */ i.jsx("button", { className: "hero-edit", onClick: () => z(!0), "aria-label": "编辑项目信息", children: "编辑" }),
    E && /* @__PURE__ */ i.jsxs("div", { className: "drawer-layer", children: [
      /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭编辑抽屉", onClick: () => z(!1) }),
      /* @__PURE__ */ i.jsxs("aside", { className: "edit-drawer", role: "dialog", "aria-modal": "true", "aria-label": "编辑项目信息", children: [
        /* @__PURE__ */ i.jsxs("header", { children: [
          /* @__PURE__ */ i.jsxs("div", { children: [
            /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "项目设置" }),
            /* @__PURE__ */ i.jsx("h2", { children: "编辑项目信息" })
          ] }),
          /* @__PURE__ */ i.jsx("button", { "aria-label": "关闭编辑项目信息", onClick: () => z(!1), children: "×" })
        ] }),
        /* @__PURE__ */ i.jsxs("form", { onSubmit: (I) => {
          I.preventDefault(), le();
        }, children: [
          /* @__PURE__ */ i.jsxs("label", { children: [
            "项目编号",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "项目编号", value: j.number, onChange: q("number") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "项目名称",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "项目名称", value: j.name, onChange: q("name") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "采购人",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "采购人", value: j.purchaser, onChange: q("purchaser") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "采购方式",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "采购方式", value: j.method, onChange: q("method") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "年度",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "年度", type: "number", value: j.year, onChange: q("year") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "预算",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "预算", value: j.budget, onChange: q("budget") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "编制负责人",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "编制负责人", value: j.prepare_owner, onChange: q("prepare_owner") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "审核负责人",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "审核负责人", value: j.review_owner, onChange: q("review_owner") })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "备注",
            /* @__PURE__ */ i.jsx("textarea", { "aria-label": "备注", value: j.notes, onChange: q("notes") })
          ] }),
          /* @__PURE__ */ i.jsx("p", { children: "保存时仍由服务端校验字段、权限和记录版本。" }),
          A && /* @__PURE__ */ i.jsx("p", { role: "alert", children: A }),
          /* @__PURE__ */ i.jsx("button", { disabled: T, type: "submit", className: "primary-action", children: "保存修改" }),
          f && /* @__PURE__ */ i.jsx("button", { disabled: T, type: "button", className: "danger-action", onClick: () => void B(), children: "删除项目" })
        ] })
      ] })
    ] })
  ] });
}
function Dv({ project: r }) {
  const d = [["项目编号", r.number], ["采购人", r.purchaser], ["采购方式", r.method], ["年度", r.year], ["预算", r.budget], ["编制负责人", r.prepare_owner], ["审核负责人", r.review_owner], ["备注", r.notes]];
  return /* @__PURE__ */ i.jsxs("section", { id: "information", className: "glass-card workspace-section", children: [
    /* @__PURE__ */ i.jsx("div", { className: "workspace-section-title", children: /* @__PURE__ */ i.jsxs("div", { children: [
      /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "基础资料" }),
      /* @__PURE__ */ i.jsx("h2", { children: "项目信息" })
    ] }) }),
    /* @__PURE__ */ i.jsx("dl", { className: "info-grid", children: d.map(([m, f]) => /* @__PURE__ */ i.jsxs("div", { children: [
      /* @__PURE__ */ i.jsx("dt", { children: m }),
      /* @__PURE__ */ i.jsx("dd", { children: f || "—" })
    ] }, m)) })
  ] });
}
function Ov({ project: r }) {
  return /* @__PURE__ */ i.jsxs(pa, { as: "section", level: "base", id: "flow", className: "workspace-section", children: [
    /* @__PURE__ */ i.jsxs("div", { className: "workspace-section-title", children: [
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "完整路径" }),
        /* @__PURE__ */ i.jsx("h2", { children: "项目流程" })
      ] }),
      /* @__PURE__ */ i.jsxs("span", { children: [
        r.stages.filter((d) => d.completed || d.skipped).length,
        " / ",
        r.stages.length
      ] })
    ] }),
    /* @__PURE__ */ i.jsx("ol", { className: "stage-flow", children: r.stages.map((d, m) => /* @__PURE__ */ i.jsxs("li", { className: d.completed ? "done" : d.skipped ? "skipped" : d.key === r.current_stage_key ? "current" : "", children: [
      /* @__PURE__ */ i.jsx("span", { children: d.completed ? "✓" : m + 1 }),
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: d.name }),
        /* @__PURE__ */ i.jsx("small", { children: d.completed ? d.completed_date || "已完成" : d.skipped ? "不适用" : d.planned_at ? `计划 ${String(d.planned_at).slice(0, 10)}` : "待安排" })
      ] })
    ] }, d.key)) })
  ] });
}
function Mv({ project: r, canEdit: d = !1, onMutate: m }) {
  const [f, E] = G.useState(""), [z, j] = G.useState(""), U = r.stages.flatMap((_) => (_.checklist ?? []).map((q) => ({ ...q, id: Number(q.id) || void 0, title: String(q.title ?? "检查项"), completed: !!q.completed, stage: _.name, stage_key: _.key }))), T = U.filter((_) => !_.completed).length, p = async (_, q) => {
    try {
      j(""), await m?.(_, q);
    } catch (le) {
      j(le instanceof Error ? le.message : "保存失败");
    }
  }, A = async () => {
    const _ = f.trim();
    if (!_) {
      j("请填写检查项");
      return;
    }
    await p("create", { stage_key: r.current_stage_key ?? r.stages[0]?.key, title: _ }), E("");
  };
  return /* @__PURE__ */ i.jsxs("section", { id: "tasks", className: "glass-card workspace-section", children: [
    /* @__PURE__ */ i.jsxs("div", { className: "workspace-section-title", children: [
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "执行清单" }),
        /* @__PURE__ */ i.jsx("h2", { children: "任务与检查项" })
      ] }),
      /* @__PURE__ */ i.jsxs("span", { children: [
        T,
        " 项待办"
      ] })
    ] }),
    d && /* @__PURE__ */ i.jsxs("div", { className: "task-create", children: [
      /* @__PURE__ */ i.jsxs("label", { children: [
        "新检查项",
        /* @__PURE__ */ i.jsx("input", { "aria-label": "新检查项", value: f, onChange: (_) => E(_.target.value), onKeyDown: (_) => {
          _.key === "Enter" && A();
        } })
      ] }),
      /* @__PURE__ */ i.jsx("button", { className: "primary-action", "aria-label": "添加检查项", onClick: () => void A(), children: "添加" })
    ] }),
    U.length ? /* @__PURE__ */ i.jsx("div", { className: "task-list", children: U.map((_, q) => /* @__PURE__ */ i.jsxs("div", { className: "task-row", children: [
      /* @__PURE__ */ i.jsxs("label", { children: [
        /* @__PURE__ */ i.jsx("input", { "aria-label": String(_.title), type: "checkbox", checked: !!_.completed, disabled: !d, onChange: (le) => void p("update", { ..._, completed: le.target.checked }) }),
        /* @__PURE__ */ i.jsxs("span", { children: [
          /* @__PURE__ */ i.jsx("strong", { children: String(_.title) }),
          /* @__PURE__ */ i.jsx("small", { children: String(_.stage) })
        ] })
      ] }),
      d && !!_.is_custom && /* @__PURE__ */ i.jsx("button", { className: "danger-action", "aria-label": `删除${String(_.title)}`, onClick: () => void p("delete", _), children: "删除" })
    ] }, String(_.id ?? `${_.stage_key}-${q}`))) }) : /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "当前没有检查项。" }),
    z && /* @__PURE__ */ i.jsx("p", { className: "state-message error", role: "alert", children: z })
  ] });
}
const Uv = [["summary", "概览"], ["current-stage", "当前阶段"], ["flow", "流程"], ["tasks", "任务"], ["information", "信息"], ["business", "业务"], ["attachments", "附件"], ["activity", "动态"]];
function Rv({ active: r, onNavigate: d }) {
  return /* @__PURE__ */ i.jsx("nav", { className: "workspace-nav", "aria-label": "项目章节", children: Uv.map(([m, f]) => /* @__PURE__ */ i.jsx("button", { className: r === m ? "active" : "", onClick: () => d(m), children: f }, m)) });
}
const jn = (r) => r.split(".").pop()?.toLocaleLowerCase() ?? "", Nd = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "gif", "bmp", "webp", "txt", "csv", "json", "xml", "zip"], wv = Nd.map((r) => `.${r}`).join(",");
function Cv(r) {
  return Nd.includes(jn(r));
}
function qv(r) {
  const d = jn(r);
  return ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(d) ? "image" : d === "pdf" ? "pdf" : ["txt", "csv", "json", "xml"].includes(d) ? "text" : ["doc", "docx", "xls", "xlsx"].includes(d) ? "office" : "download";
}
function Hv(r, d) {
  const m = r.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim(), f = jn(d);
  return !f || m.toLocaleLowerCase().endsWith(`.${f}`) ? m : `${m}.${f}`;
}
const cs = {
  jszip: "/static/libs/jszip.min.js",
  docx: "/static/libs/docx-preview/docx-preview.min.js",
  xlsx: "/static/libs/xlsx/xlsx.full.min.js"
};
async function Bv(r, d, m, f = window) {
  m.replaceChildren();
  const E = jn(r);
  if (E === "docx") {
    if (!f.docx?.renderAsync) throw new Error("Word 预览组件未能加载");
    await f.docx.renderAsync(d, m, void 0, { inWrapper: !0, breakPages: !0, ignoreWidth: !1, ignoreHeight: !1 });
    return;
  }
  if (E === "xls" || E === "xlsx") {
    if (!f.XLSX) throw new Error("Excel 预览组件未能加载");
    const z = f.XLSX.read(d, { type: "array", cellDates: !0 }), j = z.SheetNames[0];
    if (!j) throw new Error("工作簿中没有可预览的工作表");
    const U = f.XLSX.utils.sheet_to_json(z.Sheets[j], { header: 1, raw: !1, defval: "" }), T = document.createElement("strong");
    T.textContent = j;
    const p = document.createElement("table");
    for (const A of U.slice(0, 1e3)) {
      const _ = document.createElement("tr");
      for (const q of A.slice(0, 100)) {
        const le = document.createElement("td");
        le.textContent = String(q ?? ""), _.appendChild(le);
      }
      p.appendChild(_);
    }
    m.append(T, p);
    return;
  }
  throw new Error("旧版 Word .doc 暂不支持内嵌预览，请下载后用系统程序打开");
}
const jd = /* @__PURE__ */ new Map();
function ss(r, d) {
  if (d()) return Promise.resolve();
  const m = jd.get(r);
  if (m) return m;
  const f = new Promise((E, z) => {
    const j = document.createElement("script");
    j.src = r, j.async = !0, j.onload = () => d() ? E() : z(new Error("预览组件格式不正确")), j.onerror = () => z(new Error("本地预览组件加载失败")), document.head.appendChild(j);
  });
  return jd.set(r, f), f;
}
async function Yv(r) {
  const d = window, m = jn(r);
  return m === "docx" ? (await ss(cs.jszip, () => !!d.JSZip), await ss(cs.docx, () => !!d.docx?.renderAsync)) : (m === "xls" || m === "xlsx") && await ss(cs.xlsx, () => !!d.XLSX), d;
}
function xd({ reason: r }) {
  return /* @__PURE__ */ i.jsxs("div", { className: "preview-fallback", children: [
    /* @__PURE__ */ i.jsx("span", { children: "◇" }),
    /* @__PURE__ */ i.jsx("strong", { children: "当前文件无法在窗口内预览" }),
    /* @__PURE__ */ i.jsx("p", { children: r })
  ] });
}
function Gv({ item: r, onClose: d }) {
  const m = `/api/attachments/${r.id}/view`, f = `/api/attachments/${r.id}/download`, E = qv(r.filename), z = G.useRef(null), [j, U] = G.useState({ status: "loading" });
  return G.useEffect(() => {
    if (E !== "office" || !z.current) return;
    const T = new AbortController();
    return (async () => {
      U({ status: "loading" });
      try {
        const A = await fetch(m, { credentials: "same-origin", signal: T.signal });
        if (!A.ok) throw new Error(`文件读取失败（${A.status}）`);
        const [_, q] = await Promise.all([A.arrayBuffer(), Yv(r.filename)]);
        if (T.signal.aborted || !z.current) return;
        await Bv(r.filename, _, z.current, q), U({ status: "ready" });
      } catch (A) {
        T.signal.aborted || U({ status: "error", reason: A instanceof Error ? A.message : "预览失败" });
      }
    })(), () => T.abort();
  }, [r.filename, E, m]), /* @__PURE__ */ i.jsxs("div", { className: "preview-layer", children: [
    /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭预览", onClick: d }),
    /* @__PURE__ */ i.jsxs("section", { className: "document-preview", role: "dialog", "aria-modal": "true", "aria-label": `预览${r.filename}`, children: [
      /* @__PURE__ */ i.jsxs("header", { children: [
        /* @__PURE__ */ i.jsxs("div", { children: [
          /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "文档预览" }),
          /* @__PURE__ */ i.jsx("h2", { children: r.filename })
        ] }),
        /* @__PURE__ */ i.jsx("button", { "aria-label": "关闭预览", onClick: d, children: "×" })
      ] }),
      /* @__PURE__ */ i.jsx("div", { className: "preview-stage", children: E === "image" ? /* @__PURE__ */ i.jsx("img", { src: m, alt: r.filename }) : E === "pdf" || E === "text" ? /* @__PURE__ */ i.jsx("iframe", { src: m, title: r.filename }) : E === "office" ? /* @__PURE__ */ i.jsxs("div", { className: "office-preview", children: [
        /* @__PURE__ */ i.jsx("div", { ref: z, className: "office-preview-document" }),
        j.status === "loading" && /* @__PURE__ */ i.jsx("p", { className: "preview-loading", children: "正在安全加载本地预览组件…" }),
        j.status === "error" && /* @__PURE__ */ i.jsx(xd, { reason: j.reason ?? "预览失败" })
      ] }) : /* @__PURE__ */ i.jsx(xd, { reason: "该格式没有内嵌预览组件，原文件仍可正常下载。" }) }),
      /* @__PURE__ */ i.jsxs("footer", { children: [
        /* @__PURE__ */ i.jsxs("a", { href: f, download: r.filename, children: [
          "下载",
          r.filename
        ] }),
        /* @__PURE__ */ i.jsx("a", { href: m, target: "_blank", rel: "noreferrer", children: "用系统程序打开" })
      ] })
    ] })
  ] });
}
function Xv({ items: r, canEdit: d, maxBytes: m, operations: f }) {
  const [E, z] = G.useState(), [j, U] = G.useState(""), [T, p] = G.useState(), [A, _] = G.useState(""), [q, le] = G.useState(!1), B = async (L) => {
    le(!0), U("");
    try {
      await L();
    } catch (Q) {
      throw U(Q instanceof Error ? Q.message : "附件操作失败，请重试"), Q;
    } finally {
      le(!1);
    }
  }, I = async (L) => {
    const Q = Array.from(L ?? []), P = Q.find((de) => !Cv(de.name));
    if (P) {
      U(`${P.name} 的文件格式不支持`);
      return;
    }
    const V = Q.find((de) => de.size > m);
    if (V) {
      U(`${V.name} 超过上传上限`);
      return;
    }
    Q.length && await B(() => f.upload(Q)).catch(() => {
    });
  };
  return /* @__PURE__ */ i.jsxs("section", { className: "attachment-section", children: [
    /* @__PURE__ */ i.jsxs("header", { children: [
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("h3", { children: "附件" }),
        /* @__PURE__ */ i.jsxs("span", { children: [
          r.length,
          " 个文件"
        ] })
      ] }),
      d && /* @__PURE__ */ i.jsxs("label", { className: "upload-button", children: [
        q ? "正在处理" : "上传附件",
        /* @__PURE__ */ i.jsx("input", { "aria-label": "上传附件", type: "file", multiple: !0, accept: wv, disabled: q, onChange: (L) => void I(L.target.files) })
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("p", { className: "field-help", children: [
      "支持 PDF、Word、Excel、图片、文本和 ZIP；单个文件上限 ",
      Math.max(1, Math.floor(m / 1024 / 1024)),
      " MB。"
    ] }),
    j && /* @__PURE__ */ i.jsx("p", { className: "inline-error", role: "alert", children: j }),
    /* @__PURE__ */ i.jsx("div", { className: "attachment-list", children: r.map((L) => /* @__PURE__ */ i.jsxs("article", { children: [
      /* @__PURE__ */ i.jsx("input", { type: "checkbox", "aria-label": `选择${L.filename}` }),
      /* @__PURE__ */ i.jsx("span", { className: "file-icon", children: "◇" }),
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: L.filename }),
        /* @__PURE__ */ i.jsx("small", { children: L.byte_size ? `${Math.ceil(L.byte_size / 1024)} KB` : "文件" })
      ] }),
      /* @__PURE__ */ i.jsxs("span", { className: "file-actions", children: [
        /* @__PURE__ */ i.jsx("button", { "aria-label": `预览${L.filename}`, onClick: () => z(L), children: "预览" }),
        /* @__PURE__ */ i.jsx("a", { "aria-label": `下载${L.filename}`, href: `/api/attachments/${L.id}/download`, download: L.filename, children: "下载" }),
        /* @__PURE__ */ i.jsx("button", { "aria-label": `本地保存${L.filename}`, disabled: q, onClick: () => void B(() => f.saveLocal(L.id)).catch(() => {
        }), children: "本地保存" }),
        d && /* @__PURE__ */ i.jsxs(i.Fragment, { children: [
          /* @__PURE__ */ i.jsx("button", { "aria-label": `重命名${L.filename}`, disabled: q, onClick: () => {
            p(L), _(L.filename);
          }, children: "重命名" }),
          /* @__PURE__ */ i.jsx("button", { "aria-label": `删除${L.filename}`, disabled: q, onClick: () => void B(() => f.remove(L.id)).catch(() => {
          }), children: "删除" })
        ] })
      ] })
    ] }, L.id)) }),
    !r.length && /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "还没有项目附件。" }),
    E && /* @__PURE__ */ i.jsx(Gv, { item: E, onClose: () => z(void 0) }),
    T && /* @__PURE__ */ i.jsxs("div", { className: "mini-dialog-layer", children: [
      /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭重命名", onClick: () => p(void 0) }),
      /* @__PURE__ */ i.jsxs("div", { className: "mini-dialog", role: "dialog", "aria-label": `重命名${T.filename}`, children: [
        /* @__PURE__ */ i.jsx("h3", { children: "重命名附件" }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "文件名",
          /* @__PURE__ */ i.jsx("input", { value: A, onChange: (L) => _(L.target.value) })
        ] }),
        /* @__PURE__ */ i.jsx("button", { className: "primary-action", disabled: q, onClick: () => void B(() => f.rename(T.id, Hv(A, T.filename))).then(() => p(void 0)).catch(() => {
        }), children: "保存" })
      ] })
    ] })
  ] });
}
function Hu({ heading: r, addLabel: d, items: m, canEdit: f, primaryField: E, secondaryField: z, onMutate: j }) {
  const [U, T] = G.useState(void 0), [p, A] = G.useState(""), [_, q] = G.useState(""), [le, B] = G.useState(""), [I, L] = G.useState(!1), Q = (V) => {
    T(V), A(String(V?.[E] ?? "")), q(String(z ? V?.[z] ?? "" : "")), B("");
  }, P = async () => {
    if (!p.trim()) {
      B("请填写必填内容");
      return;
    }
    L(!0);
    try {
      await j(U?.id ? "update" : "create", { ...U ?? {}, [E]: p.trim(), ...z ? { [z]: _.trim() } : {} }), T(void 0);
    } catch (V) {
      B(V instanceof Error ? V.message : "保存失败");
    } finally {
      L(!1);
    }
  };
  return /* @__PURE__ */ i.jsxs("section", { className: "business-collection", children: [
    /* @__PURE__ */ i.jsxs("header", { children: [
      /* @__PURE__ */ i.jsx("h3", { children: r }),
      f && /* @__PURE__ */ i.jsx("button", { "aria-label": d, onClick: () => Q(null), children: "＋" })
    ] }),
    m.length ? /* @__PURE__ */ i.jsx("div", { className: "collection-list", children: m.map((V, de) => /* @__PURE__ */ i.jsxs("article", { children: [
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: String(V[E] ?? "未命名") }),
        z && /* @__PURE__ */ i.jsx("small", { children: String(V[z] ?? "") })
      ] }),
      f && /* @__PURE__ */ i.jsxs("span", { children: [
        /* @__PURE__ */ i.jsx("button", { "aria-label": `编辑${String(V[E] ?? r)}`, onClick: () => Q(V), children: "编辑" }),
        /* @__PURE__ */ i.jsx("button", { "aria-label": `删除${String(V[E] ?? r)}`, onClick: () => void j("delete", V), children: "删除" })
      ] })
    ] }, String(V.id ?? de))) }) : /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "暂无记录" }),
    U !== void 0 && /* @__PURE__ */ i.jsxs("div", { className: "mini-dialog-layer", children: [
      /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭表单", onClick: () => T(void 0) }),
      /* @__PURE__ */ i.jsxs("div", { className: "mini-dialog", role: "dialog", "aria-modal": "true", "aria-label": U?.id ? `编辑${r}` : d, children: [
        /* @__PURE__ */ i.jsxs("header", { children: [
          /* @__PURE__ */ i.jsx("h3", { children: U?.id ? `编辑${r}` : d }),
          /* @__PURE__ */ i.jsx("button", { "aria-label": "关闭表单", onClick: () => T(void 0), children: "×" })
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "名称或标题",
          /* @__PURE__ */ i.jsx("input", { autoFocus: !0, value: p, onChange: (V) => A(V.target.value) })
        ] }),
        z && /* @__PURE__ */ i.jsxs("label", { children: [
          "补充信息",
          /* @__PURE__ */ i.jsx("input", { value: _, onChange: (V) => q(V.target.value) })
        ] }),
        le && /* @__PURE__ */ i.jsx("p", { role: "alert", children: le }),
        /* @__PURE__ */ i.jsx("button", { className: "primary-action", disabled: I, onClick: () => void P(), children: I ? "正在保存" : "保存" })
      ] })
    ] })
  ] });
}
function Qv({ items: r, canEdit: d, onMutate: m }) {
  return /* @__PURE__ */ i.jsx(Hu, { heading: "澄清与更正", addLabel: "新增澄清与更正", items: r, canEdit: d, primaryField: "title", secondaryField: "clarification_type", onMutate: m });
}
function Zv({ items: r, canEdit: d, onMutate: m }) {
  return /* @__PURE__ */ i.jsx(Hu, { heading: "投诉与质疑", addLabel: "新增投诉与质疑", items: r, canEdit: d, primaryField: "company_name", secondaryField: "status", onMutate: m });
}
function Lv({ items: r, canEdit: d, onMutate: m }) {
  return /* @__PURE__ */ i.jsx(Hu, { heading: "采购包/标段", addLabel: "新增采购包/标段", items: r, canEdit: d, primaryField: "lot_name", secondaryField: "lot_number", onMutate: m });
}
function Vv({ items: r, canEdit: d, onMutate: m, onImport: f }) {
  const [E, z] = G.useState();
  return /* @__PURE__ */ i.jsxs("div", { children: [
    /* @__PURE__ */ i.jsx(Hu, { heading: "供应商报名", addLabel: "新增供应商报名", items: r, canEdit: d, primaryField: "company_name", secondaryField: "registration_method", onMutate: m }),
    d && f && /* @__PURE__ */ i.jsxs("div", { className: "inline-import", children: [
      /* @__PURE__ */ i.jsxs("label", { children: [
        "选择报名导入文件",
        /* @__PURE__ */ i.jsx("input", { "aria-label": "选择报名导入文件", type: "file", accept: ".xlsx", onChange: (j) => z(j.target.files?.[0]) })
      ] }),
      /* @__PURE__ */ i.jsx("a", { href: "/api/import/templates?kind=registrations", children: "下载模板" }),
      /* @__PURE__ */ i.jsx("button", { "aria-label": "导入报名", disabled: !E, onClick: () => {
        E && f(E);
      }, children: "导入报名" })
    ] })
  ] });
}
function Kv({ snapshot: r }) {
  const d = Number(r?.warning_count ?? 0), m = Number(r?.flowed_count ?? 0);
  return !d && !m ? null : /* @__PURE__ */ i.jsxs("aside", { className: "supplier-risk", role: "status", children: [
    /* @__PURE__ */ i.jsx("strong", { children: "供应商风险提醒" }),
    /* @__PURE__ */ i.jsxs("span", { children: [
      d ? `${d} 个包供应商不足` : "",
      d && m ? " · " : "",
      m ? `${m} 个包已流标` : ""
    ] })
  ] });
}
function Jv({ items: r, canEdit: d, onBulk: m }) {
  const [f, E] = G.useState([]), z = (j) => E((U) => U.includes(j) ? U.filter((T) => T !== j) : [...U, j]);
  return /* @__PURE__ */ i.jsxs("section", { className: "business-collection archive-catalog", children: [
    /* @__PURE__ */ i.jsxs("header", { children: [
      /* @__PURE__ */ i.jsx("h3", { children: "归档目录" }),
      /* @__PURE__ */ i.jsxs("span", { children: [
        f.length,
        " 项已选"
      ] })
    ] }),
    d && /* @__PURE__ */ i.jsxs("div", { className: "settings-actions", children: [
      /* @__PURE__ */ i.jsx("button", { "aria-label": "标记已移交", disabled: !f.length, onClick: () => void m(f, { transferred: !0 }), children: "标记已移交" }),
      /* @__PURE__ */ i.jsx("button", { disabled: !f.length, onClick: () => void m(f, { has_scan: !0 }), children: "标记有扫描件" })
    ] }),
    r.length ? /* @__PURE__ */ i.jsx("div", { className: "collection-list", children: r.map((j, U) => {
      const T = Number(j.id);
      return /* @__PURE__ */ i.jsxs("article", { children: [
        d && /* @__PURE__ */ i.jsx("input", { type: "checkbox", "aria-label": `选择${String(j.document_name ?? "归档材料")}`, checked: f.includes(T), onChange: () => z(T) }),
        /* @__PURE__ */ i.jsxs("div", { children: [
          /* @__PURE__ */ i.jsx("strong", { children: String(j.document_name ?? "归档材料") }),
          /* @__PURE__ */ i.jsxs("small", { children: [
            String(j.category ?? "未分类"),
            " · ",
            j.transferred ? "已移交" : "待移交"
          ] })
        ] })
      ] }, String(j.id ?? U));
    }) }) : /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "暂无归档目录" })
  ] });
}
function kv({ state: r, anchor: d, onNavigateAnchor: m, onStageUpdate: f, onProjectUpdate: E, onProjectDelete: z, client: j, canEdit: U = !1, onReload: T }) {
  const [p, A] = G.useState(d ?? "summary");
  if (G.useEffect(() => {
    if (!d) return;
    A(d);
    const Q = document.getElementById(d);
    typeof Q?.scrollIntoView == "function" && Q.scrollIntoView({ block: "start" });
  }, [d, r.status]), r.status === "idle" || r.status === "loading") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message", children: "正在载入项目工作区" }) });
  if (r.status === "error") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message error", role: "alert", children: r.error }) });
  const _ = r.data, q = (Q) => async (P, V) => {
    if (!j) throw new Error("当前操作尚未连接服务");
    const de = Number(V.id), ae = `/api/projects/${_.id}/${Q}${de ? `/${de}` : ""}`, Oe = await j.request(ae, { method: P === "delete" ? "DELETE" : P === "update" ? "PUT" : "POST", json: P === "delete" ? void 0 : V, idempotencyKey: crypto.randomUUID() });
    if (!Oe.ok) throw new Error(Oe.error.error);
    await T?.();
  }, le = {
    upload: async (Q) => {
      if (!j) return;
      const P = new FormData();
      Q.forEach((de) => P.append("files", de));
      const V = await j.request(`/api/projects/${_.id}/attachments`, { method: "POST", body: P, idempotencyKey: crypto.randomUUID() });
      if (!V.ok) throw new Error(V.error.error);
      await T?.();
    },
    rename: async (Q, P) => {
      if (!j) return;
      const V = await j.request(`/api/attachments/${Q}`, { method: "PUT", json: { filename: P }, idempotencyKey: crypto.randomUUID() });
      if (!V.ok) throw new Error(V.error.error);
      await T?.();
    },
    remove: async (Q) => {
      if (!j) return;
      const P = await j.request(`/api/attachments/${Q}`, { method: "DELETE", idempotencyKey: crypto.randomUUID() });
      if (!P.ok) throw new Error(P.error.error);
      await T?.();
    },
    saveLocal: async (Q) => {
      if (!j) return;
      const P = await j.request(`/api/attachments/${Q}/save-local`, { method: "POST", idempotencyKey: crypto.randomUUID() });
      if (!P.ok) throw new Error(P.error.error);
      window.location.assign(P.data.download_url);
    }
  }, B = async (Q) => {
    if (!j) return;
    const P = new FormData();
    P.append("file", Q);
    const V = await j.request(`/api/projects/${_.id}/registrations/import`, { method: "POST", body: P, idempotencyKey: crypto.randomUUID() });
    if (!V.ok) throw new Error(V.error.error);
    await T?.();
  }, I = async (Q, P) => {
    if (!j) return;
    const V = await j.request(`/api/projects/${_.id}/archive-catalog/bulk`, { method: "PUT", json: { ids: Q, ...P }, idempotencyKey: crypto.randomUUID() });
    if (!V.ok) throw new Error(V.error.error);
    await T?.();
  }, L = (Q) => {
    A(Q), m(Q);
    const P = document.getElementById(Q);
    typeof P?.scrollIntoView == "function" && P.scrollIntoView({ block: "start" });
  };
  return /* @__PURE__ */ i.jsxs("article", { className: "project-workspace", children: [
    /* @__PURE__ */ i.jsx(Rv, { active: p, onNavigate: L }),
    /* @__PURE__ */ i.jsx(zv, { project: _, canEdit: U, onSave: E, onDelete: z }),
    /* @__PURE__ */ i.jsx(Av, { project: _, onUpdate: f }),
    /* @__PURE__ */ i.jsx(Ov, { project: _ }),
    /* @__PURE__ */ i.jsx(Mv, { project: _, canEdit: U, onMutate: q("stage-checklist") }),
    /* @__PURE__ */ i.jsx(Dv, { project: _ }),
    /* @__PURE__ */ i.jsxs("section", { id: "business", className: "glass-card workspace-section", children: [
      /* @__PURE__ */ i.jsx("div", { className: "workspace-section-title", children: /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "采购业务" }),
        /* @__PURE__ */ i.jsx("h2", { children: "报名、包件与业务记录" })
      ] }) }),
      /* @__PURE__ */ i.jsx(Kv, { snapshot: _.lot_supplier_state }),
      /* @__PURE__ */ i.jsxs("div", { className: "business-grid", children: [
        /* @__PURE__ */ i.jsx(Vv, { items: _.registrations ?? [], canEdit: U, onMutate: q("registrations"), onImport: B }),
        /* @__PURE__ */ i.jsx(Lv, { items: _.lots ?? [], canEdit: U, onMutate: q("lots") }),
        /* @__PURE__ */ i.jsx(Zv, { items: _.complaints ?? [], canEdit: U, onMutate: q("complaints") }),
        /* @__PURE__ */ i.jsx(Qv, { items: _.announcement_clarifications ?? [], canEdit: U, onMutate: q("clarifications") }),
        /* @__PURE__ */ i.jsx(Jv, { items: _.archive_catalog ?? [], canEdit: U, onBulk: I })
      ] })
    ] }),
    /* @__PURE__ */ i.jsx("section", { id: "attachments", className: "glass-card workspace-section", children: /* @__PURE__ */ i.jsx(Xv, { projectId: _.id, items: _.attachments ?? [], canEdit: U, maxBytes: 2048 * 1024 * 1024, operations: le }) }),
    /* @__PURE__ */ i.jsx(Tv, { project: _ })
  ] });
}
function $v() {
  return /* @__PURE__ */ i.jsxs("section", { id: "appearance", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "界面" }),
    /* @__PURE__ */ i.jsx("h2", { children: "外观" }),
    /* @__PURE__ */ i.jsx("p", { children: "主题可在顶部随时切换为跟随系统、浅色或深色。设置仅保存在当前设备，不上传敏感信息。" }),
    /* @__PURE__ */ i.jsx("div", { className: "setting-note", children: "毛玻璃效果会根据系统能力自动降级为高对比度实色表面。" })
  ] });
}
function Wv({ settings: r, uploadLimit: d, isAdmin: m, onUpdate: f }) {
  const [E, z] = G.useState(Number(d.max_file_size_mb ?? 100)), [j, U] = G.useState(), [T, p] = G.useState(""), A = async () => {
    if (!j) {
      p("请先选择 .xlsx 文件");
      return;
    }
    await f("import-projects", { file: j }), p("导入完成，项目列表已刷新");
  };
  return /* @__PURE__ */ i.jsxs("section", { id: "data", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "文件与迁移" }),
    /* @__PURE__ */ i.jsx("h2", { children: "文件与数据" }),
    /* @__PURE__ */ i.jsx("p", { children: "导入、导出、备份和迁移仍使用原有服务端格式与校验。" }),
    /* @__PURE__ */ i.jsxs("div", { className: "settings-form", children: [
      /* @__PURE__ */ i.jsxs("label", { children: [
        "附件上限（MB）",
        /* @__PURE__ */ i.jsx("input", { type: "number", min: "1", max: "2048", value: E, onChange: (_) => z(Number(_.target.value)) })
      ] }),
      /* @__PURE__ */ i.jsxs("label", { children: [
        "导出目录",
        /* @__PURE__ */ i.jsx("input", { readOnly: !0, value: String(r.export_folder ?? "") })
      ] }),
      m && /* @__PURE__ */ i.jsxs("label", { children: [
        "选择项目导入文件",
        /* @__PURE__ */ i.jsx("input", { type: "file", accept: ".xlsx", onChange: (_) => U(_.target.files?.[0]) })
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("div", { className: "settings-actions", children: [
      /* @__PURE__ */ i.jsx("a", { href: "/api/import/templates", children: "下载导入模板" }),
      /* @__PURE__ */ i.jsx("a", { href: "/api/export", children: "导出项目数据" }),
      m && /* @__PURE__ */ i.jsxs(i.Fragment, { children: [
        /* @__PURE__ */ i.jsx("button", { onClick: () => void A(), children: "导入项目" }),
        /* @__PURE__ */ i.jsx("button", { onClick: () => void f("upload-limit", { max_file_size_mb: E }), children: "保存附件上限" })
      ] })
    ] }),
    T && /* @__PURE__ */ i.jsx("p", { role: "status", children: T })
  ] });
}
function Fv({ settings: r, isAdmin: d, failures: m, onUpdate: f }) {
  const [E, z] = G.useState(String(r.smtp_host ?? "")), [j, U] = G.useState(String(r.smtp_username ?? "")), [T, p] = G.useState(""), A = () => void f("email", { smtp_host: E, smtp_username: j, ...T ? { smtp_password: T } : {} });
  return /* @__PURE__ */ i.jsxs("section", { id: "email", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "通知" }),
    /* @__PURE__ */ i.jsx("h2", { children: "邮件提醒" }),
    /* @__PURE__ */ i.jsx("p", { children: "密码留空表示保留服务端现有密钥。" }),
    /* @__PURE__ */ i.jsxs("div", { className: "settings-form", children: [
      /* @__PURE__ */ i.jsxs("label", { children: [
        "SMTP 主机",
        /* @__PURE__ */ i.jsx("input", { "aria-label": "SMTP 主机", value: E, onChange: (_) => z(_.target.value) })
      ] }),
      /* @__PURE__ */ i.jsxs("label", { children: [
        "SMTP 用户名",
        /* @__PURE__ */ i.jsx("input", { value: j, onChange: (_) => U(_.target.value) })
      ] }),
      /* @__PURE__ */ i.jsxs("label", { children: [
        "SMTP 密码",
        /* @__PURE__ */ i.jsx("input", { type: "password", value: T, placeholder: r.smtp_password_configured ? "已配置，不显示原值" : "未配置", onChange: (_) => p(_.target.value) }),
        /* @__PURE__ */ i.jsx("small", { children: r.smtp_password_configured ? "已配置，不显示原值" : "尚未配置" })
      ] })
    ] }),
    /* @__PURE__ */ i.jsxs("div", { className: "setting-note", children: [
      "收件组 ",
      Array.isArray(r.reminder_recipient_groups) ? r.reminder_recipient_groups.length : 0,
      " 个 · 终止失败 ",
      m.length,
      " 条"
    ] }),
    m.length > 0 && /* @__PURE__ */ i.jsx("div", { className: "recycle-list", children: m.map((_) => /* @__PURE__ */ i.jsxs("article", { children: [
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: String(_.recipient) }),
        /* @__PURE__ */ i.jsx("small", { children: String(_.last_error ?? "发送失败") })
      ] }),
      d && /* @__PURE__ */ i.jsx("button", { "aria-label": `重试 ${String(_.recipient)}`, onClick: () => void f("retry-reminder", { id: _.id }), children: "重试" })
    ] }, `${_.id}-${_.recipient}`)) }),
    d && /* @__PURE__ */ i.jsx("button", { className: "primary-action", "aria-label": "保存邮件设置", onClick: A, children: "保存邮件设置" })
  ] });
}
function Pv({ info: r, health: d }) {
  const m = [["系统版本", r.version], ["服务地址", r.current_url], ["数据库加密", r.database_encryption], ["附件加密", r.attachment_encryption], ["健康状态", d.status ?? "unknown"]];
  return /* @__PURE__ */ i.jsxs("section", { id: "security", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "边界与状态" }),
    /* @__PURE__ */ i.jsx("h2", { children: "安全与网络" }),
    /* @__PURE__ */ i.jsx("p", { children: "授权、身份、权限、CSRF、阶段顺序和审计均由服务端负责。" }),
    /* @__PURE__ */ i.jsx("dl", { className: "settings-status-grid", children: m.map(([f, E]) => /* @__PURE__ */ i.jsxs("div", { children: [
      /* @__PURE__ */ i.jsx("dt", { children: f }),
      /* @__PURE__ */ i.jsx("dd", { children: String(E ?? "—") })
    ] }, f)) })
  ] });
}
function Iv({ users: r, isAdmin: d, onUpdate: m }) {
  const [f, E] = G.useState(!1), [z, j] = G.useState(""), [U, T] = G.useState({ username: "", display_name: "", password: "", role: "member" }), p = async () => {
    j("");
    try {
      await m("create-user", U), E(!1), T({ username: "", display_name: "", password: "", role: "member" });
    } catch (A) {
      j(A instanceof Error ? A.message : "创建失败");
    }
  };
  return /* @__PURE__ */ i.jsxs("section", { id: "users", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "成员与权限" }),
    /* @__PURE__ */ i.jsx("h2", { children: "账号管理" }),
    /* @__PURE__ */ i.jsx("p", { children: "团队账号按管理员、成员和只读角色执行服务端授权。" }),
    /* @__PURE__ */ i.jsx("div", { className: "user-list", children: r.map((A) => /* @__PURE__ */ i.jsxs("article", { children: [
      /* @__PURE__ */ i.jsx("span", { children: String(A.display_name || A.username || "用户").slice(0, 1) }),
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: String(A.display_name || A.username) }),
        /* @__PURE__ */ i.jsxs("small", { children: [
          String(A.username),
          " · ",
          String(A.role ?? (A.is_admin ? "administrator" : "member"))
        ] })
      ] }),
      /* @__PURE__ */ i.jsx("em", { children: A.is_active === !1 ? "已停用" : "正常" }),
      d && /* @__PURE__ */ i.jsxs("div", { className: "user-actions", children: [
        /* @__PURE__ */ i.jsxs("select", { "aria-label": `角色 ${String(A.username)}`, value: String(A.role ?? "member"), onChange: (_) => void m("user", { id: A.id, role: _.target.value }), children: [
          /* @__PURE__ */ i.jsx("option", { value: "administrator", children: "管理员" }),
          /* @__PURE__ */ i.jsx("option", { value: "member", children: "成员" }),
          /* @__PURE__ */ i.jsx("option", { value: "viewer", children: "只读" })
        ] }),
        /* @__PURE__ */ i.jsx("button", { onClick: () => void m("user", { id: A.id, is_active: A.is_active === !1 }), children: A.is_active === !1 ? "启用" : "停用" }),
        /* @__PURE__ */ i.jsx("button", { onClick: () => {
          const _ = window.prompt("请输入新密码");
          _ && m("reset-password", { id: A.id, password: _ });
        }, children: "重置密码" }),
        /* @__PURE__ */ i.jsx("button", { onClick: () => {
          window.confirm("确定删除该账号吗？") && m("delete-user", { id: A.id });
        }, children: "删除" })
      ] })
    ] }, String(A.id))) }),
    d && /* @__PURE__ */ i.jsx("button", { className: "primary-action", onClick: () => E(!0), children: "新增账号" }),
    f && /* @__PURE__ */ i.jsxs("div", { className: "drawer-layer", children: [
      /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭新增账号", onClick: () => E(!1) }),
      /* @__PURE__ */ i.jsxs("aside", { className: "edit-drawer", role: "dialog", "aria-modal": "true", "aria-label": "新增账号", children: [
        /* @__PURE__ */ i.jsxs("header", { children: [
          /* @__PURE__ */ i.jsx("h2", { children: "新增账号" }),
          /* @__PURE__ */ i.jsx("button", { "aria-label": "关闭新增账号窗口", onClick: () => E(!1), children: "×" })
        ] }),
        /* @__PURE__ */ i.jsxs("form", { onSubmit: (A) => {
          A.preventDefault(), p();
        }, children: [
          /* @__PURE__ */ i.jsxs("label", { children: [
            "登录账号",
            /* @__PURE__ */ i.jsx("input", { required: !0, "aria-label": "登录账号", value: U.username, onChange: (A) => T({ ...U, username: A.target.value }) })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "显示名称",
            /* @__PURE__ */ i.jsx("input", { "aria-label": "显示名称", value: U.display_name, onChange: (A) => T({ ...U, display_name: A.target.value }) })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "初始密码",
            /* @__PURE__ */ i.jsx("input", { required: !0, type: "password", "aria-label": "初始密码", value: U.password, onChange: (A) => T({ ...U, password: A.target.value }) })
          ] }),
          /* @__PURE__ */ i.jsxs("label", { children: [
            "账号角色",
            /* @__PURE__ */ i.jsxs("select", { "aria-label": "账号角色", value: U.role, onChange: (A) => T({ ...U, role: A.target.value }), children: [
              /* @__PURE__ */ i.jsx("option", { value: "administrator", children: "管理员" }),
              /* @__PURE__ */ i.jsx("option", { value: "member", children: "成员" }),
              /* @__PURE__ */ i.jsx("option", { value: "viewer", children: "只读" })
            ] })
          ] }),
          z && /* @__PURE__ */ i.jsx("p", { role: "alert", children: z }),
          /* @__PURE__ */ i.jsx("button", { type: "submit", className: "primary-action", children: "创建账号" })
        ] })
      ] })
    ] })
  ] });
}
const qu = { plan_received: "计划接收", doc_prepare: "文件编制", doc_review: "文件审核", doc_finalized: "文件定稿", agreement_signed: "委托协议签定", announcement: "公告发布", registration_end: "报名截止", bid_opening: "开标", evaluation: "评标", result_announced: "结果公示", winning_notice: "中标通知书", service_fee: "服务费到账", deposit_refund: "保证金退还", archived: "资料整理归档" };
function ey({ settings: r, isAdmin: d, onUpdate: m }) {
  const f = r.stage_order ?? Object.keys(qu), E = (z, j) => {
    const U = [...f], T = z + j;
    T < 0 || T >= U.length || ([U[z], U[T]] = [U[T], U[z]], m("workflow", { stage_order: U }));
  };
  return /* @__PURE__ */ i.jsxs("section", { id: "workflow", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "流程控制" }),
    /* @__PURE__ */ i.jsx("h2", { children: "项目流程" }),
    /* @__PURE__ */ i.jsx("p", { children: "阶段顺序直接影响当前阶段、下一阶段和进度计算。" }),
    /* @__PURE__ */ i.jsx("ol", { className: "workflow-settings-list", children: f.map((z, j) => /* @__PURE__ */ i.jsxs("li", { children: [
      /* @__PURE__ */ i.jsx("span", { children: j + 1 }),
      /* @__PURE__ */ i.jsx("strong", { children: qu[z] ?? z }),
      d && /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("button", { "aria-label": `上移${qu[z] ?? z}`, onClick: () => E(j, -1), children: "↑" }),
        /* @__PURE__ */ i.jsx("button", { "aria-label": `下移${qu[z] ?? z}`, onClick: () => E(j, 1), children: "↓" })
      ] })
    ] }, z)) })
  ] });
}
function ty({ items: r, isAdmin: d, onUpdate: m }) {
  return d ? /* @__PURE__ */ i.jsxs("section", { id: "recycle-bin", className: "glass-card settings-section", children: [
    /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "可恢复删除" }),
    /* @__PURE__ */ i.jsx("h2", { children: "项目回收站" }),
    /* @__PURE__ */ i.jsx("p", { children: "普通删除可恢复；永久删除会同时清除项目关联数据和附件。" }),
    r.length ? /* @__PURE__ */ i.jsx("div", { className: "recycle-list", children: r.map((f) => /* @__PURE__ */ i.jsxs("article", { children: [
      /* @__PURE__ */ i.jsxs("div", { children: [
        /* @__PURE__ */ i.jsx("strong", { children: String(f.name) }),
        /* @__PURE__ */ i.jsxs("small", { children: [
          String(f.number),
          " · ",
          String(f.deleted_at ?? "")
        ] })
      ] }),
      /* @__PURE__ */ i.jsxs("div", { className: "settings-actions", children: [
        /* @__PURE__ */ i.jsx("button", { "aria-label": `恢复${String(f.name)}`, onClick: () => void m("restore-project", { id: f.id }), children: "恢复" }),
        /* @__PURE__ */ i.jsx("button", { className: "danger-action", "aria-label": `永久删除${String(f.name)}`, onClick: () => {
          window.confirm(`永久删除“${String(f.name)}”？此操作无法撤销。`) && m("purge-project", { id: f.id, confirmation: "PERMANENTLY_DELETE" });
        }, children: "永久删除" })
      ] })
    ] }, String(f.id))) }) : /* @__PURE__ */ i.jsx("p", { className: "empty-copy", children: "回收站为空" })
  ] }) : null;
}
const ly = [["appearance", "外观"], ["workflow", "流程"], ["email", "邮件"], ["security", "安全"], ["data", "数据"], ["recycle-bin", "回收站"], ["users", "账号"]];
function ay({ state: r, isAdmin: d, onUpdate: m }) {
  if (r.status === "idle" || r.status === "loading") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message", children: "正在载入系统设置" }) });
  if (r.status === "error") return /* @__PURE__ */ i.jsx("section", { className: "feature-page", children: /* @__PURE__ */ i.jsx("p", { className: "state-message error", role: "alert", children: r.error }) });
  const f = r.data;
  return /* @__PURE__ */ i.jsxs("article", { className: "settings-workspace", children: [
    /* @__PURE__ */ i.jsxs("header", { className: "page-heading", children: [
      /* @__PURE__ */ i.jsx("span", { children: "管理中心" }),
      /* @__PURE__ */ i.jsx("h1", { children: "系统设置" }),
      /* @__PURE__ */ i.jsx("p", { children: d ? "配置流程、提醒、安全、数据和团队账号。" : "只读设置视图" })
    ] }),
    /* @__PURE__ */ i.jsx("nav", { className: "settings-nav", "aria-label": "设置章节", children: ly.map(([E, z]) => /* @__PURE__ */ i.jsx("button", { onClick: () => document.getElementById(E)?.scrollIntoView({ block: "start" }), children: z }, E)) }),
    /* @__PURE__ */ i.jsxs("div", { className: "settings-sections", children: [
      /* @__PURE__ */ i.jsx($v, {}),
      /* @__PURE__ */ i.jsx(ey, { settings: f.settings, isAdmin: d, onUpdate: m }),
      /* @__PURE__ */ i.jsx(Fv, { settings: f.settings, failures: f.reminderFailures, isAdmin: d, onUpdate: m }),
      /* @__PURE__ */ i.jsx(Pv, { info: f.systemInfo, health: f.health }),
      /* @__PURE__ */ i.jsx(Wv, { settings: f.settings, uploadLimit: f.uploadLimit, isAdmin: d, onUpdate: m }),
      /* @__PURE__ */ i.jsx(ty, { items: f.recycleBin, isAdmin: d, onUpdate: m }),
      /* @__PURE__ */ i.jsx(Iv, { users: f.users, isAdmin: d, onUpdate: m })
    ] })
  ] });
}
const Sd = () => ({
  number: "",
  name: "",
  purchaser: "",
  method: "公开招标",
  budget: "",
  year: (/* @__PURE__ */ new Date()).getFullYear(),
  prepare_owner: "",
  review_owner: "",
  notes: ""
});
function ny(r) {
  const d = {};
  return r.number.trim() || (d.number = "请填写项目编号"), r.name.trim() || (d.name = "请填写项目名称"), r.purchaser.trim() || (d.purchaser = "请填写采购人"), r.method.trim() || (d.method = "请填写采购方式"), (!Number.isInteger(r.year) || r.year < 2e3 || r.year > 2200) && (d.year = "年度应为 2000 至 2200 之间的整数"), r.budget.trim() && (!Number.isFinite(Number(r.budget)) || Number(r.budget) < 0) && (d.budget = "预算应为大于或等于 0 的数字"), d;
}
function uy({ open: r, onClose: d, onCreate: m }) {
  const [f, E] = G.useState(Sd), [z, j] = G.useState(!1), [U, T] = G.useState(""), [p, A] = G.useState({});
  if (!r) return null;
  const _ = (B) => ({
    value: f[B],
    "aria-invalid": !!p[B],
    "aria-describedby": p[B] ? `${B}-error` : void 0,
    onChange: (I) => {
      const L = B === "year" ? Number(I.target.value) : I.target.value;
      E((Q) => ({ ...Q, [B]: L })), A((Q) => ({ ...Q, [B]: void 0 }));
    }
  }), q = (B) => p[B] && /* @__PURE__ */ i.jsx("small", { id: `${B}-error`, className: "field-error", children: p[B] }), le = async (B) => {
    if (B.preventDefault(), z) return;
    const I = ny(f);
    if (Object.keys(I).length) {
      A(I);
      return;
    }
    j(!0), T("");
    try {
      await m(f), E(Sd()), A({}), d();
    } catch (L) {
      T(L instanceof Error ? L.message : "创建项目失败，请检查网络后重试");
    } finally {
      j(!1);
    }
  };
  return /* @__PURE__ */ i.jsxs("div", { className: "drawer-layer", children: [
    /* @__PURE__ */ i.jsx("button", { className: "drawer-scrim", "aria-label": "关闭新建项目", onClick: d }),
    /* @__PURE__ */ i.jsxs("aside", { className: "edit-drawer", role: "dialog", "aria-modal": "true", "aria-label": "新建项目", children: [
      /* @__PURE__ */ i.jsxs("header", { children: [
        /* @__PURE__ */ i.jsxs("div", { children: [
          /* @__PURE__ */ i.jsx("span", { className: "eyebrow", children: "项目资料" }),
          /* @__PURE__ */ i.jsx("h2", { children: "新建项目" }),
          /* @__PURE__ */ i.jsx("p", { children: "带 * 的内容必须填写，创建后会直接进入项目工作台。" })
        ] }),
        /* @__PURE__ */ i.jsx("button", { type: "button", "aria-label": "关闭新建项目窗口", onClick: d, children: "×" })
      ] }),
      /* @__PURE__ */ i.jsxs("form", { onSubmit: le, noValidate: !0, children: [
        /* @__PURE__ */ i.jsxs("label", { children: [
          "项目编号 *",
          /* @__PURE__ */ i.jsx("input", { required: !0, autoFocus: !0, placeholder: "例如：PRJ-2026-001", "aria-label": "项目编号", ..._("number") }),
          q("number")
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "项目名称 *",
          /* @__PURE__ */ i.jsx("input", { required: !0, placeholder: "请输入完整项目名称", "aria-label": "项目名称", ..._("name") }),
          q("name")
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "采购人 *",
          /* @__PURE__ */ i.jsx("input", { required: !0, placeholder: "请输入采购单位", "aria-label": "采购人", ..._("purchaser") }),
          q("purchaser")
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "采购方式 *",
          /* @__PURE__ */ i.jsx("input", { required: !0, placeholder: "例如：公开招标", "aria-label": "采购方式", ..._("method") }),
          q("method")
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "年度 *",
          /* @__PURE__ */ i.jsx("input", { required: !0, type: "number", min: "2000", max: "2200", "aria-label": "年度", ..._("year") }),
          q("year")
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "预算",
          /* @__PURE__ */ i.jsx("input", { inputMode: "decimal", placeholder: "可选，例如：420000", "aria-label": "预算", ..._("budget") }),
          q("budget")
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "编制负责人",
          /* @__PURE__ */ i.jsx("input", { placeholder: "可选", "aria-label": "编制负责人", ..._("prepare_owner") })
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "审核负责人",
          /* @__PURE__ */ i.jsx("input", { placeholder: "可选", "aria-label": "审核负责人", ..._("review_owner") })
        ] }),
        /* @__PURE__ */ i.jsxs("label", { children: [
          "备注",
          /* @__PURE__ */ i.jsx("textarea", { placeholder: "可选，填写需要团队注意的事项", "aria-label": "备注", ..._("notes") })
        ] }),
        U && /* @__PURE__ */ i.jsx("p", { className: "form-error", role: "alert", children: U }),
        /* @__PURE__ */ i.jsxs("div", { className: "drawer-actions", children: [
          /* @__PURE__ */ i.jsx("button", { type: "button", onClick: d, disabled: z, children: "取消" }),
          /* @__PURE__ */ i.jsx("button", { disabled: z, type: "submit", className: "primary-action", children: z ? "正在创建…" : "创建项目" })
        ] })
      ] })
    ] })
  ] });
}
function iy(r = []) {
  let d = [...r], m = 0;
  return {
    projects: () => d,
    commitProject(f) {
      return m += 1, d = d.findIndex((z) => z.id === f.id) === -1 ? [...d, f] : d.map((z) => z.id === f.id ? f : z), d;
    },
    removeProject(f) {
      return m += 1, d = d.filter((E) => E.id !== f), d;
    },
    beginRevalidation() {
      const f = m;
      return {
        accept(E) {
          return f !== m ? !1 : (d = [...E], !0);
        }
      };
    }
  };
}
function _d(r) {
  return {
    id: r.id,
    number: r.number,
    name: r.name,
    status: r.status ?? "进行中",
    progress: r.progress,
    current_stage_key: r.current_stage_key ?? null,
    current_stage_name: r.current_stage_name,
    purchaser: r.purchaser,
    method: r.method,
    stages: r.stages
  };
}
function cy({ bootstrap: r }) {
  const [d, m] = G.useState(() => bd(window.location.hash)), [f, E] = G.useState(() => bv()), [z, j] = G.useState(!1), [U, T] = G.useState(!1), [p, A] = G.useState({ status: "loading" }), [_, q] = G.useState({ status: "loading" }), [le, B] = G.useState({ status: "idle" }), [I, L] = G.useState({ status: "idle" }), [Q, P] = G.useState({ status: "idle" }), [V, de] = G.useState({ status: "idle" }), ae = G.useRef(iy()), { push: Oe } = Td(), te = G.useMemo(() => iv({ csrfToken: r.csrfToken }), [r.csrfToken]);
  G.useEffect(() => {
    jv(f), pv(f);
  }, [f]), G.useEffect(() => {
    const w = () => m(bd(window.location.hash));
    return window.addEventListener("hashchange", w), () => window.removeEventListener("hashchange", w);
  }, []), G.useEffect(() => {
    const w = ae.current.beginRevalidation();
    return te.request("/api/projects", { scope: "projects" }).then((o) => {
      o.ok && w.accept(o.data) ? A({ status: "success", data: ae.current.projects() }) : !o.ok && o.error.error_code !== "request_cancelled" && A({ status: "error", error: o.error.error });
    }), te.request("/api/stats", { scope: "dashboard" }).then((o) => q(o.ok ? { status: "success", data: o.data } : { status: "error", error: o.error.error })), () => {
      te.abortScope("projects"), te.abortScope("dashboard");
    };
  }, [te]), G.useEffect(() => {
    if (d.view === "calendar") {
      B({ status: "loading", data: le.data });
      const [w, o] = (d.month ?? "").split("-"), N = w && o ? `?year=${w}&month=${o}` : "";
      te.request(`/api/calendar${N}`, { scope: "calendar" }).then((C) => B(C.ok ? { status: "success", data: C.data } : { status: "error", error: C.error.error }));
    }
    return d.view === "procurement" && (L({ status: "loading", data: I.data }), te.request("/api/settings?purchaser_board_view=bootstrap", { scope: "procurement" }).then((w) => L(w.ok ? { status: "success", data: w.data } : { status: "error", error: w.error.error }))), d.view === "project" && (P((w) => w.data?.id === d.projectId ? w : { status: "loading" }), te.request(`/api/projects/${d.projectId}`, { scope: `project:${d.projectId}` }).then((w) => P(w.ok ? { status: "success", data: w.data } : { status: "error", error: w.error.error }))), d.view === "settings" && (de((o) => ({ status: "loading", data: o.data })), (async () => {
      const o = r.user.role === "administrator", [N, C, H, Z, k, K, Ye] = await Promise.all([
        te.request("/api/settings", { scope: "settings" }),
        te.request("/api/settings/upload-limit", { scope: "settings" }),
        te.request("/api/system-info", { scope: "settings" }),
        te.request("/api/health", { scope: "settings" }),
        o ? te.request("/api/users", { scope: "settings" }) : Promise.resolve({ ok: !0, data: [] }),
        o ? te.request("/api/admin/reminder-failures", { scope: "settings" }) : Promise.resolve({ ok: !0, data: [] }),
        o ? te.request("/api/recycle-bin/projects", { scope: "settings" }) : Promise.resolve({ ok: !0, data: [] })
      ]), ve = [N, C, H, Z, k, K, Ye].find((xt) => !xt.ok);
      if (ve && !ve.ok) {
        de({ status: "error", error: ve.error.error });
        return;
      }
      de({ status: "success", data: { settings: N.ok ? N.data : {}, uploadLimit: C.ok ? C.data : {}, systemInfo: H.ok ? H.data : {}, health: Z.ok ? Z.data : {}, users: k.ok ? k.data : [], reminderFailures: K.ok ? K.data : [], recycleBin: Ye.ok ? Ye.data : [] } });
    })()), () => {
      te.abortScope("calendar"), te.abortScope("procurement"), d.view === "project" && te.abortScope(`project:${d.projectId}`), d.view === "settings" && te.abortScope("settings");
    };
  }, [te, d]);
  const Se = (w) => {
    const o = gv(w);
    window.location.hash === o ? m(w) : window.location.hash = o, j(!1);
  }, st = async (w) => {
    const o = await te.request(`/api/projects/${w}`, { scope: `project:${w}` });
    P(o.ok ? { status: "success", data: o.data } : { status: "error", error: o.error.error });
  }, Vt = async (w, o) => {
    let N = "/api/settings", C = "PATCH", H;
    w === "upload-limit" && (N = "/api/settings/upload-limit", C = "PUT"), w === "user" && o.id && (N = `/api/users/${o.id}`, C = "PUT", o = Object.fromEntries(Object.entries(o).filter(([k]) => k !== "id"))), w === "create-user" && (N = "/api/users", C = "POST"), w === "reset-password" && o.id && (N = `/api/users/${o.id}/reset-password`, C = "POST", o = { password: o.password }), w === "delete-user" && o.id && (N = `/api/users/${o.id}`, C = "DELETE"), w === "restore-project" && o.id && (N = `/api/recycle-bin/projects/${o.id}/restore`, C = "POST"), w === "purge-project" && o.id && (N = `/api/recycle-bin/projects/${o.id}`, C = "DELETE"), w === "retry-reminder" && o.id && (N = `/api/admin/reminder-failures/${o.id}/retry`, C = "POST"), w === "import-projects" && o.file instanceof File && (N = "/api/import/projects", C = "POST", H = new FormData(), H.append("file", o.file));
    const Z = await te.request(N, { method: C, ...H ? { body: H } : { json: o }, idempotencyKey: crypto.randomUUID() });
    if (!Z.ok) throw new Error(Z.error.error);
    de((k) => k.status !== "success" ? k : w === "upload-limit" ? { status: "success", data: { ...k.data, uploadLimit: { ...k.data.uploadLimit, ...Z.data } } } : w === "workflow" || w === "email" ? { status: "success", data: { ...k.data, settings: { ...k.data.settings, ...Z.data } } } : w === "user" ? { status: "success", data: { ...k.data, users: k.data.users.map((K) => K.id === Z.data.id ? { ...K, ...Z.data } : K) } } : w === "create-user" ? { status: "success", data: { ...k.data, users: [...k.data.users, Z.data] } } : w === "delete-user" ? { status: "success", data: { ...k.data, users: k.data.users.filter((K) => K.id !== o.id) } } : w === "restore-project" || w === "purge-project" ? { status: "success", data: { ...k.data, recycleBin: k.data.recycleBin.filter((K) => K.id !== o.id) } } : w === "retry-reminder" ? { status: "success", data: { ...k.data, reminderFailures: k.data.reminderFailures.filter((K) => K.id !== o.id) } } : k), w === "import-projects" && await Je();
  }, Je = async (w = !1) => {
    te.abortScope("projects");
    const o = ae.current.beginRevalidation(), N = await te.request("/api/projects", { scope: "projects" });
    N.ok && o.accept(N.data) ? A({ status: "success", data: ae.current.projects() }) : !N.ok && w && N.error.error_code !== "request_cancelled" && Oe({ tone: "warning", title: "项目已保存", message: "项目列表刷新失败，可稍后重试" });
  }, Re = async () => {
    te.abortScope("dashboard");
    const w = await te.request("/api/stats", { scope: "dashboard" });
    w.ok && q({ status: "success", data: w.data });
  }, zt = async (w) => {
    const o = await te.request("/api/projects", { method: "POST", json: w, idempotencyKey: crypto.randomUUID() });
    if (!o.ok) throw new Error(o.error.error);
    const N = ae.current.commitProject(_d(o.data));
    return A({ status: "success", data: N }), P({ status: "success", data: o.data }), Se({ view: "project", projectId: o.data.id }), Oe({ tone: "success", title: "项目已创建", message: `${o.data.number} 已进入项目工作台` }), Je(!0), Re(), o.data;
  }, Dt = async (w) => {
    if (d.view !== "project") return;
    const o = await te.request(`/api/projects/${d.projectId}`, { method: "PUT", json: w, idempotencyKey: crypto.randomUUID() });
    if (!o.ok) throw new Error(o.error.error);
    P({ status: "success", data: o.data }), A({ status: "success", data: ae.current.commitProject(_d(o.data)) }), Je();
  }, we = async () => {
    if (d.view !== "project") return;
    const w = Q.data?.record_version, o = await te.request(`/api/projects/${d.projectId}`, { method: "DELETE", json: { record_version: w }, idempotencyKey: crypto.randomUUID() });
    if (!o.ok) throw new Error(o.error.error);
    await Je(), Se({ view: "dashboard" });
  }, D = async () => {
    await te.request("/api/session", { method: "DELETE" }), window.location.assign("/login");
  }, Y = async (w, o) => {
    const N = await te.request("/api/me/change-password", { method: "POST", json: { old_password: w, new_password: o }, idempotencyKey: crypto.randomUUID() });
    if (!N.ok) throw new Error(N.error.error);
    window.location.assign("/login");
  }, $ = d.view === "dashboard" ? /* @__PURE__ */ i.jsx(xv, { state: _, projects: p.data ?? [], onOpenProject: (w) => Se({ view: "project", projectId: w }) }) : d.view === "calendar" ? /* @__PURE__ */ i.jsx(_v, { state: le, onMonth: (w) => Se({ view: "calendar", month: w }), onOpenProject: (w) => Se({ view: "project", projectId: w }) }) : d.view === "procurement" ? /* @__PURE__ */ i.jsx(Ev, { state: I, isAdmin: r.user.role === "administrator", onOpenProject: (w) => Se({ view: "project", projectId: w }) }) : d.view === "project" ? /* @__PURE__ */ i.jsx(kv, { state: Q, anchor: d.anchor, client: te, canEdit: r.user.role !== "viewer", onProjectUpdate: Dt, onProjectDelete: we, onReload: () => st(d.projectId), onNavigateAnchor: (w) => Se({ view: "project", projectId: d.projectId, anchor: w }), onStageUpdate: async (w, o) => {
    const N = await te.request(`/api/projects/${d.projectId}/stages/${w}`, { method: "PUT", json: o, idempotencyKey: crypto.randomUUID() });
    N.ok ? P({ status: "success", data: N.data }) : P((C) => ({ status: "error", data: C.data, error: N.error.error }));
  } }) : /* @__PURE__ */ i.jsx(ay, { state: V, isAdmin: r.user.role === "administrator", onUpdate: Vt });
  return /* @__PURE__ */ i.jsxs("div", { className: "app-shell", role: "application", "aria-label": "项目管理系统", children: [
    /* @__PURE__ */ i.jsx("aside", { className: "desktop-sidebar", "aria-label": "项目导航", children: /* @__PURE__ */ i.jsx(gd, { current: d, projects: p, onNavigate: Se, onNewProject: () => T(!0) }) }),
    /* @__PURE__ */ i.jsxs("div", { className: "content-shell", children: [
      /* @__PURE__ */ i.jsx(yv, { username: r.user.username, theme: f, onThemeChange: E, onOpenSidebar: () => j(!0), onLogout: () => void D(), onChangePassword: Y }),
      /* @__PURE__ */ i.jsx("main", { className: "main-scroll", "data-main-scroll": !0, "data-testid": "main-scroll", children: $ })
    ] }),
    z && /* @__PURE__ */ i.jsxs("div", { className: "mobile-sidebar-layer", children: [
      /* @__PURE__ */ i.jsx("button", { className: "sidebar-scrim", "aria-label": "点击遮罩关闭项目导航", onClick: () => j(!1) }),
      /* @__PURE__ */ i.jsxs("div", { className: "mobile-sidebar", role: "dialog", "aria-modal": "true", "aria-label": "项目导航", children: [
        /* @__PURE__ */ i.jsx("button", { className: "mobile-sidebar-close", "aria-label": "关闭项目导航", onClick: () => j(!1), children: "×" }),
        /* @__PURE__ */ i.jsx(gd, { current: d, projects: p, onNavigate: Se, onNewProject: () => {
          j(!1), T(!0);
        } })
      ] })
    ] }),
    /* @__PURE__ */ i.jsx(uy, { open: U, onClose: () => T(!1), onCreate: zt }),
    /* @__PURE__ */ i.jsx(vv, {})
  ] });
}
function sy({ bootstrap: r }) {
  return /* @__PURE__ */ i.jsx(mv, { children: /* @__PURE__ */ i.jsx(cy, { bootstrap: r }) });
}
function ry() {
  const r = window.__HPM_BOOTSTRAP__;
  if (!r?.user || !r.csrfToken)
    throw new Error("BOOTSTRAP_STATE_INVALID");
  return r;
}
const Ad = document.getElementById("app-root");
if (!Ad) throw new Error("APP_ROOT_MISSING");
uv.createRoot(Ad).render(
  /* @__PURE__ */ i.jsx(G.StrictMode, { children: /* @__PURE__ */ i.jsx(sy, { bootstrap: ry() }) })
);
