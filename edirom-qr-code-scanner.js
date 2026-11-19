console.log("Edirom QR Code Scanner Web Component loaded");

// Note: This component intentionally does NOT use Shadow DOM.
//
// This component has no CSS of its own that needs encapsulation, so Shadow
// DOM provides no benefit here. The reader <div> is appended directly into the
// component's light DOM via this.appendChild().

// Resolve the component's own script URL at definition time, so we can
// locate the html5-qrcode library relative to ourselves even when the
// component is deployed at an unknown path.
const _COMPONENT_BASE = (() => {
    // Classic <script> tag
    if (document.currentScript) {
        return new URL('.', document.currentScript.src).href;
    }
    // ES module (imported or loaded with type="module")
    try {
        if (import.meta.url) {
            return new URL('.', import.meta.url).href;
        }
    } catch (_) { }
    return '';
})();

class EdiromQrCodeScanner extends HTMLElement {

    // Shared across all instances: tracks a single in-flight library load.
    static _libraryLoadPromise = null;

    constructor() {
        super();

        // Unique id so multiple scanner instances on the same page don't clash
        this._uid = crypto.randomUUID();

        // html5-qrcode instance
        this._html5QrCode = null;

        // Whether the scanner is currently running
        this._scanning = false;

        // The div that serves as the camera feed mount point for html5-qrcode
        this._readerDiv = null;

        // Promise for an in-flight start operation to avoid duplicate starts
        this._startPromise = null;

        // The compiled `regex` attribute, or null if there is none. An invalid pattern disables the scanner
        // (see _updateRegex): `_regexInvalid` is true and nothing is started or dispatched.
        this._regex = null;
        this._regexInvalid = false;

        // The `alsoAccept` predicate, or null (see the property)
        this._alsoAccept = null;
    }

    // -------------------------------------------------------------------------
    // Web Component lifecycle
    // -------------------------------------------------------------------------

    static get observedAttributes() {
        return ["regex", "aspect-ratio"];
    }

    connectedCallback() {
        console.log("Edirom QR Code Scanner connected!");
        this.startScanner();
    }

    disconnectedCallback() {
        console.log("Edirom QR Code Scanner disconnected!");
        this._cleanup();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        if (name === "regex") {
            this._updateRegex();
        }
    }

    /**
     * Compiles the `regex` attribute once, so a live change takes effect on the next scan. An invalid pattern
     * logs a warning and disables the scanner: it is stopped and not started again until the pattern is valid
     * (or removed), because filtering with a pattern that cannot be applied would accept or reject everything.
     */
    _updateRegex() {
        const wasInvalid = this._regexInvalid;
        const pattern = this.getAttribute("regex");
        this._regex = null;
        this._regexInvalid = false;

        if (pattern !== null) {
            try {
                this._regex = new RegExp(pattern);
            } catch (error) {
                this._regexInvalid = true;
                console.warn(`Edirom QR Code Scanner: invalid regex "${pattern}", the scanner is disabled.`, error);
            }
        }

        if (this._regexInvalid) {
            this.stopScanner().catch((err) => {
                console.error("EdiromQrCodeScanner: failed to stop the scanner for an invalid regex", err);
            });
        } else if (wasInvalid && this.isConnected) {
            this.startScanner().catch((err) => {
                console.error("EdiromQrCodeScanner: failed to restart the scanner", err);
            });
        }
    }

    // -------------------------------------------------------------------------
    // Property / attribute sync (mirrors edirom-icon pattern)
    // -------------------------------------------------------------------------

    get regex() {
        return this.getAttribute("regex");
    }

    set regex(v) {
        if (v) {
            this.setAttribute("regex", v);
        } else {
            this.removeAttribute("regex");
        }
    }

    /**
     * A function the host can set to accept codes that the `regex` does not match: `(text: string) => boolean`.
     * A code is dispatched if it matches the `regex` or this function returns true for it, so the host can let
     * through what it can handle by itself (for example its own links) without the pattern having to describe it.
     * It is only asked about codes the `regex` rejects, and never overrides an invalid `regex`. A function that
     * throws counts as "no". Set it to `null` to remove it. It is a property only, as a function cannot be an attribute.
     * @type {((text: string) => boolean)|null}
     */
    get alsoAccept() {
        return this._alsoAccept;
    }

    set alsoAccept(fn) {
        this._alsoAccept = typeof fn === "function" ? fn : null;
    }

