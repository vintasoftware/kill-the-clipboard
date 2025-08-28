'use client';
import { Card, Title, Text, Stack, Button, Group, CopyButton, Tooltip, Alert, Code, Box } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconQrcode, IconAlertCircle } from '@tabler/icons-react';
import { useState } from 'react';

interface SHLDisplayProps {
  shlUri: string;
  onReset: () => void;
}

export function SHLDisplay({ shlUri, onReset }: SHLDisplayProps) {
  const [showQR, setShowQR] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(shlUri);
    notifications.show({
      title: 'Copied!',
      message: 'Smart Health Link copied to clipboard',
      color: 'green',
    });
  };

  const handleView = () => {
    // Open the SHL viewer in a new tab
    const viewerUrl = `${window.location.origin}/viewer#${shlUri}`;
    window.open(viewerUrl, '_blank');
  };

  return (
    <Card withBorder p="xl">
      <Stack gap="lg">
        <div>
          <Title order={2} mb="xs">
            Smart Health Link Created!
          </Title>
          <Text size="sm" c="dimmed">
            Your health information is now securely accessible via this link.
          </Text>
        </div>

        <Alert icon={<IconAlertCircle size="1rem" />} color="blue">
          Share this link with healthcare providers or others who need access to your health information. They will need
          the passcode you set to view the content.
        </Alert>

        <Box>
          <Text size="sm" fw={500} mb="xs">
            Smart Health Link:
          </Text>
          <Code block>{shlUri}</Code>
        </Box>

        <Group>
          <CopyButton value={shlUri} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy link'} withArrow>
                <Button
                  variant="outline"
                  leftSection={copied ? <IconCheck size="1rem" /> : <IconCopy size="1rem" />}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy Link'}
                </Button>
              </Tooltip>
            )}
          </CopyButton>

          <Button variant="outline" leftSection={<IconQrcode size="1rem" />} onClick={() => setShowQR(!showQR)}>
            {showQR ? 'Hide QR Code' : 'Show QR Code'}
          </Button>

          <Button onClick={handleView}>View Health Information</Button>
        </Group>

        {showQR && (
          <Box ta="center">
            <Text size="sm" c="dimmed" mb="md">
              Scan this QR code to access your health information
            </Text>
            {/* TODO: Add QR code generation using a library like qrcode.react */}
            <Box
              style={{
                width: 200,
                height: 200,
                border: '1px solid #ddd',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f8f9fa',
              }}
            >
              <Text size="sm" c="dimmed">
                QR Code Placeholder
              </Text>
            </Box>
          </Box>
        )}

        <Group justify="center">
          <Button variant="outline" onClick={onReset}>
            Create Another Link
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
