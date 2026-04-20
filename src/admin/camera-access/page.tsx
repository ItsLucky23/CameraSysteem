import { useCallback, useEffect, useMemo, useState } from 'react';

import Icon from 'src/_components/Icon';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import { useSyncEvents } from 'src/_sockets/syncRequest';

export const template = 'ops';

interface MatrixUser {
  id: string;
  name: string;
  email: string;
  admin?: boolean;
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

const userInitials = (name: string): string => {
  const parts = name
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return 'U';
  }

  if (parts.length === 1) {
    return parts[0][0]?.toUpperCase() ?? 'U';
  }

  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

export default function CameraAccessAdminPage() {
  const translate = useTranslator();
  const { session } = useSession();
  const { upsertSyncEventCallback } = useSyncEvents();

  const [loading, setLoading] = useState<boolean>(true);
  const [users, setUsers] = useState<MatrixUser[]>([]);
  const [cameras, setCameras] = useState<MatrixCamera[]>([]);
  const [matrix, setMatrix] = useState<MatrixEntry[]>([]);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [desktopConfigOpen, setDesktopConfigOpen] = useState<boolean>(false);
  const [mobileExpandedUserId, setMobileExpandedUserId] = useState<string | null>(null);

  const [draftPermissions, setDraftPermissions] = useState<Record<string, { canPreview: boolean; canControl: boolean }>>({});
  const [savingDraft, setSavingDraft] = useState<boolean>(false);

  const matrixMap = useMemo(() => {
    const next = new Map<string, MatrixEntry>();
    for (const entry of matrix) {
      next.set(keyOf(entry.userId, entry.cameraId), entry);
    }
    return next;
  }, [matrix]);

  const accessCountByUser = useMemo(() => {
    const next = new Map<string, number>();

    for (const entry of matrix) {
      if (!entry.canPreview) {
        continue;
      }

      next.set(entry.userId, (next.get(entry.userId) ?? 0) + 1);
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

      setSelectedUserId((previous) => {
        if (previous && response.users.some((user) => user.id === previous)) {
          return previous;
        }

        return response.users[0]?.id ?? null;
      });

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

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((user) => {
      const full = `${user.name} ${user.email}`.toLowerCase();
      return full.includes(query);
    });
  }, [search, users]);

  const activeUser = useMemo(() => {
    if (!selectedUserId) {
      return null;
    }

    return users.find((user) => user.id === selectedUserId) ?? null;
  }, [selectedUserId, users]);

  const buildPermissionsForUser = useCallback((userId: string) => {
    const next: Record<string, { canPreview: boolean; canControl: boolean }> = {};

    for (const camera of cameras) {
      const value = matrixMap.get(keyOf(userId, camera.id)) ?? {
        userId,
        cameraId: camera.id,
        canPreview: false,
        canControl: false,
      };

      next[camera.id] = {
        canPreview: value.canPreview,
        canControl: value.canControl,
      };
    }

    return next;
  }, [cameras, matrixMap]);

  useEffect(() => {
    if (!activeUser) {
      setDraftPermissions({});
      return;
    }

    setDraftPermissions(buildPermissionsForUser(activeUser.id));
  }, [activeUser, buildPermissionsForUser]);

  const setPermissionToggle = useCallback((cameraId: string, type: 'preview' | 'control') => {
    setDraftPermissions((previous) => {
      const current = previous[cameraId] ?? { canPreview: false, canControl: false };

      if (type === 'control') {
        const nextControl = !current.canControl;
        return {
          ...previous,
          [cameraId]: {
            canControl: nextControl,
            canPreview: nextControl ? true : current.canPreview,
          },
        };
      }

      if (current.canControl) {
        return previous;
      }

      return {
        ...previous,
        [cameraId]: {
          ...current,
          canPreview: !current.canPreview,
        },
      };
    });
  }, []);

  const resetDraftForUser = useCallback((userId: string) => {
    setDraftPermissions(buildPermissionsForUser(userId));
  }, [buildPermissionsForUser]);

  const saveDraftForUser = useCallback(async (userId: string) => {
    setSavingDraft(true);

    for (const camera of cameras) {
      const next = draftPermissions[camera.id] ?? { canPreview: false, canControl: false };
      const existing = matrixMap.get(keyOf(userId, camera.id)) ?? {
        userId,
        cameraId: camera.id,
        canPreview: false,
        canControl: false,
      };

      if (next.canPreview === existing.canPreview && next.canControl === existing.canControl) {
        continue;
      }

      await updateAccess({
        userId,
        cameraId: camera.id,
        canPreview: next.canPreview,
        canControl: next.canControl,
      });
    }

    setSavingDraft(false);
    notify.success({ key: 'adminAccessDesign.permissionsUpdated' });
  }, [cameras, draftPermissions, matrixMap, updateAccess]);

  const openDesktopConfig = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setDraftPermissions(buildPermissionsForUser(userId));
    setDesktopConfigOpen(true);
  }, [buildPermissionsForUser]);

