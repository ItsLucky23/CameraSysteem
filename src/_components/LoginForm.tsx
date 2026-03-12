import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { backendUrl, loginRedirectUrl, loginPageUrl, providers, SessionLayout, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import notify from "../_functions/notify";
import { useTranslator } from "../_functions/translator";

export default function LoginForm({ formType }: { formType: "login" | "register" }) {
  const translate = useTranslator();
  const isLogin = formType === "login";
  const title = isLogin ? "Sign in to your account" : "Create a new account";
  const subtitleText = isLogin ? "Don't have an account yet? " : "Already have an account? ";
  const subtitleLink = isLogin ? "Create one now" : "Log in";
  const redirectURL = isLogin ? "/register" : "/login";
  const buttonText = isLogin ? "Log in" : "Sign up";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buttonRef.current?.click();
    }
  };

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>, provider: string) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (provider !== "credentials") {
      globalThis.location.href = `${backendUrl}/auth/api/${provider}`;
      return;
    }

    const form = (e.target as HTMLElement).closest("form");
    if (!form) {
      setLoading(false);
      console.error("Form not found"); return;
    }

    const getValue = (name: string): string => {
      const input = form.querySelector(`input[name="${name}"]`);
      return (input as HTMLInputElement | null)?.value ?? "";
    };

    const name = getValue("name");
    const email = getValue("email");
    const password = getValue("password");
    const confirmPassword = getValue("confirmPassword");

    const fetchUser = async () => {
      const res = await fetch(`${backendUrl}/auth/api/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, confirmPassword, provider }),
        credentials: "include",
      });
      const sessionToken = res.headers.get("x-session-token");
      const body = (await res.json()) as {
        status: boolean;
        reason: string;
        session: SessionLayout | undefined;
        authenticated?: boolean;
      };

      return {
        ...body,
        sessionToken,
      };
    };

    const [error, response] = await tryCatch(fetchUser);

    if (error || !response) {
      notify.error({ key: 'common/.404' })
      console.error(error ?? "No JSON response");
      setLoading(false); return;
    }

    if (!response.status) {
      notify.error({ key: response.reason });
      setLoading(false);
      return;
    }

    notify.success({ key: response.reason });
    setTimeout(() => {
      if (response.sessionToken && sessionBasedToken) {
        sessionStorage.setItem("token", response.sessionToken);
      }
      globalThis.location.href = response.authenticated ? loginRedirectUrl : loginPageUrl;
    }, 1000);
  };

  return (
    <div className="w-full overflow-y-auto flex items-center justify-center">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- form container needs Enter key handling */}
      <form
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="p-8 bg-container1 rounded-md text-title flex flex-col gap-10 max-w-[400px] w-full"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-lg">{title}</h1>
          <p className="font-medium text-sm text-common">
            {subtitleText}
            <Link to={redirectURL} className="text-primary cursor-pointer">
              {subtitleLink}
            </Link>
          </p>
        </div>

        {providers.includes("credentials") && (
          <>
            <div className="flex flex-col gap-4">
              {!isLogin && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="name" className="font-medium text-sm">{translate({ key: 'login.name' })}</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="John Pork"
                    className="rounded-md w-full h-8 border border-container1-border focus:outline-blue-500 p-2"
                  />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="font-medium text-sm">{translate({ key: 'login.emailAddress' })}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="johnpork@gmail.com"
                  className="rounded-md w-full h-8 border border-container1-border focus:outline-blue-500 p-2"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="password" className="font-medium text-sm">{translate({ key: 'login.password' })}</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="********"
                  className="rounded-md w-full h-8 border border-container1-border focus:outline-blue-500 p-2"
                />
              </div>
              {!isLogin && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="confirmPassword" className="font-medium text-sm">{translate({ key: 'login.confirmPassword' })}</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    placeholder="********"
                    className="rounded-md w-full h-8 border border-container1-border focus:outline-blue-500 p-2"
                  />
                </div>
              )}

              <div className="flex items-center justify-center">
                {isLogin && (
                  <button type="button" className="px-8 h-10 cursor-pointer rounded-md text-primary hover:scale-105 transition-all duration-300">
                    {translate({ key: 'login.forgotPassword' })}
                  </button>
                )}
              </div>

              <button
                type="button"
                ref={buttonRef}
                className="px-8 h-10 rounded-md bg-primary text-white hover:bg-primary-hover hover:scale-105 transition-all duration-300 cursor-pointer"
                onClick={(e) => void handleSubmit(e, "credentials")}
              >
                {loading ? "Loading..." : buttonText}
              </button>
            </div>

            <div className="flex items-center w-full text-gray-500 text-sm before:flex-1 before:border-t before:border-container1-border before:content-[''] after:flex-1 after:border-t after:border-container1-border after:content-['']">
              <span className="px-4 bg-container1 text-title">{translate({ key: 'login.orContinueWith' })}</span>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          {providers
            .filter((p) => p !== "credentials")
            .map((provider) => (
              <button
                type="button"
                key={provider}
                onClick={(e) => void handleSubmit(e, provider)}
                className="h-10 rounded-md cursor-pointer bg-container1 text-title border border-container1-border flex gap-2 items-center justify-center hover:scale-105 transition-all duration-300"
              >
                <img src={`/${provider}.png`} alt={provider} className="w-5 h-5" />
                <span className="text-lg">{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
