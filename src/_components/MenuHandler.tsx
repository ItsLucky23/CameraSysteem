/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createContext, use, useState, ReactNode, ReactElement, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { setMenuHandlerRef } from 'src/_functions/menuHandler';

// Types
interface MenuEntry {
  id: string;
  element: ReactElement;
  options: MenuOptions;
  isClosing?: boolean;
  soonIsTop?: boolean;
  resolver?: (value: unknown) => void;
}

interface MenuOptions {
  dimBackground?: boolean;
  background?: string;
  size?: 'sm' | 'md' | 'lg';
}

interface MenuHandlerContextType {
  open: (element: ReactElement, options?: MenuOptions) => Promise<unknown>;
  replace: (element: ReactElement, options?: MenuOptions) => Promise<unknown>;
  close: () => void;
  closeAll: () => void;
  logStack: () => void;
}

interface SlideInWrapperProps {
  children: ReactNode;
  isTop: boolean;
  options: MenuOptions;
  isClosing?: boolean;
  soonIsTop?: boolean;
}

const SlideInWrapper = ({ children, options, isTop, isClosing, soonIsTop }: SlideInWrapperProps) => {
  const [location, setLocation] = useState<'left' | 'center' | 'right'>('right');
  const hasMountedRef = useRef(false);

  useLayoutEffect(() => {
    // Start with off-screen to the right
    setLocation('right');

    const timer = requestAnimationFrame(() => {
      hasMountedRef.current = true;
      setLocation('center'); // trigger the transition
    });

    return () => { cancelAnimationFrame(timer); };
  }, []);

  let targetLocation: 'left' | 'center' | 'right' = 'left';
  if (isClosing) {
    targetLocation = 'right';
  } else if (isTop || soonIsTop) {
    targetLocation = 'center';
  }

  useEffect(() => {
    // Keep the first-frame mount animation, then sync to the derived target state.
    if (!hasMountedRef.current) {
      return;
    }

    if (location !== targetLocation) {
      setLocation(targetLocation);
    }
  }, [location, targetLocation]);

  const isVisible = !isClosing;

  return (
    <div
      className={`${isTop ? 'relative' : 'absolute inset-0'} flex min-h-0 w-full flex-col overflow-y-auto text-text-primary transition-all duration-200 origin-center
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}
        ${options.background ?? ''}
      `}
    >
      {children}
    </div>
  );
};


const MenuHandlerContext = createContext<MenuHandlerContextType | null>(null);

export function useMenuHandler() {
  const ctx = use(MenuHandlerContext);
  if (!ctx) throw new Error('useMenuHandler must be used within MenuHandlerProvider');
  return ctx;
}

export function MenuHandlerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<MenuEntry[]>([]);
  const attemptToCloseAllRef = useRef(false);

  const submitTopFormFromEnter = useCallback(() => {
    const menuRoot = document.querySelector('#MENUHANDLER');
    if (!(menuRoot instanceof HTMLElement)) return;

    const form = menuRoot.querySelector('form[data-menuhandler-submit-on-enter="true"]');
    if (!(form instanceof HTMLFormElement)) return;

    form.requestSubmit();
  }, []);

  const open = useCallback((element: ReactElement, options: MenuOptions = {}) => {
    return new Promise<unknown>((resolve) => {
      const id = uuidv4();
      setStack((prev) => [...prev, { id, element, options, resolver: resolve }]);
    });
  }, []);

  const replace = useCallback((element: ReactElement, options: MenuOptions = {}) => {
    return new Promise<unknown>((resolve) => {
      const id = uuidv4();
      setStack((prev) => {
        const newStack = [...prev];
        newStack.pop();
        newStack.push({ id, element, options, resolver: resolve });
        return newStack;
      });
    });
  }, []);

  const close = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const lastitem = prev.length === 1;
      const newStack = [...prev];
      const top = newStack.at(-1);
      const second = newStack.at(-2);

      if (!top) return prev;

      // Prevent double-close
      if (top.isClosing) return prev;

      // Mark top as closing
      if (lastitem) {
        top.resolver?.(null); // Resolve the promise with null
        return [];
      } else {
        newStack[newStack.length - 1] = { ...top, isClosing: true };
        if (second) {
          newStack[newStack.length - 2] = { ...second, soonIsTop: true };
        }
      }

      // Delay removal for animation
      setTimeout(() => {
        setStack((current) => {
          const lastIndex = current.findIndex(s => s.id === top.id);
          if (lastIndex !== -1 && current[lastIndex].isClosing) {
            current[lastIndex].resolver?.(null);
            
            // If there's a second item, and it was marked as soonIsTop, update it
            const secondIndex = current.findIndex(s => s.id === second?.id);
            if (secondIndex !== -1 && current[secondIndex].soonIsTop) {
              current[secondIndex] = { ...current[secondIndex], soonIsTop: false };
            }

            return current.filter(s => s.id !== top.id);
          }
          return current;
        });
      }, 200); // Match animation duration

      return newStack;
    });
  }, []);


  const closeAll = useCallback(() => {
    setStack((prev) => {
      for (const entry of prev) entry.resolver?.(null);
      return [];
    });
  }, []);

  const logStack = useCallback(() => {
    console.log('Menu stack:', stack.map(s => s.id));
  }, [stack]);



  const stackTop = stack.at(-1);
  const sizeClass = stackTop?.options.size
    ? { sm: '384px', md: '512px', lg: '768px' }[stackTop.options.size]
    : '384px';

  const contextValue = useMemo(() => ({
    open, replace, close, closeAll, logStack
  }), [open, replace, close, closeAll, logStack]);

  useEffect(() => {
    setMenuHandlerRef(contextValue);
    return () => {
      setMenuHandlerRef(null);
    };
  }, [contextValue]);

  useEffect(() => {
    if (!import.meta.hot) return;
    import.meta.hot.dispose(() => {
      setStack([]);
      setMenuHandlerRef(null);
    });
  }, []);

  useEffect(() => {
    if (stack.length === 0) return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [stack.length]);

  useEffect(() => {
    if (stack.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.isComposing) return;

      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      submitTopFormFromEnter();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [stack.length, submitTopFormFromEnter]);

  return (
    <MenuHandlerContext value={contextValue}>
      {children}
      {createPortal(
        <div
          role="button"
          tabIndex={0}
          className={`absolute top-0 left-0 w-full h-full flex items-center justify-center z-[1000] overflow-hidden transition-colors duration-200 ${stack.length === 0 ? 'pointer-events-none' : ''}`}
          style={{ backgroundColor: !stackTop?.isClosing && stackTop?.options.dimBackground === true ? 'rgba(0, 0, 0, 0.7)' : 'transparent' }}
          onMouseDown={() => { attemptToCloseAllRef.current = true; }}
          onMouseUp={() => {
            if (!attemptToCloseAllRef.current) { return }
            attemptToCloseAllRef.current = false;
            closeAll();
          }}
        >
          <div
            role="presentation"
            id="MENUHANDLER"
            className={`relative flex min-h-0 flex-col overflow-hidden rounded-md transition-all duration-200 max-h-[90vh] ${stackTop && !stackTop.isClosing ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'}`}
            style={{ width: sizeClass }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onMouseUp={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { e.stopPropagation(); }}
          >
            {stack.map((entry, index) => (
              <SlideInWrapper
                key={entry.id}
                isTop={index === stack.length - 1}
                isClosing={entry.isClosing}
                soonIsTop={entry.soonIsTop}
                options={entry.options}
              >
                {entry.element}
              </SlideInWrapper>
            ))}
          </div>
        </div>,
        document.body
      )}
    </MenuHandlerContext>
  );
}