import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ExportMenuProps {
  onExcel: () => void;
  onCsv: () => void;
  onPrint?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

// Menu export untuk halaman yang membentuk isi file sendiri (bukan dari kolom DataTable).
export function ExportMenu({ onExcel, onCsv, onPrint, disabled, loading }: ExportMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onExcel}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCsv}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </DropdownMenuItem>
        {onPrint && <DropdownMenuItem onClick={onPrint}>Print / PDF</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
