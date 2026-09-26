'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu } from 'lucide-react';

export interface NavLinkItem {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Disclosure menu for secondary navigation (Part 01 §1.3: keep the primary bar
 * short). On small screens it also carries the primary items, since the primary
 * bar is hidden there. Escape and outside click close it; focus returns to the
 * trigger on Escape.
 */
export function NavMoreMenu({
  label,
  menuLabel,
  primary,
  secondary,
}: {
  label: string;
  menuLabel: string;
  primary: NavLinkItem[];
  secondary: NavLinkItem[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const renderItem = (item: NavLinkItem, extraClass = '') => {
    const Icon = item.icon;
    return (
      <li key={item.key} className={extraClass}>
        <Link
          href={item.href}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted"
        >
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {item.label}
        </Link>
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        data-testid="nav-more"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-medium"
      >
        <Menu className="h-3.5 w-3.5 lg:hidden" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <nav
          id={menuId}
          aria-label={menuLabel}
          className="absolute right-0 mt-2 w-60 rounded-xl border border-border bg-card shadow-lg p-2 z-50"
        >
          <ul className="space-y-0.5">
            {primary.map((item) => renderItem(item, 'lg:hidden'))}
            {primary.length > 0 && <li aria-hidden="true" className="lg:hidden my-1 border-t border-border" />}
            {secondary.map((item) => renderItem(item))}
          </ul>
        </nav>
      )}
    </div>
  );
}
