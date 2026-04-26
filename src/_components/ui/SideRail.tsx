import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';

import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';

import Avatar from '../Avatar';
import useRouter from '../Router';

import MaterialIcon from './MaterialIcon';
import Wordmark from './Wordmark';

export type SideRailKey = 'dashboard' | 'cameras' | 'recordings' | 'access' | 'admin' | 'settings';

interface NavEntry {
  id: SideRailKey;
  icon: string;
  labelKey: string;
  path: string;
  match: (pathname: string) => boolean;
}

const navItems: NavEntry[] = [
  { id: 'dashboard', icon: 'dashboard', labelKey: 'sideRail.dashboard', path: '/dashboard', match: (p) => p === '/dashboard' },
  { id: 'cameras', icon: 'videocam', labelKey: 'sideRail.cameras', path: '/cameras', match: (p) => p === '/cameras' || p.startsWith('/cameras/') || p.startsWith('/camera/') },
  { id: 'recordings', icon: 'movie', labelKey: 'sideRail.recordings', path: '/recordings', match: (p) => p === '/recordings' || p.startsWith('/recordings/') },
  { id: 'access', icon: 'key', labelKey: 'sideRail.access', path: '/admin/camera-access', match: (p) => p.startsWith('/admin/camera-access') },
  { id: 'admin', icon: 'tune', labelKey: 'sideRail.admin', path: '/admin', match: (p) => p === '/admin' },
];

const bottomItems: NavEntry[] = [
  { id: 'settings', icon: 'settings', labelKey: 'sideRail.settings', path: '/settings', match: (p) => p.startsWith('/settings') },
];

const handleLogoutClick = (): void => {
  void apiRequest({ name: 'logout', version: 'v1' });
};

interface Props {
  active?: SideRailKey;
}

export default function SideRail({ active }: Props) {
  const router = useRouter();
  const location = useLocation();
  const translate = useTranslator();
  const { session } = useSession();

  const visibleNav = session?.admin
    ? navItems
    : navItems.filter((item) => item.id !== 'access' && item.id !== 'admin');

  const renderItem = (item: NavEntry): ReactElement => {
    const isActive = active ? active === item.id : item.match(location.pathname);
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          void router(item.path);
        }}
        className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] transition-colors ${isActive ? 'bg-container2 font-semibold text-title' : 'font-medium text-common hover:bg-container2/60 hover:text-title'}`}
      >
        <MaterialIcon name={item.icon} size={19} />
        <span>{translate({ key: item.labelKey })}</span>
        {isActive && <span className="ml-auto h-1 w-1 rounded-full bg-primary" />}
      </button>
    );
  };

  return (
    <aside className="flex w-[220px] shrink-0 h-full flex-col border-r border-container1-border bg-container1 px-3.5 py-5">
      <div className="px-1.5 pb-5">
        <Wordmark />
      </div>
      <div className="flex flex-col gap-0.5">
        {visibleNav.map((item) => renderItem(item))}
      </div>
      <div className="flex-1" />
      <div className="flex flex-col gap-0.5">
        {bottomItems.map((item) => renderItem(item))}
      </div>
      {session && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-container2 p-3">
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full">
            <Avatar user={session} />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-title">{session.name}</span>
            <span className="truncate text-[11px] text-muted">{session.admin ? translate({ key: 'sideRail.roleAdmin' }) : translate({ key: 'sideRail.roleOperator' })}</span>
          </div>
          <button
            type="button"
            onClick={handleLogoutClick}
            className="ml-auto rounded-md p-1.5 text-muted transition-colors hover:bg-container2-hover hover:text-title"
            aria-label={translate({ key: 'sideRail.logout' })}
          >
            <MaterialIcon name="logout" size={16} />
          </button>
        </div>
      )}
    </aside>
  );
}
