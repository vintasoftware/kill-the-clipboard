import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import type { Metadata } from 'next';
import { JSX, ReactNode } from 'react';
import Root from './root';
import { theme } from './theme';
import { Notifications } from '@mantine/notifications';

export const metadata: Metadata = {
  title: 'SHL Demo - Smart Health Links',
  description: 'Demo application for Smart Health Links using Medplum and Next.js',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout(props: { children: ReactNode }): JSX.Element {
  const { children } = props;

  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
        <link rel="shortcut icon" href="/favicon.svg" />
        <meta name="viewport" content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no" />
      </head>
      <body>
        <MantineProvider theme={theme}>
          <Notifications />
          <Root>{children}</Root>
        </MantineProvider>
      </body>
    </html>
  );
}
