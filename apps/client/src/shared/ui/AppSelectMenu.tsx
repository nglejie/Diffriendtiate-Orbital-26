import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

export type AppSelectOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

type AppSelectMenuProps = {
  ariaLabel?: string;
  className?: string;
  label?: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  value: string;
};

export function AppSelectMenu({
  ariaLabel,
  className = "",
  label,
  onChange,
  options,
  placeholder = "Select",
  value,
}: AppSelectMenuProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const selectedLabel = selectedOption?.label || placeholder;
  const menuClassName = ["app-select-menu", className].filter(Boolean).join(" ");

  function chooseOption(option: AppSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  return (
    <div className={menuClassName} onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      {label ? <span className="app-select-menu-label">{label}</span> : null}
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel || label}
        className="app-select-menu-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selectedLabel}</span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open ? (
        <div className="custom-option-list app-select-option-list" role="listbox">
          {options.map((option) => (
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
              <span>{option.label}</span>
              {value === option.value ? <Check size={16} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
