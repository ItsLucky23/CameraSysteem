import { faGear, faHome } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import config, { dev, loginRedirectUrl } from "config";
import Middleware from 'src/_components/Middleware';
import Navbar from "src/_components/Navbar";
import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import { apiRequest } from 'src/_sockets/apiRequest';

import { useSession } from '../_providers/SessionProvider';

import Avatar from './Avatar';
import { ConfirmMenu } from './ConfirmMenu';
import { useMenuHandler } from './MenuHandler';
import useRouter from './Router';
import ThemeToggler from './ThemeToggler';
import { useTranslator } from '../_functions/translator';



const Templates = {
  dashboard: DashboardTemplate,
  home: HomeTemplate,
  plain: PlainTemplate,
}
export type Template = 'dashboard' | 'plain' | 'home';

function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-row bg-white">
      <div className="w-full h-full flex flex-col md:flex-row">
        <Navbar />
        <div className="md:flex-grow h-full text-black bg-blue-50">
          <Middleware>
            {children}
          </Middleware>
        </div>
      </div>
    </div>
  )
}

function HomeTemplate({ children }: { children: React.ReactNode }) {

  const router = useRouter();
  const location = useLocation();
  const { session } = useSession();
  const ref = useMenuHandler();
  const translate = useTranslator();

  const handleNavigate = useCallback((path: string) => {
    void router(path);
  }, [router]);

  const handleConfirmNavigate = useCallback(() => {
    ref.close();
    handleNavigate(location.pathname === '/settings' ? loginRedirectUrl : '/settings');
  }, [ref, handleNavigate, location.pathname]);

  const handleLogout = useCallback(() => {
    void apiRequest({ name: 'logout', version: 'v1' });
  }, []);

  return (
    <div className="w-full h-full overflow-hidden flex flex-col text-title text-sm md:text-lg">

      <div className='w-full flex items-center p-2 bg-container1 gap-4'>
        <div className='h-full flex-1 flex gap-2 items-center'>
          <div className='min-w-8 max-w-8 h-8'>
            {session && (
              <Avatar user={session} />
            )}
          </div>
          <h1 className='font-semibold text-base line-clamp-1'>{session?.name}</h1>
        </div>

        <button
          className='p-2 bg-container2 border border-container2-border rounded-md cursor-pointer'
          onClick={() => {
            if (location.pathname.startsWith('/games')) {
              void ref.open(
                <ConfirmMenu
                  title="Spel verlaten?"
                  content="Weet je zeker dat je het spel wilt verlaten?"
                  resolve={(status: boolean) => {
                    if (!status) { return; }
                    handleConfirmNavigate();
                  }}
                />
              )
            } else {
              handleNavigate(location.pathname === '/settings' ? loginRedirectUrl : '/settings');
            }
          }}
        >
          <FontAwesomeIcon icon={location.pathname === '/settings' ? faHome : faGear} size='lg' />
        </button>

        <button
          className='bg-container2 border border-container2-border rounded-md py-2 px-6 cursor-pointer font-semibold'
          onClick={handleLogout}
        >
          {translate({ key: 'template.logout' })}
        </button>
      </div>

      <div className='overflow-hidden w-full flex-grow'>
        <Middleware>
          {children}
        </Middleware>
      </div>

    </div>
  )
}

function PlainTemplate({ children }: { children: React.ReactNode }) {
  const { updateTheme } = ThemeToggler();
  const reactLocation = useLocation();

  useEffect(() => {
    updateTheme(config.defaultTheme);
    document.documentElement.classList.toggle("dark", config.defaultTheme === "dark");
  }, [updateTheme, reactLocation]);

  return (
    <div className="w-full h-full">
      {children}
    </div>
  )
}

export default function TemplateProvider({
  children,
  initialTemplate,
}: {
  children: React.ReactNode;
  initialTemplate: Template;
}) {
  const [template] = useState<Template>(initialTemplate);

  const TemplateComponent = Templates[template];

  const { session } = useSession();
  const reactLocation = useLocation();
  const { updateTheme } = ThemeToggler();
  const { socketStatus } = useSocketStatus();
  const translate = useTranslator();

  useEffect(() => {
    if (session?.theme) {
      updateTheme(session.theme);
      document.documentElement.classList.toggle("dark", session.theme === "dark");
    }
  }, [session, updateTheme, reactLocation]);

  if (dev) {
    return (
      <div className='w-full h-full relative'>
        <div className='absolute top-2 right-2 z-50 bg-red-500 text-white px-2 py-1 rounded-md text-xs font-bold'>
          {translate({ key: 'template.socketStatus' })} {socketStatus.self.status}
          {socketStatus.self.status === "RECONNECTING" && socketStatus.self.reconnectAttempt !== undefined ? ` (attempt ${String(socketStatus.self.reconnectAttempt)})` : ''}
        </div>
        <TemplateComponent>{children}</TemplateComponent>
      </div>
    );
  }

  return (
    <TemplateComponent>{children}</TemplateComponent>
  );
}