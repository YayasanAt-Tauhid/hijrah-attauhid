import { useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { getOptionText, matchesOption } from "@/lib/searchableSelect";

export interface SearchableOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  keywords?: string[];
}

interface SearchableSelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  groupPaymentTypes?: boolean;
}

/** Searchable choices for long lists; short fixed choices still use Select. */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Pilih...",
  searchPlaceholder = "Cari pilihan...",
  className,
  disabled,
  groupPaymentTypes = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const groups = groupPaymentTypes
    ? [
        {
          label: "Tagihan operasional",
          options: options.filter(
            (option) => !/^SALDO\b/i.test(getOptionText(option.label)),
          ),
        },
        {
          label: "Tagihan historis",
          options: options.filter((option) =>
            /^SALDO\b/i.test(getOptionText(option.label)),
          ),
        },
      ]
    : [{ label: undefined, options }];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-haspopup="listbox"
          aria-label={placeholder}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span
            className="min-w-0 truncate"
            title={selected ? getOptionText(selected.label) : undefined}
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(20rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Command
          defaultValue={value}
          label={placeholder}
          filter={(candidate, search, keywords) =>
            matchesOption((keywords ?? []).join(" "), search) ? 1 : 0
          }
        >
          <CommandInput
            ref={inputRef}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <CommandList
            id={listId}
            className="max-h-[min(18rem,var(--radix-popover-content-available-height))]"
          >
            <CommandEmpty>Pilihan tidak ditemukan.</CommandEmpty>
            {groups.map(
              (group, index) =>
                group.options.length > 0 && (
                  <CommandGroup
                    key={group.label ?? index}
                    heading={group.label}
                  >
                    {group.options.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        keywords={[
                          getOptionText(option.label),
                          ...(option.keywords ?? []),
                        ]}
                        disabled={option.disabled}
                        onSelect={() => {
                          onValueChange(option.value);
                          setOpen(false);
                        }}
                        className="items-start py-2.5"
                      >
                        <Check
                          className={cn(
                            "mr-2 mt-0.5 h-4 w-4 shrink-0",
                            value === option.value
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <span className="min-w-0 whitespace-normal break-words">
                          {option.label}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
