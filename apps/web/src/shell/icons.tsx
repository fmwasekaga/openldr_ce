// Line-style SVG icons (reimplemented in the OpenLDR repo; Corlix is design reference only).
import type { SVGProps } from 'react';

function base(props: SVGProps<SVGSVGElement>) {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export function IconDashboard(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

export function IconReports(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 13H8" />
      <path d="M16 17H8" />
      <path d="M16 13h-2" />
    </svg>
  );
}

export function IconForms(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
    </svg>
  );
}

export function IconUsers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconAudit(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function IconChevronLeft(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconSun(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ width: 16, height: 16, strokeWidth: 2, ...p })}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function IconMoon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ width: 16, height: 16, strokeWidth: 2, ...p })}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
