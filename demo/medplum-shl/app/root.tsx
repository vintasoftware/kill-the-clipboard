'use client';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { JSX, ReactNode } from 'react';

const medplum = new MedplumClient({
  baseUrl: process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL!,
  clientId: process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID!,

  // Handle unauthenticated requests
  onUnauthenticated: () => (window.location.href = '/'),

  // Use Next.js fetch
  fetch: (url: string, options?: any) => fetch(url, options),
});

export default function Root(props: { children: ReactNode }): JSX.Element {
  return <MedplumProvider medplum={medplum}>{props.children}</MedplumProvider>;
}
