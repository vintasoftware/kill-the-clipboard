'use client';
import {
  Container,
  Title,
  Text,
  Stack,
  Button,
  Card,
  Alert,
  TextInput,
  PasswordInput,
  LoadingOverlay,
  Group,
  Code,
  Image,
  Collapse,
  Box,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { SHLViewer, SHLResolvedContent } from 'kill-the-clipboard';
import { useState, useEffect, useCallback } from 'react';
import { IconAlertCircle, IconCheck, IconX, IconExternalLink } from '@tabler/icons-react';
import { PatientDataBundleDisplay } from '@/components/PatientIPSControl';
import type { Bundle } from '@medplum/fhirtypes';

interface ViewerFormValues {
  recipient: string;
  passcode: string;
}

export default function ViewerPage() {
  const [shlUri, setShlUri] = useState<string>('');
  const [shlViewer, setShlViewer] = useState<SHLViewer | null>(null);
  const [resolvedContent, setResolvedContent] = useState<SHLResolvedContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'uri' | 'credentials' | 'content'>('uri');
  const [qrCodesByCard, setQrCodesByCard] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isInvalidated, setIsInvalidated] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const toggleCardExpansion = (cardIndex: number) => {
    setExpandedCards((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(cardIndex)) {
        newSet.delete(cardIndex);
      } else {
        newSet.add(cardIndex);
      }
      return newSet;
    });
  };

  const form = useForm<ViewerFormValues>({
    initialValues: {
      recipient: '',
      passcode: '',
    },
    validate: {
      recipient: (value) => (!value ? 'Recipient name is required' : null),
      passcode: (value, values, path) => {
        if (shlViewer?.shl.requiresPasscode && !value) {
          return 'Passcode is required';
        }
        return null;
      },
    },
  });

  const handleParseUri = useCallback((uri: string) => {
    setError(null);
    setIsInvalidated(false);
    try {
      const shlURI = uri.trim();
      const viewer = new SHLViewer({
        shlinkURI: shlURI,
      });
      setShlViewer(viewer);
      setStep('credentials');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse SMART Health Link';
      setError(errorMessage);
    }
  }, []);

  // Parse SHL URI from URL hash on component mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#shlink:/')) {
      const uri = hash.substring(1); // Remove the # prefix
      setShlUri(uri);
      handleParseUri(uri);
    }
  }, [handleParseUri]);

  const handleUriSubmit = (values: { shlUri: string }) => {
    const shlURI = values.shlUri?.trim();
    if (!shlURI) {
      const errorMessage = 'Please enter a SMART Health Link URI';
      setError(errorMessage);
      return;
    }
    setShlUri(shlURI);
    handleParseUri(shlURI);
  };

  const handleResolve = async (values: ViewerFormValues) => {
    if (!shlViewer) return;

    setIsLoading(true);
    setError(null);
    try {
      const content = await shlViewer.resolveSHL({
        recipient: values.recipient.trim(),
        passcode: shlViewer.shl.requiresPasscode ? values.passcode : undefined,
        embeddedLengthMax: 4096,
      });

      setResolvedContent(content);
      setStep('content');

      // Generate QR codes for any SMART Health Cards present
      if (content.smartHealthCards?.length) {
        try {
          const allQrCodes = await Promise.all(
            content.smartHealthCards.map((card) =>
              card.asQR({
                enableChunking: true,
              })
            )
          );
          setQrCodesByCard(allQrCodes);
        } catch (qrError) {
          console.warn('Failed to generate QR codes for SHC:', qrError);
          setQrCodesByCard([]);
        }
      } else {
        setQrCodesByCard([]);
      }
    } catch (error) {
      console.error('Error resolving SHL:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to resolve SMART Health Link';

      let userFriendlyMessage = errorMessage;
      let isLinkInvalidated = false;

      if (errorMessage.includes('passcode') || errorMessage.includes('unauthorized') || errorMessage.includes('403')) {
        userFriendlyMessage = 'Invalid passcode. Please check the passcode and try again.';
      } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        userFriendlyMessage =
          'This SMART Health Link has not been found. It may have been invalidated or expired. Please contact the person who shared this link to get a new one.';
        isLinkInvalidated = true;
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        userFriendlyMessage = 'Network error. Please check your connection and try again.';
      }

      setError(userFriendlyMessage);
      setIsInvalidated(isLinkInvalidated);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setShlUri('');
    setShlViewer(null);
    setResolvedContent(null);
    setQrCodesByCard([]);
    setError(null);
    setIsInvalidated(false);
    setIsLoading(false);
    setStep('uri');
    form.reset();
    window.location.hash = '';
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={1} mb="md">
            SMART Health Link Viewer
          </Title>
          <Text size="lg" c="dimmed">
            View and access health information from SMART Health Links
          </Text>
        </div>

        {step === 'uri' && (
          <Card withBorder p="xl">
            <Stack gap="lg">
              <div>
                <Text size="lg" fw={500} mb="xs">
                  Enter SMART Health Link
                </Text>
                <Text size="sm" c="dimmed">
                  Paste the SMART Health Link URI you received
                </Text>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target as HTMLFormElement);
                  handleUriSubmit({ shlUri: formData.get('shlUri') as string });
                }}
              >
                <Stack gap="md">
                  <TextInput
                    name="shlUri"
                    label="SMART Health Link URI"
                    placeholder="shlink:/..."
                    autoComplete="off"
                    value={shlUri}
                    onChange={(e) => {
                      setShlUri(e.currentTarget.value);
                      // Clear error and invalidated state when user starts typing
                      if (error) setError(null);
                      if (isInvalidated) setIsInvalidated(false);
                    }}
                    error={error}
                    required
                  />
                  <Button type="submit">Parse Link</Button>
                </Stack>
              </form>
            </Stack>
          </Card>
        )}

        {step === 'credentials' && shlViewer && (
          <Card withBorder p="xl" pos="relative">
            <LoadingOverlay visible={isLoading} />
            <Stack gap="lg">
              <div>
                <Text size="lg" fw={500} mb="xs">
                  Access Health Information
                </Text>
                <Text size="sm" c="dimmed">
                  Provide your information to access the health data
                </Text>
              </div>

              <Alert icon={<IconAlertCircle size="1rem" />} color="blue">
                <Stack gap="xs">
                  <Text size="sm">
                    <strong>Link Information:</strong>
                  </Text>
                  {shlViewer.shl.label && <Text size="sm">• Label: {shlViewer.shl.label}</Text>}
                  <Text size="sm">
                    • Requires passcode:{' '}
                    {shlViewer.shl.requiresPasscode ? (
                      <IconCheck size="1rem" color="green" />
                    ) : (
                      <IconX size="1rem" color="red" />
                    )}
                  </Text>
                  <Text size="sm">
                    • Long-term link:{' '}
                    {shlViewer.shl.isLongTerm ? (
                      <IconCheck size="1rem" color="green" />
                    ) : (
                      <IconX size="1rem" color="red" />
                    )}
                  </Text>
                  {shlViewer.shl.expirationDate && (
                    <Text size="sm">• Expires: {shlViewer.shl.expirationDate.toLocaleString()}</Text>
                  )}
                </Stack>
              </Alert>

              {error && (
                <Alert
                  icon={<IconAlertCircle size="1rem" />}
                  color={isInvalidated ? 'orange' : 'red'}
                  mb="md"
                  title={isInvalidated ? 'SMART Health Link Not Found' : 'Error'}
                >
                  {error}
                  {isInvalidated && (
                    <Text size="sm" mt="xs" c="dimmed">
                      You will need to request a new SMART Health Link from the original sender.
                    </Text>
                  )}
                </Alert>
              )}

              <form onSubmit={form.onSubmit(handleResolve)}>
                <Stack gap="md">
                  <TextInput
                    label="Your Name"
                    description="Enter your name as the recipient of this health information"
                    placeholder="e.g. John Doe"
                    autoComplete="off"
                    required
                    disabled={isLoading || isInvalidated}
                    {...form.getInputProps('recipient')}
                  />

                  {shlViewer.shl.requiresPasscode && (
                    <PasswordInput
                      label="Passcode"
                      description={
                        isInvalidated
                          ? 'This SMART Health Link has been disabled'
                          : 'Enter the passcode provided with this SMART Health Link'
                      }
                      placeholder="Enter passcode"
                      required
                      disabled={isLoading || isInvalidated}
                      {...form.getInputProps('passcode')}
                    />
                  )}

                  <Group justify="space-between">
                    <Button variant="outline" onClick={handleReset} disabled={isLoading}>
                      Back
                    </Button>
                    <Button type="submit" loading={isLoading} disabled={isLoading || isInvalidated}>
                      Access Health Information
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Stack>
          </Card>
        )}

        {step === 'content' && resolvedContent && (
          <Stack gap="lg">
            <Card withBorder p="xl">
              <Stack gap="md">
                <Title order={2}>Health Information</Title>
                <Text c="dimmed">
                  Successfully retrieved {resolvedContent.fhirResources.length} FHIR resource(s)
                  {resolvedContent.smartHealthCards.length > 0 &&
                    ` and ${resolvedContent.smartHealthCards.length} SMART Health Card(s)`}
                </Text>

                <Group>
                  <Button variant="outline" onClick={handleReset}>
                    View Another Link
                  </Button>
                  <Button
                    variant="outline"
                    leftSection={<IconExternalLink size="1rem" />}
                    onClick={() => window.open(`https://viewer.tcpdev.org/#${shlUri}`, '_blank')}
                  >
                    View on TCP web reader
                  </Button>
                </Group>
              </Stack>
            </Card>

            {resolvedContent.fhirResources.length > 0 && (
              <Card withBorder p="xl">
                <Stack gap="md">
                  <Title order={3}>FHIR Resources</Title>
                  <Stack gap="md">
                    {resolvedContent.fhirResources.map((resource, index) => (
                      <PatientDataBundleDisplay key={index} bundle={resource as Bundle} />
                    ))}
                  </Stack>
                </Stack>
              </Card>
            )}

            {resolvedContent.smartHealthCards.length > 0 && (
              <Card withBorder p="xl">
                <Stack gap="md">
                  <Title order={3}>SMART Health Cards</Title>
                  <Stack gap="md">
                    {resolvedContent.smartHealthCards.map((card, index) => (
                      <Card key={index} withBorder p="md">
                        <Text fw={500} mb="xs">
                          SMART Health Card #{index + 1}
                        </Text>
                        {qrCodesByCard[index]?.length ? (
                          <Stack gap="xs" mb="sm">
                            <Text size="sm" c="dimmed">
                              QR Code{qrCodesByCard[index].length > 1 ? 's' : ''} (scan to import)
                            </Text>
                            <Group>
                              {qrCodesByCard[index].map((dataUrl, i) => (
                                <Image
                                  key={`qr-${index}-${i}`}
                                  src={dataUrl}
                                  alt={`SHC QR ${i + 1}`}
                                  w={180}
                                  h={180}
                                  fit="contain"
                                  radius="md"
                                />
                              ))}
                            </Group>
                          </Stack>
                        ) : (
                          <Text size="sm" c="dimmed">
                            Generating QR code...
                          </Text>
                        )}
                        <Box>
                          <Button size="xs" variant="outline" onClick={() => toggleCardExpansion(index)}>
                            View card as JWS
                          </Button>
                          <Collapse in={expandedCards.has(index)}>
                            <Code block mt="xs">
                              {card.asJWS()}
                            </Code>
                          </Collapse>
                        </Box>
                      </Card>
                    ))}
                  </Stack>
                </Stack>
              </Card>
            )}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
