(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ERHtml = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Encode text and quoted attribute values before placing them in HTML.
  function escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Artwork is embedded PNG data; arbitrary URLs could send requests off-device.
  function pngSource(value) {
    return typeof value === 'string' && value.length <= 2_000_000 && value.trim() === value &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  }

  return {escape, pngSource};
});
