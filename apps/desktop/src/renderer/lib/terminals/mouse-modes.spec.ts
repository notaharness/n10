import { describe, expect, it } from 'vitest';
import { mouseModes } from './mouse-modes.js';

describe('mouseModes', () => {
  it('hands wterm 1002 for 1003 and remembers any-motion', () => {
    const m = mouseModes();
    expect(m.filter('a\x1b[?1003h\x1b[?1006hb')).toBe(
      'a\x1b[?1002h\x1b[?1006hb'
    );
    expect(m.anyMotion).toBe(true);
  });

  it('rewrites 1003 inside a list of modes', () => {
    const m = mouseModes();
    expect(m.filter('\x1b[?1000;1003;1006h')).toBe('\x1b[?1000;1002;1006h');
    expect(m.anyMotion).toBe(true);
  });

  it('ends any-motion on its reset, keeping the order in the chunk', () => {
    const m = mouseModes();
    m.filter('\x1b[?1003h');
    expect(m.filter('\x1b[?1003l\x1b[?1000h')).toBe('\x1b[?1002l\x1b[?1000h');
    expect(m.anyMotion).toBe(false);
  });

  it('resets 1003 inside a list of modes', () => {
    const m = mouseModes();
    m.filter('\x1b[?1003;1006h');
    expect(m.filter('\x1b[?1003;1006l')).toBe('\x1b[?1002;1006l');
    expect(m.anyMotion).toBe(false);
  });

  it('resets wterm too when another mode reset ends any-motion', () => {
    const m = mouseModes();
    m.filter('\x1b[?1003h');
    expect(m.filter('\x1b[?1000l')).toBe('\x1b[?1000l\x1b[?1002l');
    expect(m.anyMotion).toBe(false);
    expect(m.filter('\x1b[?1000l')).toBe('\x1b[?1000l');
  });

  it('resets the mode wterm holds whichever tracking mode is reset', () => {
    const m = mouseModes();
    m.filter('\x1b[?1000h');
    expect(m.filter('\x1b[?1002l')).toBe('\x1b[?1002l\x1b[?1000l');
    m.filter('\x1b[?1000;1002;1003h');
    expect(m.filter('\x1b[?1003l\x1b[?1002l\x1b[?1000l')).toBe(
      '\x1b[?1002l\x1b[?1002l\x1b[?1000l'
    );
  });

  it('ends any-motion when another tracking mode replaces it', () => {
    const m = mouseModes();
    m.filter('\x1b[?1003h');
    m.filter('\x1b[?1002h');
    expect(m.anyMotion).toBe(false);
  });

  it('ends any-motion when the terminal is reset', () => {
    const m = mouseModes();
    m.filter('\x1b[?1003h');
    expect(m.filter('a\x1bcb')).toBe('a\x1bcb');
    expect(m.anyMotion).toBe(false);
  });

  it('leaves other modes alone', () => {
    const m = mouseModes();
    expect(m.filter('\x1b[?1049h\x1b[?25l')).toBe('\x1b[?1049h\x1b[?25l');
    expect(m.anyMotion).toBe(false);
  });

  it('completes a sequence split across chunks', () => {
    const m = mouseModes();
    expect(m.filter('x\x1b[?10')).toBe('x');
    expect(m.anyMotion).toBe(false);
    expect(m.filter('03hy')).toBe('\x1b[?1002hy');
    expect(m.anyMotion).toBe(true);
  });

  it('holds a partial sequence across several chunks', () => {
    const m = mouseModes();
    expect(m.filter('\x1b')).toBe('');
    expect(m.filter('[?1')).toBe('');
    expect(m.filter('003h')).toBe('\x1b[?1002h');
    expect(m.anyMotion).toBe(true);
  });

  it('lets go of a held prefix that turns out not to be a mode', () => {
    const m = mouseModes();
    expect(m.filter('x\x1b[?')).toBe('x');
    expect(m.filter('abc')).toBe('\x1b[?abc');
  });

  it('holds a lone escape at the end of a chunk', () => {
    const m = mouseModes();
    expect(m.filter('x\x1b')).toBe('x');
    expect(m.filter('[1mz')).toBe('\x1b[1mz');
  });
});
