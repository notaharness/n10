import { cn } from '@/lib/cn';

/**
 * An image in the site's current theme, `/media/<name>-<theme><suffix>.webp`.
 * Both images render and CSS hides one by the `.dark` class next-themes
 * sets, so the image follows the theme toggle rather than the OS
 * setting. Both carry the alt text: `display: none` keeps the hidden one
 * out of the accessibility tree, and `loading="lazy"` keeps the browser
 * from fetching it.
 */
export function ThemeImage({
  name,
  suffix = '',
  alt,
  className,
}: {
  name: string;
  suffix?: string;
  alt: string;
  className?: string;
}) {
  return (
    <>
      <img
        src={`/media/${name}-light${suffix}.webp`}
        alt={alt}
        loading="lazy"
        className={cn(className, 'n10-only-light')}
      />
      <img
        src={`/media/${name}-dark${suffix}.webp`}
        alt={alt}
        loading="lazy"
        className={cn(className, 'n10-only-dark')}
      />
    </>
  );
}
