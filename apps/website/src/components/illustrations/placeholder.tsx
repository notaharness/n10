/** MOCKUP ONLY: replace each named wrapper with its specified illustration. */
export function IllustrationPlaceholder({ name, description, ratio = '8 / 5' }: { name: string; description: string; ratio?: string }) {
  return (
    <div className="illustration-placeholder" style={{ aspectRatio: ratio }} role="img" aria-label={`${name} illustration placeholder. ${description}`}>
      <span>{name}</span>
      <p>{description}</p>
    </div>
  );
}