  const toggleMobileUser = useCallback((userId: string) => {
    if (mobileExpandedUserId === userId) {
      setMobileExpandedUserId(null);
      return;
    }

    setSelectedUserId(userId);
    setDraftPermissions(buildPermissionsForUser(userId));
    setMobileExpandedUserId(userId);
  }, [buildPermissionsForUser, mobileExpandedUserId]);

  if (!session?.admin) {
    return (
      <div className={`relative h-full w-full bg-background p-4 flex items-center justify-center`}>
        <div className={`rounded-xl border border-wrong/40 bg-wrong/10 px-5 py-4 text-title`}>
          {translate({ key: 'adminCameraAccess.notAdmin' })}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full overflow-y-auto bg-background`}>
      <div className={`pointer-events-none absolute inset-0 overflow-hidden`}>
        <div className={`absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl`} />
        <div className={`absolute bottom-10 -left-20 h-64 w-64 rounded-full bg-container2/80 blur-3xl`} />
      </div>

      <div className={`relative mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-4 py-4 md:px-6 md:py-6 [container-type:inline-size]`}>
        <div className={`[@container(min-width:72rem)]:hidden`}>
          <div className={`flex flex-col gap-5`}>
            <div className={`flex flex-col gap-1 px-1`}>
              <div className={`text-3xl font-black tracking-tight text-title`}>{translate({ key: 'adminAccessDesign.title' })}</div>
              <div className={`text-sm font-medium text-common/80`}>{translate({ key: 'adminAccessDesign.subtitle' })}</div>
            </div>

            <div className={`flex items-center gap-2 rounded-xl border border-container2-border bg-container1 px-3 py-3`}>
              <Icon name="search" size="18px" customClasses="text-common" />
              <input
                className={`w-full bg-transparent text-sm font-medium text-title outline-none`}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder={translate({ key: 'adminAccessDesign.searchMobilePlaceholder' })}
                value={search}
              />
              <button
                className={`h-8 w-8 rounded-lg border border-container2-border bg-container2 flex items-center justify-center`}
                onClick={() => {
                  void loadMatrix();
                }}
                type="button"
              >
                <Icon name="refresh" size="15px" customClasses="text-common" />
              </button>
            </div>

            {loading && (
              <div className={`animate-pulse rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common`}>
                {translate({ key: 'adminCameraAccess.loading' })}
              </div>
            )}

            {!loading && filteredUsers.length === 0 && (
              <div className={`rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common`}>
                {translate({ key: 'adminCameraAccess.empty' })}
              </div>
            )}

            {!loading && filteredUsers.length > 0 && (
              <div className={`flex flex-col gap-3`}>
                {filteredUsers.map((user) => {
                  const expanded = mobileExpandedUserId === user.id;
                  const accessCount = accessCountByUser.get(user.id) ?? 0;

                  return (
                    <div key={user.id} className={`overflow-hidden rounded-2xl border border-container2-border bg-container1 shadow-sm`}>
                      <button
                        className={`w-full p-4 flex items-center justify-between gap-3 text-left`}
                        onClick={() => {
                          toggleMobileUser(user.id);
                        }}
                        type="button"
                      >
                        <div className={`flex min-w-0 items-center gap-3`}>
                          <div className={`h-12 w-12 shrink-0 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center text-sm font-black text-title`}>
                            {userInitials(user.name)}
                          </div>

                          <div className={`min-w-0 flex-1`}>
                            <div className={`truncate text-base font-bold text-title`}>{user.name}</div>
                            <div className={`truncate text-xs text-common/80`}>{user.email}</div>
                            <div className={`mt-1 flex items-center gap-2`}>
                              <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${user.admin ? 'border-primary/30 bg-primary/10 text-primary' : 'border-container2-border bg-container2 text-common'}`}>
                                {user.admin
                                  ? translate({ key: 'adminAccessDesign.roleAdmin' })
                                  : translate({ key: 'adminAccessDesign.roleOperator' })}
                              </div>
                              <div className={`text-[10px] font-semibold uppercase tracking-wide text-common/70`}>
                                {String(accessCount)} {translate({ key: 'adminAccessDesign.camerasAssigned' })}
                              </div>
                            </div>
                          </div>
                        </div>

                        <Icon name={expanded ? 'expand_less' : 'expand_more'} size="22px" customClasses="text-common" />
                      </button>

                      {expanded && (
                        <div className={`border-t border-container2-border bg-container2 px-3 py-3 flex flex-col gap-3`}>
                          {cameras.map((camera, index) => {
                            const value = draftPermissions[camera.id] ?? { canPreview: false, canControl: false };
                            const busy = updatingKey === keyOf(user.id, camera.id);

                            return (
                              <div key={camera.id} className={`rounded-xl border border-container2-border bg-container1 p-3 flex items-center justify-between gap-2`}>
                                <div className={`min-w-0 flex items-center gap-2`}>
                                  <div className={`h-10 w-10 shrink-0 rounded-md border border-container2-border bg-container2 flex items-center justify-center`}>
                                    <Icon name="videocam" size="16px" customClasses="text-common" />
                                  </div>
                                  <div className={`min-w-0 flex-1`}>
                                    <div className={`truncate text-sm font-semibold text-title`}>{camera.name}</div>
                                    <div className={`text-[10px] font-semibold uppercase tracking-widest text-common/70`}>
                                      {translate({ key: 'adminAccessDesign.zoneLabel' })} {String(index + 1).padStart(2, '0')}
                                    </div>
                                  </div>
                                </div>

                                <div className={`flex items-center gap-3`}>
                                  <div className={`flex flex-col items-center gap-1`}>
                                    <div className={`text-[10px] font-bold uppercase tracking-wide text-common/70`}>
                                      {translate({ key: 'adminCameraAccess.preview' })}
                                    </div>
                                    <button
                                      className={`relative h-6 w-11 rounded-full border transition-colors ${value.canPreview ? 'border-primary-border bg-primary' : 'border-container2-border bg-container2'} ${value.canControl ? 'opacity-60' : ''}`}
                                      disabled={busy || value.canControl}
                                      onClick={() => {
                                        setPermissionToggle(camera.id, 'preview');
                                      }}
                                      type="button"
                                    >
                                      <span className={`absolute top-0.5 block h-4 w-4 rounded-full bg-title-primary transition-transform ${value.canPreview ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                  </div>

                                  <div className={`flex flex-col items-center gap-1`}>
                                    <div className={`text-[10px] font-bold uppercase tracking-wide text-common/70`}>
                                      {translate({ key: 'adminCameraAccess.control' })}
                                    </div>
                                    <button
                                      className={`relative h-6 w-11 rounded-full border transition-colors ${value.canControl ? 'border-primary-border bg-primary' : 'border-container2-border bg-container2'}`}
                                      disabled={busy}
                                      onClick={() => {
                                        setPermissionToggle(camera.id, 'control');
                                      }}
                                      type="button"
                                    >
                                      <span className={`absolute top-0.5 block h-4 w-4 rounded-full bg-title-primary transition-transform ${value.canControl ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          <div className={`flex items-center justify-end gap-2 pt-1`}>
                            <button
                              className={`rounded-lg px-4 py-2 text-sm font-bold text-primary hover:bg-primary/10`}
                              onClick={() => {
                                resetDraftForUser(user.id);
                              }}
                              type="button"
                            >
                              {translate({ key: 'adminAccessDesign.reset' })}
                            </button>

                            <button
                              className={`rounded-lg border border-primary-border bg-primary px-4 py-2 text-sm font-bold text-title-primary disabled:opacity-60`}
                              disabled={savingDraft}
                              onClick={() => {
                                void saveDraftForUser(user.id);
                              }}
                              type="button"
                            >
                              {translate({ key: 'adminAccessDesign.updatePermissions' })}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={`hidden [@container(min-width:72rem)]:block`}>
          <div className={`flex flex-col gap-6`}>
            <div className={`flex flex-wrap items-end justify-between gap-4`}>
              <div className={`flex flex-col gap-1`}>
                <div className={`text-4xl font-black tracking-tight text-title`}>{translate({ key: 'adminAccessDesign.title' })}</div>
                <div className={`text-base font-medium text-common/80`}>{translate({ key: 'adminAccessDesign.subtitle' })}</div>
              </div>

              <div className={`flex items-center gap-2`}>
                <button className={`flex h-11 items-center gap-2 rounded-lg border border-container2-border bg-container1 px-4 text-sm font-semibold text-title hover:bg-container2`} type="button">
                  <Icon name="filter_list" size="16px" customClasses="text-common" />
                  <span>{translate({ key: 'adminAccessDesign.filter' })}</span>
                </button>

                <button className={`flex h-11 items-center gap-2 rounded-lg border border-primary-border bg-primary px-4 text-sm font-semibold text-title-primary hover:bg-primary-hover`} type="button">
                  <Icon name="person_add" size="16px" customClasses="text-title-primary" />
                  <span>{translate({ key: 'adminAccessDesign.inviteUser' })}</span>
                </button>
              </div>
            </div>

            <div className={`rounded-2xl border border-container2-border bg-container1 p-4 flex items-center gap-3`}>
              <div className={`flex h-11 min-w-[26rem] flex-1 items-center gap-2 rounded-xl border border-container2-border bg-container2 px-3`}>
                <Icon name="search" size="18px" customClasses="text-common" />
                <input
                  className={`w-full bg-transparent text-sm font-medium text-title outline-none`}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  placeholder={translate({ key: 'adminAccessDesign.searchDesktopPlaceholder' })}
                  value={search}
                />
              </div>

              <button
                className={`flex h-11 items-center gap-2 rounded-lg border border-container2-border bg-container2 px-4 text-sm font-semibold text-title`}
                onClick={() => {
                  void loadMatrix();
                }}
                type="button"
              >
                <Icon name="refresh" size="16px" customClasses="text-common" />
                <span>{translate({ key: 'adminCameraAccess.refresh' })}</span>
              </button>
            </div>

            {loading && (
              <div className={`animate-pulse rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common`}>
                {translate({ key: 'adminCameraAccess.loading' })}
              </div>
            )}

            {!loading && filteredUsers.length === 0 && (
              <div className={`rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common`}>
                {translate({ key: 'adminCameraAccess.empty' })}
              </div>
            )}

            {!loading && filteredUsers.length > 0 && (
              <div className={`grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`}>
                {filteredUsers.map((user) => {
                  const accessCount = accessCountByUser.get(user.id) ?? 0;

                  return (
                    <button
                      className={`group rounded-2xl border border-container2-border bg-container1 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg`}
                      key={user.id}
                      onClick={() => {
                        openDesktopConfig(user.id);
                      }}
                      type="button"
                    >
                      <div className={`mb-4 flex items-start justify-between gap-2`}>
                        <div className={`h-14 w-14 rounded-full border border-primary/35 bg-primary/10 flex items-center justify-center text-lg font-black text-title`}>
                          {userInitials(user.name)}
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${user.admin ? 'border-primary/30 bg-primary/10 text-primary' : 'border-container2-border bg-container2 text-common'}`}>
                          {user.admin
                            ? translate({ key: 'adminAccessDesign.roleAdmin' })
                            : translate({ key: 'adminAccessDesign.roleOperator' })}
                        </div>
                      </div>

                      <div className={`space-y-1`}>
                        <div className={`line-clamp-1 text-lg font-bold text-title`}>{user.name}</div>
                        <div className={`line-clamp-1 text-sm text-common/80`}>{user.email}</div>
                      </div>

                      <div className={`mt-5 flex items-center justify-between border-t border-container2-border pt-4`}>
                        <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-common/80`}>
                          <Icon name="videocam" size="14px" customClasses="text-common" />
                          <span>{String(accessCount)} {translate({ key: 'adminAccessDesign.camerasAssigned' })}</span>
                        </div>
                        <Icon name="chevron_right" size="18px" customClasses="text-common group-hover:text-primary" />
                      </div>
                    </button>
                  );
                })}

                <button className={`rounded-2xl border-2 border-dashed border-container2-border bg-container1 p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5`} type="button">
                  <div className={`flex h-full flex-col items-center justify-center gap-3 py-6`}>
                    <div className={`flex h-12 w-12 items-center justify-center rounded-full border border-container2-border bg-container2`}>
                      <Icon name="person_add" size="20px" customClasses="text-common" />
                    </div>
                    <div className={`text-center`}>
                      <div className={`text-base font-bold text-title`}>{translate({ key: 'adminAccessDesign.inviteUser' })}</div>
                      <div className={`text-xs text-common/80`}>{translate({ key: 'adminAccessDesign.selectUserPrompt' })}</div>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {desktopConfigOpen && activeUser && (
        <div className={`fixed inset-0 z-50 hidden items-center justify-center bg-background/80 p-6 backdrop-blur-sm md:flex`}>
          <button
            className={`absolute inset-0`}
            onClick={() => {
              setDesktopConfigOpen(false);
            }}
            type="button"
          />

          <div className={`relative z-10 w-full max-w-3xl overflow-hidden rounded-3xl border border-container2-border bg-container1 shadow-2xl`}>
            <div className={`flex items-center justify-between gap-4 border-b border-container2-border px-6 py-5`}>
              <div className={`flex items-center gap-3`}>
                <div className={`h-12 w-12 rounded-full border border-primary/35 bg-primary/10 flex items-center justify-center text-base font-black text-title`}>
                  {userInitials(activeUser.name)}
                </div>
                <div>
                  <div className={`text-xl font-bold text-title`}>{activeUser.name}</div>
                  <div className={`text-sm text-common/80`}>{translate({ key: 'adminAccessDesign.updatePermissions' })}</div>
                </div>
              </div>

              <button
                className={`flex h-9 w-9 items-center justify-center rounded-full border border-container2-border bg-container2 text-common`}
                onClick={() => {
                  setDesktopConfigOpen(false);
                }}
                type="button"
              >
                <Icon name="close" size="18px" customClasses="text-common" />
              </button>
            </div>

            <div className={`max-h-[58vh] overflow-y-auto px-6 py-5 flex flex-col gap-3`}>
              {cameras.map((camera, index) => {
                const value = draftPermissions[camera.id] ?? { canPreview: false, canControl: false };
                const busy = updatingKey === keyOf(activeUser.id, camera.id);

                return (
                  <div className={`rounded-2xl border border-container2-border bg-container2 p-4 flex items-center justify-between gap-3`} key={camera.id}>
                    <div className={`min-w-0 flex items-center gap-3`}>
                      <div className={`h-12 w-12 shrink-0 rounded-lg border border-container2-border bg-container1 flex items-center justify-center`}>
                        <Icon name="videocam" size="18px" customClasses="text-common" />
                      </div>

                      <div className={`min-w-0`}>
                        <div className={`truncate text-sm font-bold text-title`}>{camera.name}</div>
                        <div className={`mt-1 flex items-center gap-2`}>
                          <span className={`rounded-full border border-correct/30 bg-correct/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-correct`}>
                            {translate({ key: 'dashboard.live' })}
                          </span>
                          <span className={`text-[10px] font-semibold uppercase tracking-widest text-common/70`}>
                            {translate({ key: 'adminAccessDesign.zoneLabel' })} {String(index + 1).padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={`flex items-center gap-4`}>
                      <div className={`flex flex-col items-center gap-1`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wide text-common/70`}>
                          {translate({ key: 'adminCameraAccess.preview' })}
                        </span>
                        <button
                          className={`relative h-6 w-11 rounded-full border transition-colors ${value.canPreview ? 'border-primary-border bg-primary' : 'border-container2-border bg-container1'} ${value.canControl ? 'opacity-60' : ''}`}
                          disabled={busy || value.canControl}
                          onClick={() => {
                            setPermissionToggle(camera.id, 'preview');
                          }}
                          type="button"
                        >
                          <span className={`absolute top-0.5 block h-4 w-4 rounded-full bg-title-primary transition-transform ${value.canPreview ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>

                      <div className={`flex flex-col items-center gap-1`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wide text-common/70`}>
                          {translate({ key: 'adminCameraAccess.control' })}
                        </span>
                        <button
                          className={`relative h-6 w-11 rounded-full border transition-colors ${value.canControl ? 'border-primary-border bg-primary' : 'border-container2-border bg-container1'}`}
                          disabled={busy}
                          onClick={() => {
                            setPermissionToggle(camera.id, 'control');
                          }}
                          type="button"
                        >
                          <span className={`absolute top-0.5 block h-4 w-4 rounded-full bg-title-primary transition-transform ${value.canControl ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={`flex items-center justify-end gap-2 border-t border-container2-border bg-container2/50 px-6 py-4`}>
              <button
                className={`rounded-lg px-5 py-2 text-sm font-bold text-primary hover:bg-primary/10`}
                onClick={() => {
                  resetDraftForUser(activeUser.id);
                }}
                type="button"
              >
                {translate({ key: 'adminAccessDesign.reset' })}
              </button>

              <button
                className={`rounded-lg px-5 py-2 text-sm font-bold text-common hover:bg-container2`}
                onClick={() => {
                  setDesktopConfigOpen(false);
                }}
                type="button"
              >
                {translate({ key: 'confirm.cancel' })}
              </button>

              <button
                className={`rounded-lg border border-primary-border bg-primary px-6 py-2 text-sm font-bold text-title-primary disabled:opacity-60`}
                disabled={savingDraft}
                onClick={() => {
                  void saveDraftForUser(activeUser.id);
                }}
                type="button"
              >
                {translate({ key: 'adminAccessDesign.updatePermissions' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
