/** Minimal masked input; no secret is rendered or put into the main prompt editor. */
export class SecretInput {
  focused = true;
  private value = '';
  private pasting = false;
  private escape = '';
  private cancelTimer?: ReturnType<typeof setTimeout>;
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
    clearTimeout(this.cancelTimer);
    this.cancelTimer = undefined;
    this.value = '';
    this.escape = '';
    this.pasting = false;
  }
  handleInput(data: string) {
    clearTimeout(this.cancelTimer);
    this.cancelTimer = undefined;
    if (!this.pasting && data === '\x1b') {
      // Raw stdin can split an arrow or paste marker immediately after ESC.
      // A short interval distinguishes that prefix from a standalone cancel key.
      this.escape = data;
      this.cancelTimer = setTimeout(() => {
        this.cancelTimer = undefined;
        this.value = '';
        this.escape = '';
        this.done(undefined);
      }, 50);
      return;
    }
    for (const char of data) {
      // Consume CSI/SS3 sequences without dropping adjacent text. Retain a partial
      // sequence across reads, including bracketed paste markers and arrow keys.
      if (this.escape) {
        this.escape += char;
        if (this.escape.length === 2 && (char === '[' || char === 'O')) continue;
        if (this.escape.length > 2 && /[ -?]/.test(char) && this.escape.length < 64) continue;
        if (this.escape === '\x1b[200~') this.pasting = true;
        if (this.escape === '\x1b[201~') this.pasting = false;
        this.escape = '';
        continue;
      }
      if (char === '\x1b') {
        this.escape = char;
        continue;
      }
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
      if (!this.pasting && (char === '\x7f' || char === '\b')) this.value = this.value.slice(0, -1);
      else if (!this.pasting && char === '\x15') this.value = '';
      else if (/[A-Za-z0-9._~+/=-]/.test(char) && this.value.length < 512) this.value += char;
    }
    this.redraw();
  }
}
