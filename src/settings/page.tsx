import { useCallback, useEffect, useState } from "react";

import Avatar from "src/_components/Avatar";
import ThemeToggler from "src/_components/ThemeToggler";
import { useUpdateLanguage } from "src/_components/TranslationProvider";
import notify from "src/_functions/notify";
import { useTranslator } from "src/_functions/translator";
import { useSession } from "src/_providers/SessionProvider";
import { apiRequest } from "src/_sockets/apiRequest";

import { backendUrl } from "../../config";

const incrementAvatarVersion = (url: string) => {
  const match = /[?&]v=(\d+)/.exec(url);
  return match ? Number.parseInt(match[1]) + 1 : 1;
}

//? Strip ?v= cache buster so avatar comparisons aren't affected by version changes
const stripAvatarVersion = (url: string) => url.replace(/[?&]v=\d+/, '');

export const template = 'home';
export default function Home() {

  const { session } = useSession();
  const { updateTheme } = ThemeToggler();
  const setLanguage = useUpdateLanguage();
  const translate = useTranslator();

  const [newLanguage, setNewLanguage] = useState<'nl' | 'en' | 'de' | 'fr'>((session?.language ?? '') as 'nl' | 'en' | 'de' | 'fr');
  const [newAvatar, setNewAvatar] = useState<string>(session?.avatar ?? '');
  const [newName, setNewName] = useState<string>(session?.name ?? '');
  const [newTheme, setNewTheme] = useState<'light' | 'dark'>(session?.theme ?? 'dark');

  const saveUser = useCallback(async (isAvatarChange?: boolean) => {
    if (!session) return;

    if (
      newLanguage === session.language
      && newName === session.name
      && newTheme === session.theme
      && !isAvatarChange
    ) {
      notify.info({ key: 'settings.noChangesMade' })
      return;
    }

    const response = await apiRequest({
      name: "settings/updateUser",
      version: 'v1',
      data: {
        language: newLanguage === session.language ? undefined : newLanguage,
        avatar: stripAvatarVersion(newAvatar) === stripAvatarVersion(session.avatar) ? undefined : newAvatar,
        name: newName === session.name ? undefined : newName,
        theme: newTheme === session.theme ? undefined : newTheme,
      },
    })
    if (response.status === 'success') {
      notify.success({ key: 'settings.updatedUser' })
    } else {
      notify.error({ key: 'settings.failedUpdateUser' })
    }
  }, [newLanguage, newAvatar, newName, newTheme, session]);

  useEffect(() => {
    if (!session) return;
    void saveUser(true);
  }, [newAvatar, saveUser, session])

  const displayUrl = session
    ? (session.avatar.startsWith('http') ? session.avatar : `${backendUrl}/uploads/${session.avatar}`)
    : '';

  if (!session) return null;

  return (
    <div className='flex items-center justify-center w-full h-full bg-background'>
      <div className="bg-container1 border-2 border-container1-border flex flex-col p-8 gap-4 rounded-2xl max-w-[360px] w-[90%]">

        <div className="flex gap-4 items-center">
          <div className="rounded-xl min-w-28 max-w-28 object-cover aspect-square select-none">
            <Avatar
              user={{
                name: session.name,
                avatar: displayUrl,
                avatarFallback: session.avatarFallback
              }}
              textSize="text-4xl"
            />
          </div>
          <div className="space-y-2">
            <input type="file" className="hidden"></input>
            <button
              className="w-full py-1 bg-container2 border-container2-border border-2 rounded-md text-title font-semibold text-lg"
              onClick={() => {
                const input = document.querySelector('input[type="file"]');
                const inputElement = input as HTMLInputElement | null;
                if (inputElement) {
                  inputElement.click();
                  inputElement.addEventListener('change', () => {
                  const file = inputElement.files?.[0];
                  if (!file) return;
                  const maxSize = 4 * 1024 * 1024; // 4 MB
                  if (file.size > maxSize) {
                    notify.error({ key: 'settings.sizeToLarge' })
                    return;
                  }

                  notify.info({ key: 'settings.loadingImg' })
                  const reader = new FileReader();
                  reader.addEventListener('load', () => {
                    const result = reader.result;
                    if (typeof result === 'string') {
                      setNewAvatar(prevUrl => `${result}?v=${String(incrementAvatarVersion(prevUrl || ""))}`)
                    }
                    notify.success({ key: 'settings.imgLoaded' })
                  });
                  reader.readAsDataURL(file);
                  })
                }
              }}
            >
              {translate({ key: 'settings.changeAvatar' })}
            </button>
            <div className="text-muted text-sm">
              {translate({ key: 'settings.changeAvatarDescription' })}
            </div>
          </div>
        </div>

        <div className="space-y-2 w-full">
          <div className="text-lg font-semibold">{translate({ key: 'settings.name' })}</div>
          <input
            className={`w-full bg-container2 border-container2-border border-2 focus:outline-0 focus:border-secondary transition-all duration-150 p-2 rounded-md`}
            value={newName}
            onChange={(e) => { setNewName(e.target.value) }}
          ></input>
        </div>

        <div className="w-full flex flex-col gap-2">
          <div className="text-lg font-semibold">
            {/* Language */}
            {translate({ key: 'settings.language.title' })}
          </div>
          <div className="flex w-full gap-2">
            <button
              onClick={() => {
                setNewLanguage('nl');
                setLanguage('nl');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage === 'nl' ? 'bg-primary border-primary text-white' : 'bg-container2 border-container2-border'}
                hover:bg-primary hover:border-primary hover:text-white transition-all duration-300
              `}
            >
              {/* NL */}
              {translate({ key: 'settings.language.nl' })}
            </button>
            <button
              onClick={() => {
                setNewLanguage('en');
                setLanguage('en');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage === 'en' ? 'bg-primary border-primary text-white' : 'bg-container2 border-container2-border'}
                hover:bg-primary hover:border-primary hover:text-white transition-all duration-300
              `}
            >
              {/* EN */}
              {translate({ key: 'settings.language.en' })}
            </button>
            <button
              onClick={() => {
                setNewLanguage('de');
                setLanguage('de');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage === 'de' ? 'bg-primary border-primary text-white' : 'bg-container2 border-container2-border'}
                hover:bg-primary hover:border-primary hover:text-white transition-all duration-300
              `}
            >
              {/* DE */}
              {translate({ key: 'settings.language.de' })}
            </button>
            <button
              onClick={() => {
                setNewLanguage('fr');
                setLanguage('fr');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage === 'fr' ? 'bg-primary border-primary text-white' : 'bg-container2 border-container2-border'}
                hover:bg-primary hover:border-primary hover:text-white transition-all duration-300
              `}
            >
              {/* FR */}
              {translate({ key: 'settings.language.fr' })}
            </button>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2">
          <div className="text-lg font-semibold">
            {/* Theme */}
            {translate({ key: 'settings.theme.title' })}
          </div>
          <div className="flex w-full gap-2">
            <button
              onClick={() => {
                setNewTheme('light');
                updateTheme('light');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newTheme === 'light' ? 'bg-primary border-primary text-white' : 'bg-container2 border-container2-border'}
                hover:bg-primary hover:border-primary hover:text-white transition-all duration-300
              `}
            >
              {/* Light mode */}
              {translate({ key: 'settings.theme.light' })}
            </button>
            <button
              onClick={() => {
                setNewTheme('dark');
                updateTheme('dark');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newTheme === 'dark' ? 'bg-primary border-primary text-white' : 'bg-container2 border-container2-border'}
                hover:bg-primary hover:border-primary hover:text-white transition-all duration-300
              `}
            >
              {/* Dark mode */}
              {translate({ key: 'settings.theme.dark' })}
            </button>
          </div>
        </div>

        <button
          className="w-full bg-primary text-white py-2 rounded-lg"
          onClick={() => void saveUser()}
        >
          {/* Save data */}
          {translate({ key: 'settings.saveChanges' })}
        </button>

      </div>
    </div>
  )
}