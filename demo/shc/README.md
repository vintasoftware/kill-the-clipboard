# SMART Health Cards QR Code Demo

⚠️ **WARNING: FOR TESTING AND DEMONSTRATION PURPOSES ONLY**

This demo application demonstrates how to use the `kill-the-clipboard` library to generate and scan SMART Health Card QR codes. **This is NOT intended for production use with real patient health data.**

## Usage

```bash
# From project root
pnpm install
pnpm run shc:demo:dev
```

The demo will open in your browser at `http://localhost:3000`.

## What This Demo Shows

- **QR Code Generation**: Generate SMART Health Card QR codes from FHIR bundles
- **Camera Scanning**: Scan QR codes using your device's camera
- **Data Verification**: Cryptographically verify and decode health card data
- **Browser Compatibility**: Works in modern web browsers with camera access

## Technology Stack

- **Vanilla JavaScript**: No framework dependencies
- **Vite**: Build tool and dev server
- **qr**: For QR code decoding
- **jose**: For importing JWKs
- **kill-the-clipboard**: SMART Health Cards implementation

**Remember**: This is a test application demonstrating library capabilities. Never use this with real patient health data!
