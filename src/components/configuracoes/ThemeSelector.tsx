import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type SelectableTheme = 'light' | 'dark';

interface ThemeSelectorProps {
  value: string;
  onValueChange: (value: SelectableTheme) => void;
}

export function ThemeSelector({ value, onValueChange }: ThemeSelectorProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as SelectableTheme)}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <Label
        htmlFor="tema-light"
        className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
      >
        <RadioGroupItem value="light" id="tema-light" className="sr-only" />
        <div className="mb-2 h-8 w-8 rounded-full border bg-background shadow-sm" />
        <span className="text-sm font-medium">Claro</span>
      </Label>
      <Label
        htmlFor="tema-dark"
        className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
      >
        <RadioGroupItem value="dark" id="tema-dark" className="sr-only" />
        <div className="mb-2 h-8 w-8 rounded-full border bg-sidebar-background shadow-sm" />
        <span className="text-sm font-medium">Escuro</span>
      </Label>
    </RadioGroup>
  );
}
