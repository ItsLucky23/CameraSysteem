/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createContext, use, useState, ReactNode, ReactElement, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';

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

  useLayoutEffect(() => {
    // Start with off-screen to the right
    setLocation('right');

    const timer = requestAnimationFrame(() => {
      setLocation('center'); // trigger the transition
    });

    return () => { cancelAnimationFrame(timer); };
  }, []);

  useEffect(() => {
    // console.log("isClosing: ", isClosing, 'location: ', location, "top: ", isTop)
    if (!isTop && location === 'center') {
      setLocation('left'); // trigger the transition    
    } else if (isClosing && location === 'center') {
      setLocation('right'); // trigger the transition
    } else if (location === 'left' && soonIsTop) {
      setLocation('center'); // trigger the transition
    }
  }, [isTop, isClosing, soonIsTop, location]);

  const translate =
    location === 'center'
      ? '0 0'
      : (location === 'left'
        ? '-100% 0'
        : '100% 0'); // initial

  const isVisible = !isClosing;

  return (
    <div
      className={`w-full overflow-hidden absolute flex flex-col text-black transition-all duration-200 origin-center
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}
        ${options.background ?? ''}
      `}
      style={{ translate }}
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
          const last = current.at(-1);
          const tempSecond = current.at(-2);
          if (last?.id === top.id && last.isClosing) {
            last.resolver?.(null);
            if (tempSecond?.soonIsTop && tempSecond.id === second?.id) {
              current[current.length - 2] = { ...tempSecond, soonIsTop: false };
            }
            return current.slice(0, -1);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => { globalThis.removeEventListener('keydown', handleKeyDown); };
  }, [close]);

  const stackTop = stack.at(-1);
  const sizeClass = stackTop?.options.size
    ? { sm: '384px', md: '512px', lg: '768px' }[stackTop.options.size]
    : '384px';

  const [lastChildHeight, setLastChildHeight] = useState<number>(0);

  useEffect(() => {
    const lastChild = document.querySelector('#MENUHANDLER')?.lastElementChild;
    if (lastChild) {
      const maxHeight = window.innerHeight * 0.9;
      const height = Math.min(lastChild.clientHeight, maxHeight);
      setLastChildHeight(height);
    } else {
      setLastChildHeight(0);
    }
  }, [stack]);

  let attempToCloseAll = false;

  const contextValue = useMemo(() => ({
    open, replace, close, closeAll, logStack
  }), [open, replace, close, closeAll, logStack]);

  return (
    <MenuHandlerContext value={contextValue}>
      {children}
      {createPortal(
        <div
          role="button"
          tabIndex={0}
          className={`absolute top-0 left-0 w-full h-full flex items-center justify-center z-[1000] overflow-hidden ${stack.length === 0 ? 'pointer-events-none' : ''}`}
          style={{ backgroundColor: stackTop?.options.dimBackground === true ? 'rgba(0, 0, 0, 0.7)' : 'transparent' }}
          onMouseDown={() => { attempToCloseAll = true; }}
          onMouseUp={() => {
            if (!attempToCloseAll) { return }
            closeAll();
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') closeAll(); }}
        >
          <div
            role="presentation"
            id="MENUHANDLER"
            className={`rounded-md overflow-hidden relative h-auto`}
            style={{ width: sizeClass, height: `${String(lastChildHeight)}px` }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onMouseUp={(e) => { e.stopPropagation(); }}
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