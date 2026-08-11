import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import type { UsageSummary } from '@/types/subscription';

interface UsageBarProps {
  usage: UsageSummary;
  className?: string;
}

export function UsageBar({ usage, className }: UsageBarProps) {
  const percentage = usage.ratio !== null ? Math.min(usage.ratio * 100, 100) : 0;

  if (usage.unlimited) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{usage.feature_name}</span>
          <span className="font-medium">Ilimitado</span>
        </div>
        <Progress value={0} className="h-2" />
      </div>
    );
  }

  const colorClass =
    usage.status === 'exceeded'
      ? '[&>div]:bg-destructive'
      : usage.status === 'warning'
        ? '[&>div]:bg-warning'
        : '[&>div]:bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{usage.feature_name}</span>
        <span className={cn(
          'font-medium tabular-nums',
          usage.status === 'exceeded' && 'text-destructive',
          usage.status === 'warning' && 'text-warning',
        )}>
          {usage.used} de {usage.limit}
        </span>
      </div>
      <Progress value={percentage} className={cn('h-2', colorClass)} />
      {usage.status === 'warning' && (
        <p className="text-xs text-warning">
          Você já usou {Math.round(percentage)}% do limite.
        </p>
      )}
      {usage.status === 'exceeded' && (
        <p className="text-xs text-destructive">
          Limite atingido. Faça upgrade ou contrate um adicional.
        </p>
      )}
    </div>
  );
}
