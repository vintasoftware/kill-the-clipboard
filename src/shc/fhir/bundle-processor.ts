// FHIR Bundle processing for SMART Health Cards

import { FhirValidationError, InvalidBundleReferenceError } from '../errors.js'
import type { FHIRBundle } from '../types.js'

/**
 * Processes and validates FHIR R4 Bundles according to SMART Health Cards specification.
 *
 * @public
 * @category Lower-Level API
 */
export class FHIRBundleProcessor {
  /**
   * Processes a FHIR Bundle with standard processing.
   *
   * @param bundle - FHIR Bundle to process
   * @returns Processed FHIR Bundle
   * @throws {@link FhirValidationError} When bundle is not a valid FHIR Bundle
   */
  process(bundle: FHIRBundle): FHIRBundle {
    if (!bundle || bundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('Invalid bundle: must be a FHIR Bundle resource')
    }

    // Create a deep copy to avoid modifying the original
    const processedBundle: FHIRBundle = JSON.parse(JSON.stringify(bundle))

    // Ensure Bundle.type defaults to "collection" per SMART Health Cards spec
    // This is the only explicit field requirement mentioned in the spec
    if (!processedBundle.type) {
      processedBundle.type = 'collection'
    }

    return processedBundle
  }

  /**
   * Processes a FHIR Bundle with QR code optimizations (short resource-scheme URIs, removes unnecessary fields).
   *
   * @param bundle - FHIR Bundle to process
   * @param config.strictReferences - When `strictReferences` is true,
   *  missing `Reference.reference` targets throw `InvalidBundleReferenceError`;
   *  when false, original references are preserved when no target resource is found in bundle.
   * @returns Processed FHIR Bundle optimized for QR codes
   * @throws {@link InvalidBundleReferenceError} When `strictReferences` is true and a reference cannot be resolved
   */
  processForQR(bundle: FHIRBundle, config: { strictReferences?: boolean } = {}): FHIRBundle {
    // Start with standard processing
    const processedBundle = this.process(bundle)

    // Apply QR optimizations
    return this.optimizeForQR(processedBundle, config.strictReferences ?? true)
  }

  /**
   * Optimizes a FHIR Bundle for QR code generation
   * - Uses short resource-scheme URIs (resource:0, resource:1, etc.)
   * - Removes unnecessary .id and .display fields
   * - Removes empty arrays and null values
   */
  private optimizeForQR(bundle: FHIRBundle, strict: boolean): FHIRBundle {
    const optimizedBundle: FHIRBundle = JSON.parse(JSON.stringify(bundle))

    // Drop Bundle.id
    delete optimizedBundle.id

    // Create resource reference mapping
    const resourceMap = new Map<string, string>()

    // First pass: map fullUrl to short resource references
    if (optimizedBundle.entry) {
      optimizedBundle.entry.forEach((entry, index) => {
        if (entry.fullUrl) {
          resourceMap.set(entry.fullUrl.split('/').slice(-2).join('/'), `resource:${index}`)
          entry.fullUrl = `resource:${index}`
        }
      })

      // Second pass: optimize resources and update references
      optimizedBundle.entry.forEach(entry => {
        if (entry.resource) {
          // Recursively optimize the resource
          entry.resource = this.optimizeResource(
            entry.resource,
            resourceMap,
            strict
          ) as typeof entry.resource
        }
      })
    }

    return optimizedBundle
  }

  /**
   * Recursively optimizes a FHIR resource for QR codes
   */
  private optimizeResource(
    resource: unknown,
    resourceMap: Map<string, string>,
    strict: boolean
  ): unknown {
    if (!resource || typeof resource !== 'object') {
      return resource
    }

    if (Array.isArray(resource)) {
      return resource
        .map(item => this.optimizeResource(item, resourceMap, strict))
        .filter(item => item !== null && item !== undefined)
    }

    const optimized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(resource as Record<string, unknown>)) {
      // Skip null, undefined, and empty arrays
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
        continue
      }

      // Remove Resource.id for all resources
      if (key === 'id') {
        continue
      }

      // Handle Resource.meta - only keep meta.security if present
      if (key === 'meta') {
        if (typeof value === 'object' && value !== null) {
          const metaObj = value as Record<string, unknown>
          if (metaObj.security && Array.isArray(metaObj.security)) {
            optimized[key] = { security: metaObj.security }
          }
        }
        continue
      }

