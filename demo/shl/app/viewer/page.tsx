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
  Badge,
  Divider,
  List,
  Image,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { SHLViewer, SHLResolvedContent } from 'kill-the-clipboard';
import { buildMedplumFetch } from '@/lib/medplum-fetch';
import { useState, useEffect, useCallback } from 'react';
import { IconAlertCircle, IconCheck, IconX } from '@tabler/icons-react';
import { useMedplum } from '@medplum/react';
import { PatientDataBundleDisplay } from '@/components/PatientDataBundleDisplay';
import { Bundle } from '@medplum/fhirtypes';

interface ViewerFormValues {
  recipient: string;
  passcode: string;
}

export default function ViewerPage() {
  const medplum = useMedplum();
  const [shlUri, setShlUri] = useState<string>('');
  const [shlViewer, setShlViewer] = useState<SHLViewer | null>(null);
  const [resolvedContent, setResolvedContent] = useState<SHLResolvedContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'uri' | 'credentials' | 'content'>('uri');
  const [qrCodesByCard, setQrCodesByCard] = useState<string[][]>([]);

  const form = useForm<ViewerFormValues>({
    initialValues: {
      recipient: 'Flavio',
      passcode: '123456',
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

  const handleParseUri = useCallback(
    (uri: string) => {
      try {
        // Get the access token from Medplum client
        const accessToken = medplum.getAccessToken();
        if (!accessToken) {
          throw new Error('No access token available. Please sign in again.');
        }

        const viewer = new SHLViewer({
          shlinkURI: uri,
          // Provide Medplum-authenticated fetch
          fetch: buildMedplumFetch(medplum),
        });
        setShlViewer(viewer);
        setStep('credentials');
      } catch (error) {
        notifications.show({
          title: 'Invalid SHL URI',
          message: error instanceof Error ? error.message : 'Failed to parse Smart Health Link',
          color: 'red',
        });
      }
    },
    [medplum]
  );

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
    if (!values.shlUri) {
      notifications.show({
        title: 'Error',
        message: 'Please enter a Smart Health Link URI',
        color: 'red',
      });
      return;
    }
    setShlUri(values.shlUri);
    handleParseUri(values.shlUri);
  };

  const handleResolve = async (values: ViewerFormValues) => {
    if (!shlViewer) return;

    setIsLoading(true);
    try {
      const content = await shlViewer.resolveSHLink({
        recipient: values.recipient,
        passcode: shlViewer.shl.requiresPasscode ? values.passcode : undefined,
        embeddedLengthMax: 4096,
        shcReaderConfig: {
          publicKey: process.env.NEXT_PUBLIC_SHC_PUBLIC_KEY!,
        },
      });

      setResolvedContent(content);
      setStep('content');
      notifications.show({
        title: 'Success!',
        message: 'Smart Health Link resolved successfully',
        color: 'green',
      });

      // Generate QR codes for any Smart Health Cards present
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
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to resolve Smart Health Link',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setShlUri('');
    setShlViewer(null);
    setResolvedContent(null);
    setStep('uri');
    form.reset();
    window.location.hash = '';
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={1} mb="md">
            Smart Health Link Viewer
          </Title>
          <Text size="lg" c="dimmed">
            View and access health information from Smart Health Links
          </Text>
        </div>

        {step === 'uri' && (
          <Card withBorder p="xl">
            <Stack gap="lg">
              <div>
                <Text size="lg" fw={500} mb="xs">
                  Enter Smart Health Link
                </Text>
                <Text size="sm" c="dimmed">
                  Paste the Smart Health Link URI you received
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
                    label="Smart Health Link URI"
                    placeholder="shlink:/..."
                    value={shlUri}
                    onChange={(e) => setShlUri(e.currentTarget.value)}
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

              <form onSubmit={form.onSubmit(handleResolve)}>
                <Stack gap="md">
                  <TextInput
                    label="Your Name"
                    description="Enter your name as the recipient of this health information"
                    placeholder="John Doe"
                    required
                    {...form.getInputProps('recipient')}
                  />

                  {shlViewer.shl.requiresPasscode && (
                    <PasswordInput
                      label="Passcode"
                      description="Enter the passcode provided with this Smart Health Link"
                      placeholder="Enter passcode"
                      required
                      {...form.getInputProps('passcode')}
                    />
                  )}

                  <Group justify="space-between">
                    <Button variant="outline" onClick={handleReset}>
                      Back
                    </Button>
                    <Button type="submit" loading={isLoading}>
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
                    ` and ${resolvedContent.smartHealthCards.length} Smart Health Card(s)`}
                </Text>

                <Group>
                  <Button variant="outline" onClick={handleReset}>
                    View Another Link
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
                  <Title order={3}>Smart Health Cards</Title>
                  <Stack gap="md">
                    {resolvedContent.smartHealthCards.map((card, index) => (
                      <Card key={index} withBorder p="md">
                        <Text fw={500} mb="xs">
                          Smart Health Card #{index + 1}
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
                        <details>
                          <summary style={{ cursor: 'pointer' }}>
                            <Text size="sm" c="dimmed">
                              View JWS token
                            </Text>
                          </summary>
                          <Code block mt="xs">
                            {card.asJWS()}
                          </Code>
                        </details>
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
