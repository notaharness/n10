/** The shells the Shell setting names. `auto` is the machine's login shell. */
export const SHELL_CHOICES = ['fish', 'zsh', 'bash', 'sh'] as const;
export type ShellChoice = (typeof SHELL_CHOICES)[number];
