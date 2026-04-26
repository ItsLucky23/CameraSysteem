import { useLocation } from 'react-router-dom';

import { useTranslator } from 'src/_functions/translator';

import useRouter from '../Router';

import MaterialIcon from './MaterialIcon';

interface Tab {
  id: string;
  icon: string;
  labelKey: string;
  path: string;
  match: (pathname: string) => boolean;
}

const tabs: Tab[] = [
  { id: 'dashboard', icon: 'dashboard', labelKey: 'sideRail.dashboard', path: '/dashboard', match: (p) => p === '/dashboard' },
  { id: 'cameras', icon: 'videocam', labelKey: 'sideRail.cameras', path: '/cameras', match: (p) => p === '/cameras' || p.startsWith('/cameras/') || p.startsWith('/camera/') },
  { id: 'recordings', icon: 'movie', labelKey: 'sideRail.recordings', path: '/recordings', match: (p) => p.startsWith('/recordings') },
  { id: 'settings', icon: 'settings', labelKey: 'sideRail.settings', path: '/settings', match: (p) => p.startsWith('/settings') || p.startsWith('/admin') },
];

export default function MobileTabBar() {
  const router = useRouter();
  const location = useLocation();
  const translate = useTranslator();

  return (
    <div className="flex items-center justify-around border-t border-container1-border bg-container1 px-3 pb-5 pt-2">
      {tabs.map((tab) => {
        const isActive = tab.match(location.pathname);
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              void router(tab.path);
            }}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 transition-colors ${isActive ? 'text-primary' : 'text-muted'}`}
          >
            <MaterialIcon name={tab.icon} size={20} filled={isActive} />
            <span className={`text-[9.5px] ${isActive ? 'font-semibold' : 'font-medium'}`}>
              {translate({ key: tab.labelKey })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
