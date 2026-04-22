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
    }

    // -------------------------------------------------------------------------
    // Web Component lifecycle
    // -------------------------------------------------------------------------

    static get observedAttributes() {
        return ["regex", "aspect-ratio"];
    }

    connectedCallback() {
        console.log("Edirom QR Code Scanner connected!");
        this._startScanner();
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
    // Internal methods
    // -------------------------------------------------------------------------

    _startScanner() {
        // Create and mount the reader div into light DOM so that
        // document.getElementById() — used internally by html5-qrcode — can
        // find it.
        this._readerDiv = document.createElement("div");
        this._readerDiv.id = `edirom-qr-reader-${this._uid}`;
        this.appendChild(this._readerDiv);

        this._html5QrCode = new Html5Qrcode(this._readerDiv.id);

        Html5Qrcode.getCameras()
            .then((devices) => {
                let cameraId;

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
                    width: 2000,
                    height: 2000,
                    frameRate: 30,
                };

                // Apply the camera id: either a device id string or a
                // facingMode constraint object (mirrors smartphone_client.js)
                if (typeof cameraId === "object") {
                    videoConstraints.facingMode = cameraId.facingMode;
                } else {
                    videoConstraints.deviceId = cameraId;
                }

                return this._html5QrCode.start(
                    cameraId,
                    {
                        fps: 30,
                        aspectRatio: this.aspectRatio,
                        videoConstraints: videoConstraints,
                    },
                    (decodedText) => {
                        this._onCodeScanned(decodedText);
                    },
                    () => {
                        // Frame-level scan errors are expected and can be ignored
                    }
                );
            })
            .then(() => {
                this._scanning = true;
            })
            .catch((err) => {
                console.error("EdiromQrCodeScanner: failed to start scanner", err);
            });
    }

    _cleanup() {
        this._scanning = false;

        if (this._html5QrCode) {
            const qr = this._html5QrCode;
            this._html5QrCode = null;
            // Best-effort async stop — we don't await this
            qr.stop().catch(() => { });
        }

        if (this._readerDiv) {
            this._readerDiv.remove();
            this._readerDiv = null;
        }
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
