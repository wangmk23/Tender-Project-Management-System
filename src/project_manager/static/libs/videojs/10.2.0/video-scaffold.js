/*! Video.js | https://videojs.org/help */
import"./i18n-BfZDJOyu.js";import{n as e}from"./shadow-styles-9eM0EVFC.js";import{n as t}from"./template-BKUlUXWF.js";import{t as n}from"./safe-define-DXxmf7BV.js";import"./player-BdRyYiuB.js";import{n as r,t as i}from"./register-Jh8czhUI.js";import"./ui/container.js";import"./ui/poster.js";import"./ui/buffering-indicator.js";import"./ui/error-dialog.js";import"./ui/dialog-backdrop.js";import"./ui/dialog-popup.js";import"./ui/dialog-title.js";import"./ui/dialog-description.js";import"./ui/dialog-close.js";import"./ui/title.js";import"./ui/controls.js";import"./ui/controls-backdrop.js";import"./ui/controls-content.js";import"./ui/tooltip-group.js";import"./ui/controls-group.js";import"./ui/airplay-button.js";import"./ui/tooltip.js";import"./ui/tooltip-label.js";import"./ui/tooltip-shortcut.js";import"./ui/cast-button.js";import"./ui/pip-button.js";import"./ui/fullscreen-button.js";import"./ui/play-button.js";import"./ui/time-slider.js";import"./ui/time-slider-chapters.js";import"./ui/slider-track.js";import"./ui/slider-buffer.js";import"./ui/slider-fill.js";import"./ui/slider-thumb.js";import"./ui/slider-preview.js";import"./ui/slider-thumbnail.js";import"./ui/slider-value.js";import"./ui/time-slider-chapter-title.js";import"./ui/mute-button.js";import"./ui/volume-popover.js";import"./ui/volume-slider.js";import"./ui/time.js";import"./ui/captions-button.js";import"./ui/menu.js";import"./ui/menu-content.js";import"./ui/menu-item.js";import"./ui/menu-separator.js";import"./ui/quality-radio-group.js";import"./ui/menu-radio-item.js";import"./ui/menu-item-indicator.js";import"./ui/audio-track-radio-group.js";import"./ui/playback-rate-radio-group.js";import"./ui/captions-radio-group.js";import"./ui/hotkey.js";import"./ui/gesture.js";import"./ui/status-announcer.js";import"./ui/volume-indicator.js";import"./ui/volume-indicator-fill.js";import"./ui/volume-indicator-value.js";import"./ui/status-indicator.js";import"./ui/status-indicator-value.js";import"./ui/seek-indicator.js";import"./ui/seek-indicator-value.js";import"./ui/time-group.js";import"./ui/time-separator.js";import"./ui/seek-button.js";import{a,c as o,d as s,i as c,l,n as u,o as d,r as f,s as p,t as m,u as h}from"./volume-low-D4vltKLa.js";import{t as g}from"./check-DEKnJQhe.js";import{a as _,i as v,n as y,o as b,r as x,t as S}from"./volume-off-DlkIEV63.js";import{t as C}from"./seek-DqmitFf-.js";const w=t(`<media-container class="media-skin media-container media-video" data-theme="scaffold" data-preset="video">
<slot>
</slot>
<media-poster class="media-poster">
<slot name="poster">
<img alt="" decoding="async" class="media-poster-image">
</slot>
</media-poster>
<media-error-dialog>
<media-dialog-backdrop class="media-dialog-backdrop">
</media-dialog-backdrop>
<media-dialog-popup class="media-dialog-popup">
<media-dialog-title class="media-dialog-title">
</media-dialog-title>
<media-dialog-description class="media-dialog-description">
</media-dialog-description>
<media-dialog-close class="media-button media-dialog-close">
</media-dialog-close>
</media-dialog-popup>
</media-error-dialog>
<media-controls>
<media-controls-backdrop class="video-controls-backdrop">
</media-controls-backdrop>
<media-controls-group class="media-buffering-indicator-controls">
<media-buffering-indicator class="media-buffering-indicator media-buffering-indicator-backdrop">
<media-icon family="scaffold" name="spinner" class="media-buffering-indicator-spinner-icon">
</media-icon>
</media-buffering-indicator>
</media-controls-group>
<media-controls-content class="video-controls-content">
<media-tooltip-group>
<media-controls-group class="video-controls-top">
<media-title class="media-title">
</media-title>
<media-airplay-button class="media-button media-airplay-button" id="vjs-HNl1fwKe-0-trigger">
<media-icon family="scaffold" name="airplay-enter" class="media-button-icon media-airplay-button-enter-icon">
</media-icon>
<media-icon family="scaffold" name="airplay-exit" class="media-button-icon media-airplay-button-exit-icon">
</media-icon>
</media-airplay-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup media-tooltip-screen-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-cast-button class="media-button media-cast-button" id="vjs-HNl1fwKe-0-2-trigger">
<media-icon family="scaffold" name="cast-enter" class="media-button-icon media-cast-button-enter-icon">
</media-icon>
<media-icon family="scaffold" name="cast-exit" class="media-button-icon media-cast-button-exit-icon">
</media-icon>
</media-cast-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-2-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup media-tooltip-screen-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-pip-button class="media-button media-pip-button" id="vjs-HNl1fwKe-0-3-trigger">
<media-icon family="scaffold" name="pip-enter" class="media-button-icon media-pip-button-enter-icon">
</media-icon>
<media-icon family="scaffold" name="pip-exit" class="media-button-icon media-pip-button-exit-icon">
</media-icon>
</media-pip-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-3-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup media-tooltip-screen-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-fullscreen-button class="media-button media-fullscreen-button" id="vjs-HNl1fwKe-0-4-trigger">
<media-icon family="scaffold" name="fullscreen-enter" class="media-button-icon media-fullscreen-button-enter-icon">
</media-icon>
<media-icon family="scaffold" name="fullscreen-exit" class="media-button-icon media-fullscreen-button-exit-icon">
</media-icon>
</media-fullscreen-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-4-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup media-tooltip-screen-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
</media-controls-group>
<media-buffering-indicator class="video-controls-buffering">
<media-controls-group class="video-controls-center">
<media-seek-button seconds="-10" class="media-button video-controls-center-button video-controls-center-seek" id="vjs-HNl1fwKe-0-5-trigger">
<div class="media-seek-button-content">
<media-icon family="scaffold" name="seek" class="media-button-icon media-seek-button-backward-icon video-controls-center-seek-icon">
</media-icon>
<span class="media-seek-button-label media-seek-button-backward-label">10</span>
</div>
</media-seek-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-5-trigger" disabled side="top" class="media-popup media-popup-safe-area media-tooltip-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-play-button class="media-button media-play-button video-controls-center-button video-controls-center-play" id="vjs-HNl1fwKe-0-6-trigger">
<media-icon family="scaffold" name="restart" class="media-button-icon-base media-play-button-restart-icon video-controls-center-play-icon">
</media-icon>
<media-icon family="scaffold" name="play" class="media-button-icon-base media-play-button-play-icon video-controls-center-play-icon">
</media-icon>
<media-icon family="scaffold" name="pause" class="media-button-icon-base media-play-button-pause-icon video-controls-center-play-icon">
</media-icon>
</media-play-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-6-trigger" disabled side="top" class="media-popup media-popup-safe-area media-tooltip-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-seek-button seconds="10" class="media-button video-controls-center-button video-controls-center-seek" id="vjs-HNl1fwKe-0-7-trigger">
<div class="media-seek-button-content">
<media-icon family="scaffold" name="seek" class="media-button-icon video-controls-center-seek-icon">
</media-icon>
<span class="media-seek-button-label media-seek-button-forward-label">10</span>
</div>
</media-seek-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-7-trigger" disabled side="top" class="media-popup media-popup-safe-area media-tooltip-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
</media-controls-group>
</media-buffering-indicator>
<div class="video-controls-bottom video-controls-video-bottom">
<div class="video-controls-slider-row">
<media-time-slider class="media-time-slider" thumb-alignment="edge">
<media-time-slider-chapters class="media-time-slider-chapters">
<template>
<div class="media-time-slider-chapter">
<media-slider-track class="media-time-slider-track">
<media-slider-buffer class="media-time-slider-buffer">
</media-slider-buffer>
<media-slider-fill class="media-time-slider-fill">
</media-slider-fill>
</media-slider-track>
</div>
</template>
</media-time-slider-chapters>
<media-slider-thumb class="media-time-slider-thumb">
</media-slider-thumb>
<media-slider-preview class="media-time-slider-preview">
<media-slider-thumbnail class="media-slider-thumbnail">
<img alt="" aria-hidden="true" decoding="async" class="media-slider-thumbnail-image">
</media-slider-thumbnail>
<div class="media-time-slider-preview-meta">
<div class="media-time-slider-preview-label">
<media-slider-value class="media-time-slider-value" type="pointer">
</media-slider-value>
<media-time-slider-chapter-title class="media-time-slider-chapter-title">
</media-time-slider-chapter-title>
</div>
</div>
</media-slider-preview>
</media-time-slider>
</div>
<media-controls-group class="video-controls-row">
<media-controls-group class="video-controls-group video-controls-start">
<media-play-button class="media-button media-play-button" id="vjs-HNl1fwKe-0-8-trigger">
<media-icon family="scaffold" name="restart" class="media-button-icon-base media-play-button-restart-icon">
</media-icon>
<media-icon family="scaffold" name="play" class="media-button-icon-base media-play-button-play-icon">
</media-icon>
<media-icon family="scaffold" name="pause" class="media-button-icon-base media-play-button-pause-icon">
</media-icon>
</media-play-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-8-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-mute-button commandfor="vjs-a5-df5XX-0-popup" class="media-button media-mute-button" id="vjs-HNl1fwKe-0-9-trigger">
<media-icon family="scaffold" name="volume-off" class="media-button-icon media-mute-button-off-icon">
</media-icon>
<media-icon family="scaffold" name="volume-high" class="media-button-icon media-mute-button-high-icon">
</media-icon>
</media-mute-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-9-trigger" delay="0" disabled side="top" sticky class="media-popup media-popup-safe-area media-tooltip-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<media-volume-popover open-on-hover delay="200" close-delay="100" side="top" class="media-popup media-popup-safe-area media-volume-popover-popup" id="vjs-a5-df5XX-0-popup">
<media-volume-slider class="media-volume-slider" orientation="vertical" thumb-alignment="edge">
<media-slider-track class="media-volume-slider-track">
<media-slider-fill class="media-volume-slider-fill">
</media-slider-fill>
</media-slider-track>
<media-slider-thumb class="media-volume-slider-thumb">
</media-slider-thumb>
</media-volume-slider>
</media-volume-popover>
<media-time-group class="media-time-group">
<media-time class="media-time-toggle" type="current" toggle>
</media-time>
<media-time class="media-time-current-value" type="current">
</media-time>
<media-time-separator class="media-time-separator">
</media-time-separator>
<media-time class="media-time-duration-value" type="duration">
</media-time>
</media-time-group>
</media-controls-group>
<media-controls-group class="video-controls-group">
<media-captions-button class="media-button media-captions-button" id="vjs-HNl1fwKe-0-10-trigger">
<media-icon family="scaffold" name="captions-off" class="media-button-icon media-captions-button-off-icon">
</media-icon>
<media-icon family="scaffold" name="captions-on" class="media-button-icon media-captions-button-on-icon">
</media-icon>
</media-captions-button>
<media-tooltip trigger="vjs-HNl1fwKe-0-10-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup">
<media-tooltip-label>
</media-tooltip-label>
<media-tooltip-shortcut class="media-tooltip-shortcut">
</media-tooltip-shortcut>
</media-tooltip>
<button commandfor="vjs-dexOLs_f-h-popup" class="media-button" id="vjs-HNl1fwKe-0-11-trigger">
<media-icon family="scaffold" name="gear" class="media-button-icon">
</media-icon>
<media-text class="media-settings-button-label" token="menu.settings">Settings</media-text>
</button>
<media-tooltip trigger="vjs-HNl1fwKe-0-11-trigger" side="top" class="media-popup media-popup-safe-area media-tooltip-popup">
<media-text token="menu.settings">Settings</media-text>
</media-tooltip>
<media-menu side="top" align="center" class="media-popup media-popup-safe-area media-menu-popup" id="vjs-dexOLs_f-h-popup">
<media-menu-content class="media-menu-content">
<media-menu-item commandfor="vjs-dexOLs_f-1-content" class="media-menu-item">
<media-icon family="scaffold" name="switches" class="media-menu-trigger-icon">
</media-icon>
<media-text token="menu.quality">Quality</media-text>
<span class="media-menu-hint">
<span data-part="value" class="media-menu-hint-label">
</span>
<media-icon family="scaffold" name="chevron" class="media-menu-forward-chevron">
</media-icon>
</span>
</media-menu-item>
<media-menu-content class="media-menu-content" id="vjs-dexOLs_f-1-content">
<media-menu-item class="media-menu-back-item">
<media-icon family="scaffold" name="chevron" class="media-menu-back-chevron">
</media-icon>
<media-text token="menu.quality">Quality</media-text>
</media-menu-item>
<media-menu-separator class="media-menu-separator">
</media-menu-separator>
<media-quality-radio-group class="media-menu-radio-group">
<template>
<media-menu-radio-item class="media-menu-radio-item">
<span>
<span data-part="label">
</span>
<sup data-part="tier" class="media-menu-tier">
</sup>
</span>
<span data-part="badge" class="media-menu-badge">
</span>
<media-menu-item-indicator force-mount class="media-menu-indicator">
<media-icon family="scaffold" name="check" class="media-menu-radio-icon">
</media-icon>
</media-menu-item-indicator>
</media-menu-radio-item>
</template>
</media-quality-radio-group>
</media-menu-content>
<media-menu-item commandfor="vjs-dexOLs_f-5-content" class="media-menu-item">
<media-icon family="scaffold" name="speech" class="media-menu-trigger-icon">
</media-icon>
<media-text token="menu.audio">Audio</media-text>
<span class="media-menu-hint">
<span data-part="value" class="media-menu-hint-label">
</span>
<media-icon family="scaffold" name="chevron" class="media-menu-forward-chevron">
</media-icon>
</span>
</media-menu-item>
<media-menu-content class="media-menu-content" id="vjs-dexOLs_f-5-content">
<media-menu-item class="media-menu-back-item">
<media-icon family="scaffold" name="chevron" class="media-menu-back-chevron">
</media-icon>
<media-text token="menu.audio">Audio</media-text>
</media-menu-item>
<media-menu-separator class="media-menu-separator">
</media-menu-separator>
<media-audio-track-radio-group class="media-menu-radio-group">
<template>
<media-menu-radio-item class="media-menu-radio-item">
<span data-part="label">
</span>
<media-menu-item-indicator force-mount class="media-menu-indicator">
<media-icon family="scaffold" name="check" class="media-menu-radio-icon">
</media-icon>
</media-menu-item-indicator>
</media-menu-radio-item>
</template>
</media-audio-track-radio-group>
</media-menu-content>
<media-menu-item commandfor="vjs-dexOLs_f-9-content" class="media-menu-item">
<media-icon family="scaffold" name="speed" class="media-menu-trigger-icon">
</media-icon>
<media-text token="menu.speed">Speed</media-text>
<span class="media-menu-hint">
<span data-part="value" class="media-menu-hint-label">
</span>
<media-icon family="scaffold" name="chevron" class="media-menu-forward-chevron">
</media-icon>
</span>
</media-menu-item>
<media-menu-content class="media-menu-content" id="vjs-dexOLs_f-9-content">
<media-menu-item class="media-menu-back-item">
<media-icon family="scaffold" name="chevron" class="media-menu-back-chevron">
</media-icon>
<media-text token="menu.speed">Speed</media-text>
</media-menu-item>
<media-menu-separator class="media-menu-separator">
</media-menu-separator>
<media-playback-rate-radio-group class="media-menu-radio-group">
<template>
<media-menu-radio-item class="media-menu-radio-item">
<span data-part="label">
</span>
<media-menu-item-indicator force-mount class="media-menu-indicator">
<media-icon family="scaffold" name="check" class="media-menu-radio-icon">
</media-icon>
</media-menu-item-indicator>
</media-menu-radio-item>
</template>
</media-playback-rate-radio-group>
</media-menu-content>
<media-menu-item commandfor="vjs-dexOLs_f-d-content" class="media-menu-item">
<media-icon family="scaffold" name="captions-off" class="media-menu-trigger-icon">
</media-icon>
<media-text token="menu.captions">Captions</media-text>
<span class="media-menu-hint">
<span data-part="value" class="media-menu-hint-label">
</span>
<media-icon family="scaffold" name="chevron" class="media-menu-forward-chevron">
</media-icon>
</span>
</media-menu-item>
<media-menu-content class="media-menu-content" id="vjs-dexOLs_f-d-content">
<media-menu-item class="media-menu-back-item">
<media-icon family="scaffold" name="chevron" class="media-menu-back-chevron">
</media-icon>
<media-text token="menu.captions">Captions</media-text>
</media-menu-item>
<media-menu-separator class="media-menu-separator">
</media-menu-separator>
<media-captions-radio-group class="media-menu-radio-group">
<template>
<media-menu-radio-item class="media-menu-radio-item">
<span data-part="label">
</span>
<media-menu-item-indicator force-mount class="media-menu-indicator">
<media-icon family="scaffold" name="check" class="media-menu-radio-icon">
</media-icon>
</media-menu-item-indicator>
</media-menu-radio-item>
</template>
</media-captions-radio-group>
</media-menu-content>
</media-menu-content>
</media-menu>
</media-controls-group>
</media-controls-group>
</div>
</media-tooltip-group>
</media-controls-content>
</media-controls>
<media-hotkey keys="Space" action="togglePaused">
</media-hotkey>
<media-hotkey keys="k" action="togglePaused">
</media-hotkey>
<media-hotkey keys="m" action="toggleMuted">
</media-hotkey>
<media-hotkey keys="ArrowRight" action="seekStep">
</media-hotkey>
<media-hotkey keys="ArrowLeft" action="seekStep">
</media-hotkey>
<media-hotkey keys="l" action="seekStep">
</media-hotkey>
<media-hotkey keys="j" action="seekStep">
</media-hotkey>
<media-hotkey keys="ArrowUp" action="volumeStep">
</media-hotkey>
<media-hotkey keys="ArrowDown" action="volumeStep">
</media-hotkey>
<media-hotkey keys="0-9" action="seekToPercent">
</media-hotkey>
<media-hotkey keys="Home" action="seekToPercent" value="0">
</media-hotkey>
<media-hotkey keys="End" action="seekToPercent" value="100">
</media-hotkey>
<media-hotkey keys="&gt;" action="speedUp">
</media-hotkey>
<media-hotkey keys="&lt;" action="speedDown">
</media-hotkey>
<media-hotkey keys="f" action="toggleFullscreen">
</media-hotkey>
<media-hotkey keys="c" action="toggleSubtitles">
</media-hotkey>
<media-hotkey keys="i" action="togglePictureInPicture">
</media-hotkey>
<media-gesture type="tap" action="togglePaused" pointer="mouse" region="center">
</media-gesture>
<media-gesture type="tap" action="toggleControls" pointer="touch">
</media-gesture>
<media-gesture type="doubletap" action="seekStep" region="left">
</media-gesture>
<media-gesture type="doubletap" action="toggleFullscreen" region="center">
</media-gesture>
<media-gesture type="doubletap" action="seekStep" region="right">
</media-gesture>
<media-status-announcer class="media-status-announcer">
</media-status-announcer>
<div aria-hidden="true" class="media-indicator-group">
<media-volume-indicator class="media-indicator media-volume-indicator">
<media-volume-indicator-fill class="media-volume-indicator-fill">
<media-icon family="scaffold" name="volume-high" class="media-volume-indicator-icon media-volume-indicator-high-icon">
</media-icon>
<media-icon family="scaffold" name="volume-low" class="media-volume-indicator-icon media-volume-indicator-low-icon">
</media-icon>
<media-icon family="scaffold" name="volume-off" class="media-volume-indicator-icon media-volume-indicator-off-icon">
</media-icon>
<media-volume-indicator-value class="media-volume-indicator-value">
</media-volume-indicator-value>
</media-volume-indicator-fill>
</media-volume-indicator>
<media-status-indicator actions="toggleSubtitles,toggleFullscreen,togglePictureInPicture" class="media-indicator media-status-indicator">
<media-icon family="scaffold" name="captions-on" class="media-status-indicator-icon media-status-indicator-captions-on-icon">
</media-icon>
<media-icon family="scaffold" name="captions-off" class="media-status-indicator-icon media-status-indicator-captions-off-icon">
</media-icon>
<media-icon family="scaffold" name="fullscreen-enter" class="media-status-indicator-icon media-status-indicator-fullscreen-enter-icon">
</media-icon>
<media-icon family="scaffold" name="fullscreen-exit" class="media-status-indicator-icon media-status-indicator-fullscreen-exit-icon">
</media-icon>
<media-icon family="scaffold" name="pip-enter" class="media-status-indicator-icon media-status-indicator-pip-enter-icon">
</media-icon>
<media-icon family="scaffold" name="pip-exit" class="media-status-indicator-icon media-status-indicator-pip-exit-icon">
</media-icon>
<media-status-indicator-value>
</media-status-indicator-value>
</media-status-indicator>
<media-seek-indicator class="media-indicator media-seek-indicator">
<media-icon family="scaffold" name="chevron" class="media-seek-indicator-icon">
</media-icon>
<media-seek-indicator-value class="media-seek-indicator-value">
</media-seek-indicator-value>
</media-seek-indicator>
</div>
</media-container>`);var T=`@property --media-slider-fill{syntax:"<percentage>";inherits:true;initial-value:0%}@property --media-slider-buffer{syntax:"<percentage>";inherits:true;initial-value:0%}video-player,live-video-player,media-i18n,media-dialog,media-alert-dialog,media-error-dialog,media-controls{display:contents}media-container video,media-container [slot=poster]{width:100%;height:100%;display:block}media-container video::-webkit-media-text-track-container{z-index:1;scale:.98;translate:0 var(--media-caption-track-y,0);transition:translate var(--media-caption-track-duration,0) ease-out;transition-delay:var(--media-caption-track-delay,0);font-family:inherit}:host{width:100%;display:grid}:host(:focus){outline:none!important}::slotted(video),::slotted(audio){margin:0!important}@layer base{:where(.media-skin){text-align:start;text-transform:none;letter-spacing:normal;font-style:normal;font-weight:400}:where(.media-skin),:where(.media-skin) *,:where(.media-skin) :before,:where(.media-skin) :after{box-sizing:border-box;border:0 solid;margin:0;padding:0}:where(.media-skin) button{font:inherit;color:inherit;text-transform:none;letter-spacing:inherit;appearance:none;background:0 0}:where(.media-skin) img,:where(.media-skin) svg,:where(.media-skin) media-icon{max-width:100%;display:block}:where(.media-skin) svg[fill=currentColor]{fill:currentColor}:where(.media-skin) svg[fill=none]{fill:none}:where(.media-skin) svg[stroke=currentColor]{stroke:currentColor}:where(.media-skin) video{border-radius:inherit;object-fit:var(--media-object-fit,contain);object-position:var(--media-object-position,center);width:100%;max-width:100%;height:100%;display:block}:where(.media-skin) media-icon>svg{width:100%;height:100%}:where(.media-skin) media-tooltip-group,:where(.media-skin) media-dialog,:where(.media-skin) media-alert-dialog,:where(.media-skin) media-error-dialog,:where(.media-skin) media-controls{display:contents}:where(.media-skin) [hidden][hidden]{display:none!important}@media (prefers-reduced-motion:no-preference){.media-skin{interpolate-size:allow-keywords}}@supports not selector(:popover-open){:where(.media-skin) [popover]:not([data-open],[data-ending-style]){display:none!important}.media-skin:is([data-preset=audio],[data-preset=live-audio]){overflow:visible!important}}}@layer components{:where(.media-skin){--media-caption-track-duration:var(--media-duration-controls);--media-caption-track-delay:25ms;--media-caption-track-y:calc(var(--media-spacing) * -3)}:where(.media-skin) video::-webkit-media-text-track-container{z-index:20;scale:.98;translate:0 var(--media-caption-track-y);transition:translate var(--media-caption-track-duration) ease-out;transition-delay:var(--media-caption-track-delay);font-family:inherit}:where(.media-skin)[data-controls-visible]{--media-caption-track-y:var(--media-caption-controls-y)}:where(.media-skin)[data-theme=compat] video::-webkit-media-text-track-container{translate:none;scale:none;transform:translateY(var(--media-caption-track-y,0px)) scale(.98);transition-property:transform}@container media-root (width<42rem){:where(.media-skin)[data-theme=default][data-controls-visible] video{--media-caption-track-y:calc(var(--media-spacing) * -14)}:where(.media-skin)[data-theme=neutral][data-controls-visible] video{--media-caption-track-y:calc(var(--media-spacing) * -17)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button{width:calc(var(--media-spacing) * 8);height:calc(var(--media-spacing) * 8);cursor:pointer;background-color:var(--media-background);color:inherit;border-radius:0;outline-style:none;flex-shrink:0;place-items:center;padding:0;display:grid;position:relative}@media (hover:hover){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:hover{background-color:var(--media-button-highlight)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:focus-visible{background-color:var(--media-button-highlight);outline-offset:2px;outline-width:2px;outline-style:solid;outline-color:var(--media-ring)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:disabled,:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button[aria-disabled=true]{cursor:not-allowed;opacity:.4}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button[aria-expanded=true]{background-color:var(--media-button-highlight)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button[data-hidden]{display:none}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button{color:buttontext;forced-color-adjust:none;background-color:buttonface;border:1px solid buttontext}@media (hover:hover){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:hover{color:highlighttext;background-color:highlight}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:focus-visible{color:highlighttext;background-color:highlight}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button[aria-disabled=true]{color:graytext;opacity:1}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button[aria-expanded=true]{color:highlighttext;background-color:highlight}}@media (pointer:coarse){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:before{content:"";position:absolute;inset:-3px}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){@media (hover:hover){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:hover{background-color:var(--media-foreground);color:var(--media-background)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button:focus-visible,:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button[aria-expanded=true]{background-color:var(--media-foreground);color:var(--media-background)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-backdrop{z-index:40;background-color:#000;position:absolute;inset:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-backdrop:not([data-open]){display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-close{height:calc(var(--media-spacing) * 8);width:auto;padding-inline:calc(var(--media-spacing) * 3);border-style:solid;border-color:currentColor;justify-self:flex-end;border-style:solid!important;border-width:1px!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-description{font-size:calc(var(--media-spacing) * 3.5)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-popup{z-index:50;max-height:calc(100% - var(--media-spacing) * 8);width:calc(100% - var(--media-spacing) * 8);max-width:calc(var(--media-spacing) * 80);gap:calc(var(--media-spacing) * 3);background-color:var(--media-popover);padding:calc(var(--media-spacing) * 5);color:var(--media-popover-foreground);border-radius:0;outline-style:none;display:grid;position:absolute;top:50%;left:50%;overflow:auto;transform:translate(-50%,-50%)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-popup:not([data-open]){display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-popup:focus-visible{outline-offset:-2px;outline-width:2px;outline-style:solid;outline-color:var(--media-ring)}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-popup{border:1px solid canvastext}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-popup{border:1px solid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-dialog-title{font-size:calc(var(--media-spacing) * 4.5);line-height:calc(var(--media-spacing) * 7)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-indicator{pointer-events:none;align-items:center;gap:calc(var(--media-spacing) * 2);background-color:var(--media-background);padding-inline:calc(var(--media-spacing) * 2.5);padding-block:var(--media-spacing);border-radius:0;display:flex}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-indicator{color:canvastext;background-color:canvas;outline:1px solid canvastext}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-indicator{background-color:var(--media-background);outline:1px solid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-indicator-group{pointer-events:none;z-index:20;grid-template-columns:repeat(3,minmax(0,1fr));place-items:center;display:grid;position:absolute;inset:0}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-indicator-group{z-index:40}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator{margin-top:calc(var(--media-spacing) * 3);grid-row-start:1;grid-column-start:2;align-self:flex-start}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator)[data-status=captions-off] .media-status-indicator-captions-off-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator)[data-status=captions-on] .media-status-indicator-captions-on-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator)[data-status=fullscreen] .media-status-indicator-fullscreen-enter-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator)[data-status=exit-fullscreen] .media-status-indicator-fullscreen-exit-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5);flex-shrink:0;display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator)[data-status=pip] .media-status-indicator-pip-enter-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-indicator)[data-status=exit-pip] .media-status-indicator-pip-exit-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator{margin-top:calc(var(--media-spacing) * 3.5);grid-row-start:1;grid-column-start:2;align-self:flex-start}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator-fill{align-items:center;gap:calc(var(--media-spacing) * 2);display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator-fill:where(:dir(rtl),[dir=rtl],[dir=rtl] *){flex-direction:row-reverse}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator)[data-level=high] .media-volume-indicator-high-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5);flex-shrink:0;display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator)[data-level=low] .media-volume-indicator-low-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator)[data-level=off] .media-volume-indicator-off-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-indicator-value{font-variant-numeric:tabular-nums}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator{margin-inline:calc(var(--media-spacing) * 3);flex-direction:column;grid-row-start:1;grid-column-start:2;justify-content:center;gap:var(--media-spacing)!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator[data-direction=backward]{grid-column-start:1;justify-self:flex-start}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator[data-direction=forward],:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator:where(:dir(rtl),[dir=rtl],[dir=rtl] *)[data-direction=backward]{grid-column-start:3;justify-self:flex-end}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator:where(:dir(rtl),[dir=rtl],[dir=rtl] *)[data-direction=forward]{grid-column-start:1;justify-self:flex-start}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5)}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator)[data-direction=backward] .media-seek-indicator-icon{transform:scaleX(-1)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-indicator-value{font-variant-numeric:tabular-nums}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-status-announcer{white-space:nowrap;clip:rect(0, 0, 0, 0);width:1px;height:1px;position:absolute;overflow:hidden}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-poster{width:100%;height:100%;position:absolute;inset:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-poster:not([data-visible]){display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-poster-image{object-fit:var(--media-object-fit,contain);object-position:var(--media-object-position,center);width:100%;height:100%}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator{pointer-events:none;place-items:center;display:grid;position:absolute;inset:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator:not([data-visible]){--media-spinner-animation:none;display:none}@media (prefers-reduced-motion:reduce){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator{--media-spinner-animation:none}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator-backdrop{z-index:40}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator-controls):not([data-visible]) .media-buffering-indicator-backdrop{background-color:#0006}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator-backdrop{background-color:#0000!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator-controls{display:contents}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-buffering-indicator-spinner-icon{width:calc(var(--media-spacing) * 7);height:calc(var(--media-spacing) * 7)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup{color:inherit;border-style:solid;border-width:0;margin:0;overflow:visible}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup[data-ending-style]{transform:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup[data-starting-style]{transform:translate(var(--media-popup-translate-x-distance,0), var(--media-popup-translate-y-distance,0))}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup[data-side=bottom]{transform-origin:top;--media-popup-translate-y-distance:calc(var(--media-popup-translate-distance) * -1)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup[data-side=left]{transform-origin:100%;--media-popup-translate-x-distance:var(--media-popup-translate-distance)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup[data-side=right]{transform-origin:0;--media-popup-translate-x-distance:calc(var(--media-popup-translate-distance) * -1)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup[data-side=top]{transform-origin:bottom;--media-popup-translate-y-distance:var(--media-popup-translate-distance)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup:is([data-starting-style],[data-ending-style]){scale:var(--media-hidden-popup-scale) var(--media-hidden-popup-scale);opacity:0;filter:blur(var(--media-hidden-popup-blur))}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup-safe-area:before{pointer-events:auto;content:"";position:absolute}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup-safe-area[data-side=bottom]:before{content:"";height:var(--media-popup-side-offset);inset-inline:0;bottom:100%}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup-safe-area[data-side=left]:before{content:"";width:var(--media-popup-side-offset);inset-block:0;left:100%}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup-safe-area[data-side=right]:before{content:"";width:var(--media-popup-side-offset);inset-block:0;right:100%}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-popup-safe-area[data-side=top]:before{content:"";height:var(--media-popup-side-offset);inset-inline:0;top:100%}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-tooltip-popup{pointer-events:none;z-index:20;background-color:var(--media-popover);padding-inline:calc(var(--media-spacing) * 1.5);padding-block:calc(var(--media-spacing) * .5);white-space:nowrap;color:var(--media-popover-foreground);--media-popup-side-offset:var(--media-tooltip-side-offset);--media-tooltip-side-offset:calc(var(--media-spacing) * 9);border-radius:0;box-shadow:0 0 #0000,0 0 #0000,0 0 #0000,0 0 #0000,0 0 #0000}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-tooltip-popup[data-open]{align-items:center;gap:var(--media-spacing);display:flex}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-tooltip-popup{outline-width:1px;outline-style:solid}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-tooltip-popup{outline-width:1px;outline-style:solid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-tooltip-shortcut{font-family:inherit;font-size:calc(var(--media-spacing) * 2.75)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5);grid-row-start:1;grid-column-start:1}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-button-backward-icon{transform:scaleX(-1)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-button-backward-label{left:-1px}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-button-content{display:grid;position:relative}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-button-forward-label{right:-1px}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-seek-button-label{bottom:calc(var(--media-spacing) * -.75);font-size:calc(var(--media-spacing) * 2.25);font-variant-numeric:tabular-nums;position:absolute}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-indicator{opacity:0;flex-shrink:0;margin-inline-start:auto;margin-inline-end:calc(var(--media-spacing) * -1)}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-item)[aria-checked=true] .media-menu-indicator{opacity:1}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5);opacity:.7;flex-shrink:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-item{min-height:calc(var(--media-spacing) * 8);cursor:pointer;justify-content:space-between;align-items:center;gap:calc(var(--media-spacing) * 3);background-color:var(--media-background);width:100%;padding-inline:calc(var(--media-spacing) * 2);background-clip:padding-box;border-radius:0;flex-shrink:0;padding-block:0;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-item:focus-visible{outline-offset:-2px;outline:2px solid}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-item[data-highlighted]{background-color:var(--media-button-highlight)}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-item[data-highlighted]{background-color:var(--media-accent);color:var(--media-accent-foreground)}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-item[data-highlighted]{background-color:var(--media-accent);color:var(--media-accent-foreground)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-chevron{width:calc(var(--media-spacing) * 4);height:calc(var(--media-spacing) * 4);opacity:.7;flex-shrink:0;transform:rotate(180deg)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-chevron:where(:dir(rtl),[dir=rtl],[dir=rtl] *){transform:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-item{min-height:calc(var(--media-spacing) * 8);cursor:pointer;align-items:center;gap:calc(var(--media-spacing) * 1.5);background-color:var(--media-background);width:100%;padding-inline:calc(var(--media-spacing) * 2);text-align:start;white-space:nowrap;background-clip:padding-box;border-radius:0;flex-shrink:0;padding-block:0;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-item:focus-visible{outline-offset:-2px;outline:2px solid}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-item[data-highlighted]{background-color:var(--media-button-highlight)}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-item[data-highlighted]{background-color:var(--media-accent);color:var(--media-accent-foreground)}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-back-item[data-highlighted]{background-color:var(--media-accent);color:var(--media-accent-foreground)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-badge{background-color:var(--media-muted);padding-inline:calc(var(--media-spacing) * 1.5);font-size:calc(var(--media-spacing) * 2.75);border-radius:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-content{overscroll-behavior:none;max-height:100%;padding:calc(var(--media-spacing) * 2);clip-path:inset(0);outline-style:none;flex-direction:column;display:flex;position:absolute;overflow:auto;gap:calc(var(--media-spacing) * 2)!important}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-content{outline-offset:2px;outline:2px solid #0000}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-content:not([data-submenu]){inset-inline:0;top:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-content:not([data-submenu])[data-child-open]{clip-path:inset(0 0 0 100%);transform:translate(-100%)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-content[data-submenu]{z-index:10;inset-inline:0;top:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-content:not([data-submenu])[data-child-open]:where(:dir(rtl),[dir=rtl],[dir=rtl] *){clip-path:inset(0 100% 0 0);transform:translate(100%)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-forward-chevron{width:calc(var(--media-spacing) * 4);height:calc(var(--media-spacing) * 4);opacity:.7;flex-shrink:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-forward-chevron:where(:dir(rtl),[dir=rtl],[dir=rtl] *){transform:scaleX(-1)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-hint{align-items:center;gap:var(--media-spacing);opacity:.7;min-width:0;margin-inline-start:auto;padding-inline-start:calc(var(--media-spacing) * 2);display:inline-flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-hint-label{max-width:calc(var(--media-spacing) * 24);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item{min-height:calc(var(--media-spacing) * 8);cursor:pointer;align-items:center;gap:calc(var(--media-spacing) * 1.5);background-color:var(--media-background);width:100%;padding-inline:calc(var(--media-spacing) * 2);text-align:start;white-space:nowrap;background-clip:padding-box;border-radius:0;flex-shrink:0;padding-block:0;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item:focus-visible{outline-offset:-2px;outline:2px solid}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item[data-highlighted]{background-color:var(--media-button-highlight)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item[data-availability=unavailable],:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item[data-availability=unsupported]{display:none}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item[data-highlighted]{background-color:var(--media-accent);color:var(--media-accent-foreground)}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-item[data-highlighted]{background-color:var(--media-accent);color:var(--media-accent-foreground)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-popup{z-index:20;height:var(--media-menu-height);max-height:min(var(--media-menu-available-height,calc(var(--media-spacing) * 56)), calc(var(--media-spacing) * 56));width:var(--media-menu-width);max-width:var(--media-menu-available-width);min-width:calc(var(--media-spacing) * 44);overscroll-behavior:none;background-color:var(--media-popover);color:var(--media-popover-foreground);--media-popover-side-offset:calc(var(--media-spacing) * 9);--media-popup-side-offset:var(--media-popover-side-offset);border-radius:0;margin:0;padding:0;box-shadow:0 0 #0000,0 0 #0000,0 0 #0000,0 0 #0000,0 0 #0000;overflow:hidden!important}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-popup{outline-width:1px;outline-style:solid}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-popup{outline-width:1px;outline-style:solid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-radio-group{gap:calc(var(--media-spacing) * 2);flex-direction:column;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-separator{display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-tier{font-size:calc(var(--media-spacing) * 2.75);opacity:.7;padding-inline-start:calc(var(--media-spacing) * .5);padding-top:1px;line-height:1}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-menu-trigger-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5);opacity:.7;flex-shrink:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-settings-button-label{clip-path:inset(50%);white-space:nowrap;border-width:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-slider-row{width:100%}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider{height:calc(var(--media-spacing) * 4);min-width:calc(var(--media-spacing) * 12);cursor:pointer;flex:1;align-items:center;display:flex;position:relative}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider[data-disabled]{cursor:not-allowed;opacity:.4}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider[data-disabled]{color:graytext;opacity:1}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-audio-buffer{background-color:#b3b3b3!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-audio-preview-meta{padding-block:calc(var(--media-spacing) * .5);color:var(--media-foreground);border-radius:0;width:auto!important;padding-inline:calc(var(--media-spacing) * 1.5)!important}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-audio-preview-meta{outline-width:1px;outline-style:solid}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-audio-preview-meta{outline-width:1px;outline-style:solid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-audio-track:before{content:"";background-color:var(--media-muted)!important}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-audio-track:before{content:"";background-color:canvas!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-buffer{inset-block:0;left:calc(var(--media-slider-chapter-start,0%) + var(--media-spacing) * var(--media-chapter-inset-start,0));right:max(calc(100% - var(--media-slider-buffer,0%)), calc(100% - var(--media-slider-chapter-end,100%) + var(--media-spacing) * var(--media-chapter-inset-end,0)));clip-path:inset(-1px 0);background-color:oklab(100% 0 5.96046e-8/.1);border-radius:0;position:absolute}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-buffer{forced-color-adjust:none;background-image:repeating-linear-gradient(135deg,canvastext 0 1px,canvas 1px 3px);opacity:1!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-chapter{--media-chapter-inset-end:.5;--media-chapter-inset-start:.5;clip-path:inset(0 calc(100% - var(--media-slider-chapter-end)) 0 var(--media-slider-chapter-start));align-items:center;display:flex;position:absolute;inset:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-chapter:first-of-type{--media-chapter-inset-start:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-chapter:last-of-type{--media-chapter-inset-end:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-chapter-title{text-overflow:ellipsis;white-space:nowrap;opacity:.7;min-width:0;overflow:hidden}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-chapter-title:empty{display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-chapters{align-items:center;width:100%;height:100%;display:flex;position:relative}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-fill{inset-block:0;left:calc(var(--media-slider-chapter-start,0%) + var(--media-spacing) * var(--media-chapter-inset-start,0));right:max(calc(100% - var(--media-slider-fill,0%)), calc(100% - var(--media-slider-chapter-end,100%) + var(--media-spacing) * var(--media-chapter-inset-end,0)));clip-path:inset(-1px 0);background-color:var(--media-accent);border-radius:0;position:absolute}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider)[data-dragging] .media-time-slider-fill{left:calc(var(--media-slider-chapter-start,0%) + var(--media-spacing) * var(--media-chapter-inset-start,0));right:max(calc(100% - var(--media-slider-pointer,0%)), calc(100% - var(--media-slider-chapter-end,100%) + var(--media-spacing) * var(--media-chapter-inset-end,0)));clip-path:inset(-1px 0)}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-fill{forced-color-adjust:none;background-color:canvas;background-image:linear-gradient(highlight,highlight)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-preview{pointer-events:none;bottom:calc(100% + var(--media-spacing) * 3);max-width:calc(var(--media-spacing) * 39);transform-origin:bottom;justify-items:center;gap:var(--media-spacing);opacity:0;display:grid}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider)[data-disabled] .media-time-slider-preview{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider)[data-dragging] .media-time-slider-preview,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider)[data-pointing] .media-time-slider-preview{opacity:1}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-preview-label{align-items:center;gap:calc(var(--media-spacing) * 2);min-width:0;max-width:100%;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-preview-meta{width:100%;min-width:0;padding-inline:calc(var(--media-spacing) * 2);padding-block:var(--media-spacing);justify-content:center;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-thumb{left:var(--media-slider-fill,0%);width:calc(var(--media-spacing) * 3);height:calc(var(--media-spacing) * 3);border-style:solid;border-width:1px;border-color:var(--media-foreground);background-color:var(--media-foreground);border-radius:0;outline-style:none;position:absolute;transform:translate(-50%)}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider)[data-dragging] .media-time-slider-thumb{left:var(--media-slider-pointer)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-thumb:focus-visible{outline-offset:2px;outline:2px solid}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-thumb{forced-color-adjust:none;background-color:highlight;border:1px solid canvastext}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-track{isolation:isolate;height:calc(var(--media-spacing) * 1.5);border-radius:0;position:absolute;inset-inline:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-track:before{inset-block:0;left:calc(var(--media-slider-chapter-start) + var(--media-spacing) * var(--media-chapter-inset-start));right:calc(100% - var(--media-slider-chapter-end) + var(--media-spacing) * var(--media-chapter-inset-end));clip-path:inset(-1px);content:"";background-color:oklab(100% 0 5.96046e-8/.1);border-radius:0;position:absolute}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-track{height:calc(var(--media-spacing) * 1.5)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-track:before{content:"";forced-color-adjust:none;background-color:canvas;border:1px solid canvastext;opacity:1!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-slider-value{font-variant-numeric:tabular-nums;flex-shrink:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-slider-thumbnail{max-width:calc(var(--media-spacing) * 39);background-color:var(--media-background);border-radius:0;display:block;overflow:hidden}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-slider-thumbnail-image{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) :where(.media-captions-button)[data-active] .media-captions-button-off-icon,:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-captions-button-on-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-captions-button)[data-active] .media-captions-button-on-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-live-button{align-items:center;gap:calc(var(--media-spacing) * 1.5);font-size:calc(var(--media-spacing) * 2.75);grid-auto-flow:column;width:auto!important;padding-inline:calc(var(--media-spacing) * 2.5)!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-live-button-dot{width:calc(var(--media-spacing) * 2);height:calc(var(--media-spacing) * 2);opacity:.4;background-color:currentColor;border-radius:0;flex-shrink:0;display:inline-block}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-live-button)[data-live-edge] .media-live-button-dot{opacity:1;background-color:#f43f5e}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-button-icon-base{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5);grid-row-start:1;grid-column-start:1;display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-play-button-audio{display:inline-flex;position:relative}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-play-button-buffering{z-index:20;background-color:var(--media-background)}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-play-button)[data-started]:not([data-paused]):not([data-ended]) .media-play-button-pause-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-play-button):not([data-ended]):not([data-started]) .media-play-button-play-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-play-button):not([data-ended])[data-paused] .media-play-button-play-icon,:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-play-button)[data-ended] .media-play-button-restart-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-mute-button-high-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-mute-button):not([data-muted]) .media-mute-button-high-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-mute-button-off-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-mute-button)[data-muted] .media-mute-button-off-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-popover-popup{z-index:20;height:calc(var(--media-spacing) * 24);width:calc(var(--media-spacing) * 7);background-color:var(--media-popover);padding-inline:calc(var(--media-spacing) * 3.5);padding-block:calc(var(--media-spacing) * 2.5);color:var(--media-popover-foreground);--media-popover-side-offset:calc(var(--media-spacing) * 9);--media-popup-side-offset:var(--media-popover-side-offset);border-radius:0;box-shadow:0 0 #0000,0 0 #0000,0 0 #0000,0 0 #0000,0 0 #0000}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-popover-popup{outline-width:1px;outline-style:solid}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-popover-popup{outline-width:1px;outline-style:solid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider{cursor:pointer;--media-accent:var(--media-accent-color,var(--media-popover-foreground));justify-content:center;width:100%;height:100%;display:flex;position:relative}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider[data-disabled]{cursor:not-allowed;opacity:.4}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-fill{height:var(--media-slider-fill,0%);background-color:var(--media-accent);border-radius:0;width:100%;position:absolute;bottom:0;left:0}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-fill{forced-color-adjust:none;background-color:highlight}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-thumb{bottom:var(--media-slider-fill,0%);width:calc(var(--media-spacing) * 3);height:calc(var(--media-spacing) * 3);background-color:var(--media-popover-foreground);border-radius:0;position:absolute;left:50%;transform:translate(-50%,50%)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-thumb:focus-visible{outline-offset:2px;outline:2px solid}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-thumb{forced-color-adjust:none;background-color:highlight;border:1px solid canvastext}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-track{height:100%;width:var(--media-spacing);background-color:gray;border-radius:0;position:absolute;bottom:0;left:50%;overflow:hidden;transform:translate(-50%)}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-volume-slider-track{width:calc(var(--media-spacing) * 1.5);forced-color-adjust:none;background-color:canvas;border:1px solid canvastext}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-bottom{pointer-events:auto;gap:calc(var(--media-spacing) * 2);background-color:var(--media-background);padding:calc(var(--media-spacing) * 3);inset-inline:0;flex-direction:column;display:flex;position:absolute;bottom:0}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-content):not([data-visible]) .video-controls-bottom{pointer-events:none;opacity:0}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-bottom{background-color:canvas;border-radius:0}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-bottom{background-color:var(--media-background);border-radius:0}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-buffering{display:contents}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center{pointer-events:auto;align-items:center;gap:calc(var(--media-spacing) * 2);display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-content):not([data-visible]) .video-controls-center{pointer-events:none;opacity:0}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-buffering)[data-visible] .video-controls-center{display:none!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center:where(:dir(rtl),[dir=rtl],[dir=rtl] *){flex-direction:row-reverse}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center{background-color:#0000!important}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center{background-color:var(--media-background);padding-inline:calc(var(--media-spacing) * 2);border-radius:0}}@container media-root (width>=22.5rem){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center{display:flex}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button{background-color:var(--media-background)!important;margin:0!important}@media (hover:hover){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button:hover{background-color:var(--media-button-highlight)!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button:focus-visible,:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button[aria-expanded=true]{background-color:var(--media-button-highlight)!important}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button{background-color:buttonface!important}@media (hover:hover){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button:hover{background-color:highlight!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button:focus-visible,:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button[aria-expanded=true]{background-color:highlight!important}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button{background-color:var(--media-background)!important}@media (hover:hover){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button:hover{background-color:var(--media-foreground)!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button:focus-visible,:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-button[aria-expanded=true]{background-color:var(--media-foreground)!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-play{width:calc(var(--media-spacing) * 14.5)!important;height:calc(var(--media-spacing) * 14.5)!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-play-icon{width:calc(var(--media-spacing) * 7)!important;height:calc(var(--media-spacing) * 7)!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-content{pointer-events:none;z-index:30;position:absolute;inset:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-group{align-items:center;gap:calc(var(--media-spacing) * 2);display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-group:where(:dir(rtl),[dir=rtl],[dir=rtl] *){flex-direction:row-reverse}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-row{justify-content:space-between;align-items:center;gap:calc(var(--media-spacing) * 2);display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-row:where(:dir(rtl),[dir=rtl],[dir=rtl] *){flex-direction:row-reverse}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-start{min-width:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-top{pointer-events:auto;justify-content:flex-end;align-items:center;gap:calc(var(--media-spacing) * 2);padding:calc(var(--media-spacing) * 3);inset-inline:0;display:flex;position:absolute;top:0}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-content):not([data-visible]) .video-controls-top{pointer-events:none;opacity:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-top:where(:dir(rtl),[dir=rtl],[dir=rtl] *){flex-direction:row-reverse}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-top{inset-inline:0;background-color:canvas;border-radius:0;justify-content:flex-end;top:0;border-radius:0!important}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-top{background-color:var(--media-background);border-radius:0}}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-video-bottom{inset-inline:0;bottom:0;border-radius:0!important}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-current-value{display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-current-value[data-unavailable]{opacity:.5}@container media-root (width>=20rem){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-current-value{display:inline}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-duration-value{opacity:.7;display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-duration-value[data-unavailable]{opacity:.5}@container media-root (width>=20rem){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-duration-value{display:inline}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-group{height:calc(var(--media-spacing) * 4);align-items:center;gap:var(--media-spacing);padding-inline:var(--media-spacing);font-variant-numeric:tabular-nums;flex-shrink:0;line-height:1;display:flex}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-group:where(:dir(rtl),[dir=rtl],[dir=rtl] *){flex-direction:row-reverse}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-separator{opacity:.7;display:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-separator[data-unavailable]{opacity:.5}@container media-root (width>=20rem){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-separator{display:inline}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-toggle{cursor:pointer;border-radius:0;outline-style:none}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-toggle:focus-visible{outline-offset:2px;outline-width:2px;outline-style:solid;outline-color:var(--media-ring)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-toggle[data-disabled]{cursor:not-allowed;opacity:.4}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-toggle[data-disabled]{color:graytext;opacity:1}}@container media-root (width>=20rem){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-time-toggle{display:none}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .audio-controls-bottom{padding:calc(var(--media-spacing) * 3);position:static!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) .audio-controls-content{position:relative!important;inset:auto!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) :where(.media-airplay-button)[data-airplay-state=connected] .media-airplay-button-enter-icon,:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-airplay-button-exit-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-airplay-button)[data-airplay-state=connected] .media-airplay-button-exit-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-tooltip-screen-popup{--media-tooltip-side-offset:calc(var(--media-spacing) * 3)!important}:where(.media-skin[data-theme=scaffold][data-preset=video]) :where(.media-cast-button)[data-cast-state=connected] .media-cast-button-enter-icon,:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-cast-button-exit-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-cast-button)[data-cast-state=connected] .media-cast-button-exit-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-fullscreen-button-enter-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-fullscreen-button):not([data-fullscreen]) .media-fullscreen-button-enter-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-fullscreen-button-exit-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-fullscreen-button)[data-fullscreen] .media-fullscreen-button-exit-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) :where(.media-pip-button)[data-pip] .media-pip-button-enter-icon,:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-pip-button-exit-icon{display:none}:where(:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-pip-button)[data-pip] .media-pip-button-exit-icon{display:block}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-title{pointer-events:none;text-overflow:ellipsis;white-space:nowrap;background-color:var(--media-background);min-width:0;padding-inline:calc(var(--media-spacing) * 2);font-size:calc(var(--media-spacing) * 4);color:var(--media-foreground);flex:1;overflow:hidden}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-title:not([data-visible]){opacity:0}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-title{z-index:40;color:canvastext;background-color:#0000!important}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-title{background-color:var(--media-background)}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-backdrop{pointer-events:none;background-color:#0006;position:absolute;inset:0}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-backdrop:not([data-visible]){display:none}@media (forced-colors:active){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-backdrop{background-image:none}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-seek{display:none;width:calc(var(--media-spacing) * 8)!important;height:calc(var(--media-spacing) * 8)!important}@media (pointer:fine){:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-seek{display:grid}}:where(.media-skin[data-theme=scaffold][data-preset=video]) .video-controls-center-seek-icon{width:calc(var(--media-spacing) * 4.5);height:calc(var(--media-spacing) * 4.5)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-container,:where(.media-skin[data-theme=scaffold][data-preset=video]).media-container{border-radius:var(--media-video-border-radius);width:100%;font-family:var(--media-font-family,inherit);font-size:calc(var(--media-spacing) * 3.25);color:var(--media-foreground);--spacing:var(--media-spacing);outline-style:none;display:block;position:relative;overflow:hidden;container:media-root/inline-size}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-container:focus-visible,:where(.media-skin[data-theme=scaffold][data-preset=video]).media-container:focus-visible{outline-offset:-2px;outline-width:2px;outline-style:solid;outline-color:var(--media-ring)}:where(.media-skin[data-theme=scaffold][data-preset=video]) .media-video,:where(.media-skin[data-theme=scaffold][data-preset=video]).media-video{aspect-ratio:16/9;background-color:#000}}@layer utilities;@layer base.theme{.media-skin{--media-background:oklch(0% 0 0);--media-foreground:oklch(100% 0 0);--media-controls:oklch(0% 0 0/.35);--media-controls-foreground:var(--media-foreground);--media-popover:oklch(100% 0 0/.1);--media-popover-foreground:var(--media-foreground);--media-primary:var(--media-accent-color,var(--media-default-accent-color));--media-primary-foreground:var(--media-accent-text-color,var(--media-default-accent-text-color));--media-accent:var(--media-accent-color,color-mix(in oklab, var(--media-default-accent-color) 10%, transparent));--media-accent-foreground:var(--media-accent-text-color,currentColor);--media-muted:oklch(100% 0 0/.15);--media-muted-foreground:oklch(100% 0 0/.65);--media-border:oklch(0% 0 0/.1);--media-ring:oklch(100% 0 0);--media-backdrop:oklch(0% 0 0);--media-live-color:oklch(65% .22 27);--media-shadow-surface:0 1px 3px 0 oklch(0% 0 0/.15), 0 1px 2px -1px oklch(0% 0 0/.15);--media-shadow-surface-inset:inset 0 1px 0 0 #ffffff1a, inset 0 0 0 1px #ffffff0d;--media-shadow-thumb:0 0 0 1px #0000001a, 0 1px 3px 0 #00000059, 0 1px 2px -1px #00000059;--media-shadow-tooltip:0 0 0 1px var(--media-border), var(--media-shadow-surface);--media-shadow-separator:0 1px 0 0 oklch(100% 0 0/.075);--media-shadow-current-color:oklch(from currentColor 0 0 0 / clamp(0, calc((l - .5) * .5), .15));--media-shadow-subtle-current-color:color-mix(in oklab, var(--media-shadow-current-color) 40%, transparent);--media-text-shadow-dialog:0 1px 0 #00000040;--media-backdrop-filter-surface:blur(16px) saturate(110%);--media-backdrop-filter-indicator:blur(8px);--media-backdrop-filter-dialog:blur(16px) saturate(110%);--media-control-corner-shape:round;--media-control-radius:99px;--media-control-size:calc(var(--media-spacing) * 9);--media-controls-radius:var(--media-control-radius);--media-default-accent-color:oklch(100% 0 0);--media-default-accent-text-color:oklch(0% 0 0);--media-duration-instant:50ms;--media-duration-fast:.1s;--media-duration:.15s;--media-duration-slow:.2s;--media-duration-slower:.25s;--media-duration-controls:.1s;--media-duration-dialog:.35s;--media-duration-indicator:var(--media-duration-slower);--media-duration-menu:.25s;--media-duration-slider:var(--media-duration-fast);--media-delay-dialog:.1s;--media-hidden-scale:.95;--media-hidden-blur:8px;--media-hidden-offset:calc(var(--media-spacing) * 1);--media-hidden-icon-scale:0;--media-hidden-indicator-scale:.9;--media-hidden-indicator-offset:-25%;--media-hidden-playback-scale:.85;--media-hidden-popup-scale:.95;--media-hidden-popup-blur:4px;--media-hidden-preview-scale:.8;--media-hidden-preview-offset:calc(var(--media-spacing) * 2);--media-hidden-seek-offset:60%;--media-menu-item-radius:calc(var(--media-spacing) * 2);--media-popover-boundary-offset:calc(var(--media-spacing) * 3);--media-popover-side-offset:calc(var(--media-spacing) * 3);--media-popup-radius:calc(var(--media-spacing) * 3);--media-popup-translate-distance:calc(var(--media-spacing) * 2);--media-tooltip-boundary-offset:var(--media-popover-boundary-offset);--media-tooltip-side-offset:var(--media-popover-side-offset);--media-dialog-radius:calc(var(--media-spacing) * 7);--media-dialog-width:calc(100% - var(--media-spacing) * 6);--media-dialog-max-width:calc(var(--media-spacing) * 72);--media-slider-preview-label-offset:calc(var(--media-spacing) * 10.5);--media-video-border-radius:var(--media-border-radius,28px);--media-scale:1;--media-scrollbar-thumb-color:color-mix(in oklab, currentColor 30%, transparent);--media-spacing:calc(var(--media-scale-unit,16px) * var(--media-scale) / 4);scrollbar-color:var(--media-scrollbar-thumb-color) transparent;scrollbar-width:thin}@supports (color:contrast-color(red)){.media-skin{--media-primary-foreground:var(--media-accent-text-color,contrast-color(var(--media-primary)));--media-accent-foreground:var(--media-accent-text-color,contrast-color(var(--media-accent-color,var(--media-internal-accent-text-fallback,oklch(0% 0 0)))))}}@supports (color:oklch(from red l c h)){.media-skin{--media-shadow-subtle-current-color:oklch(from var(--media-shadow-current-color) l c h / calc(alpha * .4))}}@supports (color:oklch(from currentColor l c h)){.media-skin{--media-scrollbar-thumb-color:oklch(from currentColor l c h / .3)}}.media-skin::-webkit-scrollbar-thumb{background:var(--media-scrollbar-thumb-color);border-radius:9999px}.media-skin:fullscreen{--media-object-fit:contain;--media-video-border-radius:0}@media (width>=1280px){.media-skin:fullscreen{--media-scale:1.25}}@media (width>=1536px){.media-skin:fullscreen{--media-scale:1.5}}@media (width>=1920px){.media-skin:fullscreen{--media-scale:1.75}}}@layer base.preset{.media-skin:is([data-preset=video],[data-preset=live-video]){--media-frame-border:var(--media-border-color,#0000001a);--media-controls-gradient:linear-gradient(to top, color-mix(in oklab, var(--media-backdrop) 40%, transparent), color-mix(in oklab, var(--media-backdrop) 20%, transparent), color-mix(in oklab, var(--media-backdrop) 50%, transparent));--media-caption-controls-y:calc(var(--media-spacing) * -16);--media-slider-preview-offset:calc(var(--media-spacing) * 9);--media-thumbnail-gradient:linear-gradient(to top, color-mix(in oklab, var(--media-backdrop) 50%, transparent), color-mix(in oklab, var(--media-backdrop) 10%, transparent), transparent)}@supports (color:oklch(from red l c h)) and (background-image:linear-gradient(in oklab, red, red)){.media-skin:is([data-preset=video],[data-preset=live-video]){--media-controls-gradient:linear-gradient(to top in oklab, oklch(from var(--media-backdrop) l c h / .4), oklch(from var(--media-backdrop) l c h / .2), oklch(from var(--media-backdrop) l c h / .5))}}@supports (color:oklch(from red l c h)){.media-skin:is([data-preset=video],[data-preset=live-video]){--media-thumbnail-gradient:linear-gradient(to top, oklch(from var(--media-backdrop) l c h / .5), oklch(from var(--media-backdrop) l c h / .1), transparent)}}.media-skin:is([data-preset=video],[data-preset=live-video])[data-theme=neutral]{--media-frame-border:var(--media-border-color,#00000026);--media-controls-gradient:linear-gradient(to top, color-mix(in oklab, var(--media-backdrop) 50%, transparent), color-mix(in oklab, var(--media-backdrop) 20%, transparent));--media-indicator-gradient:linear-gradient(to bottom, color-mix(in oklab, var(--media-backdrop) 35%, transparent), color-mix(in oklab, var(--media-backdrop) 20%, transparent) calc(var(--media-spacing) * 12), transparent);--media-caption-controls-y:calc(var(--media-spacing) * -14);--media-slider-preview-offset:calc(var(--media-spacing) * 11)}.media-skin:is([data-preset=video],[data-preset=live-video])[data-theme=compat]{--media-caption-controls-y:calc(var(--media-spacing) * -18)}.media-skin:is([data-preset=video],[data-preset=live-video])[data-theme=scaffold]{--media-caption-controls-y:calc(var(--media-spacing) * -20)}@supports (color:oklch(from red l c h)) and (background-image:linear-gradient(in oklab, red, red)){.media-skin:is([data-preset=video],[data-preset=live-video])[data-theme=neutral]{--media-controls-gradient:linear-gradient(to top in oklab, oklch(from var(--media-backdrop) l c h / .5), oklch(from var(--media-backdrop) l c h / .2))}}@supports (color:oklch(from red l c h)){.media-skin:is([data-preset=video],[data-preset=live-video])[data-theme=neutral]{--media-indicator-gradient:linear-gradient(to bottom, oklch(from var(--media-backdrop) l c h / .35), oklch(from var(--media-backdrop) l c h / .2) calc(var(--media-spacing) * 12), transparent)}}@supports (color:light-dark(red, red)){.media-skin:is([data-preset=video],[data-preset=live-video]){--media-frame-border:var(--media-border-color,light-dark(#0000001a,#ffffff26))}.media-skin:is([data-preset=video],[data-preset=live-video])[data-theme=neutral]{--media-frame-border:var(--media-border-color,light-dark(#00000026,#ffffff26))}}.media-skin[data-theme=scaffold]{--media-background:transparent;--media-foreground:white;--media-accent:var(--media-accent-color,var(--media-default-accent-color));--media-accent-foreground:var(--media-accent-text-color,black);--media-primary:var(--media-accent);--media-primary-foreground:var(--media-accent-text-color,black);--media-muted:#404040;--media-popover:black;--media-popover-boundary-offset:calc(var(--media-spacing) * 3);--media-tooltip-boundary-offset:var(--media-popover-boundary-offset);--media-popover-foreground:white;--media-ring:var(--media-accent);--media-button-highlight:#fff3;--media-video-border-radius:var(--media-border-radius,0px);--media-control-radius:0px;--media-controls-radius:0px;--media-menu-item-radius:0px;--media-popup-radius:0px;--media-dialog-radius:0px;--media-scrollbar-thumb-color:gray;--media-shadow-surface:none;--media-shadow-surface-inset:none;--media-shadow-thumb:none;--media-backdrop-filter-surface:none;--media-backdrop-filter-indicator:none;--media-backdrop-filter-dialog:none}.media-skin[data-theme=scaffold][data-preset$=audio]{--media-foreground:black;--media-muted:#e5e5e5}@supports (color:light-dark(red, red)){.media-skin[data-theme=scaffold][data-preset$=audio]{--media-foreground:light-dark(#000,#fff);--media-muted:light-dark(#e5e5e5,#404040)}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){.media-skin[data-theme=scaffold]:where([data-preset$=video]){--media-background:black}}@media (forced-colors:active){.media-skin[data-theme=scaffold]{--media-background:Canvas;--media-popover:Canvas;--media-popover-foreground:CanvasText;--media-foreground:CanvasText;--media-accent:Highlight;--media-primary:Highlight;--media-primary-foreground:HighlightText;--media-ring:Highlight}}}@layer base.preferences{@media (pointer:fine) and (prefers-reduced-motion:no-preference){.media-skin:not([data-controls-visible]){--media-duration-controls:.3s}}@media (pointer:coarse) and (prefers-reduced-motion:no-preference){.media-skin:not([data-controls-visible]){--media-duration-controls:.15s}}@media (prefers-reduced-motion:reduce){.media-skin{--media-duration-fast:var(--media-duration-instant);--media-duration:var(--media-duration-instant);--media-duration-slow:var(--media-duration-instant);--media-duration-slower:var(--media-duration-instant);--media-duration-controls:var(--media-duration-instant);--media-duration-dialog:var(--media-duration-instant);--media-duration-indicator:var(--media-duration-instant);--media-duration-menu:0s;--media-duration-slider:0s;--media-delay-dialog:0s;--media-hidden-scale:1;--media-hidden-blur:0px;--media-hidden-offset:0px;--media-hidden-icon-scale:1;--media-hidden-indicator-scale:1;--media-hidden-indicator-offset:0px;--media-hidden-playback-scale:1;--media-hidden-popup-scale:1;--media-hidden-popup-blur:0px;--media-hidden-preview-scale:1;--media-hidden-preview-offset:0px;--media-hidden-seek-offset:0px;--media-popup-translate-distance:0px;--media-spinner-animation:none;--media-icon-airplay-fill-animation:none;--media-icon-airplay-triangle-animation:none}}@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){.media-skin{--media-popover:var(--media-background);--media-scrollbar-thumb-color:color-mix(in oklab, currentColor 80%, transparent);--media-backdrop-filter-surface:none;--media-backdrop-filter-indicator:none;--media-backdrop-filter-dialog:none;--media-shadow-surface-inset:inset 0 1px 0 0 #ffffff40, inset 0 0 0 1px #ffffff20;scrollbar-width:auto}@supports (color:oklch(from currentColor l c h)){.media-skin{--media-scrollbar-thumb-color:oklch(from currentColor l c h / .8)}}}@media (forced-colors:active){.media-skin{--media-border:CanvasText;--media-frame-border:CanvasText;--media-popover:Canvas;--media-popover-foreground:CanvasText;--media-ring:CanvasText;--media-shadow-surface-inset:inset 0 1px 0 0 CanvasText, inset 0 0 0 1px CanvasText}}}
`,E=class extends r{static{this.tagName=`video-scaffold-skin`}static{this.styles=e(T)}static{this.template=w}};i(`scaffold`,{"airplay-enter":s,"airplay-exit":h,"captions-off":l,"captions-on":o,"cast-enter":p,"cast-exit":d,check:g,chevron:`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path stroke="currentColor" d="M7.5 4.5 12 9l-4.5 4.5"/></svg>`,"fullscreen-enter":a,"fullscreen-exit":c,gear:`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><g stroke="currentColor"><path d="M7.611 1.122h2.778l.219 2.618.974.404 2.007-1.697 1.964 1.964-1.697 2.007.404.974 2.618.219v2.778l-2.618.219-.404.974 1.697 2.007-1.964 1.964-2.007-1.697-.974.404-.219 2.618H7.611l-.219-2.618-.974-.404-2.007 1.697-1.964-1.964 1.697-2.007-.404-.974-2.618-.219V7.611l2.618-.219.404-.974-1.697-2.007 1.964-1.964 2.007 1.697.974-.404z"/><circle cx="9" cy="9" r="2"/></g></svg>`,pause:b,"pip-enter":f,"pip-exit":u,play:_,restart:v,seek:C,speech:`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><g stroke="currentColor"><circle cx="5.5" cy="8" r="2"/><path d="M1.5 15.5a4 4 0 0 1 8 0"/><circle cx="13.5" cy="5" r="3"/><path d="m11 8-1.5 2.5"/></g></svg>`,speed:`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path stroke="currentColor" d="M4.404 14.096a6.5 6.5 0 0 1 0-9.192 6.5 6.5 0 0 1 9.192 0 6.5 6.5 0 0 1 0 9.192M9 9.5 4.5 5"/><circle cx="9" cy="9.5" r="1.5" fill="currentColor"/></svg>`,spinner:x,switches:`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><rect width="13" height="6" x="2.5" y="1.5" stroke="currentColor" rx="3"/><circle cx="5.5" cy="4.5" r="1" stroke="currentColor"/><path fill="currentColor" d="M12.5 10a3.5 3.5 0 1 1 0 7h-7a3.5 3.5 0 1 1 0-7zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/></svg>`,"volume-high":y,"volume-low":m,"volume-off":S}),n(E);
//# sourceMappingURL=video-scaffold.js.map