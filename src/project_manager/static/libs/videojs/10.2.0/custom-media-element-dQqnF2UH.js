import{t as e}from"./pick-66qBhPHR.js";import{r as t,t as n}from"./attributes-DrTKm-Cs.js";import{n as r}from"./casing-CxqC0yQL.js";function i(e,t){let n={};for(let r in e)t.includes(r)||(n[r]=e[r]);return n}const a={borderRadius:`--media-video-border-radius`,objectFit:`--media-object-fit`,objectPosition:`--media-object-position`,captionTrackDuration:`--media-caption-track-duration`,captionTrackDelay:`--media-caption-track-delay`,captionTrackY:`--media-caption-track-y`};function o(e){return`
    <style>
      :host {
        display: contents;
      }

      video {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: var(${a.borderRadius});
        object-fit: var(${a.objectFit}, contain);
        object-position: var(${a.objectPosition}, center);
      }

      video::-webkit-media-text-track-container {
        transition: translate var(${a.captionTrackDuration}, 0) ease-out;
        transition-delay: var(${a.captionTrackDelay}, 0);
        translate: 0 var(${a.captionTrackY}, 0);
        scale: 0.98;
        z-index: 1;
        font-family: inherit;
      }
    </style>
    <slot name="media">
      <video${t(e)}></video>
    </slot>
    <slot></slot>
  `}function s(e){return n=>`
      <style>
        :host {
          display: inline-flex;
          line-height: 0;
          flex-direction: column;
          justify-content: end;
        }

        ${e} {
          width: 100%;
        }
      </style>
      <slot name="media">
        <${e}${t(n)}></${e}>
      </slot>
      <slot></slot>
    `}const c=[`attach`,`detach`,`destroy`];function l(e,t){let n=t[e];return n?n.attribute??e.toLowerCase():r(e)}function u(e,t,n){let{attribute:r}=t[e]??{};return!!r&&r in n}function d(e,t,n){return typeof t==`boolean`?e!==null:typeof t==`number`?Number(e):e??(n&&`empty`in n?n.empty:``)}function f(t,r){let a=t!==`iframe`,f=/* @__PURE__ */ new Map,m=!1;class h extends (globalThis.HTMLElement??class{}){static getTemplateHTML=t.endsWith(`video`)?o:s(t);static shadowRootOptions={mode:`open`};static properties={autoPictureInPicture:{type:Boolean},autoplay:{type:Boolean},controls:{type:Boolean},controlsList:{type:String},crossOrigin:{type:String,empty:null},defaultMuted:{type:Boolean,attribute:`muted`},disablePictureInPicture:{type:Boolean},disableRemotePlayback:{type:Boolean},loading:{type:String},loop:{type:Boolean},playsInline:{type:Boolean},poster:{type:String,empty:``},preload:{type:String,empty:null},src:{type:String,empty:``},streamType:{type:String,attribute:`stream-type`,empty:`unknown`}};static get observedAttributes(){return h.#e(this),[...p(this.properties)]}static#e(e){if(m)return;m=!0;let t=e.properties;for(let n=r.prototype;n&&n!==Object.prototype;n=Object.getPrototypeOf(n))for(let i of Object.getOwnPropertyNames(n)){if(i in h.prototype||c.includes(i)||u(i,t,r.prototype))continue;let a=Object.getOwnPropertyDescriptor(n,i);if(!a)continue;let o={enumerable:!0,configurable:!0};if(typeof a.value==`function`)o.value=function(...e){return this.#t[i](...e)};else if(a.get&&(o.get=function(){return this.#t[i]},a.set)){let n=l(i,t);e.observedAttributes.includes(n)?(f.set(n,i),o.set=function(e){e===!0||e===!1||e==null?this.toggleAttribute(n,!!e):this.setAttribute(n,String(e))}):o.set=function(e){this.#t[i]=e}}Object.defineProperty(h.prototype,i,o)}for(let[e,{type:n,attribute:r}]of Object.entries(t)){if(e in h.prototype)continue;let t=r??e.toLowerCase();Object.defineProperty(h.prototype,e,{get:function(){return n===Boolean?this.hasAttribute(t):this.getAttribute(t)},set:function(e){n===Boolean?this.toggleAttribute(t,!!e):this.setAttribute(t,e)},enumerable:!0,configurable:!0})}}#t;#n=/* @__PURE__ */ new Set;#r=/* @__PURE__ */ new Map;#i;constructor(){if(super(),!this.shadowRoot){let r=this.constructor;this.attachShadow(r.shadowRootOptions);let o=p(r.properties),s=[...f.keys()],c=e(n(this.attributes),o),l=a?i(c,s):c;t&&!l.part&&(l.part=t),this.shadowRoot.innerHTML=r.getTemplateHTML(l)}this.#t=new r,this.#a(),this.#i=new MutationObserver(this.#c.bind(this)),this.shadowRoot.addEventListener(`slotchange`,()=>{this.#a(),this.#s()}),this.#s()}#a(){let e=this.target;e!==this.#t.target&&(this.#t.target&&this.#t.detach(),this.#t.attach(e))}get adapter(){return this.#t}get target(){return this.querySelector(`:scope > [slot=media]`)??this.querySelector(t)??this.shadowRoot?.querySelector(t)??null}connectedCallback(){t===`iframe`&&(this.hasAttribute(`data-cross-origin-frame`)||this.setAttribute(`data-cross-origin-frame`,``))}disconnectedCallback(){this.hasAttribute(`keep-alive`)||queueMicrotask(()=>{this.isConnected||this.#t.destroy()})}addEventListener(e,t,n){super.addEventListener(e,t,n),this.#n.has(e)||(this.#n.add(e),this.#t.addEventListener(e,this.#o))}removeEventListener(e,t,n){super.removeEventListener(e,t,n)}#o=e=>{e.composed||this.dispatchEvent(new e.constructor(e.type,e))};attributeChangedCallback(e,t,n){let r=f.get(e);if(r){if(t!==n){let e=this.constructor.properties[r];this.#t[r]=d(n,this.#t[r],e)}return}(h.observedAttributes.includes(e)||!this.constructor.observedAttributes.includes(e))&&a&&(n===null?this.target?.removeAttribute(e):this.target?.getAttribute(e)!==n&&this.target?.setAttribute(e,n))}#s(){if(t===`iframe`)return;let e=this.shadowRoot?.querySelector(`slot:not([name])`),n=new Set(e?.assignedElements({flatten:!0}).filter(e=>e.localName===`track`||e.localName===`source`));for(let[e,t]of this.#r)n.has(e)||(t.remove(),this.#r.delete(e));for(let e of n){let t=this.#r.get(e);t||(t=e.cloneNode(),this.#r.set(e,t),this.#i?.observe(e,{attributes:!0})),this.target?.append(t),this.#l(t)}}#c(e){for(let t of e)if(t.type===`attributes`){let{target:e,attributeName:n}=t,r=this.#r.get(e);r&&n&&(r.setAttribute(n,e.getAttribute(n)??``),this.#l(r))}}#l(e){e&&e.localName===`track`&&e.default&&(e.kind===`chapters`||e.kind===`metadata`)&&e.track.mode===`disabled`&&(e.track.mode=`hidden`)}}return h}function p(e){return Object.keys(e).map(t=>l(t,e))}export{a as n,f as t};
//# sourceMappingURL=custom-media-element-dQqnF2UH.js.map