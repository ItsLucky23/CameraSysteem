import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { locationProviderEnabled } from 'config';
import { updateLocationRequest } from 'src/_sockets/socketInitializer';

const sendLocationUpdate = (pathname: string) => {
  const searchParams: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(globalThis.location.search)) {
    searchParams[key] = value;
  }
  void updateLocationRequest({ location: { pathName: pathname, searchParams } });
};

export default function LocationProvider() {
  const location = useLocation();

  useEffect(() => {
    if (!locationProviderEnabled) { return; }
    sendLocationUpdate(location.pathname);
  }, [location.pathname]);

  return <Outlet />;
}