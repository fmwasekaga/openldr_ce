export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'DRAFT':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'DEPRECATED':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
    case 'DISABLED':
      return 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
    default:
      return '';
  }
}
