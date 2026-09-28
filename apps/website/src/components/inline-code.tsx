import { Fragment } from 'react';

/**
 * Renders `backticked` spans of a plain string as inline code that
 * never wraps, so a command or `--flag` doesn't break at a hyphen.
 */
export function withCode(text: string) {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={part} className="whitespace-nowrap">
        {part}
      </code>
    ) : (
      part
    )
  );
}

/**
 * A command that may wrap between words but never inside one, so
 * `--global` or `@notaharness/beam` stays whole on a narrow screen.
 */
export function wrapAtSpaces(command: string) {
  return command.split(' ').map((word, i) => (
    <Fragment key={word}>
      {i > 0 && ' '}
      <span className="whitespace-nowrap">{word}</span>
    </Fragment>
  ));
}
