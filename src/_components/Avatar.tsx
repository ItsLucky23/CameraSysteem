import { backendUrl, SessionLayout } from "config";

import { useAvatarContext, AvatarStatus } from "./AvatarProvider";

type UserType = SessionLayout | { name: string; avatar?: string; avatarFallback?: string };
type TextSize = "text-sm" | "text-base" | "text-lg" | "text-xl" | "text-2xl" | "text-3xl" | "text-4xl" | "text-5xl" | "text-6xl" | "text-7xl" | "text-8xl" | "text-9xl";

const getAvatarSrc = (avatar: string) => {
  return avatar.startsWith('http') ? avatar : `${backendUrl}/uploads/${avatar}`;
};

const getAvatarIdentity = (avatar?: string) => {
  if (!avatar) return null;

  const source = getAvatarSrc(avatar);

  if (source.startsWith('http')) {
    try {
      const parsed = new URL(source);
      const fileName = parsed.pathname.split('/').pop() ?? parsed.pathname;
      const avatarId = fileName.replace(/\.[^/.]+$/, '') || fileName;
      const refreshKey = parsed.searchParams.get('v') ?? '';
      return { avatarId, refreshKey, source };
    } catch {
      const [rawPath] = source.split('?');
      const fileName = rawPath.split('/').pop() ?? rawPath;
      return {
        avatarId: fileName.replace(/\.[^/.]+$/, '') || fileName,
        refreshKey: '',
        source,
      };
    }
  }

  const [rawPath, rawQuery = ''] = source.split('?');
  const avatarId = (rawPath.split('/').pop() ?? rawPath).replace(/\.[^/.]+$/, '');
  const queryParams = new URLSearchParams(rawQuery);

  return {
    avatarId,
    refreshKey: queryParams.get('v') ?? '',
    source,
  };
};

const getAvatarStatusKey = (avatar?: string, fallbackName = '') => {
  const identity = getAvatarIdentity(avatar);
  if (!identity) {
    return `fallback:${fallbackName}`;
  }

  return `${identity.avatarId}|${identity.refreshKey}`;
};

export default function Avatar({
  user,
  textSize,
}: {
  user: UserType;
  textSize?: TextSize;
}) {
  const { avatarStatuses, setAvatarStatus } = useAvatarContext();

  const avatarStatusKey = getAvatarStatusKey(user.avatar, user.name);
  const avatarStatus = avatarStatuses[avatarStatusKey];
  
  const formattedName = user.name[0].toUpperCase();

  return user.avatar && avatarStatus !== 'fallback' ? (
    <Img user={user} key={avatarStatusKey} avatarStatusKey={avatarStatusKey} setAvatarStatus={setAvatarStatus} />
  ) : (
    <FallbackImg user={user} formattedName={formattedName} textSize={textSize} />
  );
}

interface ImgProps {
  user: UserType;
  avatarStatusKey: string;
  setAvatarStatus: (key: string, status: AvatarStatus) => void;
}

const Img = ({ user, avatarStatusKey, setAvatarStatus }: ImgProps) => {
  if (!user.avatar) {
    setAvatarStatus(avatarStatusKey, 'fallback');
    return null;
  }

  const identity = getAvatarIdentity(user.avatar);
  const src = identity?.source ?? getAvatarSrc(user.avatar);

  return (
    <img
      className="rounded-full w-full h-full select-none object-cover aspect-square"
      src={src}
      alt="Avatar"
      onError={() => { setAvatarStatus(avatarStatusKey, 'fallback'); }}
      onLoad={() => { setAvatarStatus(avatarStatusKey, 'avatar'); }}
    />
  );
};

interface FallbackImgProps {
  user: UserType;
  formattedName: string;
  textSize?: TextSize;
}

const FallbackImg = ({ user, formattedName, textSize }: FallbackImgProps) => {
  return (
    <div
      className={`rounded-full bg-gray-300 aspect-square text-white flex items-center justify-center w-full h-full select-none ${textSize ?? 'text-lg'}`}
      style={{ backgroundColor: user.avatarFallback }}
    >
      {user.name && user.name !== 'Wachten op speler' ? formattedName : null}
    </div>
  );
};
