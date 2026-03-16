import dotenv from 'dotenv';
import tryCatch from '../../shared/tryCatch';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

interface BasicProvider {
  name: string;
}

interface FullProvider {
  name: string,
  clientID: string,
  clientSecret: string,
  callbackURL: string,
  authorizationURL: string,
  tokenExchangeURL: string,
  tokenExchangeMethod: 'json' | 'form',
  userInfoURL: string,
  scope: string[],
  getEmail?: (access_token: string) => Promise<string | false | undefined>,
  nameKey: string,
  emailKey: string,

  avatarKey?: string, //? the avatarKey represent the url to the img
  avatarCodeKey: string, //? the avatarCodeKey should be the key representing the avatar id if the provider doesnt give the avatar url directly, we use the getAvatar function with this value together
  getAvatar?: ({ userData, avatarId }: { userData: Record<string, any>, avatarId: string }) => any
}

type oauthProvidersProps = BasicProvider | FullProvider;

// const backendUrl = `http${process.env.SECURE == 'true' ? 's' : ''}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;
const prod = process.env.NODE_ENV !== 'development';
const secure = process.env.SECURE == 'true';
const protocol = secure ? 'https' : 'http';
const backendUrl = prod
  ? (process.env.DNS || "")
  : `${protocol}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`

const oauthProviders: oauthProvidersProps[] = [
  {
    name: 'credentials',
  },
  {
    name: 'google',
    clientID: prod && secure ? process.env.GOOGLE_CLIENT_ID : process.env.DEV_GOOGLE_CLIENT_ID,
    clientSecret: prod && secure ? process.env.GOOGLE_CLIENT_SECRET : process.env.DEV_GOOGLE_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/google`,
    authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenExchangeURL: 'https://oauth2.googleapis.com/token',
    tokenExchangeMethod: 'json',
    userInfoURL: 'https://www.googleapis.com/oauth2/v1/userinfo',
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email"
    ],
    nameKey: 'name',
    emailKey: 'email',
    avatarKey: 'picture',
    avatarCodeKey: ''
  },
  {
    name: 'github',
    clientID: prod && secure ? process.env.GITHUB_CLIENT_ID : process.env.DEV_GITHUB_CLIENT_ID,
    clientSecret: prod && secure ? process.env.GITHUB_CLIENT_SECRET : process.env.DEV_GITHUB_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/github`,
    authorizationURL: 'https://github.com/login/oauth/authorize',
    tokenExchangeURL: 'https://github.com/login/oauth/access_token',
    tokenExchangeMethod: 'json',
    userInfoURL: 'https://api.github.com/user',
    scope: ['read:user', 'user:email'],
    nameKey: 'login',
    emailKey: 'email',
    avatarKey: 'avatar_url',
    getEmail: async (access_token: string) => {
      const getEmail = async () => {
        const url = 'https://api.github.com/user/emails';
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${access_token}`
          },
        })
        if (!response.ok) { return false; }
        const emails = await response.json();
        // return data;
        if (!Array.isArray(emails)) { return false; }
        return emails;
      }

      const [getEmailError, getEmailResponse] = await tryCatch(getEmail);
      if (getEmailError) {
        console.log(getEmailError);
        return false;
      }

      if (!getEmailResponse) { return false; }

      //? if we found the email we set it to the user object
      let mainEmail: string | undefined;
      for (const email of getEmailResponse) {
        if (email.primary) { mainEmail = email.email; }
      }
      if (!mainEmail) { mainEmail = getEmailResponse?.[0]?.email; }
      return mainEmail;
    },
  },
  {
    name: 'discord',
    clientID: prod && secure ? process.env.DISCORD_CLIENT_ID : process.env.DEV_DISCORD_CLIENT_ID,
    clientSecret: prod && secure ? process.env.DISCORD_CLIENT_SECRET : process.env.DEV_DISCORD_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/discord`,
    authorizationURL: 'https://discord.com/oauth2/authorize',
    tokenExchangeURL: 'https://discord.com/api/oauth2/token',
    tokenExchangeMethod: 'form',
    userInfoURL: 'https://discord.com/api/users/@me',
    scope: [
      "identify",
      'email',
    ],
    nameKey: 'username',
    emailKey: 'email',
    avatarCodeKey: 'avatar',
    getAvatar: ({ userData, avatarId }: { userData: Record<string, any>, avatarId: string }) => {
      if (!avatarId) {
        // Default avatar (based on discriminator % 5)
        // const defaultAvatarIndex = userId % 5;
        // return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
        return undefined;
      }
      const userId = userData.id;
      const format = avatarId.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${userId}/${avatarId}.${format}`;
    }
  },
  {
    name: 'facebook',
    clientID: prod && secure ? process.env.FACEBOOK_CLIENT_ID : process.env.DEV_FACEBOOK_CLIENT_ID,
    clientSecret: prod && secure ? process.env.FACEBOOK_CLIENT_SECRET : process.env.DEV_FACEBOOK_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/facebook`,
    authorizationURL: 'https://www.facebook.com/v10.0/dialog/oauth',
    tokenExchangeURL: 'https://graph.facebook.com/v10.0/oauth/access_token',
    tokenExchangeMethod: 'form',
    userInfoURL: 'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)',
    scope: ['public_profile', 'email'],
    nameKey: 'name',
    emailKey: 'email',
    avatarCodeKey: '',
    getAvatar: ({ userData }: { userData: Record<string, any> }) => {
      return userData?.picture?.data?.url || undefined;
    }
  },
  {
    name: 'microsoft',
    clientID: prod && secure ? process.env.MICROSOFT_CLIENT_ID! : process.env.DEV_MICROSOFT_CLIENT_ID!,
    clientSecret: prod && secure ? process.env.MICROSOFT_CLIENT_SECRET! : process.env.DEV_MICROSOFT_CLIENT_SECRET!,
    callbackURL: `${backendUrl}/auth/callback/microsoft`,
    // 'common' allows both personal and work accounts
    authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenExchangeURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    tokenExchangeMethod: 'form',
    userInfoURL: 'https://graph.microsoft.com/v1.0/me',
    scope: ['openid', 'profile', 'email', 'User.Read'],
    nameKey: 'displayName',
    emailKey: 'mail', // Note: some personal accounts use 'userPrincipalName' if 'mail' is null
    avatarCodeKey: 'id',
    getAvatar: async ({ userData: _userData, avatarId }: { userData: Record<string, any>, avatarId: string }) => {
      // Microsoft doesn't give a URL, it gives a binary blob via a separate endpoint.
      // You typically need the access_token here to fetch it. 
      // If your architecture doesn't pass the token to getAvatar, 
      // you can return this Graph URL for your frontend to fetch (with a token):
      return `https://graph.microsoft.com/v1.0/users/${avatarId}/photo/$value`;
    },
    getEmail: async (access_token: string) => {
      const getEmail = async () => {
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json'
          },
        });
        if (!response.ok) { return false; }
        const data = await response.json();
        if (!data) { return false; }
        return data;
      };

      const [getEmailError, getEmailResponse] = await tryCatch(getEmail);
      if (getEmailError) {
        console.log(getEmailError);
        return false;
      }

      if (!getEmailResponse) { return false; }

      const tempEmailReponse: any = getEmailResponse;

      // 1. 'mail' is the standard property for work/school accounts
      // 2. 'userPrincipalName' is used for personal accounts or as a fallback
      const mainEmail = tempEmailReponse.mail || tempEmailReponse.userPrincipalName;
      return mainEmail || false;
    }
  }
];

export default oauthProviders;