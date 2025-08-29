// biome-ignore-all lint/suspicious/noExplicitAny: Tests use `any` for validation scenarios
import type { Bundle } from '@medplum/fhirtypes'
import { PNG } from 'pngjs'
import decodeQR from 'qr/decode.js'
import type { FHIRBundle } from '@/index'

export const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

export const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

export const createValidFHIRBundle = (): FHIRBundle => ({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'https://example.com/base/Patient/123',
      resource: {
        resourceType: 'Patient',
        id: '123',
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1990-01-01',
      },
    },
    {
      fullUrl: 'https://example.com/base/Immunization/456',
      resource: {
        resourceType: 'Immunization',
        id: '456',
        status: 'completed',
        vaccineCode: {
          coding: [
            {
              system: 'http://hl7.org/fhir/sid/cvx',
              code: '207',
              display: 'COVID-19 vaccine',
            },
          ],
        },
        patient: { reference: 'Patient/123' },
        occurrenceDateTime: '2023-01-15',
      },
    },
  ],
})

export const createInvalidBundle = (): Bundle => ({
  resourceType: 'Patient' as any, // Wrong resource type
  id: '123',
  type: 'collection' as any,
})

/**
 * Helper function to decode QR code from data URL for testing purposes.
 * Uses the 'qr' package to validate generated QR codes by reading them back.
 */
export function decodeQRFromDataURL(dataURL: string): string | null {
  try {
    // Extract base64 data from data URL
    const base64Data = dataURL.replace(/^data:image\/png;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')

    // Parse PNG to get RGBA data
    const png = PNG.sync.read(imageBuffer)

    // The qr package expects { width, height, data } where data is RGBA bytes
    const image = {
      width: png.width,
      height: png.height,
      data: png.data, // Already RGBA format from pngjs
    }

    // Decode the QR code
    const result = decodeQR(image)
    return result || null
  } catch (error) {
    console.warn('QR decode error:', error)
    return null
  }
}
