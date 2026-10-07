import { ReactNode } from "react";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; label?: string };
  color?: "primary" | "success" | "warning" | "destructive" | "info";
  onClick?: () => void;
  active?: boolean;
}

const colorMap = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

export function StatsCard({ title, value, icon: Icon, trend, color = "primary", onClick, active }: StatsCardProps) {
  return (
    <Card
      className={`transition-all hover:-translate-y-0.5 hover:shadow-md ${onClick ? "cursor-pointer" : ""} ${active ? "ring-2 ring-warning" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${title}: ${value}. Buka daftar` : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}
    >
      <CardContent className="p-4">
        <div className={`mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${colorMap[color]}`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <p className="text-[22px] font-extrabold tracking-tight">{value}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{title}</p>
          {trend && (
            <div className="flex items-center gap-1 text-xs">
              {trend.value > 0 ? (
                <TrendingUp className="h-3 w-3 text-success" />
              ) : trend.value < 0 ? (
                <TrendingDown className="h-3 w-3 text-destructive" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" />
              )}
              <span className={trend.value > 0 ? "text-success" : trend.value < 0 ? "text-destructive" : "text-muted-foreground"}>
                {trend.value > 0 ? "+" : ""}{trend.value}%
              </span>
              {trend.label && <span className="text-muted-foreground">{trend.label}</span>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
