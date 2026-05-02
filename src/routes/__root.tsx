import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-display text-8xl font-bold text-emerald">404</div>
        <h2 className="mt-4 font-display text-2xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That page is not in our syllabus.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald px-5 py-2.5 text-sm font-medium text-emerald-foreground hover:bg-emerald/90 transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sapientia — AI Study Companion for WAEC & JAMB" },
      {
        name: "description",
        content:
          "Adaptive AI tutor, mock exams and performance tracking for WAEC and JAMB. Learn deeply — don't memorise.",
      },
      { name: "author", content: "Sapientia" },
      { property: "og:title", content: "Sapientia — AI Study Companion for WAEC & JAMB" },
      {
        property: "og:description",
        content:
          "Adaptive AI tutor, mock exams and performance tracking. You own your learning history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Sapientia — AI Study Companion for WAEC & JAMB" },
      { name: "description", content: "Sapientia is an adaptive AI study companion that teaches you how to think — not just what to write. Mock exams, personalised tutoring, and a clear view of where" },
      { property: "og:description", content: "Sapientia is an adaptive AI study companion that teaches you how to think — not just what to write. Mock exams, personalised tutoring, and a clear view of where" },
      { name: "twitter:description", content: "Sapientia is an adaptive AI study companion that teaches you how to think — not just what to write. Mock exams, personalised tutoring, and a clear view of where" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5f0a3995-8bfd-44b5-b28c-c769f37a1113" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5f0a3995-8bfd-44b5-b28c-c769f37a1113" },
      { name: "theme-color", content: "#0f6b46" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Sapientia" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors position="top-center" />
    </AuthProvider>
  );
}
