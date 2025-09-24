import { MedplumClient } from '@medplum/core';
import { DocumentManifest, DocumentReference, AuditEvent, Bundle, Extension } from '@medplum/fhirtypes';

// FHIR-based storage for Medplum backend
export class MedplumStorage {
  constructor(private medplum: MedplumClient) {}

  /**
   * Store SHL data as DocumentManifest with extensions
   * Creates DocumentReferences for each file first, then the DocumentManifest
   */
  async storeManifestBuilder(
    entropy: string,
    builderAttrs: any, // From toDBAttrs() method - contains { files: SHLManifestFileDBAttrs[] }
    config: {
      shlPayload: any;
      label?: string;
      flags?: string;
      hashedPasscode?: string;
      expirationDate?: Date;
    }
  ): Promise<DocumentManifest> {
    // First, create DocumentReference resources for each file
    const documentReferences: DocumentReference[] = [];

    if (builderAttrs.files && Array.isArray(builderAttrs.files)) {
      for (const file of builderAttrs.files) {
        const docRef = await this.createDocumentReference({
          contentType: file.type,
          ciphertextLength: file.ciphertextLength,
          binaryUrl: file.storagePath, // This is the Binary resource ID/path
          lastUpdated: file.lastUpdated
        });
        documentReferences.push(docRef);
      }
    }

    // Create extensions array
    const extensions: Extension[] = [
      {
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-payload',
        valueString: JSON.stringify(config.shlPayload)
      },
      {
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/builder-attrs',
        valueString: JSON.stringify(builderAttrs)
      }
    ];

    if (config.label) {
      extensions.push({
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-label',
        valueString: config.label
      });
    }

    if (config.flags) {
      extensions.push({
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-flag',
        valueString: config.flags
      });
    }

    if (config.hashedPasscode) {
      extensions.push({
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/hashed-passcode',
        valueString: config.hashedPasscode
      });
    }

    if (config.expirationDate) {
      extensions.push({
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/expiration-date',
        valueDateTime: config.expirationDate.toISOString()
      });
    }

    // Initialize counters
    extensions.push({
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/failed-attempts',
      valueInteger: 0
    });

    extensions.push({
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated',
      valueBoolean: false
    });

    // Create content references from the created DocumentReferences
    const content = documentReferences.map(docRef => ({
      reference: `DocumentReference/${docRef.id}`
    }));

    const manifest: DocumentManifest = {
      resourceType: 'DocumentManifest',
      status: 'current',
      identifier: [{
        system: 'https://kill-the-clipboard.vercel.app/fhir/codesystem/shl-entropy',
        value: entropy
      }],
      created: new Date().toISOString(),
      content: content,
      extension: extensions
    };

    return await this.medplum.createResource(manifest);
  }

