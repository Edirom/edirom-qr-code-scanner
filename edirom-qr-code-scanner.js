console.log("Edirom QR Code Scanner Web Component loaded");

// Note: This component intentionally does NOT use Shadow DOM.
//
// The html5-qrcode library locates its camera feed mount point via
// document.getElementById(). That API cannot cross a Shadow Root boundary —
// elements inside a shadow tree are invisible to document.getElementById(),
// even if their id is unique in the document. Attaching a shadow root would
// therefore silently break the library's internal DOM lookup.
//
// Since this component has no CSS of its own that needs encapsulation, Shadow
// DOM provides no benefit here. The reader <div> is appended directly into the
// component's light DOM via this.appendChild().

class EdiromQrCodeScanner extends HTMLElement {

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
        // No restart required — _onCodeScanned reads the regex attribute fresh
        // on every invocation, so live changes take effect immediately.
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
        if (!this._html5QrCode) return false;

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
            try {
                await this._startPromise;
            } catch (_) {
                // Start errors are handled where they occur.
            }
        }

        this._scanning = false;

        if (!this._html5QrCode) {
            return;
        }

        const state = this.getScannerState();
        if (!this._isScanningState(state) && !this._isPausedState(state)) {
            return;
        }

        await this._html5QrCode.stop();
    }

    // -------------------------------------------------------------------------
    // Internal methods
    // -------------------------------------------------------------------------

    async _startScannerInternal() {
        // Create and mount the reader div into light DOM so that
        // document.getElementById() — used internally by html5-qrcode — can
        // find it.
        if (!this._readerDiv) {
            this._readerDiv = document.createElement("div");
            this._readerDiv.id = `edirom-qr-reader-${this._uid}`;
        }
        if (!this._readerDiv.isConnected) {
            this.appendChild(this._readerDiv);
        }

        if (!this._html5QrCode) {
            this._html5QrCode = new Html5Qrcode(this._readerDiv.id);
        }

        let cameraId;
        const devices = await Html5Qrcode.getCameras();

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

    _onCodeScanned(decodedText) {
        const regexAttr = this.getAttribute("regex");

        if (regexAttr !== null) {
            try {
                const pattern = new RegExp(regexAttr);
                if (!pattern.test(decodedText)) {
                    return; // Does not match — suppress the event
                }
            } catch (e) {
                // Invalid regex in attribute — silently ignore, suppress event
                return;
            }
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
