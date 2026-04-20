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
import Icon from './Icon';
import { useMenuHandler } from './MenuHandler';
import useRouter from './Router';
import ThemeToggler from './ThemeToggler';
import { useTranslator } from '../_functions/translator';



const Templates = {
  dashboard: DashboardTemplate,
  home: HomeTemplate,
  ops: OpsTemplate,
  plain: PlainTemplate,
}
export type Template = 'dashboard' | 'plain' | 'home' | 'ops';

function OpsTemplate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const router = useRouter();
  const { session } = useSession();
  const translate = useTranslator();

  const navItems = [
    {
      key: 'opsTemplate.dashboard',
      icon: 'dashboard',
      path: '/dashboard',
      active: location.pathname === '/dashboard',
    },
    {
      key: 'opsTemplate.admin',
      icon: 'admin_panel_settings',
      path: '/admin',
      active: location.pathname === '/admin',
    },
    {
      key: 'opsTemplate.access',
      icon: 'lock_person',
      path: '/admin/camera-access',
      active: location.pathname === '/admin/camera-access',
    },
    {
      key: 'opsTemplate.monitor',
      icon: 'videocam',
      path: '/cameras',
      active: location.pathname === '/cameras' || location.pathname.startsWith('/cameras/') || location.pathname.startsWith('/camera/'),
    },
  ];

  return (
    <div className="w-full h-full bg-background overflow-hidden text-title">
      <div className="hidden md:flex h-16 w-full items-center justify-between border-b border-container1-border bg-container1 px-6">
        <div className="flex items-center gap-8">
          <div className="text-2xl font-semibold tracking-tight">{translate({ key: 'opsTemplate.brand' })}</div>
          <div className="flex items-center gap-2">
            {navItems.map((item) => (
              <button
                key={item.path}
                className={`h-10 px-3 rounded-md text-sm font-medium border transition-all duration-200 ${item.active ? 'bg-container2 border-container2-border text-title' : 'border-transparent text-common hover:text-title hover:bg-container2'}`}
                onClick={() => {
                  void router(item.path);
                }}
              >
                {translate({ key: item.key })}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="h-10 w-10 rounded-md border border-container2-border bg-container2 text-common hover:text-title"
            onClick={() => {
              void router('/settings');
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <Icon name="notifications" size="20px" />
            </div>
          </button>
          <button
            className="h-10 w-10 rounded-md border border-container2-border bg-container2 text-common hover:text-title"
            onClick={() => {
              void router('/settings');
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <Icon name="settings" size="20px" />
            </div>
          </button>
          <button
            className="h-10 w-10 rounded-full border border-container2-border bg-container2 overflow-hidden"
            onClick={() => {
              void router('/settings');
            }}
          >
            <div className="w-full h-full">
              {session && (
                <Avatar user={session} />
              )}
            </div>
          </button>
        </div>
      </div>

      <div className="md:hidden h-14 w-full flex items-center justify-between border-b border-container1-border bg-container1 px-4">
        <div className="text-xl font-semibold tracking-tight">{translate({ key: 'opsTemplate.brand' })}</div>
        <div className="flex items-center gap-2">
          <button
            className="h-9 w-9 rounded-md border border-container2-border bg-container2"
            onClick={() => {
              void router('/settings');
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <Icon name="notifications" size="18px" />
            </div>
          </button>
          <button
            className="h-9 w-9 rounded-md border border-container2-border bg-container2"
            onClick={() => {
              void router('/settings');
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <Icon name="settings" size="18px" />
            </div>
          </button>
        </div>
      </div>

      <div className="w-full h-[calc(100%-3.5rem)] md:h-[calc(100%-4rem)] overflow-hidden pb-20 md:pb-0">
        <Middleware>
          {children}
        </Middleware>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 right-0 h-20 border-t border-container1-border bg-container1 px-2 pt-2 pb-3 z-30">
        <div className="h-full grid grid-cols-4 gap-1">
          {navItems.map((item) => (
            <button
              key={`mobile-${item.path}`}
              className={`h-full rounded-xl flex flex-col items-center justify-center gap-1 transition-colors duration-200 ${item.active ? 'bg-container2 text-title' : 'text-common'}`}
              onClick={() => {
                void router(item.path);
              }}
            >
              <Icon name={item.icon} size="20px" customClasses={item.active ? 'text-primary' : 'text-common'} />
              <div className={`text-xs ${item.active ? 'text-primary font-semibold' : ''}`}>{translate({ key: item.key })}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

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