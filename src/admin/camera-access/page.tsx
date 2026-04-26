import { useCallback, useEffect, useMemo, useState } from 'react';

import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import { useSyncEvents } from 'src/_sockets/syncRequest';

import Chip from 'src/_components/ui/Chip';
import MaterialIcon from 'src/_components/ui/MaterialIcon';
import PageTopBar from 'src/_components/ui/PageTopBar';
import Toggle from 'src/_components/ui/Toggle';

export const template = 'aperture';

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
  const parts = name.split(' ').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return 'U';
  const first = parts[0].charAt(0);
  if (parts.length === 1) {
    return first.length > 0 ? first.toUpperCase() : 'U';
  }
  return `${first}${parts[1].charAt(0)}`.toUpperCase();
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
  const [draftPermissions, setDraftPermissions] = useState<Record<string, { canPreview: boolean; canControl: boolean }>>({});
  const [savingDraft, setSavingDraft] = useState<boolean>(false);

  const matrixMap = useMemo(() => {
    const next = new Map<string, MatrixEntry>();
    for (const entry of matrix) next.set(keyOf(entry.userId, entry.cameraId), entry);
    return next;
  }, [matrix]);

  const accessCountByUser = useMemo(() => {
    const next = new Map<string, number>();
    for (const entry of matrix) {
      if (!entry.canPreview) continue;
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
        if (previous && response.users.some((user) => user.id === previous)) return previous;
        return response.users[0]?.id ?? null;
      });
      setLoading(false);
      return;
    }

    setLoading(false);
    notify.error({ key: response.errorCode });
  }, []);

  useEffect(() => { void loadMatrix(); }, [loadMatrix]);

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

    return () => { unsubscribeAccessUpdated(); };
  }, [upsertSyncEventCallback]);

  const updateAccess = useCallback(async ({
    userId, cameraId, canPreview, canControl,
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
      data: { userId, cameraId, canPreview, canControl },
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
        userId, cameraId,
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
    if (!query) return users;
    return users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query));
  }, [search, users]);

  const activeUser = useMemo(() => {
    if (!selectedUserId) return null;
    return users.find((user) => user.id === selectedUserId) ?? null;
  }, [selectedUserId, users]);

  const buildPermissionsForUser = useCallback((userId: string) => {
    const next: Record<string, { canPreview: boolean; canControl: boolean }> = {};
    for (const camera of cameras) {
      const value = matrixMap.get(keyOf(userId, camera.id)) ?? { userId, cameraId: camera.id, canPreview: false, canControl: false };
      next[camera.id] = { canPreview: value.canPreview, canControl: value.canControl };
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

  const setPermissionToggle = useCallback((cameraId: string, type: 'preview' | 'control', next: boolean) => {
    setDraftPermissions((previous) => {
      const current = previous[cameraId] ?? { canPreview: false, canControl: false };
      if (type === 'control') {
        return {
          ...previous,
          [cameraId]: {
            canControl: next,
            canPreview: next ? true : current.canPreview,
          },
        };
      }
      if (current.canControl) return previous;
      return {
        ...previous,
        [cameraId]: { ...current, canPreview: next },
      };
    });
  }, []);

  const resetDraft = useCallback(() => {
    if (!activeUser) return;
    setDraftPermissions(buildPermissionsForUser(activeUser.id));
  }, [activeUser, buildPermissionsForUser]);

  const saveDraft = useCallback(async () => {
    if (!activeUser) return;
    setSavingDraft(true);
    for (const camera of cameras) {
      const next = draftPermissions[camera.id] ?? { canPreview: false, canControl: false };
      const existing = matrixMap.get(keyOf(activeUser.id, camera.id)) ?? { userId: activeUser.id, cameraId: camera.id, canPreview: false, canControl: false };
      if (next.canPreview === existing.canPreview && next.canControl === existing.canControl) continue;
      await updateAccess({
        userId: activeUser.id,
        cameraId: camera.id,
        canPreview: next.canPreview,
        canControl: next.canControl,
      });
    }
    setSavingDraft(false);
    notify.success({ key: 'adminAccessDesign.permissionsUpdated' });
  }, [activeUser, cameras, draftPermissions, matrixMap, updateAccess]);

  if (!session?.admin) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-4">
        <div className="rounded-2xl border border-wrong/40 bg-wrong-soft px-5 py-4 text-title">
          {translate({ key: 'adminCameraAccess.notAdmin' })}
        </div>
      </div>
    );
  }

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <PageTopBar
        eyebrow={translate({ key: 'aperture.access.eyebrow' })}
        title={translate({ key: 'aperture.access.title' })}
        subtitle={translate({ key: 'aperture.access.subtitle' })}
        actions={
          <button
            type="button"
            onClick={() => { void loadMatrix(); }}
            className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
          >
            <MaterialIcon name="refresh" size={16} />
            {translate({ key: 'aperture.dashboard.refresh' })}
          </button>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-9 pb-10 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-container1-border bg-container1">
          <div className="border-b border-container1-border p-4">
            <div className="flex items-center gap-2 rounded-lg bg-container2 px-2.5 py-2">
              <MaterialIcon name="search" size={15} className="text-muted" />
              <input
                value={search}
                onChange={(event) => { setSearch(event.target.value); }}
                placeholder={translate({ key: 'aperture.access.searchPlaceholder' })}
                className="flex-1 border-none bg-transparent text-sm text-title outline-none"
              />
            </div>
          </div>
          <div className="thin-scroll flex-1 overflow-y-auto p-1.5">
            {loading && (
              <div className="px-3 py-3 text-xs text-muted">{translate({ key: 'adminCameraAccess.loading' })}</div>
            )}
            {!loading && filteredUsers.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted">{translate({ key: 'adminCameraAccess.empty' })}</div>
            )}
            {filteredUsers.map((user) => {
              const active = user.id === selectedUserId;
              const accessCount = accessCountByUser.get(user.id) ?? 0;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => { setSelectedUserId(user.id); }}
                  className={`mb-0.5 flex w-full items-center gap-3 rounded-[10px] p-3 text-left transition-colors ${active ? 'bg-container2' : 'hover:bg-container2/60'}`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${active ? 'bg-primary text-white' : 'bg-primary-soft text-primary'}`}
                  >
                    {userInitials(user.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-title">{user.name}</div>
                    <div className="truncate text-[11px] text-muted">{user.email}</div>
                  </div>
                  <div className="shrink-0">
                    {user.admin ? (
                      <Chip variant="primary">{translate({ key: 'aperture.access.roleAdmin' })}</Chip>
                    ) : (
                      <span className="font-mono text-[10px] font-semibold text-muted">
                        {translate({ key: 'aperture.access.camsCount' }).replace('{{count}}', String(accessCount)).replace('{{total}}', String(cameras.length))}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-container1-border bg-container1">
          {!activeUser && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <MaterialIcon name="manage_accounts" size={32} className="text-muted" />
              <div className="font-display text-[22px] text-title">{translate({ key: 'aperture.access.selectUser' })}</div>
              <div className="text-sm text-muted">{translate({ key: 'aperture.access.selectUserHint' })}</div>
            </div>
          )}

          {activeUser && (
            <>
              <div className="flex items-center justify-between gap-4 border-b border-container1-border p-5">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-sm font-bold text-primary">
                    {userInitials(activeUser.name)}
                  </div>
                  <div>
                    <div className="text-[17px] font-semibold tracking-tight text-title">{activeUser.name}</div>
                    <div className="text-[12.5px] text-muted">
                      {activeUser.email} · {activeUser.admin ? translate({ key: 'aperture.access.roleAdmin' }) : translate({ key: 'sideRail.roleOperator' })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetDraft}
                    disabled={savingDraft || activeUser.admin}
                    className="inline-flex items-center gap-2 rounded-[10px] border border-transparent bg-transparent px-3.5 py-2 text-[13px] font-medium text-common hover:bg-container2 disabled:opacity-50"
                  >
                    {translate({ key: 'aperture.access.reset' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void saveDraft(); }}
                    disabled={savingDraft || activeUser.admin}
                    className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-3.5 py-2 text-[13px] font-semibold text-title-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                  >
                    {translate({ key: 'aperture.access.save' })}
                  </button>
                </div>
              </div>

              {activeUser.admin && (
                <div className="border-b border-container1-border bg-primary-soft px-5 py-2 text-[12.5px] text-primary">
                  {translate({ key: 'aperture.access.userIsAdmin' })}
                </div>
              )}

              <div className="grid border-b border-container1-border px-6 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted" style={{ gridTemplateColumns: '1fr 110px 110px' }}>
                <div>{translate({ key: 'aperture.access.headerCamera' })}</div>
                <div className="text-center">{translate({ key: 'aperture.access.headerPreview' })}</div>
                <div className="text-center">{translate({ key: 'aperture.access.headerControl' })}</div>
              </div>

              <div className="thin-scroll flex-1 overflow-y-auto">
                {cameras.map((camera, index) => {
                  const value = draftPermissions[camera.id] ?? { canPreview: false, canControl: false };
                  const updating = updatingKey === keyOf(activeUser.id, camera.id);
                  return (
                    <div
                      key={camera.id}
                      className={`grid items-center gap-4 px-6 py-3.5 ${index < cameras.length - 1 ? 'border-b border-container1-border' : ''}`}
                      style={{ gridTemplateColumns: '1fr 110px 110px' }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-7 w-11 shrink-0 items-center justify-center rounded-md bg-container2">
                          <MaterialIcon name="videocam" size={14} className="text-common" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-title">{camera.name}</div>
                          <div className="font-mono text-[11px] text-muted">{camera.id.slice(-8)}</div>
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <Toggle
                          on={value.canPreview || activeUser.admin === true}
                          disabled={updating || activeUser.admin === true || value.canControl}
                          onChange={(next) => { setPermissionToggle(camera.id, 'preview', next); }}
                          ariaLabel={translate({ key: 'aperture.access.headerPreview' })}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Toggle
                          on={value.canControl || activeUser.admin === true}
                          disabled={updating || activeUser.admin === true}
                          onChange={(next) => { setPermissionToggle(camera.id, 'control', next); }}
                          ariaLabel={translate({ key: 'aperture.access.headerControl' })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
