/*! Video.js | https://videojs.org/help */
import{r as e,t}from"./create-player-B5Xsr_sp.js";import{r as n}from"./shadow-styles-9eM0EVFC.js";import{n as r}from"./ui-element-CUMzLga1.js";import{t as i}from"./safe-define-DXxmf7BV.js";import"./ui/container.js";import"./background-video-CEALdiBE.js";const{PlayerElement:a,PlayerController:o}=t({features:e});var s=class extends a{static{this.tagName=`background-video-player`}};i(s);var c=`background-video-player{display:contents}background-video-skin{--media-object-fit:cover;object-fit:var(--media-object-fit);width:100%;min-width:300px;height:100%;min-height:150px;display:block;position:relative}background-video-skin>:not(img,picture){object-fit:var(--media-object-fit);width:100%;height:100%;position:absolute;inset:0}background-video-skin>img,background-video-skin>picture{object-fit:var(--media-object-fit);width:100%;height:100%}
`;function l(){return`
    <media-container>
      <!-- @deprecated slot="media" is no longer required, use the default slot instead -->
      <slot name="media"></slot>
      <slot></slot>
    </media-container>
  `}var u=class e extends r{static{this.tagName=`background-video-skin`}static{this.shadowRootOptions={mode:`open`}}static{this.getTemplateHTML=l}constructor(){super(),n(`__media-background-styles`,c),this.shadowRoot||(this.attachShadow(e.shadowRootOptions),this.shadowRoot.innerHTML=l())}};i(u);
//# sourceMappingURL=background.js.map