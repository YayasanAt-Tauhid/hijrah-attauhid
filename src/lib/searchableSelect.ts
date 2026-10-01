import { Children, isValidElement, type ReactNode } from "react";

export function getOptionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return getOptionText(child.props.children);
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesOption(label: string, search: string): boolean {
  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("id-ID")
      .trim();
  const text = normalize(label);
  return normalize(search)
    .split(/\s+/)
    .every((word) => text.includes(word));
}
