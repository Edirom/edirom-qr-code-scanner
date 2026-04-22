# Edirom QR Code Scanner Web Component

## Overview

The `edirom-qr-code-scanner` is a Web Component that renders a live camera feed and continuously scans for QR codes. When a QR code is detected, it fires a `qr-code-scanned` custom event carrying the decoded text.

The scanner starts automatically when the component is connected to the DOM and stops cleanly when it is removed. An optional `regex` attribute lets the host application filter which scanned values trigger an event.

## Features

- **Automatic lifecycle management**: Camera feed starts on `connectedCallback` and stops on `disconnectedCallback`. No manual setup or teardown needed.
- **Continuous scanning**: The scanner keeps running after each successful scan. Remove the element from the DOM to stop it.
- **Regex filtering**: If the `regex` attribute is set, only scanned values matching the pattern dispatch an event. Invalid regex patterns are silently ignored.
- **Event-driven**: Integrates with any host application through a single custom event — no shared state or direct method calls required.
- **Back camera preference**: Automatically selects a back-facing / environment camera if available, falling back to the first available device.

## Endpoints (Attributes and Properties)

### `regex` (Attribute / Property)

An optional regular expression string. When set, the component tests every scanned value against the pattern. The `qr-code-scanned` event is dispatched only if the value matches. If the attribute is absent, every successfully decoded QR code fires the event.

|              |                                       |
| ------------ | ------------------------------------- |
| **Type**     | `string` (regular expression pattern) |
| **Required** | No                                    |
| **Default**  | _(absent — all scanned values pass)_  |

**Examples:**

```html
<!-- Fire for any QR code -->
<edirom-qr-code-scanner></edirom-qr-code-scanner>

<!-- Fire only for HTTPS URLs -->
<edirom-qr-code-scanner regex="^https://"></edirom-qr-code-scanner>

<!-- Fire only for codes matching a fixed prefix -->
<edirom-qr-code-scanner regex="^edirom-session-"></edirom-qr-code-scanner>
```

Setting the property in JavaScript:

```javascript
const scanner = document.querySelector("edirom-qr-code-scanner");

// Set regex filter
scanner.regex = "^https://";

// Remove filter (any value will fire the event again)
scanner.regex = null;
```

---

## Events

### `qr-code-scanned`

Fired when a QR code is successfully decoded and its value passes the `regex` filter (or when no `regex` attribute is set).

The event bubbles and crosses Shadow DOM boundaries (`composed: true`), so it can be caught on any ancestor element.

**Event detail:**

```javascript
{
  text: string; // The decoded text content of the scanned QR code
}
```

**Example:**

```javascript
document
  .querySelector("edirom-qr-code-scanner")
  .addEventListener("qr-code-scanned", (e) => {
    console.log("Scanned:", e.detail.text);
  });
```

---

## Dependencies

### `html5-qrcode`

This component relies on the `html5-qrcode` library for camera access and QR code decoding. The library must be loaded and available in the **global scope** (`window.Html5Qrcode`) **before** the component script is loaded.

```html
<!-- 1. Load the library first -->
<script src="resources/js/html5-qrcode.min.js"></script>

<!-- 2. Then load the component -->
<script src="resources/webcomponents/edirom-qr-code-scanner/edirom-qr-code-scanner.js"></script>
```

The component does **not** bundle or import the library itself.

> **Note on Shadow DOM**: This component intentionally does not use Shadow DOM. The `html5-qrcode` library locates its camera feed mount point via `document.getElementById()`, which cannot cross a Shadow Root boundary. Since the component has no styles of its own to encapsulate, Shadow DOM would only break the library without providing any benefit.

---

## Usage Example

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="resources/js/html5-qrcode.min.js"></script>
    <script src="resources/webcomponents/edirom-qr-code-scanner/edirom-qr-code-scanner.js"></script>
    <style>
      #scanner-container {
        width: 100%;
        max-width: 400px;
      }
    </style>
  </head>
  <body>
    <div id="scanner-container">
      <edirom-qr-code-scanner regex="^https://"></edirom-qr-code-scanner>
    </div>

    <script>
      document
        .querySelector("edirom-qr-code-scanner")
        .addEventListener("qr-code-scanned", (e) => {
          console.log("Scanned URL:", e.detail.text);

          // Stop scanning by removing the component from the DOM
          document.querySelector("edirom-qr-code-scanner").remove();
        });
    </script>
  </body>
</html>
```