  /**
   * Get SHL payload by entropy key
   */
  async getSHL(entropy: string): Promise<any | null> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        return null;
      }

      // Find the SHL payload extension
      const payloadExtension = manifest.extension?.find(
        (ext: Extension) => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-payload'
      );

      if (!payloadExtension?.valueString) {
        return null;
      }

      return JSON.parse(payloadExtension.valueString);
    } catch (error) {
      console.error('Error getting SHL payload:', error);
      return null;
    }
  }

  /**
   * Get manifest builder attributes by entropy key
   */
  async getManifestBuilder(entropy: string): Promise<any | null> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        return null;
      }

      // Find the builder attributes extension
      const builderExtension = manifest.extension?.find(
        (ext: Extension) => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/builder-attrs'
      );

      if (!builderExtension?.valueString) {
        return null;
      }

      return JSON.parse(builderExtension.valueString);
    } catch (error) {
      console.error('Error getting manifest builder attributes:', error);
      return null;
    }
  }

  /**
   * Create a DocumentReference for a manifest file (internal method)
   */
  private async createDocumentReference(
    fileConfig: {
      contentType: string;
      ciphertextLength: number;
      binaryUrl: string;
      lastUpdated?: string;
    }
  ): Promise<DocumentReference> {
    // Map content type to FHIR coding
    const getTypeFromContentType = (contentType: string) => {
      const typeMap: Record<string, { code: string; display: string }> = {
        'application/smart-health-card': {
          code: 'application/smart-health-card',
          display: 'SMART Health Card'
        },
        'application/fhir+json': {
          code: 'application/fhir+json',
          display: 'FHIR Resource'
        },
        'application/smart-api-access': {
          code: 'application/smart-api-access',
          display: 'SMART API Access'
        }
      };

      return typeMap[contentType] || { code: contentType, display: contentType };
    };

    const typeInfo = getTypeFromContentType(fileConfig.contentType);

    const docRef: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [{
          system: 'https://kill-the-clipboard.vercel.app/fhir/codesystem/manifest-file-type',
          code: typeInfo.code,
          display: typeInfo.display
        }]
      },
      date: new Date().toISOString(),
      content: [{
        attachment: {
          contentType: 'application/jose',
          url: fileConfig.binaryUrl
        }
      }],
      extension: [
        {
          url: 'https://kill-the-clipboard.vercel.app/fhir/extension/ciphertext-length',
          valueInteger: fileConfig.ciphertextLength
        },
        {
          url: 'https://kill-the-clipboard.vercel.app/fhir/extension/last-updated',
          valueDateTime: fileConfig.lastUpdated || new Date().toISOString()
        }
      ]
    };

    return await this.medplum.createResource(docRef);
  }

  /**
   * Get stored passcode hash by entropy
   */
  async getStoredPasscode(entropy: string): Promise<string | null> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        return null;
      }

      const passcodeExtension = manifest.extension?.find(
        (ext: Extension) => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/hashed-passcode'
      );

      return passcodeExtension?.valueString || null;
    } catch (error) {
      console.error('Error getting stored passcode:', error);
      return null;
    }
  }

  /**
   * Check if SHL is invalidated
   */
  async isSHLInvalidated(entropy: string): Promise<boolean> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        return true; // Consider non-existent SHLs as invalidated
      }

      const invalidatedExtension = manifest.extension?.find(
        (ext: Extension) => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated'
      );

      return invalidatedExtension?.valueBoolean || false;
    } catch (error) {
      console.error('Error checking SHL invalidation:', error);
      return true;
    }
  }

  /**
   * Increment failed attempts and potentially invalidate SHL
   */
  async incrementFailedAttempts(entropy: string, maxAttempts: number): Promise<{ invalidated: boolean; attempts: number }> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        throw new Error(`DocumentManifest not found for entropy: ${entropy}`);
      }

      // Find and update failed attempts extension
      const extensions = [...(manifest.extension || [])];
      const attemptsIndex = extensions.findIndex(
        ext => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/failed-attempts'
      );

      const currentAttempts = (extensions[attemptsIndex]?.valueInteger || 0) + 1;
      extensions[attemptsIndex] = {
        url: 'https://kill-the-clipboard.vercel.app/fhir/extension/failed-attempts',
        valueInteger: currentAttempts
      };

      const shouldInvalidate = currentAttempts >= maxAttempts;

      // Update invalidation status if needed
      if (shouldInvalidate) {
        const invalidatedIndex = extensions.findIndex(
          ext => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated'
        );

        if (invalidatedIndex >= 0) {
          extensions[invalidatedIndex] = {
            url: 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated',
            valueBoolean: true
          };
        } else {
          extensions.push({
            url: 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated',
            valueBoolean: true
          });
        }
      }

      // Update the resource
      await this.medplum.updateResource({
        ...manifest,
        extension: extensions
      });

      return {
        invalidated: shouldInvalidate,
        attempts: currentAttempts
      };
    } catch (error) {
      console.error('Error incrementing failed attempts:', error);
      throw error;
    }
  }

  /**
   * Create audit event for SHL access
   */
  async recordAccess(
    entropy: string,
    recipientName: string,
    outcome: 'success' | 'failure',
    details?: string
  ): Promise<AuditEvent> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        throw new Error(`DocumentManifest not found for entropy: ${entropy}`);
      }

      const auditEvent: AuditEvent = {
        resourceType: 'AuditEvent',
        type: {
          system: 'http://dicom.nema.org/resources/ontology/DCM',
          code: '110110',
          display: 'Patient Record'
        },
        action: 'R',
        recorded: new Date().toISOString(),
        outcome: outcome === 'success' ? '0' : '4',
        source: {
          observer: {
            display: 'SHL Demo Application'
          }
        },
        agent: [{
          type: {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
              code: 'humanuser'
            }]
          },
          name: recipientName,
          requestor: true
        }],
        entity: [{
          what: {
            reference: `DocumentManifest/${manifest.id}`
          }
        }]
      };

      if (details) {
        auditEvent.entity![0].description = details;
      }

      return await this.medplum.createResource(auditEvent);
    } catch (error) {
      console.error('Error recording access:', error);
      throw error;
    }
  }

  /**
   * Get manifest files for a given SHL
   */
  async getManifestFiles(entropy: string): Promise<DocumentReference[]> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest?.content) {
        return [];
      }

      // Fetch all referenced DocumentReference resources
      const files = await Promise.all(
        manifest.content.map((ref: any) => this.medplum.readReference(ref) as Promise<DocumentReference>)
      );

      return files.filter((file: DocumentReference | null): file is DocumentReference =>
        file !== null
      );
    } catch (error) {
      console.error('Error getting manifest files:', error);
      return [];
    }
  }
}

// Factory function for creating storage with authenticated Medplum client
export function createMedplumStorage(medplum: MedplumClient): MedplumStorage {
  return new MedplumStorage(medplum);
}
