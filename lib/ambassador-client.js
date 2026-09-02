/**
 * Ambassador link tracking (browser).
 *
 * Recognises, in priority order:
 *   goglobal-uae.com/ambassador/Sergey
 *   goglobal-uae.com/ambassador?=Sergey
 *   goglobal-uae.com/ambassador.html?ref=Sergey   (also ?ambassador= / ?a=)
 *
 * The name is remembered for 30 days so the visitor can browse the site
 * before submitting the form and still be credited to the right ambassador.
 */
(function (global) {
  'use strict';

  var KEY = 'gg_ambassador';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function clean(v) {
    if (!v) return '';
    var s = String(v);
    try { s = decodeURIComponent(s); } catch (e) { /* keep raw on bad escapes */ }
    return s.replace(/[^\p{L}\p{N} .'\-_]/gu, '').trim().slice(0, 60);
  }

  function fromUrl() {
    var path = global.location.pathname || '';
    var m = path.match(/\/ambassador\/([^/?#]+)/i);
    if (m) return clean(m[1]);

    var search = global.location.search || '';
    // The "?=Sergey" form has an empty parameter name.
    var bare = search.match(/^\?=([^&#]+)/);
    if (bare) return clean(bare[1]);

    var params = new URLSearchParams(search);
    return clean(params.get('ref') || params.get('ambassador') || params.get('a') || '');
  }

  function store(name) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ name: name, ts: Date.now() }));
    } catch (e) { /* private mode: fall back to this page view only */ }
  }

  function recall() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return '';
      var data = JSON.parse(raw);
      if (!data || !data.name) return '';
      if (Date.now() - Number(data.ts || 0) > TTL_MS) {
        localStorage.removeItem(KEY);
        return '';
      }
      return clean(data.name);
    } catch (e) {
      return '';
    }
  }

  var current = fromUrl();
  if (current) store(current);

  global.GGAmbassador = {
    /** Ambassador for this visit — from the URL, else the remembered one. */
    get: function () { return current || recall(); },
    /** The page the visitor actually submitted from. */
    pageUrl: function () { return global.location.href; },
  };
})(window);
