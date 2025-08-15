# SMART Health Cards QR Code Example

⚠️ **WARNING: FOR TESTING AND DEMONSTRATION PURPOSES ONLY**

This example application demonstrates how to use the `kill-the-clipboard` library to generate and scan SMART Health Card QR codes. **This is NOT intended for production use with real patient health data.**

## What This Example Shows

- **QR Code Generation**: Generate SMART Health Card QR codes from FHIR bundles
- **Camera Scanning**: Scan QR codes using your device's camera
- **Data Verification**: Cryptographically verify and decode health card data
- **Browser Compatibility**: Works in modern web browsers with camera access

## Features Demonstrated

✅ ES256 cryptographic signing and verification  
✅ DEFLATE payload compression  
✅ QR code generation with proper multi-segment encoding  
✅ FHIR R4 Bundle processing and validation  
✅ Camera-based QR code scanning  
✅ Verifiable Credential structure handling  

## Sample Data

This example uses **completely fake/demo data**:
- Test patient: "Test Demo" (fictitious person)
- Demo vaccination record for COVID-19
- Test cryptographic keys (never use in production)
- Fake healthcare provider information

## Technology Stack

- **Vanilla JavaScript**: No framework dependencies
- **Vite**: Build tool and dev server
- **jsQR**: QR code scanning library
- **jose**: JSON Web Key handling for cryptographic operations
- **buffer**: Node.js Buffer polyfill for browser compatibility
- **kill-the-clipboard**: SMART Health Cards implementation

## Security Notes

🔒 **Critical Security Information:**
- Uses official SMART Health Cards example JWKS test keys that are publicly available
- Sample data is completely fictitious
- Not suitable for real healthcare applications  
- Real implementations require proper key management
- Only authorized healthcare organizations should issue real health cards

## Browser Requirements

- Modern browser with ES2015+ support
- Camera access for QR scanning functionality
- HTTPS required for camera access (or localhost for development)

## Technical Notes

### Buffer Polyfill
This example includes a Buffer polyfill to ensure compatibility with Node.js libraries (like the QR code generator) in browser environments. The polyfill is automatically configured in Vite and made available globally.

### QR Code Generation
Uses the same QR code library as Node.js environments with proper browser polyfills, ensuring consistent behavior across platforms.

## File Structure

```
example/
├── index.html          # Main HTML page
├── main.js            # Application logic
├── style.css          # Styling
├── package.json       # Dependencies
├── vite.config.js     # Vite configuration
└── README.md          # This file
```

---

**Remember**: This is a test application demonstrating library capabilities. Never use this with real patient health information!
