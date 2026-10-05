/** Minimal masked input; no secret is rendered or put into the main prompt editor. */
export class SecretInput {
  focused = true;
  private value = '';
  private pasting = false;
  constructor(
    private done: (value: string | undefined) => void,
    private redraw: () => void,
  ) {}
  render(width: number): string[] {
    return [
      'PipeLLM API key (hidden)',
      '*'.repeat(Math.min(this.value.length, Math.max(1, width - 1))),
      'Enter: validate and save   Esc: cancel   Ctrl-U: clear',
    ].map((line) => line.slice(0, Math.max(0, width)));
  }
  invalidate() {}
  dispose() {
    this.value = '';
  }
  handleInput(data: string) {
    // Bracketed paste must not turn a pasted newline into an accidental submit.
    for (const part of data.split(/(\x1b\[200~|\x1b\[201~)/)) {
      if (part === '\x1b[200~') {
        this.pasting = true;
        continue;
      }
      if (part === '\x1b[201~') {
        this.pasting = false;
        continue;
      }
      if (!part) continue;
      if (!this.pasting && part === '\x1b') {
        this.value = '';
        this.done(undefined);
        return;
      }
      if (part.includes('\x1b')) continue;
      for (const char of part) {
        if (!this.pasting && char === '\x03') {
          this.value = '';
          this.done(undefined);
          return;
        }
        if (!this.pasting && (char === '\r' || char === '\n')) {
          const value = this.value;
          this.value = '';
          this.done(value);
          return;
        }
        if (!this.pasting && (char === '\x7f' || char === '\b'))
          this.value = this.value.slice(0, -1);
        else if (!this.pasting && char === '\x15') this.value = '';
        else if (/[A-Za-z0-9._~+/=-]/.test(char) && this.value.length < 512) this.value += char;
      }
    }
    this.redraw();
  }
}
