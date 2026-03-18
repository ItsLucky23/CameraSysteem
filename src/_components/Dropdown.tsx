import { faCaretDown, faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

type PrimitiveDropdownItem = string | number;
type DropdownValue = PrimitiveDropdownItem | string;
type DropdownSize = "sm" | "md" | "lg" | "xl";
type DropdownDirection = "up" | "down";

interface DropdownItem {
  item: ReactNode;
  value?: DropdownValue;
  placeholder?: string;
  selectedItem?: ReactNode;
  searchText?: string;
  key?: string;
  disabled?: boolean;
}

type DropdownRenderableItem = PrimitiveDropdownItem | ReactNode;
type DropdownInputItem = DropdownRenderableItem | DropdownItem;

interface DropdownSelectMeta {
  value: DropdownValue;
  index: number;
  label: string;
}

interface NormalizedOption {
  key: string;
  value: DropdownValue;
  label: string;
  item: ReactNode;
  selectedItem: ReactNode;
  searchText: string;
  disabled: boolean;
  index: number;
}

interface DropdownProps {
  items: DropdownInputItem[];
  onChange?: (value: DropdownValue) => void;
  onSelect?: (meta: DropdownSelectMeta) => void;
  placeholder?: ReactNode;
  value?: DropdownValue;
  className?: string;
  menuClassName?: string;
  size?: DropdownSize;
  showSearch?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
}

export default function Dropdown({
  items,
  onChange,
  onSelect,
  placeholder,
  value,
  className = "",
  menuClassName = "",
  size = "md",
  showSearch = false,
  searchPlaceholder = "Search...",
  noResultsText = "No results",
}: DropdownProps) {
  const animationDuration = 200;
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [isMenuPositionReady, setIsMenuPositionReady] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [menuDirection, setMenuDirection] = useState<DropdownDirection>("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(240);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const openAnimationFrameRef = useRef<number | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });

  const sizeConfig: Record<DropdownSize, { minWidthPx: number; triggerWidth: string; option: string; icon: string }> = {
    sm: { minWidthPx: 160, triggerWidth: "w-40", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
    md: { minWidthPx: 220, triggerWidth: "w-[220px]", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
    lg: { minWidthPx: 320, triggerWidth: "w-80", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
    xl: { minWidthPx: 420, triggerWidth: "w-[420px]", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
  };

  const isPrimitiveItem = (item: unknown): item is PrimitiveDropdownItem =>
    typeof item === "string" || typeof item === "number";

  const isDropdownObjectItem = (item: DropdownInputItem): item is DropdownItem =>
    typeof item === "object" && item !== null && "item" in item;

  const normalizedOptions: NormalizedOption[] = items.map((item, index) => {
    if (isDropdownObjectItem(item)) {
      const rawItem = item.item ?? item.placeholder ?? `Item ${index + 1}`;
      const label = item.placeholder ?? (isPrimitiveItem(rawItem) ? String(rawItem) : `Item ${index + 1}`);

      return {
        key: item.key ?? `${String(item.value ?? label)}-${index}`,
        value: item.value ?? (isPrimitiveItem(rawItem) ? rawItem : `jsx-item-${index}`),
        label,
        item: rawItem,
        selectedItem: item.selectedItem ?? (isPrimitiveItem(rawItem) ? rawItem : label),
        searchText: item.searchText ?? label,
        disabled: item.disabled ?? false,
        index,
      };
    }

    if (isPrimitiveItem(item)) {
      return {
        key: `${String(item)}-${index}`,
        value: item,
        label: String(item),
        item,
        selectedItem: item,
        searchText: String(item),
        disabled: false,
        index,
      };
    }

    return {
      key: `jsx-item-${index}`,
      value: `jsx-item-${index}`,
      label: `Item ${index + 1}`,
      item,
      selectedItem: item,
      searchText: `Item ${index + 1}`,
      disabled: false,
      index,
    };
  });

  const updateMenuPosition = () => {
    if (!dropdownRef.current) return;

    const rect = dropdownRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const triggerGap = 4;
    const viewportHeight = globalThis.innerHeight;
    const searchHeight = showSearch ? 56 : 0;
    const estimatedOptionHeight = 38;
    const preferredMenuHeight = Math.min(320, searchHeight + normalizedOptions.length * estimatedOptionHeight + 12);
    const measuredMenuHeight = menuRef.current?.offsetHeight ?? 0;
    const estimatedMenuHeight = Math.max(preferredMenuHeight, measuredMenuHeight);

    const spaceBelow = viewportHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const menuBottomIfDown = rect.bottom + triggerGap + estimatedMenuHeight;
    const shouldOpenUp = menuBottomIfDown > viewportHeight - viewportPadding;

    const availableSpace = shouldOpenUp ? spaceAbove : spaceBelow;
    const computedMaxHeight = Math.max(140, availableSpace - triggerGap);
    const renderedMenuHeight = Math.min(estimatedMenuHeight, computedMaxHeight);

    const top = shouldOpenUp
      ? Math.max(viewportPadding, rect.top - triggerGap - renderedMenuHeight)
      : rect.bottom + triggerGap;

    setMenuDirection(shouldOpenUp ? "up" : "down");
    setMenuMaxHeight(computedMaxHeight);

    setMenuPosition({
      top,
      left: rect.left,
      width: rect.width,
    });
  };

  const openDropdown = () => {
    if (closeTimeoutRef.current) {
      globalThis.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (openAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
      openAnimationFrameRef.current = null;
    }

    setSearchValue("");
    setIsMenuMounted(true);
    setIsMenuPositionReady(false);
    setIsOpen(true);
    setIsMenuVisible(false);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setIsMenuVisible(false);

    if (openAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
      openAnimationFrameRef.current = null;
    }

    if (closeTimeoutRef.current) {
      globalThis.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = globalThis.setTimeout(() => {
      setIsMenuMounted(false);
      setIsMenuPositionReady(false);
      closeTimeoutRef.current = null;
    }, animationDuration);
  };

  const toggleDropdown = () => {
    if (isOpen) {
      closeDropdown();
      return;
    }

    openDropdown();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedInsideTrigger = dropdownRef.current?.contains(target);
      const clickedInsideMenu = menuRef.current?.contains(target);

      if (!clickedInsideTrigger && !clickedInsideMenu) {
        closeDropdown();
      }
    }

    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isMenuMounted) return;

    updateMenuPosition();

    const handleReposition = () => {
      updateMenuPosition();
    };

    globalThis.addEventListener("resize", handleReposition);
    globalThis.addEventListener("scroll", handleReposition, true);

    return () => {
      globalThis.removeEventListener("resize", handleReposition);
      globalThis.removeEventListener("scroll", handleReposition, true);
    };
  }, [isMenuMounted, normalizedOptions.length, showSearch, size]);

  useLayoutEffect(() => {
    if (!isMenuMounted || !isOpen || isMenuPositionReady) return;

    updateMenuPosition();
    setIsMenuPositionReady(true);
  }, [isMenuMounted, isOpen, isMenuPositionReady, normalizedOptions.length, showSearch, size]);

  useEffect(() => {
    if (!isMenuMounted || !isOpen || !isMenuPositionReady || isMenuVisible) return;

    openAnimationFrameRef.current = globalThis.requestAnimationFrame(() => {
      openAnimationFrameRef.current = globalThis.requestAnimationFrame(() => {
        setIsMenuVisible(true);
        openAnimationFrameRef.current = null;
      });
    });

    return () => {
      if (openAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
        openAnimationFrameRef.current = null;
      }
    };
  }, [isMenuMounted, isOpen, isMenuPositionReady, isMenuVisible]);

  useEffect(() => {
    if (!showSearch || !isMenuVisible) return;

    searchInputRef.current?.focus();
  }, [showSearch, isMenuVisible]);

  useEffect(() => {
    if (!isMenuMounted) return;
    updateMenuPosition();
  }, [searchValue]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        globalThis.clearTimeout(closeTimeoutRef.current);
      }

      if (openAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
      }
    };
  }, []);

  if (normalizedOptions.length === 0) return null;

  const selectedOption = value !== undefined
    ? normalizedOptions.find((option) => option.value === value)
    : undefined;

  const filteredOptions = normalizedOptions.filter((option) => {
    if (!showSearch || !searchValue.trim()) return true;

    const query = searchValue.trim().toLowerCase();
    return `${option.label} ${option.searchText} ${String(option.value)}`.toLowerCase().includes(query);
  });

  const currentLabel = selectedOption?.selectedItem ?? placeholder;
  const optionsMaxHeight = Math.max(96, menuMaxHeight - (showSearch ? 56 : 0));

  return (
    <div
      ref={dropdownRef}
      className={`
        relative inline-flex max-w-full
        ${className}
      `}
    >
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleDropdown();
          }
        }}
        className={`
          flex min-w-0 items-center justify-between gap-3 rounded-md border border-container1-border
          bg-container1 transition-colors hover:bg-container1-hover cursor-pointer select-none
          px-2.5 py-2 text-sm ${sizeConfig[size].triggerWidth}
        `}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={toggleDropdown}
      >
        <div className={`min-w-0 truncate ${selectedOption ? "text-title font-medium" : "text-common"}`}>
          {currentLabel}
        </div>

        <FontAwesomeIcon
          icon={faCaretDown}
          className={`${sizeConfig[size].icon} text-common transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {isMenuMounted && createPortal(
        <div
          ref={menuRef}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: Math.max(menuPosition.width, sizeConfig[size].minWidthPx),
          }}
          className={`
            fixed z-[9999] rounded-md
            border border-container1-border bg-container1 shadow-lg
            ${isMenuPositionReady ? "transition duration-200 ease-out" : ""}
            ${menuDirection === "up" ? "origin-bottom" : "origin-top"}
            ${menuClassName}
            ${!isMenuPositionReady
              ? menuDirection === "up"
                ? "opacity-0 scale-90 translate-y-2 pointer-events-none"
                : "opacity-0 scale-90 -translate-y-2 pointer-events-none"
              : isMenuVisible
              ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
              : menuDirection === "up"
                ? "opacity-0 scale-90 translate-y-2 pointer-events-none"
                : "opacity-0 scale-90 -translate-y-2 pointer-events-none"
            }
          `}
        >
          {showSearch && (
            <div className="p-2 border-b border-container1-border">
              <input
                ref={searchInputRef}
                value={searchValue}
                onChange={(event) => { setSearchValue(event.target.value); }}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-container2-border bg-container2 p-2 text-sm text-title outline-none focus:border-primary-border"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              />
            </div>
          )}

          <div className="flex flex-col overflow-y-auto p-1" style={{ maxHeight: optionsMaxHeight }} role="listbox">
            {filteredOptions.map((option) => {
              const isSelected = option.value === value;

              return (
                <div
                  key={option.key}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled}
                  tabIndex={option.disabled ? -1 : 0}
                  className={`
                    flex w-full items-center justify-between gap-2 rounded-sm text-left transition-colors
                    border border-transparent
                    ${sizeConfig[size].option}
                    ${option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
                    ${isSelected ? "bg-container2 border-container2-border text-title font-medium" : "hover:bg-container1-hover text-title"}
                  `}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (option.disabled) return;

                    onChange?.(option.value);
                    onSelect?.({ value: option.value, index: option.index, label: option.label });
                    closeDropdown();
                  }}
                  onKeyDown={(event) => {
                    if (option.disabled) return;
                    if (event.key !== "Enter" && event.key !== " ") return;

                    event.preventDefault();
                    onChange?.(option.value);
                    onSelect?.({ value: option.value, index: option.index, label: option.label });
                    closeDropdown();
                  }}
                >
                  <span className="flex-1 min-w-0">{option.item}</span>
                  {isSelected && <FontAwesomeIcon icon={faCheck} className="ml-2 text-xs" />}
                </div>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-common">{noResultsText}</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}