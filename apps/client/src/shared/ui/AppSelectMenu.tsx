import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AppSelectOption = {
  description?: string;
  disabled?: boolean;
  label: string;
  value: string;
};

type AppSelectMenuProps = {
  ariaLabel?: string;
  className?: string;
  label?: string;
  maxMenuHeight?: number;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  portal?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  value: string;
};

export function AppSelectMenu({
  ariaLabel,
  className = "",
  label,
  maxMenuHeight = 224,
  onChange,
  options,
  placeholder = "Select",
  portal = false,
  searchable = false,
  searchPlaceholder = "Search options",
  value,
}: AppSelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuStyle, setMenuStyle] = useState({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const selectedLabel = selectedOption?.label || placeholder;
  const selectedDescription = selectedOption?.description || "";
  const menuClassName = ["app-select-menu", className].filter(Boolean).join(" ");
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      [option.label, option.description, option.value]
        .some((field) => String(field || "").toLowerCase().includes(query)),
    );
  }, [options, search]);

  function updateMenuPosition() {
    if (!portal || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const gutter = 12;
    const spaceBelow = window.innerHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(140, Math.min(maxMenuHeight, openAbove ? spaceAbove : spaceBelow));

    setMenuStyle({
      left: `${Math.max(gutter, rect.left)}px`,
      maxHeight: `${availableHeight}px`,
      position: "fixed",
      top: openAbove ? `${Math.max(gutter, rect.top - availableHeight - 6)}px` : `${rect.bottom + 6}px`,
      width: `${rect.width}px`,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, portal, maxMenuHeight]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleViewportChange() {
      updateMenuPosition();
    }

    document.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, portal, maxMenuHeight]);

  function chooseOption(option: AppSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setSearch("");
    setOpen(false);
  }

  const optionList = open ? (
    <div
      className={`custom-option-list app-select-option-list ${portal ? "portal" : ""}`.trim()}
      ref={menuRef}
      role="listbox"
      style={portal ? menuStyle : { maxHeight: `${maxMenuHeight}px` }}
    >
      {searchable ? (
        <label className="app-select-option-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{searchPlaceholder}</span>
          <input
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder={searchPlaceholder}
            value={search}
          />
        </label>
      ) : null}

      <div className="app-select-option-scroll">
        {filteredOptions.length ? (
          filteredOptions.map((option) => (
            <button
              aria-selected={value === option.value}
              className={value === option.value ? "active" : ""}
              disabled={option.disabled}
              key={option.value}
              onClick={() => chooseOption(option)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span>
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {value === option.value ? <Check size={16} /> : null}
            </button>
          ))
        ) : (
          <span className="app-select-empty">No options found.</span>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={menuClassName} ref={rootRef}>
      {label ? <span className="app-select-menu-label">{label}</span> : null}
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel || label}
        className="app-select-menu-button"
        ref={buttonRef}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>
          <strong>{selectedLabel}</strong>
          {selectedDescription ? <small>{selectedDescription}</small> : null}
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {portal && optionList ? createPortal(optionList, document.body) : optionList}
    </div>
  );
}
