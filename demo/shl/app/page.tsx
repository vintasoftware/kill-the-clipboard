'use client';
import { Container, Title, Text, Stack, Button, Group } from '@mantine/core';
import { SignInForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { Suspense, useState } from 'react';
import { CreateSHLForm } from '@/components/CreateSHLForm';
import { SHLDisplay } from '@/components/SHLDisplay';

// Medplum can autodetect Google Client ID from origin, but only if using window.location.host.
// Because window.location.host is not available on the server, we must use a constant value.
// This is a pre-defined Google Client ID for localhost:3000.
// You will need to register your own Google Client ID for your own domain.
const googleClientId = '921088377005-3j1sa10vr6hj86jgmdfh2l53v3mp7lfi.apps.googleusercontent.com';

export default function HomePage() {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [isCreating, setIsCreating] = useState(false);
  const [createdSHL, setCreatedSHL] = useState<string | null>(null);

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

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={1} mb="md">
            Smart Health Links Demo
          </Title>
          <Text size="lg" c="dimmed">
            Create and share your health information using Smart Health Links
          </Text>
        </div>

        {!profile && (
          <div>
            <Text mb="md">Please sign in to create Smart Health Links with your health data.</Text>
            <SignInForm googleClientId={googleClientId}>Sign in</SignInForm>
          </div>
        )}

        {profile && (
          <Suspense fallback={<div>Loading...</div>}>
            <div>
              <Text mb="md">
                Welcome, {profile.name?.[0]?.given?.[0]} {profile.name?.[0]?.family}!
              </Text>
              <Group mb="md">
                <Button variant="outline" onClick={() => medplum.signOut()}>
                  Sign out
                </Button>
              </Group>
            </div>

            {!isCreating && !createdSHL && (
              <Group>
                <Button size="lg" onClick={handleCreateSHL}>
                  Create Smart Health Link
                </Button>
              </Group>
            )}

            {isCreating && <CreateSHLForm onSHLCreated={handleSHLCreated} onCancel={() => setIsCreating(false)} />}

            {createdSHL && <SHLDisplay shlUri={createdSHL} onReset={handleReset} />}
          </Suspense>
        )}
      </Stack>
    </Container>
  );
}
