# AGENTS.md: AI Collaboration Guide for kill-the-clipboard

This document provides essential context for AI models interacting with this project. Adhering to these guidelines will ensure consistency and maintain code quality.

## 1. Project Overview & Purpose

* **Primary Goal:** This is a TypeScript library designed to facilitate the secure sharing of medical records by generating QR codes, SMART Health Cards and Smart Health Links. It aims to replace manual data entry, which is inefficient and error-prone.
* **Key Features:** The library implements two main standards for health data interchange:
    * **SMART Health Cards:** Compact verifiable credentials containing essential health information, like vaccination records.
    * **Smart Health Links:** Secure and shareable links to access comprehensive health records, like a patient's entire medical history.
* **Business Domain:** Health-tech, focusing on interoperability and patient data privacy.

## 2. Core Technologies & Stack

* **Primary Language:** **TypeScript** (strict mode enabled).
* **Package Manager:** **pnpm** is used for dependency management. The `pnpm-lock.yaml` file is committed to the repository.
* **Key Dependencies:**
    * `jose`: For JSON Web Signature (JWS) and encryption, crucial for the security of SMART Health Cards.
    * `qrcode`: For generating the QR code images.
* **Testing Framework:** **Vitest** is used for unit and integration testing. Test files are located at `test/`.
* **Linting & Formatting:**
    * **Biome:** For identifying and reporting on patterns in ECMAScript/JavaScript code.

## 3. Project Structure & Architecture

* **Universal Library Design:** The library is built for both browser and Node.js environments with dual ESM/CJS exports.
* **Modular Architecture:** Core functionality is organized into distinct modules:
    * `src/shc/`: SMART Health Cards implementation (JWS, QR codes, verification)
    * `src/shl/`: Smart Health Links implementation (encryption, manifest serving, decryption)
    * `src/common/`: Shared utilities (compression, etc.)
* **Main Entry Points:**
    * **SmartHealthCardIssuer**: Server-side health card creation and signing
    * **SmartHealthCardReader**: Client/server-side verification and QR scanning
    * **SHL, SHLManifestBuilder**: Server-side SHL creation and manifest building
    * **SHLViewer**: Client-side SHL resolution and decryption
* **Error Handling:** Structured error hierarchy with specific error types (`SmartHealthCardError`, `FhirValidationError`, `JWSError`, `QRCodeError`)
* **Demo Applications:**
    * `demo/shc/`: Vanilla JS browser demo for SMART Health Cards QR generation and scanning
    * `demo/shl/`: Next.js full-stack with Medplum demo for Smart Health Links generation and viewing

## 4. Development Workflow & Commands

* **Package Manager:** Use `pnpm` exclusively for dependency management (specified in `packageManager` field of `package.json`).
* **Key Development Commands:**
    * `pnpm install`: Install all dependencies with frozen lockfile
    * `pnpm dev` or `pnpm build:watch`: Development mode with auto-rebuild on changes
    * `pnpm build`: Production build (generates dual ESM/CJS bundles)
    * `pnpm test`: Run test suite with Vitest
    * `pnpm test:watch`: Run tests in watch mode during development
    * `pnpm test:coverage`: Generate test coverage reports
    * `pnpm typecheck`: TypeScript type checking without emitting files
    * `pnpm lint`: Check code style and linting with Biome
    * `pnpm lint:fix`: Auto-fix linting and formatting issues
* **Documentation Commands:**
    * `pnpm docs:build`: Generate TypeDoc API documentation
    * `pnpm docs:watch`: Generate docs in watch mode
* **Demo Commands:**
    * `pnpm shc:demo:dev`: Build library and start SMART Health Cards demo
    * `pnpm shl:demo:dev`: Build library and start Smart Health Links demo (requires Medplum setup)
* **Validation Commands:**
    * `pnpm validate:examples`: Validate all SHCs examples in the `examples/` directory
* **Testing Strategy:** Comprehensive test suite covers core functionality with coverage requirements enforced in CI.

## 5. Coding Conventions & Style Guide

* **TypeScript:** Strict mode enabled with comprehensive type definitions. All public APIs must be fully typed.
* **Code Formatting:** Biome handles all formatting and linting:
    * 2-space indentation
    * 100-character line width
    * Single quotes for JavaScript/TypeScript
    * Trailing commas in ES5 style
    * Semicolons as needed (ASI-safe)
* **Import/Export Style:** Use ES modules exclusively with `.js` extensions in imports (for proper ESM compatibility).
* **Error Handling:** Use structured error classes; never throw generic Error objects.
* **Security Practices:**
    * Private keys must never be exposed to browser environments
    * All SHL file URLs should be HTTPS and short-lived
    * Passcodes are server-side only and never included in encrypted payloads
* **Naming Conventions:**
    * Classes: PascalCase (e.g., `SmartHealthCardIssuer`)
    * Files: kebab-case (e.g., `manifest-builder.ts`)
    * Constants: SCREAMING_SNAKE_CASE for module-level constants
* **Documentation:** Use TypeDoc for API documentation on all public APIs.

## 6. Contribution Guidelines

* **Branch Strategy:** Create feature branches from `main` and use rebase workflow.
* **Commit Convention:** Use conventional commits for automatic semantic versioning:
    * `feat:` - New features (minor version bump)
    * `fix:` - Bug fixes (patch version bump)
    * `feat!:` or `BREAKING CHANGE:` - Breaking changes (major version bump)
    * `docs:`, `chore:`, `test:` - No version bump
* **Pre-commit Requirements:** All commits must pass:
    * TypeScript type checking (`pnpm typecheck`)
    * Biome linting (`pnpm lint`)
    * Test suite (`pnpm test`)
    * Coverage doesn't reduce (`pnpm test:coverage`)
* **Pull Request Process:**
    1. Ensure all CI checks pass (Node.js 20 & 22 matrix)
    2. Use descriptive PR titles and descriptions
    3. Keep changes atomic and focused
    4. Request review from maintainers
    5. Rebase and merge to maintain linear history
* **Testing Requirements:** All new features must include comprehensive tests. Update or add tests for any code changes, even if not explicitly requested. Check coverage results to achieve 100% coverage on new code (`pnpm test:coverage`).
* **Validate SHC Examples:** Validate all SHCs examples in the `examples/` directory with `pnpm validate:examples` after any changes to the SHC part of the library.
* **Update demos if necessary.** Update demos if necessary to reflect any changes to the library.
* **Update this file if necessary.** Update this file if any changes to the project makes any statement of this file outdated or incorrect.
