import{n as e}from"./create-context--NqP-Eqb.js";
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
var t=class{get value(){return this.o}set value(e){this.setValue(e)}setValue(e,t=!1){let n=t||!Object.is(e,this.o);this.o=e,n&&this.updateObservers()}constructor(e){this.subscriptions=/* @__PURE__ */ new Map,this.updateObservers=()=>{for(let[e,{disposer:t}]of this.subscriptions)e(this.o,t)},e!==void 0&&(this.value=e)}addCallback(e,t,n){if(!n)return void e(this.value);this.subscriptions.has(e)||this.subscriptions.set(e,{disposer:()=>{this.subscriptions.delete(e)},consumerHost:t});let{disposer:r}=this.subscriptions.get(e);e(this.value,r)}clearCallbacks(){this.subscriptions.clear()}},n=class extends Event{constructor(e,t){
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
super(`context-provider`,{bubbles:!0,composed:!0}),this.context=e,this.contextTarget=t}},r=class extends t{constructor(t,n,r){super(n.context===void 0?r:n.initialValue),this.onContextRequest=e=>{if(e.context!==this.context)return;let t=e.contextTarget??e.composedPath()[0];t!==this.host&&(e.stopPropagation(),this.addCallback(e.callback,t,e.subscribe))},this.onProviderRequest=t=>{if(t.context!==this.context||(t.contextTarget??t.composedPath()[0])===this.host)return;let n=/* @__PURE__ */ new Set;for(let[t,{consumerHost:r}]of this.subscriptions)n.has(t)||(n.add(t),r.dispatchEvent(new e(this.context,r,t,!0)));t.stopPropagation()},this.host=t,this.context=n.context===void 0?n:n.context,this.attachListeners(),this.host.addController?.(this)}attachListeners(){this.host.addEventListener(`context-request`,this.onContextRequest),this.host.addEventListener(`context-provider`,this.onProviderRequest)}hostConnected(){this.host.dispatchEvent(new n(this.context,this.host))}};export{r as t};
//# sourceMappingURL=context-provider-ivCWVZbp.js.map