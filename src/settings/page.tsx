import { useCallback, useState } from "react";

import Avatar from "src/_components/Avatar";
import ThemeToggler from "src/_components/ThemeToggler";
import { useUpdateLanguage } from "src/_components/TranslationProvider";
import notify from "src/_functions/notify";
import { useTranslator } from "src/_functions/translator";
import { useSession } from "src/_providers/SessionProvider";
import { apiRequest } from "src/_sockets/apiRequest";

import Chip from "src/_components/ui/Chip";
import MaterialIcon from "src/_components/ui/MaterialIcon";
import PageTopBar from "src/_components/ui/PageTopBar";

import { backendUrl } from "../../config";

export const template = 'aperture';

const stripAvatarVersion = (url: string): string => url.replace(/[?&]v=\d+/, '');

type SettingsLanguage = 'nl' | 'en' | 'de' | 'fr';
type SettingsTheme = 'light' | 'dark';

type NavSection = 'profile' | 'appearance' | 'language' | 'notifications' | 'sessions' | 'security';

export default function SettingsPage() {
  const { session } = useSession();
  const { updateTheme } = ThemeToggler();
  const setLanguage = useUpdateLanguage();
  const translate = useTranslator();

  const [activeSection, setActiveSection] = useState<NavSection>('profile');
  const [newLanguage, setNewLanguage] = useState<SettingsLanguage>((session?.language as SettingsLanguage | undefined) ?? 'en');
  const [newName, setNewName] = useState<string>(session?.name ?? '');
  const [newTheme, setNewTheme] = useState<SettingsTheme>(session?.theme ?? 'light');

  const saveUser = useCallback(async (newAvatar?: string) => {
    if (!session) return;

    const avatarChanged = newAvatar
      ? stripAvatarVersion(newAvatar) !== stripAvatarVersion(session.avatar)
      : false;
    const avatarToSave = avatarChanged ? newAvatar : undefined;

    if (
      newLanguage === session.language
      && newName === session.name
      && newTheme === session.theme
      && !newAvatar
    ) {
      notify.info({ key: 'settings.noChangesMade' });
      return;
    }

    const response = await apiRequest({
      name: "settings/updateUser",
      version: 'v1',
      data: {
        language: newLanguage === session.language ? undefined : newLanguage,
        avatar: avatarToSave,
        name: newName === session.name ? undefined : newName,
        theme: newTheme === session.theme ? undefined : newTheme,
      },
    });

    if (response.status === 'success') {
      notify.success({ key: 'settings.updatedUser' });
    } else {
      notify.error({ key: 'settings.failedUpdateUser' });
    }
  }, [newLanguage, newName, newTheme, session]);

  const handleAvatarUpload = useCallback(() => {
    if (!session) return;

    const inputElement = document.createElement('input');
    inputElement.type = 'file';
    inputElement.accept = 'image/*';
    inputElement.addEventListener('change', () => {
      const file = inputElement.files?.[0];
      if (!file) return;
      const maxSize = 4 * 1024 * 1024;
      if (file.size > maxSize) {
        notify.error({ key: 'settings.sizeToLarge' });
        return;
      }

      notify.info({ key: 'settings.loadingImg' });
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const result = reader.result;
        if (typeof result === 'string') {
          void saveUser(`${result}?v=${String(Date.now())}`);
        }
      });
      reader.readAsDataURL(file);
    });
    inputElement.click();
  }, [saveUser, session]);

  const displayUrl = session
    ? (session.avatar.startsWith('http') ? session.avatar : `${backendUrl}/uploads/${session.avatar}`)
    : '';

  if (!session) return null;

  const navSections: { key: NavSection; label: string }[] = [
    { key: 'profile', label: translate({ key: 'aperture.settings.navProfile' }) },
    { key: 'appearance', label: translate({ key: 'aperture.settings.navAppearance' }) },
    { key: 'language', label: translate({ key: 'aperture.settings.navLanguage' }) },
    { key: 'notifications', label: translate({ key: 'aperture.settings.navNotifications' }) },
    { key: 'sessions', label: translate({ key: 'aperture.settings.navSessions' }) },
    { key: 'security', label: translate({ key: 'aperture.settings.navSecurity' }) },
  ];

  const themeChoices: { key: SettingsTheme; label: string; bg: string; fg: string; accent: string }[] = [
    { key: 'light', label: translate({ key: 'aperture.settings.themeLight' }), bg: '#FAFAF8', fg: '#1A1A1A', accent: '#2D5BFF' },
    { key: 'dark', label: translate({ key: 'aperture.settings.themeDark' }), bg: '#1B1426', fg: '#F4EEFF', accent: '#8B5DFF' },
  ];

  const languageChoices: { key: SettingsLanguage; native: string }[] = [
    { key: 'en', native: 'English' },
    { key: 'nl', native: 'Nederlands' },
    { key: 'de', native: 'Deutsch' },
    { key: 'fr', native: 'Français' },
  ];

  return (
    <main className="thin-scroll h-full w-full overflow-y-auto bg-background">
      <PageTopBar
        eyebrow={translate({ key: 'aperture.settings.eyebrow' })}
        title={translate({ key: 'aperture.settings.title' })}
        subtitle={translate({ key: 'aperture.settings.subtitle' })}
      />

      <div className="grid grid-cols-1 gap-8 px-9 pb-12 lg:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-0.5 lg:sticky lg:top-2 lg:self-start">
          {navSections.map((section) => {
            const active = activeSection === section.key;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => { setActiveSection(section.key); }}
                className={`rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${active ? 'bg-container2 font-semibold text-title' : 'font-medium text-common hover:bg-container2/60 hover:text-title'}`}
              >
                {section.label}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col gap-5">
          <section className="rounded-2xl border border-container1-border bg-container1 p-7">
            <div className="mb-5">
              <h3 className="font-display m-0 text-[22px] text-title">{translate({ key: 'aperture.settings.profileTitle' })}</h3>
              <p className="mt-1 text-sm text-muted">{translate({ key: 'aperture.settings.profileSub' })}</p>
            </div>

            <div className="mb-6 flex items-center gap-5">
              <div className="h-20 w-20 overflow-hidden rounded-2xl">
                <Avatar
                  user={{ name: session.name, avatar: displayUrl, avatarFallback: session.avatarFallback }}
                  textSize="text-3xl"
                />
              </div>
              <div>
                <button
                  type="button"
                  onClick={handleAvatarUpload}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
                >
                  {translate({ key: 'aperture.settings.changeAvatar' })}
                </button>
                <div className="mt-1.5 text-xs text-muted">{translate({ key: 'aperture.settings.avatarHint' })}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-common">{translate({ key: 'aperture.settings.name' })}</label>
                <input
                  className="h-10 w-full rounded-lg border border-container1-border bg-container1 px-3 text-[13.5px] text-title outline-none transition-colors focus:border-primary"
                  value={newName}
                  onChange={(event) => { setNewName(event.target.value); }}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-common">{translate({ key: 'aperture.settings.email' })}</label>
                <input
                  className="h-10 w-full rounded-lg border border-container1-border bg-container2 px-3 text-[13.5px] text-title outline-none"
                  value={session.email}
                  readOnly
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-container1-border bg-container1 p-7">
            <div className="mb-5">
              <h3 className="font-display m-0 text-[22px] text-title">{translate({ key: 'aperture.settings.appearanceTitle' })}</h3>
              <p className="mt-1 text-sm text-muted">{translate({ key: 'aperture.settings.appearanceSub' })}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {themeChoices.map((theme) => {
                const active = newTheme === theme.key;
                return (
                  <button
                    key={theme.key}
                    type="button"
                    onClick={() => {
                      setNewTheme(theme.key);
                      updateTheme(theme.key);
                    }}
                    className={`rounded-2xl p-1 text-left transition-all ${active ? 'border-2 border-primary' : 'border border-container1-border'}`}
                  >
                    <div
                      className="flex items-center justify-between rounded-xl p-4"
                      style={{ background: theme.bg }}
                    >
                      <div>
                        <div className="h-1.5 w-16" style={{ background: theme.fg, opacity: 0.85, borderRadius: 4 }} />
                        <div className="mt-1.5 h-1 w-24" style={{ background: theme.fg, opacity: 0.4, borderRadius: 4 }} />
                      </div>
                      <div className="h-7 w-7 rounded-lg" style={{ background: theme.accent }} />
                    </div>
                    <div className="flex items-center justify-between px-3 pb-2 pt-2.5">
                      <span className="text-[13px] font-semibold text-title">{theme.label}</span>
                      {active && <Chip variant="primary">{translate({ key: 'aperture.settings.themeActive' })}</Chip>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-container1-border bg-container1 p-7">
            <div className="mb-5">
              <h3 className="font-display m-0 text-[22px] text-title">{translate({ key: 'aperture.settings.languageTitle' })}</h3>
              <p className="mt-1 text-sm text-muted">{translate({ key: 'aperture.settings.languageSub' })}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {languageChoices.map((lang) => {
                const active = newLanguage === lang.key;
                return (
                  <button
                    key={lang.key}
                    type="button"
                    onClick={() => {
                      setNewLanguage(lang.key);
                      setLanguage(lang.key);
                    }}
                    className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-3.5 text-left transition-all ${active ? 'border border-primary bg-primary-soft' : 'border border-transparent bg-container2'}`}
                  >
                    <span className={`font-mono text-[13px] font-bold ${active ? 'text-primary' : 'text-title'}`}>{lang.key.toUpperCase()}</span>
                    <span className="text-xs text-muted">{lang.native}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="sticky bottom-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setNewName(session.name);
                setNewLanguage(session.language as SettingsLanguage);
                setNewTheme(session.theme);
              }}
              className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
            >
              {translate({ key: 'aperture.settings.cancel' })}
            </button>
            <button
              type="button"
              onClick={() => { void saveUser(); }}
              className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-3.5 py-2 text-[13px] font-medium text-title-primary transition-colors hover:bg-primary-hover"
            >
              <MaterialIcon name="check" size={16} />
              {translate({ key: 'aperture.settings.save' })}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
