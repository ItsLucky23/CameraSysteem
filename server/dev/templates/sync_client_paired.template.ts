//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, SyncClientResponse, SyncClientInput, SyncServerOutput } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

// Types are imported from the generated file based on the _server.ts definition
type PagePath = '{{PAGE_PATH}}';
type SyncName = '{{SYNC_NAME}}';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null; // target client's session token (fetch session only when needed)
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({  }: SyncParams): Promise<SyncClientResponse> => {
  // PAIRED SYNC: Types are shared with the _server.ts file
  // clientInput type comes from _server.ts SyncParams
  // serverOutput type is inferred from _server.ts return value
  // Use functions.session.getSession(token) when you need session data for this target client.
  // Returning error here only affects the current target client and does not stop other clients.

  // Example: Only allow users on set page to receive the event
  // const targetUser = token ? await functions.session.getSession(token) : null;
  // if (targetUser?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: 'success',
    // Add any additional data to pass to the client
  };
};
