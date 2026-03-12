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

  const isVisible = !isClosing;

  return (
    <div
      className={`w-full overflow-hidden absolute flex flex-col text-text-primary transition-all duration-200 origin-center
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

  const [lastChildHeight, setLastChildHeight] = useState<number>(0);

  const updateLastChildHeight = useCallback(() => {
    const target = document.querySelector('#MENUHANDLER');
    const lastChild = target?.lastElementChild;
    if (!(lastChild instanceof HTMLElement)) {
      setLastChildHeight(0);
      return;
    }

    const maxHeight = window.innerHeight * 0.9;
    const height = Math.min(lastChild.clientHeight, maxHeight);
    setLastChildHeight(height);
  }, []);

  useLayoutEffect(() => {
    updateLastChildHeight();

    const target = document.querySelector('#MENUHANDLER');
    if (!(target instanceof HTMLElement)) return;

    const observer = new ResizeObserver(() => {
      updateLastChildHeight();
    });

    observer.observe(target);
    const lastChild = target.lastElementChild;
    if (lastChild instanceof HTMLElement) {
      observer.observe(lastChild);
    }

    const onResize = () => {
      updateLastChildHeight();
    };
    window.addEventListener('resize', onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [stack.length, updateLastChildHeight]);

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
            className={`rounded-md overflow-hidden relative transition-all duration-200 ${stackTop?.isClosing ? 'scale-95 opacity-0 pointer-events-none' : 'scale-100 opacity-100'}`}
            style={{ width: sizeClass, height: `${String(lastChildHeight)}px` }}
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