    get aspectRatio() {
        const val = parseFloat(this.getAttribute("aspect-ratio"));
        return isNaN(val) ? 0.75 : val; // default: 3:4 portrait
    }

    set aspectRatio(v) {
        if (v != null) {
            this.setAttribute("aspect-ratio", v);
        } else {
            this.removeAttribute("aspect-ratio");
        }
    }

    // -------------------------------------------------------------------------
    // Public lifecycle API (host-controlled)
    // -------------------------------------------------------------------------

    getScannerState() {
        if (!this._html5QrCode || typeof this._html5QrCode.getState !== "function") {
            return null;
        }
        try {
            return this._html5QrCode.getState();
        } catch (_) {
            return null;
        }
    }

    isScannerReady() {
        return !!this._html5QrCode;
    }

    isScannerRunning() {
        return this._isScanningState(this.getScannerState());
    }

    async startScanner() {
        // Disabled by an invalid regex (see _updateRegex)
        if (this._regexInvalid) {
            return;
        }

        if (this._startPromise) {
            return this._startPromise;
        }

        const state = this.getScannerState();
        if (this._isScanningState(state)) {
            this._scanning = true;
            return;
        }

        if (this._isPausedState(state)) {
            this.resumeScanner();
            return;
        }

        this._startPromise = this._startScannerInternal()
            .finally(() => {
                this._startPromise = null;
            });

        return this._startPromise;
    }

    pauseScanner(shouldPauseVideo = true) {
        if (!this._html5QrCode) return false;

        const state = this.getScannerState();
        if (this._isPausedState(state)) {
            this._scanning = false;
            return true;
        }

        if (!this._isScanningState(state)) {
            return false;
        }

        try {
            this._html5QrCode.pause(shouldPauseVideo);
            this._scanning = false;
            return true;
        } catch (err) {
            console.error("EdiromQrCodeScanner: failed to pause scanner", err);
            return false;
        }
    }

    resumeScanner() {
        if (!this._html5QrCode || this._regexInvalid) return false;

        const state = this.getScannerState();
        if (this._isScanningState(state)) {
            this._scanning = true;
            return true;
        }

        if (!this._isPausedState(state)) {
            return false;
        }

        try {
            this._html5QrCode.resume();
            this._scanning = true;
            return true;
        } catch (err) {
            console.error("EdiromQrCodeScanner: failed to resume scanner", err);
            return false;
        }
    }

    async stopScanner() {
        if (this._startPromise) {
            // An init is in progress. Abort it immediately by force-resetting
            // (nulls _html5QrCode so _startScannerInternal exits at its guard
            // check), then wait for the promise to settle. This avoids ever
            // calling html5-qrcode's stop() on a partially-initialized instance.
            const pending = this._startPromise;
            this._forceReset();
            try {
                await pending;
            } catch (_) {
                // Expected — start was aborted mid-flight.
            }
            return;
        }

        this._scanning = false;

        if (!this._html5QrCode) {
            return;
        }

        const state = this.getScannerState();
        if (!this._isScanningState(state) && !this._isPausedState(state)) {
            return;
        }

        try {
            await this._html5QrCode.stop();
        } catch (err) {
            // html5-qrcode can throw when stopped during initialisation
            // (e.g. "Cannot transition to a new state"). Force a clean reset
            // so the component is restartable on next use.
            this._forceReset();
            throw err;
        }
    }

    /**
     * Unconditionally tears down the html5-qrcode instance and the reader div,
     * leaving the component in a clean, restartable state. Use this as an
     * escape hatch when the library enters an unrecoverable transition state.
     */
    _forceReset() {
        this._scanning = false;
        this._startPromise = null;
        this._html5QrCode = null;
        if (this._readerDiv) {
            try {
                this._readerDiv.remove();
            } catch (_) {
                // Best-effort removal; the node may already be detached.
            }
            this._readerDiv = null;
        }
    }

    // -------------------------------------------------------------------------
    // Internal methods
    // -------------------------------------------------------------------------

