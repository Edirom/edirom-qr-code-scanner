# Edirom QR Code Scanner

Web Component that renders a live camera feed and continuously scans for QR codes. Dispatches a `qr-code-scanned` event with the decoded text when a matching code is detected. Does not use Shadow DOM.

## Usage

```html
<script src="resources/webcomponents/edirom-qr-code-scanner/edirom-qr-code-scanner.js"></script>

<edirom-qr-code-scanner
  regex="^edirom://"
  aspect-ratio="1"
></edirom-qr-code-scanner>
```

```js
const scanner = document.querySelector("edirom-qr-code-scanner");

scanner.addEventListener("qr-code-scanned", (e) => {
  console.log("Scanned:", e.detail.text);
});

// Host-controlled lifecycle
await scanner.startScanner();
scanner.pauseScanner();        // pause scanning (keep camera)
scanner.resumeScanner();       // resume
await scanner.stopScanner();   // fully stop
```

## Attributes

| Attribute | Type | Default | Description |
|---|---|---|---|
| `regex` | string | — | Regex pattern. Only matching scans dispatch events. Invalid patterns are silently ignored. Changes take effect immediately — no restart needed. |
| `aspect-ratio` | number | `0.75` | Camera feed aspect ratio (height / width). `0.75` = 3:4 portrait. |

## Properties

| Property | Type | Description |
|---|---|---|
| `regex` | `string` \| `null` | Get/set the regex filter. Set to `null` to clear. |
| `aspectRatio` | `number` | Get/set the aspect ratio. |

## Events

| Event | Detail | Description |
|---|---|---|
| `qr-code-scanned` | `{ text: string }` | Fired when a QR code is decoded and passes the `regex` filter. Bubbles, crosses shadow boundaries. |

## Methods

| Method | Returns | Description |
|---|---|---|
| `startScanner()` | `Promise<void>` | Start or resume the scanner. Safe to call multiple times — no-ops if already running. |
| `pauseScanner(shouldPauseVideo?)` | `boolean` | Pause scanning. Pass `true` to also freeze the camera feed. Returns whether the pause succeeded. |
| `resumeScanner()` | `boolean` | Resume a paused scanner. Returns whether the resume succeeded. |
| `stopScanner()` | `Promise<void>` | Fully stop and clean up. Restartable via `startScanner()`. |
| `getScannerState()` | `number` \| `null` | Raw html5-qrcode state value (`SCANNING` = 2, `PAUSED` = 3). `null` if no instance exists. |
| `isScannerReady()` | `boolean` | Whether the html5-qrcode instance has been created. |
| `isScannerRunning()` | `boolean` | Whether the camera is actively scanning. |

## Dependencies

### `html5-qrcode`

The component depends on a **locally modified** version of [html5-qrcode](https://github.com/mebjas/html5-qrcode). The library is **loaded automatically** on first use — no manual `<script>` tag needed. The component resolves the library relative to its own script URL (`resources/html5-qrcode.min.js`) and injects it into the document `<head>`. If `window.Html5Qrcode` is already present (e.g. the host preloaded it), injection is skipped.

The local copy extends the `Html5Qrcode` constructor to accept an `HTMLElement` directly (upstream only accepts element ID strings). Passing a string ID still works as before. This allows the scanner's reader `<div>` to reside anywhere in the DOM — including inside a shadow root.

