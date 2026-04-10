//? here you can add your own route
//? return an object with the success key set to true if the user is allowed to access the route
//? return an object with the redirect key set to the path you want to redirect the user to if you want to redirect the user to a different page
//? return nothing if the user is not allowed to access the route and it will be send back to its previous page
//? if you dont add your page in here it will allow the user to access the page
import { SessionLayout } from "config";
import notify from "src/_functions/notify";

export default function middlewareHandler({ 
  location, 
  session 
}: { 
  location: string, 
  searchParams: Record<string, unknown>, 
  session: SessionLayout | null 
}) {

  switch (location) {

    case '/admin': {
      if (!session) {
        return { redirect: '/login' };
      }

      if (session.admin) {
        return { success: true };
      }

      notify.error({ key: 'middleware.notAdmin' });
      return
    }

    case '/admin/camera-access': {
      if (!session) {
        return { redirect: '/login' };
      }

      if (session.admin) {
        return { success: true };
      }

      notify.error({ key: 'middleware.notAdmin' });
      return;
    }

    case '/cameras': {
      return session ? { success: true } : { redirect: '/login' };
    }

    case '/examples': {
      return session ? { success: true } : { redirect: '/login' };
    }

    case '/example': {
      return { redirect: '/examples' };
    }

    default: {
      return { success: true };
    }
  }
}