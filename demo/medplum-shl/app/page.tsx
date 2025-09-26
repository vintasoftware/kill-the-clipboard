'use client';
import { Container, Title, Text, Stack, Button, Group, Loader, Box } from '@mantine/core';
import { SignInForm, useMedplumContext } from '@medplum/react';
import { Suspense, useEffect, useState } from 'react';
import { CreateSHLForm } from '@/components/CreateSHLForm';
import { SHLDisplay } from '@/components/SHLDisplay';
import { PatientDataManager } from '@/components/PatientDataManager';
import { RegisterForm } from '@/components/RegisterForm';

export default function HomePage() {
  const { medplum, loading: medplumLoading, profile } = useMedplumContext();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (medplum && !medplumLoading) {
      setIsLoading(false);
    }
  }, [medplum, medplumLoading]);

  const [isCreating, setIsCreating] = useState(false);
  const [createdSHL, setCreatedSHL] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const handleCreateSHL = () => {
    setIsCreating(true);
  };

  const handleSHLCreated = (shlUri: string) => {
    setCreatedSHL(shlUri);
    setIsCreating(false);
  };

  const handleReset = () => {
    setCreatedSHL(null);
    setIsCreating(false);
  };

  const handleRegistrationSuccess = () => {
    setShowRegister(false);
    // The page will automatically refresh to show the authenticated state
  };

  const handleShowRegister = () => {
    setShowRegister(true);
  };

  const handleShowSignIn = () => {
    setShowRegister(false);
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Stack gap="sm">
          <Title order={1}>SMART Health Links Demo</Title>
          <Text size="lg" c="dimmed">
            Create and share your health information using SMART Health Links
          </Text>
        </Stack>

        {isLoading && <Loader size="lg" />}

        {!profile && !isLoading && (
          <Stack gap="xs">
            {!showRegister ? (
              <Stack gap="xs">
                <Text>Please sign in to create SMART Health Links with your health data.</Text>
                <Stack gap={0}>
                  <Box w="100%">
                    <SignInForm>Sign in</SignInForm>
                  </Box>
                  <Group justify="center">
                    <Text size="sm" c="dimmed">
                      Don&apos;t have an account?{' '}
                      <Button variant="subtle" size="compact-sm" onClick={handleShowRegister}>
                        Register here
                      </Button>
                    </Text>
                  </Group>
                </Stack>
              </Stack>
            ) : (
              <RegisterForm onSuccess={handleRegistrationSuccess} onCancel={handleShowSignIn} />
            )}
          </Stack>
        )}

        {profile && (
          <Suspense fallback={<Text>Loading...</Text>}>
            <Stack gap="xs">
              <Text>
                Welcome, {profile.name?.[0]?.given?.[0]} {profile.name?.[0]?.family}!
              </Text>
              <Group>
                <Button size="xs" variant="outline" onClick={() => medplum.signOut()}>
                  Sign out
                </Button>
              </Group>
            </Stack>

            {!isCreating && !createdSHL && (
              <Stack gap="lg">
                <PatientDataManager title="Your Health Information" />
                <Group>
                  <Button size="lg" onClick={handleCreateSHL}>
                    Create SMART Health Link
                  </Button>
                </Group>
              </Stack>
            )}

            {isCreating && <CreateSHLForm onSHLCreated={handleSHLCreated} onCancel={() => setIsCreating(false)} />}

            {createdSHL && <SHLDisplay shlUri={createdSHL} onReset={handleReset} />}
          </Suspense>
        )}
      </Stack>
    </Container>
  );
}
