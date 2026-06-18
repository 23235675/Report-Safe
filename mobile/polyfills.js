// DOMException polyfill for React Native / Hermes
// Wrapped in an IIFE using only var/function (no const/class) so it is safe
// to run both as a bare Metro polyfill script AND as a required CommonJS module.
//
// WHY the constants are needed: socket.io-client (engine.io-client) expects
// DOMException to carry the 25 legacy numeric codes (INDEX_SIZE_ERR=1 …
// DATA_CLONE_ERR=25).  Hermes does not expose these, so we install or patch them.

(function installDOMExceptionPolyfill() {
  // Safe global-object reference that works in every React Native JS context.
  var G = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof global    !== 'undefined') ? global
        : {};

  var CODES = {
    INDEX_SIZE_ERR:             1,
    DOMSTRING_SIZE_ERR:         2,
    HIERARCHY_REQUEST_ERR:      3,
    WRONG_DOCUMENT_ERR:         4,
    INVALID_CHARACTER_ERR:      5,
    NO_DATA_ALLOWED_ERR:        6,
    NO_MODIFICATION_ALLOWED_ERR:7,
    NOT_FOUND_ERR:              8,
    NOT_SUPPORTED_ERR:          9,
    INUSE_ATTRIBUTE_ERR:        10,
    INVALID_STATE_ERR:          11,
    SYNTAX_ERR:                 12,
    INVALID_MODIFICATION_ERR:   13,
    NAMESPACE_ERR:              14,
    INVALID_ACCESS_ERR:         15,
    VALIDATION_ERR:             16,
    TYPE_MISMATCH_ERR:          17,
    SECURITY_ERR:               18,
    NETWORK_ERR:                19,
    ABORT_ERR:                  20,
    URL_MISMATCH_ERR:           21,
    QUOTA_EXCEEDED_ERR:         22,
    TIMEOUT_ERR:                23,
    INVALID_NODE_TYPE_ERR:      24,
    DATA_CLONE_ERR:             25,
  };

  function stampCodes(target) {
    if (!target) return;
    for (var k in CODES) {
      try { if (!(k in target)) target[k] = CODES[k]; } catch (e) { /* sealed */ }
    }
  }

  if (!G.DOMException) {
    // Hermes has no DOMException — install a full polyfill using a function
    // constructor (avoids Hermes quirks with class-declarations inside blocks).
    var DOMExceptionCtor = function DOMException(message, name) {
      this.message = (message != null) ? String(message) : '';
      this.name    = (name    != null) ? String(name)    : 'Error';
    };
    DOMExceptionCtor.prototype = Object.create(Error.prototype);
    DOMExceptionCtor.prototype.constructor = DOMExceptionCtor;

    stampCodes(DOMExceptionCtor);
    stampCodes(DOMExceptionCtor.prototype);
    G.DOMException = DOMExceptionCtor;
  } else {
    // Hermes has a partial DOMException — patch the missing numeric constants.
    stampCodes(G.DOMException);
    stampCodes(G.DOMException.prototype);
  }
}());
