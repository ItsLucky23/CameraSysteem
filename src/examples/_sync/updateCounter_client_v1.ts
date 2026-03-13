import { Functions, SyncClientResponse, SyncClientInput, SyncServerOutput } from '../../../src/_sockets/apiTypes.generated';

type PagePath = 'examples';
type SyncName = 'updateCounter';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ token, functions }: SyncParams): Promise<SyncClientResponse> => {
  const user = token ? await functions.session.getSession(token) : null;
  console.log('Sync client check:', user?.location?.pathName);

  if (user?.location?.pathName === '/examples' || user?.location?.pathName === '/docs') {
    return {
      status: 'success',
      randomKey: true,
    };
  }

  return { status: 'error', errorCode: 'sync.clientFilteredOut' };
};
