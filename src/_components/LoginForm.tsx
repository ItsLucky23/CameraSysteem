import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { backendUrl, loginRedirectUrl, loginPageUrl, providers, SessionLayout, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import notify from "../_functions/notify";
import { useTranslator } from "../_functions/translator";

import BrandMark from "./ui/BrandMark";
import MaterialIcon from "./ui/MaterialIcon";

interface Props {
  formType: "login" | "register";
}

export default function LoginForm({ formType }: Props) {
  const translate = useTranslator();
  const isLogin = formType === "login";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      buttonRef.current?.click();
    }
  };

  const handleSubmit = async (event: React.MouseEvent<HTMLButtonElement>, provider: string) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);

    if (provider !== "credentials") {
      globalThis.location.href = `${backendUrl}/auth/api/${provider}`;
      return;
    }

    const form = (event.target as HTMLElement).closest("form");
    if (!form) {
      setLoading(false);
      return;
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
      notify.error({ key: 'common/.404' });
      setLoading(false);
      return;
    }

    if (!response.status) {
      const reasonKey = typeof response.reason === 'string' && response.reason.length > 0
        ? response.reason
        : 'api.internalServerError';
      notify.error({ key: reasonKey });
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

  const eyebrow = translate({ key: isLogin ? 'aperture.auth.eyebrow' : 'aperture.auth.registerEyebrow' });
  const title = translate({ key: isLogin ? 'aperture.auth.signInTitle' : 'aperture.auth.registerTitle' });
  const subtitle = translate({ key: isLogin ? 'aperture.auth.signInSubtitle' : 'aperture.auth.registerSubtitle' });
  const ctaLabel = translate({ key: isLogin ? 'aperture.auth.signIn' : 'aperture.auth.registerCta' });
  const switchPrompt = translate({ key: isLogin ? 'aperture.auth.noAccount' : 'aperture.auth.registerHasAccount' });
  const switchCta = translate({ key: isLogin ? 'aperture.auth.createOne' : 'aperture.auth.registerSignIn' });
  const switchHref = isLogin ? '/register' : '/login';

  return (
    <div className="flex h-full w-full bg-background">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-white md:flex md:w-[46%]"
        style={{ background: 'linear-gradient(155deg, #1A1A1A 0%, #2A2538 100%)' }}
      >
        <svg
          className="absolute -right-32 -top-32 opacity-20"
          width={520}
          height={520}
          viewBox="0 0 100 100"
          fill="none"
        >
          <circle cx="50" cy="50" r="49" stroke="#fff" strokeWidth="0.4" />
          <circle cx="50" cy="50" r="38" stroke="#fff" strokeWidth="0.4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line
              key={angle}
              x1="50"
              y1="50"
              x2={50 + 49 * Math.cos((angle * Math.PI) / 180)}
              y2={50 + 49 * Math.sin((angle * Math.PI) / 180)}
              stroke="#fff"
              strokeWidth="0.3"
            />
          ))}
          <circle cx="50" cy="50" r="6" fill="#E8A87C" />
        </svg>

        <div className="relative flex items-center gap-3">
          <BrandMark size={32} color="#E8A87C" />
          <span className="font-display text-2xl text-white">{translate({ key: 'aperture.brand' })}</span>
        </div>

        <div className="relative max-w-[460px]">
          <h2 className="font-display text-[44px] leading-[1.1] text-white">
            {translate({ key: 'aperture.auth.headline' })}
          </h2>
          <p className="mt-4 text-[14.5px] leading-[1.6] text-white/70">
            {translate({ key: 'aperture.auth.subline' })}
          </p>
        </div>

        <div className="relative flex items-center gap-3 text-xs text-white/55">
          <span className="h-px w-6 bg-white/30" />
          <span className="font-mono tracking-[0.1em]">{translate({ key: 'aperture.version' })}</span>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex items-center justify-end gap-4 px-6 py-7 md:px-9">
          <span className="text-sm text-common">{switchPrompt}</span>
          <Link
            to={switchHref}
            className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
          >
            {switchCta}
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16 md:px-9">
          <form
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            className="w-full max-w-[380px]"
          >
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              {eyebrow}
            </div>
            <h1 className="font-display text-[36px] leading-tight text-title">{title}</h1>
            <p className="mt-2 mb-8 text-sm text-muted">{subtitle}</p>

            {providers.includes("credentials") && (
              <div className="flex flex-col gap-4">
                {!isLogin && (
                  <div>
                    <label htmlFor="name" className="mb-1.5 block text-[12.5px] font-semibold text-title">
                      {translate({ key: 'aperture.auth.nameLabel' })}
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      placeholder={translate({ key: 'aperture.auth.namePlaceholder' })}
                      className="h-[42px] w-full rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm text-title outline-none transition-colors focus:border-primary"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="email" className="mb-1.5 block text-[12.5px] font-semibold text-title">
                    {translate({ key: 'aperture.auth.emailLabel' })}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder={translate({ key: 'aperture.auth.emailPlaceholder' })}
                    className="h-[42px] w-full rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm text-title outline-none transition-colors focus:border-primary"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="password" className="text-[12.5px] font-semibold text-title">
                      {translate({ key: 'aperture.auth.passwordLabel' })}
                    </label>
                    {isLogin && (
                      <button type="button" className="text-xs text-primary">
                        {translate({ key: 'aperture.auth.forgot' })}
                      </button>
                    )}
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    placeholder={translate({ key: 'aperture.auth.passwordPlaceholder' })}
                    className="h-[42px] w-full rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm text-title outline-none transition-colors focus:border-primary"
                  />
                </div>

                {!isLogin && (
                  <div>
                    <label htmlFor="confirmPassword" className="mb-1.5 block text-[12.5px] font-semibold text-title">
                      {translate({ key: 'aperture.auth.confirmPasswordLabel' })}
                    </label>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      placeholder={translate({ key: 'aperture.auth.passwordPlaceholder' })}
                      className="h-[42px] w-full rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm text-title outline-none transition-colors focus:border-primary"
                    />
                  </div>
                )}

                <button
                  type="button"
                  ref={buttonRef}
                  className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-primary-border bg-primary px-4 text-sm font-semibold text-title-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
                  onClick={(event) => void handleSubmit(event, "credentials")}
                  disabled={loading}
                >
                  <span>
                    {loading
                      ? translate({ key: 'aperture.auth.signingIn' })
                      : ctaLabel}
                  </span>
                  <MaterialIcon name="arrow_forward" size={16} />
                </button>
              </div>
            )}

            {providers.filter((p) => p !== "credentials").length > 0 && (
              <>
                <div className="my-6 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-container1-border" />
                  <span>{translate({ key: 'aperture.auth.orContinue' })}</span>
                  <span className="h-px flex-1 bg-container1-border" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {providers
                    .filter((provider) => provider !== "credentials")
                    .map((provider) => (
                      <button
                        type="button"
                        key={provider}
                        onClick={(event) => void handleSubmit(event, provider)}
                        className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm font-medium text-title transition-colors hover:bg-container1-hover"
                      >
                        <img src={`/${provider}.png`} alt={provider} className="h-4 w-4" />
                        <span className="capitalize">{provider}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
