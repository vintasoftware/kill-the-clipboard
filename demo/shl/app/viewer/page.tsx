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

  console.log('qrCodesByCard', qrCodesByCard);

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

        console.log('viewing', uri);
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
          const allQrCodes = await Promise.all(content.smartHealthCards.map((card) => (card as any).asQR()));
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

  const renderFHIRResource = (resource: any, index: number) => {
    // If a Bundle, render a friendly summary plus raw JSON
    if (resource.resourceType === 'Bundle') {
      const entries = Array.isArray(resource.entry) ? resource.entry : [];
      const getResources = (type: string) =>
        entries.map((e: any) => e.resource).filter((r: any) => r?.resourceType === type);
      const patient = getResources('Patient')[0];
      const allergies = getResources('AllergyIntolerance');
      const conditions = getResources('Condition');
      const medications = getResources('MedicationRequest');
      const observations = getResources('Observation');

      return (
        <Card key={`bundle-${index}`} withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Text fw={500}>Bundle</Text>
            <Badge variant="light">{resource.id || 'No ID'}</Badge>
          </Group>

          {patient && (
            <Stack gap="xs" mb="sm">
              <Text fw={500}>Patient</Text>
              <Text size="sm">
                <strong>Name:</strong> {patient.name?.[0]?.given?.join(' ')} {patient.name?.[0]?.family}
              </Text>
              <Text size="sm">
                <strong>Birth Date:</strong> {patient.birthDate || 'Not specified'}
              </Text>
              <Text size="sm">
                <strong>Gender:</strong> {patient.gender || 'Not specified'}
              </Text>
            </Stack>
          )}

          <Divider my="sm" />

          <Stack gap="sm">
            <Text fw={500}>Summary</Text>
            <List size="sm">
              <List.Item>Allergies: {allergies.length}</List.Item>
              <List.Item>Conditions: {conditions.length}</List.Item>
              <List.Item>Medications: {medications.length}</List.Item>
              <List.Item>Observations: {observations.length}</List.Item>
            </List>
          </Stack>

          {allergies.length > 0 && (
            <Stack gap="xs" mt="sm">
              <Text fw={500}>Allergies</Text>
              {allergies.slice(0, 5).map((a: any, i: number) => (
                <Text key={`allergy-${i}`} size="sm">
                  {a.code?.text || a.code?.coding?.[0]?.display || 'Unnamed allergy'}
                  {a.clinicalStatus?.text ? ` • ${a.clinicalStatus.text}` : ''}
                </Text>
              ))}
            </Stack>
          )}

          {conditions.length > 0 && (
            <Stack gap="xs" mt="sm">
              <Text fw={500}>Conditions</Text>
              {conditions.slice(0, 5).map((c: any, i: number) => (
                <Text key={`condition-${i}`} size="sm">
                  {c.code?.text || c.code?.coding?.[0]?.display || 'Unnamed condition'}
                </Text>
              ))}
            </Stack>
          )}

          {medications.length > 0 && (
            <Stack gap="xs" mt="sm">
              <Text fw={500}>Medications</Text>
              {medications.slice(0, 5).map((m: any, i: number) => (
                <Text key={`med-${i}`} size="sm">
                  {m.medicationCodeableConcept?.text ||
                    m.medicationCodeableConcept?.coding?.[0]?.display ||
                    'Medication'}
                </Text>
              ))}
            </Stack>
          )}

          {observations.length > 0 && (
            <Stack gap="xs" mt="sm">
              <Text fw={500}>Recent Observations</Text>
              {observations.slice(0, 5).map((o: any, i: number) => (
                <Text key={`obs-${i}`} size="sm">
                  {(o.code?.text || o.code?.coding?.[0]?.display || 'Observation') +
                    (o.valueQuantity ? `: ${o.valueQuantity.value} ${o.valueQuantity.unit || ''}` : '')}
                  {o.effectiveDateTime ? ` • ${o.effectiveDateTime}` : ''}
                </Text>
              ))}
            </Stack>
          )}

          <details>
            <summary style={{ cursor: 'pointer', marginTop: '8px' }}>
              <Text size="sm" c="dimmed">
                View raw data
              </Text>
            </summary>
            <Code block mt="xs">
              {JSON.stringify(resource, null, 2)}
            </Code>
          </details>
        </Card>
      );
    }

    return (
      <Card key={index} withBorder p="md">
        <Group justify="space-between" mb="xs">
          <Text fw={500}>{resource.resourceType}</Text>
          <Badge variant="light">{resource.id || 'No ID'}</Badge>
        </Group>

        {resource.resourceType === 'Patient' && (
          <Stack gap="xs">
            <Text size="sm">
              <strong>Name:</strong> {resource.name?.[0]?.given?.join(' ')} {resource.name?.[0]?.family}
            </Text>
            <Text size="sm">
              <strong>Birth Date:</strong> {resource.birthDate || 'Not specified'}
            </Text>
            <Text size="sm">
              <strong>Gender:</strong> {resource.gender || 'Not specified'}
            </Text>
          </Stack>
        )}

        {resource.resourceType === 'Observation' && (
          <Stack gap="xs">
            <Text size="sm">
              <strong>Code:</strong> {resource.code?.text || resource.code?.coding?.[0]?.display || 'Not specified'}
            </Text>
            <Text size="sm">
              <strong>Value:</strong>{' '}
              {resource.valueQuantity
                ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit}`
                : resource.valueString || resource.valueCodeableConcept?.text || 'Not specified'}
            </Text>
            <Text size="sm">
              <strong>Date:</strong> {resource.effectiveDateTime || 'Not specified'}
            </Text>
          </Stack>
        )}

        <details>
          <summary style={{ cursor: 'pointer', marginTop: '8px' }}>
            <Text size="sm" c="dimmed">
              View raw data
            </Text>
          </summary>
          <Code block mt="xs">
            {JSON.stringify(resource, null, 2)}
          </Code>
        </details>
      </Card>
    );
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
                  Successfully retrieved {resolvedContent.fhirResources.length} FHIR resources
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
                    {resolvedContent.fhirResources.map((resource, index) => renderFHIRResource(resource, index))}
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
                            {(card as any).asJWS()}
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
