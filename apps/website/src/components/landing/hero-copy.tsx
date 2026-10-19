'use client';

import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';

export function HeroCopy() {
  const heading = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (!heading.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height)
    );
    observer.observe(heading.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="hero-statement"
      style={{
        gridTemplateColumns: height
          ? `${height * 1.75}px minmax(0, 1fr)`
          : undefined,
      }}
    >
      <Logo
        className="masthead-logo"
        style={{ height, width: height ? height * 1.75 : undefined }}
      />
      <div ref={heading} className="intro">
        <h1>Keep working in one place.</h1>
        <p>
          Your coding agents and pull requests in one workspace. Plan,
          implement, review, and orchestrate agents in one place.
        </p>
      </div>
    </div>
  );
}
