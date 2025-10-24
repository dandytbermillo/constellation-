import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Universal Data Constellation',
  description: 'Your personal data universe organized by context and relationships',
  keywords: 'data visualization, constellation, personal data, interactive',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-slate-900 text-slate-100 antialiased`}>
        {children}
      </body>
    </html>
  );
} 