    async _ensureLibrary() {
        // Already available — either host loaded it or a previous instance did.
        if (window.Html5Qrcode) return;

        // Another instance is already injecting the script — wait for it.
        if (this.constructor._libraryLoadPromise) {
            return this.constructor._libraryLoadPromise;
        }

        if (!_COMPONENT_BASE) {
            throw new Error(
                'Cannot determine component location to load html5-qrcode. ' +
                'Preload the library with a <script> tag before this component.'
            );
        }

        const scriptSrc = new URL('resources/html5-qrcode.min.js', _COMPONENT_BASE).href;

        this.constructor._libraryLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptSrc;
            script.onload = () => {
                if (window.Html5Qrcode) {
                    resolve();
                } else {
                    reject(new Error(
                        'html5-qrcode script loaded but window.Html5Qrcode is not set. ' +
                        'The library may not be the expected build.'
                    ));
                }
            };
            script.onerror = () => {
                reject(new Error(`Failed to load html5-qrcode from: ${scriptSrc}`));
            };
            document.head.appendChild(script);
        });

        try {
            await this.constructor._libraryLoadPromise;
        } finally {
            // Clear so a failed load can be retried (e.g. host fixes the path).
            this.constructor._libraryLoadPromise = null;
        }
    }

    async _startScannerInternal() {
        // Ensure the html5-qrcode library is loaded before we use it.
        await this._ensureLibrary();

        // Create and mount the reader div into light DOM.
        // The element reference is passed directly to Html5Qrcode (no ID lookup needed).
        if (!this._readerDiv) {
            this._readerDiv = document.createElement("div");
        }
        if (!this._readerDiv.isConnected) {
            this.appendChild(this._readerDiv);
        }

        if (!this._html5QrCode) {
            this._html5QrCode = new Html5Qrcode(this._readerDiv);
        }

        let cameraId;
        const devices = await Html5Qrcode.getCameras();

        // Guard: _forceReset() may have been called while getCameras() was
        // awaiting (e.g. the user closed the popover). Exit cleanly so that
        // html5-qrcode APIs are never called on a torn-down instance.
        if (!this._html5QrCode) {
            return;
        }

        if (devices && devices.length > 0) {
            // Prefer a back-facing camera; fall back to the first device
            const backCamera = devices.find((d) =>
                /back|rear|environment/i.test(d.label)
            );
            cameraId = backCamera ? backCamera.id : devices[0].id;
        } else {
            // No enumerated devices — let the browser pick via facingMode
            cameraId = { facingMode: "environment" };
        }

        const videoConstraints = {
            width: 20000,
            height: 20000,
            frameRate: 30,
        };

        // Apply the camera id: either a device id string or a
        // facingMode constraint object (mirrors smartphone_client.js)
        if (typeof cameraId === "object") {
            videoConstraints.facingMode = cameraId.facingMode;
        } else {
            videoConstraints.deviceId = cameraId;
        }

        await this._html5QrCode.start(
            cameraId,
            {
                fps: 30,
                aspectRatio: this.aspectRatio,
                qrbox: 150,
                videoConstraints: videoConstraints,
            },
            (decodedText) => {
                this._onCodeScanned(decodedText);
            },
            () => {
                // Frame-level scan errors are expected and can be ignored
            }
        );

        this._scanning = true;
    }

    async _cleanup() {
        try {
            await this.stopScanner();
        } catch (_) {
            // Best effort cleanup during disconnect.
        }

        this._scanning = false;
        this._html5QrCode = null;
        this._startPromise = null;

        if (this._readerDiv) {
            this._readerDiv.remove();
            this._readerDiv = null;
        }
    }

    _isScanningState(state) {
        const scanning = typeof Html5QrcodeScannerState !== "undefined"
            ? Html5QrcodeScannerState.SCANNING
            : 2;
        return state === scanning;
    }

    _isPausedState(state) {
        const paused = typeof Html5QrcodeScannerState !== "undefined"
            ? Html5QrcodeScannerState.PAUSED
            : 3;
        return state === paused;
    }

    /**
     * Whether a scanned code is passed on: there is no `regex`, it matches, or `alsoAccept` takes it. Nothing is
     * accepted while the `regex` is invalid.
     * @param {string} decodedText
     * @returns {boolean}
     */
    _isAccepted(decodedText) {
        if (this._regexInvalid) return false;
        if (this._regex === null || this._regex.test(decodedText)) return true;
        if (this._alsoAccept === null) return false;
        try {
            return this._alsoAccept(decodedText) === true;
        } catch (error) {
            console.warn("Edirom QR Code Scanner: the alsoAccept function failed, the code is not accepted.", error);
            return false;
        }
    }

    _onCodeScanned(decodedText) {
        // Disabled by an invalid regex, or not accepted: suppress the event
        if (!this._isAccepted(decodedText)) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent("qr-code-scanned", {
                bubbles: true,
                composed: true,
                detail: { text: decodedText },
            })
        );
    }
}

customElements.define("edirom-qr-code-scanner", EdiromQrCodeScanner);