      // Remove text from DomainResource and CodeableConcept
      if (
        (key === 'text' && this.isCodeableConcept(resource)) ||
        (key === 'text' && this.isDomainResource(resource))
      ) {
        continue
      }

      // Remove .display fields from CodeableConcept.coding, but not from other contexts
      if (key === 'display' && typeof value === 'string' && this.isWithinCoding(resource)) {
        continue
      }

      // Update references to use short resource-scheme URIs
      if (key === 'reference' && typeof value === 'string') {
        const shortRef = resourceMap.get(value)
        if (shortRef) {
          // Found reference in resourceMap
          optimized[key] = shortRef
        } else {
          // Reference not found in resourceMap
          if (strict) {
            // Strict mode: raise exception for missing references
            throw new InvalidBundleReferenceError(
              `Reference "${value}" not found in bundle resources`
            )
          } else {
            // Non-strict mode: keep the original reference
            optimized[key] = value
          }
        }
        continue
      }

      // Recursively process nested objects and arrays
      optimized[key] = this.optimizeResource(value, resourceMap, strict)
    }

    return optimized
  }

  /**
   * Checks if a resource is a DomainResource
   */
  private isDomainResource(resource: unknown): boolean {
    return (
      resource != null &&
      // @ts-expect-error - ignore type error
      resource.text != null &&
      // @ts-expect-error - ignore type error
      typeof resource.text === 'object' &&
      // @ts-expect-error - ignore type error
      'div' in resource.text
    )
  }

  /**
   * Checks if a resource is a CodeableConcept
   */
  private isCodeableConcept(resource: unknown): boolean {
    return (
      resource != null &&
      typeof resource === 'object' &&
      'coding' in resource &&
      Array.isArray((resource as Record<string, unknown>).coding)
    )
  }

  /**
   * Checks if a resource is within a coding array context
   * Display fields should only be removed from coding arrays, not other contexts
   */
  private isWithinCoding(resource: unknown): boolean {
    return (
      resource !== null &&
      typeof resource === 'object' &&
      'system' in resource &&
      'code' in resource &&
      typeof (resource as Record<string, unknown>).system === 'string' &&
      typeof (resource as Record<string, unknown>).code === 'string'
    )
  }

  /**
   * Validates a FHIR Bundle for basic compliance.
   *
   * @param bundle - FHIR Bundle to validate
   * @returns `true` if validation passes
   * @throws {@link FhirValidationError} if validation fails
   */
  validate(bundle: FHIRBundle): boolean {
    try {
      // Basic structure validation
      if (!bundle) {
        throw new FhirValidationError('Bundle cannot be null or undefined')
      }

      if (bundle.resourceType !== 'Bundle') {
        throw new FhirValidationError('Resource must be of type Bundle')
      }

      // Enforce FHIR Bundle.type value set (R4) if provided
      // SHC 1.3.0 allows any FHIR Bundle.type, but it must still be one of the FHIR-defined codes
      // See: https://spec.smarthealth.cards/changelog/ (1.3.0) and https://build.fhir.org/valueset-bundle-type.html
      if (bundle.type) {
        const allowedTypes = new Set([
          'document',
          'message',
          'transaction',
          'transaction-response',
          'batch',
          'batch-response',
          'history',
          'searchset',
          'collection',
        ])
        if (!allowedTypes.has(bundle.type as string)) {
          throw new FhirValidationError(`Invalid bundle.type: ${bundle.type}`)
        }
      }

      // Validate entries if present
      if (bundle.entry) {
        if (!Array.isArray(bundle.entry)) {
          throw new FhirValidationError('Bundle.entry must be an array')
        }

        for (const [index, entry] of bundle.entry.entries()) {
          if (!entry.resource) {
            throw new FhirValidationError(`Bundle.entry[${index}] must contain a resource`)
          }

          if (!entry.resource.resourceType) {
            throw new FhirValidationError(
              `Bundle.entry[${index}].resource must have a resourceType`
            )
          }
        }
      }

      return true
    } catch (error) {
      if (error instanceof FhirValidationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FhirValidationError(`Bundle validation failed: ${errorMessage}`)
    }
  }
}
