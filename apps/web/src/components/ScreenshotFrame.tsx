import { screenshotUrl } from '@/landing/screenshots';
import { cn } from '@/lib/cn';

export interface ScreenshotFrameProps {
  name: string;
  alt: string;
  caption?: string;
  priority?: boolean;
  className?: string;
}

export function ScreenshotFrame({
  name,
  alt,
  caption,
  priority = false,
  className,
}: ScreenshotFrameProps) {
  const url = screenshotUrl(name);

  if (!url) {
    return (
      <div
        role="img"
        aria-label={`Screenshot unavailable: ${alt}`}
        className={cn(
          'flex aspect-[16/10] w-full items-center justify-center rounded-lg border border-dashed border-border bg-card px-4 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        Screenshot unavailable
      </div>
    );
  }

  return (
    <figure className={cn('m-0 w-full', className)}>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <img
          src={url}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          className="block aspect-[16/10] w-full object-contain"
        />
      </div>
      {caption ? <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}
