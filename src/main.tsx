/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import 'src/index.css'
import 'src/scrollbar.css'
import VConsole from 'vconsole'

import { mobileConsole } from 'config'
import LocationProvider from 'src/_components/LocationProvider'
import enJson from "src/_locales/en.json"

import { AvatarProvider } from './_components/AvatarProvider'
import ErrorPage from './_components/ErrorPage';
import { MenuHandlerProvider } from './_components/MenuHandler'
import TemplateProvider from './_components/TemplateProvider'
import { TranslationProvider } from './_components/TranslationProvider'
import { initializeSentry, SentryErrorBoundary } from './_functions/sentry'
import { SessionProvider } from './_providers/SessionProvider'
import { SocketStatusProvider } from './_providers/socketStatusProvider'

import type { Template } from './_components/TemplateProvider'

initializeSentry();

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

interface PageModule {
  default: React.ComponentType<PageProps>;
  template?: Template;
}

// Wrapper to inject Next.js-style params and searchParams as props
const PageWrapper = ({ Page }: { Page: React.ComponentType<PageProps> }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const searchParamsObj = Object.fromEntries(searchParams);

  return <Page params={params} searchParams={searchParamsObj} />;
};

const getRoutes = (pages: Record<string, PageModule>) => {
  const routes = [];
  for (const path in pages) {
    const module = pages[path];

    const pathSegments = path.split('/');
    if (pathSegments.some(segment => segment.startsWith('_'))) continue;

    const normalizedPath = path.replace(/^\.\//, '').replace(/\.tsx$/, '').toLowerCase();
    const routePath = normalizedPath === '' ? '/' : normalizedPath;
    const subPath = routePath.endsWith('/page')
      ? routePath.slice(0, -5)
      : (routePath.endsWith('page')
        ? '/'
        : false);
    if (!subPath) continue;

    // Convert [param] to :param for React Router v6+
    // eslint-disable-next-line unicorn/prefer-string-replace-all
    const finalPath = subPath.replace(/\[([^\]]+)\]/g, ':$1');

    const template = module.template ?? 'plain';
    const Page = module.default;

    routes.push({
      path: finalPath,
      element: (
        <TemplateProvider key={`${template}-${subPath}`} initialTemplate={template}>
          <PageWrapper Page={Page} />
        </TemplateProvider>
      ),
    });
  }

  return routes;
};

const prodPages = import.meta.glob([
  './**/*.tsx',
  './**/*.jsx',
  '!./docs/**',
  '!./**/docs/page.tsx',
  '!./**/_api/**',
  '!./**/_sync/**',
  '!./**/server/**',
  '!./**/_server/**',
  '!./**/docs/**',
  '!./**/*_server.tsx',
  '!./**/*_server.jsx'
], { eager: true });

const devPages = import.meta.glob([
  './**/*.tsx',
  './**/*.jsx'
], { eager: true });

const pagesUnknown = import.meta.env.PROD ? prodPages : devPages;

const pages: Record<string, PageModule> = pagesUnknown as Record<string, PageModule>;

const router = createBrowserRouter([{
  path: '/',
  element: <LocationProvider />,
  errorElement: <ErrorPage />,
  children: getRoutes(pages)
}])

if (mobileConsole) { new VConsole(); }

const ErrorFallback = () => {
  const title = enJson.common['404'];
  const message = enJson.api.internalServerError;
  const btnText = "Refresh Page";

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>
      <p className="text-muted-foreground mb-4">{message}</p>
      <button
        onClick={() => { globalThis.location.reload(); }}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
      >
        {btnText}
      </button>
    </div>
  );
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <div className='w-full h-safe m-0 p-0 overflow-hidden'>
        <Toaster richColors />
        <SocketStatusProvider>
          <SessionProvider>
            <TranslationProvider>
              <AvatarProvider>
                <MenuHandlerProvider>
                  <RouterProvider router={router} />
                </MenuHandlerProvider>
              </AvatarProvider>
            </TranslationProvider>
          </SessionProvider>
        </SocketStatusProvider>
      </div>
    </SentryErrorBoundary>
  );
}