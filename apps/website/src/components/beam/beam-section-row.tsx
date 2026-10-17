import type { ReactNode } from 'react';

export function BeamSectionRow({
  title,
  illustration,
  illustrationSide = 'right',
  children,
}: {
  title: string;
  illustration: ReactNode;
  illustrationSide?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 md:grid-cols-12 md:gap-14">
      <div
        className={`min-w-0 md:col-span-5 ${
          illustrationSide === 'left' ? 'md:order-2' : ''
        }`}
      >
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        {children}
      </div>
      <div className="min-w-0 md:col-span-7">{illustration}</div>
    </section>
  );
}
