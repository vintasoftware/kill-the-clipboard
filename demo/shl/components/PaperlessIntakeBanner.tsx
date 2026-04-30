'use client';

import { Anchor, Button, Card, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { IconCalendarEvent } from '@tabler/icons-react';
import { useState } from 'react';
import { InlineWidget } from 'react-calendly';

const CALENDLY_URL = 'https://calendly.com/daniel-pedrosa-/45min';

export function PaperlessIntakeBanner() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <Card
        withBorder
        radius="lg"
        p={{ base: 'lg', sm: 'xl' }}
        shadow="lg"
        style={{
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
        }}
      >
        <Group justify="space-between" align="center" gap="xl">
          <Stack gap="md" style={{ flex: '1 1 32rem' }}>
            <Group gap="sm">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                SMART Health Links Demo
              </Text>
              <Text size="sm" c="dimmed">
                Built with the library{' '}
                <Anchor
                  href="https://github.com/vintasoftware/kill-the-clipboard"
                  target="_blank"
                  rel="noreferrer"
                  fw={700}
                  c="blue.7"
                  underline="never"
                  px="sm"
                  py={4}
                  ml={4}
                  style={{
                    display: 'inline-flex',
                    border: '1px solid var(--mantine-color-blue-1)',
                    borderRadius: 999,
                    backgroundColor: 'var(--mantine-color-blue-0)',
                  }}
                >
                  kill-the-clipboard
                </Anchor>
              </Text>
            </Group>

            <Stack gap="xs">
              <Title order={1} size="h1" style={{ letterSpacing: '-0.03em', fontWeight: 900 }}>
                Bring paperless intake to your product
              </Title>
              <Text size="lg" c="dimmed" maw={760}>
                See how this flow can become a reusable building block for patient intake and structured health data
                sharing.
              </Text>
            </Stack>
          </Stack>

          <Button size="lg" leftSection={<IconCalendarEvent size="1.1rem" />} onClick={() => setIsModalOpen(true)}>
            Book a walkthrough
          </Button>
        </Group>
      </Card>

      <Modal
        opened={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Book a walkthrough"
        size={1100}
        centered
        lockScroll
        removeScrollProps={{ removeScrollBar: true }}
        onWheelCapture={(event) => event.preventDefault()}
        onTouchMoveCapture={(event) => event.preventDefault()}
        styles={{
          root: { overflow: 'hidden' },
          inner: { overflow: 'hidden' },
          body: { overflow: 'visible' },
          content: { overflow: 'visible' },
        }}
      >
        <Stack gap={0} style={{ minHeight: 700, overflow: 'visible' }}>
          <Text size="sm" c="dimmed">
            Pick a time with our team to talk through paperless intake and structured health data sharing.
          </Text>
          <InlineWidget
            url={CALENDLY_URL}
            styles={{
              minHeight: '700px',
              minWidth: '320px',
            }}
            pageSettings={{
              hideGdprBanner: true,
              primaryColor: '2563eb',
            }}
          />
        </Stack>
      </Modal>
    </>
  );
}
