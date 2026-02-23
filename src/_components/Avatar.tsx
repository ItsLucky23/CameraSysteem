import { backendUrl, SessionLayout } from "config";

import { useAvatarContext, AvatarStatus } from "./AvatarProvider";

type UserType = SessionLayout | { name: string; avatar?: string; avatarFallback?: string };
type TextSize = "text-sm" | "text-base" | "text-lg" | "text-xl" | "text-2xl" | "text-3xl" | "text-4xl" | "text-5xl" | "text-6xl" | "text-7xl" | "text-8xl" | "text-9xl";

export default function Avatar({
  user,
  textSize,
}: {
  user: UserType;
  textSize?: TextSize;
}) {
  const { avatarStatuses, setAvatarStatus } = useAvatarContext();

  const key = user.avatar ?? user.avatarFallback ?? user.name;
  const avatarStatus = avatarStatuses[key];
  
  const formattedName = user.name[0].toUpperCase();

  return user.avatar && avatarStatus !== 'fallback' ? (
    <Img user={user} key={key} setAvatarStatus={setAvatarStatus} />
  ) : (
    <FallbackImg user={user} formattedName={formattedName} textSize={textSize} />
  );
}

interface ImgProps {
  user: UserType;
  setAvatarStatus: (key: string, status: AvatarStatus) => void;
}

const Img = ({ user, setAvatarStatus }: ImgProps) => {
  if (!user.avatar) {
    const key = user.avatar ?? user.avatarFallback ?? user.name;
    setAvatarStatus(key, 'fallback');
    return null;
  }

  const key: string = user.avatar;

  return (
    <img
      className="rounded-full w-full h-full select-none object-cover aspect-square"
      src={user.avatar.startsWith('http') ? user.avatar : `${backendUrl}/uploads/${user.avatar}`}
      alt="Avatar"
      onError={() => { setAvatarStatus(key, 'fallback'); }}
      onLoad={() => { setAvatarStatus(key, 'avatar'); }}
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
