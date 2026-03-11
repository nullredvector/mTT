#!/usr/bin/env node
/**
 * patch.js — Patches Archive.html to load favorites.js, and copies
 * favorites.js into the archive folder's data/.appdata/ directory.
 *
 * Usage:
 *   node patch.js <path-to-archive-folder>
 *
 * Example:
 *   node patch.js ~/Downloads/MyTikTokArchive
 *
 * Run this again after the extension delivers a new Archive.html.
 */

const fs = require('fs');
const path = require('path');

const archiveDir = process.argv[2];

if (!archiveDir) {
  console.error('Usage: node patch.js <path-to-archive-folder>');
  process.exit(1);
}

const archivePath = path.resolve(archiveDir, 'Archive.html');
const appDataDir = path.resolve(archiveDir, 'data', '.appdata');
const destFavJs = path.join(appDataDir, 'starplayer.js');
const srcFavJs = path.resolve(__dirname, 'starplayer.js');

// ── 1. Verify Archive.html exists ──────────────────────────────────────────
if (!fs.existsSync(archivePath)) {
  console.error(`Not found: ${archivePath}`);
  process.exit(1);
}

// ── 2. Patch Archive.html ──────────────────────────────────────────────────
const ANCHOR    = '<script src="data/.appdata/app.js"></script>';
const INJECTION = '<script src="data/.appdata/starplayer.js"></script>';

// Inline interceptor injected BEFORE app.js so we capture every window.db
// assignment the archive app makes while loading its db files.
// It also wraps document.createElement to track which db file is currently
// being loaded, so we can store each capture under the right key.
const INTERCEPTOR = `<script>!function(){try{window._mftt={_c:[]};var _s='';var _oc=document.createElement.bind(document);document.createElement=function(t){var el=_oc(t);if((t+'').toLowerCase()==='script'){try{var pd=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');if(pd&&pd.set)Object.defineProperty(el,'src',{configurable:true,get:function(){return pd.get.call(el);},set:function(v){_s=v;pd.set.call(el,v);}});}catch(e){}}return el;};Object.defineProperty(window,'db',{configurable:true,set:function(v){try{window._mftt._c.push({src:_s,data:typeof v==='string'?JSON.parse(v):v});}catch(e){}Object.defineProperty(window,'db',{value:v,configurable:true,writable:true});}});}catch(e){}}();</script>`;

let html = fs.readFileSync(archivePath, 'utf8');

if (!html.includes(ANCHOR)) {
  console.error(`Could not find anchor tag in Archive.html:\n  ${ANCHOR}`);
  console.error('The format of Archive.html may have changed. Please report this.');
  process.exit(1);
}

// Strip any previous patch so we always inject a fresh copy
html = html.replace(INTERCEPTOR + '\n\t' + ANCHOR + '\n\t' + INJECTION, ANCHOR);
html = html.replace(ANCHOR + '\n\t' + INJECTION, ANCHOR);

html = html.replace(ANCHOR, INTERCEPTOR + '\n\t' + ANCHOR + '\n\t' + INJECTION);
fs.writeFileSync(archivePath, html, 'utf8');
console.log(`Patched:  ${archivePath}`);

// ── 3. Copy starplayer.js into the archive ────────────────────────────────
if (!fs.existsSync(srcFavJs)) {
  console.error(`Source not found: ${srcFavJs}`);
  console.error('Make sure starplayer.js is in the same directory as patch.js.');
  process.exit(1);
}

if (!fs.existsSync(appDataDir)) {
  console.error(`data/.appdata directory not found at: ${appDataDir}`);
  console.error('Make sure the archive folder has been set up by the extension first.');
  process.exit(1);
}

fs.copyFileSync(srcFavJs, destFavJs);
console.log(`Copied:   ${destFavJs}`);
console.log('Done.');
