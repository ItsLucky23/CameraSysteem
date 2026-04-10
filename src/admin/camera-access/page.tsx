import { useCallback, useEffect, useMemo, useState } from 'react';

import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import { useSyncEvents } from 'src/_sockets/syncRequest';

export const template = 'home';

interface MatrixUser {
  id: string;
  name: string;
  email: string;
}

interface MatrixCamera {
  id: string;
  name: string;
}

interface MatrixEntry {
  userId: string;
  cameraId: string;
  canPreview: boolean;
  canControl: boolean;
}

const keyOf = (userId: string, cameraId: string): string => `${userId}:${cameraId}`;

export default function CameraAccessAdminPage() {
  const translate = useTranslator();
  const { session } = useSession();
  const { upsertSyncEventCallback } = useSyncEvents();

  const [loading, setLoading] = useState<boolean>(true);
  const [users, setUsers] = useState<MatrixUser[]>([]);
  const [cameras, setCameras] = useState<MatrixCamera[]>([]);
  const [matrix, setMatrix] = useState<MatrixEntry[]>([]);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const matrixMap = useMemo(() => {
    const next = new Map<string, MatrixEntry>();
    for (const entry of matrix) {
      next.set(keyOf(entry.userId, entry.cameraId), entry);
    }
    return next;
  }, [matrix]);

  const loadMatrix = useCallback(async () => {
    setLoading(true);

    const response = await apiRequest({
      name: 'admin/camera-access/getUserCameraAccessMatrix',
      version: 'v1',
      data: {},
    });

    if (response.status === 'success') {
      setUsers(response.users);
      setCameras(response.cameras);
      setMatrix(response.matrix);
      setLoading(false);
      return;
    }

    setLoading(false);
    notify.error({ key: response.errorCode });
  }, []);

  useEffect(() => {
    void loadMatrix();
  }, [loadMatrix]);

  useEffect(() => {
    const unsubscribeAccessUpdated = upsertSyncEventCallback({
      name: 'admin/camera-access/cameraAccessUpdated',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setMatrix((previous) => {
          const next = [...previous];
          const index = next.findIndex((entry) => entry.userId === serverOutput.userId && entry.cameraId === serverOutput.cameraId);
          const value: MatrixEntry = {
            userId: serverOutput.userId,
            cameraId: serverOutput.cameraId,
            canPreview: serverOutput.canPreview,
            canControl: serverOutput.canControl,
          };

          if (index === -1) {
            next.push(value);
            return next;
          }

          next[index] = value;
          return next;
        });
      },
    });

    return () => {
      unsubscribeAccessUpdated();
    };
  }, [upsertSyncEventCallback]);

  const updateAccess = useCallback(async ({
    userId,
    cameraId,
    canPreview,
    canControl,
  }: {
    userId: string;
    cameraId: string;
    canPreview: boolean;
    canControl: boolean;
  }) => {
    const localKey = keyOf(userId, cameraId);
    setUpdatingKey(localKey);

    const response = await apiRequest({
      name: 'admin/camera-access/updateCameraAccess',
      version: 'v1',
      data: {
        userId,
        cameraId,
        canPreview,
        canControl,
      },
    });

    setUpdatingKey(null);

    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
      return;
    }

    setMatrix((previous) => {
      const next = [...previous];
      const index = next.findIndex((entry) => entry.userId === userId && entry.cameraId === cameraId);
      const value: MatrixEntry = {
        userId,
        cameraId,
        canPreview: response.access.canPreview,
        canControl: response.access.canControl,
      };

      if (index === -1) {
        next.push(value);
        return next;
      }

      next[index] = value;
      return next;
    });
  }, []);

  if (!session?.admin) {
    return (
      <div className={`w-full h-full bg-background flex items-center justify-center p-4`}>
        <div className={`bg-container1 border border-container1-border rounded-xl p-6 text-title`}>
          {translate({ key: 'adminCameraAccess.notAdmin' })}
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full bg-background overflow-y-auto`}>
      <div className={`w-full max-w-7xl self-center p-4 md:p-6 flex flex-col gap-4`}>
        <div className={`w-full bg-container1 border border-container1-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-2`}>
          <div className={`flex flex-col`}>
            <div className={`text-xl font-semibold text-title`}>{translate({ key: 'adminCameraAccess.title' })}</div>
            <div className={`text-sm text-common`}>{translate({ key: 'adminCameraAccess.subtitle' })}</div>
          </div>
          <button className={`h-9 px-4 rounded-md bg-container2 border border-container2-border text-title`} onClick={() => { void loadMatrix(); }}>
            {translate({ key: 'adminCameraAccess.refresh' })}
          </button>
        </div>

        <div className={`w-full bg-container1 border border-container1-border rounded-xl p-4 overflow-x-auto`}>
          {loading && (
            <div className={`text-sm text-common`}>{translate({ key: 'adminCameraAccess.loading' })}</div>
          )}

          {!loading && (users.length === 0 || cameras.length === 0) && (
            <div className={`text-sm text-common`}>{translate({ key: 'adminCameraAccess.empty' })}</div>
          )}

          {!loading && users.length > 0 && cameras.length > 0 && (
            <div className={`min-w-[900px] flex flex-col gap-2`}>
              <div className={`grid gap-2`} style={{ gridTemplateColumns: `240px repeat(${String(cameras.length)}, minmax(180px, 1fr))` }}>
                <div className={`bg-container2 border border-container2-border rounded-lg p-2 text-xs font-semibold text-title`}>
                  {translate({ key: 'adminCameraAccess.userHeader' })}
                </div>
                {cameras.map((camera) => (
                  <div key={camera.id} className={`bg-container2 border border-container2-border rounded-lg p-2 text-xs font-semibold text-title line-clamp-1`}>
                    {camera.name}
                  </div>
                ))}
              </div>

              {users.map((user) => (
                <div key={user.id} className={`grid gap-2`} style={{ gridTemplateColumns: `240px repeat(${String(cameras.length)}, minmax(180px, 1fr))` }}>
                  <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                    <div className={`text-sm font-semibold text-title line-clamp-1`}>{user.name}</div>
                    <div className={`text-xs text-common line-clamp-1`}>{user.email}</div>
                  </div>

                  {cameras.map((camera) => {
                    const matrixKey = keyOf(user.id, camera.id);
                    const value = matrixMap.get(matrixKey) ?? {
                      userId: user.id,
                      cameraId: camera.id,
                      canPreview: false,
                      canControl: false,
                    };

                    const updating = updatingKey === matrixKey;
                    const previewBlocked = value.canControl;

                    return (
                      <div key={camera.id} className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col gap-2`}>
                        <div className={`flex items-center justify-between gap-2`}>
                          <div className={`text-xs text-common`}>{translate({ key: 'adminCameraAccess.preview' })}</div>
                          <button
                            className={`h-8 px-3 rounded-md border text-xs ${value.canPreview ? 'bg-correct text-title border-correct' : 'bg-container1 border-container1-border text-title'} ${previewBlocked ? 'opacity-50' : ''}`}
                            disabled={updating || previewBlocked}
                            onClick={() => {
                              if (previewBlocked) {
                                return;
                              }

                              void updateAccess({
                                userId: user.id,
                                cameraId: camera.id,
                                canPreview: !value.canPreview,
                                canControl: value.canControl,
                              });
                            }}
                          >
                            {value.canPreview
                              ? translate({ key: 'adminCameraAccess.enabled' })
                              : translate({ key: 'adminCameraAccess.disabled' })}
                          </button>
                        </div>

                        <div className={`flex items-center justify-between gap-2`}>
                          <div className={`text-xs text-common`}>{translate({ key: 'adminCameraAccess.control' })}</div>
                          <button
                            className={`h-8 px-3 rounded-md border text-xs ${value.canControl ? 'bg-correct text-title border-correct' : 'bg-container1 border-container1-border text-title'}`}
                            disabled={updating}
                            onClick={() => {
                              void updateAccess({
                                userId: user.id,
                                cameraId: camera.id,
                                canPreview: value.canControl ? value.canPreview : true,
                                canControl: !value.canControl,
                              });
                            }}
                          >
                            {value.canControl
                              ? translate({ key: 'adminCameraAccess.enabled' })
                              : translate({ key: 'adminCameraAccess.disabled' })}
                          </button>
                        </div>

                        {updating && (
                          <div className={`text-xs text-common`}>{translate({ key: 'adminCameraAccess.updating' })}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
