import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Media Detector',
  description: 'Detect and download media from YouTube',
}

// Set the theme before first paint so there is no light/dark flash on load.
const themeScript = `(function(){try{var m=localStorage.getItem('theme-mode');if(m!=='light'&&m!=='dark'){m=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=m;}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  )
}
