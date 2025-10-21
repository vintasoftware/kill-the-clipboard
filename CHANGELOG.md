# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1]

### Fixed

- Drop wrong postinstall script

## [1.0.0]

Several breaking changes have been introduced in this release.

### Changed

- Renamed classes `SmartHealthCard` -> `SHC`, `SmartHealthCardIssuer` -> `SHCIssuer`, `SmartHealthCardReader` -> `SHCReader`. Also renamed `SHLinkPayloadV1` -> `SHLPayloadV1`, `SHLink` -> `SHL` for consistency
- Renamed `serialize`/`deserialize` to `toDBAttrs`/`fromDBAttrs` in `SHLManifestBuilder`
- Consistently use "SMART" instead of "Smart" throughout the codebase
- Removed `@internal` from `SHL.fromPayload` method to expose it in the documentation

### Added

- **SHL U flag support**: SMART Health Links class `SHL` now support the U flag for direct file access. `SHLViewer` now supports resolving U-flag SHLs.
- **SHL ZIP compression support**: Added back support for ZIP compression in `SHL` since many published examples use it
- **SHL enhanced error handling**: Added new error types for better SHL error management
- **SHL optional IDs**: Support for optional IDs in SMART Health Links

### Fixed

- Fix browser-side `decryptSHLFile` function
- Fix `resolvePublicKeyFromJWKS` in `SHCReader`

## [0.0.2] - Initial Release

### Added
- Initial implementation of SMART Health Cards Framework
- Initial implementation of SMART Health Links Protocol
- QR code generation
- Universal library support (browser and Node.js)
