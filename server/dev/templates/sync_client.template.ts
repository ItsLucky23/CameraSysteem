//@ts-expect-error We replace {{REL_PATH}} with the relative path to the project root
import { Functions, SyncClientResponse } from '{{REL_PATH}}src/_sockets/apiTypes.generated';


export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    // message: string;
  };
  serverOutput: {
    // Define the data shape returned from the server e.g.
    // message: string;
  };
  token: string | null; // target client's session token (fetch session only when needed)
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({  }: SyncParams): Promise<SyncClientResponse> => {
  // THIS FILE RUNS ON THE SERVER AND IT EXECUTES FOR EVERY CLIENT THAT IS IN THE GIVEN ROOM
  // Use functions.session.getSession(token) when you need session data for this target client.

  // Return { status: 'error', message: '...' } OR { status: 'error', errorCode: '...' }
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